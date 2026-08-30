# Design: retire-a-preview-whose-entry-is-gone

> Unparked. WT-011.8 shipped the conclusive lookup this change was waiting on:
> `VaultService.lookupEntry` answers `VaultEntryLookup` (`src/vault/types.ts:217`), and `getEntry`
> is now the collapsing view of it. D3 below is rewritten against that contract; D2's bound is
> restated as a cadence rather than a wall-clock promise, and D5 is new. Triage that produced the
> split: `.reviews/oracle-triage.md`.

## Decisions

### D1: Deletion is a third `Target` kind, not a flag beside a resolved one

`Target` gains `{ kind: "gone" }` alongside `uncovered` and `unresolved`.

DESIGN.md § 9 D35 names deletion a third outcome, and § 12 fixes the other two: `unresolved` is "not
there yet" and is retried, `uncovered` is "this source keeps no transcript" and never is. A vanished
session is neither — it is a session that existed and stopped. Modelling it as a boolean beside a
resolved target would leave two fields able to disagree, which is the shape the § 2.5 debt already
took: a cleared line beside a target still claiming to be resolved.

`gone` retires the line and does no filesystem work at all — no `stat`, no `read`, no resolve. Unlike
`uncovered` it is not final: the entry is still re-confirmed on D2's cadence, so a session that
reappears is picked up. That costs one vault lookup per interval and nothing else.

`gone` also stays out of the retry ladder. A look at a `gone` row is not a failed resolution — it is
a row correctly showing nothing — so it scores as progress and keeps the ordinary `recheckMs`
spacing rather than decaying toward the 256× ceiling `MAX_BACKOFF_SHIFT` allows. The ladder exists to
bound the Codex tree walk (round-3 B1-R3), and a `gone` look performs none of it. What actually
bounds the cost here is D2's interval, not the ladder (oracle F4).

### D2: The entry is re-confirmed on its own, slower cadence

`LookState` gains `confirmedAt`, and `SessionPreviewDeps` gains `entryRecheckMs` (default 30000). A
look whose target is already resolved re-fetches the vault entry only when
`now() - confirmedAt` has reached that interval; otherwise it proceeds exactly as it does today.

The per-look re-fetch is what an earlier review removed and must not come back: the lookup is
resolve-by-id with no cache (`VaultService.ts:915`), and for a Codex row without SQLite it reaches
the same history-sized tree walk the retry ladder exists to bound. Re-confirming on a cadence an
order of magnitude slower than the 2 s freshness check keeps that walk to roughly one per session per
30 s while bounding how long a dead session's line can survive.

30 s is chosen against what the staleness costs, not against what the check costs: the line is
already historical text, and a row showing one for a few extra seconds after its session was deleted
is a smaller lie than the one this fixes.

**What the interval does and does not promise.** It is the gap between two entry lookups, not a
wall-clock bound on the stale line. This service is pull-based: `preview` answers from cache without
starting a check while an abandoned look is still outstanding, and a row demonstrably holds its line
far past any interval when nothing asks (`sessionPreviewService.test.ts:839`, oracle F3). What the
service can promise is that the **first eligible look after the interval** re-confirms, and the spec
delta is written that way. Only `confirmedAt` is stamped by time; the retirement itself is caused by
an answer, never by a clock.

`confirmedAt` records only **conclusive** answers — `found` and `absent`. An `unknown` establishes
nothing, so leaving the stamp where it was makes the next look try again immediately rather than
waiting out another interval on a store that has already failed once (oracle F4).

### D3: Only a proven absence retires the line

`deps.entry` widens from `PreviewEntry | null` to the three-way `PreviewLookup`, mirroring
`VaultEntryLookup`. Only `absent` produces `gone`.

This is what WT-011.8 exists for, and `src/vault/types.ts:204` states the asymmetry the service now
consumes: `absent` is reachable only from an enumeration that completed and did not contain the
session; every path that merely failed to find out is `unknown`. A wrong `absent` deletes a live
session's line; a wrong `unknown` leaves a stale one for one more cycle. The service takes the same
side.

A `stat` that fails, a read that fails, and a look that exceeds its deadline keep their current
outcomes — none of them is a statement about the store.

