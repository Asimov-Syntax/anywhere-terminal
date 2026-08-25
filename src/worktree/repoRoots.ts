// src/worktree/repoRoots.ts — Workspace folders → deduped repository set.
// See: docs/design/worktree-model.md § 3.2,
//      asimov/changes/enumerate-git-worktrees/design.md D5, D7

import * as path from "node:path";
import type { API } from "../providers/git";
import { isPathInside } from "../utils/pathBoundary";
import { type GitCapabilities, hasUnsupportedPathFormatEcho } from "./gitCapabilities";
import type { GitCommandRunner } from "./gitCommandRunner";

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
}

function stdoutText(stdout: Buffer): string {
  return stdout.toString("utf8").trim();
}

/**
 * The repository whose root is the longest prefix of `folder`, or undefined.
 * A repo VS Code already has open saves a `rev-parse` per folder.
 */
function matchRepository(folder: string, deps: RepoRootsDeps): string | undefined {
  const api = deps.getGitApi?.();
  if (api?.state !== "initialized") {
    return undefined;
  }
  let best: string | undefined;
  for (const repo of api.repositories) {
    const root = repo.rootUri.fsPath;
    if (isPathInside(folder, root)) {
      if (best === undefined || root.length > best.length) {
        best = root;
      }
    }
  }
  return best;
}

async function resolveToplevel(folder: string, deps: RepoRootsDeps): Promise<string | undefined> {
  const result = await deps.runner.run(["rev-parse", "--show-toplevel"], folder);
  // A folder that is not a repository is normal, not an unreadable reason.
  if (result.code !== 0) {
    return undefined;
  }
  const top = stdoutText(result.stdout);
  return top.length > 0 ? top : undefined;
}

async function resolveCommonDir(root: string, deps: RepoRootsDeps): Promise<string | null> {
  return deps.capabilities.runWithFallback<string | null>(
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
      return { supported: true, value: result.code === 0 ? stdoutText(result.stdout) : null };
    },
    async () => {
      const result = await deps.runner.run(["rev-parse", "--git-common-dir"], root);
      if (result.code !== 0) {
        return null;
      }
      const raw = stdoutText(result.stdout);
      if (raw.length === 0) {
        return null;
      }
      return path.isAbsolute(raw) ? raw : path.resolve(root, raw);
    },
  );
}

/**
 * Resolve each workspace folder to its repository and dedupe on the git common
 * dir, so a workspace holding a repo and one of its own linked worktrees yields
 * one group rather than two. Order follows workspace-folder order.
 */
export async function resolveRepoRoots(folders: readonly string[], deps: RepoRootsDeps): Promise<ResolvedRepo[]> {
  const byRepoId = new Map<string, ResolvedRepo>();

  for (const folder of folders) {
    const root = matchRepository(folder, deps) ?? (await resolveToplevel(folder, deps));
    if (root === undefined) {
      continue;
    }

    const commonDir = await resolveCommonDir(root, deps);
    if (commonDir === null) {
      continue;
    }

    const repoId = await deps.normalize(commonDir);
    const rootPath = await deps.normalize(root);
    if (repoId === null || rootPath === null || byRepoId.has(repoId)) {
      continue;
    }

    byRepoId.set(repoId, { repoId, rootPath });
  }

  return [...byRepoId.values()];
}
