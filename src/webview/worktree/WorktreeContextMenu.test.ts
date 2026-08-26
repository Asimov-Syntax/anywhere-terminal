// @vitest-environment jsdom

// The two menus in docs/ui/worktree.html § 6. What is asserted here is mostly what
// is ABSENT: an action the row cannot actually perform is not offered at all,
// because a disabled item claims the action exists here and merely isn't available.

import { afterEach, describe, expect, it } from "vitest";
import { WorktreeContextMenu, type WorktreeMenuActions } from "./WorktreeContextMenu";
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
