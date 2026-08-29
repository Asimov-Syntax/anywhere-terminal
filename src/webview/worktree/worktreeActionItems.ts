// src/webview/worktree/worktreeActionItems.ts — What a worktree can be asked to
// do, as one list (worktree-actions § 2).
//
// Lifted out of WorktreeContextMenu so the inspector drawer offers exactly what
// the menu offers, under exactly the same conditions. The gating here is a set of
// truthfulness rules, not conveniences — `missing` withdraws the openers, the main
// worktree is never removable, an absent capability makes the item ABSENT rather
// than present and inert — and each one cost a review round to find. A second
// surface re-deriving them is a second place for one of them to go missing.
//
// The list is what varies; how it is DRAWN is the caller's: the menu renders
// items and separators, the drawer renders buttons and drops the separators.

import type { ContextMenuItem } from "../shared/contextMenuShell";
import { collapseSeparators } from "../vault/format";
import { ICON_COPY, ICON_RESUME, ICON_REVEAL, ICON_TERMINAL } from "../vault/icons";
import type { WorktreeMenuActions } from "./WorktreeContextMenu";
import { ICON_LOCK, ICON_PLUS, ICON_TRASH, ICON_WINDOW } from "./worktreeIcons";
import type { WorktreeInfo } from "./worktreeViewTypes";

export interface WorktreeActionItemOptions {
  /** Registrations this repo could drop right now. Read at build, never cached. */
  prunableCount: number;
  /**
   * Whether the surface acts for the whole REPOSITORY as well as this worktree.
   *
   * The menu is opened on a row but is the repo's only door to create and prune,
   * so it says `true`. The inspector is about one worktree, and an action that
   * silently targets its repository instead would be the same false claim as an
   * item that cannot act at all.
   */
  repoScoped: boolean;
}

/**
 * One item, built only when its capability exists. A capability the owner did
 * not supply makes the item ABSENT — never present and inert, which would claim
 * the action exists here and merely isn't available (design.md D10).
 *
 * Exported because the agent-row menu applies the same rule to a different
 * target shape; one implementation of "absent, never inert" for both.
 */
export function menuItem<T>(
  capability: ((target: T) => void) | undefined,
  target: T,
  label: string,
  icon: string,
): ContextMenuItem[] {
  return capability ? [{ label, icon, act: () => capability(target) }] : [];
}

/** Every action offerable for `info`. `missing` and `main` change what is even offered. */
export function worktreeActionItems(
  info: WorktreeInfo,
  actions: WorktreeMenuActions,
  opts: WorktreeActionItemOptions,
): (ContextMenuItem | "sep")[] {
  const a = actions;
  // A directory that is gone cannot be opened, revealed, or given a terminal.
  const onDisk = !info.missing;
  return collapseSeparators<ContextMenuItem>([
    ...(onDisk
      ? ([
          ...menuItem(a.openFolderInNewWindow, info, "Open Folder in New Window", ICON_WINDOW),
          ...menuItem(a.addFolderToWorkspace, info, "Add Folder to Workspace", ICON_PLUS),
          ...menuItem(a.openTerminalHere, info, "Open Terminal Here", ICON_TERMINAL),
          "sep",
          ...menuItem(a.revealWorktree, info, "Reveal in Finder", ICON_REVEAL),
        ] as (ContextMenuItem | "sep")[])
      : []),
    // Copy Path works whether or not the directory still exists — it is how the
    // user goes and looks at what happened to it.
    ...menuItem(a.copyWorktreePath, info, "Copy Path", ICON_COPY),
    "sep",
    ...menuItem(a.toggleLock, info, info.locked ? "Unlock Worktree" : "Lock Worktree", ICON_LOCK),
    // The main worktree is never removable, so the item is absent, not disabled.
    ...(info.kind === "main" ? [] : menuItem(a.removeWorktree, info, "Remove Worktree…", ICON_TRASH)),
    // Create is repo-scoped, so it is offered from any row of the repo — and
    // it is the item that makes the whole create path reachable at all.
    ...(opts.repoScoped ? menuItem(a.createWorktree, info, "New Worktree…", ICON_PLUS) : []),
    // Above the destructive pair, below the openers: starting an agent is the
    // point of most worktrees, not an afterthought.
    ...menuItem(a.launchAgentHere, info, "Start an Agent Here…", ICON_RESUME),
    // Absent, not disabled, when nothing is prunable: a disabled item claims
    // the action exists here.
    ...(opts.repoScoped && opts.prunableCount > 0
      ? menuItem(
          a.pruneRepo,
          info,
          `Prune ${opts.prunableCount} Registration${opts.prunableCount === 1 ? "" : "s"}…`,
          ICON_TRASH,
        )
      : []),
  ]);
}
