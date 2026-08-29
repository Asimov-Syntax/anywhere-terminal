// @vitest-environment jsdom
//
// src/webview/tabBarScopeWiring.test.ts — the panel, the coordinator and the bar,
// driven together.
//
// Every test here mounts the REAL controller, wires the REAL coordinator through
// the seam, and renders the REAL tab bar. That is the point: round-1's three
// blockers were each a cross-object defect that no single-object test could reach,
// because each needed the view, the controller and the coordinator in one place.

import { beforeEach, describe, expect, it } from "vitest";
import type { WorktreeTreeResponseMessage } from "../types/messages";
import { createLeaf, type SplitNode } from "./SplitModel";
import { buildTabBarData, renderTabBar } from "./TabBarUtils";
import { type TabBarScopeWiring, wireTabBarScope } from "./tabBarScopeWiring";
import { WorktreeController } from "./worktree/WorktreeController";
import { agentRow, singleRepoTree } from "./worktree/worktreeFixtures";
import type { WorktreeAgentRow, WorktreeInfo, WorktreePresence, WorktreeTree } from "./worktree/worktreeViewTypes";

const MAIN = "/Users/dev/Projects/ai-oss/anywhere-terminal";
const PANEL = "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/worktree-panel";

/** One window pane, published under a worktree. */
function pane(rowId: string, paneId: string): WorktreeAgentRow {
  return { ...agentRow({ rowId, agent: "claude", activity: "running", title: rowId }), paneId };
}

function presenceOf(rowsByWorktreeId: Record<string, WorktreeAgentRow[]>): WorktreePresence {
  return { scannedAt: 1_000_000, degradedSources: [], rowsByWorktreeId };
}

/** The fixture tree, optionally without one of its worktrees. */
function treeWithout(...omit: string[]): WorktreeTree {
  const tree = singleRepoTree();
  return {
    ...tree,
    repos: tree.repos.map((repo) => ({
      ...repo,
      worktrees: repo.worktrees.filter((wt: WorktreeInfo) => !omit.includes(wt.id)),
    })),
  };
}

interface Surface {
  /** Push a tree + presence the way the host does, through the seam. */
  push(over?: { tree?: WorktreeTree; rows?: Record<string, WorktreeAgentRow[]> }): void;
  /** The panel row for a branch, from whatever the controller drew. */
  row(branch: string): HTMLElement | undefined;
  /** The tab bar's scope chip, if it is drawing one. */
  chip(): HTMLElement | null;
  /** The tab labels the bar is currently showing. */
  tabs(): string[];
  controller: WorktreeController;
  /** The seam itself — every join the surface has goes through it. */
  seam: TabBarScopeWiring;
  /** One entry per redraw the seam asked for. */
  renders: number;
  /** One entry per panel rebuild, so a doubled repaint is visible. */
  paints: number;
  /** The panel's notices, as text, at each paint. */
  paintedNotices: string[][];
  state: Record<string, unknown>;
}

/**
 * A whole surface: the panel, the seam, and a tab bar over three panes — one in
 * `main`, one in `worktree-panel`, one the evidence does not place.
 */
