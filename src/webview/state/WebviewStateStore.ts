// src/webview/state/WebviewStateStore.ts — Centralized webview state management
//
// Owns all mutable UI state previously scattered as module-level variables in main.ts.
// Exposes state through public properties and mutations through named methods.
//
// See: docs/PLAN.md#8.5

import type { Terminal } from "@xterm/xterm";
import type { TerminalConfig } from "../../types/messages";
import type { SplitNode } from "../SplitModel";
import { getAllSessionIds } from "../SplitModel";
import type { WebviewState } from "./WebviewState";

export type { WebviewState } from "./WebviewState";

// ─── Types ──────────────────────────────────────────────────────────

/** A single terminal instance with its addons and DOM container. */
export interface TerminalInstance {
  id: string;
  /** Auto-derived name (default "Terminal N"; mutated by xterm.js onTitleChange). */
  name: string;
  /**
   * User-supplied display name. When non-null, the tab label renders this verbatim
   * instead of `name`. Null = use auto-name. Mirrored from the host's `customName`
   * via `tabRenamed` / `init` / `tabCreated` messages. See add-tab-rename design.md D1.
   */
  customName: string | null;
  terminal: Terminal;
  container: HTMLDivElement;
  /** Whether the PTY process has exited (terminal becomes read-only). */
  exited: boolean;
  /** Recent PTY output activity used by the tab-bar status indicator. */
  activityStatus: "idle" | "running";
  /**
   * Latest current working directory reported by the shell via OSC 7
   * (`ESC ]7;file://host/path BEL`). Modern shells emit this after every `cd`
   * when shell integration is enabled. Drives the right-click
   * "Reveal in File Explorer" command — without OSC 7 we fall back to the
   * workspace root. Volatile (not persisted) — re-derived on each shell.
   */
  cwd?: string;
}

/** Minimal VS Code API interface for state persistence. */
interface VsCodeStateApi {
  getState(): unknown;
  setState(state: unknown): void;
}

// ─── WebviewStateStore ──────────────────────────────────────────────

/**
 * Centralized store for webview mutable state.
 *
 * Owns:
 * - `terminals` — all terminal instances keyed by session/tab ID
 * - `tabLayouts` — split layout tree per tab
 * - `tabActivePaneIds` — active pane per tab
 * - `resizeCleanups` — resize handle cleanup functions per tab
 * - `activeTabId` — currently visible tab
 * - `currentConfig` — terminal config from settings
 *
 * Does NOT own business logic (e.g., removeTerminal, switchTab).
 * Orchestration stays in main.ts (future composition root).
 */
export class WebviewStateStore {
  /** All terminal instances keyed by session/tab ID. */
  readonly terminals = new Map<string, TerminalInstance>();

  /** Split layout tree per tab — maps tab ID to its root SplitNode. */
  readonly tabLayouts = new Map<string, SplitNode>();

  /** Active pane ID per tab — tracks which pane is focused in a split layout. */
  readonly tabActivePaneIds = new Map<string, string>();

  /** Cleanup functions for resize handles — keyed by tab ID. */
  readonly resizeCleanups = new Map<string, (() => void)[]>();

  /** Currently active (visible) terminal tab ID. */
  activeTabId: string | null = null;

  /**
   * Tracks an in-flight inline rename. Non-null while the overlay `<input>` is
   * mounted; `renderTabBar` checks this to reposition the overlay at the end
   * of every render. Set via `beginRename` / cleared via `endRename`.
   * See add-tab-rename design.md D4.
   */
  renameSession: { tabId: string; originalDisplayedValue: string } | null = null;

  /** Mark the start of an inline rename for `tabId`. Idempotent (last write wins). */
  beginRename(tabId: string, originalDisplayedValue: string): void {
    this.renameSession = { tabId, originalDisplayedValue };
  }

  /** Clear the inline-rename marker. Idempotent. */
  endRename(): void {
    this.renameSession = null;
  }

  /** Current terminal config — set from init, updated by configUpdate. */
  currentConfig: TerminalConfig = {
    fontSize: 14,
    cursorBlink: true,
    scrollback: 10000,
    fontFamily: "",
  };

  private readonly vscodeApi: VsCodeStateApi;

  constructor(vscodeApi: VsCodeStateApi) {
    this.vscodeApi = vscodeApi;
  }

  /** Set the active tab ID. */
  setActiveTab(tabId: string | null): void {
    this.activeTabId = tabId;
  }

  /** Set the split layout for a tab. */
  setLayout(tabId: string, layout: SplitNode): void {
    this.tabLayouts.set(tabId, layout);
  }

