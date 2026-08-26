// src/webview/worktree/WorktreeController.ts — The Worktree view's message seam.
// See: docs/design/worktree-rpc.md § 1, § 2;
//      asimov/changes/wire-live-worktree-tree/design.md D2, D3, D4, D5
//
// Owns everything between the host's `worktreeTreeResponse` and `WorktreeView`:
// the visibility declaration that gates every push to this surface, the tree
// request, and the three render states the view cannot derive for itself.
// `main.ts` keeps only the mount call — feature wiring lives with the feature,
// as it does for FileTreeController.

import type { WebViewToExtensionMessage, WorktreeTreeResponseMessage } from "../../types/messages";
import type { WebviewState } from "../state/WebviewState";
import type { VaultView } from "../vault/VaultPanel";
import type { WorktreeMenuActions } from "./WorktreeContextMenu";
import { WorktreeView } from "./WorktreeView";
import type { WorktreePresence, WorktreeRowActivation, WorktreeTree } from "./worktreeViewTypes";

/** The persisted-state reads and writes the view's two disclosure levels need. */
export interface WorktreeStateStore {
  getState(): WebviewState;
  updateState(patch: Partial<WebviewState>): void;
}

export interface WorktreeControllerDeps {
  /** Panel element dialogs and menus would position within. */
  host: HTMLElement;
  postMessage(msg: WebViewToExtensionMessage): void;
  store: WorktreeStateStore;
  /** Init fields this controller boots from. */
  init: { workspaceRoot: string | null; rowActivation: WorktreeRowActivation };
  /**
   * Open the session-preview overlay for a host-resolved entry. Returns false
   * when this surface holds no such entry — the host resolved against presence,
   * which can name a session this webview's own list does not have.
   */
  showPreview?(entryId: string): boolean;
  /** Activate a pane this surface holds. False when it holds no such pane. */
  activatePane?(paneId: string): boolean;
  /** Injected in tests so ages are deterministic. */
  now?(): number;
}

/**
 * Which body the panel opens on (§ 2.2). A recorded choice always wins; with
 * none, a workspace holding no repository would open on a permanently empty
 * view, which reads as a broken panel rather than a default.
 *
 * The derived answer is never written back, so a workspace that later gains a
 * repository opens on the Worktree body without the user having to ask.
 */
export function resolveInitialView(persisted: VaultView | undefined, hasRepo: boolean): VaultView {
  return persisted ?? (hasRepo ? "worktree" : "sessions");
}

/**
 * The menu's callbacks, each posting the request its label names and nothing
 * else. Ids only: the host re-resolves them against its own tree and presence,
 * so a path the view carried could never become the path an action ran on (D2).
 *
 * The mutating and launch actions are not this change's — they are supplied as
 * no-ops until their own capabilities exist, and 5_2 makes them absent instead.
 */
export function worktreeMenuActions(post: (msg: WebViewToExtensionMessage) => void): WorktreeMenuActions {
  return {
    openFolderInNewWindow: (info) => post({ type: "worktreeOpenFolder", worktreeId: info.id, mode: "newWindow" }),
    addFolderToWorkspace: (info) => post({ type: "worktreeOpenFolder", worktreeId: info.id, mode: "addToWorkspace" }),
    openTerminalHere: (info) => post({ type: "worktreeOpenTerminal", worktreeId: info.id }),
    revealWorktree: (info) => post({ type: "worktreeRevealInOS", worktreeId: info.id }),
    copyWorktreePath: (info) => post({ type: "worktreeCopyPath", worktreeId: info.id }),
    // toggleLock / removeWorktree / resumeHere are deliberately ABSENT rather
    // than no-ops: WT-005.2 and WT-005.3 light them by supplying their own
    // capabilities, and until then the items are not built at all (D10).

    focusPane: (row) => {
      if (row.paneId !== undefined) {
        post({ type: "worktreeFocusPane", rowId: row.rowId, paneId: row.paneId });
      }
    },
    openPreview: (row) => {
      if (row.entryId !== undefined) {
        post({ type: "worktreeOpenPreview", rowId: row.rowId, entryId: row.entryId });
      }
    },
    copyResumeCommand: (row) => {
      if (row.entryId !== undefined) {
        post({ type: "worktreeCopyResumeCommand", rowId: row.rowId, entryId: row.entryId });
      }
    },
    revealAgentCwd: (row) => {
      if (row.entryId !== undefined) {
        post({ type: "worktreeRevealAgentCwd", rowId: row.rowId, entryId: row.entryId });
      }
    },
    copyAgentPath: (row) => {
      if (row.entryId !== undefined) {
        post({ type: "worktreeCopyAgentPath", rowId: row.rowId, entryId: row.entryId });
      }
    },
  };
}

export class WorktreeController {
  /** The tree element — goes into `VaultPanel`'s `worktreeBody`. */
  readonly element: HTMLElement;

