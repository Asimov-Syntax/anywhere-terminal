// src/providers/fsWatcherPool.ts — Process-level singleton that owns at most
// one `vscode.FileSystemWatcher` per absolute directory path, refcounted
// across every `FileTreeHost` (sidebar + panel + editor) that subscribes.
//
// See: asimov/changes/add-file-tree-fs-watcher/design.md D1, D2, D3, D5, D7, D8
//      asimov/changes/add-file-tree-fs-watcher/specs/fs-watcher-pool/spec.md
//      docs/research/20260524-vscode-explorer-watcher-impl.md
//
// Topology mirrors `GitDecorationProvider`: a single instance is wired in
// `extension.ts` and passed by reference into every `FileTreeHost`. Multiple
// instances would defeat cross-host refcounting (the underlying VS Code
// `createFileSystemWatcher` does NOT dedupe at the file-service layer —
// correlationId is fresh per call).
//
// Per-path lifecycle (D2):
//   - First subscriber for a path creates ONE non-recursive
//     `FileSystemWatcher` with glob `*` (direct children only) and
//     `ignoreChange: true` (tree row has no mtime surface).
//   - `onDidCreate` + `onDidDelete` arm a 150 ms trailing debounce; multiple
//     events in the window collapse to a single fanout to subscribers.
//   - Last unsubscribe disposes the watcher, clears the timer, and removes the
//     map entry.
//
// Rehydrate (D7): subscribes to `vscode.window.onDidChangeWindowState` and
// fires its own `onDidRequestRehydrate` on the rising edge (false → true).
// `previousFocused` is initialised from `vscode.window.state.focused` at
// construction so an "always focused" activation doesn't incorrectly
// suppress (or trigger) the first event.

import * as vscode from "vscode";

const LOG_PREFIX = "[AnyWhere Terminal][fs-watcher-pool]";

/** Trailing debounce window for per-directory create/delete coalescing. */
export const DEBOUNCE_MS = 150;

/** Threshold for the one-shot soft-cap warning (D8). */
export const SOFT_CAP = 500;

/**
 * Options bag for testability. Production callers pass `{}`; tests inject
 * fakes for the VS Code API surfaces so no real FS watcher is created and the
 * window-focus event source is driver-controlled.
 */
export interface WatcherPoolOptions {
  /**
   * Inject a fake `createFileSystemWatcher` so unit tests don't need to stand
   * up a real watcher. Defaults to `vscode.workspace.createFileSystemWatcher`.
   */
  readonly createFileSystemWatcher?: typeof vscode.workspace.createFileSystemWatcher;
  /**
   * Inject a window-state event source. Defaults to
   * `vscode.window.onDidChangeWindowState`.
   */
  readonly onDidChangeWindowState?: vscode.Event<{ focused: boolean }>;
  /**
   * Inject the initial focus state. Defaults to `vscode.window.state.focused`.
   * Setting this to `false` is the right choice in tests that simulate a window
   * that started unfocused at activation — the first observed `focused: true`
   * is then correctly treated as a rising edge.
   */
  readonly initialWindowFocused?: boolean;
}

export interface WatcherPool {
  /**
   * Refcounted subscription. The returned Disposable removes ONLY this
   * subscriber. When the last subscriber for a path unsubscribes, the
   * underlying `FileSystemWatcher` is disposed and the debounce timer is
   * cleared.
   *
   * Post-`dispose()` calls return a no-op Disposable (no listener registered,
   * no watcher created).
   */
  subscribe(absPath: string, onInvalidate: () => void): vscode.Disposable;

  /**
   * Change-aware, glob-scoped subscription (enhance-vault-sessions D4/D5).
   * Unlike {@link subscribe} (non-recursive `*`, create/delete only, refcounted),
   * this creates a dedicated `FileSystemWatcher` over
   * `new RelativePattern(Uri.file(baseDir), glob)` and fires the supplied
   * handlers — including `change`, which the refcounted path watcher discards
   * (`ignoreChange: true`). Vault session stores grow by APPENDING to existing
   * JSONL files and by SQLite WAL writes, both pure change events. Each handler
   * is debounced ({@link DEBOUNCE_MS}); a handler that is omitted sets the
   * corresponding `ignore*` flag so VS Code never emits it. The returned
   * Disposable tears down this watcher (not refcounted — one watcher per call).
   */
  subscribePattern(
    baseDir: string,
    glob: string,
    handlers: {
      create?: (uri: vscode.Uri) => void;
      change?: (uri: vscode.Uri) => void;
      delete?: (uri: vscode.Uri) => void;
    },
  ): vscode.Disposable;

  /**
   * Fires on the window-focus rising edge (false → true). Each
   * `FileTreeHost` forwards this to its webview as `fs-rehydrate`.
   */
  readonly onDidRequestRehydrate: vscode.Event<void>;

  /**
   * Disposes every active watcher, clears every per-path debounce timer,
   * empties the subscriber registry, and unsubscribes from the window-state
   * event. Idempotent.
   */
  dispose(): void;
}

