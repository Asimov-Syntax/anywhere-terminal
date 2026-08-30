// src/providers/gitDecorationProvider.ts — Subscribes to the built-in
// `vscode.git` extension and exposes per-path git status with revision
// stamps for snapshot + delta plumbing into the webview file tree.
//
// See: asimov/changes/add-file-tree-git-decorations/design.md D1, D2, D9, D10, D12
//      asimov/changes/add-file-tree-git-decorations/specs/git-decoration-source/spec.md
//      docs/research/20260523-vscode-git-decorations.md
//
// Lifecycle (D9):
//   1. extension absent           → retry on `extensions.onDidChange`
//   2. not activated              → await ext.activate()
//   3. enabled === false          → wait on `onDidChangeEnablement`
//   4. api.state === uninitialized → wait on `api.onDidChangeState`
//   5. any throw                  → log once at WARN, permanent no-op
//
// Per-repo maps (D12) keyed by `repository.rootUri.fsPath`; `onDidClose`
// drops the entire sub-map by key — no `startsWith` walk, so sibling repos
// with overlapping prefixes (e.g. `/work/repo` vs `/work/repo-foo`) survive.
//
// Revision counter (D10) monotonically increments per emitted delta — the
// webview rejects out-of-order applies based on this stamp.

import * as vscode from "vscode";
import type { GitStatus } from "../types/messages";
import { isPathInside, isWindowsAbsPath, normalizePathForCompare } from "../utils/pathBoundary";
import type { TrackedPathResolver } from "../utils/resolvedPathMemo";
import type { API, GitExtension, Repository } from "./git";
import { mapStatus, pickHigherSeverity } from "./gitStatusMapping";

const LOG_PREFIX = "[AnyWhere Terminal][git-decorations]";

export interface GitStatusDelta {
  revision: number;
  changes: ReadonlyArray<{ path: string; status: GitStatus | null }>;
}

export interface GitDecorationProvider {
  /** Current status + revision for an absolute path. status === undefined when not decorated. */
  getStatus(absPath: string): { status: GitStatus | undefined; revision: number };

  /**
   * Aggregate descendant dirty counts for a folder — every dirty path the
   * provider currently knows about that falls under `folderAbsPath`, grouped
   * by propagating status. `deleted` and `ignored` are excluded (they don't
   * propagate per design D6). Returns `undefined` when there are no dirty
   * descendants.
   *
   * Used by the host to pre-stamp directory FileEntry rows so the webview
   * can render the correct folder badge color BEFORE the user expands the
   * directory — matches VS Code Explorer behaviour. See:
   * asimov/changes/add-file-tree-fs-watcher/design.md D11.
   */
  getDescendantBuckets(folderAbsPath: string): Partial<Record<GitStatus, number>> | undefined;

  /** Current global revision (used by the host when stamping snapshot entries that have no status). */
  currentRevision(): number;

  /** Subscribe to incremental deltas; whole batch shares one revision. */
  onDidChange(listener: (delta: GitStatusDelta) => void): vscode.Disposable;

  /**
   * Clear all per-repo maps and emit a delta nulling every previously-decorated
   * path. Used on workspace root change so the webview never sees stale state.
   */
  reset(): void;

  dispose(): void;
}

/**
 * Returns the list of workspace folder root fsPaths. The provider filters
 * emitted delta paths to ensure only paths under one of these roots reach
 * the webview — keeps `pendingStatuses` bounded by what the user can actually
 * see in the tree and tightens the path-info leak envelope (it would otherwise
 * include auto-detected non-workspace repos via `git.autoRepositoryDetection`).
 * See: round-1 review W1 / SUGGEST follow-up.
 */
export type WorkspaceFolderProvider = () => ReadonlyArray<string>;

