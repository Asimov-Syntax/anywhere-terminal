// src/worktree/deleteBranch.ts — Guarded post-removal branch deletion.

import type { GitCommandRunner } from "./gitCommandRunner";
import { resolveDefaultBranch } from "./orphanProofs";

export interface DeleteBranchEvidence {
  branch: string;
  branchOid: string;
  defaultBranch: string;
  defaultOid: string;
}

export type DeleteBranchOutcome =
  | { kind: "deleted"; branch: string }
  | {
      kind: "refused";
      reason: "branch-in-use" | "default-branch" | "holders-unavailable" | "refs-moved";
    };

/**
 * Delete the recorded branch only while both recorded refs still hold and no
 * worktree currently reports the branch as checked out.
 */
export async function deleteBranch(
  runner: GitCommandRunner,
  repoPath: string,
  evidence: DeleteBranchEvidence,
): Promise<DeleteBranchOutcome> {
  const listing = await runner.run(["worktree", "list", "--porcelain", "-z"], repoPath);
  if (listing.code !== 0 || listing.timedOut || listing.failedToSpawn) {
    return { kind: "refused", reason: "holders-unavailable" };
  }
  const targetRef = `refs/heads/${evidence.branch}`;
  const fields = listing.stdout.toString("utf8").split("\0");
  if (fields.some((field) => field === `branch ${targetRef}`)) {
    return { kind: "refused", reason: "branch-in-use" };
  }

  const currentDefault = await resolveDefaultBranch(repoPath, (args, cwd) => runner.run(args, cwd));
  if (currentDefault === undefined) {
    return { kind: "refused", reason: "holders-unavailable" };
  }
  if (currentDefault === evidence.branch) {
    return { kind: "refused", reason: "default-branch" };
  }

  const transaction = [
    "start",
    `verify refs/heads/${evidence.defaultBranch} ${evidence.defaultOid}`,
    `delete ${targetRef} ${evidence.branchOid}`,
    "commit",
    "",
  ].join("\n");
  const result = await runner.run(["update-ref", "--stdin"], repoPath, { input: transaction });
  if (result.code !== 0 || result.timedOut || result.failedToSpawn) {
    return { kind: "refused", reason: "refs-moved" };
  }
  return { kind: "deleted", branch: evidence.branch };
}
