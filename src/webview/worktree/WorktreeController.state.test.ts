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
    init: { workspaceRoot: "/repo", rowActivation: "focus", workbench: false },
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
    // Narrowed to worktree keys, which is what the claim above is about. The
    // idle-tail fold also lives in this array under a namespaced key, and IS
    // seeded on first presentation — that is the point of the namespace.
    expect(state.worktreeCollapsed?.filter((k) => !k.startsWith("\u0000"))).toEqual([]);
    expect(state.worktreeCollapsed?.some((k) => k.startsWith("\u0000idle-tail:"))).toBe(true);
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

describe("a surface that holds a scope keeps receiving presence", () => {
  function mountWith(scoped: () => boolean) {
    const posts: WebViewToExtensionMessage[] = [];
    const state = {} as WebviewState;
    const controller = WorktreeController.mount({
      host: document.body,
      postMessage: (msg) => posts.push(msg),
      store: { getState: () => state, updateState: (patch) => Object.assign(state, patch) },
      init: { workspaceRoot: "/repo", rowActivation: "focus", workbench: true },
      now: () => 1_000_000,
      presenceNeeded: scoped,
    });
    document.body.replaceChildren(controller.element);
    return { controller, posts };
  }

  const visibility = (posts: WebViewToExtensionMessage[]): boolean[] =>
    posts.filter((m) => m.type === "worktreeViewVisibility").map((m) => (m as { visible: boolean }).visible);

  it("[1_2] does not go quiet when the rail collapses under a scope", () => {
    // `worktreeViewVisibility` never meant "pixels are on screen" — it means this
    // surface still draws something from presence. A scope's escape control is
    // exactly that, and it survives a collapsed rail. Going quiet here freezes
    // the presence half of the hidden-waiting count.
    let scoped = false;
    const { controller, posts } = mountWith(() => scoped);
    controller.setVisible(true);
    expect(visibility(posts)).toEqual([true]);

    scoped = true;
    controller.setVisible(false); // the rail collapsed after a selection
    expect(visibility(posts)).toEqual([true]);
  });

  it("[1_2] stops asking once the scope it was drawing for is cleared", () => {
    let scoped = true;
    const { controller, posts } = mountWith(() => scoped);
    controller.setVisible(true);
    controller.setVisible(false);
    expect(visibility(posts)).toEqual([true]);

    scoped = false;
    controller.revalidateVisibility();
    expect(visibility(posts)).toEqual([true, false]);
  });

  it("[1_2] starts asking when a scope is set while the rail is already collapsed", () => {
    let scoped = false;
    const { controller, posts } = mountWith(() => scoped);
    controller.setVisible(false);
    expect(visibility(posts)).toEqual([]);

    scoped = true;
    controller.revalidateVisibility();
    expect(visibility(posts)).toEqual([true]);
    expect(posts.some((m) => m.type === "requestWorktreeTree")).toBe(true);
  });

  it("[1_2] leaves a surface with no scope source exactly as it was", () => {
    const posts: WebViewToExtensionMessage[] = [];
    const state = {} as WebviewState;
    const controller = WorktreeController.mount({
      host: document.body,
      postMessage: (msg) => posts.push(msg),
      store: { getState: () => state, updateState: (patch) => Object.assign(state, patch) },
      init: { workspaceRoot: "/repo", rowActivation: "focus", workbench: false },
      now: () => 1_000_000,
    });
    document.body.replaceChildren(controller.element);
    controller.setVisible(true);
    controller.setVisible(false);
    expect(visibility(posts)).toEqual([true, false]);
  });
});
