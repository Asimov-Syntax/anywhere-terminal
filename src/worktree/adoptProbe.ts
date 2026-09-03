// src/worktree/adoptProbe.ts — Is this directory a checkout git has forgotten?
// See: asimov/changes/re-register-a-surviving-checkout/design.md D1, D2, D3
//      docs/design/worktree-create.md § 2.0, § 2.4
//
// `probeReattach` reaches adopt from the other side: git still lists the
// registration as prunable, and the `gitdir:` it names turns out to be gone.
// Once `git worktree prune` has run there is no registration left to downgrade,
// and the surviving directory is the only witness there ever was one.
//
// The classification itself is not repeated here. `readGitLink` is the one
// reader of a `.git` entry, and a second one would be a second opinion about
// which of them is right.

import type { GitLink } from "./reattachProbe";

export interface AdoptProbeDeps {
  /** The candidate's `.git`, classified. Never throws — answers `unreadable`. */
  readGitLink(worktreePath: string): Promise<GitLink>;
  /** Whether the administrative directory a `gitdir:` names still exists. */
  adminDirExists(gitdir: string): Promise<boolean>;
}

/**
 * `notAPrunedCheckout` is every state that is not this one, deliberately fused.
 *
 * A repository, a bare directory and a live registration are three different
 * things to a reader, but they are one thing to this caller: not the state
 * adopt acts on, and the resolution falls back to the free path for all three.
 * `unreadable` is separate because it is the one answer that must not be read
 * as "gone" — a `.git` this process cannot read is still a `.git`, and adopting
 * over one would overwrite a live registration.
 */
export type AdoptVerdict =
  | { kind: "adopt"; adoptPath: string }
  | { kind: "declined"; because: "notAPrunedCheckout" | "unreadable" };

/**
 * Whether `candidatePath` is a checkout whose administrative entry is gone.
 *
 * Answers rather than throws, on the same rule `probeReattach` follows: this
 * runs on the create path with a dialog waiting on it, and an exception here
 * would fail the whole resolution over a candidate the user may not even have
 * selected.
 */
export async function probeAdopt(candidatePath: string, deps: AdoptProbeDeps): Promise<AdoptVerdict> {
  let link: GitLink;
  try {
    link = await deps.readGitLink(candidatePath);
  } catch {
    return { kind: "declined", because: "unreadable" };
  }
  if (link.kind === "unreadable") {
    return { kind: "declined", because: "unreadable" };
  }
  if (link.kind !== "file") {
    return { kind: "declined", because: "notAPrunedCheckout" };
  }

  let exists: boolean;
  try {
    exists = await deps.adminDirExists(link.gitdir);
  } catch {
    // A failed existence check is not an absent directory. Failing closed here
    // is what keeps the one unreadable arm from becoming the adopt arm.
    return { kind: "declined", because: "unreadable" };
  }
  return exists ? { kind: "declined", because: "notAPrunedCheckout" } : { kind: "adopt", adoptPath: candidatePath };
}
