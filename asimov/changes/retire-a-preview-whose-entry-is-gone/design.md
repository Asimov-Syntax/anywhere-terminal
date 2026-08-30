# Design: retire-a-preview-whose-entry-is-gone

> **PARKED — do not build.** Oracle review found D3's central claim untrue of the code: `getEntry`
> returns `null` for a failed reader as well as a deleted entry, so nothing here can tell absence
> from a SQLite hiccup. The conclusive lookup was split out as `docs/PLAN.md` WT-011.8; these
> decisions are revised, and Gate 2 re-earned, only after it lands. D2's cadence, D3's claim, and
> the miss-ladder scheduling in D1 all change. Triage: `.reviews/oracle-triage.md`.

## Decisions

### D1: Deletion is a third `Target` kind, not a flag beside a resolved one

`Target` gains `{ kind: "gone" }` alongside `uncovered` and `unresolved`.

DESIGN.md § 9 D35 names deletion a third outcome, and § 12 fixes the other two: `unresolved` is "not
there yet" and is retried, `uncovered` is "this source keeps no transcript" and never is. A vanished
session is neither — it is a session that existed and stopped. Modelling it as a boolean beside a
resolved target would leave two fields able to disagree, which is the shape the § 2.5 debt already
took: a cleared line beside a target still claiming to be resolved.

`gone` retires the line and does no filesystem work at all — no `stat`, no `read`, no resolve. Unlike
`uncovered` it is not final: the entry is still re-confirmed on the cadence below, so a session that
reappears is picked up. That costs one vault lookup per interval and nothing else.

### D2: The entry is re-confirmed on its own, slower cadence

`Held` gains `confirmedAt`, and `SessionPreviewDeps` gains `entryRecheckMs` (default 30000). A look
whose target is already resolved re-fetches the vault entry only when `now() - confirmedAt` has
reached that interval; otherwise it proceeds exactly as it does today.

The per-look re-fetch is what an earlier review removed and must not come back: `getEntry` is
resolve-by-id with no cache (`VaultService.ts:894`), and for a Codex row without SQLite it reaches
the same history-sized tree walk the retry ladder exists to bound. Re-confirming on a cadence an
order of magnitude slower than the 2 s freshness check keeps that walk to roughly one per session per
30 s while bounding how long a dead session's line can survive.

30 s is chosen against what the staleness costs, not against what the check costs: the line is
already historical text, and a row showing one for a few extra seconds after its session was deleted
is a smaller lie than the one this fixes. Nothing perceives the difference between 2 s and 30 s here.

### D3: Only the vault entry's absence retires the line — the file's does not

A `stat` that fails, a read that fails, and a look that exceeds its deadline keep their current
outcomes. Only `deps.entry` answering `null` produces `gone`.

The blueprint task's acceptance reads "a row whose transcript is temporarily unreadable keeps its
last known line and backs off", and `worktree-subsystem-debts.md` § 2.5 attributes that to § 2.3.
§ 2.3 is the **timeout** debt, and that behaviour shipped in WT-011.3: a look that ran out of time
achieved nothing and keeps the line. It is not a statement about a file that is missing or
unreadable, and reading it as one would reverse an accepted requirement —
`worktree-agent-presence` § "An agent row's preview line says what its session last did" says a row
whose transcript cannot be read "SHALL carry no preview line at all". This change does not reopen
that. The acceptance clause is satisfied by the timeout path already shipped.

### D4: A `gone` target is reached only from a confirmation, never inferred

The existing failure path — `stat` fails, the Codex filename fallback fails — continues to call
`clearTarget` + `forget`, which drops the target to `unresolved` and sends the next look back to the
vault. If that look then finds no entry, the answer is `gone` through the same confirmation as any
other. Deletion is never guessed from a missing file.

This is also what keeps the two rules from contradicting each other, which is why the blueprint made
this task depend on WT-011.3: a timeout must not reach a path that could classify it as deletion, and
it cannot, because a timed-out attempt commits nothing at all.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `look` | The removed per-look `deps.entry` call returns by the back door, restoring the Codex tree walk at 0.5 Hz | D2 gates it on `confirmedAt`; unit test drives many looks inside one interval and asserts exactly one entry lookup |
| `Target` | A `gone` row keeps paying for `stat`/`read` it can never use | D1 returns before any filesystem work; unit test asserts no stat after the entry vanishes |
| Deletion classification | A timeout or a transient `stat` failure retires a live session's line | D3/D4 — only a null `deps.entry` produces `gone`; unit tests cover both non-deletions |
| Vault lookups | Growth axis: sessions held × time. One extra `getEntry` per session per 30 s | Bounded by `cap` (256) and the interval; strictly slower than the `stat` cadence beside it |
| A session that reappears | `gone` is final and the row never recovers | D1 keeps re-confirming on the same cadence; unit test restores the entry and asserts the line returns |
| Vault store | Mutable resource that outlives the request | n/a — this service only reads, and `getEntry` takes no lock |
