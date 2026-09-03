# Workflow State: calm-the-create-chrome-and-name-its-terms

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
- [-] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [-] Blueprint sync complete — no blueprint for this change

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: light
Planned at: a304c7e5

Must not: change what either secondary action does when pressed, add a control, or move a default. Presentation only — no wire message, no host authority.
Fastlane decision: no obligation ledger — the change touches no mutable resource beyond the rendered DOM, so no plan attack was required.
Verify gate: the one biome error is `src/agentHooks/AgentHookController.test.ts` formatting, untouched by this change and present at its base; warnings went 15 → 14 because the one this change introduced was fixed.
Review skipped: presentation-only, no wire message, no host authority, no escalation flag, and every rule and explanation carries a witness.
Follow-up (not this change): `src/cursor/CursorHookInstaller.test.ts:970` accepts only EPIPE/ERR_STREAM_DESTROYED for a deliberately closed stdin, but Darwin's socket-backed stdin also yields ENOTCONN — an under-specified assertion that fails the gate under load.
