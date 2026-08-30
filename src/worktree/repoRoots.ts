// src/worktree/repoRoots.ts — Workspace folders → deduped repository set.
// See: docs/design/worktree-model.md § 3.2,
//      asimov/changes/enumerate-git-worktrees/design.md D5, D7

import * as path from "node:path";
import type { API } from "../providers/git";
import { isPathInside } from "../utils/pathBoundary";
import type { TrackedPathResolver } from "../utils/resolvedPathMemo";
import { describeGitFailure } from "./describeGitFailure";
import { type GitCapabilities, hasUnsupportedPathFormatEcho } from "./gitCapabilities";
import type { GitCommandResult, GitCommandRunner } from "./gitCommandRunner";

/** Only the two members this module reads, sourced from the vendored API type. */
export type GitApiAccessor = () => Pick<API, "state" | "repositories"> | undefined;

export interface ResolvedRepo {
  /** Normalized absolute git common dir — the grouping key (DESIGN.md D2). */
  repoId: string;
  /** Normalized repository root the git commands ran in. */
  rootPath: string;
}

export interface RepoRootsDeps {
  runner: GitCommandRunner;
  capabilities: GitCapabilities;
  normalize(p: string): Promise<string | null>;
  getGitApi?: GitApiAccessor;
  /**
   * Absent — every comparison below is lexical, exactly as before this existed.
   * Supplied in production, so a folder reached through a symlink matches the
   * repository it resolves INTO rather than the one it is spelled under.
   *
   * The folders are PINNED and the repository roots TRACKED: a repository VS
   * Code closed is the structural event that invalidates a resolution, and only
   * this module is in a position to notice it.
   */
  paths?: TrackedPathResolver;
}

/**
 * Why a workspace folder produced no repository. `absent` is an answer — the
 * folder is not a repository. `failed` is the absence of an answer, and the two
 * must never be merged: the caller retains a repository through `failed` and
 * drops one through `absent`.
 */
export type RepoResolution =
  | { kind: "resolved"; repo: ResolvedRepo }
  | { kind: "absent" }
  | { kind: "failed"; reason: string };

export interface FolderResolution {
  folder: string;
  outcome: RepoResolution;
}

type TopLevel = { kind: "resolved"; root: string } | { kind: "absent" } | { kind: "failed"; reason: string };
type CommonDir = { kind: "resolved"; dir: string } | { kind: "failed"; reason: string };

const PATH_FORMAT_COMMAND = "git rev-parse --path-format=absolute --git-common-dir";
const BARE_COMMON_COMMAND = "git rev-parse --git-common-dir";

/**
 * Matched against `C`-locale stderr, which `createGitCommandRunner` pins for
 * this read. The asymmetry is deliberate: a false `failed` keeps a listing that
 * is already marked stale, a false `absent` deletes it.
 */
function isNotARepository(stderr: string): boolean {
  return stderr.includes("not a git repository");
}

function stdoutText(stdout: Buffer): string {
  return stdout.toString("utf8").trim();
}

/**
 * A resolved toplevel already proved this folder is a repository, so every way
 * the common dir can fail from here is a failure — never an absence.
 */
function commonDirOutcome(result: GitCommandResult, root: string, command: string): CommonDir {
  if (result.code !== 0) {
    return { kind: "failed", reason: describeGitFailure(result, command) };
  }
  const raw = stdoutText(result.stdout);
  if (raw.length === 0) {
    return { kind: "failed", reason: `\`${command}\` returned nothing.` };
  }
  return { kind: "resolved", dir: path.isAbsolute(raw) ? raw : path.resolve(root, raw) };
}

/** Every root VS Code currently has open, as the Git API spells them. */
function openRepoRoots(deps: RepoRootsDeps): readonly string[] {
  const api = deps.getGitApi?.();
  return api?.state === "initialized" ? api.repositories.map((repo) => repo.rootUri.fsPath) : [];
}

/**
 * The repository whose root is the longest prefix of `folder`, or undefined.
 * A repo VS Code already has open saves a `rev-parse` per folder.
 *
 * Compared on where both sides RESOLVE. Both are producer-bounded — the folders
 * the workspace holds, the repositories the API holds — so both are resolved in
 * one pass beforehand and the match here costs no syscall (design.md D1).
 *
 * The value RETURNED is the API's own spelling, not the resolved one: it is
 * handed to git as a cwd and then normalized by `deps.normalize`, and
 * substituting a physical path here would change which directory git runs in.
 */
function matchRepository(folder: string, deps: RepoRootsDeps): string | undefined {
  const resolved = deps.paths?.resolvedOr;
  const at = (p: string) => resolved?.(p) ?? p;
  const candidate = at(folder);
  let best: string | undefined;
  let bestLength = -1;
  for (const root of openRepoRoots(deps)) {
    const rootAt = at(root);
    if (isPathInside(candidate, rootAt) && rootAt.length > bestLength) {
      best = root;
      bestLength = rootAt.length;
    }
  }
  return best;
}

