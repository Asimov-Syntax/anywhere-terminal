// src/webview/state/WebviewState.ts — Typed shape of the webview-persisted state.
//
// Replaces the historical `Record<string, unknown>` shape that `WebviewStateStore`
// wrote into `vscode.setState()`. Each top-level field is optional so older
// state objects (lacking the new `fileTree` block, etc.) restore cleanly without
// migration.
//
// See: asimov/changes/port-vscode-async-data-tree/design.md D6,
//      specs/file-tree-panel/spec.md#requirement-state-persistence-schema

import type { FileTreePosition } from "../../types/messages";
import type { SplitNode } from "../SplitModel";

/** Per-tab persisted file-tree state. */
export interface FileTreeState {
  /** Position relative to the terminal area. */
  position: FileTreePosition;
  /** Absolute paths of currently-expanded folders — used to restore tree state on reveal. */
  expandedPaths: string[];
  /**
   * Persisted panel size in CSS pixels along the layout's primary axis
   * (width for left/right, height for top/bottom). Optional — when absent,
   * the panel uses a position-dependent default (240 sides, 200 top/bottom).
   * Drag-resize via the sash boundary writes this back.
   */
  size?: number;
  /**
   * In-panel file-tree search mode toggle. `filter` (default) shows only
   * scoring matches; `highlight` shows all enumerated files with non-matches
   * dimmed. Survives panel close/reopen. The query string itself is NOT
   * persisted — only this mode preference.
   *
   * See: asimov/changes/add-file-tree-search/design.md D9.
   */
  searchMode?: "filter" | "highlight";
}

/** Where this webview is mounted — drives default file-tree position. */
export type TerminalLocationKey = "sidebar" | "panel" | "editor";

/**
 * Full typed shape of the webview-persisted state. Optional fields mean a
 * future revision (selection, scroll, sash size, customNames, …) can extend
 * this without breaking restore for users on the older shape.
 *
 * File-tree state is bucketed by location (`sidebar` / `panel` / `editor`)
 * because the same AnyWhere Terminal instance can be dragged between
 * locations and users naturally want different layouts in each — a panel
 * shape wants the tree on the right, a sidebar wants it at the bottom.
 * The legacy single `fileTree` slot is kept for back-compat reading; new
 * writes always go to `fileTreeByLocation`.
 */
export interface WebviewState {
  tabLayouts?: Record<string, SplitNode>;
  tabActivePaneIds?: Record<string, string>;
  /**
   * @deprecated — pre-bucketed shape. `WebviewStateStore.getState()` migrates
   * this slot into `fileTreeByLocation.sidebar` on first read and then writes
   * back with this field cleared, so consumers never observe it set. Kept on
   * the type so the migration logic remains type-safe; the only sites that
   * may set it are restore-from-persisted-blob (which immediately migrates)
   * and the migration's own pass-through writer. NEW code must not set it.
   */
  fileTree?: FileTreeState;
  fileTreeByLocation?: Partial<Record<TerminalLocationKey, FileTreeState>>;
  /**
   * Stable identifier for the editor WebviewPanel that owns this state — set
   * by the extension via `setPanelId`, persisted by the webview, and read
   * back by VS Code's `WebviewPanelSerializer` on window reload. Only present
   * for editor panels.
   *
   * See: asimov/changes/restore-terminal-sessions/design.md D2.
   */
  panelId?: string;
  /**
   * Whether the AI Vault section (stacked directly above the file tree inside
   * `#aux-region`) is collapsed to its header strip. Persisted so a reload
   * restores the user's choice. Absent → expanded (default).
   *
   * See: asimov/changes/add-ai-coding-vault/design.md D11.
   */
  vaultCollapsed?: boolean;
  /**
   * Vault "This folder only" filter — when true, the vault shows only sessions
   * whose cwd is within the active terminal pane's working directory. Persisted
   * so the scope choice survives reloads. Absent → off (show all).
   */
  vaultFolderOnly?: boolean;
  /**
   * Vault grouping mode — "recent" (flat), "agent", or "folder". Persisted so
   * the chosen grouping survives reloads. Absent → "recent" (default).
   *
   * See: asimov/changes/redesign-vault-panel-ui/design.md D2.
   */
  vaultGroupMode?: "recent" | "agent" | "folder";
  /**
   * Persisted floating geometry of the AI Vault session-preview overlay
   * (`.vault-preview`). Saved whenever the user drags/resizes/maximizes it, so
   * the size + position survive a reload AND a full VSCode restart. Absent →
   * the preview auto-anchors next to the activated row at its default size.
   */
  vaultPreviewGeometry?: VaultPreviewGeometry;
  /**
   * Which BODY the vault panel shows. A sibling of `vaultGroupMode` rather than a
   * fourth value in it: that union feeds `groupEntries()`, and a *view* value
   * flowing in there would bucket sessions by a mode that does not exist. A state
   * written by an older build simply has no value here and falls back to
   * "sessions". See: docs/design/worktree-panel-ui.md § 2.1.
   */
  vaultView?: "sessions" | "worktree";
  /** Collapsed repoIds + worktreeIds in the Worktree view (first disclosure level). */
  worktreeCollapsed?: string[];
  /** Expanded agent rowIds (second disclosure level) — persisted independently. */
  worktreeExpandedRows?: string[];
  /**
   * The worktree this surface's tab bar is scoped to. ABSENT means unscoped, which
   * is both the first-run state and what anything written by a build that recorded
   * no scope reads as: "no scope" and "never had one" call for the same behaviour,
   * so there is no second signal. Per surface by construction — each webview holds
   * its own state object, and two surfaces holding different scopes is the feature
   * (docs/design/worktree-scope.md § 2.2).
   */
  worktreeScope?: string;
  /**
   * repoIds whose idle tail has already been presented once. A SECOND signal is
   * needed because `worktreeCollapsed` reads every absent key as expanded, so the
   * fold key alone cannot distinguish a tail this build has never shown from one
   * the user deliberately opened — and an existing user would meet the feature
   * already unfolded. See docs/design/worktree-panel-ui.md § 3.6.
   */
  worktreeIdleTailSeeded?: string[];
}

/**
 * Floating geometry for the AI Vault session-preview overlay. Viewport-relative
 * (the overlay is `position: fixed`). `maximized` records the full-viewport
 * state so it restores expanded; the other fields hold the floating size/pos to
 * return to when un-maximized.
 */
export interface VaultPreviewGeometry {
  top: number;
  left: number;
  width: number;
  height: number;
  maximized?: boolean;
}
