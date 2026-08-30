// src/webview/fileTree/FileTreeController.ts — Bootstrap + message-router
// integration for the webview file-tree panel.
//
// The webview's `main.ts` previously carried ~100 lines of file-tree wiring:
//   - location-key detection (`document.body.dataset.terminalLocation`)
//   - per-location default position lookup
//   - persisted-state read/write callbacks tied to `WebviewStateStore`
//   - the `FileTreePanel` construction + seed-vs-restore branch
//   - five MessageRouter handlers (readDirectoryResponse, workspaceRootChanged,
//     toggle, setPosition, reveal)
//
// This file owns all of that. `main.ts` now constructs ONE
// `FileTreeController` and delegates each router handler. Composition root
// stays the composition root; feature wiring lives with the feature.
//
// See: review round-1 follow-up — Oracle #3 (cross-cutting integration).

import type {
  FileTreeSearchResponseMessage,
  FsChangesInvalidatedMessage,
  FsRehydrateMessage,
  GitStatusChangedMessage,
  ReadDirectoryResponseMessage,
  RevealInFileTreeMessage,
  SetFileTreePositionMessage,
  WorkspaceRootChangedMessage,
} from "../../types/messages";
import type { WebviewStateStore } from "../state/WebviewStateStore";
import { FileTreePanel } from "./FileTreePanel";

/** Init payload pieces the controller needs from the host's `init` message. */
export interface FileTreeBootstrapInit {
  workspaceRoot: string | null;
  /** Where `workspaceRoot` resolves; see the init payload's own comment. */
  resolvedWorkspaceRoot: string | null;
  rootGeneration: number;
}

/** Anything the controller needs that lives outside the file-tree subsystem. */
export interface FileTreeControllerDeps {
  /** The `#file-tree` host element that FileTreePanel mounts into. */
  fileTreeHost: HTMLElement;
  /** Outer flex wrapper — receives the position class + the `--file-tree-size` var. */
  layoutWrapper: HTMLElement;
  /** `init` payload fields. */
  init: FileTreeBootstrapInit;
  /** Persisted-state store. */
  store: WebviewStateStore;
  /** Webview→host postMessage shim. */
  postMessage: (m: unknown) => void;
  /** Active-pane resolver (for OpenFileMessage routing). */
  getActiveSessionId: () => string | null;
  /** Called after every layout-affecting change so xterm can re-fit. */
  onLayoutChange: () => void;
  /** Look up a terminal instance's webview-side cwd (OSC 7 capture). Optional. */
  getInstanceCwd: (sessionId: string) => string | null | undefined;
  /** The `#aux-region` wrapper — the file tree's resize sash mounts here. Optional. */
  regionEl?: HTMLElement;
  /** Toggle the vault section's collapsed state (file-tree header button). Optional. */
  onToggleVault?: () => void;
  /** Pixel-FLIP collapse animation around the root-collapse toggle (shared with the vault). Optional. */
  animateCollapse?: (apply: () => void) => void;
}

type TerminalLocationKey = "sidebar" | "panel" | "editor";

function resolveLocationKey(body: HTMLElement): TerminalLocationKey {
  const raw = body.dataset.terminalLocation ?? "sidebar";
  return raw === "panel" || raw === "editor" ? raw : "sidebar";
}

function defaultPositionFor(loc: TerminalLocationKey): "top" | "bottom" | "left" | "right" {
  if (loc === "panel") {
    return "right";
  }
  if (loc === "editor") {
    return "left";
  }
  return "bottom";
}

/**
 * Owns the file-tree panel lifecycle + the five MessageRouter handlers that
 * read/write it. Construct via `FileTreeController.mount(deps)`.
 */
export class FileTreeController {
  /** The mounted panel. Exposed for tests + the rare main.ts caller. */
  readonly panel: FileTreePanel;

  /**
   * Last-known workspace root from `init` / `workspace-root-changed`. Used
   * as the fallback target for `reveal-in-file-tree` when neither the
   * extension-resolved cwd nor the webview's OSC 7 cwd is available.
   */
  private lastWorkspaceRoot: string | null;

  private constructor(
    panel: FileTreePanel,
    lastWorkspaceRoot: string | null,
    private readonly deps: FileTreeControllerDeps,
  ) {
    this.panel = panel;
    this.lastWorkspaceRoot = lastWorkspaceRoot;
  }

