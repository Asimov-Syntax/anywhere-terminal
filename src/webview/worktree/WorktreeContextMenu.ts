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
import { menuItem, worktreeActionItems } from "./worktreeActionItems";
import { ICON_WINDOW } from "./worktreeIcons";
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

  /**
   * Called as an agent row's menu is BUILT, before any item is offered.
   *
   * Every value an item acts on is captured when the menu is built — `item()`
   * closes over its target. Anything an action needs that is NOT on the row has
   * to be captured at the same moment, or it is read from state that moved
   * while the menu sat open. The registration a resume quotes is such a value:
   * it changes without repainting, by design (design.md D10), so the open menu
   * keeps showing the row it was built for while the tree behind it moves on
   * (round-7 B5).
   */
  captureTarget?: (row: WorktreeAgentRow) => void;

  focusPane?: (row: WorktreeAgentRow) => void;
  openPreview?: (row: WorktreeAgentRow) => void;
  resumeHere?: (row: WorktreeAgentRow) => void;
  copyResumeCommand?: (row: WorktreeAgentRow) => void;
  revealAgentCwd?: (row: WorktreeAgentRow) => void;
  copyAgentPath?: (row: WorktreeAgentRow) => void;
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

  /** Items for an agent row. An external row is never offered Focus Pane. */
  private agentItems(row: WorktreeAgentRow): (ContextMenuItem | "sep")[] {
    const a = this.actions;
    const inWindow = row.scope === "window";
    return collapseSeparators<ContextMenuItem>([
      ...(inWindow ? menuItem(a.focusPane, row, "Focus Pane", ICON_WINDOW) : []),
      // Everything below needs a vault entry to act ON: the preview opens that
      // session, resume resumes it, and the two working-directory items resolve
      // the cwd recorded against it (design.md D8). A row whose identity came
      // from launch or title evidence alone has no `entryId` yet, so none of the
      // five is offered rather than offered and inert (round-1 B3).
      ...(row.entryId
        ? ([
            ...menuItem(a.openPreview, row, "Open Session Preview", ICON_TERMINAL),
            ...menuItem(a.resumeHere, row, "Resume Session Here", ICON_RESUME),
            ...menuItem(a.copyResumeCommand, row, "Copy Resume Command", ICON_COPY),
            "sep",
            ...menuItem(a.revealAgentCwd, row, "Reveal in Finder", ICON_REVEAL),
            ...menuItem(a.copyAgentPath, row, "Copy Path", ICON_FOLDER),
          ] as (ContextMenuItem | "sep")[])
        : []),
    ]);
  }

  openForWorktree(info: WorktreeInfo, ev: MouseEvent, row: HTMLElement): void {
    // Repo-scoped: this menu is the repository's only door to create and prune.
    const items = worktreeActionItems(info, this.actions, {
      prunableCount: this.prunableCount(info),
      repoScoped: true,
    });
    this.openMenu(items, ev, row);
  }

  openForAgent(agentRow: WorktreeAgentRow, ev: MouseEvent, row: HTMLElement): void {
    this.actions.captureTarget?.(agentRow);
    this.openMenu(this.agentItems(agentRow), ev, row);
  }

  private openMenu(items: (ContextMenuItem | "sep")[], ev: MouseEvent, row: HTMLElement): void {
    this.shell.open(items, ev, row);
  }

  close(): void {
    this.shell.close();
  }
}
