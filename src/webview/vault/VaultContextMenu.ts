// src/webview/vault/VaultContextMenu.ts — Right-click context menu for a vault
// row (redesign 5_1). Self-contained controller: owns the menu element, its
// anchor row, and the document-level dismiss listeners — so the menu's lifecycle
// (open / close / outside-click / Esc) lives in one place.
//
// Every item posts an `entryId`-only message — the webview sends no path (D9).
// The file-targeting items (Open / Reveal / Copy File Path) appear only when the
// session is file-backed (`sessionPath`).

import type { VaultSessionEntry } from "../../vault/types";
import { collapseSeparators } from "./format";
import { ICON_COPY, ICON_FOLDER, ICON_OPEN, ICON_RENAME, ICON_RESUME, ICON_REVEAL, ICON_TERMINAL } from "./icons";
import type { VaultPanelPostMessage } from "./VaultPanel";
import { canResumeVaultEntry } from "./vaultListView";

export class VaultContextMenu {
  private readonly host: HTMLElement;
  private readonly postMessage: VaultPanelPostMessage;
  /** Start an inline rename on the anchor row (owner supplies the editor). */
  private readonly beginRename: (entry: VaultSessionEntry, row: HTMLElement) => void;
  private menuEl: HTMLElement | null = null;
  private menuRow: HTMLElement | null = null;
  private onDocPointerDown?: (ev: MouseEvent) => void;
  private onDocKeyDown?: (ev: KeyboardEvent) => void;

  constructor(deps: {
    host: HTMLElement;
    postMessage: VaultPanelPostMessage;
    beginRename: (entry: VaultSessionEntry, row: HTMLElement) => void;
  }) {
    this.host = deps.host;
    this.postMessage = deps.postMessage;
    this.beginRename = deps.beginRename;
  }

  /** Whether the menu is currently open — lets the preview's Esc handler dismiss
   *  only this layer first when both are open (W5). */
  isOpen(): boolean {
    return this.menuEl !== null;
  }

  /**
   * Open the menu for a row, anchored at the cursor and clamped within the panel.
   */
  open(entry: VaultSessionEntry, ev: MouseEvent, row: HTMLElement): void {
    this.close();

    const menu = document.createElement("div");
    menu.className = "vault-context-menu";
    menu.setAttribute("role", "menu");

    const fileBacked = typeof entry.sessionPath === "string" && entry.sessionPath.length > 0;
    const canResume = canResumeVaultEntry(entry);
    type MenuItem = { label: string; icon: string; fileOnly?: boolean; act: () => void };
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
    const visible = collapseSeparators(items.filter((it) => it === "sep" || !it.fileOnly || fileBacked));
    for (const it of visible) {
      if (it === "sep") {
        menu.appendChild(document.createElement("hr"));
        continue;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "menuitem");
      const iconSpan = document.createElement("span");
      iconSpan.innerHTML = it.icon;
      iconSpan.setAttribute("aria-hidden", "true");
      const labelSpan = document.createElement("span");
      labelSpan.textContent = it.label;
      btn.append(iconSpan, labelSpan);
      btn.addEventListener("click", () => {
        it.act();
        this.close();
      });
      menu.appendChild(btn);
    }

    this.host.appendChild(menu);

    // Position relative to the panel (it is `position: relative`), clamped in.
    const rect = this.host.getBoundingClientRect();
    let left = ev.clientX - rect.left;
    let top = ev.clientY - rect.top;
    const maxLeft = this.host.clientWidth - menu.offsetWidth - 4;
    const maxTop = this.host.clientHeight - menu.offsetHeight - 4;
    if (maxLeft > 0 && left > maxLeft) {
      left = maxLeft;
    }
    if (maxTop > 0 && top > maxTop) {
      top = maxTop;
    }
    menu.style.left = `${Math.max(4, left)}px`;
    menu.style.top = `${Math.max(4, top)}px`;

    this.menuEl = menu;
    this.menuRow = row;
    row.classList.add("is-context-open");

    // The opening event is a `contextmenu`, so attaching mousedown/keydown now
    // won't self-close. Close on Esc or any pointer-down outside the menu.
    this.onDocPointerDown = (e) => {
      if (this.menuEl && !this.menuEl.contains(e.target as Node)) {
        this.close();
      }
    };
    this.onDocKeyDown = (e) => {
      if (e.key === "Escape") {
        this.close();
      }
    };
    document.addEventListener("mousedown", this.onDocPointerDown);
    document.addEventListener("keydown", this.onDocKeyDown);
  }

  close(): void {
    if (this.onDocPointerDown) {
      document.removeEventListener("mousedown", this.onDocPointerDown);
      this.onDocPointerDown = undefined;
    }
    if (this.onDocKeyDown) {
      document.removeEventListener("keydown", this.onDocKeyDown);
      this.onDocKeyDown = undefined;
    }
    this.menuRow?.classList.remove("is-context-open");
    this.menuRow = null;
    this.menuEl?.remove();
    this.menuEl = null;
  }
}
