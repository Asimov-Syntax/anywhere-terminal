# Workflow State: suggest-worktree-initialization

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(fastlane: no product fork)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved _(fastlane Approve & build; oracle dispositions triaged and applied)_

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(round 1 APPROVE, 0 blockers)_
- [x] Gate: implementation approved
- [-] Blueprint sync complete — no blueprint for this change

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full
Planned at: 90ad192e
Follow-up: `recommend-setup-before-agent` — recommend waiting when agent and setup are selected, preserve explicit overlap, and explain the order; mechanically split because it owns dialog sequencing preference rather than suggestion evidence.
Fastlane decision: when several package-manager lockfiles exist, offer one unchecked static command per manager instead of inventing precedence.
Oracle triage: rows 2–3 supported; row 1 unresolved → accepted, D1 now requires a typed `lstat` at the `readProvisioning` seam with three-state integration witnesses; row 4 refuted (suppress-vs-reoffer contradiction) → accepted, spec amended so suggestions exist only while no provisioning source exists — after Save the native config governs and no fallback (setup included) returns.
Verify gate: lint's one remaining error is a pre-existing format diagnostic in `src/agentHooks/AgentHookController.test.ts`, which this change does not touch; reproduced on a clean detached worktree at the change's base.
Fastlane decision: post-save total suppression chosen over re-offering setup beside a saved source — re-offering would grant fallback authority over a present source, which the proposal's must-nots forbid.