export interface CreateGitDecorationProviderOptions {
  /**
   * Optional injection for tests so we don't have to monkey-patch
   * `vscode.extensions` globally. Defaults to `() => vscode.extensions.getExtension('vscode.git')`.
   */
  readonly getExtension?: () => vscode.Extension<GitExtension> | undefined;
  /**
   * Optional injection for the `vscode.extensions.onDidChange` retry hook.
   * Defaults to the real API.
   */
  readonly onDidChangeExtensions?: vscode.Event<void>;
  /**
   * Inject custom warn/info loggers. Production callers should pass nothing —
   * we'll log to `console.*` with the standard `[AnyWhere Terminal]` prefix.
   */
  readonly logger?: {
    info(msg: string): void;
    warn(msg: string, err?: unknown): void;
  };
  /**
   * Inject a workspace-folder lookup. Defaults to
   * `vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath)`. When the
   * returned list is empty, emission is NOT filtered — covers no-workspace
   * sessions where the tree can still re-root anywhere.
   */
  readonly getWorkspaceFolders?: WorkspaceFolderProvider;
  /**
   * Inject `vscode.workspace.onDidChangeWorkspaceFolders` so the provider can
   * own its own reset on workspace folder change (O-W3 — keeps the reset
   * fan-out at exactly one even when multiple FileTreeHosts share the
   * provider). Tests pass a custom event to drive folder changes.
   */
  readonly onDidChangeWorkspaceFolders?: vscode.Event<unknown>;
  /**
   * Where the window's paths resolve. Absent — containment is decided lexically,
   * exactly as before this existed.
   *
   * Only the FOLDERS are resolved. The decorated path arrives per file per git
   * refresh, so resolving it would be the unbounded syscall per comparison the
   * acceptance forbids; the root side is the producer-bounded half (design.md D1).
   */
  readonly paths?: TrackedPathResolver;
}

const defaultLogger = {
  info: (msg: string) => console.log(`${LOG_PREFIX} ${msg}`),
  warn: (msg: string, err?: unknown) => {
    if (err !== undefined) {
      console.warn(`${LOG_PREFIX} ${msg}`, err);
    } else {
      console.warn(`${LOG_PREFIX} ${msg}`);
    }
  },
};

