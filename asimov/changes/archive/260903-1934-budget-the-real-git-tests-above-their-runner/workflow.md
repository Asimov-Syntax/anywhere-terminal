# Workflow State: budget-the-real-git-tests-above-their-runner

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
- [-] Review done — two timeout arguments in one test file, no production change, no escalation flag; the bound and its justification came from an independent second opinion
- [x] Gate: implementation approved
- [-] Blueprint sync complete — `Blueprint: none` _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: light
Planned at: 183833de

Blueprint: none
Lane: light
Must not: change production code, weaken an assertion, or raise the suite-wide timeout.
Why now: `src/worktree/deleteBranch.test.ts:187` spawns eight synchronous git processes and then awaits `deleteBranch`, on vitest's default 5000 ms per-test budget — while `gitCommandRunner` allows any SINGLE command 10 s (`gitCommandRunner.ts:9-10`). The test therefore cannot outlive its own runner's patience, and under a loaded machine it times out before the code under test has had the time that code is allowed to take. It failed the verify of three unrelated changes on 2026-09-04 and is green in isolation and on a clean tree, so the budget is the defect, not the code.
Scope: the two tests in this file that build a real repository. The rest use a fake runner and spawn nothing, so they keep the default budget — a blanket file-level timeout would hide a genuine hang in those.
Rejected: raising the suite-wide `testTimeout`. It would grant the budget to ~7600 tests that do not need it and would turn a real hang anywhere in the suite into a slow pass.

Verify gate: check-types clean; 7639/7639 across 295 files; `biome check src` unchanged from this change's base.
