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
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
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