export function createGitDecorationProvider(options: CreateGitDecorationProviderOptions = {}): GitDecorationProvider {
  const logger = options.logger ?? defaultLogger;
  const getExtension = options.getExtension ?? (() => vscode.extensions.getExtension<GitExtension>("vscode.git"));
  const onDidChangeExtensions = options.onDidChangeExtensions ?? vscode.extensions.onDidChange;
  const getWorkspaceFolders: WorkspaceFolderProvider =
    options.getWorkspaceFolders ?? (() => vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? []);
  const onDidChangeWorkspaceFolders: vscode.Event<unknown> =
    options.onDidChangeWorkspaceFolders ?? (vscode.workspace.onDidChangeWorkspaceFolders as vscode.Event<unknown>);

  /**
   * Path-boundary containment; the edge cases it survives are documented on
   * `isPathInside` in ../utils/pathBoundary.
   *
   * When no workspace folder is open we let everything through (the tree
   * can re-root anywhere in terminal-adjacent mode).
   *
   * See: round-2 oracle review O-M1.
   */
  function isUnderAnyWorkspaceFolder(absPath: string): boolean {
    const folders = getWorkspaceFolders();
    if (folders.length === 0) {
      return true;
    }
    // The folder side is resolved from the pass `resolveFolders` already ran;
    // `absPath` is left as it is spelled, per D1. `resolvedOr` is a map read,
    // so a folder nothing has resolved yet answers exactly as it did before.
    return folders.some((rawRoot) => isPathInside(absPath, options.paths?.resolvedOr(rawRoot) ?? rawRoot));
  }

  /**
   * Resolve the workspace folders, forgetting the ones that have gone.
   *
   * Fire-and-forget on purpose: the comparison above must stay synchronous, and
   * until this settles it answers lexically — which is exactly the behaviour
   * that shipped before. Awaiting it at the change event instead would put the
   * provider's reset behind a syscall.
   */
  function resolveFolders(): void {
    void options.paths?.prepare([], getWorkspaceFolders());
  }

  // Per-repository status maps keyed by rootUri.fsPath. The merged view is
  // computed on demand by `getStatus`.
  const repoMaps = new Map<string, Map<string, GitStatus>>();
  // Per-path revision at which the current value was set.
  const revisions = new Map<string, number>();
  let revision = 0;

  // Listener side of the public `onDidChange`. We use a tiny in-process emitter
  // instead of `vscode.EventEmitter` so the unit test surface doesn't need to
  // stub that class — the real runtime semantics (subscribe / dispose / fire-
  // to-many) are equivalent for our purposes.
  const listeners = new Set<(delta: GitStatusDelta) => void>();
  function fireDelta(delta: GitStatusDelta) {
    for (const l of listeners) {
      try {
        l(delta);
      } catch (err) {
        logger.warn("listener threw — continuing", err);
      }
    }
  }

  // Per-repo `state.onDidChange` subscriptions.
  const repoSubs = new Map<string, vscode.Disposable>();

  // Lifecycle subscriptions that the acquisition flow may install. Disposed on
  // first successful acquisition AND on provider.dispose().
  const lifecycleSubs: vscode.Disposable[] = [];

  // Persistent subscriptions that outlive the acquisition lifecycle. These
  // are disposed only on `provider.dispose()`, NOT by `disposeLifecycleSubs`
  // (which `bindApi` calls to release the retry/enablement/state subs once
  // the API is acquired).
  const persistentSubs: vscode.Disposable[] = [];

  let disposed = false;
  let api: API | undefined;
  // Once a permanent no-op state is reached (extension throws), don't retry.
  let permanentlyDisabled = false;
  let activationInFlight = false;
  let waitingForEnablement = false;
  let waitingForState = false;

  function disposeLifecycleSubs() {
    while (lifecycleSubs.length > 0) {
      try {
        lifecycleSubs.pop()?.dispose();
      } catch {
        // ignore
      }
    }
    waitingForEnablement = false;
    waitingForState = false;
  }

  // --- Acquisition pipeline ------------------------------------------------

  function tryAcquire(): void {
    if (
      disposed ||
      permanentlyDisabled ||
      api !== undefined ||
      activationInFlight ||
      waitingForEnablement ||
      waitingForState
    ) {
      return;
    }
    let ext: vscode.Extension<GitExtension> | undefined;
    try {
      ext = getExtension();
    } catch (err) {
      logger.warn("extensions.getExtension threw — disabling git decorations", err);
      permanentlyDisabled = true;
      disposeLifecycleSubs();
      return;
    }
    if (!ext) {
      // Case 1: extension absent — install onDidChange retry once.
      if (lifecycleSubs.length === 0) {
        lifecycleSubs.push(onDidChangeExtensions(() => tryAcquire()));
        logger.info("vscode.git extension not found — will retry on extensions.onDidChange");
      }
      return;
    }

    // Case 2: extension present but not activated.
    void activateAndContinue(ext);
  }

  async function activateAndContinue(ext: vscode.Extension<GitExtension>): Promise<void> {
    if (disposed || permanentlyDisabled || api !== undefined || activationInFlight) {
      return;
    }
    activationInFlight = true;
    let gitExt: GitExtension;
    try {
      gitExt = await ext.activate();
    } catch (err) {
      logger.warn("vscode.git extension activate() threw — disabling git decorations", err);
      permanentlyDisabled = true;
      disposeLifecycleSubs();
      return;
    } finally {
      activationInFlight = false;
    }
    if (disposed) {
      return;
    }

    // Case 3: enabled === false. Wait for enablement to flip.
    if (!gitExt.enabled) {
      if (waitingForEnablement) {
        return;
      }
      waitingForEnablement = true;
      logger.info("vscode.git is disabled by user — waiting for enablement");
      const sub = gitExt.onDidChangeEnablement((enabled) => {
        if (enabled) {
          waitingForEnablement = false;
          sub.dispose();
          const idx = lifecycleSubs.indexOf(sub);
          if (idx >= 0) {
            lifecycleSubs.splice(idx, 1);
          }
          void activateAndContinue(ext);
        }
      });
      lifecycleSubs.push(sub);
      return;
    }

    let acquired: API;
    try {
      acquired = gitExt.getAPI(1);
    } catch (err) {
      logger.warn("vscode.git getAPI(1) threw — disabling git decorations", err);
      permanentlyDisabled = true;
      disposeLifecycleSubs();
      return;
    }

    // Case 4: api.state === 'uninitialized'. Wait for the state to flip.
    if (acquired.state === "uninitialized") {
      if (waitingForState) {
        return;
      }
      waitingForState = true;
      logger.info("vscode.git API state=uninitialized — waiting for onDidChangeState");
      const sub = acquired.onDidChangeState((state) => {
        if (state === "initialized") {
          waitingForState = false;
          sub.dispose();
          const idx = lifecycleSubs.indexOf(sub);
          if (idx >= 0) {
            lifecycleSubs.splice(idx, 1);
          }
          bindApi(acquired);
        }
      });
      lifecycleSubs.push(sub);
      return;
    }

    bindApi(acquired);
  }

  function bindApi(acquired: API): void {
    if (disposed || api !== undefined) {
      return;
    }
    api = acquired;
    // We've successfully attached — release any lifecycle subs left over from
    // the retry / enablement / state-wait phases.
    disposeLifecycleSubs();

    // Subscribe to existing + future repositories.
    for (const repo of acquired.repositories) {
      attachRepo(repo);
    }
    const openSub = acquired.onDidOpenRepository((repo) => attachRepo(repo));
    const closeSub = acquired.onDidCloseRepository((repo) => detachRepo(repo));
    lifecycleSubs.push(openSub, closeSub);
  }

  // --- Per-repo subscription ----------------------------------------------

  function attachRepo(repo: Repository): void {
    const key = repo.rootUri.fsPath;
    if (repoSubs.has(key)) {
      return;
    }
    const rebuild = () => rebuildRepoMap(repo);
    const sub = repo.state.onDidChange(rebuild);
    repoSubs.set(key, sub);
    rebuild();
  }

  function detachRepo(repo: Repository): void {
    const key = repo.rootUri.fsPath;
    const sub = repoSubs.get(key);
    if (sub) {
      try {
        sub.dispose();
      } catch {
        // ignore
      }
      repoSubs.delete(key);
    }
    const oldMap = repoMaps.get(key);
    if (!oldMap || oldMap.size === 0) {
      repoMaps.delete(key);
      return;
    }
    // Drop the whole sub-map; emit a delta only for paths whose merged
    // status actually changes (O-L1). Paths where another repo claimed an
    // equal-or-higher severity status would otherwise emit a redundant
    // restatement of the surviving value.
    repoMaps.delete(key);
    const changes: Array<{ path: string; status: GitStatus | null }> = [];
    for (const [absPath, closingStatus] of oldMap) {
      const merged = computeMergedStatus(absPath);
      // The previous merged value (before detach) is closingStatus combined
      // with whatever other repos contribute. `closingStatus` is undefined
      // in oldMap iteration when... actually iterating Map entries always
      // gives the present value, so closingStatus is defined here.
      const otherBest = merged; // After detach, only other repos remain.
      const prevMerged = otherBest === undefined ? closingStatus : pickHigherSeverity(closingStatus, otherBest);
      if (merged === prevMerged) {
        continue;
      }
      changes.push({ path: absPath, status: merged ?? null });
    }
    if (changes.length > 0) {
      emit(changes);
    }
  }

  function computeMergedStatus(absPath: string): GitStatus | undefined {
    let best: GitStatus | undefined;
    for (const m of repoMaps.values()) {
      const v = m.get(absPath);
      if (!v) {
        continue;
      }
      best = best === undefined ? v : pickHigherSeverity(best, v);
    }
    return best;
  }

  function rebuildRepoMap(repo: Repository): void {
    if (disposed) {
      return;
    }
    const key = repo.rootUri.fsPath;
    const oldMap = repoMaps.get(key) ?? new Map<string, GitStatus>();
    const newMap = new Map<string, GitStatus>();

    const consume = (changes: ReadonlyArray<{ uri: { fsPath: string }; status: number }> | undefined) => {
      if (!changes) {
        return;
      }
      for (const c of changes) {
        const mapped = mapStatus(c.status);
        const existing = newMap.get(c.uri.fsPath);
        newMap.set(c.uri.fsPath, existing ? pickHigherSeverity(existing, mapped) : mapped);
      }
    };

    consume(repo.state.workingTreeChanges);
    consume(repo.state.indexChanges);
    consume(repo.state.mergeChanges);
    consume(repo.state.untrackedChanges);

    repoMaps.set(key, newMap);

    // Compute the delta against `oldMap` joined with other repos.
    const delta: Array<{ path: string; status: GitStatus | null }> = [];
    // Paths in the new map that changed value OR are new.
    for (const [absPath, _status] of newMap) {
      const oldStatus = oldMap.get(absPath);
      // We also need to consider whether another repo's claim on this path
      // changes the merged answer — recompute merged across all repos.
      const merged = computeMergedStatus(absPath);
      const prevMerged =
        oldStatus !== undefined
          ? // The previous merged value before this rebuild equals the
            // merged value computed if we put oldMap back in place. But since
            // only this repo's map changed in this rebuild, the previous
            // merged value is `pickHigherSeverity(oldStatus, otherReposBest)`,
            // and the new merged is `pickHigherSeverity(status, otherReposBest)`.
            // We re-derive using the current repoMaps state (newMap is already
            // installed) by swapping in oldStatus.
            (() => {
              const other = computeMergedExcludingRepo(absPath, key);
              if (oldStatus === undefined) {
                return other;
              }
              return other === undefined ? oldStatus : pickHigherSeverity(oldStatus, other);
            })()
          : computeMergedExcludingRepo(absPath, key);
      if (merged !== prevMerged) {
        delta.push({ path: absPath, status: merged ?? null });
      }
    }
    // Paths that disappeared from this repo's map but still might be claimed
    // by another repo.
    for (const absPath of oldMap.keys()) {
      if (newMap.has(absPath)) {
        continue;
      }
      const merged = computeMergedStatus(absPath);
      const prevOther = computeMergedExcludingRepo(absPath, key);
      const prevMerged =
        prevOther === undefined ? oldMap.get(absPath) : pickHigherSeverity(oldMap.get(absPath)!, prevOther);
      if (merged !== prevMerged) {
        delta.push({ path: absPath, status: merged ?? null });
      }
    }

    if (delta.length > 0) {
      emit(delta);
    }
  }

  function computeMergedExcludingRepo(absPath: string, excludeKey: string): GitStatus | undefined {
    let best: GitStatus | undefined;
    for (const [k, m] of repoMaps) {
      if (k === excludeKey) {
        continue;
      }
      const v = m.get(absPath);
      if (!v) {
        continue;
      }
      best = best === undefined ? v : pickHigherSeverity(best, v);
    }
    return best;
  }

  // --- Emission ------------------------------------------------------------
  //
  // 100 ms debounce (D4): multiple internal rebuilds within the window fold
  // into a single emission. The pending map holds the *most recent* status
  // value per path, mirroring the "last write wins per key" semantics. A
  // single flush bumps `revision` once — all changes in one delta share that
  // revision, which is what the webview's race-defeat logic relies on (D10).

  const DEBOUNCE_MS = 100;
  const pendingEmit = new Map<string, GitStatus | null>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function flushPendingEmit(): void {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (pendingEmit.size === 0) {
      return;
    }
    const changes: Array<{ path: string; status: GitStatus | null }> = [];
    for (const [path, status] of pendingEmit) {
      changes.push({ path, status });
    }
    pendingEmit.clear();
    revision += 1;
    for (const c of changes) {
      revisions.set(c.path, revision);
    }
    fireDelta({ revision, changes });
  }

  function emit(changes: ReadonlyArray<{ path: string; status: GitStatus | null }>): void {
    if (changes.length === 0 || disposed) {
      return;
    }
    // Filter to workspace-folder paths before coalescing. Drops auto-detected
    // non-workspace repos surfaced by `git.autoRepositoryDetection` so they
    // can neither bloat the webview's `pendingStatuses` nor widen the
    // path-info envelope. See: round-1 review W1.
    let kept = 0;
    for (const c of changes) {
      if (!isUnderAnyWorkspaceFolder(c.path)) {
        continue;
      }
      pendingEmit.set(c.path, c.status);
      kept += 1;
    }
    if (kept === 0) {
      return;
    }
    if (flushTimer === null) {
      flushTimer = setTimeout(flushPendingEmit, DEBOUNCE_MS);
    }
  }

  // --- Public surface ------------------------------------------------------

  const provider: GitDecorationProvider = {
    getStatus(absPath: string) {
      // Snapshot stamping must observe a status/revision pair that has already
      // been emitted. If a repo rebuild updated `repoMaps` but is still waiting
      // in the debounce bucket, flush it now so the webview never receives a
      // newer status with an older per-path revision watermark.
      flushPendingEmit();
      const status = computeMergedStatus(absPath);
      const rev = revisions.get(absPath) ?? revision;
      return { status, revision: rev };
    },
    getDescendantBuckets(folderAbsPath: string) {
      flushPendingEmit();
      // Pre-compute the path-containment boundary once per call. Each
      // repoMap is then a flat O(M) iteration so total cost is O(N) where
      // N = sum of dirty paths across all repos.
      const isWin = isWindowsAbsPath(folderAbsPath);
      const normalisedRoot = normalizePathForCompare(folderAbsPath);
      const sep = isWin ? "\\" : "/";
      const boundary = normalisedRoot.endsWith(sep) ? normalisedRoot : normalisedRoot + sep;
      // Per-path merge across repos so a path that appears in two overlapping
      // worktrees uses the higher-severity status (matches `getStatus`).
      const merged = new Map<string, GitStatus>();
      for (const m of repoMaps.values()) {
        for (const [p, s] of m) {
          const np = normalizePathForCompare(p);
          if (np !== normalisedRoot && !np.startsWith(boundary)) {
            continue;
          }
          const existing = merged.get(p);
          merged.set(p, existing === undefined ? s : pickHigherSeverity(existing, s));
        }
      }
      let counts: Partial<Record<GitStatus, number>> | undefined;
      for (const status of merged.values()) {
        // Mirrors the webview's `isDirtyForPropagation`: `deleted` and
        // `ignored` are excluded so the badge doesn't light up for them.
        if (status === "deleted" || status === "ignored") {
          continue;
        }
        if (!counts) {
          counts = {};
        }
        counts[status] = (counts[status] ?? 0) + 1;
      }
      return counts;
    },
    currentRevision() {
      flushPendingEmit();
      return revision;
    },
    onDidChange(listener) {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    reset() {
      // Capture every path that currently has a non-undefined merged status
      // so we can emit `null` for each in one batch.
      const cleared: Array<{ path: string; status: GitStatus | null }> = [];
      const seen = new Set<string>();
      for (const m of repoMaps.values()) {
        for (const p of m.keys()) {
          if (!seen.has(p)) {
            seen.add(p);
            cleared.push({ path: p, status: null });
          }
        }
      }
      repoMaps.clear();
      if (cleared.length > 0) {
        emit(cleared);
        flushPendingEmit();
      }
      // O-B1: Rebuild from the currently-known repos so subsequent snapshot
      // stamping via `getStatus()` returns the right value without having to
      // wait for the next `Repository.state.onDidChange` to fire. Without
      // this rebuild, a workspace-folder change that triggers `reset()`
      // would leave every existing decoration invisible until the user makes
      // a git change. Each `rebuildRepoMap` enters with an empty `oldMap`
      // (we just cleared `repoMaps`), so it re-emits the full current
      // state under a fresh revision sequence.
      if (api !== undefined) {
        for (const repo of api.repositories) {
          rebuildRepoMap(repo);
        }
        flushPendingEmit();
      }
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      pendingEmit.clear();
      disposeLifecycleSubs();
      while (persistentSubs.length > 0) {
        try {
          persistentSubs.pop()?.dispose();
        } catch {
          // ignore
        }
      }
      for (const sub of repoSubs.values()) {
        try {
          sub.dispose();
        } catch {
          // ignore
        }
      }
      repoSubs.clear();
      repoMaps.clear();
      revisions.clear();
      listeners.clear();
    },
  };

  // O-W3: Own the workspace-folder reset. Previously each FileTreeHost
  // subscribed and called `provider.reset()` independently — three hosts
  // meant three reset calls per change (the first cleared everything, the
  // others were near no-ops but still entered the rebuild path). Subscribing
  // once here makes the reset fan-out exactly one. The host-side bump of
  // `rootGeneration` still happens per host as it should.
  const wsfSub = onDidChangeWorkspaceFolders(() => {
    if (disposed) {
      return;
    }
    resolveFolders();
    provider.reset();
  });
  persistentSubs.push(wsfSub);

  // The folders open at construction; the event above covers every later set.
  resolveFolders();

  // Kick off acquisition asynchronously so construction never throws.
  tryAcquire();

  return provider;
}
