# Workflow State: own-the-enrichment-an-envelope-actually-got

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [ ] `asm change validate` passes
- [ ] Gate 2: plan approved

## Implement

- [ ] All tasks done (`tasks.md`)
- [ ] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
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
Planned at: 0ed037f0

Lane: full — the projector/host seam WT-011.7 left un-owned
Planned at: 0ed037f0

Build notes:
- D1's clear had to move during build, and the design now says so. Clearing the obligation where the
  envelope's enrichment is RECORDED does not work: the cut-short projection publishes after the edge,
  so it wipes the obligation the edge had just set. A run that STARTS after the edge is the one
  entitled to clear it, and no await separates that assignment from the run's synchronous prefix.
- 3 mutations, all killed: the obligation never recorded, recorded unconditionally, and never cleared.
  The unconditional one reproduces the 19-case blast radius that made this a separate change, plus the
  new guard case — 20 failures.
