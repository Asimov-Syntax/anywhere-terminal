// src/providers/WorktreeHost.ts — The window's owner of worktree freshness.
// See: docs/design/worktree-rpc.md § 1, § 2,
//      asimov/changes/cache-and-broadcast-worktree-tree/design.md D1, D6, D7
//
// One host per window, constructed beside the watcher pool. Surfaces attach to
// it; attaching costs no git command and no watcher, so a second panel showing
// the same tree is free.

import type * as vscode from "vscode";
import type { ExtensionToWebViewMessage, WebViewToExtensionMessage } from "../types/messages";
import { hasGitRepo } from "../worktree/hasGitRepo";
import type { WorktreePresence } from "../worktree/presenceTypes";
import { createRebuildGate, type RebuildGateClock } from "../worktree/rebuildGate";
import { createWorktreeCache } from "../worktree/WorktreeCache";
import { buildWorktreeTreeDetailed, listRepoWorktrees, type WorktreeTreeDeps } from "../worktree/WorktreeDiscovery";
import { type WorktreeWatch, watchRepoStructure } from "../worktree/worktreeWatchTargets";
import type { WatcherPool } from "./fsWatcherPool";

const LOG_PREFIX = "[worktree-host]";

/** The gate scope that rebuilds every repository; any other scope is a repoId. */
export const WHOLE_TREE_SCOPE = "*";

export interface WorktreeSurface {
  isReady(): boolean;
  post(message: ExtensionToWebViewMessage): void;
}

export interface WorktreeHostOptions {
  deps: WorktreeTreeDeps;
  /** Read at rebuild time, not captured: folders change while the window lives. */
  workspaceFolders(): readonly string[];
  pool: Pick<WatcherPool, "subscribePattern">;
  /** `vscode.workspace.onDidChangeWorkspaceFolders`, injected for testability. */
  onDidChangeWorkspaceFolders?(listener: () => void): vscode.Disposable;
  clock?: RebuildGateClock;
  now?(): number;
  /** Path-existence probe behind `initPayload`, injected in tests. */
  exists?(p: string): boolean;
}

/**
 * Init-message fields the worktree host contributes. Providers spread this into
 * their `init` payload so the panel can pick its opening view before it paints —
 * the host pushes nothing to a surface that has not declared the view visible,
 * so a webview that opened on the wrong body could never learn it had.
 */
export interface WorktreeInitPayload {
  /** At least one workspace folder is inside a git repository. */
  worktreeHasRepo: boolean;
}

export interface WorktreeHost extends vscode.Disposable {
  /** Fields this host contributes to a surface's `init` message. */
  initPayload(): WorktreeInitPayload;
  /** Register one surface. Disposing detaches only that surface. */
  attach(surface: WorktreeSurface): vscode.Disposable;
  /** Route an inbound worktree message from `surface`. Unknown types ignored. */
  handleMessage(surface: WorktreeSurface, msg: WebViewToExtensionMessage): void;
}

interface SurfaceState {
  /**
   * False until the surface says otherwise. All three surfaces retain their DOM
   * while hidden, so a default of true would post into panels that have never
   * shown the view — the cost this gate exists to avoid.
   */
  visible: boolean;
}

