# Workflow State: enumerate-git-worktrees

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
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [x] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-001.1
Lane: full (standard) — new worktree module whose data model 5 other design docs consume | flags: new-dependency
Note: PLAN.md's `Design Ref` cites DESIGN.md § 13–15; the synced DESIGN.md numbers them § 8–10. Content matches; the section numbers drifted.
Note: PLAN.md's Notes row says "first direct shelling to `git`" — `src/providers/gitIgnoreChecker.ts:40` already spawns `git check-ignore`. Flag kept anyway: this is the first *structured* git read, with parsing, capability fallback and a version floor.
Note: § 3.5/§ 3.6 (watchers, cache) and last-good retention belong to WT-001.2 — this change degrades with a reason but holds no cache to fall back to.
Note: no Gate 1 fork — worktree-model.md settles direction; repo-local calls are D1–D8 in design.md.
Note: orca's git layer studied 2026-08-26 → docs/research/20260826-orca-git-worktree-mechanics.md. D2 deviates from worktree-model.md § 3.6 (30-min capability expiry, not process-forever) — user chose 2026-08-26: match orca.
Note: enabling work (user-approved 2026-08-26) — repaired a pre-existing suite flake blocking every verify: fileTreeHost.test.ts single-tick waits (16 sites) + two 1 s read-directory poll budgets. Proven independent of this change (src/worktree/** excluded still failed 1-3 tests per loaded run). Now condition-based with a 5 s deadline; 3/3 clean under load.
Note: review capped at 2 rounds by the user (2026-08-26). Round 1: 2 BLOCK + 5 WARN, all accepted, none rebutted, fixed in task 4_1. Round 2: 1 BLOCK + 1 WARN, both gaps in round 1's own fixes, accepted and fixed in task 5_1. Zero findings outstanding at the cap; no round 3 was run.
Note: R2-B1 settled the decoding policy the model docs did not state — only the worktree path decodes strictly, because `id` is derived from it; `HEAD`, `branch` and lock/prunable reasons decode leniently so a bad label cannot delete a real worktree.
Note: patterns.md admission run on orca's `GitCapabilityCache` — rejected at test 1 (2 capabilities, no growth axis); D8 records what would earn it later.
