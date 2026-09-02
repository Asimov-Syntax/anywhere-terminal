# Workflow State: move-uncommitted-work-with-the-intent

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [x] Gate 1: direction approved — ship an indeterminate failure contract
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

Blueprint: docs/PLAN.md task WT-012.10
Lane: light
Planned at: eb1cca45
Gate 1 choice: ship `migrateChanges` with truthful indeterminate failure reporting; the user explicitly accepted that source restoration and single-report ownership cannot be guaranteed by the current Git API.
Accepted risk: another process can change source bytes or `.git` after the final host recheck and before VS Code stashes; execution-time work is authorized, observable drift becomes indeterminate. Owner: worktree subsystem. Reactivate on a transactional/typed `vscode.git` API or an observed source-substitution incident.
Verify lint: Biome 2.4.5 reported 3 pre-existing format errors in `src/agentHooks/AgentHookController.test.ts`, `src/agentHooks/install/ClaudeHookInstaller.test.ts`, and `src/cursor/CursorHookInstaller.test.ts`; this change does not touch them, while all migration-owned files pass check mode.
