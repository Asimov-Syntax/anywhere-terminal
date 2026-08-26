// @vitest-environment jsdom

// The two menus in docs/ui/worktree.html § 6. What is asserted here is mostly what
// is ABSENT: an action the row cannot actually perform is not offered at all,
// because a disabled item claims the action exists here and merely isn't available.

import { afterEach, describe, expect, it } from "vitest";
import type { WebViewToExtensionMessage } from "../../types/messages";
import { WorktreeContextMenu, type WorktreeMenuActions } from "./WorktreeContextMenu";
import { worktreeMenuActions } from "./WorktreeController";
import { agentRow, worktree } from "./worktreeFixtures";

afterEach(() => {
  document.body.replaceChildren();
});

function setup(): { menu: WorktreeContextMenu; host: HTMLElement; calls: string[] } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const calls: string[] = [];
  const record = (name: string) => (): void => {
    calls.push(name);
  };
  const actions: WorktreeMenuActions = {
    openFolderInNewWindow: record("openFolderInNewWindow"),
    addFolderToWorkspace: record("addFolderToWorkspace"),
    openTerminalHere: record("openTerminalHere"),
    revealWorktree: record("revealWorktree"),
    copyWorktreePath: record("copyWorktreePath"),
    toggleLock: record("toggleLock"),
    removeWorktree: record("removeWorktree"),
    focusPane: record("focusPane"),
    openPreview: record("openPreview"),
    resumeHere: record("resumeHere"),
    copyResumeCommand: record("copyResumeCommand"),
    revealAgentCwd: record("revealAgentCwd"),
    copyAgentPath: record("copyAgentPath"),
  };
  return { menu: new WorktreeContextMenu({ host, actions }), host, calls };
}

function labels(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll(".vault-context-menu button")).map((b) => b.textContent ?? "");
}

const EVENT = new MouseEvent("contextmenu", { clientX: 10, clientY: 10 });

/** Records whether the menu was still mounted at the moment an action ran. */
function setupObservingAction(): {
  menu: WorktreeContextMenu;
  host: HTMLElement;
  seen: { action: string; menuStillOpen: boolean }[];
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const seen: { action: string; menuStillOpen: boolean }[] = [];
  let menu: WorktreeContextMenu | undefined;
  const record = (action: string) => (): void => {
    seen.push({ action, menuStillOpen: menu?.isOpen() ?? false });
  };
  const actions: WorktreeMenuActions = {
    openFolderInNewWindow: record("openFolderInNewWindow"),
    addFolderToWorkspace: record("addFolderToWorkspace"),
    openTerminalHere: record("openTerminalHere"),
    revealWorktree: record("revealWorktree"),
    copyWorktreePath: record("copyWorktreePath"),
    toggleLock: record("toggleLock"),
    removeWorktree: record("removeWorktree"),
    focusPane: record("focusPane"),
    openPreview: record("openPreview"),
    resumeHere: record("resumeHere"),
    copyResumeCommand: record("copyResumeCommand"),
    revealAgentCwd: record("revealAgentCwd"),
    copyAgentPath: record("copyAgentPath"),
  };
  menu = new WorktreeContextMenu({ host, actions });
  return { menu, host, seen };
}

describe("worktree row menu", () => {
  it("carries the items from the reference, in order", () => {
    const { menu, host } = setup();
    menu.openForWorktree(worktree({ id: "/wt", branch: "feat/x" }), EVENT, document.createElement("div"));
    expect(labels(host)).toEqual([
      "Open Folder in New Window",
      "Add Folder to Workspace",
      "Open Terminal Here",
      "Reveal in Finder",
      "Copy Path",
      "Lock Worktree",
      "Remove Worktree…",
    ]);
  });

  it("offers no Remove on the main worktree", () => {
    const { menu, host } = setup();
    menu.openForWorktree(worktree({ id: "/wt", kind: "main", branch: "main" }), EVENT, document.createElement("div"));
    expect(labels(host)).not.toContain("Remove Worktree…");
  });

  it("flips Lock to Unlock on a locked worktree", () => {
    const { menu, host } = setup();
    menu.openForWorktree(worktree({ id: "/wt", branch: "x", locked: true }), EVENT, document.createElement("div"));
    expect(labels(host)).toContain("Unlock Worktree");
  });

  it("drops the on-disk actions for a missing worktree but keeps Copy Path", () => {
    const { menu, host } = setup();
    menu.openForWorktree(worktree({ id: "/wt", branch: "x", missing: true }), EVENT, document.createElement("div"));
    const items = labels(host);
    expect(items).not.toContain("Open Terminal Here");
    expect(items).not.toContain("Reveal in Finder");
    // Copy Path is how the user goes and looks at what happened to the directory.
    expect(items).toContain("Copy Path");
    expect(items).toContain("Remove Worktree…");
  });

  it("raises the action and closes", () => {
    const { menu, host, calls } = setup();
    menu.openForWorktree(worktree({ id: "/wt", branch: "x" }), EVENT, document.createElement("div"));
    host.querySelectorAll<HTMLButtonElement>(".vault-context-menu button")[2]?.click();
    expect(calls).toEqual(["openTerminalHere"]);
    expect(menu.isOpen()).toBe(false);
  });
});

