# Workflow State: prove-nobody-is-using-this-worktree

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork; worktree-removal.md § 4.1 names a source for every proof and the ladder for the one that needed it
- [x] `asm change validate` passes
- [x] Gate 2: plan approved (fastlane)

## Implement

- [ ] All tasks done (`tasks.md`)
- [ ] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-013.2`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full (standard) — three read-only proofs feeding the one irreversible action, and a shared registry reader four call sites depend on | flags: security-privacy
Planned at: dc157a11

Validator warning triaged and rejected: "Task 2_1 Plan names 9 files — split it". Six of the nine are test fixtures following one type rename (`ExternalSessionFact` → `SessionRecord`, gaining `alive`). A rename does not survive being split — the tree does not compile between the halves — so splitting it would trade a sizing heuristic for a broken intermediate commit. The three files carrying actual logic are `worktreeBlockers.ts`, `WorktreeHost.ts` and `extension.ts`.

Probed rather than assumed, before designing around them (git 2.50.1, the lesson from the previous change's round-1 B3): `git worktree lock` writes the `locked` file with or without a reason — zero bytes when there is none — so its presence tracks the lock and its mtime is the age; `merge-base --is-ancestor` exits 0 for merged, 1 for not, and 128 for a bad ref, so only the first two mean anything; `symbolic-ref --short refs/remotes/origin/HEAD` exits 128 when no origin HEAD exists; `rev-parse --verify --quiet refs/heads/<name>` exits 1 for absent and 0 for present.

Carried in from WT-013.1 round 5 and NOT folded into this change: an `lstat` that outlives its deadline is abandoned rather than cancelled, and nothing dedupes abandoned reads across assessments. The lock proof adds one bounded stat of one small file, and only when the worktree is locked, so it does not change that finding's mechanism — but it is one more read a stalled mount could strand. Fixing it would mint the invariant owner the finding needs, which is a change of its own. It stays open and unwaived.

Blueprint extension to carry at sync: `worktree-removal.md` § 4.1 leaves the `notApplicable` column blank for `branchMerged`, which the code cannot honour — a detached or bare worktree has no branch for the question to be about, and `unproven` would claim a comparison was attempted (design.md D5).

Ordering deviation on 1_2: I staged and committed the task before its tick, in the same shell block as the verify that was still failing. The verify then failed on the suite guard — `runningSessions.test.ts`, which is 1_1's committed addition, since the comparison runs against the change baseline and not the previous task's commit — so nothing unverified reached the tree, but the commit did land ahead of the evidence. The tick and its rationale are recorded now, and the commit is unchanged. Run the verify to completion before staging.
