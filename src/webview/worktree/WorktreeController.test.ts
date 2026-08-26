// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { WebViewToExtensionMessage, WorktreeTreeResponseMessage } from "../../types/messages";
import { WorktreeController } from "./WorktreeController";
import { singleRepoPresence, singleRepoTree } from "./worktreeFixtures";
import type { WorktreeAgentRow, WorktreeRowActivation } from "./worktreeViewTypes";

interface Harness {
  controller: WorktreeController;
  posts: WebViewToExtensionMessage[];
  state: Record<string, unknown>;
}

function mount(
  over: {
    workspaceRoot?: string | null;
    rowActivation?: WorktreeRowActivation;
    showPreview?: (entryId: string) => boolean;
    activatePane?: (paneId: string) => boolean;
    /** Persisted before mount — the view reads it once, at construction. */
    expandedRows?: string[];
  } = {},
): Harness {
  const posts: WebViewToExtensionMessage[] = [];
  const state: Record<string, unknown> = over.expandedRows ? { worktreeExpandedRows: over.expandedRows } : {};
  const controller = WorktreeController.mount({
    host: document.body,
    postMessage: (msg) => posts.push(msg),
    store: {
      getState: () => state as never,
      updateState: (patch) => Object.assign(state, patch),
    },
    init: {
      workspaceRoot: over.workspaceRoot === undefined ? "/repo" : over.workspaceRoot,
      rowActivation: over.rowActivation ?? "focus",
    },
    showPreview: over.showPreview,
    activatePane: over.activatePane,
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
  it("opens the worktree context menu, now that its actions post something", () => {
    // This replaces the case that asserted NO menu: it encoded the state before
    // the controller had any action path, which task 3_2 is what ends.
    const { controller } = mount();
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    const row = document.querySelector<HTMLElement>(".wt-row");
    row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const items = Array.from(document.querySelectorAll(".vault-context-menu button")).map((b) => b.textContent);
    expect(items).toContain("Copy Path");
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
      init: { workspaceRoot: "/repo", rowActivation: "focus" },
      now: () => 1_000_000,
    });
    document.body.appendChild(controller.element);
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    const row = document.querySelector<HTMLElement>(`.wt-row[data-worktree-id="${first?.id}"]`);
    expect(row?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("row activation is posted as a request the host resolves", () => {
  /** The fixture's own rows, so paneId/entryId are the shapes the host really sends. */
  function activateFirstAgent(rowId: string): void {
    document.querySelector<HTMLButtonElement>(".wt-presence")?.click();
    document.querySelector<HTMLElement>(`.wt-arow[data-row-id="${rowId}"]`)?.click();
  }

  function firstWindowRow(): WorktreeAgentRow {
    const row = Object.values(singleRepoPresence(1_000_000).rowsByWorktreeId)
      .flat()
      .find((r) => r.scope === "window" && r.paneId !== undefined && r.entryId !== undefined);
    if (!row) {
      throw new Error("fixture lost its window row");
    }
    return row;
  }

  it("posts a focus request under the focus setting, and a preview request under preview", () => {
    const row = firstWindowRow();
    for (const [setting, expected] of [
      ["focus", { type: "worktreeFocusPane", rowId: row.rowId, paneId: row.paneId }],
      ["preview", { type: "worktreeOpenPreview", rowId: row.rowId, entryId: row.entryId }],
    ] as const) {
      document.body.replaceChildren();
      const { controller, posts } = mount({ rowActivation: setting });
      controller.setVisible(true);
      controller.handleTreeResponse(response());
      posts.length = 0;
      activateFirstAgent(row.rowId);
      expect(posts).toEqual([expected]);
    }
  });

  it("follows an update that arrives after init", () => {
    // The setting is live host-side, so a view already painted must obey the new
    // value without being reopened.
    const row = firstWindowRow();
    const { controller, posts } = mount({ rowActivation: "focus" });
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    controller.setRowActivation("preview");
    posts.length = 0;
    activateFirstAgent(row.rowId);
    expect(posts).toEqual([{ type: "worktreeOpenPreview", rowId: row.rowId, entryId: row.entryId }]);
  });
});

describe("the halves only a surface can perform", () => {
  it("hands a preview to the thing that owns the overlay, and a pane to the thing that owns panes", () => {
    const previews: string[] = [];
    const panes: string[] = [];
    const { controller } = mount({
      showPreview: (entryId) => {
        previews.push(entryId);
        return true;
      },
      activatePane: (paneId) => {
        panes.push(paneId);
        return true;
      },
    });
    controller.showPreview("claude:s1");
    controller.activatePane("pane-1");
    expect(previews).toEqual(["claude:s1"]);
    expect(panes).toEqual(["pane-1"]);
  });

  it("does nothing when this surface holds neither the entry nor the pane", () => {
    // The host sends to the surface that HOLDS the target; a surface that does
    // not must stay silent rather than post an error the user cannot act on.
    const { controller, posts } = mount({
      showPreview: () => false,
      activatePane: () => false,
    });
    controller.setVisible(true);
    posts.length = 0;
    controller.showPreview("claude:missing");
    controller.activatePane("pane-missing");
    expect(posts).toEqual([]);
    expect(document.querySelector(".vault-context-menu")).toBeNull();
  });

  it("survives a surface that supplied neither capability", () => {
    // A webview with no vault panel mounted still receives these messages.
    const { controller } = mount();
    expect(() => {
      controller.showPreview("claude:s1");
      controller.activatePane("pane-1");
    }).not.toThrow();
  });
});

describe("a subagent row's activation is its parent's", () => {
  it("focuses the PARENT's pane — a subagent has none of its own", () => {
    // Anywhere else is a dead click, and the row is presented as actionable
    // (design.md D9).
    const parent = Object.values(singleRepoPresence(1_000_000).rowsByWorktreeId)
      .flat()
      .find((r) => r.scope === "window" && r.paneId !== undefined && r.delegations?.kind === "ok");
    if (!parent) {
      throw new Error("fixture lost a window row carrying delegations");
    }
    const { controller, posts } = mount({ expandedRows: [parent.rowId] });
    controller.setVisible(true);
    controller.handleTreeResponse(response());
    document.querySelector<HTMLButtonElement>(".wt-presence")?.click();
    posts.length = 0;
    document.querySelector<HTMLElement>(".wt-srow")?.click();
    expect(posts).toEqual([{ type: "worktreeFocusPane", rowId: parent.rowId, paneId: parent.paneId }]);
  });
});
