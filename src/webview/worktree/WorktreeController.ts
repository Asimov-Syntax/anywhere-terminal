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
import { WorktreeView } from "./WorktreeView";
import type { WorktreePresence, WorktreeTree } from "./worktreeViewTypes";

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
  init: { workspaceRoot: string | null };
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

  static mount(deps: WorktreeControllerDeps): WorktreeController {
    return new WorktreeController(deps);
  }

  private constructor(deps: WorktreeControllerDeps) {
    this.deps = deps;
    // No folder means no tree is ever coming, so the skeleton would be a promise
    // the workspace cannot keep.
    this.loading = deps.init.workspaceRoot !== null;
    this.view = new WorktreeView({
      host: deps.host,
      // No action surface while no action path exists (D5): over a real worktree
      // these controls would either do nothing or state evidence never obtained.
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
