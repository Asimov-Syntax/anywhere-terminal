# Workflow State: move-uncommitted-work-with-the-intent

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [x] Gate 1: direction approved — ship an indeterminate failure contract
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

Blueprint: docs/PLAN.md task WT-012.10
Lane: light
Planned at: 65711861
Gate 1 choices: ship truthful indeterminate reporting; on 2026-09-02 the user selected best-effort path identity, explicitly accepting unobservable source, intermediate-component, and destination ABA intervals instead of native helpers or deferral.
Accepted risk: another process can transiently substitute source bytes/components/`.git` or destination between path-based observations and restore them before the next check; execution-time named-path work is authorized, observable drift becomes indeterminate. Owner: worktree subsystem. Reactivate on transactional/typed Git APIs, cross-platform handle-relative Node APIs, or an observed substitution incident.
Verify lint: Biome 2.4.5 reported 3 pre-existing format errors in `src/agentHooks/AgentHookController.test.ts`, `src/agentHooks/install/ClaudeHookInstaller.test.ts`, and `src/cursor/CursorHookInstaller.test.ts`; this change does not touch them, while all migration-owned files pass check mode.
Review handback: round 1 is superseded by the accepted best-effort ABA replan; D2/D4/D6/D8 and tasks 3_1–3_2 cover all five findings, including a usable-path-safe 1 MiB gitfile cap.
Verify test: the first exact full-unit run exited 1 amid the known assembly lane instability; an immediate exact rerun passed 288 files / 7250 tests.
Review handback: round 2 is superseded by the source-ownership replan; tasks 4_1–4_5 bind row selection to the pre-offer repository registration and normalized source for F006–F007, while non-gating performance warnings F008–F009 remain for approval-time disclosure.
Gate 2 fastlane: approved after the plan attack found every changed ledger claim supported.
Review handback: round 3 closed F006–F007 but accepted F010; replan the whole-tree cache merge so each fresh public generation resolves only to the registration from the same successful repository observation.
Gate 2 fastlane: approved after Oracle supported canonical current-root selection, same-record generation/registration lookup, repo-scoped follow-up refusal, and degraded sibling retention for F010.
Review extension: the user explicitly authorized adding review rounds for this FASTLANE cycle; round 4 may use the one-time extension after F010 is fixed.
