# Workflow State: allocate-and-name-ports-before-they-collide

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(no product fork — accepted retention and collision rules compose by failing, not replacing, a conflicting existing assignment)_
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

Blueprint: docs/PLAN.md task WT-012.6
Lane: full (standard) — cross-process allocation mutates shared repository state and a worktree-local claim file | flags: cross-boundary
Reference check: orca, cmux and t3code contain no reusable Node port-claim allocator; this repo's existing LockedFile owns the reusable lock and staged-write semantics.
Planned at: 1f4819b7497b5a226485dbd046c480f411254021
Verify baseline: project Biome remains at 3 errors / 14 warnings / 1 info in src/agentHooks/AgentHookController.test.ts, src/agentHooks/install/ClaudeHookInstaller.test.ts, src/cursor/CursorHookInstaller.test.ts, and unrelated warning/info files; the clean baseline reproduces it, while all 24 change-owned source files pass.
