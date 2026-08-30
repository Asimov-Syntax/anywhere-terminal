# Workflow State: offer-every-ref-in-one-box

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no real fork; § 4.1 settles the one-list shape and the rejected tabs are on the record
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

Blueprint: docs/PLAN.md task WT-012.7
Lane: full — user-visible-ui; new wire pair; the lead input every other control is positioned against
Planned at: 2e03cdd2
Fastlane note: Gate 2 auto-approved; validate ended 0 errors / 0 warnings.
Fastlane note: no peer review at Gate 2 — the risk is in the webview keyboard contract, which build's own tests and the review round cover better than an artifact read.
Fastlane note: WT-013.1 round-5's abandoned-read finding is untouched — this change adds no filesystem read, only a bounded git invocation on the create path.
