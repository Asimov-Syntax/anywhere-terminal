// src/worktree/worktreeMutations.ts — The mutating git verbs, as argv vectors.
//
// Every value that reaches git is a separate array element, never interpolated
// into a string, and every caller-supplied token is refused when it would read
// as an option. An argv array stops a shell from reinterpreting a value; it does
// NOT stop git from parsing a leading dash as a flag, and those are different
// problems (worktree-actions.md § 7).

import { readsAsFlag } from "../utils/readsAsFlag";
import { describeGitFailure } from "./describeGitFailure";
import type { GitCommandResult, GitCommandRunner } from "./gitCommandRunner";

export type MutationResult = { ok: true; stdout: string } | { ok: false; message: string };

export interface LockRequest {
  repoPath: string;
  worktreePath: string;
  reason: string | undefined;
}

export interface UnlockRequest {
  repoPath: string;
  worktreePath: string;
}

function settle(result: GitCommandResult, command: string): MutationResult {
  if (result.code === 0) {
    return { ok: true, stdout: result.stdout.toString("utf8") };
  }
  return { ok: false, message: reasonFor(result, command) };
}

/**
 * Git's REASON, not its first line of chatter.
 *
 * `git worktree add` writes progress to stderr before it fails —
 * "Preparing worktree (checking out 'feat')" precedes
 * "fatal: 'feat' is already used by worktree at ...". `describeGitFailure`
 * takes the first line, which for these verbs is the useless one, and
 * worktree-rpc.md § 5 surfaces git's own errors precisely because they are the
 * most useful thing we can show. Prefer the fatal/error line when there is one.
 */
function reasonFor(result: GitCommandResult, command: string): string {
  const named = result.stderr
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /^(fatal|error):/i.test(l));
  return named ?? describeGitFailure(result, command);
}

const REFUSED_FLAG_LIKE: MutationResult = {
  ok: false,
  message: "That value starts with “-”, which git would read as an option rather than a value.",
};

export async function lockWorktree(runner: GitCommandRunner, request: LockRequest): Promise<MutationResult> {
  if (readsAsFlag(request.worktreePath) || (request.reason !== undefined && readsAsFlag(request.reason))) {
    return REFUSED_FLAG_LIKE;
  }
  const args =
    request.reason !== undefined && request.reason.length > 0
      ? ["worktree", "lock", "--reason", request.reason, request.worktreePath]
      : ["worktree", "lock", request.worktreePath];
  return settle(await runner.run(args, request.repoPath), "git worktree lock");
}

export async function unlockWorktree(runner: GitCommandRunner, request: UnlockRequest): Promise<MutationResult> {
  if (readsAsFlag(request.worktreePath)) {
    return REFUSED_FLAG_LIKE;
  }
  return settle(
    await runner.run(["worktree", "unlock", request.worktreePath], request.repoPath),
    "git worktree unlock",
  );
}

/** How many registrations a prune would drop, or that the dry run could not say. */
export type PrunableCount = { ok: true; count: number } | { ok: false };

export const pruneRepo = {
  /**
   * How many registrations a prune would drop. From a DRY RUN, because the
   * confirmation has to name the count before the user agrees to it
   * (worktree-actions.md § 3.5) — asking git afterwards would be reporting, not
   * confirming.
   */
  async countPrunable(runner: GitCommandRunner, repoPath: string): Promise<PrunableCount> {
    const result = await runner.run(["worktree", "prune", "--dry-run", "--verbose"], repoPath);
    if (result.code !== 0 || result.timedOut) {
      // A dry run we could not complete is not a count of zero. Reading it as
      // one turned "git refused to answer" into "nothing is stale", which is
      // the same fail-open D16 forbids for removal evidence (round-3 W4).
      return { ok: false };
    }
    // git reports what it WOULD remove on stderr, not stdout — verified against
    // real git, and reading stdout returned 0 for every repo. A confirmation
    // that always said "0 registrations" is exactly the unexplained count
    // worktree-actions.md § 3.5 exists to prevent.
    return {
      ok: true,
      count: result.stderr.split("\n").filter((line) => line.trim().startsWith("Removing ")).length,
    };
  },

  async run(runner: GitCommandRunner, repoPath: string): Promise<MutationResult> {
    return settle(await runner.run(["worktree", "prune"], repoPath), "git worktree prune");
  },
};

