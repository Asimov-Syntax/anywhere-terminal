// src/worktree/reattachProbe.ts — Whether a prunable claim is safe to repair.
// See: asimov/changes/resolve-a-selection-before-the-create-runs/design.md D3
//      docs/design/worktree-create.md § 2.3

import { isAbsolute, join, resolve } from "node:path";

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
  /** Present, but neither a directory nor a regular file — a symlink, a socket. */
  | { kind: "notAFile" }
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
    // A `.git` directory is a repository, an absent one is not a checkout git
    // ever registered, and a symlink is not the link file git writes. None is
    // repairable, and none is adopt.
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

/** The two filesystem reads a `.git` entry needs, injected so this is testable. */
export interface GitLinkFs {
  /** `null` when the path is not there. Never throws. Does NOT follow symlinks. */
  lstat(p: string): Promise<{ isDirectory(): boolean; isFile(): boolean } | null>;
  /** `null` when the file could not be read. Never throws. */
  readFile(p: string): Promise<string | null>;
}

/**
 * Git's own prefix, the space included.
 *
 * `read_gitfile_gently` matches `"gitdir: "` at the START of the file and takes
 * everything after it as the path. Accepting `gitdir:` without the space, or
 * anywhere but the first byte, would read as a link a file git refuses.
 */
const GITDIR_PREFIX = "gitdir: ";

/**
 * Classify a candidate directory's `.git`.
 *
 * The `gitdir:` value is git's own two-way link and may be written relative to
 * the worktree — resolved against the WORKTREE rather than the process cwd,
 * because a relative path resolved against the wrong base names a directory
 * that does not exist and would report a healthy link as adopt's state.
 *
 * A `.git` file that names no gitdir is `unreadable`, not a link with an empty
 * target: guessing one would point the existence check at a path nobody wrote.
 */
export async function readGitLink(worktreePath: string, fs: GitLinkFs): Promise<GitLink> {
  const dotGit = join(worktreePath, ".git");
  const info = await fs.lstat(dotGit);
  if (info === null) {
    return { kind: "absent" };
  }
  if (info.isDirectory()) {
    return { kind: "directory" };
  }
  if (!info.isFile()) {
    // `lstat` does not follow a symlink but `readFile` does, so treating every
    // non-directory as the link file would let a `.git` symlink pointing
    // anywhere answer for this worktree. Git writes a regular file here
    // (round-1 B1).
    return { kind: "notAFile" };
  }
  const text = await fs.readFile(dotGit);
  if (text === null) {
    return { kind: "unreadable" };
  }
  // Git's grammar, not a search for a line that looks like one. The old reader
  // took the first line ANYWHERE in the file that began with `gitdir:`, so
  // `junk\ngitdir: <path>` — which git rejects outright — was accepted as the
  // authority to overwrite that same file (round-1 F007).
  if (!text.startsWith(GITDIR_PREFIX)) {
    return { kind: "unreadable" };
  }
  // The tail git trims, plus `\r`: a CRLF-written link that resolves to an
  // existing administrative directory must report that directory as PRESENT.
  // Being liberal at the tail can only decline an adoption; being liberal at
  // the head is what admits a file git would not follow.
  const gitdir = text.slice(GITDIR_PREFIX.length).replace(/[\n\r ]+$/, "");
  if (gitdir.length === 0) {
    return { kind: "unreadable" };
  }
  return { kind: "file", gitdir: isAbsolute(gitdir) ? gitdir : resolve(worktreePath, gitdir) };
}
