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

import { lstatSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import * as path from "node:path";
import { isPathInside, normalizePathForCompare } from "../utils/pathBoundary";
import { type ComponentWalk, identityOf, type LstatLike, walkComponentsSync } from "./createPath";
import { type GitEntryProbe, probeGitEntry } from "./debrisClassification";

export interface ClearDebrisDeps {
  /**
   * SYNC on purpose, every one of them — see the ordering note in `clearDebris`.
   * A check whose reading was taken before an `await` does not describe the
   * directory at the moment of the delete, so the whole boundary reads
   * synchronously and `remove` is the first suspension after it.
   */
  probeEntry: GitEntryProbe;
  lstat(p: string): LstatLike | null;
  /** Immediate entries, or `null` where the directory could not be read for any reason. */
  readdir(p: string): readonly string[] | null;
  remove(p: string): Promise<void>;
}

/** What the user approved: the directory they were shown, and what was in it. */
export interface DebrisApproval {
  readonly identity: string;
  readonly entries: readonly string[];
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

/**
 * The boundary's own readings, taken from `node:fs` synchronously.
 *
 * They live here rather than in the wiring because the ordering rule above is
 * only true if these are synchronous: deps assembled elsewhere from the async
 * path helpers would satisfy the types and silently reopen the window this
 * module exists to close.
 */
export const nodeClearDebrisDeps: ClearDebrisDeps = {
  probeEntry: probeGitEntry,
  lstat: (p) => {
    try {
      return lstatSync(p);
    } catch {
      return null;
    }
  },
  readdir: (p) => {
    try {
      return readdirSync(p);
    } catch {
      return null;
    }
  },
  remove: removeRecursively,
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
 * ORDERING IS A GUARD, not style. Every bound worktree-create.md § 2.2 states —
 * the component walk, the absent `.git`, the identity, and the entry set the
 * user approved — is read in one synchronous run that ends at `remove`, with no
 * `await` anywhere inside it. A check read before a suspension point and acted
 * on after it does not constrain what the directory was at the moment of the
 * delete: that is why every probe in `ClearDebrisDeps` is synchronous, and it is
 * the whole reason this function is shaped the way it is (round-1 B4, B5).
 *
 * Containment is `isPathInside` from `src/utils/pathBoundary.ts` and the
 * component walk is `createPath`'s own; this module spells neither for itself.
 * Both are re-asked here even though the create validator already asked: this
 * function deletes, and a caller that forgot is not a failure mode worth
 * inheriting.
 */
export async function clearDebris(
  resolvedPath: string,
  ctx: ClearDebrisContext,
  approved: DebrisApproval | null,
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
  // A null approval is not a wildcard. Where the platform supplies no identity,
  // or the contents could not be read, there is nothing to bind the
  // authorization to, and an unbindable delete is refused rather than taken on
  // the strength of the path alone.
  if (approved === null) {
    return { ok: false, reason: "That directory could not be identified, so it will not be cleared." };
  }

  // ── No `await` from here to `remove`. Everything below reads synchronously. ──
  const walk = walkComponentsSync(resolvedPath, path, deps.lstat);
  const walkRefusal = refuseWalk(walk);
  if (walkRefusal !== null) {
    return { ok: false, reason: walkRefusal };
  }
  const stat = deps.lstat(resolvedPath);
  if (stat === null) {
    return { ok: false, reason: "That directory is gone, so there is nothing to clear." };
  }
  if (!stat.isDirectory()) {
    return { ok: false, reason: "That path is not a directory, so it will not be cleared." };
  }
  if (deps.probeEntry(path.join(resolvedPath, ".git")) !== "absent") {
    return { ok: false, reason: "That directory holds a repository, so it is not debris." };
  }
  if (identityOf(stat) !== approved.identity) {
    return { ok: false, reason: "That directory changed since it was shown to you. Please try again." };
  }
  // The CONTENTS, at the boundary. The redemption compared an entry set read
  // several `await`s ago; between that read and this one another process can
  // have written a file the user never approved, and the removal below is
  // recursive (round-1 B4).
  const present = deps.readdir(resolvedPath);
  if (present === null) {
    return { ok: false, reason: "That directory could not be read, so it will not be cleared." };
  }
  const allowed = new Set(approved.entries);
  const appeared = present.filter((entry) => !allowed.has(entry));
  if (appeared.length > 0) {
    return {
      ok: false,
      reason: `That directory changed since it was shown to you. New since then: ${appeared.join(", ")}.`,
    };
  }
  try {
    await deps.remove(resolvedPath);
  } catch (error) {
    // A recursive removal can delete half a tree and then reject, so the error
    // alone leaves the user knowing a delete failed and not what survived it —
    // the same gap the post-removal path closes (round-2 W3).
    const survivors = deps.readdir(resolvedPath);
    const left = survivors === null || survivors.length === 0 ? "" : ` Still there: ${listShort(survivors)}`;
    return { ok: false, reason: `That directory could not be cleared: ${messageOf(error)}.${left}` };
  }

  // ABSENCE, proven. A read that merely failed is not a cleared directory, and
  // reporting the attempt as successful is how a create starts describing a
  // destination that is still there (round-1 B6).
  const after = deps.probeEntry(resolvedPath);
  if (after === "absent") {
    return { ok: true };
  }
  const remaining = after === "present" ? deps.readdir(resolvedPath) : null;
  return {
    ok: false,
    reason:
      remaining === null || remaining.length === 0
        ? "That directory could not be fully cleared."
        : `That directory could not be fully cleared. Still there: ${listShort(remaining)}`,
  };
}

/** How many survivors a message names before it counts the rest. */
const SURVIVOR_CAP = 8;

/** Bounded: the point is to say what is there, and a directory can hold thousands. */
function listShort(entries: readonly string[]): string {
  const shown = entries.slice(0, SURVIVOR_CAP).join(", ");
  const rest = entries.length - SURVIVOR_CAP;
  return rest > 0 ? `${shown} and ${rest} more.` : `${shown}.`;
}

/** Why the component walk refuses, or null where it found nothing to refuse. */
function refuseWalk(walk: ComponentWalk): string | null {
  switch (walk.kind) {
    case "clean":
      return null;
    case "symlink":
      // § 2.2: a symlinked component means the thing deleted is not the thing
      // validated. The check exists in the create validator too — this one is
      // the one that describes the delete.
      return `“${walk.at}” is a symbolic link, so it will not be cleared.`;
    case "missing":
    case "unknown":
      // At creation a component that does not exist yet is ordinary. At deletion
      // it is not: every component of a directory being removed exists, so
      // "could not tell" is a refusal rather than a pass.
      return "That directory could not be read, so it will not be cleared.";
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
