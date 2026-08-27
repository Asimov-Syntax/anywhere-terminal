# Workflow State: launch-agent-in-worktree

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [x] Gate 1: direction approved _(only if a real fork; else `[-]`)_
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

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-005.3
Gate 1 (fastlane auto): prompt delivery — declare `promptDelivery`, build the argv path only, defer the pty writer (design.md D3). The blueprint asks for the pty fallback; no registry agent needs it.
Lane: full (standard) — new fresh-launch registry contract + host wiring + two entry paths (menu, create form) | flags: new-api-contract
Verify gate: lint's remaining findings are pre-existing and confined to files this change never touched (SnapshotPersistence.ts, fileTreeRpc.integration.test.ts, VaultService.customName.test.ts, two CSS files).
Oracle pass: 5 BLOCK / 1 WARN / 1 SUGGEST — 5 accepted, 2 accepted-modified (pty writer replaced by `canSeedPrompt` + a PLAN deferral; `openFailed` meaning broadened instead of renamed).
