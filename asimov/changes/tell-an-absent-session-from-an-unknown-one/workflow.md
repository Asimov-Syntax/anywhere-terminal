# Workflow State: tell-an-absent-session-from-an-unknown-one

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
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full
Planned at: 16cd5756

Blueprint: docs/PLAN.md task WT-011.8
Lane: full — widens a shipped adapter contract across four readers; escalation flag `new-api-contract`; Mode: fastlane
Planned at: 16cd5756
Origin: split out of WT-011.5 at planning, when oracle review showed its mechanism did not exist. That change is parked and depends on this one.
No fork at Gate 1: the only candidate alternative — a separate `entryExists` probe beside `entry` — asks each store the same question twice and lets the two answers disagree, so it was rejected in design.md D1 rather than asked.
Spec: NO-DELTA. Nothing user-observable changes; the consumer (WT-011.5) owns the visible delta.
Oracle round: 5 BLOCK / 1 WARN / 1 SUGGEST, all verified against code and all accepted. Triage in .reviews/oracle-triage.md; it reversed D2's missing-store rule, demoted the Cursor child-map miss from absent to unknown, and added task 1_2. Peer file map that seeded two of the findings: .reviews/explore-evidence.md.
Validator warning triaged, not fixed: task 1_1 names 9 files. Its edit is a ~5-line wrapper in each of the four readers plus one type, one interface and two tests — well inside the sizing rule by lines. Splitting it would put src/vault/VaultService.ts back into the parallel wave, which is the contention an earlier validate run flagged.
