// src/extension.worktreeActions.test.ts — the wiring behind the host's action
// seam, and one decision in particular: WHICH surface a focus reveals.
//
// The host owns resolution (WorktreeHost.actions.test.ts). What is under test
// here is what happens after: a pane must be revealed in the view that HOLDS
// it, because with the panel open in two places, revealing the one that asked
// focuses a pane the user cannot see.
//
// See: asimov/changes/wire-worktree-navigation-actions/design.md D2, D4.

import { describe, expect, it } from "vitest";
import { createWorktreeActions, type WorktreeActionDeps } from "./extension";
import type { ExtensionToWebViewMessage } from "./types/messages";

const SIDEBAR = "anywhereTerminal.sidebar";
const PANEL = "anywhereTerminal.panel";
const EDITOR = "editor-abc";

function harness(over: Partial<WorktreeActionDeps> = {}) {
  const commands: Array<[string, ...unknown[]]> = [];
  const clipboard: string[] = [];
  const folders: Array<[number, unknown]> = [];
  const editorPosts: ExtensionToWebViewMessage[] = [];
  const viewPosts: Array<[string, ExtensionToWebViewMessage]> = [];
  const revealed: string[] = [];

  const deps: WorktreeActionDeps = {
    executeCommand: async (command, ...args) => {
      commands.push([command, ...args]);
      return undefined;
    },
    writeClipboard: async (text) => {
      clipboard.push(text);
    },
    pickFolder: async () => undefined,
    // Identity, so an assertion reads the path rather than a Uri stand-in.
    fileUri: (path) => path,
    workspaceFolderCount: () => 2,
    addWorkspaceFolder: (at, uri) => folders.push([at, uri]),
    editorForView: (viewId) =>
      viewId === EDITOR
        ? {
            reveal: () => revealed.push(viewId),
            post: (msg) => editorPosts.push(msg),
          }
        : undefined,
    postToView: (viewId, msg) => viewPosts.push([viewId, msg]),
    resumeCommand: async () => "claude --resume s1",
    sessionCwd: async () => "/repo-wt/feat",
    ...over,
  };

  return { actions: createWorktreeActions(deps), commands, clipboard, folders, editorPosts, viewPosts, revealed };
}

describe("a focused pane is revealed where it actually lives", () => {
  it("reveals the editor panel holding the pane, then activates it there", async () => {
    const h = harness();
    await h.actions.focusPane("pane-1", EDITOR);

    expect(h.revealed).toEqual([EDITOR]);
    expect(h.editorPosts).toEqual([{ type: "worktreeActivatePane", paneId: "pane-1" }]);
    // No view focus command: an editor panel is not revealed by one.
    expect(h.commands).toEqual([]);
    expect(h.viewPosts).toEqual([]);
  });

  it("focuses the bottom panel for a pane that lives there", async () => {
    const h = harness();
    await h.actions.focusPane("pane-1", PANEL);

    expect(h.commands).toEqual([["anywhereTerminal.panel.focus"]]);
    expect(h.viewPosts).toEqual([[PANEL, { type: "worktreeActivatePane", paneId: "pane-1" }]]);
  });

  it("focuses the sidebar for a pane that lives there", async () => {
    const h = harness();
    await h.actions.focusPane("pane-1", SIDEBAR);

    expect(h.commands).toEqual([["anywhereTerminal.sidebar.focus"]]);
    expect(h.viewPosts).toEqual([[SIDEBAR, { type: "worktreeActivatePane", paneId: "pane-1" }]]);
  });

  it("does nothing for an editor view whose panel is gone", async () => {
    // Falling back to the sidebar would reveal a surface that does not hold the
    // pane — the exact substitution D4 exists to prevent.
    const h = harness();
    await h.actions.focusPane("pane-1", "editor-closed");

    expect(h.revealed).toEqual([]);
    expect(h.commands).toEqual([]);
    expect(h.viewPosts).toEqual([]);
  });
});

describe("the worktree capabilities", () => {
  it("opens a folder in a new window", async () => {
    const h = harness();
    await h.actions.openFolder("/repo-wt/feat", "newWindow");

    expect(h.commands).toEqual([["vscode.openFolder", "/repo-wt/feat", { forceNewWindow: true }]]);
    expect(h.folders).toEqual([]);
  });

  it("appends a workspace folder rather than replacing what the user had open", async () => {
    const h = harness();
    await h.actions.openFolder("/repo-wt/feat", "addToWorkspace");

    expect(h.folders).toEqual([[2, "/repo-wt/feat"]]);
    expect(h.commands).toEqual([]);
  });

  it("reveals a path in the OS file manager", async () => {
    const h = harness();
    await h.actions.revealInOS("/repo-wt/feat");
    expect(h.commands).toEqual([["revealFileInOS", "/repo-wt/feat"]]);
  });

  it("copies whatever text it is handed", async () => {
    const h = harness();
    await h.actions.copyText("/repo-wt/feat");
    expect(h.clipboard).toEqual(["/repo-wt/feat"]);
  });
});

describe("the session capabilities", () => {
  it("copies the command the launcher itself would run", async () => {
    const h = harness();
    await h.actions.copyResumeCommand("claude:s1");
    expect(h.clipboard).toEqual(["claude --resume s1"]);
  });

  it("reveals and copies the working directory the vault recorded", async () => {
    const h = harness();
    await h.actions.revealSessionCwd("claude:s1");
    await h.actions.copySessionCwd("claude:s1");

    expect(h.commands).toEqual([["revealFileInOS", "/repo-wt/feat"]]);
    expect(h.clipboard).toEqual(["/repo-wt/feat"]);
  });

  it("does nothing for a session with no recorded working directory", async () => {
    // Never the workspace root in its place: a reveal of the wrong directory is
    // worse than no reveal at all.
    const h = harness({ sessionCwd: async () => undefined });
    await h.actions.revealSessionCwd("claude:s1");
    await h.actions.copySessionCwd("claude:s1");

    expect(h.commands).toEqual([]);
    expect(h.clipboard).toEqual([]);
  });

  it("copies nothing when the resume command cannot be built", async () => {
    const h = harness({
      resumeCommand: async () => {
        throw new Error("unknown-agent");
      },
    });
    await expect(h.actions.copyResumeCommand("claude:s1")).rejects.toThrow("unknown-agent");
    expect(h.clipboard).toEqual([]);
  });
});
