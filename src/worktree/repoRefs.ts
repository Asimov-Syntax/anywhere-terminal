// src/worktree/repoRefs.ts — The local branches the create dialog offers, bounded.
// See: asimov/changes/offer-every-ref-in-one-box/design.md D2, D3
//      docs/design/worktree-create.md § 4.1

import path from "node:path";
import type { GitCommandRunner } from "./gitCommandRunner";

/**
 * The ceiling on branches the dialog offers.
 *
 * Refs grow with a repository's history and nothing prunes them. The runner's
 * own buffer ceiling would eventually catch this, but as a killed child that
 * answers nothing — indistinguishable from a repository with no branches. A cap
 * git applies itself keeps the failure legible (design.md D3).
 */
export const MAX_REFS = 500;

/** One selectable ref in the create dialog's list. */
export interface WorktreeRef {
  /** Short name, e.g. `feat/search`. */
  name: string;
  /**
   * The branch tip, from the SAME `for-each-ref` that named the branch.
   *
   * Read in one format string rather than by a follow-up `git rev-parse`: two
   * reads are two instants, and a caller promising a user this tip would be
   * promising one the listing beside it never saw.
   */
  oid: string;
  /**
   * The NAME of the directory whose worktree holds this branch, when one does.
   * Absent means no worktree holds it. Never a path (design.md D2).
   */
  heldBy?: string;
}

/** The fields of a `WorktreeInfo` that answer "which branch does this hold?". */
export interface RepoRefsWorktree {
  displayPath: string;
  bare: boolean;
  detached: boolean;
  branch?: string;
}

export interface RepoRefsInput {
  /** Where the read runs — any worktree of the repository. */
  cwd: string;
  /**
   * The repository's own listing, already in hand.
   *
   * Held-by is derived from it rather than asked of git a second time: the
   * listing that answers "which worktrees exist" already answers "which
   * branches they hold", and two reads can disagree about one instant.
   */
  worktrees: readonly RepoRefsWorktree[];
}

/**
 * `ok: false` is "we could not ask", which is not `refs: []`.
 *
 * A repository whose branches could not be enumerated must not render as a
 * repository with no branches — the form states the list is unavailable and the
 * create-new row carries the user through either way.
 */
export type RepoRefsRead = { ok: true; refs: readonly WorktreeRef[]; truncated: boolean } | { ok: false };

/**
 * Which directory holds each branch, keyed by branch.
 *
 * A detached or bare worktree contributes nothing: it holds no branch anyone
 * could be blocked on. First writer wins — git permits one worktree per branch,
 * so a second is a listing that raced, and either answer is stale.
 */
function holdersByBranch(worktrees: readonly RepoRefsWorktree[]): Map<string, string> {
  const holders = new Map<string, string>();
  for (const worktree of worktrees) {
    if (worktree.bare || worktree.detached || worktree.branch === undefined) {
      continue;
    }
    if (!holders.has(worktree.branch)) {
      holders.set(worktree.branch, path.basename(worktree.displayPath) || worktree.displayPath);
    }
  }
  return holders;
}

/**
 * The repository's local branches, capped, each marked with the directory
 * holding it.
 *
 * Split on newlines rather than NUL: git refuses a ref name containing one, so
 * the separator cannot appear inside a value here. `--count` is asked one over
 * the cap so a full page is distinguishable from a repository that happens to
 * have exactly `MAX_REFS` branches.
 *
 * Each line is `<oid> <name>`, split on the FIRST space: a ref name cannot
 * contain a space, so the remainder is the whole name however it is spelled.
 */
export async function readRepoRefs(runner: GitCommandRunner, input: RepoRefsInput): Promise<RepoRefsRead> {
  const result = await runner.run(
    ["for-each-ref", "--format=%(objectname) %(refname:short)", `--count=${MAX_REFS + 1}`, "refs/heads/"],
    input.cwd,
  );
  if (result.failedToSpawn || result.timedOut || result.code !== 0) {
    return { ok: false };
  }

  const named = result.stdout
    .toString("utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const gap = line.indexOf(" ");
      // A line with no space is not a short-format line; dropping it is what
      // keeps a malformed read from becoming a ref with an empty name or an
      // empty tip, either of which a caller would compare against and pass.
      return gap <= 0 ? undefined : { oid: line.slice(0, gap), name: line.slice(gap + 1) };
    })
    .filter((entry): entry is { oid: string; name: string } => entry !== undefined && entry.name.length > 0);

  const truncated = named.length > MAX_REFS;
  const holders = holdersByBranch(input.worktrees);
  const refs = named.slice(0, MAX_REFS).map(({ name, oid }) => {
    const heldBy = holders.get(name);
    return heldBy === undefined ? { name, oid } : { name, oid, heldBy };
  });

  return { ok: true, refs, truncated };
}
