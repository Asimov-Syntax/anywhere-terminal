# Workflow State: reuse-a-snapshot-while-the-store-is-unchanged

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(no fork: stamp-gated reuse is the only option that keeps `absent` honest)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full
Planned at: 55110e7a
Flags: security-privacy (a stale reuse would surface as a false `absent`, deleting a live row's preview)
Origin: round-1 W2 of `snapshot-a-live-store-atomically`, which is blocked from archiving until this lands. Measured there: 522 MB store, 951 ms engine snapshot vs 5 ms APFS clone (~190x), ~2.5 s projected for the known 1.4 GB OpenCode store.
Reuse-first: `storeStamp.ts` (`stampStoreFiles`/`sameStamps`) is the shipped invalidation key the list cache already trusts — adopted rather than reinvented, including its documented exclusion of `-shm`.
Validate warning triaged: the requirement is long (933 chars) because the reuse clause and the atomicity clause it depends on are one contract; splitting them would separate a rule from its precondition.
Verify gate: check-types clean, 5416 unit tests pass, I10 gate ok, `biome check src` at its 4/14/3 baseline (formatter diffs hand-applied, never `--write`).
Deviation: 1_2 and 1_3 each needed a re-lease after the suite guard refused the first `verify-task`; declared additive with `--test-change` and re-run, not waved through.
Deviation: one full-suite run failed `extension.worktreeAssembly.test.ts [I14]`; reproduced green twice in isolation and the pool reaches no extension code until 1_4, so recorded as a flake, not a gate pass around a real failure.
Measured (D-risk 'the win is assumed'): 164MB WAL store, in-process engine — first read 341ms, two reuses 1ms each, and a committed write forces a fresh 253ms snapshot. The reuse path is ~340x cheaper and a write still costs full price, which is the point.
Handback (cycle 1 round 1, superseded): B2 disproved D3's premise — Cursor CLI keeps one `store.db` per chat (`cursorPaths.ts:132`) and a list walks every candidate (`cursorReader.ts:407`), so "a handful of stores, one per agent" is false and the byte-accounting dismissal built on it collapses. B3 rewrites the same disk-ownership decision. Gate 2 reopened rather than landing either as a fix commit.
Cycle 2 fixes: check-types clean, 5427 unit tests, I10 ok, `biome check src` at 4/14/3. Mutation-checked every new rule; three dispose tests passed for the wrong reason at first (a 50ms settle replaced a microtask flush) and fixing that exposed a real leak — a caller waiting out another flight could start a production after dispose had captured the in-flight list, now closed by a re-check.

Pending triage (cycle 2, out-of-band from the reuse specialist, verified before recording): `[dbPath, `${dbPath}-wal`]` is built independently at `snapshotPool.ts:72`, `codexReader.ts:513` and `opencodeReader.ts:241`. The pool's reuse gate and the persisted list cache answer the same freshness question from separately-authored path sets. SUGGEST-level; fix is exporting one `storeFilePaths` from `storeStamp.ts`. Held until the round-2 report lands so it is triaged with the rest rather than fixed inside the range under review.
Pending triage (cycle 2, out-of-band from the reuse specialist, verified before recording): `sqlite.ts:491-505` and `:521-535` carry the same borrow/lease/finally-release scaffolding, differing only in each wrapper's result shape. Context for triage, not a rebuttal: both entry points already duplicated the mkdtemp/takeSnapshot/rmrf lifecycle before this change, so the diff swapped two copies of one lifecycle for two copies of another rather than splitting something that was unified. WARN-level; fix is an internal borrow-and-invoke helper leaving the result mapping in each wrapper.
Cycle-2 note (out-of-band, performance specialist could not reach the chair): it raised then WITHDREW a BLOCK on the pool bounds, on the ground that no caller fans out concurrent cross-store snapshots — the candidate walk in `cursorReader.ts:407` is sequential. The withdrawal is correct on concurrency and does NOT weaken D3's capacity bound, which never rested on concurrency: a sequential walk retains one snapshot per store it visits, so N stores accumulate inside one idle window just the same. Round-1 B2's wording ("a list walks every candidate") is the accumulation argument, not a fan-out argument. Recorded because a withdrawal that reaches only me could otherwise leave a stale BLOCK in the chair's report, or be mistaken for grounds to drop the capacity bound.
Pending triage (cycle 2, BLOCK from the data-security specialist, arrived out of band AND as its final report; verified before recording): `stampStoreFiles` (`storeStamp.ts:15-25`) stats `.db` then `-wal` sequentially, so a stamp is not a coherent read of the store. A retained `{db:S0}` with no WAL can be matched by a later read that observes `.db` before a checkpoint and `-wal` after its deletion — equal stamps across a completed write, i.e. a false `absent`. This invalidates D1's PROOF, not just its implementation: "equal stamp means no write landed" holds only if both files are observed at one instant. Accepted. Fix is a coherent double stamp (two full stamps in fixed order, reuse only when equal, else produce without retaining); with `db,wal,db,wal` ordering the bad interleaving is self-contradictory, because the second `.db` read necessarily falls after the first `-wal` read and would observe the checkpoint. Requires a changed D1 → handback, not a fix commit. Note the shipped list cache shares the mechanism but not the consequence (stale list, not a deletion), and the `storeFilePaths` consolidation above would let one coherent-stamp helper serve all three sites.
Handback (cycle 2 round 2, superseded): thrash stop on both triggers — B3 is the same lifecycle invariant failing a second time, and B5 (specialist BLOCK the chair's report dropped) invalidates D1's proof rather than its code. D1 and D3a rewritten; three of the six triaged findings were carried in from specialists that reached me directly but not the report.
Cycle-3 fixes: check-types clean, 5438 unit tests, I10 ok, `biome check src` at 4/14/3. Each rule mutation-checked; two mutations reproduce the reported bugs exactly — a single-pass generation read (round-2 B5) and a flight-map-only disposal drain (round-2 B3) — and each fails only its own test.
Handback (cycle 3 round 3, mandatory at the cycle cap): B6 and W6 both change D3's rules. Premise audit recorded in .reviews/round-3.md — the correctness core (B1/B4/B5) has been fixed and confirmed, every open finding is capacity/lifetime machinery, and the bound itself is evidence-backed, so the cut is to the mechanism: admission accounting becomes one synchronous transaction rather than a locked span.

Evidence correction (4_1): the suite-change record for 4_1 names five files, but only `src/vault/snapshotPool.test.ts` is this change's. `AgentHookController.test.ts`, `ClaudeHookInstaller.test.ts`, `CursorHookInstaller.test.ts` and `WorktreeCreateDialog.test.ts` were reformatted at 15:31:06 by another session sharing this working tree running biome in write mode; 4_1's `--test-change` text was written before I noticed them and reads as if all five were mine. They are not authored, staged or committed by this change, and 4_1 claims nothing about them. `verify-task` refuses to re-record a done task, so the correction lives here.
Lint baseline drift: `biome check src` now reports 0 errors / 14 warnings / 0 infos rather than the recorded 4/14/3 baseline, because that same external auto-fix cleared errors this change never touched (useTemplate in CursorHookInstaller.test.ts, formatter diffs elsewhere). The drop is not this change's doing and is not claimed as its work; every formatter diff in this change's own files was hand-applied.
Cycle-4 fixes: check-types clean, 5442 unit tests, I10 ok. `biome check src` now reports 0 errors / 14 warnings / 0 infos; the 4 errors and 3 infos of the recorded baseline were cleared by the external auto-fix noted above and by that session's own commit, not by this change. This change's own formatter diffs were hand-applied throughout.
B6 note: it took three attempts to build a mutation that reproduces the concurrent-admission bug — a bare microtask before the block, and sizing moved back inside it, both left the tests green. Only reintroducing a suspension BETWEEN the capacity decision and the insert fails them, which is the interleaving B6 actually describes.

Pending triage (cycle 4, out-of-band from the reuse specialist, verified before recording): `stampStoreFiles` (storeStamp.ts:16-26) and `readOnce` (:66-80) each build `{mtimeMs,size}` from a stat, differing only in error policy. Accepted at SUGGEST. Taking a simpler fix than proposed: `stampStoreFiles` delegates to `readOnce` and ignores `usable`, since both already omit a path on any error and the stamps are identical — that removes the second loop rather than parameterizing it, and each caller keeps its own policy by choosing whether to read `usable`. Same drift class as W4: a future `FileStamp` field updated in one loop and not the other would put the list cache and the reuse gate back into disagreement about freshness. Held until the round-4 report lands so it is triaged with the rest rather than committed inside the range under review.
Handback (cycle 4 round 4): B8 is the shape finding, and the capacity machinery is cut rather than patched. Evidence that decided it — 72 Cursor per-chat stores at 60KB each (~4MB total) against opencode.db at 1.4GB, state.vscdb at 122MB, state_5.sqlite at 400KB. Retention becomes opt-in and keyed to the fixed one-per-agent stores; LRU, byte budgets, capacity eviction and reservation all go.
- Note: round-4 B7 (lease at publication) is implemented and holds, but no test fails when the lease is moved back after publication. The reachable form of B7 was cross-store LRU eviction deleting a just-published entry, and that machinery is gone with D3; the residual same-store form needs two concurrent flights for one path, which D4's one-in-flight-per-store rule plus the bounded-wait loop cannot produce — a displaced producer only exists after the flight it waited on has settled. Recorded as closed by construction, with the distinct-store test as the regression guard, rather than covered by a mutation-killing test that does not exist.
- Note: 5_3 folded in the round-4 SUGGEST that `stampStoreFiles` delegate to `readOnce`; its usability verdict is deliberately discarded there, pinned by a new test, because tightening it would change list-cache invalidation.
- Held for cycle-5 triage, found by the author, NOT by the reuse specialist (which reported clean and named `storeFilePaths` as centralizing the db/WAL path set): `src/vault/readers/cursorIdeReader.ts:260` `sourceStamps` hand-writes both the `[dbPath, dbPath-wal]` set that `storeFilePaths()` owns and a fourth copy of the stat->FileStamp loop that 5_3 consolidated into `readOnce`. Not byte-identical — it also requires `stamp.isFile()`, so delegating is a small behaviour change (a directory at that path would be stamped rather than skipped) and that guard needs a verdict before the fix, not after. Against D1's "one owner for the store's file set".

