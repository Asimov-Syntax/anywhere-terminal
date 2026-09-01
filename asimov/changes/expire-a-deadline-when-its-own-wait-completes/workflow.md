# Workflow State: expire-a-deadline-when-its-own-wait-completes

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-011.11`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-011.11
Lane: light
Planned at: 86435782
Lane: light — XS, one primitive, no caller changes
- Design triggered by the ledger rule, not by size: two accepted requirements (`P1` synchronous truth, `P2` truth after the wait) constrain the one `expired` observable, so design.md shows the construction satisfying both rather than naming a winner.
- Specs are NO-DELTA: the disagreement is between two internal clocks and no external behavior or mandated constraint moves.
- Plan attack run before Gate 2. It refuted three ledger rows and one design justification, and the artifacts were rewritten rather than argued: the wall-clock arm is NOT monotone (a backwards clock step can retract it), so `expired` latches on read; the `ms` domain was undefined, so a `NaN`/`Infinity`/`2**31` input had `at` saying never while Node clamped the timer to 1 ms — both clocks now derive from one normalized value; the "no caller depends on the old window" row was written from the import list rather than the reads, and three of the four cited callers never read the getter at all; and D1's claim that a `.then` alternative would be registration-order unsafe was wrong, so the justification is withdrawn while the callback is kept for the simpler reason.
- The attack's NO-DELTA refutation is REBUTTED, with the reasoning recorded in specs/NO-DELTA.md rather than left implicit. Flag it at review.
- The attack also refuted the test plan as probabilistic; the deterministic construction it proposed (pin `Date.now`, stub `setTimeout`, fire the captured callback before `at`) is adopted, and the existing 1 ms and 0 ms tests are kept as the independent arms.
- Gate 2 taken under fastlane on the standing goal, with the user away.
