// src/worktree/orphanProofs.ts — The three proofs of worktree-removal.md § 4.
//
// They identify a worktree nobody is using any more, and they inform a human
// decision rather than replace it: nothing here removes anything, and a proof
// withholds only the option it gates (§ 2.2). Every read is injected, so the
// suite needs neither a disk nor a git.

import { isPathInside } from "../utils/pathBoundary";

/** How old a lock must be before it counts as abandoned. Recorded, not tuned. */
export const LOCK_AGE_MS = 24 * 60 * 60 * 1000;

/** What one proof established, or why it could not. `notApplicable` is not a failure. */
export type ProofOutcome = "passed" | "failed" | "unproven" | "notApplicable";

export interface OrphanProofs {
  lockAged: ProofOutcome;
  ownerGone: ProofOutcome;
  branchMerged: ProofOutcome;
}

/** Only the two fields the ownership proof asks about. */
export interface ProofSessionRecord {
  /** Resolved. */
  cwd: string;
  alive: boolean;
}

/** A read that succeeded, or one that could not be taken at all. */
export type ProofSourceRead<T> = { ok: true; value: T } | { ok: false };

export interface OrphanProofSubject {
  /** The worktree's own path, as git reports it. */
  path: string;
  locked: boolean;
  /** Absent when the worktree is detached or bare. */
  branch?: string;
  sessions: ProofSourceRead<readonly ProofSessionRecord[]>;
}

export type ProofGitRun = (
  args: readonly string[],
  cwd: string,
) => Promise<{ code: number; stdout: Buffer; timedOut: boolean }>;

export interface OrphanProofDeps {
  git: ProofGitRun;
  /** Epoch ms of the path's last modification. Throws rather than answering 0. */
  lockMtime(absPath: string): Promise<number>;
  /** The worktree's own git directory. */
  gitDir(worktreePath: string): Promise<string>;
  now(): number;
}

/**
 * All three proofs, answered together.
 *
 * Together because they share one subject and are reported as one group; the
 * two that touch git and the disk run concurrently, so this adds one suspension
 * point to an assessment rather than three.
 */
export async function readOrphanProofs(subject: OrphanProofSubject, deps: OrphanProofDeps): Promise<OrphanProofs> {
  const [lockAged, branchMerged] = await Promise.all([lockProof(subject, deps), mergeProof(subject, deps)]);
  return { lockAged, ownerGone: ownerProof(subject), branchMerged };
}

async function lockProof(subject: OrphanProofSubject, deps: OrphanProofDeps): Promise<ProofOutcome> {
  if (!subject.locked) {
    return "notApplicable";
  }
  try {
    // `git worktree lock` writes this file with or without a reason — zero
    // bytes when there is none, verified on git 2.50.1 — so its presence tracks
    // the lock and its mtime is the lock's age. Content would be no signal.
    const dir = await deps.gitDir(subject.path);
    const mtime = await deps.lockMtime(`${dir}/locked`);
    return deps.now() - mtime >= LOCK_AGE_MS ? "passed" : "failed";
  } catch {
    // A lock we cannot age is neither stale nor fresh.
    return "unproven";
  }
}

function ownerProof(subject: OrphanProofSubject): ProofOutcome {
  if (!subject.sessions.ok) {
    return "unproven";
  }
  const here = subject.sessions.value.filter((s) => isPathInside(s.cwd, subject.path));
  // A dead record is evidence NOBODY is here, which is why the removal path
  // reads records the presence reader discards (worktree-removal.md § 4.1).
  return here.some((s) => s.alive) ? "failed" : "passed";
}

async function mergeProof(subject: OrphanProofSubject, deps: OrphanProofDeps): Promise<ProofOutcome> {
  const branch = subject.branch;
  if (branch === undefined) {
    return "notApplicable";
  }
  const base = await resolveDefaultBranch(subject.path, deps.git);
  if (base === undefined || base === branch) {
    // A branch is trivially an ancestor of itself, and reporting the default
    // branch as "merged into itself" would offer to delete it (§ 5 rule 4).
    return base === branch ? "notApplicable" : "unproven";
  }
  const result = await deps.git(["merge-base", "--is-ancestor", branch, base], subject.path);
  if (result.timedOut) {
    return "unproven";
  }
  // Exactly two codes carry meaning: 0 is merged and 1 is not. Everything else
  // is an error — git exits 128 for a ref it cannot resolve — and reading an
  // error as "not merged" states a fact nobody established (design.md D5).
  if (result.code === 0) {
    return "passed";
  }
  return result.code === 1 ? "failed" : "unproven";
}

/**
 * The default branch, from LOCAL refs only.
 *
 * No fetch is ever issued: a fetch answers a question the user did not ask, over
 * a network they did not choose to use, and a stale local default reporting
 * `unproven` is better than a fresh remote one reporting wrongly
 * (worktree-removal.md § 4.1).
 *
 * Every candidate after the first is confirmed to exist here before it is used.
 * `init.defaultBranch` in particular is a preference about repositories yet to
 * be created and says nothing about this one.
 */
export async function resolveDefaultBranch(worktreePath: string, git: ProofGitRun): Promise<string | undefined> {
  const named = await ok(git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], worktreePath));
  // `origin/main` → `main`. Only the last segment is the branch name.
  const fromRemote = named?.slice(named.lastIndexOf("/") + 1);
  const configured = await ok(git(["config", "init.defaultBranch"], worktreePath));
  for (const candidate of [fromRemote, configured, "main", "master"]) {
    if (candidate === undefined || candidate.length === 0) {
      continue;
    }
    const found = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`], worktreePath);
    if (found.code === 0 && !found.timedOut) {
      return candidate;
    }
  }
  return undefined;
}

/** The trimmed stdout of a command that succeeded, or `undefined`. */
async function ok(run: ReturnType<ProofGitRun>): Promise<string | undefined> {
  const result = await run;
  if (result.code !== 0 || result.timedOut) {
    return undefined;
  }
  const text = result.stdout.toString("utf8").trim();
  return text.length === 0 ? undefined : text;
}
