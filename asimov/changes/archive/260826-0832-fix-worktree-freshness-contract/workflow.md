# Workflow State: fix-worktree-freshness-contract

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [x] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [ ] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [-] Blueprint sync complete — `Blueprint: none`, so there is no PLAN task or blueprint section to sync

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Source: docs/audit/2026-08-26-worktree-tree-review.md findings A1, A2, A3, B2; blocks docs/PLAN.md WT-004.0
Lane: full (standard) — cache, gate, watch set and one view branch, across three external capabilities | flags: new-api-contract, user-visible-ui
Gate 1: A2's retention is unobservable at the cache boundary (WorktreeView.ts:361-364 returns the gitMissing empty state before the repo branch), so the view change is in scope and the worktree-panel delta with it. Watch recursion fixed here rather than deferred to the audit's C-group.
Review: REQUIRED by explicit user instruction — this change exists because review was skipped on e650810. Do not mark `[-]`.
Test-first is a gate, not cleanup: tasks 2_2, 3_1, 4_1 each rewrite an assertion that currently pins the defect, and 2_1 one that asserts at the wrong depth. A rewrite that never went red is a defect in that task.
Deferred out: audit B1 (visibility falling edge) and the remaining `5fd32ec` warnings → WT-003.2.
Spec correction found in discovery: worktreeWatchTargets.ts:20-22 claims a watcher cannot see a non-existent directory appear; @types/vscode/index.d.ts:13861-13863 states the opposite, which is what makes D5's rebasing cheap.
Verify gate: `biome check src/` exits 0 — 13 warnings, matching the baseline recorded by add-worktree-panel-shell, all in files this change does not touch. An earlier note here called the noCommaOperator diagnostic in src/vault/VaultService.customName.test.ts an error; it is a warning, and lint is clean.
Review: round 1 run by asm-review-master (1 BLOCK, 2 WARN, 2 SUGGEST). All accepted findings fixed in task 6_1; W2's second half rebutted (merging degradation sources buys an older second cause at the price of unbounded reason accumulation or a source-tracking structure nothing requires). Re-review waived by the user at approval, so that rebuttal stands unadjudicated — recorded in .reviews/round-1.md.
