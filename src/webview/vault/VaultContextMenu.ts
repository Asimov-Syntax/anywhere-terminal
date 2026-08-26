// src/webview/vault/VaultContextMenu.ts — Right-click context menu for a vault
// row (redesign 5_1). Item set only: the lifecycle lives in
// ../shared/contextMenuShell.ts, shared with the worktree menu (design.md D6),
// which is where this menu picks up first-item focus, arrow navigation, focus
// restore on Escape, and dismissal before the item acts.
//
// Every item posts an `entryId`-only message — the webview sends no path (D9).
// The file-targeting items (Open / Reveal / Copy File Path) appear only when the
// session is file-backed (`sessionPath`), and the menu as a whole appears only on
// a surface that can perform the messages it posts (round-2 B4).

import type { VaultSessionEntry } from "../../vault/types";
import { type ContextMenuItem, ContextMenuShell } from "../shared/contextMenuShell";
import { collapseSeparators } from "./format";
import { ICON_COPY, ICON_FOLDER, ICON_OPEN, ICON_RENAME, ICON_RESUME, ICON_REVEAL, ICON_TERMINAL } from "./icons";
import type { VaultPanelPostMessage } from "./VaultPanel";
import { canResumeVaultEntry } from "./vaultListView";

export class VaultContextMenu {
  private readonly shell: ContextMenuShell;
  private readonly postMessage: VaultPanelPostMessage;
  /** Start an inline rename on the anchor row (owner supplies the editor). */
  private readonly beginRename: (entry: VaultSessionEntry, row: HTMLElement) => void;

  /** False on a surface that handles none of the messages these items post. */
  private readonly actionsAvailable: boolean;

  constructor(deps: {
    host: HTMLElement;
    postMessage: VaultPanelPostMessage;
    actionsAvailable?: boolean;
    beginRename: (entry: VaultSessionEntry, row: HTMLElement) => void;
  }) {
    this.shell = new ContextMenuShell(deps.host);
    this.postMessage = deps.postMessage;
    this.actionsAvailable = deps.actionsAvailable ?? true;
    this.beginRename = deps.beginRename;
  }

  /** Whether the menu is currently open — lets the preview's Esc handler dismiss
   *  only this layer first when both are open (W5). */
  isOpen(): boolean {
    return this.shell.isOpen();
  }

  /**
   * Open the menu for a row, anchored at the cursor and clamped within the panel.
   */
  open(entry: VaultSessionEntry, ev: MouseEvent, row: HTMLElement): void {
    // Every item here posts an action message. On a surface that handles none of
    // them the whole menu is absent rather than a list of controls that look
    // operational and do nothing (.reviews/round-2.md B4).
    if (!this.actionsAvailable) {
      return;
    }
    const fileBacked = typeof entry.sessionPath === "string" && entry.sessionPath.length > 0;
    const canResume = canResumeVaultEntry(entry);
    type MenuItem = ContextMenuItem & { fileOnly?: boolean };
    const items: (MenuItem | "sep")[] = [
      ...(canResume
        ? [
            {
              label: "Resume in New Tab",
              icon: ICON_RESUME,
              act: () => {
                if (canResume) {
                  this.postMessage({ type: "vaultResume", entryId: entry.id });
                }
              },
            },
          ]
        : []),
      {
        label: "Rename",
        icon: ICON_RENAME,
        act: () => this.beginRename(entry, row),
      },
      "sep",
      {
        label: "Open",
        icon: ICON_OPEN,
        fileOnly: true,
        act: () => this.postMessage({ type: "vaultOpenSessionFile", entryId: entry.id }),
      },
      {
        label: "Reveal in Finder",
        icon: ICON_REVEAL,
        fileOnly: true,
        act: () => this.postMessage({ type: "vaultRevealInOS", entryId: entry.id }),
      },
      "sep",
      {
        label: "Copy File Path",
        icon: ICON_COPY,
        fileOnly: true,
        act: () => this.postMessage({ type: "vaultCopyFilePath", entryId: entry.id }),
      },
      ...(canResume
        ? [
            {
              label: "Copy Resume Command",
              icon: ICON_TERMINAL,
              act: () => {
                if (canResume) {
                  this.postMessage({ type: "vaultCopyResumeCommand", entryId: entry.id });
                }
              },
            },
          ]
        : []),
      {
        label: "Open Working Directory",
        icon: ICON_FOLDER,
        act: () => this.postMessage({ type: "vaultOpenWorkingDir", entryId: entry.id }),
      },
    ];
    this.shell.open(collapseSeparators(items.filter((it) => it === "sep" || !it.fileOnly || fileBacked)), ev, row);
  }

  close(): void {
    this.shell.close();
  }
}
