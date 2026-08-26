// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { WebViewToExtensionMessage, WorktreeTreeResponseMessage } from "../../types/messages";
import { WorktreeController } from "./WorktreeController";
import { singleRepoPresence, singleRepoTree } from "./worktreeFixtures";

interface Harness {
  controller: WorktreeController;
  posts: WebViewToExtensionMessage[];
  state: Record<string, unknown>;
}

function mount(over: { workspaceRoot?: string | null } = {}): Harness {
  const posts: WebViewToExtensionMessage[] = [];
  const state: Record<string, unknown> = {};
  const controller = WorktreeController.mount({
    host: document.body,
    postMessage: (msg) => posts.push(msg),
    store: {
      getState: () => state as never,
      updateState: (patch) => Object.assign(state, patch),
    },
    init: { workspaceRoot: over.workspaceRoot === undefined ? "/repo" : over.workspaceRoot },
    now: () => 1_000_000,
  });
  document.body.appendChild(controller.element);
  return { controller, posts, state };
}

/** A response carrying the fixture tree — the shape the host really sends. */
function response(): WorktreeTreeResponseMessage {
  return { type: "worktreeTreeResponse", tree: singleRepoTree(), presence: singleRepoPresence(1_000_000) };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("visibility", () => {
  it("declares the view visible and asks for the tree on the way in", () => {
    const { controller, posts } = mount();
    controller.setVisible(true);
    expect(posts).toEqual([{ type: "worktreeViewVisibility", visible: true }, { type: "requestWorktreeTree" }]);
  });

  it("says nothing when the value has not moved", () => {
    const { controller, posts } = mount();
    controller.setVisible(true);
    posts.length = 0;
    controller.setVisible(true);
    expect(posts).toEqual([]);
  });

  it("declares the view hidden without asking for anything", () => {
    const { controller, posts } = mount();
    controller.setVisible(true);
    posts.length = 0;
    controller.setVisible(false);
    expect(posts).toEqual([{ type: "worktreeViewVisibility", visible: false }]);
  });
});

describe("the tree", () => {
  it("renders the pushed tree rather than sample data", () => {
    const { controller } = mount();
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    const branches = Array.from(document.querySelectorAll(".wt-row")).map((r) => r.textContent);
    expect(branches.length).toBe(singleRepoTree().repos[0]?.worktrees.length);
  });

  it("renders placeholder rows until the first push arrives", () => {
    const { controller } = mount();
    controller.setVisible(true);
    expect(document.querySelector(".wt-skel")).not.toBeNull();
    controller.handleTreeResponse(response());
    expect(document.querySelector(".wt-skel")).toBeNull();
  });

  it("renders an unsolicited push the same as an answered one", () => {
    const { controller } = mount();
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    const first = document.querySelectorAll(".wt-row").length;
    controller.handleTreeResponse(response());
    expect(document.querySelectorAll(".wt-row").length).toBe(first);
  });

  it("says the workspace has no folder instead of loading forever", () => {
    const { controller } = mount({ workspaceRoot: null });
    controller.setVisible(true);
    expect(document.querySelector(".wt-skel")).toBeNull();
    expect(document.body.textContent).toContain("No folder open");
  });
});

describe("refresh", () => {
  it("forces a rebuild and marks the tree as refreshing until it answers", () => {
    const { controller, posts } = mount();
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    posts.length = 0;

    controller.requestRefresh();
    expect(posts).toEqual([{ type: "requestWorktreeTree", force: true }]);
    expect(document.querySelector(".wt-refreshing")).not.toBeNull();
    expect(document.querySelectorAll(".wt-row").length).toBeGreaterThan(0);

    controller.handleTreeResponse(response());
    expect(document.querySelector(".wt-refreshing")).toBeNull();
  });

  it("drops the refreshing mark when the view stops being shown", () => {
    // The host skips pushes to a surface that stopped showing the view, so the
    // answer to this force is never coming back.
    const { controller } = mount();
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    controller.requestRefresh();
    controller.setVisible(false);
    expect(document.querySelector(".wt-refreshing")).toBeNull();
  });

  it("asks for nothing while the view is not shown", () => {
    const { controller, posts } = mount();
    controller.requestRefresh();
    expect(posts).toEqual([]);
  });
});

describe("actions it cannot perform", () => {
  it("offers no context menu over a real worktree", () => {
    const { controller } = mount();
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    const row = document.querySelector<HTMLElement>(".wt-row");
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    row?.dispatchEvent(ev);
    expect(document.querySelector(".vault-context-menu")).toBeNull();
    // Nothing swallowed the event either — a listener that only preventDefaults
    // leaves the user with no menu at all, ours or the host's.
    expect(ev.defaultPrevented).toBe(false);
  });

  it("opens no create form, because nothing would run it", () => {
    const { controller } = mount();
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    expect(document.querySelector(".wt-dialog")).toBeNull();
  });
});

describe("persisted disclosure state", () => {
  it("writes a collapse the user made back to the store", () => {
    const { controller, state } = mount();
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    const toggled = document.querySelector<HTMLElement>(".wt-row");
    toggled?.click();
    expect(Array.isArray(state.worktreeCollapsed)).toBe(true);
  });

  it("restores a persisted collapse set on mount", () => {
    const tree = singleRepoTree();
    const first = tree.repos[0]?.worktrees[0];
    expect(first).toBeDefined();
    const posts: WebViewToExtensionMessage[] = [];
    const state: Record<string, unknown> = { worktreeCollapsed: [first?.id] };
    const controller = WorktreeController.mount({
      host: document.body,
      postMessage: (msg) => posts.push(msg),
      store: { getState: () => state as never, updateState: (patch) => Object.assign(state, patch) },
      init: { workspaceRoot: "/repo" },
      now: () => 1_000_000,
    });
    document.body.appendChild(controller.element);
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    const row = document.querySelector<HTMLElement>(`.wt-row[data-worktree-id="${first?.id}"]`);
    expect(row?.getAttribute("aria-expanded")).toBe("false");
  });
});