  /** Delete the split layout for a tab. */
  deleteLayout(tabId: string): void {
    this.tabLayouts.delete(tabId);
  }

  /** Set the active pane ID for a tab. */
  setActivePaneId(tabId: string, paneId: string): void {
    this.tabActivePaneIds.set(tabId, paneId);
  }

  /** Get the active pane ID for a tab. Falls back to tabId if no active pane is set. */
  getActivePaneId(tabId: string): string {
    return this.tabActivePaneIds.get(tabId) ?? tabId;
  }

  /**
   * Read the full typed `WebviewState` snapshot from `vscode.getState()`. Returns
   * `{}` if no state has been written yet or if the persisted blob is malformed.
   * Pure read — does NOT mutate any local maps; for that use `restore()`.
   *
   * Applies a one-shot migration: pre-bucketed `fileTree` slot is moved into
   * `fileTreeByLocation.sidebar` (sidebar was the only location that existed
   * before per-location bucketing was introduced). The migrated state is
   * written back so callers never see the legacy slot again. Without this
   * migration, callers reading the legacy slot would re-apply it indefinitely
   * without ever persisting it under the new bucket — a "permanent ghost"
   * read on every mount.
   */
  getState(): WebviewState {
    try {
      const raw = this.vscodeApi.getState();
      if (!raw || typeof raw !== "object") {
        return {};
      }
      const state = raw as WebviewState;
      const legacy = state.fileTree;
      if (legacy !== undefined) {
        const bucketed = state.fileTreeByLocation ?? {};
        // Only migrate if the sidebar bucket isn't already populated (the
        // new-shape write takes precedence — legacy was never targeted at
        // panel/editor mounts).
        const migrated: WebviewState = {
          ...state,
          fileTreeByLocation: bucketed.sidebar ? bucketed : { ...bucketed, sidebar: legacy },
          fileTree: undefined,
        };
        // Drop the legacy field entirely so future reads don't trip the
        // migration check. Persist immediately — safe because setState is
        // synchronous and idempotent.
        this.vscodeApi.setState(migrated);
        return migrated;
      }
      return state;
    } catch {
      return {};
    }
  }

  /**
   * Merge `patch` into the current persisted state and write it back. Top-level
   * keys in `patch` REPLACE their counterparts in the existing state (matching
   * `Object.assign` semantics) — pass an entire `fileTree` object to update
   * any nested field, since this layer does not deep-merge.
   */
  updateState(patch: Partial<WebviewState>): void {
    const current = this.getState();
    const next: WebviewState = { ...current, ...patch };
    this.vscodeApi.setState(next);
  }

  /**
   * Persist layout state to vscode.setState().
   * Serializes tabLayouts and tabActivePaneIds into the VS Code state store.
   */
  persist(): void {
    const layouts: Record<string, SplitNode> = {};
    for (const [tabId, layout] of this.tabLayouts) {
      layouts[tabId] = layout;
    }
    const activePaneIds: Record<string, string> = {};
    for (const [tabId, paneId] of this.tabActivePaneIds) {
      activePaneIds[tabId] = paneId;
    }
    this.updateState({ tabLayouts: layouts, tabActivePaneIds: activePaneIds });
  }

  /**
   * Restore layout state from vscode.getState().
   * Returns a map of restored layouts. Also restores tabActivePaneIds.
   * Returns empty map if missing/malformed.
   */
  restore(): Map<string, SplitNode> {
    const restored = new Map<string, SplitNode>();
    try {
      const state = this.vscodeApi.getState() as Record<string, unknown> | null;
      if (state && typeof state.tabLayouts === "object" && state.tabLayouts !== null) {
        const layouts = state.tabLayouts as Record<string, SplitNode>;
        for (const [tabId, layout] of Object.entries(layouts)) {
          if (layout && typeof layout === "object" && "type" in layout) {
            restored.set(tabId, layout);
          }
        }
      }
      // Restore active pane IDs
      if (state && typeof state.tabActivePaneIds === "object" && state.tabActivePaneIds !== null) {
        const paneIds = state.tabActivePaneIds as Record<string, string>;
        for (const [tabId, paneId] of Object.entries(paneIds)) {
          if (typeof paneId === "string") {
            // Validate that the pane still exists in the layout
            const layout = restored.get(tabId);
            if (layout) {
              const allIds = getAllSessionIds(layout);
              if (allIds.includes(paneId)) {
                this.tabActivePaneIds.set(tabId, paneId);
              }
              // If pane no longer exists, fallback to first leaf (handled by getActivePaneId)
            }
          }
        }
      }
    } catch {
      // Fallback: return empty map
    }
    return restored;
  }
}
