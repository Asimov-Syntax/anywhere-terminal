# Workflow State: stop-wasted-worktree-renders

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [ ] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [x] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-003.2
Lane: full (standard) — spans two providers, the window host, and the webview render key | flags: none
Gate 1: scope B — the falling edge plus the coverage proof. Option A (guard only) was withdrawn mid-briefing: the guard is already wired at WorktreeView.ts:155 and its key already covers every WorktreeViewData field, which I had reported otherwise. BSD grep treats that file as binary and returned no matches; `grep -a` shows them.
Out of scope, deliberate: the watches are NOT torn down while every surface is hidden. Keeping the cache warm is what makes D3's serve-from-cache correct.
Deviation from design.md D3: the re-show serve fires on the display edge only, not on both inputs. A webview declaring the view visible already sends a tree request behind it, so serving that edge too posts twice — caught by three existing tests. The spec's own scenario is the display edge, so the requirement still holds.
Review: round 1 by asm-review-master (2 BLOCK, 1 WARN), all fixed in task 4_1. B1 accepted on narrower grounds than reported — neither field has a reader today, so it was a Phase-4 trap rather than the live staleness bug the finding described; recorded in .reviews/round-1.md. Re-review waived by the user at approval, so that reframing stands unadjudicated. Not taken: resolving rows by stable identity instead of closing over wire objects, which would make B1's class structurally impossible — a refactor of the interaction layer this change does not own.
