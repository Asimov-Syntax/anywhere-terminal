// src/worktree/worktreeWatchTargets.ts — What a repository is watched for.
// See: docs/design/worktree-model.md § 3.5,
//      asimov/changes/cache-and-broadcast-worktree-tree/design.md D3

import type * as vscode from "vscode";
import type { WatcherPool } from "../providers/fsWatcherPool";

export type WorktreeWatchEvent = "create" | "change" | "delete";

export interface WorktreeWatchTarget {
  baseDir: string;
  glob: string;
  events: readonly WorktreeWatchEvent[];
}

/**
 * The three patterns that answer "did this repository's worktree set or any of
 * its heads move" — and nothing else.
 *
 * Every base is the common dir itself, not `<repoId>/worktrees`: a repository
 * with no linked worktrees has no `worktrees/` directory yet, and a watcher
 * based on a directory that does not exist never sees it appear.
 *
 * Each glob matches a single path segment, so `worktrees/<name>/index`,
 * `logs/`, `refs/` and `COMMIT_EDITMSG` — everything an agent writes
 * continuously — match nothing.
 */
export function worktreeWatchTargets(repoId: string): WorktreeWatchTarget[] {
  return [
    { baseDir: repoId, glob: "worktrees/*", events: ["create", "delete"] },
    { baseDir: repoId, glob: "worktrees/*/HEAD", events: ["change"] },
    { baseDir: repoId, glob: "HEAD", events: ["change"] },
  ];
}

export interface WorktreeWatch extends vscode.Disposable {
  /**
   * Present exactly when at least one of the three could not be established,
   * naming each. Two live watchers still leave part of the repository blind,
   * so the caller must not present it as watched.
   */
  readonly failureReason?: string;
}

/**
 * Watch one repository through the shared pool, reporting every structural
 * change on one callback. Disposal releases all three subscriptions and
 * silences any event that arrives afterwards.
 */
export function watchRepoStructure(
  repoId: string,
  pool: Pick<WatcherPool, "subscribePattern">,
  onStructuralChange: () => void,
): WorktreeWatch {
  let disposed = false;
  const subscriptions: vscode.Disposable[] = [];
  const failures: string[] = [];

  const fire = (): void => {
    if (!disposed) {
      onStructuralChange();
    }
  };

  for (const target of worktreeWatchTargets(repoId)) {
    const handlers: Record<string, () => void> = {};
    for (const event of target.events) {
      handlers[event] = fire;
    }
    // W2 and W3 need `change`, which `subscribe()` cannot deliver: it creates
    // its watcher with `ignoreChange` (fsWatcherPool.ts:205) and a branch
    // switch rewrites HEAD in place.
    const subscription = pool.subscribePattern(target.baseDir, target.glob, handlers);
    subscriptions.push(subscription);
    if (!subscription.active) {
      failures.push(subscription.failureReason ?? `could not watch ${target.baseDir}/${target.glob}`);
    }
  }

  return {
    ...(failures.length === 0 ? {} : { failureReason: failures.join("; ") }),
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const subscription of subscriptions) {
        subscription.dispose();
      }
    },
  };
}
