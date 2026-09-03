# Discovery: move-uncommitted-work-with-the-intent

## Context

WT-012.10 requires the built-in Git extension's `migrateChanges` call, source restoration on every failed move, and one truthful failure report. The shipped VS Code 1.130 implementation cannot jointly provide those guarantees: it returns `void`, exposes no stash identity or typed "already reported" result, creates the source stash before entering its recovery `try`, and can reject after showing a conflict warning when restoring the source also fails.

The plan attack also found independently solvable defects: the source row identity was discarded, Git-extension status arrays are capped by `git.statusLimit`, passive destination discovery never opens an out-of-workspace sibling, and reattach/adopt do not pass through the new-checkout sequencing seam.

## Options

### Option A — Wait for a transactional API

Keep the accepted guarantee and the `migrateChanges` scope constraint, but do not ship the move row until VS Code exposes a structured result with reliable source restoration. Safest, but WT-012.10 remains blocked on upstream behavior.

### Option B — Ship an indeterminate failure contract (Recommended)

Keep `migrateChanges` and deliver the feature now, but restate failure honestly: a rejected move can leave changes stashed or partially applied, and a recovery failure can produce both the Git extension's warning and ours. The worktree still stands and the notice names the state as potentially partial rather than claiming restoration.

### Option C — Own migration and recovery

Replace `migrateChanges` with a caller-owned copy/cleanup transaction that keeps source evidence until destination application is proven. This preserves stronger behavior but contradicts the blueprint's reuse constraint and expands the task from a small integration into a destructive Git transaction requiring its own invariant owner and change.

## Reuse — existing code to build on

- `API.openRepository(Uri)` in the built-in Git extension actively opens the exact source and destination; no passive event wait is needed.
- `GitCommandRunner` in `src/worktree/gitCommandRunner.ts` provides bounded porcelain reads.
- Opening identity and retirement in `src/providers/WorktreeHost.ts` can bind a host-issued migration offer.
- `afterDelay` in `src/worktree/deadline.ts` supplies the shared post-create deadline pattern.
- The independent `applyPorts` seam in `src/worktree/worktreeMutationService.ts` provides the post-create binding shape.

## Key Findings

Use an explicit `sourceWorktreeId`: row-context creates retain the clicked row; repository and toolbar entry points have no unique source and offer nothing. Bind it through the final pre-call check with authorized directory components plus `.git` identity, content, resolved target, and admin identity, not the cache generation that every forced rebuild advances. Build a bounded snapshot from `git status --porcelain=v2 -z --untracked-files=all` and streamed hashes of affected path state; keep rename origins even though the form counts each record once. Unresolved merges are ineligible.

Carry a cryptographically random host-issued offer id so a checked row redeems only the source evidence and snapshot delivered; replacement resets consent. Open exact source and destination repositories under a 10-second deadline. Offer only for `fresh`, `fresh-detached`, and `reuse`; reattach/adopt are surviving directories. Nested destinations are excluded before the final snapshot check and API call. A moved result needs empty source plus the exact non-conflicted destination snapshot; every other state stops provisioning and launch as indeterminate. The user accepted that work or `.git` changed after the last check may enter the Git API operation; the row states execution-time scope and observed drift becomes indeterminate.

## Gap Analysis

| Component | Have | Need | Gap |
|---|---|---|---|
| Source identity | Create row collapses to `repoId` | Source directory and `.git` incarnation through execution | Wire, authorization evidence and offer record |
| Count and state | Git-extension arrays capped by `git.statusLimit` | Bounded exact source snapshot | Porcelain parser plus streamed path-state hashes |
| Destination | Passive repository event | Deterministic open | `API.openRepository` adapter |
| Failure | `void` or untyped rejection | Truthful potentially-partial outcome | User chose indeterminate reporting at Gate 1 |
