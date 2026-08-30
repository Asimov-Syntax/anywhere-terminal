// src/worktree/orphanProofs.ts — The three proofs of worktree-removal.md § 4.
//
// They identify a worktree nobody is using any more, and they inform a human
// decision rather than replace it: nothing here removes anything, and a proof
// withholds only the option it gates (§ 2.2). Every read is injected, so the
// suite needs neither a disk nor a git.

import { isPathInside } from "../utils/pathBoundary";
import { afterDelay, type Deadline } from "./deadline";

/** How old a lock must be before it counts as abandoned. Recorded, not tuned. */
export const LOCK_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * How long the whole lock read may take before it answers `unproven`.
 *
 * The reads are awaited inside the removal assessment's own `Promise.all`, so an
 * unbounded one does not report a slow proof — it holds the removal open, and a
 * removal that never returns is a removal refused by a proof (round-1 B3).
 *
 * This is a bound on ONE read, not the shared in-flight registry WT-013.1's
 * round-5 W3 asks for: an expired read here is abandoned exactly as that finding
 * describes, and it stays open and unwaived.
 */
export const MAX_LOCK_READ_MS = 2_000;

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

/**
 * A read that succeeded, or one that could not be taken at all.
 *
 * `partial` marks a scan that returned real records but skipped a candidate it
 * could not read. The records are true; their ABSENCE is not evidence.
 */
export type ProofSourceRead<T> = { ok: true; value: T; partial?: boolean } | { ok: false };

export interface OrphanProofSubject {
  /** The worktree's own path, as git reports it. */
  path: string;
  locked: boolean;
  /** Absent when the worktree is detached or bare. */
  branch?: string;
  /**
   * Accepted unresolved so the two proofs that need no registry do not wait on
   * one. Only the ownership proof joins it (round-1 W2).
   */
  sessions: ProofSourceRead<readonly ProofSessionRecord[]> | Promise<ProofSourceRead<readonly ProofSessionRecord[]>>;
}

export type ProofGitRun = (
  args: readonly string[],
  cwd: string,
) => Promise<{ code: number; stdout: Buffer; timedOut: boolean }>;

export interface OrphanProofDeps {
  git: ProofGitRun;
  /** Bounds the lock read. Injected so the suite never waits on a real timer. */
  wait?: (ms: number) => Deadline;
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
  const [lockAged, branchMerged, ownerGone] = await Promise.all([
    lockProof(subject, deps),
    mergeProof(subject, deps),
    ownerProof(subject),
  ]);
  return { lockAged, ownerGone, branchMerged };
}

async function lockProof(subject: OrphanProofSubject, deps: OrphanProofDeps): Promise<ProofOutcome> {
  if (!subject.locked) {
    return "notApplicable";
  }
  const deadline = (deps.wait ?? afterDelay)(MAX_LOCK_READ_MS);
  try {
    // `git worktree lock` writes this file with or without a reason — zero
    // bytes when there is none, verified on git 2.50.1 — so its presence tracks
    // the lock and its mtime is the lock's age. Content would be no signal.
    //
    // Raced rather than awaited: a read that never returns would otherwise
    // never reach the catch below, and the answer this proof owes on a stalled
    // mount is `unproven`, not silence.
    const mtime = await Promise.race([
      deps.gitDir(subject.path).then((dir) => deps.lockMtime(`${dir}/locked`)),
      deadline.elapsed.then(() => undefined),
    ]);
    if (mtime === undefined) {
      return "unproven";
    }
    return deps.now() - mtime >= LOCK_AGE_MS ? "passed" : "failed";
  } catch {
    // A lock we cannot age is neither stale nor fresh.
    return "unproven";
  } finally {
    deadline.cancel();
  }
}

async function ownerProof(subject: OrphanProofSubject): Promise<ProofOutcome> {
  const sessions = await subject.sessions;
  if (!sessions.ok) {
    return "unproven";
  }
  const here = sessions.value.filter((s) => isPathInside(s.cwd, subject.path));
  // A dead record is evidence NOBODY is here, which is why the removal path
  // reads records the presence reader discards (worktree-removal.md § 4.1).
  if (here.some((s) => s.alive)) {
    return "failed"; // a live owner found is a fact a partial scan cannot weaken
  }
  // Not finding one is only evidence when the scan saw everything. A single
  // EACCES on the live owner's own record would otherwise read as "nobody is
  // here" about the one action that cannot be undone (round-1 W1).
  return sessions.partial === true ? "unproven" : "passed";
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
const DEFAULT_REMOTE = "origin";

export async function resolveDefaultBranch(worktreePath: string, git: ProofGitRun): Promise<string | undefined> {
  const named = await ok(git(["symbolic-ref", "--short", `refs/remotes/${DEFAULT_REMOTE}/HEAD`], worktreePath));
  // `origin/main` → `main`, and `origin/release/2.x` → `release/2.x`. Only the
  // remote's own name is a prefix; everything after it is the branch, slashes
  // included. Slicing after the LAST slash truncates a slash-separated default
  // to its final segment, which is not a local head — so the ladder falls
  // through to `main` and proves against a branch that is not the default
  // (round-1 B1). An answer that does not carry the prefix is not an answer to
  // the question asked, and interpreting it anyway is the same wrong-default bug.
  const fromRemote = named?.startsWith(`${DEFAULT_REMOTE}/`) ? named.slice(DEFAULT_REMOTE.length + 1) : undefined;
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