The blueprint task's acceptance reads "a row whose transcript is temporarily unreadable keeps its
last known line and backs off", and `worktree-subsystem-debts.md` § 2.5 attributes that to § 2.3.
§ 2.3 is the **timeout** debt, and that behaviour shipped in WT-011.3: a look that ran out of time
achieved nothing and keeps the line. It is not a statement about a file that is missing or
unreadable, and reading it as one would reverse an accepted requirement —
`worktree-agent-presence` § "An agent row's preview line says what its session last did" says a row
whose transcript cannot be read "SHALL carry no preview line at all". This change does not reopen
that. The acceptance clause is satisfied by the timeout path already shipped.

### D4: An inconclusive lookup achieves nothing, and nothing is what it changes

Today a `null` entry runs `forget`, which blanks the line. Under D3 that path splits, and the
`unknown` half must not keep the old behaviour: retiring a line because SQLite hiccupped is the
failure this change exists to prevent, and blanking it is the same user-visible outcome as retiring
it.

So an `unknown` leaves `target`, `entry`, `stamp`, `line` and `confirmedAt` exactly as they were and
returns the line already on the row — the same shape as the timeout in D33, and for the same reason.
It is scored as a look that did not progress, so the ladder backs the next attempt off.

The one case that changes: a row that has **never** resolved and gets `unknown` returns `undefined`
because it has no line yet, not because anything was retired.

### D5: A `gone` target is reached only from a confirmation, never inferred

The existing failure path — `stat` fails, the Codex filename fallback fails — continues to call
`clearTarget` + `forget`, which drops the target to `unresolved` and sends the next look back to the
vault. If that look then proves the entry absent, the answer is `gone` through the same confirmation
as any other. Deletion is never guessed from a missing file.

This is also what keeps the two rules from contradicting each other, which is why the blueprint made
this task depend on WT-011.3: a timeout must not reach a path that could classify it as deletion, and
it cannot, because a timed-out attempt commits nothing at all.

Recovery is stated rather than implied: `gone → unresolved → resolved`. A re-confirmation that
answers `found` puts the target back to `unresolved` and hands the entry to the ordinary resolve
path, so the next look finds the transcript and the line returns (oracle F6).

### D6: The extension asks for the answer it now needs, and an unrecognised agent is `unknown`

`src/extension.ts:681` maps `vaultService.getEntry` into `deps.entry`; it moves to `lookupEntry` so
the conclusive statuses survive the wiring instead of being collapsed one layer below the consumer
that needs them.

That mapper also rejects an entry whose `agent` is outside `VAULT_AGENT_IDS` — a bare string because
it crosses IPC. That rejection is now `unknown`, not `absent`: an agent this build does not know is a
statement about *this build's* coverage, not proof the session was deleted, and `absent` there would
retire the line of a session that exists. `uncovered` would be the truer name and is not available at
this seam — it is `resolve`'s verdict, reached from the entry's agent, which is exactly what is
missing here — so the conservative status is the right one, at the cost of one retry ladder on a row
that will never preview.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `look` | The removed per-look `deps.entry` call returns by the back door, restoring the Codex tree walk at 0.5 Hz | D2 gates it on `confirmedAt`; unit test drives many looks inside one interval and asserts exactly one entry lookup |
| `Target` | A `gone` row keeps paying for `stat`/`read` it can never use | D1 returns before any filesystem work; unit test asserts no stat after the entry vanishes |
| Deletion classification | A timeout, a transient `stat` failure, or a failed store read retires a live session's line | D3/D4/D5 — only an `absent` lookup produces `gone`; unit tests cover all three non-deletions |
| `unknown` handling | The old `null → forget` blanks the line on a store hiccup, which is the same visible harm as retiring it | D4 — `unknown` commits nothing; unit test asserts the line survives an inconclusive lookup |
| Vault lookups | Growth axis: sessions held × time. One extra `lookupEntry` per session per 30 s | Bounded by `cap` (256) and the interval; strictly slower than the `stat` cadence beside it. Concurrent Codex rows can synchronise their walks (oracle F5) — accepted: the walk is already bounded per session and the ladder no longer amplifies it |
| A session that reappears | `gone` is final and the row never recovers | D1/D5 keep re-confirming on the same cadence; unit test restores the entry and asserts the line returns |
| Vault store | Mutable resource that outlives the request | n/a — this service only reads, and `lookupEntry` takes no lock |
