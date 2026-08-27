# Workflow State: cache-and-broadcast-worktree-tree

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
- [-] Review done — skipped by explicit user decision, despite the `new-api-contract` flag
- [x] Gate: implementation approved
- [x] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-001.2
Lane: full (standard) — window-scoped freshness plus a new host↔webview message family | flags: new-api-contract
Verify gate: `biome check src/` still reports pre-existing failures this change does not touch — `src/vault/VaultService.customName.test.ts` and the two webview CSS files. Run in check mode, never the repo's `pnpm run lint` auto-fix form.
A workspace-folder change requests a forced whole-tree rebuild: the folder set moved, so the cached tree is known wrong and the rate floor must not hold it back.
