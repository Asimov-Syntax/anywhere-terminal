// src/worktree/worktreeOrder.ts — Intra-group ordering for a repo's worktrees.
// See: docs/design/worktree-model.md § 3.4,
//      asimov/changes/enumerate-git-worktrees/design.md D4

import type { WorktreeInfo } from "./types";

/**
 * Activity ranking, owned by the presence projection (P4) rather than by this
 * listing. Higher is more recent; `undefined` means "no live pane".
 */
export type WorktreeActivityRank = (id: string) => number | undefined;

const MAIN = 0;
const ACTIVE = 1;
const REST = 2;

function bucketOf(worktree: WorktreeInfo, rank?: WorktreeActivityRank): number {
  if (worktree.kind === "main") {
    return MAIN;
  }
  return rank?.(worktree.id) === undefined ? REST : ACTIVE;
}

function compareStrings(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/**
 * Order a repository group. Every comparison ends in an `id` tie-break, so the
 * result never depends on the order git or the filesystem happened to produce.
 */
export function orderWorktrees(worktrees: readonly WorktreeInfo[], rank?: WorktreeActivityRank): WorktreeInfo[] {
  return [...worktrees].sort((a, b) => {
    const bucketA = bucketOf(a, rank);
    const bucketB = bucketOf(b, rank);
    if (bucketA !== bucketB) {
      return bucketA - bucketB;
    }

    const staleA = a.missing || a.prunable ? 1 : 0;
    const staleB = b.missing || b.prunable ? 1 : 0;
    if (staleA !== staleB) {
      return staleA - staleB;
    }

    if (bucketA === ACTIVE) {
      const rankA = rank?.(a.id) ?? 0;
      const rankB = rank?.(b.id) ?? 0;
      if (rankA !== rankB) {
        return rankB - rankA;
      }
    } else {
      const branchA = (a.branch ?? "").toLowerCase();
      const branchB = (b.branch ?? "").toLowerCase();
      const byBranch = compareStrings(branchA, branchB);
      if (byBranch !== 0) {
        return byBranch;
      }
    }

    return compareStrings(a.id, b.id);
  });
}