export function createWorktreeHost(options: WorktreeHostOptions): WorktreeHost {
  const now = options.now ?? Date.now;
  const cache = createWorktreeCache();
  const surfaces = new Map<WorktreeSurface, SurfaceState>();
  const watches = new Map<string, WorktreeWatch>();
  let built = false;
  let disposed = false;

  /** WT-004.0 supplies the projection; until then the envelope is final but empty. */
  function presence(): WorktreePresence {
    return { rowsByWorktreeId: {}, scannedAt: now(), degradedSources: [] };
  }

  function broadcast(): void {
    if (disposed) {
      return;
    }
    const message: ExtensionToWebViewMessage = {
      type: "worktreeTreeResponse",
      tree: cache.read(),
      presence: presence(),
    };
    for (const [surface, state] of surfaces) {
      if (!state.visible || !surface.isReady()) {
        continue;
      }
      try {
        surface.post(message);
      } catch (err) {
        console.warn(`${LOG_PREFIX} surface post threw — continuing broadcast`, err);
      }
    }
  }

  /**
   * One rebuild, then one push. Broadcasting from inside the gate's run — not
   * from each caller after awaiting — is what makes two concurrent requests
   * produce a single push rather than one each.
   */
  async function rebuild(scope: string): Promise<void> {
    if (disposed) {
      return;
    }
    if (scope === WHOLE_TREE_SCOPE) {
      cache.applyBuild(await buildWorktreeTreeDetailed(options.workspaceFolders(), options.deps));
      built = true;
      reconcileWatches();
    } else {
      const root = cache.rootFor(scope);
      if (root) {
        cache.applyRepo(scope, await listRepoWorktrees(root.rootPath, options.deps), options.deps.rank);
      }
    }
    broadcast();
  }

  const gate = createRebuildGate(rebuild, options.clock);

  /**
   * Bring the watch set in line with the repositories the cache now holds. An
   * already-watched repository keeps its subscriptions, so neither a rebuild
   * nor a second surface creates another watcher.
   */
  function reconcileWatches(): void {
    const wanted = new Set(cache.roots().map((root) => root.repoId));
    for (const [repoId, watch] of watches) {
      if (!wanted.has(repoId)) {
        watch.dispose();
        watches.delete(repoId);
      }
    }
    for (const repoId of wanted) {
      if (!watches.has(repoId)) {
        watches.set(
          repoId,
          watchRepoStructure(repoId, options.pool, () => {
            // `signal`: git state moved, so a rebuild already running cannot
            // answer this one — it may have read git before the move.
            void gate.request(repoId, { signal: true });
          }),
        );
      }
    }
    for (const [repoId, watch] of watches) {
      // A rebuild just cleared this repo's `degraded`, and an unestablished
      // watch means the listing it produced can go stale unnoticed. Saying so
      // is the difference between a stale tree and a tree known to be stale.
      if (watch.failureReason !== undefined) {
        cache.applyRepo(repoId, {
          worktrees: [],
          reasons: [],
          skipped: 0,
          degraded: `This repository is not being watched, so its worktrees may be out of date: ${watch.failureReason}`,
        });
      }
    }
  }

  const folderSub = options.onDidChangeWorkspaceFolders?.(() => {
    // Forced: the folder set moved, so the cached tree is known wrong. The
    // floor bounds signal noise, not a change the user just made.
    void gate.request(WHOLE_TREE_SCOPE, { force: true });
  });

  function attach(surface: WorktreeSurface): vscode.Disposable {
    surfaces.set(surface, { visible: false });
    return { dispose: () => surfaces.delete(surface) };
  }

  function handleMessage(surface: WorktreeSurface, msg: WebViewToExtensionMessage): void {
    const state = surfaces.get(surface);
    if (disposed || !state) {
      return;
    }
    switch (msg.type) {
      case "worktreeViewVisibility":
        state.visible = msg.visible;
        return;
      case "requestWorktreeTree":
        // Nothing to serve before the first build, whatever the caller asked for.
        if (msg.force === true || !built) {
          void gate.request(WHOLE_TREE_SCOPE, { force: msg.force === true });
          return;
        }
        broadcast();
        return;
      default:
        return;
    }
  }

  return {
    // Folders are read here, not captured: a window that gained one since the
    // last init answers for the folder set the surface is booting against.
    initPayload: () => ({ worktreeHasRepo: hasGitRepo(options.workspaceFolders(), options.exists) }),
    attach,
    handleMessage,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      gate.dispose();
      folderSub?.dispose();
      for (const watch of watches.values()) {
        watch.dispose();
      }
      watches.clear();
      surfaces.clear();
    },
  };
}
