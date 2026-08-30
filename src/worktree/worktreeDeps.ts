// src/worktree/worktreeDeps.ts — The production wiring for worktree discovery.
// See: asimov/changes/cache-and-broadcast-worktree-tree/design.md D9
//
// `buildWorktreeTree` injects every dependency it has, which kept WT-001.1
// testable but left no production caller. This is that caller: one place where
// the real git, the real filesystem, and the real platform are bound, so the
// host takes assembled deps and tests drive it with fakes.

import * as fs from "node:fs/promises";
import type { ResolvedPathMemo } from "../utils/resolvedPathMemo";
import { createGitCapabilities } from "./gitCapabilities";
import { createGitCommandRunner, type GitCommandRunnerOptions } from "./gitCommandRunner";
import { normalizeWorktreePath } from "./normalizePath";
import { createRepoPathResolver } from "./repoRoots";
import type { WorktreeTreeDeps } from "./WorktreeDiscovery";

export interface CreateWorktreeTreeDepsOptions {
  /** Forwarded to the git runner — mainly to shorten the timeout in tests. */
  git?: GitCommandRunnerOptions;
  /**
   * Where the window's paths resolve. Absent — discovery matches repositories
   * lexically, exactly as before. Supplied in production from the window's one
   * memo, so a workspace folder reached through a symlink matches the
   * repository it resolves into.
   */
  pathMemo?: ResolvedPathMemo;
}

/**
 * Assemble the real discovery dependencies. The capability cache lives on the
 * returned object, so one call per window keeps the `-z` and `--path-format`
 * probes shared across every repository.
 */
export function createWorktreeTreeDeps(options: CreateWorktreeTreeDepsOptions = {}): WorktreeTreeDeps {
  const runner = createGitCommandRunner(options.git ?? {});
  return {
    runner,
    capabilities: createGitCapabilities(runner),
    normalize: (p) => normalizeWorktreePath(p),
    stat: (p) => fs.stat(p),
    ...(options.pathMemo ? { paths: createRepoPathResolver(options.pathMemo) } : {}),
  };
}
