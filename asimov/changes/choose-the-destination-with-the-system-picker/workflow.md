# Workflow State: choose-the-destination-with-the-system-picker

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
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full
Planned at: 7abcebf7

Blueprint: none
Lane: full — escalation flags: new-api-contract (a new request and a new reply on the worktree wire)
Planned at: 71b53ca1
Plan attack: the oracle refuted row 1 and left row 2 unresolved, and both were repaired in design rather than accepted. Writing `pathInput.value` is not the transition a typed override performs — `selection()` reads `pathIsDerived`/`supplied` and `syncDerived` overwrites an unfocused input — so the transition gained one owner both callers use. The opening must be snapshotted at construction, because a predecessor dialog reading the controller's token at reply time would read its successor's. It also named five wire surfaces the first plan omitted: the inbound allowlist, the exhaustive inbound sample, the router, the worktree handler map, and the destination row's stylesheet.