interface PathEntry {
  /** Underlying VS Code watcher. `null` when creation threw (ENOSPC/EMFILE). */
  watcher: vscode.FileSystemWatcher | null;
  /** Subscribers' `onInvalidate` callbacks, in registration order. */
  subscribers: Set<() => void>;
  /** Active trailing-debounce timer, or null when no event is pending. */
  timer: ReturnType<typeof setTimeout> | null;
  /** Per-watcher event subscriptions to dispose on tear-down. */
  eventSubs: vscode.Disposable[];
}

/**
 * Tiny in-process emitter that mirrors the parts of `vscode.EventEmitter` we
 * need (subscribe / fire). Avoids requiring tests to construct a real
 * `vscode.EventEmitter` from the API namespace.
 */
function createEmitter<T>(): { event: vscode.Event<T>; fire: (value: T) => void; dispose: () => void } {
  const listeners = new Set<(value: T) => void>();
  const event: vscode.Event<T> = (listener: (value: T) => void) => {
    listeners.add(listener);
    return { dispose: () => listeners.delete(listener) };
  };
  return {
    event,
    fire: (value: T) => {
      for (const l of [...listeners]) {
        try {
          l(value);
        } catch (err) {
          console.warn(`${LOG_PREFIX} rehydrate listener threw — continuing`, err);
        }
      }
    },
    dispose: () => listeners.clear(),
  };
}

