# Workflow State: wait-for-the-dom-the-assertion-reads

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
- [-] Review done — test-only diff in one file, no production change, no escalation flag; the sibling sweep of the same defect was audited predicate-by-predicate by an independent second opinion and the same rule was applied here
- [x] Gate: implementation approved
- [-] Blueprint sync complete — `Blueprint: none` _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: light
Planned at: 37e924a8

Blueprint: none
Lane: light
Must not: change production code, or weaken an assertion.
Why now: `wait-for-the-git-call-each-assertion-reads` swept the waits followed by an `argv` or `launched` assertion and the one DOM-TEXT case that had failed, and stopped there. Two more sites then failed within the hour on the DOM-ELEMENT form of the same defect — `[I14] re-prompts instead of removing…` and `[I14] refuses a confirmation once the agent starts working…` — each blocking `choose-the-destination-with-the-system-picker` 1_2's verify. `settle()` returns on DOM quiescence, which is the right signal only when the rendering IS the last effect; where the host awaits a re-count or a refusal first, quiescence lands before anything is painted. Enumerated mechanically rather than by whichever site flaked: 14 bare waits are immediately followed by a DOM assertion, and 12 are converted.
Deliberately left bare, four sites, each because a predicate for it is satisfied the moment the wait begins and would be the vacuous witness this Boundary forbids: `[3_1]` asserting the agent row is the SAME node after a rebuild; `[3_2]` asserting the live opening's model is STILL the one drawn after a predecessor's arrives; the occupied-override probe asserting the host's answer did NOT overwrite a value the test itself put in the field; and `expect(launched).toEqual([])`, which is the negative case the Boundary names outright.
Own regression, caught by this task's own targeted verify and worth recording because it is the same one the sibling change made: waiting on `gitCalls("add")` in the migration test returned before the migration outcome the test also asserts on. `settleUntil` returns the instant its predicate holds, so a predicate that is not the LAST observable is a regression, not a fix. That predicate is now branch-aware, because the two arms of that test have different last observables.

Verify gate: check-types clean; 7639/7639 across 295 files; `biome check src` unchanged from this change's base.
