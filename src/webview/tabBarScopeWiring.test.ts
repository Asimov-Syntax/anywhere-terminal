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
import { mountEmptyScopeRegion } from "./emptyScopeRegion";
import { createBranch, createLeaf, getAllSessionIds, type SplitNode } from "./SplitModel";
import { buildTabBarData, renderTabBar } from "./TabBarUtils";
import { type TabBarScopeWiring, wireTabBarScope } from "./tabBarScopeWiring";
import { WorktreeController } from "./worktree/WorktreeController";
import { agentRow, singleRepoTree } from "./worktree/worktreeFixtures";
import type { WorktreeAgentRow, WorktreeInfo, WorktreePresence, WorktreeTree } from "./worktree/worktreeViewTypes";

const MAIN = "/Users/dev/Projects/ai-oss/anywhere-terminal";
const PANEL = "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/worktree-panel";

/** One window pane, published under a worktree. */
function pane(rowId: string, paneId: string, activity: WorktreeAgentRow["activity"] = "running"): WorktreeAgentRow {
  return { ...agentRow({ rowId, agent: "claude", activity, title: rowId }), paneId };
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
  /** The count on the clearing control, or null when it carries no mark. */
  badge(): string | null;
  /** The tab labels the bar is currently showing. */
  tabs(): string[];
  controller: WorktreeController;
  /** The seam itself — every join the surface has goes through it. */
  seam: TabBarScopeWiring;
  /** One entry per redraw the seam asked for. */
  renders: number;
  /** One entry per time the seam said the presence need moved. */
  presenceRevalidations: number;
  /** One entry per panel rebuild, so a doubled repaint is visible. */
  paints: number;
  /** The panel's notices, as text, at each paint. */
  paintedNotices: string[][];
  /** One entry per pane the seam brought forward, in order. */
  activations: string[];
  /** The pane the surface considers active. */
  activePane: string | null;
  /** The worktree the empty-scope region is standing for, or `null`. */
  emptyScope: { id: string; label: string } | null;
  /**
   * Whether the terminal container is hidden — the state the region's whole point
   * rests on. Asserted instead of the dep call, because a spy proves the seam
   * called something and not that the surface changed (round-2 W7).
   */
  containerHidden(): boolean;
  /** The region element currently standing, if any. */
  region(): HTMLElement | null;
  /** One entry per worktree the region's terminal offer was taken for. */
  opened: string[];
  /** A pane arriving the way `onTabCreated` delivers one — a redraw, no selection. */
  addPane(paneId: string, worktreeId: string): void;
  state: Record<string, unknown>;
}

/**
 * A whole surface: the panel, the seam, and a tab bar over three panes — one in
 * `main`, one in `worktree-panel`, one the evidence does not place.
 */
