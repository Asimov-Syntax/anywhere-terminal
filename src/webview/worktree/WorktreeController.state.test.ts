// @vitest-environment jsdom
//
// The state half of the Worktree view: which body the panel opens on, and what
// survives a reload. State written by an older build has no worktree keys at
// all, and an empty set is a user who expanded everything — not a user who never
// saved. See: docs/design/worktree-panel-ui.md § 2.1, § 2.2.

import { describe, expect, it } from "vitest";
import type { WebViewToExtensionMessage } from "../../types/messages";
import type { WebviewState } from "../state/WebviewState";
import { resolveInitialView, WorktreeController } from "./WorktreeController";
import { singleRepoPresence, singleRepoTree } from "./worktreeFixtures";

function mount(state: WebviewState) {
  const posts: WebViewToExtensionMessage[] = [];
  const controller = WorktreeController.mount({
    host: document.body,
    postMessage: (msg) => posts.push(msg),
    store: { getState: () => state, updateState: (patch) => Object.assign(state, patch) },
    init: { workspaceRoot: "/repo" },
    now: () => 1_000_000,
  });
  document.body.replaceChildren(controller.element);
  controller.setVisible(true);
  controller.handleTreeResponse({
    type: "worktreeTreeResponse",
    tree: singleRepoTree(),
    presence: singleRepoPresence(1_000_000),
  });
  return { controller, state, posts };
}

describe("the view the workspace earns", () => {
  it("opens on the worktree body when the workspace holds a repository", () => {
    expect(resolveInitialView(undefined, true)).toBe("worktree");
  });

  it("opens on sessions when it holds none, rather than on a permanently empty view", () => {
    expect(resolveInitialView(undefined, false)).toBe("sessions");
  });

  it("lets a recorded choice win over both", () => {
    expect(resolveInitialView("sessions", true)).toBe("sessions");
    expect(resolveInitialView("worktree", false)).toBe("worktree");
  });

  it("reads state written before the view key existed", () => {
    const older = { vaultGroupMode: "agent" } as WebviewState;
    expect(resolveInitialView(older.vaultView, true)).toBe("worktree");
    expect(older.vaultGroupMode).toBe("agent");
  });
});

describe("what a reload restores", () => {
  it("keeps everything expanded when the persisted set is empty", () => {
    // An empty set records expansion by omission; seeding first-run defaults over
    // it would silently re-collapse what the user opened.
    const { state } = mount({ worktreeCollapsed: [] });
    const rows = Array.from(document.querySelectorAll<HTMLElement>(".wt-row[aria-expanded]"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.getAttribute("aria-expanded") === "true")).toBe(true);
    expect(state.worktreeCollapsed).toEqual([]);
  });

  it("seeds its own defaults when nothing was ever saved", () => {
    const { state } = mount({});
    // Absent is not empty: the seed ran, so something was written back.
    expect(state.worktreeCollapsed?.length).toBeGreaterThan(0);
  });

  it("restores state written by a build that knew no worktree keys", () => {
    const older = { vaultGroupMode: "folder", vaultCollapsed: false } as WebviewState;
    const { state } = mount(older);
    expect(state.vaultGroupMode).toBe("folder");
    expect(document.querySelectorAll(".wt-row").length).toBeGreaterThan(0);
  });

  it("drops a worktree that disappeared instead of resurrecting it later", () => {
    const state: WebviewState = { worktreeCollapsed: ["/gone/worktree"] };
    mount(state);
    expect(state.worktreeCollapsed).not.toContain("/gone/worktree");
  });

  it("drops an expanded agent row whose worktree disappeared", () => {
    const state: WebviewState = { worktreeExpandedRows: ["row-that-vanished"] };
    mount(state);
    expect(state.worktreeExpandedRows).not.toContain("row-that-vanished");
  });
});
