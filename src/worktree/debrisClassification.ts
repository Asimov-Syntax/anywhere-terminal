// src/worktree/debrisClassification.ts — Is this destination crash debris?
// See: asimov/changes/clear-crash-debris-under-an-explicit-authorization/design.md D1
//
// Debris is a directory that is deliberately NOT a git checkout — the half-made
// worktree whose registration never landed. It is the one destination a create
// may delete (worktree-create.md § 2.2), so what separates it from a checkout is
// load-bearing rather than cosmetic.
//
// Absence from git's listing is NOT that separator, which is what this module
// exists to correct. A checkout whose administrative entry was pruned is also
// unregistered, and it holds the work WT-012.15 re-registers.

import { lstatSync } from "node:fs";
import * as path from "node:path";
import type { ResolvedDisposition } from "../types/messages";

/**
 * What is at a path, WITHOUT resolving it.
 *
 * Three answers, not two: "could not tell" is its own case because it is the one
 * that must not be collapsed into "absent". A `.git` behind a directory this
 * process cannot read is still a `.git`.
 */
export type GitEntryProbe = (p: string) => "present" | "absent" | "unknown";

/**
 * `lstat`, never `exists`. `existsSync` follows the link, so a `.git` symlink
 * whose target is gone reads as absent — and that reading would classify a
 * checkout as debris and offer to delete it. What matters here is whether the
 * ENTRY is there, not whether it resolves.
 */
export const probeGitEntry: GitEntryProbe = (p) => {
  try {
    lstatSync(p);
    return "present";
  } catch (error) {
    return (error as NodeJS.ErrnoException | null)?.code === "ENOENT" ? "absent" : "unknown";
  }
};

/**
 * What the destination holds, for a candidate the caller has already decided is
 * worth asking about.
 *
 * Fails closed in both directions that are not a proven bare directory: a
 * registered path and an unreadable one are both reported `free`, because
 * `debris` is what authorizes a delete and neither reading earns one.
 */
export function classifyDestination(
  candidatePath: string,
  isRegistered: boolean,
  probe: GitEntryProbe = probeGitEntry,
): ResolvedDisposition {
  if (isRegistered) {
    return { kind: "free" };
  }
  return probe(path.join(candidatePath, ".git")) === "absent" ? { kind: "debris" } : { kind: "free" };
}
