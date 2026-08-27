// src/webview/worktree/WorktreeContextMenu.ts — Right-click menus for the Worktree
// view (worktree-actions § 3, worktree-panel-ui § 6).
//
// Item sets only: the lifecycle lives in ../shared/contextMenuShell.ts, shared
// with the vault menu (design.md D6), and reuses its `.vault-context-menu`
// styling rather than growing a second popup vocabulary.
//
// Two item sets, and the difference between them is a truthfulness rule, not a
// convenience: an EXTERNAL agent row has no pane in this window, so "Focus Pane" is
// ABSENT rather than disabled. A disabled item claims the action exists here.

import { type ContextMenuItem, ContextMenuShell } from "../shared/contextMenuShell";
import { collapseSeparators } from "../vault/format";
import { ICON_COPY, ICON_FOLDER, ICON_RESUME, ICON_REVEAL, ICON_TERMINAL } from "../vault/icons";
import { ICON_LOCK, ICON_PLUS, ICON_TRASH, ICON_WINDOW } from "./worktreeIcons";
import type { WorktreeAgentRow, WorktreeInfo } from "./worktreeViewTypes";

/** Every action the menus can raise. The owner decides what each one does. */
export interface WorktreeMenuActions {
  openFolderInNewWindow?: (info: WorktreeInfo) => void;
  addFolderToWorkspace?: (info: WorktreeInfo) => void;
  openTerminalHere?: (info: WorktreeInfo) => void;
  revealWorktree?: (info: WorktreeInfo) => void;
  copyWorktreePath?: (info: WorktreeInfo) => void;
  toggleLock?: (info: WorktreeInfo) => void;
  removeWorktree?: (info: WorktreeInfo) => void;
  createWorktree?: (info: WorktreeInfo) => void;
  /**
   * Drop this repository's stale registrations. Offered ONLY when the repo has
   * something prunable — `prunableCount` is how the menu knows, and an absent
   * item is the truthful rendering of "nothing to prune" (worktree-actions.md
   * § 3.5, `:351`).
   */
  pruneRepo?: (info: WorktreeInfo) => void;
  /**
   * Start an agent in this worktree. Offered ONLY when the host reported at
   * least one agent that can start a fresh session — an item that opens a
   * dialog with nothing to pick is the inert control this rule forbids
   * (worktree-actions.md § 4).
   */
  launchAgentHere?: (info: WorktreeInfo) => void;

  focusPane?: (row: WorktreeAgentRow) => void;
  openPreview?: (row: WorktreeAgentRow) => void;
  resumeHere?: (row: WorktreeAgentRow) => void;
  copyResumeCommand?: (row: WorktreeAgentRow) => void;
  revealAgentCwd?: (row: WorktreeAgentRow) => void;
  copyAgentPath?: (row: WorktreeAgentRow) => void;
}

/**
 * One item, built only when its capability exists. A capability the owner did
 * not supply makes the item ABSENT — never present and inert, which would claim
 * the action exists here and merely isn't available (design.md D10).
 */
function item<T>(
  capability: ((target: T) => void) | undefined,
  target: T,
  label: string,
  icon: string,
): ContextMenuItem[] {
  return capability ? [{ label, icon, act: () => capability(target) }] : [];
}

export class WorktreeContextMenu {
  private readonly shell: ContextMenuShell;
  private readonly actions: WorktreeMenuActions;
  /** Registrations this repo could drop right now. Read at open, never cached. */
  private readonly prunableCount: (info: WorktreeInfo) => number;

  constructor(deps: {
    host: HTMLElement;
    actions: WorktreeMenuActions;
    prunableCount?: (info: WorktreeInfo) => number;
  }) {
    this.shell = new ContextMenuShell(deps.host);
    this.actions = deps.actions;
    // Nothing prunable is the safe default: a menu wired without this offers no
    // prune rather than offering one it cannot count.
    this.prunableCount = deps.prunableCount ?? (() => 0);
  }

  isOpen(): boolean {
    return this.shell.isOpen();
  }

