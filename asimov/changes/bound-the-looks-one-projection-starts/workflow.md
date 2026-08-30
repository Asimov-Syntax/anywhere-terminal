# Workflow State: bound-the-looks-one-projection-starts

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
Planned at: 317c54e7

Blueprint: docs/PLAN.md task WT-011.7
Lane: full — the § 2.3 debt's second half; a new argument on an internal service seam and a changed enrichment shape
Planned at: f07afcb1

Stage-2 facts established against current code:
- `previewFromVault` (`src/worktree/presenceProjector.ts:494`) walks `Object.entries(rowsByWorktreeId)` and awaits each worktree's `Promise.all` before the next, so the fan-out is per worktree and the service's `outstanding` limit is never approached.
- The service's two bounds are `outstanding.size >= cap` and one look per session; `cap` defaults to `DEFAULT_PREVIEW_CACHE_CAP` (256) and is the ENTRY CACHE's size. § 2.3 names reusing it as the work bound as the debt itself.
- `preview` already answers from cache on two paths — inside `nextAt`, and when `outstanding` is full — so the behaviour D3 needs exists; what is missing is a way to ask for it.
- WT-011.5 landed in this file first: `Target` now has `gone`, and `confirmedAt` gates the store lookup. A cache-only ask must not advance either.
- The blueprint's option (a) was rejected rather than deferred — see design.md D1. Recorded here because a reader will otherwise wonder why the cheaper option was not taken.

Build notes:
- Mutation testing: 7 mutations across both tasks, 6 killed on the first pass. M11 (a cache-only ask not touching the LRU) survived because the test that claimed to prove it never exceeded the cap, so nothing was ever evicted; rewritten to force the eviction it asserts against, and it dies.
- `verify-task` on 1_1 failed once and passed on the retry with the identical tree; `check-types` and `test:unit` both passed standalone in between. Not diagnosed — recorded rather than explained away.
- Round-1 handback: B2 accepted and NOT fixed as remediation. Retention is decided by whoever knows which rows are drawn, and `held`'s own comment says the service caps because the projector had no alive set to evict by — a premise D2 removed. Restating it is a decision (D5), so Gate 2 was re-earned rather than patched. B1 rides along as D7; W1 and S1 sit inside their cone.
- Round-1 plan (fastlane): D5/D6/D7 chosen over the review's suggested "retain preview text separately", which mints a second lifetime to keep in sync. Replacing an approximate eviction rule with an exact one adds no store; the growth axis it accepts is bounded by rows the projector already holds in full. `mayLook` (D3, task 1_1) does not survive — nothing else passed `false`, and its touch was bookkeeping for the rule D5 replaces. Recorded because a reader will otherwise read 2_1 as undoing a verified task rather than superseding it.
- 2_1 and 2_2 merged at build: removing `mayLook` breaks `extension.ts` in the same commit that removes it, so a service-only task cannot leave the tree type-checking. One seam, one task — the split was a planning error, not a scope change.
- Round-1 build: D7's queue needed one correction the design did not anticipate — dropping a departed id loses its waiting position, so a row drawn every OTHER projection re-entered behind the row being served and starved exactly as the index cursor did. Ids now keep their place while absent, and the order is bounded by `drawn + budget`, pruned from the back and only where the id is not drawn.
- Mutation testing: 9 mutations across the service and the projector, 7 killed on the first pass. M19 (`line` clearing the ladder and the confirmation stamp) survived because the case read the line while already overdue; M21 (pruning without checking `drawn`) survived because no case put a drawn row at the back of an over-long order. Both now have cases that separate them.
- Round-3 STALL (thrash stop, cycle 2). B1 and B2 both fall outside the remediation boundary, so no
  fix round can close them: B1's spec sentence ("No row SHALL be excluded on every projection while
  others are looked at repeatedly") cannot be satisfied with bounded state against unbounded identity
  churn — a bounded order must forget an absent id, and cannot then distinguish its return from an
  arrival. Both fix attempts implemented an impossibility, each starving the population the other
  served. B2 needs the exclusion/timeout order, the `preview()` finalizer's re-seat, and the
  generation-mismatch return path changed together; dropping the `outstanding` fallback alone leaves
  `touch()` restoring the stale line. Awaiting the user's choice between reverting to `todo` and a
  handback that narrows both promises; no code moved and nothing is ticked. See .reviews/round-3.md
  § Author re-triage.
