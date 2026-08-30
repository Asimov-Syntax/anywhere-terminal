# Workflow State: land-one-wire-contract-for-create-and-removal

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [ ] `asm change validate` passes
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

Blueprint: docs/PLAN.md task WT-012.0
Lane: full (M) — a contract every Phase 12 and Phase 13 task reads | flags: new-api-contract, cross-boundary
Direction (fastlane, no fork): the blueprint's own Acceptance settles both candidate forks — the union travels unflattened to the mutation service, and the legacy boolean blocker record is deleted rather than kept beside the check model.
Planned at: 31abec81
Scope note: `notApplicable` and `BranchDeleteOffer` land on the wire with no producer. The sources that answer "the question does not arise", the merge proof, and the orphan proofs are WT-013.1 / WT-013.2 / WT-013.3.
Serialization: every task shares `src/types/messages.ts` or `src/worktree/worktreeMutationService.ts`, so the wave plan is fully serial by design rather than by omission.
