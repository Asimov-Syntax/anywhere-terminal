# Workflow State: bind-a-result-to-the-form-that-asked

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

Blueprint: docs/PLAN.md task WT-012.16
Lane: full (M) — new-api-contract, cross-boundary | flags: new-api-contract, cross-boundary

Auto-decision (fastlane): no real fork. The panel already mints a per-opening token and three
messages already echo it, so extending that identity is reuse rather than a choice between designs
(D1). The alternative — a second id owned by the create form — was rejected without asking, because
two staleness rules on one form is the defect this change removes.

Planned at: 9f261154

2_2: D5's eviction (`offers.forgetSurface` on close) has no behavioural witness in the host suite —
`offers.lookup` still has no caller in `src/`, so nothing redeems an offer id yet (WT-012.2 owns the
first redeemer). The retirement's two other effects are witnessed and mutation-verified; the eviction
rests on `offerStore.test.ts`'s own `forgetSurface` coverage until a redeemer exists.
