# Workflow State: freeze-the-first-observed-worktree-before-writing

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [x] Gate 1: direction approved _(user selected first-observation freeze over disabling allocation on 2026-09-02)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full (standard) — shared filesystem authority crosses Git, provisioning, and port transactions | flags: security-privacy, new-api-contract
Planned at: 702555af
- Blueprint: none is deliberate: this remediation-boundary child belongs to `allocate-and-name-ports-before-they-collide` (docs/PLAN.md WT-012.6), which remains PARKED and owns blueprint sync.
- Reference check: cmux supplies descriptor-pinned `openat(O_NOFOLLOW)` traversal and ancestor-substitution witnesses; Node exposes no equivalent dirfd API, so this change reuses the attack schedules and fail-closed boundary rather than claiming the stronger mechanism.
- Plan attack: Oracle Opus challenged the artifacts through three correction passes; all 8 obligation rows finish `supported` or `n/a`, with no refuted or unresolved row.
- Verify baseline: Biome remains at the clean-tree 3 errors / 14 warnings / 1 info; the errors are unchanged formatting in `AgentHookController.test.ts`, `ClaudeHookInstaller.test.ts`, and `CursorHookInstaller.test.ts`, outside this change.
- Review: round 1 closed with 0 blockers; F001 was fixed in task 1_6. Accepted non-gating warnings F002/F003 remain for provisioning-budget coverage and bounded listing authorization fan-out; F004 remains a diagnostic suggestion.
