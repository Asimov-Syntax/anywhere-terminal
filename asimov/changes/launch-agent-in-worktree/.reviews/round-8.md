# Review Round 8

- Date: 2026-08-27
- Cycle: 3
- Round: 8
- Mode: superseded
- Scope: commit `711c9cfae902a35a8a6f68eb8c5d92f566db70c2` only
- Head: `711c9cfae902a35a8a6f68eb8c5d92f566db70c2`
- Parent / prior reviewed Head: `c341fd8bf8a92b3abfa4fc5d2d877a4f3ddede91`
- Change context: `launch-agent-in-worktree` — the existing Gate 2 approval covers D10/D11's launch boundary, not the new destructive-removal boundary introduced here
- Reviewable lines: 208 added lines across reviewable production/state files; tests were classified but not adjudicated after scope lock failure
- Scope lock: failed
- Verdict: SUPERSEDED — no finding adjudication performed
- Counts: not adjudicated; round-7 gate set remains open
- Agents started before the semantic design change was isolated:
  - asm-review-logic — B5/W8/W6 remediation and removal impact cone — `gpt-5.6-sol[1M]`
  - asm-review-contracts — degradation and removal contracts — `gpt-5.6-terra[1M]`
  - asm-review-frontend — menu identity capture — `sonnet[1M]`
- Specialist reports were not used or adjudicated after the scope lock failed.
- Verification evidence: the author reports type check clean, 4,390 tests passing, 10 pre-existing Biome findings in untouched files, and `bun run asm change verify-status launch-agent-in-worktree` exiting 0. No project type check, lint, or test command was run during review.

## Supersession reason

Commit `711c9cf` contains the expected remediation for round-7 B5, W8, and W6, but it also makes a
new semantic decision about destructive removal that round 7 did not approve:

- Round-7 W8 required listing failure and watcher failure to remain distinct so disclosure stays
  truthful while D11's **launch** authority remains intact.
- The commit additionally changes `mutationBindings.isDegraded` and removal assessment's
  `listingDegraded` from the published degradation claim to `repo.generation === undefined`.
  The amended design now explicitly states that an unestablished watcher no longer vetoes a
  removal.
- Whether a repository that cannot be watched may authorize a destructive removal is a separate
  boundary from whether it may authorize a launch. Round 7 neither identified nor accepted that
  behavior change; the author explicitly describes it as something the fix surfaced afterwards.
- The new predicate also requires an explicit decision for global git state. Launch admission
  checks both `tree.gitAvailable` and the registration token, while the two changed removal readers
  check only the token. `WorktreeCache` supports `gitAvailable: false` with a newly published
  generation after a repo-local apply, so “the same predicate launch admission uses” is not yet a
  complete contract for removal.

That is non-remediation semantic design work inside a verification diff. Under the verification
scope lock, this cycle cannot decide whether the broader removal authorization is correct. The
change must return to Gate 2 to state the removal boundary explicitly, including unwatched repos,
global git unavailability, pre-removal assessment, and post-attempt classification. The next
user-initiated review then starts cycle 4, round 9, in discovery mode and reviews that decision and
its implementation end to end.

## Gate set carried forward without adjudication

- B5 — Resume Here freezes registration identity at the rendered menu boundary — accepted in round 7; not verified here.
- W8 — listing and watcher degradation remain independent and truthful across rebuilds — accepted in round 7; not verified here because the fix also changes removal authority.
- W6 — exact Resume, sibling-repository, and watcher-less boundary coverage — accepted in round 7; not verified here.

## Audit backlog carried forward

- S1 — Continue and worktree dialogs maintain parallel modal lifecycles.
- AB1 — the prune dialog remains outside `closeDialog` ownership.
- AB2 — entry-backed Continue ignores an explicit posture for a zero-choice agent.
