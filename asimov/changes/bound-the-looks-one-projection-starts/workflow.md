# Workflow State: bound-the-looks-one-projection-starts

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
Lane: full
Planned at: f07afcb1

Blueprint: docs/PLAN.md task WT-011.7
Lane: full — the § 2.3 debt's second half; a new argument on an internal service seam and a changed enrichment shape
Planned at: f07afcb1

Stage-2 facts established against current code:
- `previewFromVault` (`src/worktree/presenceProjector.ts:494`) walks `Object.entries(rowsByWorktreeId)` and awaits each worktree's `Promise.all` before the next, so the fan-out is per worktree and the service's `outstanding` limit is never approached.
- The service's two bounds are `outstanding.size >= cap` and one look per session; `cap` defaults to `DEFAULT_PREVIEW_CACHE_CAP` (256) and is the ENTRY CACHE's size. § 2.3 names reusing it as the work bound as the debt itself.
- `preview` already answers from cache on two paths — inside `nextAt`, and when `outstanding` is full — so the behaviour D3 needs exists; what is missing is a way to ask for it.
- WT-011.5 landed in this file first: `Target` now has `gone`, and `confirmedAt` gates the store lookup. A cache-only ask must not advance either.
- The blueprint's option (a) was rejected rather than deferred — see design.md D1. Recorded here because a reader will otherwise wonder why the cheaper option was not taken.