  /**
   * Mount the panel and return a controller. Caller MUST hold the returned
   * reference for the lifetime of the webview — there is no reattach path.
   * Returns `null` when either host element is missing (no-op).
   */
  static mount(deps: FileTreeControllerDeps): FileTreeController | null {
    const body = deps.fileTreeHost.ownerDocument.body;
    const locationKey = resolveLocationKey(body);
    const getLocationState = () => deps.store.getState().fileTreeByLocation?.[locationKey];
    const persisted = getLocationState();

    const panel = new FileTreePanel({
      host: deps.fileTreeHost,
      workspaceRoot: deps.init.workspaceRoot,
      rootGeneration: deps.init.rootGeneration,
      getActiveSessionId: deps.getActiveSessionId,
      postMessage: (m) => deps.postMessage(m),
      layoutWrapper: deps.layoutWrapper,
      regionEl: deps.regionEl,
      onToggleVault: deps.onToggleVault,
      animateCollapse: deps.animateCollapse,
      onLayoutChange: deps.onLayoutChange,
      getPersistedState: () => getLocationState(),
      persistState: (state) => {
        const existing = deps.store.getState().fileTreeByLocation ?? {};
        deps.store.updateState({
          fileTreeByLocation: { ...existing, [locationKey]: state },
        });
      },
    });

    panel.setResolvedWorkspaceRoot(deps.init.workspaceRoot, deps.init.resolvedWorkspaceRoot);

    // Seed default position from location only if NO persisted state. A
    // previously-persisted position must not be overridden by the default.
    panel.setPosition(persisted ? persisted.position : defaultPositionFor(locationKey));

    return new FileTreeController(panel, deps.init.workspaceRoot, deps);
  }

  // ─── MessageRouter handlers ────────────────────────────────────────

  handleReadDirectoryResponse(msg: ReadDirectoryResponseMessage): void {
    this.panel.handleReadDirectoryResponse(msg);
  }

  handleWorkspaceRootChanged(msg: WorkspaceRootChangedMessage): void {
    this.lastWorkspaceRoot = msg.rootPath;
    // Recorded BEFORE the panel re-roots, so the mount it performs is compared
    // against the resolved root rather than picking it up a message later.
    this.panel.setResolvedWorkspaceRoot(msg.rootPath, msg.resolvedRootPath);
    this.panel.handleRootChanged(msg);
  }

  /**
   * Drop a `git-status-changed` delta from the host. Gated on `rootGeneration`
   * so a delta belonging to the previous workspace generation can't bleed
   * into the new one (mirrors the gate `handleReadDirectoryResponse` uses
   * internally). The panel forwards into `FileSystemDataSource.applyGitStatusDelta`
   * which routes through `applyStatusTransition`.
   */
  handleGitStatusChanged(msg: GitStatusChangedMessage): void {
    if (msg.rootGeneration !== this.panel.getCurrentRootGeneration()) {
      // Stale generation — silently drop; matches the contract on every
      // other host-pushed message.
      return;
    }
    this.panel.handleGitStatusChanged(msg.revision, msg.changes);
  }

  handleSetPosition(msg: SetFileTreePositionMessage): void {
    this.panel.setPosition(msg.position);
  }

  handleSearchResponse(msg: FileTreeSearchResponseMessage): void {
    this.panel.handleSearchResponse(msg);
  }

  /**
   * Drop an `fs-changes-invalidated` from the host. Generation-gated inside
   * the data source; this method just delegates so the controller stays the
   * single integration surface for `main.ts`. See:
   * asimov/changes/add-file-tree-fs-watcher/design.md D4.
   */
  handleFsChangesInvalidated(msg: FsChangesInvalidatedMessage): void {
    this.panel.handleFsChangesInvalidated(msg);
  }

  /**
   * Drop an `fs-rehydrate` from the host. Generation-gated inside the data
   * source. See: asimov/changes/add-file-tree-fs-watcher/design.md D7.
   */
  handleFsRehydrate(msg: FsRehydrateMessage): void {
    this.panel.handleFsRehydrate(msg);
  }

  handleReveal(msg: RevealInFileTreeMessage): void {
    // Auto-reveal contract: an explicit absolute path bypasses cwd resolution.
    if (msg.absPath) {
      void this.panel.revealPath(msg.absPath, {
        focusNoScroll: msg.focusNoScroll,
        source: msg.source,
      });
      return;
    }
    // OSC 7 contract: resolve via sessionId → instanceCwd → workspace root.
    // Prefer the extension-resolved cwd (queried via OS process table, so it
    // tracks `cd` without needing shell integration). Fall back to the
    // webview-side OSC 7 cwd, then to the last-known workspace root.
    if (!msg.sessionId) {
      console.warn("[AnyWhere Terminal] reveal-in-file-tree: missing both absPath and sessionId");
      return;
    }
    const instanceCwd = this.deps.getInstanceCwd(msg.sessionId);
    const target = msg.cwd ?? instanceCwd ?? this.lastWorkspaceRoot;
    if (!target) {
      console.warn("[AnyWhere Terminal] reveal-in-file-tree: no cwd or workspace root resolvable");
      return;
    }
    void this.panel.revealPath(target, { source: msg.source });
  }
}
