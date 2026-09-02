# Workflow State: never-release-a-lock-a-pending-write-still-owns

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [x] Gate 1: direction approved _(user selected retained-lock fail-closed over indefinite wait or worker best-effort on 2026-09-02)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [-] Blueprint sync complete — no blueprint for this child change

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full (standard) — cross-process serialization and durable staged mutation | flags: cross-boundary, new-api-contract
Planned at: 702555af
- Blueprint: none is deliberate: this remediation-boundary child belongs to `allocate-and-name-ports-before-they-collide` (docs/PLAN.md WT-012.6), which remains PARKED and owns blueprint sync.
- Depends on `freeze-the-first-observed-worktree-before-writing`; the port publication tail consumes both directory authority and the mutation gate, so builds are serial.
- Reference check: cmux and t3code confirm staged atomic writes, ownership records, kill-and-wait child boundaries, and generation checks, but neither deadlines rename/link while proving no late mutation after release; the retained-lock gate is therefore the smallest safe construction.
- Plan attack: Oracle Opus challenged the artifacts through three correction passes; all 9 obligation rows finish `supported` or `n/a`, with no refuted or unresolved row.
- Verify gate: type check and 6,700 tests pass; lint's three clean-tree errors are pre-existing formatting failures in `src/agentHooks/AgentHookController.test.ts`, `src/agentHooks/install/ClaudeHookInstaller.test.ts`, and `src/cursor/CursorHookInstaller.test.ts`, outside this change.
- Review cycle 1 closed APPROVE in round 2 after F001-F005 were fixed across the deadline, cleanup, preview-authority, and retained-lock reporting boundaries.
