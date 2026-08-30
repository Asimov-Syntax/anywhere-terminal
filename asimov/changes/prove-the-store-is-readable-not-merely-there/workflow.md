# Workflow State: prove-the-store-is-readable-not-merely-there

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [ ] Gate 2: plan approved

## Implement

- [ ] All tasks done (`tasks.md`)
- [ ] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-011.9`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-011.9
Lane: full
Planned at: e3ca7673

Lane: full — security-privacy flag; a status-contract divergence between two read paths
Planned at: e3ca7673

Stage-2 facts established against current code:
- `presence()` (`src/vault/sqlite.ts:299`) is the single presence answer for BOTH entry points, and
  both call it before any pool work — `readSqlite` at `:463`, `withSqliteSnapshot` at `:527`. The
  reuse path does not skip it, so there is no second owner to reconcile.
- `defaultAccess` (`:145`) calls `fs.access(p)` with no mode, i.e. `F_OK`. `R_OK` appears nowhere in
  the codebase.
- `presenceFromAccessError` (`src/utils/fsPresence.ts`) already maps `EACCES` to `unreachable`, so
  proving `R_OK` does not move the absent/unreachable line — which retires the blueprint's stated
  objection to this option.
- Existing permission coverage revokes DIRECTORY permission (`src/vault/sqlite.test.ts:458,878`);
  no case revokes read on the store FILE.

Gate 1 (fastlane): the blueprint's three candidates collapse to one. Proving `R_OK` in the existing
presence call costs zero added syscalls and moves no contract; the other two both add a syscall per
reuse or split the proof across two owners. Recorded here rather than in discovery.md — the fork was
decided by reading the code, not by weighing options with durable evidence.

Build notes:
- 1 mutation (the presence check proving existence only, i.e. reverting `R_OK` to the bare
  `fs.access`), killed — the new case fails exactly as the divergence predicts, with the retained
  snapshot answering `ok` while the cold read answers `db-unreachable`.
- The new case runs against the DEFAULT deps on purpose. Every existing permission case injects
  `exists`, which can only answer present/absent, so none of them reaches this predicate at all.
- The case skips loudly (a console warning, not a silent pass) when the running user can still read a
  `0o000` file — root, or a filesystem that ignores the mode.
- One full-suite run failed in `src/extension.worktreeAssembly.test.ts` [I14] with PTY_LOAD_FAILED,
  and passed standalone, on a clean tree, and on the re-run. Recorded as a flake under parallel load
  rather than diagnosed; it touches nothing this change does.

- Round-1 BLOCK, handed back to plan. D1 is refuted: `R_OK` on the base file proves neither that a
  WAL-mode store's `-wal` is readable nor anything about Windows ACLs, and the reviewer's probe
  demonstrated the divergence surviving the fix. Code reverted from main at `e2ac05ba`; artifacts
  kept. Task 1_1 untocked and Gate 2 reopened.
- The replacement decision has a cost the proposal's "Must not" list currently forbids — proving
  readability means attempting the read, so the reuse path gains work per hit. The PLAN row permits
  it "unless that is the decision recorded", so the proposal's Must-not needs amending as part of the
  replan rather than the design quietly violating it.
