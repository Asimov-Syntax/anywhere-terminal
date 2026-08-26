// src/webview/worktree/worktreePreview.ts — Constructs a WorktreeView backed by
// the static fixtures, so the fourth segment is reachable in the running
// extension before any host protocol exists.
//
// This is the seam the wiring pass removes: everything below either (a) supplies
// data the host will later push, or (b) absorbs an action the host will later
// perform. Nothing here talks to git, and no action mutates anything on disk —
// the view renders, navigates, filters, and opens its dialogs, and that is all.
//
// See: docs/design/worktree-panel-ui.md, docs/ui/worktree.html.

import { WorktreeView } from "./WorktreeView";
import {
  confirmableBlocker,
  createDefaults,
  refusedBlocker,
  singleRepoPresence,
  singleRepoTree,
} from "./worktreeFixtures";
import type { WorktreeAgentRow, WorktreeInfo, WorktreeRemoveBlocker } from "./worktreeViewTypes";

export interface WorktreePreviewDeps {
  /** Panel element the dialogs and context menu are positioned within. */
  host: HTMLElement;
  /**
   * An action the host owns and this preview cannot perform (open a window,
   * spawn a terminal, run `git worktree remove`). Called instead of doing it,
   * so a dead menu item is observable rather than silent.
   */
  onHostAction: (action: string, target: string) => void;
  getInitialCollapsed?: () => string[] | undefined;
  persistCollapsed?: (ids: string[]) => void;
  getInitialExpandedRows?: () => string[];
  persistExpandedRows?: (ids: string[]) => void;
}

/** Which confirmation § 11 vs § 12 a fixture worktree earns, from its own rows. */
function blockerFor(info: WorktreeInfo, rows: WorktreeAgentRow[]): WorktreeRemoveBlocker {
  const busy = rows.filter((row) => row.activity === "running" || row.activity === "waiting").length;
  if (info.kind === "main" || busy > 0) {
    return { ...refusedBlocker, busyAgents: busy, isMain: info.kind === "main" };
  }
  return { ...confirmableBlocker, locked: info.locked, externalAgents: 0 };
}

/**
 * Builds the view and pushes the fixture tree into it. The caller owns the
 * returned instance: `element` goes into `VaultPanel`'s `worktreeBody`, and
 * `openCreateDialog` / `setQuery` are driven by the panel's toolbar.
 */
export function createWorktreePreview(deps: WorktreePreviewDeps): WorktreeView {
  const tree = singleRepoTree();
  const presence = singleRepoPresence(Date.now());
  const rowsFor = (worktreeId: string): WorktreeAgentRow[] => presence.rowsByWorktreeId[worktreeId] ?? [];
  const host = (action: string) => (target: WorktreeInfo | WorktreeAgentRow) =>
    deps.onHostAction(action, "id" in target ? target.id : target.rowId);

  const view = new WorktreeView({
    host: deps.host,
    actions: {
      openFolderInNewWindow: host("openFolderInNewWindow"),
      addFolderToWorkspace: host("addFolderToWorkspace"),
      openTerminalHere: host("openTerminalHere"),
      revealWorktree: host("revealWorktree"),
      copyWorktreePath: host("copyWorktreePath"),
      toggleLock: host("toggleLock"),
      removeWorktree: (info) => {
        const rows = rowsFor(info.id);
        view.openRemoveDialog({ info, blocker: blockerFor(info, rows), agentRows: rows });
      },
      focusPane: host("focusPane"),
      openPreview: host("openPreview"),
      resumeHere: host("resumeHere"),
      copyResumeCommand: host("copyResumeCommand"),
      revealAgentCwd: host("revealAgentCwd"),
      copyAgentPath: host("copyAgentPath"),
    },
    onActivateAgent: host("activateAgent"),
    onActivateSubagent: (subagent) => deps.onHostAction("activateSubagent", subagent.name),
    onRetryRepo: (repoId) => deps.onHostAction("retryRepo", repoId),
    onPrune: (repoId) => deps.onHostAction("prune", repoId),
    onForceRemove: (info, fingerprint) => deps.onHostAction(`forceRemove(${fingerprint})`, info.id),
    createDialogDeps: () => ({ repos: [createDefaults()] }),
    onCreateSubmit: (draft) => deps.onHostAction("createWorktree", draft.path),
    getInitialCollapsed: deps.getInitialCollapsed,
    persistCollapsed: deps.persistCollapsed,
    getInitialExpandedRows: deps.getInitialExpandedRows,
    persistExpandedRows: deps.persistExpandedRows,
  });

  view.setData({ tree, presence });
  return view;
}
