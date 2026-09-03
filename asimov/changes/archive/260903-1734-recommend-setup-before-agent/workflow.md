# Workflow State: recommend-setup-before-agent

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved _(fastlane; split declared by suggest-worktree-initialization)_

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [-] Review done — one localized webview default plus its hint, no escalation flag, 7603/7603 with seven new witnesses covering every arm of the choice
- [x] Gate: implementation approved _(fastlane)_
- [-] Blueprint sync complete — no blueprint for this change
Verify gate: lint's one error is the pre-existing format diagnostic in `src/agentHooks/AgentHookController.test.ts`, untouched here.
Validate warning triaged (rejected): the long requirement is the inherited four-bullet contract from the accepted spec, not new fusion; the added sequencing rule was split into its own requirement.
Must not: change the wire meaning of `waitForSetup`, the host's execution order, or a setup row's own default-unchecked state; never silently re-gate a user who asked for overlap.`)_

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Verify gate: lint's one error is the pre-existing format diagnostic in `src/agentHooks/AgentHookController.test.ts`, untouched here.
Validate warning triaged (rejected): the long requirement is the inherited four-bullet contract from the accepted spec, not new fusion; the added sequencing rule was split into its own requirement.
Must not: change the wire meaning of `waitForSetup`, the host's execution order, or a setup row's own default-unchecked state; never silently re-gate a user who asked for overlap.
Lane: light
Planned at: 087697ff
