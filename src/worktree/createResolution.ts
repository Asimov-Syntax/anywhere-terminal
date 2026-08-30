// src/worktree/createResolution.ts — What a typed selection would actually do.
// See: asimov/changes/resolve-a-selection-before-the-create-runs/design.md D2, D3, D4
//      docs/design/worktree-create.md § 2, § 2.0, § 2.3

import type { DestinationDisposition, ResolvedDisposition } from "../types/messages";
import type { WorktreeRef } from "./repoRefs";

export type { ResolvedDisposition };

/** The fields of a `WorktreeInfo` that answer "what holds this branch?". */
export interface ResolutionWorktree {
  displayPath: string;
  bare: boolean;
  detached: boolean;
  branch?: string;
  /** git's own flag: the administrative entry survives but its path is wrong. */
  prunable: boolean;
}

export interface SelectionFacts {
  /** The branch name as typed. Untrimmed — trimming is this module's rule. */
  query: string;
  /** This repository's local branches, from the enumeration the dialog holds. */
  refs: readonly WorktreeRef[];
  /** Every registered worktree of the same repository. */
  worktrees: readonly ResolutionWorktree[];
}

/**
 * `reattachCandidate` is deliberately not `reattach`.
 *
 * `prunable` is a claim git makes about its own bookkeeping, and it is not
 * enough to offer a repair: the directory has to still hold a link to an
 * administrative directory that exists, and its HEAD has to still match the
 * branch. Those are filesystem and ref reads, they belong to the corroborating
 * probe, and naming this a candidate is what keeps a claim from reading as an
 * answer (design.md D3).
 */
export type SelectionMode =
  | { kind: "none" }
  | { kind: "fresh" }
  | { kind: "reuse" }
  | { kind: "reattachCandidate"; repairPath: string };

export interface SelectionResolution {
  mode: SelectionMode;
  /**
   * A LIVE worktree holds this branch. Offered disabled, never submittable.
   *
   * A path rather than the ref's `heldBy`, which is a directory NAME: this
   * field answers one selection, where the whole path is what identifies the
   * holder, and the list's badge answers a row, where a path is the thing § 4.2
   * exists to delete.
   */
  blockedBy?: { ownerPath: string };
}

/** A worktree that could be holding a branch, as opposed to one that holds none. */
function holdsBranches(worktree: ResolutionWorktree): boolean {
  return !worktree.bare && !worktree.detached && worktree.branch !== undefined;
}

/**
 * What a create against this selection would do, from facts already in hand.
 *
 * No git call and no disk read: the enumeration that answered "which branches
 * exist" and the listing that answered "which worktrees exist" together answer
 * this, and asking again would let two reads disagree about one instant
 * (design.md D2).
 */
export function resolveSelection(facts: SelectionFacts): SelectionResolution {
  const query = facts.query.trim();
  if (query.length === 0) {
    // Nothing typed is not "create a branch named nothing" — the form has no
    // selection yet, and guessing one would state a mode the user never chose.
    return { mode: { kind: "none" } };
  }

  if (!facts.refs.some((ref) => ref.name === query)) {
    return { mode: { kind: "fresh" } };
  }

  const holders = facts.worktrees.filter((worktree) => holdsBranches(worktree) && worktree.branch === query);
  // A prunable holder is not a holder for this purpose: its registration is
  // exactly what a repair fixes, so treating it as a live claim would refuse
  // the one action that resolves it. Live holders are checked first, because a
  // branch git will refuse outright is refused here rather than repaired.
  const live = holders.find((worktree) => !worktree.prunable);
  if (live !== undefined) {
    return { mode: { kind: "reuse" }, blockedBy: { ownerPath: live.displayPath } };
  }

  const stale = holders[0];
  if (stale !== undefined) {
    return { mode: { kind: "reattachCandidate", repairPath: stale.displayPath } };
  }

  return { mode: { kind: "reuse" } };
}

/**
 * The wire's disposition, narrowed to what a REPORT may carry.
 *
 * Rebuilt rather than spread: a spread would carry `authorization` through
 * under a type that does not mention it, and the whole point is that a probe's
 * answer has nothing a delete could be built from (design.md D4).
 */
export function reportableDisposition(disposition: DestinationDisposition): ResolvedDisposition {
  return disposition.kind === "debris" ? { kind: "debris" } : { kind: "free" };
}