function surface(over: { workbench?: boolean; persisted?: string; tabIds?: string[] } = {}): Surface {
  const tabIds = over.tabIds ?? ["pane-main", "pane-panel", "pane-loose"];
  const state: Record<string, unknown> = over.persisted === undefined ? {} : { worktreeScope: over.persisted };
  const tabLayouts = new Map<string, SplitNode>(tabIds.map((id) => [id, createLeaf(id)]));
  const source = {
    tabLayouts,
    tabActivePaneIds: new Map<string, string>(),
    terminals: new Map(tabIds.map((id) => [id, { name: id, exited: false, activityStatus: "idle" }])) as never,
  };

  const tabBarEl = document.createElement("div");
  tabBarEl.id = "tab-bar";
  document.body.appendChild(tabBarEl);

  let controller: WorktreeController | null = null;
  const out = { renders: 0 } as Surface;

  const draw = (): void => {
    out.renders += 1;
    renderTabBar({
      tabBarEl,
      terminals: buildTabBarData(source, seam.effectiveScope()),
      scope: seam.chip(),
      activeTabId: null,
      onTabClick: () => {},
      onTabClose: () => {},
      onAddClick: () => {},
    });
  };

  const seam = wireTabBarScope({
    store: {
      getState: () => state as { worktreeScope?: unknown },
      updateState: (patch) => Object.assign(state, patch),
    },
    workbench: over.workbench ?? true,
    panel: () => controller,
    tabLayouts: () => tabLayouts,
    render: draw,
  });

  controller = WorktreeController.mount({
    host: document.body,
    postMessage: () => {},
    store: { getState: () => state as never, updateState: (patch) => Object.assign(state, patch) },
    init: { workspaceRoot: "/repo", rowActivation: "focus", workbench: over.workbench ?? true },
    onSelectWorktree: (worktreeId) => seam.onSelectWorktree(worktreeId),
    onAttribution: (map) => seam.onAttribution(map),
    now: () => 1_000_000,
  });
  document.body.appendChild(controller.element);
  controller.setVisible(true);
  draw();

  // The view is what rebuilds the panel, so counting its pushes is what makes a
  // doubled repaint observable at all.
  out.paints = 0;
  out.paintedNotices = [];
  const view = (controller as unknown as { view: { setData: (...a: never[]) => void } }).view;
  const setData = view.setData.bind(view);
  view.setData = (...args: never[]) => {
    setData(...args);
    out.paints += 1;
    out.paintedNotices.push([...document.querySelectorAll(".wt-notice")].map((n) => n.textContent ?? ""));
  };

  out.seam = seam;
  out.controller = controller;
  out.state = state;
  out.push = (pushOver = {}) => {
    const msg: WorktreeTreeResponseMessage = {
      type: "worktreeTreeResponse",
      tree: pushOver.tree ?? singleRepoTree(),
      presence: presenceOf(pushOver.rows ?? { [MAIN]: [pane("a", "pane-main")], [PANEL]: [pane("b", "pane-panel")] }),
    };
    seam.applyTree(msg.tree, () => controller?.handleTreeResponse(msg));
  };
  out.row = (branch) =>
    [...document.querySelectorAll<HTMLElement>(".wt-row")].find(
      (r) => r.querySelector(".wt-branch")?.textContent === branch,
    );
  out.chip = () => tabBarEl.querySelector<HTMLElement>(".tab-scope");
  out.tabs = () => [...tabBarEl.querySelectorAll(".tab-name")].map((t) => t.textContent ?? "");
  return out;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("what the chip says it is filtering by", () => {
  it("names the worktree the user just picked, from the very first pick", () => {
    // The label used to be written only by `applyTree`, so the first selection
    // announced whatever the previous scope was called — on a fresh surface, an
    // absolute path — and the second announced the FIRST one's branch (round-1 B1).
    const s = surface();
    s.push();

    s.row("main")?.click();
    expect(s.chip()?.textContent).toContain("main");

    s.row("feat/worktree-panel")?.click();
    expect(s.chip()?.textContent).toContain("feat/worktree-panel");
    expect(s.chip()?.textContent).not.toContain("/Users/dev");
  });

  it("hides the pane that belongs elsewhere, and keeps the one nothing places", () => {
    const s = surface();
    s.push();
    s.row("main")?.click();
    expect(s.tabs()).toEqual(["pane-main", "pane-loose"]);
  });

  it("follows a rename of the worktree it names", () => {
    const s = surface();
    s.push();
    s.row("main")?.click();

    const tree = singleRepoTree();
    const renamed: WorktreeTree = {
      ...tree,
      repos: tree.repos.map((repo) => ({
        ...repo,
        worktrees: repo.worktrees.map((wt) => (wt.id === MAIN ? { ...wt, branch: "trunk" } : wt)),
      })),
    };
    s.push({ tree: renamed });
    expect(s.chip()?.textContent).toContain("trunk");
  });

  it("names the filter to a screen reader rather than only marking it", () => {
    const s = surface();
    s.push();
    s.row("main")?.click();
    const chip = s.chip();
    expect(chip?.getAttribute("role")).toBe("group");
    expect(chip?.getAttribute("aria-label")).toBe("Showing only tabs in main");
  });
});

describe("clearing the chip", () => {
  it("unmarks the panel row as well as unfiltering the bar", () => {
    // The chip cleared the coordinator alone, so the panel went on marking a row
    // as selected while the bar showed everything — two surfaces disagreeing about
    // the same selection (round-1 B2).
    const s = surface();
    s.push();
    s.row("main")?.click();
    expect(s.row("main")?.getAttribute("aria-selected")).toBe("true");

    const drawn = s.renders;
    s.chip()?.querySelector<HTMLButtonElement>(".tab-scope-clear")?.click();
    expect(s.renders, "one clear drew the bar more than once").toBe(drawn + 1);
    expect(s.chip()).toBeNull();
    expect(s.tabs()).toEqual(["pane-main", "pane-panel", "pane-loose"]);
    expect(s.row("main")?.getAttribute("aria-selected")).toBe("false");
    expect(s.controller.selectedWorktree()).toBeNull();
    expect(s.state.worktreeScope).toBeUndefined();
  });

  it("leaves the persisted scope gone, not merely hidden", () => {
    const s = surface();
    s.push();
    s.row("main")?.click();
    expect(s.state.worktreeScope).toBe(MAIN);

    s.chip()?.querySelector<HTMLButtonElement>(".tab-scope-clear")?.click();
    expect(s.state.worktreeScope).toBeUndefined();
  });
});

describe("a scope that arrived from persistence", () => {
  it("filters nothing until a tree confirms the worktree still exists", () => {
    // The panel is gated on visibility, so a surface that never opens it never
    // resolves the scope — and filtering meanwhile hides tabs on a guess that is
    // wrong exactly when the worktree is gone (round-1 W1).
    const s = surface({ persisted: "/wt/deleted" });
    expect(s.chip()).toBeNull();
    expect(s.tabs()).toEqual(["pane-main", "pane-panel", "pane-loose"]);
  });

  it("comes back into force when the tree does hold it", () => {
    const s = surface({ persisted: MAIN });
    s.push();
    expect(s.chip()?.textContent).toContain("main");
    expect(s.tabs()).toEqual(["pane-main", "pane-loose"]);
  });

  it("resolves to unscoped when the tree does not, and says so in the panel", () => {
    // Said AFTER the panel holds the tree that dropped it: a notice landing on a
    // panel still drawing the worktree it is about contradicts what is on screen
    // beside it (round-1 W2).
    const s = surface({ persisted: MAIN });
    s.push();
    const before = s.paints;

    s.push({ tree: treeWithout(MAIN), rows: { [PANEL]: [pane("b", "pane-panel")] } });

    expect(s.chip()).toBeNull();
    expect(s.state.worktreeScope).toBeUndefined();
    const notice = [...document.querySelectorAll(".wt-notice")].find((n) => n.textContent?.includes("Scope cleared"));
    expect(notice?.textContent).toContain("main");
    expect(s.row("main")).toBeUndefined();

    // ONE paint, and the notice was in it. Staged too late the panel is rebuilt
    // twice and the first of the two carries no notice; staged against the old
    // tree, the paint that first carries it still draws a `main` row beside it.
    expect(s.paints, "the drop rebuilt the panel twice").toBe(before + 1);
    expect(s.paintedNotices.at(-1)?.join(" ")).toContain("Scope cleared");
  });

  it("does not paint the notice beside a row for the worktree it says is gone", () => {
    const s = surface({ persisted: MAIN });
    s.push();
    const paintsWithNotice: number[] = [];
    const view = (s.controller as unknown as { view: { setData: (...a: never[]) => void } }).view;
    const setData = view.setData.bind(view);
    view.setData = (...args: never[]) => {
      setData(...args);
      if ([...document.querySelectorAll(".wt-notice")].some((n) => n.textContent?.includes("Scope cleared"))) {
        paintsWithNotice.push(
          [...document.querySelectorAll(".wt-branch")].filter((b) => b.textContent === "main").length,
        );
      }
    };

    s.push({ tree: treeWithout(MAIN), rows: {} });
    expect(paintsWithNotice, "the notice was never painted").not.toHaveLength(0);
    expect(paintsWithNotice, "painted beside a row for the worktree it says is gone").toEqual(
      paintsWithNotice.map(() => 0),
    );
  });

  it("announces the drop once, not again on the next tree", () => {
    const s = surface({ persisted: MAIN });
    s.push();
    s.push({ tree: treeWithout(MAIN), rows: {} });
    s.push({ tree: treeWithout(MAIN), rows: {} });
    expect(
      [...document.querySelectorAll(".wt-notice")].filter((n) => n.textContent?.includes("Scope cleared")),
    ).toHaveLength(1);
  });
});

describe("the flag the whole thing hangs off", () => {
  it("draws no chip and hides no tab while it is off, whatever is persisted", () => {
    const s = surface({ workbench: false, persisted: MAIN });
    s.push();
    expect(s.chip()).toBeNull();
    expect(s.tabs()).toEqual(["pane-main", "pane-panel", "pane-loose"]);
    expect(s.state.worktreeScope).toBe(MAIN);
  });

  it("cannot arm a scope the tree lost while it was off", () => {
    // Through the SEAM, not the controller: the controller's own `setWorkbench`
    // reaches `view.refresh()` and nothing else, so a test that calls it reads a
    // tab bar drawn while the coordinator was still off and stays green with the
    // fix reverted (round-2 V2).
    const s = surface({ workbench: false, persisted: MAIN });
    s.push();
    s.push({ tree: treeWithout(MAIN), rows: {} });
    s.seam.setWorkbench(true);

    expect(s.chip()).toBeNull();
    expect(s.tabs()).toEqual(["pane-main", "pane-panel", "pane-loose"]);
  });

  it("reaches the panel and the bar from one flip", () => {
    const s = surface({ workbench: false, persisted: MAIN });
    s.push();
    expect(s.chip()).toBeNull();
    expect(s.controller.isWorkbenchEnabled()).toBe(false);

    s.seam.setWorkbench(true);
    expect(s.controller.isWorkbenchEnabled()).toBe(true);
    expect(s.chip()?.textContent).toContain("main");
    expect(s.tabs()).toEqual(["pane-main", "pane-loose"]);
  });
});

describe("what a failure inside the push leaves behind", () => {
  it("still drops the scope and still says so when the panel handoff throws", () => {
    // The queue is drained in a `finally`, or a notice queued for a tree that
    // failed fires against the NEXT one — W2's own failure, reached through the
    // error path (round-2 V3).
    const s = surface({ persisted: MAIN });
    s.push();

    expect(() =>
      s.seam.applyTree(treeWithout(MAIN), () => {
        throw new Error("panel push failed");
      }),
    ).toThrow("panel push failed");

    expect(s.chip(), "the bar went on drawing a scope that is gone").toBeNull();
    expect(s.state.worktreeScope).toBeUndefined();

    // And the next tree does not re-announce it.
    s.push({ tree: treeWithout(MAIN), rows: {} });
    expect(
      [...document.querySelectorAll(".wt-notice")].filter((n) => n.textContent?.includes("Scope cleared")),
    ).toHaveLength(1);
  });
});

describe("where the keyboard lands", () => {
  it("hands focus to the surviving control when the clear destroys its own button", () => {
    const s = surface();
    s.push();
    s.row("main")?.click();
    const clear = s.chip()?.querySelector<HTMLButtonElement>(".tab-scope-clear");
    clear?.focus();
    clear?.click();

    expect(document.activeElement?.className).toBe("tab-add");
  });
});

describe("what a reload restores, and what it must not", () => {
  it("filters the bar without marking a row in the panel", () => {
    // Both specs at once: the scope survives a reload, and no worktree is selected
    // on the user's behalf on one. The panel marking nothing while the chip names
    // a worktree is what the two REQUIRE together, not a gap to be closed by
    // seeding the mark (round-2 V6).
    const s = surface({ persisted: MAIN });
    s.push();

    expect(s.chip()?.textContent).toContain("main");
    expect(s.controller.selectedWorktree(), "a reload selected a worktree on the user's behalf").toBeNull();
    expect(s.row("main")?.getAttribute("aria-selected")).toBe("false");
  });
});

describe("a surface with no worktree panel mounted", () => {
  /** The seam alone, as `main.ts` builds it when there is no `#vault-panel`. */
  function bare() {
    const state: Record<string, unknown> = {};
    const tabLayouts = new Map<string, SplitNode>([["pane-main", createLeaf("pane-main")]]);
    let renders = 0;
    const seam = wireTabBarScope({
      store: {
        getState: () => state as { worktreeScope?: unknown },
        updateState: (patch) => Object.assign(state, patch),
      },
      workbench: true,
      panel: () => null,
      tabLayouts: () => tabLayouts,
      render: () => {
        renders += 1;
      },
    });
    return { seam, tabLayouts, count: () => renders };
  }

  it("records the cleared state, so the next ask is not a second redraw", () => {
    // The clear rendered unconditionally, which left `shouldRender` never seeing
    // the post-clear signature — so the very next push redrew for a change that
    // had already been drawn (round-2 V4).
    const b = bare();
    b.seam.applyTree(singleRepoTree(), () => {});
    b.seam.onSelectWorktree(MAIN);
    b.seam.chip()?.onClear();
    const drawn = b.count();

    b.seam.applyTree(singleRepoTree(), () => {});
    expect(b.count(), "the cleared state was never recorded").toBe(drawn);
  });

  it("clears without a panel to clear through", () => {
    const b = bare();
    b.seam.applyTree(singleRepoTree(), () => {});
    b.seam.onSelectWorktree(MAIN);
    expect(b.seam.chip()).toBeDefined();

    b.seam.chip()?.onClear();
    expect(b.seam.chip()).toBeUndefined();
    expect(b.seam.effectiveScope()).toBeUndefined();
  });
});

describe("what counts as a reason to redraw the bar", () => {
  it("redraws once for a selection, and not at all for an identical push", () => {
    const s = surface();
    s.push();
    s.row("main")?.click();
    const drawn = s.renders;

    for (let i = 0; i < 3; i++) {
      s.push();
    }
    expect(s.renders, "identical pushes redrew the bar").toBe(drawn);
  });

  it("redraws when a pane changes hands", () => {
    const s = surface();
    s.push();
    s.row("main")?.click();
    const drawn = s.renders;

    s.push({ rows: { [PANEL]: [pane("a", "pane-main"), pane("b", "pane-panel")] } });
    expect(s.renders).toBe(drawn + 1);
    expect(s.tabs()).toEqual(["pane-loose"]);
  });
});
