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
 * The four patterns that answer "did this repository's worktree set or any of
 * its heads move" — and nothing else.
 *
 * Watchers based on missing paths begin monitoring once those paths are
 * created, so the linked-worktree metadata directory can be its own base.
 *
 * The patterns narrow reported events, but a glob with path segments is still
 * recursive at the watcher layer. Only the linked-worktree HEAD pattern is
 * recursive, scoped to the linked-worktree metadata directory.
 */
export function worktreeWatchTargets(repoId: string): WorktreeWatchTarget[] {
  const worktreesDir = `${repoId}/worktrees`;
  return [
    { baseDir: repoId, glob: "HEAD", events: ["change"] },
    { baseDir: repoId, glob: "worktrees", events: ["create", "delete"] },
    { baseDir: worktreesDir, glob: "*", events: ["create", "delete"] },
    { baseDir: worktreesDir, glob: "*/HEAD", events: ["change"] },
  ];
}

export interface WorktreeWatch extends vscode.Disposable {
  /**
   * Present exactly when at least one of the four could not be established,
   * naming each. Remaining live watchers still leave part of the repository blind,
   * so the caller must not present it as watched.
   */
  readonly failureReason?: string;
}

/**
 * Watch one repository through the shared pool, reporting every structural
 * change on one callback. Disposal releases all four subscriptions and
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
    // W1 and W4 need `change`, which `subscribe()` cannot deliver: it creates
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
