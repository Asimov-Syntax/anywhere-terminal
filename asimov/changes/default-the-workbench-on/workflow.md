# Workflow State: default-the-workbench-on

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [ ] All tasks done (`tasks.md`)
- [ ] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-010.6`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-010.6
Lane: full (flags: user-visible-ui, re-review)
Planned at: ee68eafc
- Oracle round: 5 findings, all accepted. D2's "optional deps let a consumer go first" was wrong — `main.ts` passes direct literals, so excess-property checking makes a partial removal a type error; the four consumer tasks now each remove their own wiring and run in series, with 1_4 before 1_2 because the collapse call reads the getter 1_2 deletes.
- Oracle also caught an implicit OFF default in `WorktreeView.test.ts`'s `mount` (five unrelated cases assert the OFF arm), `WorktreeView.refresh()` existing only for the deleted setter, the message's union membership, and a fifth spec requirement still carrying the WHERE clause.
