// src/webview/shared/contextMenuShell.ts — The lifecycle both panel context
// menus were keeping their own copy of.
// See: asimov/changes/wire-worktree-navigation-actions/design.md D6
//
// Owns element construction, cursor-anchored clamped placement, outside-pointer
// dismissal, `Escape`, arrow navigation, the anchor row's open class, focus
// restore, and listener teardown.
//
// It deliberately owns NOTHING about items: which items exist, their order, and
// the rules that make an unavailable item ABSENT rather than disabled belong to
// each panel's own spec, so each menu keeps them and passes the result in.

/** One item, already decided upon by the caller. */
export interface ContextMenuItem {
  label: string;
  /** Static icon constant — never row-derived, because it reaches `innerHTML`. */
  icon: string;
  act: () => void;
}

/** A rendered separator. Callers collapse runs of these before passing them in. */
export type ContextMenuEntry = ContextMenuItem | "sep";

export class ContextMenuShell {
  private readonly host: HTMLElement;
  private menuEl: HTMLElement | null = null;
  private menuRow: HTMLElement | null = null;
  /** Anchor row kept past `close()`, which clears `menuRow`, so Escape can restore focus. */
  private menuRowRestore: HTMLElement | null = null;
  private onDocPointerDown?: (ev: MouseEvent) => void;
  private onDocKeyDown?: (ev: KeyboardEvent) => void;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  /** Open → the previous menu is closed first, so two can never be mounted. */
  isOpen(): boolean {
    return this.menuEl !== null;
  }

  open(entries: ContextMenuEntry[], ev: MouseEvent, row: HTMLElement): void {
    this.close();

    const menu = document.createElement("div");
    menu.className = "vault-context-menu";
    menu.setAttribute("role", "menu");
    for (const entry of entries) {
      if (entry === "sep") {
        menu.appendChild(document.createElement("hr"));
        continue;
      }
      menu.appendChild(this.button(entry));
    }
    this.host.appendChild(menu);
    this.place(menu, ev);

    this.menuEl = menu;
    this.menuRow = row;
    this.menuRowRestore = row;
    row.classList.add("is-context-open");

    // The opening event is a `contextmenu`, so attaching mousedown/keydown now
    // won't self-close.
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

  private button(item: ContextMenuItem): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "menuitem");
    const iconSpan = document.createElement("span");
    iconSpan.innerHTML = item.icon; // static icon constant, never row-derived
    iconSpan.setAttribute("aria-hidden", "true");
    const labelSpan = document.createElement("span");
    labelSpan.textContent = item.label;
    btn.append(iconSpan, labelSpan);
    btn.addEventListener("click", () => {
      // Closed FIRST: an item that opens a dialog must not have this button as
      // the dialog's opener, because it is removed before focus returns to it.
      this.close();
      item.act();
    });
    return btn;
  }

  /** Anchored at the cursor, relative to the host (which is `position: relative`), clamped in. */
  private place(menu: HTMLElement, ev: MouseEvent): void {
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
  }
}
