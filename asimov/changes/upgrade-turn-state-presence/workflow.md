# Workflow State: upgrade-turn-state-presence

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
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-006.3`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-006.3
Lane: full
Blueprint: docs/PLAN.md task WT-006.3
Lane: full (standard) — cross-boundary (hook transport → reducer → pane evidence → presence projection → panel), MEDIUM/HIGH risk: the acceptance row is a list of truthfulness guards | flags: none
Gate 1 (fastlane auto): duplicate containment. Rejected minting an event id in the wrapper (the research's recommendation) — it would change the installed script and the ledger's ownership comparison, both owned by an in-flight change in another session, to replace a transport layer that already works. design.md D1.
Sequencing: `src/extension.ts` is being rewritten by the WORKTREE-PHASE6 session (its activation-wiring task). Agreed with that session: everything else builds behind the seam, task 4_1 waits for their task to land, then this branch rebases. `AgentHookController.ts` and `src/agentHooks/install/*` are theirs and are untouched here.
Verify gate: project.md defines Lint as `biome check --write --unsafe`, so running it rewrote `ASCII_FRAME` in src/webview/worktree/worktreeFormat.ts (a file outside this change), dropping `\\` from the character class and with it the backslash spinner frame. Reverted; the gate was then observed with `biome check src/` (exit 0, 13 pre-existing CSS specificity warnings).
Verify gate (round 1 fixes): tsc exit 0; `biome check src/` exit 0 (13 pre-existing CSS warnings + a pre-existing `noUselessEscapeInRegex` warning on src/webview/worktree/worktreeFormat.ts:23, identical at HEAD~1 and untouched by this change — its FIXABLE suggestion is the unsafe rewrite noted above and must not be applied); test:unit 4685 pass / 0 fail.
Flake, recorded not hidden: src/extension.worktreeAssembly.test.ts intermittently fails 2-3 of its worktree create/launch/resume cases with `PTY_LOAD_FAILED` when the whole suite runs. Seen three times this change (two verify-task retries, once at the round-2 gate); each time it passes alone and on re-run, and the cases sit in menu/pty territory this change never touches. Not diagnosed here — flagged as pre-existing suite instability worth its own change.