/**
 * A folder that is not a repository is normal; a git that could not answer is
 * not. Collapsing both to "no repository" is what let a timeout read as the
 * user deleting their worktrees (design.md D1).
 */
async function resolveToplevel(folder: string, deps: RepoRootsDeps): Promise<TopLevel> {
  const result = await deps.runner.run(["rev-parse", "--show-toplevel"], folder);
  if (result.timedOut || result.failedToSpawn) {
    return { kind: "failed", reason: describeGitFailure(result, "git rev-parse --show-toplevel") };
  }
  if (result.code !== 0) {
    // Only git's own not-a-repository message is an answer. Ownership refusals,
    // EACCES and broken configuration all exit non-zero too, and reading them
    // as absence is what deletes a listing git merely declined to produce.
    return isNotARepository(result.stderr)
      ? { kind: "absent" }
      : { kind: "failed", reason: describeGitFailure(result, "git rev-parse --show-toplevel") };
  }
  const top = stdoutText(result.stdout);
  return top.length > 0 ? { kind: "resolved", root: top } : { kind: "absent" };
}

async function resolveCommonDir(root: string, deps: RepoRootsDeps): Promise<CommonDir> {
  return deps.capabilities.runWithFallback<CommonDir>(
    "rev-parse-path-format",
    async () => {
      const result = await deps.runner.run(["rev-parse", "--path-format=absolute", "--git-common-dir"], root);
      // design.md D7: an old git accepts the flag, exits 0 and echoes it back.
      // That echo is the only rejection signal — stderr text is locale-bound
      // and, being cached process-wide, would let one repo's failure poison
      // every other repo's fallback.
      if (result.code === 0 && hasUnsupportedPathFormatEcho(result.stdout)) {
        return { supported: false };
      }
      // A genuine failure is this repo's problem, not the flag's.
      return { supported: true, value: commonDirOutcome(result, root, PATH_FORMAT_COMMAND) };
    },
    async () => {
      const result = await deps.runner.run(["rev-parse", "--git-common-dir"], root);
      return commonDirOutcome(result, root, BARE_COMMON_COMMAND);
    },
  );
}

/**
 * One outcome per workspace folder, in workspace-folder order and NOT deduped:
 * the caller retaining a repository through a failure needs to know which folder
 * failed, which a deduped set cannot say.
 */
export async function resolveRepoOutcomes(
  folders: readonly string[],
  deps: RepoRootsDeps,
): Promise<FolderResolution[]> {
  const out: FolderResolution[] = [];

  // One pass over both bounded sets, before any of them is compared. Resolving
  // inside `matchRepository` instead would be a syscall per folder per repo
  // per rebuild, which is the cost half of this change's acceptance (D1, D4).
  await deps.paths?.prepare([...folders, ...openRepoRoots(deps)]);

  for (const folder of folders) {
    out.push({ folder, outcome: await resolveOne(folder, deps) });
  }

  return out;
}

async function resolveOne(folder: string, deps: RepoRootsDeps): Promise<RepoResolution> {
  // A repository VS Code already has open is proof of a repository, so it skips
  // the probe and cannot report absence.
  const matched = matchRepository(folder, deps);
  const top: TopLevel =
    matched === undefined ? await resolveToplevel(folder, deps) : { kind: "resolved", root: matched };
  if (top.kind !== "resolved") {
    return top;
  }

  const commonDir = await resolveCommonDir(top.root, deps);
  if (commonDir.kind === "failed") {
    return commonDir;
  }

  const repoId = await deps.normalize(commonDir.dir);
  const rootPath = await deps.normalize(top.root);
  if (repoId === null || rootPath === null) {
    return { kind: "failed", reason: `Could not resolve a usable path for ${folder}.` };
  }

  return { kind: "resolved", repo: { repoId, rootPath } };
}

/**
 * The resolved repositories only, deduped on the git common dir, so a workspace
 * holding a repo and one of its own linked worktrees yields one group rather
 * than two. Order follows workspace-folder order. Callers that must tell a
 * failure from an absence use {@link resolveRepoOutcomes} instead.
 */
export async function resolveRepoRoots(folders: readonly string[], deps: RepoRootsDeps): Promise<ResolvedRepo[]> {
  return dedupeResolvedRepos(await resolveRepoOutcomes(folders, deps));
}

/**
 * The resolved repositories of `resolutions`, deduped on `repoId` with the
 * first occurrence winning, so folder order survives. Shared by the whole-tree
 * build and by {@link resolveRepoRoots}, which must not disagree about which
 * folder represents a repository two of them name.
 */
export function dedupeResolvedRepos(resolutions: readonly FolderResolution[]): ResolvedRepo[] {
  const byRepoId = new Map<string, ResolvedRepo>();

  for (const { outcome } of resolutions) {
    if (outcome.kind === "resolved" && !byRepoId.has(outcome.repo.repoId)) {
      byRepoId.set(outcome.repo.repoId, outcome.repo);
    }
  }

  return [...byRepoId.values()];
}
