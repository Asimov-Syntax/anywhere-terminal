// src/webview/worktree/WorktreeContextMenu.ts — Right-click menus for the Worktree
// view (worktree-actions § 3, worktree-panel-ui § 6).
//
// Self-contained controller owning the menu element, its anchor row, and the
// document-level dismiss listeners — the same shape as
// src/webview/vault/VaultContextMenu.ts, and it reuses that menu's `.vault-context-menu`
// styling rather than growing a second popup vocabulary.
//
// Two item sets, and the difference between them is a truthfulness rule, not a
// convenience: an EXTERNAL agent row has no pane in this window, so "Focus Pane" is
// ABSENT rather than disabled. A disabled item claims the action exists here.

import { collapseSeparators } from "../vault/format";
import { ICON_COPY, ICON_FOLDER, ICON_RESUME, ICON_REVEAL, ICON_TERMINAL } from "../vault/icons";
import { ICON_LOCK, ICON_PLUS, ICON_TRASH, ICON_WINDOW } from "./worktreeIcons";
import type { WorktreeAgentRow, WorktreeInfo } from "./worktreeViewTypes";

/** Every action the menus can raise. The owner decides what each one does. */
export interface WorktreeMenuActions {
  openFolderInNewWindow: (info: WorktreeInfo) => void;
  addFolderToWorkspace: (info: WorktreeInfo) => void;
  openTerminalHere: (info: WorktreeInfo) => void;
  revealWorktree: (info: WorktreeInfo) => void;
  copyWorktreePath: (info: WorktreeInfo) => void;
  toggleLock: (info: WorktreeInfo) => void;
  removeWorktree: (info: WorktreeInfo) => void;
  createWorktree?: (info: WorktreeInfo) => void;

  focusPane: (row: WorktreeAgentRow) => void;
  openPreview: (row: WorktreeAgentRow) => void;
  resumeHere: (row: WorktreeAgentRow) => void;
  copyResumeCommand: (row: WorktreeAgentRow) => void;
  revealAgentCwd: (row: WorktreeAgentRow) => void;
  copyAgentPath: (row: WorktreeAgentRow) => void;
}

interface MenuItem {
  label: string;
  icon: string;
  act: () => void;
}

export class WorktreeContextMenu {
  private readonly host: HTMLElement;
  /** Anchor row kept past `close()`, which clears `menuRow`, so Escape can restore focus. */
  private menuRowRestore: HTMLElement | null = null;
  private readonly actions: WorktreeMenuActions;
  private menuEl: HTMLElement | null = null;
  private menuRow: HTMLElement | null = null;
  private onDocPointerDown?: (ev: MouseEvent) => void;
  private onDocKeyDown?: (ev: KeyboardEvent) => void;

  constructor(deps: { host: HTMLElement; actions: WorktreeMenuActions }) {
    this.host = deps.host;
    this.actions = deps.actions;
  }

  isOpen(): boolean {
    return this.menuEl !== null;
  }

  /** Items for a worktree row. `missing` and `main` change what is even offered. */
  private worktreeItems(info: WorktreeInfo): (MenuItem | "sep")[] {
    const a = this.actions;
    // A directory that is gone cannot be opened, revealed, or given a terminal.
    const onDisk = !info.missing;
    return collapseSeparators<MenuItem>([
      ...(onDisk
        ? ([
            { label: "Open Folder in New Window", icon: ICON_WINDOW, act: () => a.openFolderInNewWindow(info) },
            { label: "Add Folder to Workspace", icon: ICON_PLUS, act: () => a.addFolderToWorkspace(info) },
            { label: "Open Terminal Here", icon: ICON_TERMINAL, act: () => a.openTerminalHere(info) },
            "sep",
            { label: "Reveal in Finder", icon: ICON_REVEAL, act: () => a.revealWorktree(info) },
          ] as (MenuItem | "sep")[])
        : []),
      // Copy Path works whether or not the directory still exists — it is how the
      // user goes and looks at what happened to it.
      { label: "Copy Path", icon: ICON_COPY, act: () => a.copyWorktreePath(info) },
      "sep",
      { label: info.locked ? "Unlock Worktree" : "Lock Worktree", icon: ICON_LOCK, act: () => a.toggleLock(info) },
      // The main worktree is never removable, so the item is absent, not disabled.
      ...(info.kind === "main"
        ? []
        : ([{ label: "Remove Worktree…", icon: ICON_TRASH, act: () => a.removeWorktree(info) }] as MenuItem[])),
    ]);
  }

  /** Items for an agent row. An external row is never offered Focus Pane. */
  private agentItems(row: WorktreeAgentRow): (MenuItem | "sep")[] {
    const a = this.actions;
    const inWindow = row.scope === "window";
    return collapseSeparators<MenuItem>([
      ...(inWindow ? ([{ label: "Focus Pane", icon: ICON_WINDOW, act: () => a.focusPane(row) }] as MenuItem[]) : []),
      { label: "Open Session Preview", icon: ICON_TERMINAL, act: () => a.openPreview(row) },
      // Resume needs a vault entry to resume FROM; without one it is not offered.
      ...(row.entryId
        ? ([
            { label: "Resume Session Here", icon: ICON_RESUME, act: () => a.resumeHere(row) },
            { label: "Copy Resume Command", icon: ICON_COPY, act: () => a.copyResumeCommand(row) },
          ] as MenuItem[])
        : []),
      "sep",
      { label: "Reveal in Finder", icon: ICON_REVEAL, act: () => a.revealAgentCwd(row) },
      { label: "Copy Path", icon: ICON_FOLDER, act: () => a.copyAgentPath(row) },
    ]);
  }

  openForWorktree(info: WorktreeInfo, ev: MouseEvent, row: HTMLElement): void {
    this.openMenu(this.worktreeItems(info), ev, row);
  }

  openForAgent(agentRow: WorktreeAgentRow, ev: MouseEvent, row: HTMLElement): void {
    this.openMenu(this.agentItems(agentRow), ev, row);
  }

  private openMenu(items: (MenuItem | "sep")[], ev: MouseEvent, row: HTMLElement): void {
    this.close();

    const menu = document.createElement("div");
    menu.className = "vault-context-menu";
    menu.setAttribute("role", "menu");
    for (const it of items) {
      if (it === "sep") {
        menu.appendChild(document.createElement("hr"));
        continue;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "menuitem");
      const iconSpan = document.createElement("span");
      iconSpan.innerHTML = it.icon; // static icon constant, never row-derived
      iconSpan.setAttribute("aria-hidden", "true");
      const labelSpan = document.createElement("span");
      labelSpan.textContent = it.label;
      btn.append(iconSpan, labelSpan);
      btn.addEventListener("click", () => {
        // Closed first: an item that opens a dialog must not have this button as
        // the dialog's opener, because it is removed before focus returns to it.
        this.close();
        it.act();
      });
      menu.appendChild(btn);
    }
    this.host.appendChild(menu);

    // Position relative to the panel (which is `position: relative`), clamped in.
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
    this.menuRowRestore = row;
    row.classList.add("is-context-open");

    this.onDocPointerDown = (e) => {
      if (this.menuEl && !this.menuEl.contains(e.target as Node)) {
        this.close();
      }
    };
    const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>("button"));
    buttons[0]?.focus();
    this.onDocKeyDown = (e) => {
      if (e.key === "Escape") {
        this.close();
        this.menuRowRestore?.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") {
        return;
      }
      e.preventDefault();
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const step = e.key === "ArrowDown" ? 1 : -1;
      const next = at < 0 ? 0 : (at + step + buttons.length) % buttons.length;
      buttons[next]?.focus();
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