// ── Removal ──────────────────────────────────────────────────────────────

/**
 * Removal's own budget. Listing keeps 10 s (worktree-model.md § 6); a recursive
 * delete of a real checkout does not fit in it, and killing an ordinary removal
 * mid-delete would make `indeterminate` the routine outcome rather than the
 * exceptional one — training the user to ignore the one signal that means
 * "state is unclear" (worktree-actions.md:267-269, design.md D5).
 */
export const REMOVE_TIMEOUT_MS = 120_000;

export interface RemoveRequest {
  repoPath: string;
  worktreePath: string;
  /** Only ever true behind a fingerprint the host issued and re-verified. */
  force: boolean;
  /** Git needs `--force --force` to remove a LOCKED worktree; one is not enough. */
  locked: boolean;
  signal?: AbortSignal;
}

/** What was true before the spawn — D11 compares against this, not a directory scan. */
export interface RemovalJournal {
  worktreePath: string;
  wasRegistered: boolean;
  existedOnDisk: boolean;
}

export type RemovalOutcome =
  | { outcome: "ok" }
  | { outcome: "error"; message: string }
  | { outcome: "indeterminate"; observed: string };

export async function removeWorktree(
  runner: GitCommandRunner,
  request: RemoveRequest,
): Promise<{ result: MutationResult; timedOut: boolean }> {
  if (readsAsFlag(request.worktreePath)) {
    return { result: REFUSED_FLAG_LIKE, timedOut: false };
  }
  const args = ["worktree", "remove"];
  if (request.force) {
    // A single --force does NOT override a lock, so the documented
    // "confirm past a lock" path fails outright without the second flag.
    args.push("--force");
    if (request.locked) {
      args.push("--force");
    }
  }
  args.push(request.worktreePath);
  const raw = await runner.run(args, request.repoPath, {
    timeoutMs: REMOVE_TIMEOUT_MS,
    signal: request.signal,
  });
  return { result: settle(raw, "git worktree remove"), timedOut: raw.timedOut };
}

/**
 * What actually happened, judged against the journal.
 *
 * The naive comparison is a FALSE NEGATIVE: a forced removal killed after
 * deleting half the directory leaves both the directory and the registration in
 * place, so "registrations versus filesystem" agrees and would report a clean
 * error over irreversible partial data loss. Unchanged existence is not
 * evidence of unchanged contents (design.md D11).
 */
export function classifyRemoval(input: {
  journal: RemovalJournal;
  timedOut: boolean;
  result: MutationResult;
  /** Null when the rebuild could not obtain an authoritative listing. */
  after: { isRegistered: boolean; existsOnDisk: boolean } | null;
}): RemovalOutcome {
  if (input.timedOut) {
    return {
      outcome: "indeterminate",
      observed: `The removal of ${input.journal.worktreePath} was stopped before git reported an outcome. Part of the folder may already be gone.`,
    };
  }
  if (input.after === null) {
    // The cache retains the last-good registration, so comparing against it
    // proves nothing at all.
    return {
      outcome: "indeterminate",
      observed: `The repository could not be listed after removing ${input.journal.worktreePath}, so what changed is unknown.`,
    };
  }
  if (input.result.ok) {
    if (input.after.isRegistered || input.after.existsOnDisk) {
      return {
        outcome: "indeterminate",
        observed: `Git reported success, but ${input.journal.worktreePath} is still ${input.after.isRegistered ? "registered" : "on disk"}.`,
      };
    }
    return { outcome: "ok" };
  }
  // A non-zero exit that nonetheless moved state is not a clean failure.
  if (input.journal.existedOnDisk && !input.after.existsOnDisk) {
    return {
      outcome: "indeterminate",
      observed: `Git reported an error, but ${input.journal.worktreePath} is gone from disk: ${input.result.message}`,
    };
  }
  if (input.journal.wasRegistered && !input.after.isRegistered) {
    return {
      outcome: "indeterminate",
      observed: `Git reported an error, but the registration for ${input.journal.worktreePath} is gone: ${input.result.message}`,
    };
  }
  return { outcome: "error", message: input.result.message };
}

// ── Create ───────────────────────────────────────────────────────────────

