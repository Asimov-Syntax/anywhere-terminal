// @vitest-environment jsdom

// The vault menu's own rules, now that the lifecycle moved to the shared shell
// (design.md D6). What is asserted is mostly what is ABSENT: an item the entry
// cannot perform is not offered, because a disabled item claims the action
// exists here and merely isn't available.

import { afterEach, describe, expect, it } from "vitest";
import type { WebViewToExtensionMessage } from "../../types/messages";
import type { VaultSessionEntry } from "../../vault/types";
import { VaultContextMenu } from "./VaultContextMenu";

afterEach(() => {
  document.body.replaceChildren();
});

function entry(over: Partial<VaultSessionEntry> = {}): VaultSessionEntry {
  return {
    id: "claude:s1",
    agent: "claude",
    sessionId: "s1",
    title: "Wire the panel",
    cwd: "/repo",
    modified: 1_700_000_000_000,
    flags: {},
    canFork: true,
    sessionPath: "/vault/s1.jsonl",
    ...over,
  } as VaultSessionEntry;
}

function setup(actionsAvailable?: boolean): {
  menu: VaultContextMenu;
  host: HTMLElement;
  row: HTMLElement;
  posts: WebViewToExtensionMessage[];
  renames: string[];
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const row = document.createElement("div");
  row.tabIndex = 0;
  host.appendChild(row);
  const posts: WebViewToExtensionMessage[] = [];
  const renames: string[] = [];
  const menu = new VaultContextMenu({
    host,
    postMessage: (msg) => posts.push(msg),
    ...(actionsAvailable === undefined ? {} : { actionsAvailable }),
    beginRename: (e) => renames.push(e.id),
  });
  return { menu, host, row, posts, renames };
}

const EVENT = new MouseEvent("contextmenu", { clientX: 10, clientY: 10 });

function labels(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll(".vault-context-menu button")).map((b) => b.textContent ?? "");
}

function clickItem(host: HTMLElement, label: string): void {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>(".vault-context-menu button")).find(
    (b) => b.textContent === label,
  );
  if (!button) {
    throw new Error(`no menu item labelled ${label}`);
  }
  button.click();
}

describe("vault context menu items", () => {
  it("offers the full set for a resumable, file-backed entry", () => {
    const { menu, host, row } = setup();
    menu.open(entry(), EVENT, row);
    expect(labels(host)).toEqual([
      "Resume in New Tab",
      "Rename",
      "Open",
      "Reveal in Finder",
      "Copy File Path",
      "Copy Resume Command",
      "Open Working Directory",
    ]);
  });

  it("omits the file-targeting items when nothing on disk backs the session", () => {
    const { menu, host, row } = setup();
    menu.open(entry({ sessionPath: undefined }), EVENT, row);
    expect(labels(host)).not.toContain("Open");
    expect(labels(host)).not.toContain("Reveal in Finder");
    expect(labels(host)).not.toContain("Copy File Path");
    // And the separators they sat between collapse rather than doubling up.
    expect(host.querySelectorAll(".vault-context-menu hr")).toHaveLength(1);
  });

  it("omits both resume items for an entry the reader could not prove resumable", () => {
    const { menu, host, row } = setup();
    menu.open(entry({ canResume: false }), EVENT, row);
    expect(labels(host)).not.toContain("Resume in New Tab");
    expect(labels(host)).not.toContain("Copy Resume Command");
  });

  it("offers resume for a Cursor CLI session and not for an IDE one", () => {
    const { menu, host, row } = setup();
    menu.open(entry({ agent: "cursor", source: "cli", canResume: true }), EVENT, row);
    expect(labels(host)).toContain("Resume in New Tab");
    menu.open(entry({ agent: "cursor", source: "ide", canResume: true }), EVENT, row);
    expect(labels(host)).not.toContain("Resume in New Tab");
  });

  it("posts entryId-only messages — the webview never sends a path", () => {
    const { menu, host, row, posts } = setup();
    for (const label of ["Open", "Reveal in Finder", "Copy File Path", "Open Working Directory"]) {
      menu.open(entry(), EVENT, row);
      clickItem(host, label);
    }
    expect(posts.map((p) => p.type)).toEqual([
      "vaultOpenSessionFile",
      "vaultRevealInOS",
      "vaultCopyFilePath",
      "vaultOpenWorkingDir",
    ]);
    for (const post of posts) {
      expect(JSON.stringify(post)).not.toContain("/vault/s1.jsonl");
    }
  });

  it("hands Rename back to its owner rather than posting", () => {
    const { menu, host, row, posts, renames } = setup();
    menu.open(entry(), EVENT, row);
    clickItem(host, "Rename");
    expect(renames).toEqual(["claude:s1"]);
    expect(posts).toEqual([]);
  });
});

describe("what the vault menu gained from the shared shell", () => {
  it("focuses the first item, navigates with arrows, and restores focus on Escape", () => {
    const { menu, host, row } = setup();
    menu.open(entry(), EVENT, row);
    const items = Array.from(host.querySelectorAll<HTMLButtonElement>(".vault-context-menu button"));
    expect(document.activeElement).toBe(items[0]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(items[1]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menu.isOpen()).toBe(false);
    expect(document.activeElement).toBe(row);
  });

  it("is closed before Rename opens its editor", () => {
    // The rename editor must not be anchored to a button that is already gone by
    // the time focus would return to it.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const row = document.createElement("div");
    host.appendChild(row);
    let openWhileRenaming: boolean | undefined;
    const menu: VaultContextMenu = new VaultContextMenu({
      host,
      postMessage: () => {},
      beginRename: () => {
        openWhileRenaming = menu.isOpen();
      },
    });
    menu.open(entry(), EVENT, row);
    clickItem(host, "Rename");
    expect(openWhileRenaming).toBe(false);
  });
});

describe("a surface that cannot perform vault actions", () => {
  it("offers no menu at all, because every item here posts an action", () => {
    // An editor surface answers the preview's two reads and none of the thirteen
    // action messages. Before this, right-clicking a row there produced a full
    // menu whose every item silently did nothing (round-2 B4).
    const { menu, host, row } = setup(false);
    menu.open(entry(), EVENT, row);
    expect(host.querySelector(".vault-context-menu")).toBeNull();
    expect(menu.isOpen()).toBe(false);
  });

  it("posts nothing, since there is nothing to click", () => {
    const { menu, host, row, posts } = setup(false);
    menu.open(entry(), EVENT, row);
    expect(labels(host)).toEqual([]);
    expect(posts).toEqual([]);
  });

  it("leaves an action-capable surface exactly as it was", () => {
    // The flag defaults to true, so the sidebar and panel are unchanged by it.
    const explicit = setup(true);
    explicit.menu.open(entry(), EVENT, explicit.row);
    const withFlag = labels(explicit.host);
    explicit.menu.close();

    const dflt = setup();
    dflt.menu.open(entry(), EVENT, dflt.row);
    expect(labels(dflt.host)).toEqual(withFlag);
    expect(withFlag.length).toBeGreaterThan(0);
  });
});
