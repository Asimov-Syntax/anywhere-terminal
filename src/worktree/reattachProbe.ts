// src/worktree/reattachProbe.ts — Whether a prunable claim is safe to repair.
// See: asimov/changes/resolve-a-selection-before-the-create-runs/design.md D3
//      docs/design/worktree-create.md § 2.3

/**
 * What a `.git` entry in a candidate directory turned out to be.
 *
 * A `.git` DIRECTORY is a repository, not a linked worktree; only a linked
 * worktree has a `.git` file naming an administrative directory elsewhere, and
 * that file is the link `git worktree repair` rewrites.
 */
export type GitLink =
  | { kind: "file"; gitdir: string }
  | { kind: "directory" }
  | { kind: "absent" }
  | { kind: "unreadable" };

export interface ReattachProbeDeps {
  /** The candidate's `.git`, classified. Never throws — answers `unreadable`. */
  readGitLink(worktreePath: string): Promise<GitLink>;
  /** Whether the administrative directory a `gitdir:` names still exists. */
  adminDirExists(gitdir: string): Promise<boolean>;
  /** The directory's own `HEAD` commit, or undefined when it cannot be read. */
  headOid(worktreePath: string): Promise<string | undefined>;
}

export interface ReattachSubject {
  /** The prunable worktree's directory, from the listing. */
  repairPath: string;
  /** The selected branch's current tip, from the enumeration already taken. */
  branchOid: string;
}

/**
 * `adopt` is a REPORT, not an offer.
 *
 * The administrative entry is gone, so nothing repairs it — but the directory
 * is a surviving checkout, never debris, and deleting it to tidy a listing
 * would destroy work. WT-012.15 owns what to do about it; this module's job is
 * to name the state rather than mistake it for the one next to it (§ 2.3).
 */
export type ReattachVerdict =
  | { kind: "offer"; repairPath: string; expectedOid: string }
  | { kind: "adopt"; adoptPath: string }
  | { kind: "declined"; because: "notALinkedWorktree" | "headMoved" | "unreadable" };

/**
 * Corroborate git's `prunable` flag before a repair is offered.
 *
 * Conditions 2 and 3 of § 2.3, in order, because they are not interchangeable:
 * a `gitdir:` naming a directory that is gone is ADOPT's state and must not be
 * reported as a declined reattach, and a HEAD that has moved is a directory
 * that needs a human rather than a repair.
 *
 * Every failure answers rather than throws. This runs on the create path with a
 * dialog waiting on it, and an exception here would fail the whole resolution
 * over a candidate the user may not even have selected.
 */
export async function probeReattach(subject: ReattachSubject, deps: ReattachProbeDeps): Promise<ReattachVerdict> {
  const link = await deps.readGitLink(subject.repairPath);
  if (link.kind === "unreadable") {
    return { kind: "declined", because: "unreadable" };
  }
  if (link.kind !== "file") {
    // A `.git` directory is a repository and an absent one is not a checkout
    // git ever registered. Neither is repairable, and neither is adopt.
    return { kind: "declined", because: "notALinkedWorktree" };
  }

  if (!(await deps.adminDirExists(link.gitdir))) {
    return { kind: "adopt", adoptPath: subject.repairPath };
  }

  const head = await deps.headOid(subject.repairPath);
  if (head === undefined || head !== subject.branchOid) {
    // Undefined is treated as moved rather than as its own outcome: both mean
    // "we cannot say this checkout is where the branch is", and offering a
    // repair on either would be a claim nobody established.
    return { kind: "declined", because: "headMoved" };
  }

  return { kind: "offer", repairPath: subject.repairPath, expectedOid: head };
}
