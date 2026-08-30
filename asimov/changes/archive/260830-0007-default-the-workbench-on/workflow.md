# Workflow State: default-the-workbench-on

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [x] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-010.6`)_

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-010.6
Lane: full (flags: user-visible-ui, re-review)
Planned at: ee68eafc
- Oracle round: 5 findings, all accepted. D2's "optional deps let a consumer go first" was wrong — `main.ts` passes direct literals, so excess-property checking makes a partial removal a type error; the four consumer tasks now each remove their own wiring and run in series, with 1_4 before 1_2 because the collapse call reads the getter 1_2 deletes.
- Oracle also caught an implicit OFF default in `WorktreeView.test.ts`'s `mount` (five unrelated cases assert the OFF arm), `WorktreeView.refresh()` existing only for the deleted setter, the message's union membership, and a fifth spec requirement still carrying the WHERE clause.
- 1_3 merged into 1_2 at build time: `WorktreeController` implements `TabBarScopePanel`, so deleting the controller's `setWorkbench` breaks the coordinator's contract in the same edit — the two cannot type-check apart, in either order. Six tasks, not seven.
- Verify gate: type check clean, 5257 unit tests, I10 ok, `biome check src` 4 errors / 14 warnings / 3 infos — one below the 5-error baseline, all four pre-existing in files this change does not touch.
- Review cycle 1 round 1: APPROVE, 0 BLOCK / 0 WARN / 0 SUGGEST. The contracts specialist also reported clean directly; its result matches the round file, nothing dropped.