function surface(
  over: {
    persisted?: string;
    tabIds?: string[];
    layouts?: Map<string, SplitNode>;
    activePane?: string;
  } = {},
): Surface {
  const tabIds = over.tabIds ?? ["pane-main", "pane-panel", "pane-loose"];
  const state: Record<string, unknown> = over.persisted === undefined ? {} : { worktreeScope: over.persisted };
  const tabLayouts = over.layouts ?? new Map<string, SplitNode>(tabIds.map((id) => [id, createLeaf(id)]));
  const panes: string[] = [...tabLayouts.values()].flatMap((layout) => getAllSessionIds(layout));
  const source = {
    tabLayouts,
    tabActivePaneIds: new Map<string, string>(),
    terminals: new Map(panes.map((id) => [id, { name: id, exited: false, activityStatus: "idle" }])) as never,
  };

  const tabBarEl = document.createElement("div");
  tabBarEl.id = "tab-bar";
  document.body.appendChild(tabBarEl);
  // The real element the region stands in front of, wired through the real mount:
  // these tests then assert what the user would see rather than what the seam said.
  const containerEl = document.createElement("div");
  containerEl.id = "terminal-container";
  document.body.appendChild(containerEl);

  let controller: WorktreeController | null = null;
  const out = {
    renders: 0,
    presenceRevalidations: 0,
    activations: [] as string[],
    opened: [] as string[],
    activePane: over.activePane ?? null,
    emptyScope: null,
  } as unknown as Surface;

  const draw = (): void => {
    out.renders += 1;
    // Built once and read twice, exactly as `main.ts` does it: the bar draws the
    // tabs, and the chip's badge counts what that same pass dropped.
    const data = buildTabBarData(source, seam.effectiveScope());
    seam.syncEmptyScope();
    renderTabBar({
      tabBarEl,
      terminals: data.tabs,
      scope: seam.chip(data.hiddenWaiting),
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
    panel: () => controller,
    source: () => source,
    render: draw,
    revalidatePresence: () => {
      out.presenceRevalidations += 1;
    },
    activePane: () => out.activePane,
    activatePane: (paneId) => {
      out.activations.push(paneId);
      out.activePane = paneId;
    },
    showEmptyScope: (worktree) => {
      out.emptyScope = worktree;
      mountEmptyScopeRegion(
        containerEl,
        worktree === null
          ? null
          : {
              id: worktree.id,
              label: worktree.label,
              // Records the id, because a stub that drops it makes two same-named
              // worktrees identical inputs — which is why nothing here could see
              // the region offering the wrong one (round-3 W8).
              onOpenTerminal: () => out.opened.push(worktree.id),
              onClear: () => {},
            },
      );
    },
  });

  controller = WorktreeController.mount({
    host: document.body,
    postMessage: () => {},
    store: { getState: () => state as never, updateState: (patch) => Object.assign(state, patch) },
    init: { workspaceRoot: "/repo", rowActivation: "focus" },
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
  out.addPane = (paneId, worktreeId) => {
    tabLayouts.set(paneId, createLeaf(paneId));
    panes.push(paneId);
    (source.terminals as unknown as Map<string, unknown>).set(paneId, {
      name: paneId,
      exited: false,
      activityStatus: "idle",
    });
    seam.onAttribution({
      placement: new Map([...panes.map((id) => [id, id === paneId ? worktreeId : MAIN] as [string, string])]),
      waiting: new Set(),
    });
    draw();
  };
  out.containerHidden = () => containerEl.style.display === "none";
  out.region = () => document.getElementById("empty-scope-region");
  out.chip = () => tabBarEl.querySelector<HTMLElement>(".tab-scope");
  out.badge = () => tabBarEl.querySelector<HTMLElement>(".tab-scope-badge")?.textContent ?? null;
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
      panel: () => null,
      source: () => ({
        tabLayouts,
        tabActivePaneIds: new Map<string, string>(),
        terminals: new Map([["pane-main", { name: "pane-main", exited: false, activityStatus: "idle" }]]) as never,
      }),
      render: () => {
        renders += 1;
      },
      activePane: () => "pane-main",
      activatePane: () => {},
      showEmptyScope: () => {},
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

// ─── The count, end to end: presence says waiting, the bar says how many ──

describe("a hidden tab that needs a human is counted", () => {
  it("marks the control once a hidden pane is waiting, and not before", () => {
    const s = surface();
    s.push();
    s.row("feat/worktree-panel")?.click();
    // Both panes are running; something is hidden, but nothing hidden needs anyone.
    // `pane-loose` is unplaced and so presented in every scope (I18).
    expect(s.tabs()).toEqual(["pane-panel", "pane-loose"]);
    expect(s.badge()).toBeNull();

    s.push({
      rows: { [MAIN]: [pane("a", "pane-main", "waiting")], [PANEL]: [pane("b", "pane-panel")] },
    });
    expect(s.badge()).toBe("1");
  });

  it("clears to a bar holding the tab the count named", () => {
    // The count and what clearing produces cannot disagree — this is that claim,
    // asserted across the two of them rather than on either alone.
    const s = surface();
    s.push({
      rows: { [MAIN]: [pane("a", "pane-main", "waiting")], [PANEL]: [pane("b", "pane-panel")] },
    });
    s.row("feat/worktree-panel")?.click();
    expect(s.badge()).toBe("1");
    expect(s.tabs()).not.toContain("pane-main");

    s.chip()?.querySelector<HTMLButtonElement>(".tab-scope-clear")?.click();
    expect(s.tabs()).toContain("pane-main");
    expect(s.badge()).toBeNull();
  });

  it("drops the mark when the hidden pane stops waiting", () => {
    const s = surface();
    s.push({
      rows: { [MAIN]: [pane("a", "pane-main", "waiting")], [PANEL]: [pane("b", "pane-panel")] },
    });
    s.row("feat/worktree-panel")?.click();
    expect(s.badge()).toBe("1");

    s.push();
    expect(s.badge()).toBeNull();
  });

  it("raises no mark while unscoped, however many panes are waiting", () => {
    const s = surface();
    s.push({
      rows: { [MAIN]: [pane("a", "pane-main", "waiting")], [PANEL]: [pane("b", "pane-panel", "waiting")] },
    });
    expect(s.chip()).toBeNull();
    expect(s.badge()).toBeNull();
  });
});

describe("a selection lands on a pane of the worktree it named", () => {
  /** A surface whose panes are already placed, with `active` the active one. */
  function placed(active: string, over: Parameters<typeof surface>[0] = {}) {
    const s = surface({ ...over, activePane: active });
    s.push();
    return s;
  }

  it("moves to the first presented pane when the active one belongs elsewhere", () => {
    const s = placed("pane-panel");
    s.seam.onSelectWorktree(MAIN);

    expect(s.activations).toEqual(["pane-main"]);
    expect(s.emptyScope).toBeNull();
  });

  it("leaves an active pane that is itself in scope alone", () => {
    const s = placed("pane-main");
    s.seam.onSelectWorktree(MAIN);

    expect(s.activations).toEqual([]);
  });

  it("moves inside a split whose visible tab holds an out-of-scope active leaf", () => {
    // The tab is presented because ONE of its leaves is in scope, while the leaf
    // active inside it is attributed elsewhere. Tab identity cannot answer this:
    // bringing the tab forward would leave the wrong leaf showing.
    const s = placed("pane-panel", {
      layouts: new Map<string, SplitNode>([
        ["pane-main", createBranch("horizontal", createLeaf("pane-main"), createLeaf("pane-panel"))],
      ]),
    });
    s.seam.onSelectWorktree(MAIN);

    expect(s.tabs()).toHaveLength(1);
    expect(s.activations).toEqual(["pane-main"]);
  });

  it("shows the region, naming the worktree, when the scope holds no pane at all", () => {
    const s = placed("pane-main", { tabIds: ["pane-main"] });
    // Every pane the surface holds is attributed to MAIN, so PANEL holds none.
    s.seam.onSelectWorktree(PANEL);

    expect(s.emptyScope).toEqual({ id: PANEL, label: "feat/worktree-panel" });
    expect(s.activations).toEqual([]);
  });

  it("takes the region down again once the scope is cleared", () => {
    const s = placed("pane-main", { tabIds: ["pane-main"] });
    s.seam.onSelectWorktree(PANEL);
    expect(s.emptyScope).not.toBeNull();

    s.seam.onSelectWorktree(null);
    expect(s.emptyScope).toBeNull();
    // The pane the scope hid is presented again, from the same store — clearing
    // restores it rather than rebuilding it.
    expect(s.tabs()).toEqual(["pane-main"]);
  });

  it("takes the region down when the scoped worktree leaves the tree", () => {
    // Not a selection, so nothing is activated — a tree push must not move focus
    // the user did not ask to move.
    const s = placed("pane-main", { tabIds: ["pane-main"] });
    s.seam.onSelectWorktree(PANEL);
    s.activations.length = 0;

    s.push({ tree: treeWithout(PANEL) });

    expect(s.emptyScope).toBeNull();
    expect(s.activations).toEqual([]);
  });

  it("costs one draw for the whole selection", () => {
    const s = placed("pane-panel");
    const before = s.renders;
    s.seam.onSelectWorktree(MAIN);

    expect(s.renders - before).toBe(1);
  });
});

describe("round-1: the region follows the presented set, not just the selection", () => {
  it("takes the region down when a pane appears in the scope by a route no selection passes", () => {
    // B1: the region's OWN "Open a terminal" offer arrives this way. Deciding only
    // at selection left it standing over the terminal it had just opened.
    const s = surface({ tabIds: ["pane-main"], activePane: "pane-main" });
    s.push();
    s.seam.onSelectWorktree(PANEL);
    expect(s.emptyScope).not.toBeNull();

    s.addPane("pane-new", PANEL);

    expect(s.emptyScope).toBeNull();
  });

  it("puts the region up when the scope's last pane is re-attributed elsewhere", () => {
    // W2: a push, not a selection. The requirement is unconditional.
    const s = surface({ tabIds: ["pane-main"], activePane: "pane-main" });
    s.push();
    s.seam.onSelectWorktree(MAIN);
    expect(s.emptyScope).toBeNull();

    s.push({ rows: { [PANEL]: [pane("a", "pane-main")] } });

    expect(s.emptyScope).toEqual({ id: MAIN, label: "main" });
  });

  it("sees the live leaf of a split collapsed onto its non-original pane", () => {
    // W3: `closeSplitPaneById` leaves tabLayouts[A] = leaf{B} with A's instance
    // gone. Reading tab ids reported nothing, and the region claimed a running
    // worktree was empty.
    const s = surface({
      layouts: new Map<string, SplitNode>([["pane-main", createLeaf("pane-collapsed")]]),
      activePane: "pane-collapsed",
    });
    s.push({ rows: { [MAIN]: [pane("a", "pane-collapsed")] } });
    s.seam.onSelectWorktree(MAIN);

    expect(s.emptyScope).toBeNull();
    expect(s.containerHidden()).toBe(false);
  });

  it("hides the real container while the region stands, and gives it back", () => {
    // Asserted on the container, not on the dep call: a spy proves the seam said
    // something, not that the surface changed (round-2 W7).
    const s = surface({ tabIds: ["pane-main"], activePane: "pane-main" });
    s.push();
    s.seam.onSelectWorktree(PANEL);
    expect(s.containerHidden()).toBe(true);
    expect(s.region()).not.toBeNull();

    s.seam.onSelectWorktree(null);
    expect(s.containerHidden()).toBe(false);
    expect(s.region()).toBeNull();
  });

  it("gives the container back on the arrival path, not only on a selection", () => {
    const s = surface({ tabIds: ["pane-main"], activePane: "pane-main" });
    s.push();
    s.seam.onSelectWorktree(PANEL);
    expect(s.containerHidden()).toBe(true);

    s.addPane("pane-new", PANEL);

    expect(s.containerHidden()).toBe(false);
    expect(s.region()).toBeNull();
  });

  it("moves the region's offer to the worktree just selected, not the one before it", () => {
    // The end-to-end half of round-3 B3. These two worktrees have different
    // LABELS, so this does not discriminate on the id axis by itself — the unit
    // test in emptyScopeRegion.test.ts does that. What it guards is the wiring:
    // `WorktreeView.select` emits the new worktree with no intervening `null`, so
    // the region survives the move and must offer the worktree now scoped.
    const s = surface({ tabIds: ["pane-main"], activePane: "pane-main" });
    s.push();
    s.seam.onSelectWorktree(PANEL);
    s.seam.onSelectWorktree(MAIN);
    // MAIN holds `pane-main`, so it is not empty — go somewhere that is, to keep a
    // region standing across the move.
    s.push({ rows: { [PANEL]: [pane("a", "pane-main")] } });
    s.region()?.querySelector<HTMLButtonElement>("button")?.click();

    expect(s.opened).toEqual([MAIN]);
  });

  it("keeps the standing region, and its focus, across a redraw that changes nothing", () => {
    // The render path fires on every activity transition in the window, and while
    // the scope is empty every running pane is out of scope — so this is the normal
    // case, not an edge one (round-2 W6).
    const s = surface({ tabIds: ["pane-main"], activePane: "pane-main" });
    s.push();
    s.seam.onSelectWorktree(PANEL);
    const before = s.region();
    const offer = before?.querySelector("button");
    offer?.focus();
    expect(document.activeElement).toBe(offer);

    s.seam.syncEmptyScope();
    s.seam.syncEmptyScope();

    expect(s.region()).toBe(before);
    expect(document.activeElement).toBe(offer);
  });
});

describe("[2_2] the presence need reaches the surface even when nothing repaints", () => {
  /**
   * Put a signature on record. Setup calls `draw()` directly, so the coordinator
   * has reported on nothing yet and its first gated comparison is against `null`
   * — which renders whatever moved. Priming makes the gate answer the question
   * these tests are actually asking.
   */
  function primed(s: Surface): Surface {
    s.seam.onAttribution({ placement: new Map(), waiting: new Set() });
    return s;
  }

  it("fires when a tree drops a stored scope it never confirmed", () => {
    // The falling edge. Unlike the flip above, this one DOES repaint today — the
    // arriving tree moves the signature for its own reasons — so a subscription
    // riding the repaint would survive here by coincidence. Asserted anyway: the
    // coincidence is not a guarantee, and what this records is that the need is
    // reported from the need, not from whatever else happened to move.
    const s = primed(surface({ persisted: "/no/such/worktree" }));
    expect(s.seam.needsPresence()).toBe(true);
    const before = s.presenceRevalidations;

    s.push({ tree: treeWithout() });

    expect(s.seam.needsPresence(), "the dropped scope kept the surface subscribed").toBe(false);
    expect(s.presenceRevalidations, "the surface was never told to drop its subscription").toBeGreaterThan(before);
  });

  it("says nothing when the need did not move", () => {
    const s = primed(surface());
    const before = s.presenceRevalidations;
    s.push();
    expect(s.presenceRevalidations).toBe(before);
  });
});