  /** Items for a worktree row. `missing` and `main` change what is even offered. */
  private worktreeItems(info: WorktreeInfo): (ContextMenuItem | "sep")[] {
    const prunableCount = this.prunableCount(info);
    const a = this.actions;
    // A directory that is gone cannot be opened, revealed, or given a terminal.
    const onDisk = !info.missing;
    return collapseSeparators<ContextMenuItem>([
      ...(onDisk
        ? ([
            ...item(a.openFolderInNewWindow, info, "Open Folder in New Window", ICON_WINDOW),
            ...item(a.addFolderToWorkspace, info, "Add Folder to Workspace", ICON_PLUS),
            ...item(a.openTerminalHere, info, "Open Terminal Here", ICON_TERMINAL),
            "sep",
            ...item(a.revealWorktree, info, "Reveal in Finder", ICON_REVEAL),
          ] as (ContextMenuItem | "sep")[])
        : []),
      // Copy Path works whether or not the directory still exists — it is how the
      // user goes and looks at what happened to it.
      ...item(a.copyWorktreePath, info, "Copy Path", ICON_COPY),
      "sep",
      ...item(a.toggleLock, info, info.locked ? "Unlock Worktree" : "Lock Worktree", ICON_LOCK),
      // The main worktree is never removable, so the item is absent, not disabled.
      ...(info.kind === "main" ? [] : item(a.removeWorktree, info, "Remove Worktree…", ICON_TRASH)),
      // Create is repo-scoped, so it is offered from any row of the repo — and
      // it is the item that makes the whole create path reachable at all.
      ...item(a.createWorktree, info, "New Worktree…", ICON_PLUS),
      // Above the destructive pair, below the openers: starting an agent is the
      // point of most worktrees, not an afterthought.
      ...item(a.launchAgentHere, info, "Start an Agent Here…", ICON_RESUME),
      // Absent, not disabled, when nothing is prunable: a disabled item claims
      // the action exists here.
      ...(prunableCount > 0
        ? item(a.pruneRepo, info, `Prune ${prunableCount} Registration${prunableCount === 1 ? "" : "s"}…`, ICON_TRASH)
        : []),
    ]);
  }

  /** Items for an agent row. An external row is never offered Focus Pane. */
  private agentItems(row: WorktreeAgentRow): (ContextMenuItem | "sep")[] {
    const a = this.actions;
    const inWindow = row.scope === "window";
    return collapseSeparators<ContextMenuItem>([
      ...(inWindow ? item(a.focusPane, row, "Focus Pane", ICON_WINDOW) : []),
      // Everything below needs a vault entry to act ON: the preview opens that
      // session, resume resumes it, and the two working-directory items resolve
      // the cwd recorded against it (design.md D8). A row whose identity came
      // from launch or title evidence alone has no `entryId` yet, so none of the
      // five is offered rather than offered and inert (round-1 B3).
      ...(row.entryId
        ? ([
            ...item(a.openPreview, row, "Open Session Preview", ICON_TERMINAL),
            ...item(a.resumeHere, row, "Resume Session Here", ICON_RESUME),
            ...item(a.copyResumeCommand, row, "Copy Resume Command", ICON_COPY),
            "sep",
            ...item(a.revealAgentCwd, row, "Reveal in Finder", ICON_REVEAL),
            ...item(a.copyAgentPath, row, "Copy Path", ICON_FOLDER),
          ] as (ContextMenuItem | "sep")[])
        : []),
    ]);
  }

  openForWorktree(info: WorktreeInfo, ev: MouseEvent, row: HTMLElement): void {
    this.openMenu(this.worktreeItems(info), ev, row);
  }

  openForAgent(agentRow: WorktreeAgentRow, ev: MouseEvent, row: HTMLElement): void {
    this.openMenu(this.agentItems(agentRow), ev, row);
  }

  private openMenu(items: (ContextMenuItem | "sep")[], ev: MouseEvent, row: HTMLElement): void {
    this.shell.open(items, ev, row);
  }

  close(): void {
    this.shell.close();
  }
}