/** What the create is checking out. `agent` is not a mode here — see D9. */
export type CreateSource =
  | { kind: "newBranch"; branch: string; baseRef?: string }
  | { kind: "existingBranch"; branch: string }
  | { kind: "detached"; ref: string };

export interface CreateRequest {
  repoPath: string;
  /** Already validated by createPath.ts — this does not re-validate it. */
  worktreePath: string;
  source: CreateSource;
}

/**
 * No `--force`, deliberately. Git's own refusal — "is already checked out",
 * "already exists" — is the most useful thing we can show, and forcing past it
 * would silently do something the user did not ask for (worktree-rpc.md § 5).
 */
/**
 * Does git accept this as a branch name?
 *
 * Asked of git rather than reimplemented: `check-ref-format`'s rules are long,
 * version-dependent and easy to get subtly wrong, and a validator that is
 * merely close is worse than none — it rejects names git would take. That was
 * the whole objection to the round-3 fix, and it does not apply to ASKING
 * (round-4 W9). `null` means git could not be asked, which is not a refusal:
 * the create then proceeds and git refuses it directly, exactly as before.
 */
export async function branchNameIsValid(
  runner: GitCommandRunner,
  repoPath: string,
  branch: string,
): Promise<boolean | null> {
  if (readsAsFlag(branch)) {
    return false;
  }
  const result = await runner.run(["check-ref-format", "--branch", branch], repoPath);
  if (result.timedOut || result.failedToSpawn) {
    return null;
  }
  return result.code === 0;
}

export async function createWorktree(runner: GitCommandRunner, request: CreateRequest): Promise<MutationResult> {
  const tokens = [request.worktreePath, ...sourceTokens(request.source)];
  if (tokens.some(readsAsFlag)) {
    return REFUSED_FLAG_LIKE;
  }
  const args = ["worktree", "add"];
  switch (request.source.kind) {
    case "newBranch":
      args.push("-b", request.source.branch, request.worktreePath);
      if (request.source.baseRef !== undefined) {
        args.push(request.source.baseRef);
      }
      break;
    case "existingBranch":
      args.push(request.worktreePath, request.source.branch);
      break;
    case "detached":
      args.push("--detach", request.worktreePath, request.source.ref);
      break;
  }
  return settle(await runner.run(args, request.repoPath), "git worktree add");
}

function sourceTokens(source: CreateSource): string[] {
  switch (source.kind) {
    case "newBranch":
      return source.baseRef !== undefined ? [source.branch, source.baseRef] : [source.branch];
    case "existingBranch":
      return [source.branch];
    case "detached":
      return [source.ref];
  }
}

// ── Reattach ─────────────────────────────────────────────────────────────

export interface RepairRequest {
  repoPath: string;
  /** Already validated by createPath.ts as an existing directory. */
  worktreePath: string;
}

/**
 * Rewrite a stale registration's two-way link, in place.
 *
 * No `--force` and no fallback to `git worktree add`. `repair` only rewrites
 * the link between an administrative entry and a directory; `add` against the
 * same path is a different action that writes a working tree, and reaching for
 * it where the repair could not be made would destroy the checkout this exists
 * to keep (worktree-create.md § 6).
 */
export async function repairWorktree(runner: GitCommandRunner, request: RepairRequest): Promise<MutationResult> {
  if (readsAsFlag(request.worktreePath)) {
    return REFUSED_FLAG_LIKE;
  }
  return settle(
    await runner.run(["worktree", "repair", request.worktreePath], request.repoPath),
    "git worktree repair",
  );
}

/**
 * The DIRECTORY's own `HEAD` commit, asked of the directory itself.
 *
 * `undefined` when git could not say — a refusal, a timeout, or a zero exit
 * with nothing on stdout. An empty string is not an oid, and answering one
 * would let a comparison against an equally empty expectation pass.
 */
export async function worktreeHeadOid(runner: GitCommandRunner, worktreePath: string): Promise<string | undefined> {
  if (readsAsFlag(worktreePath)) {
    return undefined;
  }
  const result = await runner.run(["rev-parse", "HEAD"], worktreePath);
  if (result.code !== 0 || result.timedOut || result.failedToSpawn) {
    return undefined;
  }
  const oid = result.stdout.toString("utf8").trim();
  return oid.length === 0 ? undefined : oid;
}

/** Every registration git STILL reports prunable, spelled as git spells them. */
