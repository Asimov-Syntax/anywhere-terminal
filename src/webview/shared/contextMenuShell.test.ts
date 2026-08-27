// @vitest-environment jsdom

// The four behaviours the extraction settles (design.md D6). Each existed in the
// worktree menu and was missing from the vault one; they are asserted here on the
// shell directly, so neither caller can regain its own copy of the answer.

import { afterEach, describe, expect, it } from "vitest";
import { type ContextMenuEntry, ContextMenuShell } from "./contextMenuShell";

afterEach(() => {
  document.body.replaceChildren();
});

function setup(entries?: ContextMenuEntry[]): {
  shell: ContextMenuShell;
  host: HTMLElement;
  anchor: HTMLElement;
  acted: string[];
  open: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const anchor = document.createElement("div");
  anchor.tabIndex = 0;
  host.appendChild(anchor);
  const acted: string[] = [];
  const shell = new ContextMenuShell(host);
  const items: ContextMenuEntry[] = entries ?? [
    { label: "First", icon: "<svg/>", act: () => acted.push("First") },
    "sep",
    { label: "Second", icon: "<svg/>", act: () => acted.push("Second") },
    { label: "Third", icon: "<svg/>", act: () => acted.push("Third") },
  ];
  return {
    shell,
    host,
    anchor,
    acted,
    open: () => shell.open(items, new MouseEvent("contextmenu", { clientX: 10, clientY: 10 }), anchor),
  };
}

function buttons(host: HTMLElement): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll<HTMLButtonElement>(".vault-context-menu button"));
}

function press(key: string): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

describe("context menu shell", () => {
  it("focuses the first item on open, so the keyboard has somewhere to start", () => {
    const { host, open } = setup();
    open();
    expect(document.activeElement).toBe(buttons(host)[0]);
  });

  it("moves between items with the arrow keys, wrapping at both ends", () => {
    const { host, open } = setup();
    open();
    const [first, second, third] = buttons(host);
    press("ArrowDown");
    expect(document.activeElement).toBe(second);
    press("ArrowDown");
    expect(document.activeElement).toBe(third);
    press("ArrowDown");
    expect(document.activeElement).toBe(first);
    press("ArrowUp");
    expect(document.activeElement).toBe(third);
  });

  it("restores focus to the anchor row on Escape", () => {
    // Without this the keyboard user is left focused on a removed button, which
    // sends focus to the document body and loses their place in the list.
    const { host, anchor, open } = setup();
    open();
    press("Escape");
    expect(host.querySelector(".vault-context-menu")).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it("is gone before the item's action runs", () => {
    // An item that opens a dialog must not have this button as the dialog's
    // opener: the button is removed before focus could return to it.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const anchor = document.createElement("div");
    host.appendChild(anchor);
    const shell = new ContextMenuShell(host);
    let openWhileActing: boolean | undefined;
    shell.open(
      [{ label: "Rename", icon: "<svg/>", act: () => (openWhileActing = shell.isOpen()) }],
      new MouseEvent("contextmenu", { clientX: 1, clientY: 1 }),
      anchor,
    );
    buttons(host)[0]?.click();
    expect(openWhileActing).toBe(false);
    expect(host.querySelector(".vault-context-menu")).toBeNull();
  });

  it("dismisses on a pointer-down outside itself, and not on one inside", () => {
    const { host, open } = setup();
    open();
    buttons(host)[0]?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(host.querySelector(".vault-context-menu")).not.toBeNull();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(host.querySelector(".vault-context-menu")).toBeNull();
  });

  it("marks the anchor row while open and unmarks it on close", () => {
    const { shell, anchor, open } = setup();
    open();
    expect(anchor.classList.contains("is-context-open")).toBe(true);
    shell.close();
    expect(anchor.classList.contains("is-context-open")).toBe(false);
  });

  it("leaves no document listeners behind after close", () => {
    // A leaked keydown listener keeps answering Escape for a menu that is gone,
    // yanking focus back to a row the user has since navigated away from.
    const { shell, host, anchor, open } = setup();
    open();
    shell.close();
    const elsewhere = document.createElement("input");
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    press("Escape");
    expect(document.activeElement).toBe(elsewhere);
    expect(document.activeElement).not.toBe(anchor);
    open();
    expect(host.querySelectorAll(".vault-context-menu")).toHaveLength(1);
    expect(document.activeElement).toBe(buttons(host)[0]);
  });

  it("never mounts two menus, whichever row is right-clicked next", () => {
    const { host, open } = setup();
    open();
    open();
    expect(host.querySelectorAll(".vault-context-menu")).toHaveLength(1);
  });

  it("renders separators as rules and never as items", () => {
    const { host, open } = setup();
    open();
    expect(host.querySelectorAll(".vault-context-menu hr")).toHaveLength(1);
    expect(buttons(host).map((b) => b.textContent)).toEqual(["First", "Second", "Third"]);
  });
});
