// src/worktree/clearDebris.ts — The one place this extension deletes a directory
// itself.
// See: asimov/changes/clear-crash-debris-under-an-explicit-authorization/design.md D3, D5
//
// A NAMED carve-out of worktree-actions.md § 3.1 rule 3, declared to the I10 gate
// rather than hidden from it. git cannot perform this removal: `worktree remove`
// will not delete a directory that is deliberately not a worktree, which is
// exactly what debris is (worktree-create.md § 2.2).
//
// Every check below is a bound that document states, and every one of them runs
// on the reading taken HERE — an authorization redeemed upstream says the user
// approved this clearance, not that the directory is still the one they saw.

import { rm } from "node:fs/promises";
import * as path from "node:path";
import { isPathInside, normalizePathForCompare } from "../utils/pathBoundary";
import { identityOf, type LstatLike } from "./createPath";
import type { GitEntryProbe } from "./debrisClassification";

export interface ClearDebrisDeps {
  lstat(p: string): Promise<LstatLike | null>;
  /** Immediate entries, or `null` where the path is gone. */
  readdir(p: string): Promise<readonly string[] | null>;
  /** SYNC on purpose — see the ordering note in `clearDebris`. */
  probeGitEntry: GitEntryProbe;
  remove(p: string): Promise<void>;
}

/**
 * THE carve-out. The only destructive `node:fs` call in the worktree paths, and
 * the reason `src/worktree/clearDebris.ts` is named in the I10 gate's allowlist
 * (design.md D4) — declared where the gate can see it, rather than pushed into
 * unscoped wiring where it would pass by hiding.
 */
export const removeRecursively = async (p: string): Promise<void> => {
  await rm(p, { recursive: true, force: true });
};

export type ClearDebrisResult = { ok: true } | { ok: false; reason: string };

/** The worktrees this delete must never touch — `CreatePathContext`'s own fields. */
export interface ClearDebrisContext {
  mainWorktree: string;
  linkedWorktrees: readonly string[];
}

/**
 * Remove `resolvedPath`, or refuse and remove nothing.
 *
 * ORDERING IS A GUARD, not style. The identity comparison and the `.git` reading
 * are the last two things that happen before `remove`, and neither is followed by
 * an `await` — a check read before a suspension point and acted on after it does
 * not constrain what the directory was at the moment of the delete. That is why
 * `probeGitEntry` is synchronous.
 *
 * Containment is `isPathInside` from `src/utils/pathBoundary.ts`, the single
 * definition in `src/`; this module spells none of its own. It is re-asked here
 * even though the create validator already asked: this function deletes, and a
 * caller that forgot is not a failure mode worth inheriting.
 */
export async function clearDebris(
  resolvedPath: string,
  ctx: ClearDebrisContext,
  approvedIdentity: string | null,
  deps: ClearDebrisDeps,
): Promise<ClearDebrisResult> {
  // The validator's own vocabulary, re-asked. `CreatePathContext` carries no
  // "create root" — containment for a worktree destination is expressed as what
  // it must NOT be — so this asks the same question rather than inventing a root
  // it would have to be handed.
  const same = (a: string, b: string): boolean => normalizePathForCompare(a) === normalizePathForCompare(b);
  if (same(resolvedPath, ctx.mainWorktree)) {
    return { ok: false, reason: "That is the repository's main worktree, so it will not be cleared." };
  }
  for (const linked of ctx.linkedWorktrees) {
    if (same(resolvedPath, linked) || isPathInside(resolvedPath, linked)) {
      return { ok: false, reason: "That path is inside another worktree of this repository." };
    }
  }
  // A null identity is not a wildcard. Where the platform supplies none there is
  // nothing to bind the authorization to, and an unbindable delete is refused
  // rather than taken on the strength of the path alone.
  if (approvedIdentity === null) {
    return { ok: false, reason: "That directory could not be identified, so it will not be cleared." };
  }

  const stat = await deps.lstat(resolvedPath);
  if (stat === null) {
    return { ok: false, reason: "That directory is gone, so there is nothing to clear." };
  }
  if (!stat.isDirectory()) {
    return { ok: false, reason: "That path is not a directory, so it will not be cleared." };
  }

  // ── No `await` from here to `remove`. ──
  if (deps.probeGitEntry(path.join(resolvedPath, ".git")) !== "absent") {
    return { ok: false, reason: "That directory holds a repository, so it is not debris." };
  }
  if (identityOf(stat) !== approvedIdentity) {
    return { ok: false, reason: "That directory changed since it was shown to you. Please try again." };
  }
  try {
    await deps.remove(resolvedPath);
  } catch (error) {
    return { ok: false, reason: `That directory could not be cleared: ${messageOf(error)}` };
  }

  // What REMAINS, not what went. A removal that stopped partway leaves the create
  // with a destination it cannot use, and reporting the attempt as successful is
  // how the UI starts describing a directory that is still there.
  const remaining = await deps.readdir(resolvedPath);
  if (remaining !== null && remaining.length > 0) {
    return { ok: false, reason: `That directory could not be fully cleared. Still there: ${remaining.join(", ")}.` };
  }
  return { ok: true };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
