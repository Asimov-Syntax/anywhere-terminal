# Workflow State: land-one-wire-contract-for-create-and-removal

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [ ] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [ ] All tasks done (`tasks.md`)
- [ ] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-012.0
Lane: full (M) — a contract every Phase 12 and Phase 13 task reads | flags: new-api-contract, cross-boundary
Direction (fastlane, no fork): the blueprint's own Acceptance settles both candidate forks — the union travels unflattened to the mutation service, and the legacy boolean blocker record is deleted rather than kept beside the check model.
Planned at: 31abec81
Scope note: `notApplicable` and `BranchDeleteOffer` land on the wire with no producer. The sources that answer "the question does not arise", the merge proof, and the orphan proofs are WT-013.1 / WT-013.2 / WT-013.3.
Serialization: every task shares `src/types/messages.ts` or `src/worktree/worktreeMutationService.ts`, so the wave plan is fully serial by design rather than by omission.
Deviation (1_1): rpc § 2.6 sketched the `agent` after-create variant as `{ agentId, permissionChoiceId, prompt?, waitForSetup }`, which drops the `offerId` and `generation` staleness guards `WorktreeAgentLaunchFields` already ships and which are refused when absent. The variant embeds that interface instead, and § 2.6 was corrected in the same task to say so — a contract task must not narrow a shipped refusal.
Handback (during 1_2, before any edit): the accepted D2 said the dialog produces two modes and put `reuse` out of scope. It already produces three, and the wire cannot carry which — `sourceOf` guesses `existingBranch` whenever `baseRef` is absent, so a new-branch create with a blank base ref runs `git worktree add <path> <branch>` against a branch that does not exist and git answers `fatal: invalid reference`. Verified against git 2.50 directly. D2, the proposal and 1_2 were corrected and `specs/NO-DELTA.md` was replaced by a `worktree-panel` delta; Gate 2 was reopened and re-earned.
User decision (not fastlane's to take): record the repair as a spec delta rather than a Notes line, and land `reuse` here while WT-012.8 keeps its guards.
Deviation (1_2): Plan step 3 — "derive the path slug from the mode" — was written when D2 still said the dialog produced two modes. With three, `detached ? draft.baseRef : draft.branchName` already IS the mode distinction: `fresh-detached` carries no branch, and `fresh` and `reuse` both carry one. `WorktreeCreateDialog.ts` is left unchanged rather than rewritten to say the same thing differently.