describe("agent row menu", () => {
  it("offers Focus Pane on a window-scope row", () => {
    const { menu, host } = setup();
    menu.openForAgent(
      agentRow({ rowId: "a", agent: "claude", paneId: "p1", entryId: "claude:1" }),
      EVENT,
      document.createElement("div"),
    );
    expect(labels(host)).toEqual([
      "Focus Pane",
      "Open Session Preview",
      "Resume Session Here",
      "Copy Resume Command",
      "Reveal in Finder",
      "Copy Path",
    ]);
  });

  it("omits Focus Pane on an external row — there is no pane here to reveal", () => {
    const { menu, host } = setup();
    menu.openForAgent(
      agentRow({ rowId: "a", agent: "cursor", scope: "external", agentSource: "registry", entryId: "cursor:1" }),
      EVENT,
      document.createElement("div"),
    );
    expect(labels(host)).not.toContain("Focus Pane");
    expect(labels(host)[0]).toBe("Open Session Preview");
  });

  it("omits the resume items when there is no session to resume from", () => {
    const { menu, host } = setup();
    menu.openForAgent(
      agentRow({ rowId: "a", agentSource: "none", paneId: "p1" }),
      EVENT,
      document.createElement("div"),
    );
    expect(labels(host)).not.toContain("Resume Session Here");
    expect(labels(host)).not.toContain("Copy Resume Command");
  });

  it("lands focus on the first item and moves with the arrows", () => {
    const { menu, host } = setup();
    menu.openForAgent(
      agentRow({ rowId: "a", paneId: "p1", entryId: "claude:1" }),
      EVENT,
      document.createElement("div"),
    );
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>(".vault-context-menu button"));
    expect(document.activeElement).toBe(buttons[0]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(document.activeElement).toBe(buttons[1]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(document.activeElement).toBe(buttons[0]);
    // Wraps rather than dead-ending at the edge.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  it("returns focus to the anchor row on Escape", () => {
    const { menu } = setup();
    const anchor = document.createElement("div");
    anchor.tabIndex = -1;
    document.body.appendChild(anchor);
    menu.openForAgent(agentRow({ rowId: "a" }), EVENT, anchor);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.activeElement).toBe(anchor);
  });

  it("closes before the action runs, so a dialog it opens keeps a live opener", () => {
    // The menu button is removed on close. If the action ran first, a dialog
    // opened by it would capture that button as its opener — an element that no
    // longer exists by the time focus is restored.
    const { menu, host, seen } = setupObservingAction();
    menu.openForWorktree(worktree({ id: "/wt", branch: "x" }), EVENT, document.createElement("div"));
    host.querySelectorAll<HTMLButtonElement>(".vault-context-menu button")[2]?.click();
    expect(seen).toEqual([{ action: "openTerminalHere", menuStillOpen: false }]);
  });

  it("closes on Escape and on a pointer-down outside", () => {
    const { menu } = setup();
    menu.openForAgent(agentRow({ rowId: "a" }), EVENT, document.createElement("div"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(menu.isOpen()).toBe(false);

    menu.openForAgent(agentRow({ rowId: "a" }), EVENT, document.createElement("div"));
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(menu.isOpen()).toBe(false);
  });
});

// ── Each read-only item posts the request its label names (task 3_2) ──────

describe("the controller's callbacks post what each item claims", () => {
  /** The real menu over the real callbacks — the item wiring is what is under test. */
  function wired(): { menu: WorktreeContextMenu; host: HTMLElement; posts: WebViewToExtensionMessage[] } {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const posts: WebViewToExtensionMessage[] = [];
    const menu = new WorktreeContextMenu({ host, actions: worktreeMenuActions((m) => posts.push(m)) });
    return { menu, host, posts };
  }

  function anchor(): HTMLElement {
    return document.createElement("div");
  }

  function itemLabels(host: HTMLElement): string[] {
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

  const WT = worktree({ id: "/repo-wt/feat", kind: "linked", branch: "feat", head: "b".repeat(40) });
  const ROW = agentRow({
    rowId: "window:a",
    scope: "window",
    paneId: "pane-1",
    entryId: "claude:s1",
    agent: "claude",
    activity: "running",
  });

  const WORKTREE_ITEMS: Array<[string, WebViewToExtensionMessage]> = [
    ["Open Folder in New Window", { type: "worktreeOpenFolder", worktreeId: WT.id, mode: "newWindow" }],
    ["Add Folder to Workspace", { type: "worktreeOpenFolder", worktreeId: WT.id, mode: "addToWorkspace" }],
    ["Open Terminal Here", { type: "worktreeOpenTerminal", worktreeId: WT.id }],
    ["Reveal in Finder", { type: "worktreeRevealInOS", worktreeId: WT.id }],
    ["Copy Path", { type: "worktreeCopyPath", worktreeId: WT.id }],
  ];

  const AGENT_ITEMS: Array<[string, WebViewToExtensionMessage]> = [
    ["Focus Pane", { type: "worktreeFocusPane", rowId: ROW.rowId, paneId: "pane-1" }],
    ["Open Session Preview", { type: "worktreeOpenPreview", rowId: ROW.rowId, entryId: "claude:s1" }],
    ["Copy Resume Command", { type: "worktreeCopyResumeCommand", rowId: ROW.rowId, entryId: "claude:s1" }],
    ["Reveal in Finder", { type: "worktreeRevealAgentCwd", rowId: ROW.rowId, entryId: "claude:s1" }],
    ["Copy Path", { type: "worktreeCopyAgentPath", rowId: ROW.rowId, entryId: "claude:s1" }],
  ];

  for (const [label, expected] of WORKTREE_ITEMS) {
    it(`posts ${expected.type} for the worktree item "${label}"`, () => {
      const { menu, host, posts } = wired();
      menu.openForWorktree(WT, EVENT, document.createElement("div"));
      clickItem(host, label);
      expect(posts).toEqual([expected]);
    });
  }

  for (const [label, expected] of AGENT_ITEMS) {
    it(`posts ${expected.type} for the agent item "${label}"`, () => {
      const { menu, host, posts } = wired();
      menu.openForAgent(ROW, EVENT, document.createElement("div"));
      clickItem(host, label);
      expect(posts).toEqual([expected]);
    });
  }

  it("carries ids only — never a path the view resolved for itself", () => {
    // The host re-resolves every id against its own tree, so a path leaving here
    // would be a second, unchecked source of truth for what an action runs on.
    const { menu, host, posts } = wired();
    menu.openForWorktree(WT, EVENT, document.createElement("div"));
    clickItem(host, "Copy Path");
    menu.openForAgent(ROW, EVENT, document.createElement("div"));
    clickItem(host, "Copy Path");
    for (const post of posts) {
      expect(Object.keys(post).sort()).not.toContain("path");
      expect(JSON.stringify(post)).not.toContain("/repo-wt/feat/");
    }
  });

  it("offers a session-less row nothing but its pane", () => {
    // Preview, resume, and the two working-directory items all act ON a vault
    // entry (design.md D8, round-1 B3). Without one they are absent, not inert;
    // the pane is the only thing such a row actually has.
    const { menu, host } = wired();
    menu.openForAgent(agentRow({ rowId: "window:b", scope: "window", paneId: "pane-2" }), EVENT, anchor());
    expect(itemLabels(host)).toEqual(["Focus Pane"]);
  });

  it("offers an external row with no session nothing at all", () => {
    const { menu, host } = wired();
    menu.openForAgent(agentRow({ rowId: "external:b", scope: "external" }), EVENT, anchor());
    expect(itemLabels(host)).toEqual([]);
  });

  it("omits the mutating and launch items, whose capabilities nothing supplies yet", () => {
    // Absent, not present-and-inert: WT-005.2 and WT-005.3 light them by
    // supplying their own capabilities (design.md D10).
    const { menu, host } = wired();
    menu.openForWorktree(WT, EVENT, anchor());
    expect(itemLabels(host)).toEqual([
      "Open Folder in New Window",
      "Add Folder to Workspace",
      "Open Terminal Here",
      "Reveal in Finder",
      "Copy Path",
    ]);
    menu.openForAgent(ROW, EVENT, anchor());
    expect(itemLabels(host)).not.toContain("Resume Session Here");
  });

  it("never renders an item disabled — the absent ones simply are not built", () => {
    const { menu, host } = wired();
    menu.openForWorktree(WT, EVENT, anchor());
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>(".vault-context-menu button"));
    expect(buttons.some((b) => b.disabled || b.getAttribute("aria-disabled") === "true")).toBe(false);
  });
});

describe("the capabilities the controller does not supply", () => {
  it("supplies no mutating or launch capability at all", () => {
    // WT-005.2 and WT-005.3 light these by supplying their own; until then the
    // items must not be built (design.md D10).
    const actions = worktreeMenuActions(() => {});
    for (const key of ["toggleLock", "removeWorktree", "resumeHere", "createWorktree"] as const) {
      expect(actions[key], key).toBeUndefined();
    }
  });
});
