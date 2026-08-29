# Workflow State: separate-presence-subscription-from-view-visibility

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no real fork: the level-vs-second-boolean call is recorded as D1
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
Lane: full — MEDIUM risk: changes a webview/host protocol field and the projection's work set | flags: re-review (this seam was rejected once already)
Planned at: 8d1d7d72

- Origin: handback from collapse-the-rail-after-a-sidebar-selection round-2 B4. That change owes
  "the escape control survives a collapsed rail" and cannot archive until this lands; it is
  recorded there as a dependency.
- Scope boundary: the preview service's own freshness and rate policy is NOT touched. Enrichment
  is skipped when nobody draws rows; when somebody does it behaves exactly as today. Whether that
  resolution-and-rate seam should be extracted remains open and is not decided here.