  private readonly deps: WorktreeControllerDeps;
  private readonly view: WorktreeView;
  private visible = false;
  private tree: WorktreeTree | null = null;
  private presence: WorktreePresence | null = null;
  private loading: boolean;
  private refreshing = false;
  private rowActivation: WorktreeRowActivation;

  static mount(deps: WorktreeControllerDeps): WorktreeController {
    return new WorktreeController(deps);
  }

  private constructor(deps: WorktreeControllerDeps) {
    this.deps = deps;
    // No folder means no tree is ever coming, so the skeleton would be a promise
    // the workspace cannot keep.
    this.loading = deps.init.workspaceRoot !== null;
    this.rowActivation = deps.init.rowActivation;
    this.view = new WorktreeView({
      host: deps.host,
      actions: worktreeMenuActions((msg) => deps.postMessage(msg)),
      getInitialCollapsed: () => deps.store.getState().worktreeCollapsed,
      persistCollapsed: (ids) => deps.store.updateState({ worktreeCollapsed: ids }),
      getInitialExpandedRows: () => deps.store.getState().worktreeExpandedRows ?? [],
      persistExpandedRows: (ids) => deps.store.updateState({ worktreeExpandedRows: ids }),
      // The reply is the next tree+presence envelope, carrying the roster on the
      // row itself — there is no response message to correlate here.
      onRequestSubagents: (row) => {
        if (row.entryId !== undefined) {
          this.deps.postMessage({ type: "requestWorktreeSubagents", rowId: row.rowId, entryId: row.entryId });
        }
      },
      // Ids only — the host resolves them against its own tree and presence, so
      // a path or session the view guessed can never reach an action (D2).
      onActivateAgent: (row, activation) => {
        if (activation === "focus") {
          if (row.paneId !== undefined) {
            this.deps.postMessage({ type: "worktreeFocusPane", rowId: row.rowId, paneId: row.paneId });
          }
          return;
        }
        if (row.entryId !== undefined) {
          this.deps.postMessage({ type: "worktreeOpenPreview", rowId: row.rowId, entryId: row.entryId });
        }
      },
      // A subagent has no pane of its own, so its activation is the PARENT's —
      // sending the user anywhere else would be a dead click (design.md D9).
      onActivateSubagent: (_subagent, parent) => {
        if (parent.paneId !== undefined) {
          this.deps.postMessage({ type: "worktreeFocusPane", rowId: parent.rowId, paneId: parent.paneId });
        }
      },
      // A getter, not a value: the setting is live, and re-reading it at the
      // click is what lets an update reach a view already painted.
      rowActivation: () => this.rowActivation,
      now: deps.now,
    });
    this.element = this.view.element;
    this.push();
  }

  /**
   * Declare whether this surface is showing the view, and ask for the tree on the
   * way in. The host sends nothing to a surface that has not declared it visible,
   * so this is what starts and stops the flow — nothing polls.
   */
  setVisible(visible: boolean): void {
    if (visible === this.visible) {
      return;
    }
    this.visible = visible;
    this.deps.postMessage({ type: "worktreeViewVisibility", visible });
    if (visible) {
      this.deps.postMessage({ type: "requestWorktreeTree" });
      return;
    }
    // A force in flight across this transition is never answered — the host skips
    // pushes to a surface that stopped showing the view.
    if (this.refreshing) {
      this.refreshing = false;
      this.push();
    }
  }

  /** Toolbar refresh: rebuild the listings rather than re-serve the cache. */
  requestRefresh(): void {
    if (!this.visible || this.refreshing) {
      return;
    }
    this.refreshing = true;
    this.deps.postMessage({ type: "requestWorktreeTree", force: true });
    this.push();
  }

  /** Filter the tree by branch, path, and agent title. */
  setQuery(query: string): void {
    this.view.setQuery(query);
  }

  /** A reply and an unsolicited push are the same message, handled the same way. */
  handleTreeResponse(msg: WorktreeTreeResponseMessage): void {
    this.tree = msg.tree;
    this.presence = msg.presence;
    this.loading = false;
    this.refreshing = false;
    this.push();
  }

  /**
   * The halves of an action the extension cannot perform, answered back here
   * (D2). Neither is a request the view raised on its own behalf: the host
   * resolved the id first, and a surface that does not hold it does nothing —
   * silently, because the surface that DOES hold it was sent the same message.
   */
  showPreview(entryId: string): void {
    this.deps.showPreview?.(entryId);
  }

  activatePane(paneId: string): void {
    this.deps.activatePane?.(paneId);
  }

  /** The setting moved after `init`. Nothing re-renders — the next click reads it. */
  setRowActivation(activation: WorktreeRowActivation): void {
    this.rowActivation = activation;
  }

  dispose(): void {
    this.view.dispose();
  }

  private push(): void {
    this.view.setData({
      tree: this.tree,
      presence: this.presence,
      loading: this.loading,
      refreshing: this.refreshing,
      noFolder: this.deps.init.workspaceRoot === null,
    });
  }
}
