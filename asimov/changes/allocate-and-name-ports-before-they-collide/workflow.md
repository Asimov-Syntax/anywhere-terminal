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
Planned at: 042b4755af853ffdacf83e05cd3c7d5d12f0efea
Verify baseline: project Biome remains at 3 errors / 14 warnings / 1 info in src/agentHooks/AgentHookController.test.ts, src/agentHooks/install/ClaudeHookInstaller.test.ts, src/cursor/CursorHookInstaller.test.ts, and unrelated warning/info files; the clean baseline reproduces it, while all change-owned source files pass.
Review cycle 1 superseded at round 2 because remediation task 1_8 added an explicit Acceptance and Plan contract; fastlane re-approved that mechanical in-scope remediation at Gate 2.
Blocked at final review round 3: F001 requires create/listing-authorized component identities to cross into allocation; F003 requires a bounded mutation owner that cannot publish after timeout or lock release. Round 4 requires explicit user approval.
