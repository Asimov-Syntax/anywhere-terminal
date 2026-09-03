# Workflow State: wait-for-the-repair-the-assertion-reads

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
Lane: light
Planned at: 3065129b

Blueprint: none
Lane: light
Must not: change production code, or weaken an assertion.
Why now: this is the same defect archived as `wait-for-the-prune-the-assertion-reads`, at the site that change's own second opinion named as a high-risk survivor. Its Boundary forbade converting a wait that had not actually failed the gate; on 2026-09-04 this one did, failing `choose-the-destination-with-the-system-picker` 1_2's verify at `extension.worktreeAssembly.test.ts:2896` with `expected false to be true` — no `worktree repair` recorded when the assertion read the argv. That is the qualification the Boundary required, so it is converted here rather than in the archived change.
Remainder: 87 bare `await settle();` calls still survive in that file and are NOT converted, for the same reason. The archived change's workflow.md lists the high-risk ones.