export function createWatcherPool(options: WatcherPoolOptions = {}): WatcherPool {
  const createFileSystemWatcher =
    options.createFileSystemWatcher ??
    ((glob: vscode.GlobPattern, ignoreCreate?: boolean, ignoreChange?: boolean, ignoreDelete?: boolean) =>
      vscode.workspace.createFileSystemWatcher(glob, ignoreCreate, ignoreChange, ignoreDelete));
  const onDidChangeWindowState = options.onDidChangeWindowState ?? vscode.window.onDidChangeWindowState;

  // Raw `absPath` as the map key — no case-folding (D Constraint #5: paths
  // from `vscode.workspace.fs.readDirectory` are canonical-cased on every OS
  // we support, so duplicate-case lookups are unreachable through normal
  // flow). Acknowledged v1 limit if a non-canonical path arrives via a typed
  // external integration.
  const paths = new Map<string, PathEntry>();
  // Dedicated (non-refcounted) pattern watchers created via subscribePattern.
  const patternEntries = new Set<{ dispose: () => void }>();

  let disposed = false;
  let softCapWarned = false;
  let previousFocused = options.initialWindowFocused ?? vscode.window.state.focused;

  const rehydrateEmitter = createEmitter<void>();

  const focusSub = onDidChangeWindowState((next) => {
    if (disposed) {
      return;
    }
    if (previousFocused === false && next.focused === true) {
      rehydrateEmitter.fire();
    }
    previousFocused = next.focused;
  });

  function tryCreateWatcher(absPath: string): vscode.FileSystemWatcher | null {
    try {
      const pattern = new vscode.RelativePattern(vscode.Uri.file(absPath), "*");
      return createFileSystemWatcher(pattern, false, true, false);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "<unknown>";
      console.error(`${LOG_PREFIX} createFileSystemWatcher failed (${code}) for ${absPath}`, err);
      return null;
    }
  }

  function fanout(entry: PathEntry): void {
    // Snapshot subscribers so a callback that disposes itself mid-fanout
    // doesn't mutate the iterating set. Re-check membership before each
    // invoke (review round-1 S1): if callback A disposes B mid-loop, B's
    // disposal should suppress its fanout — otherwise B fires after it has
    // been torn down.
    const snapshot = [...entry.subscribers];
    for (const cb of snapshot) {
      if (!entry.subscribers.has(cb)) {
        continue;
      }
      try {
        cb();
      } catch (err) {
        console.warn(`${LOG_PREFIX} subscriber threw — continuing fanout`, err);
      }
    }
  }

  function scheduleFanout(entry: PathEntry): void {
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
    }
    entry.timer = setTimeout(() => {
      entry.timer = null;
      fanout(entry);
    }, DEBOUNCE_MS);
  }

  function getOrCreateEntry(absPath: string): PathEntry {
    let entry = paths.get(absPath);
    if (entry) {
      return entry;
    }
    const watcher = tryCreateWatcher(absPath);
    entry = {
      watcher,
      subscribers: new Set(),
      timer: null,
      eventSubs: [],
    };
    if (watcher) {
      entry.eventSubs.push(
        watcher.onDidCreate(() => scheduleFanout(entry as PathEntry)),
        watcher.onDidDelete(() => scheduleFanout(entry as PathEntry)),
      );
    }
    paths.set(absPath, entry);
    if (!softCapWarned && paths.size >= SOFT_CAP) {
      softCapWarned = true;
      console.warn(`${LOG_PREFIX} watch count reached ${SOFT_CAP} — review usage`);
    }
    return entry;
  }

  function teardownEntry(absPath: string, entry: PathEntry): void {
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    for (const sub of entry.eventSubs) {
      try {
        sub.dispose();
      } catch {
        // Per-listener dispose failures are not actionable; swallow.
      }
    }
    entry.eventSubs.length = 0;
    if (entry.watcher) {
      try {
        entry.watcher.dispose();
      } catch {
        // Watcher dispose failures from VS Code are not actionable; swallow.
      }
    }
    paths.delete(absPath);
  }

  function subscribe(absPath: string, onInvalidate: () => void): vscode.Disposable {
    if (disposed) {
      return { dispose: () => {} };
    }
    const entry = getOrCreateEntry(absPath);
    entry.subscribers.add(onInvalidate);
    let removed = false;
    return {
      dispose: () => {
        if (removed) {
          return;
        }
        removed = true;
        // Re-fetch the entry — it may have been torn down by another caller's
        // dispose in a multi-subscriber scenario.
        const current = paths.get(absPath);
        if (!current) {
          return;
        }
        current.subscribers.delete(onInvalidate);
        if (current.subscribers.size === 0) {
          teardownEntry(absPath, current);
        }
      },
    };
  }

  function subscribePattern(
    baseDir: string,
    glob: string,
    handlers: {
      create?: (uri: vscode.Uri) => void;
      change?: (uri: vscode.Uri) => void;
      delete?: (uri: vscode.Uri) => void;
    },
  ): vscode.Disposable {
    if (disposed) {
      return { dispose: () => {} };
    }
    let watcher: vscode.FileSystemWatcher | null = null;
    try {
      const pattern = new vscode.RelativePattern(vscode.Uri.file(baseDir), glob);
      watcher = createFileSystemWatcher(pattern, !handlers.create, !handlers.change, !handlers.delete);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "<unknown>";
      console.error(`${LOG_PREFIX} subscribePattern watcher failed (${code}) for ${baseDir}/${glob}`, err);
    }

    // Independent trailing debounce per event kind, so a burst of appends
    // collapses to a single handler call.
    const timers: Record<"create" | "change" | "delete", ReturnType<typeof setTimeout> | null> = {
      create: null,
      change: null,
      delete: null,
    };
    const pendingUris: Record<"create" | "change" | "delete", Map<string, vscode.Uri>> = {
      create: new Map(),
      change: new Map(),
      delete: new Map(),
    };
    const eventSubs: vscode.Disposable[] = [];
    const armed = { value: true };

    function fire(kind: "create" | "change" | "delete", uri: vscode.Uri, cb: (uri: vscode.Uri) => void): void {
      pendingUris[kind].set(uri.fsPath, uri);
      if (timers[kind] !== null) {
        clearTimeout(timers[kind] as ReturnType<typeof setTimeout>);
      }
      timers[kind] = setTimeout(() => {
        timers[kind] = null;
        const uris = [...pendingUris[kind].values()];
        pendingUris[kind].clear();
        if (!armed.value) {
          return;
        }
        for (const pendingUri of uris) {
          try {
            cb(pendingUri);
          } catch (err) {
            console.warn(`${LOG_PREFIX} subscribePattern ${kind} handler threw — continuing`, err);
          }
        }
      }, DEBOUNCE_MS);
    }

    if (watcher) {
      if (handlers.create) {
        eventSubs.push(watcher.onDidCreate((uri) => fire("create", uri, handlers.create as (uri: vscode.Uri) => void)));
      }
      if (handlers.change) {
        eventSubs.push(watcher.onDidChange((uri) => fire("change", uri, handlers.change as (uri: vscode.Uri) => void)));
      }
      if (handlers.delete) {
        eventSubs.push(watcher.onDidDelete((uri) => fire("delete", uri, handlers.delete as (uri: vscode.Uri) => void)));
      }
    }

    const entry = {
      dispose: () => {
        armed.value = false;
        for (const k of ["create", "change", "delete"] as const) {
          if (timers[k] !== null) {
            clearTimeout(timers[k] as ReturnType<typeof setTimeout>);
            timers[k] = null;
          }
          pendingUris[k].clear();
        }
        for (const sub of eventSubs) {
          try {
            sub.dispose();
          } catch {
            // not actionable
          }
        }
        eventSubs.length = 0;
        if (watcher) {
          try {
            watcher.dispose();
          } catch {
            // not actionable
          }
        }
        patternEntries.delete(entry);
      },
    };
    patternEntries.add(entry);
    return entry;
  }

  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    focusSub.dispose();
    for (const [absPath, entry] of [...paths.entries()]) {
      teardownEntry(absPath, entry);
    }
    paths.clear();
    for (const entry of [...patternEntries]) {
      entry.dispose();
    }
    patternEntries.clear();
    rehydrateEmitter.dispose();
  }

  return {
    subscribe,
    subscribePattern,
    onDidRequestRehydrate: rehydrateEmitter.event,
    dispose,
  };
}
