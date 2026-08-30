# Workflow State: own-the-enrichment-an-envelope-actually-got

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved  <!-- re-earned after cycle 1 round 1 -->

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-011.10`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-011.10
Lane: full
Planned at: a3c68513

Lane: full — the projector/host seam WT-011.7 left un-owned
Planned at: a3c68513

Build notes:
- D1's clear moved twice. Recording-point and run-start are both wrong and both are now written up as
  rejected in D1a; the third placement is the pass. Do not try either again.
- 3 mutations, all killed: the obligation never recorded, recorded unconditionally, and never cleared.
  The unconditional one reproduces the 19-case blast radius that made this a separate change, plus the
  new guard case — 20 failures.
- Post-handback: 2 more mutations killed — moving the clear back to the run start fails the joined
  reopening case, dropping the catch restore fails the rejecting-projection case. A third SURVIVES and
  is left in deliberately: dropping the `anyDrawingRows()` gate on the clear changes nothing any test
  can see, because a non-enriching pass that completes records `projectedEnriched = false` and the
  owed predicate's other disjunct catches it. The guard covers a pass that clears and never records
  (invalidated, disposed), which the self-healing forced rerun already handles — defence in depth, and
  labelled as such in the code rather than claimed as covered.
