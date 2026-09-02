# Workflow State: delete-a-branch-only-under-a-guard

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork; worktree-removal.md § 5 fixes the rules and the oracle settled the mechanism
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-013.3`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-013.3
Lane: full
Planned at: d88a68a3 (re-earned after the Git v2.50.1 holder-state correction; originally 50d298f6)
Escalation flags: security-privacy (from the PLAN row) — review is always recommended, never skipped.
Must-not: no force delete anywhere in this change; `git worktree remove` never touches the branch.
- FASTLANE handback: corrected D7/task 4_4 from `sequencer/todo` to Git v2.50.1's actual `rebase-merge/update-refs` three-line records; completed tasks 1_1, 1_2 and 2_1 remain closed. Task 2_2 and host wiring 3_2 now wait for corrected 4_4 so the weak porcelain-only guard is never user-reachable.
- FASTLANE oracle triage: accepted the admin-entry reconciliation and causal-test gaps, narrowed exact holder equivalence to Git's real rebase/bisect conditions, and made 3_2 depend on D10 task 4_3 as well as 4_4. No product scope changed.
- Verify lint exception: clean detached HEAD reproduces only pre-existing format failures in `src/agentHooks/AgentHookController.test.ts`, `src/agentHooks/install/ClaudeHookInstaller.test.ts`, and `src/cursor/CursorHookInstaller.test.ts`; this change touches none of them.
