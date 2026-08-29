// src/webview/tabBarScope.test.ts — the surface's tab-bar scope.
//
// Covers what design.md D1 / D7 / D8 / D9 leave to the implementation: what a
// reload restores, what a tree that moved does to a scope, what a failed write
// does, and what does NOT count as a reason to redraw.

import { describe, expect, it, vi } from "vitest";
import type { PaneAttribution, PaneReport } from "./paneAttribution";
import { createBranch, createLeaf, getAllSessionIds, type SplitNode } from "./SplitModel";
import { buildTabBarData } from "./TabBarUtils";
import { TabBarScopeCoordinator, type TabBarScopeDeps, type TabBarScopeStore } from "./tabBarScope";
import type { WorktreeInfo, WorktreeTree } from "./worktree/worktreeViewTypes";

const HERE = "/wt/here";
const ELSEWHERE = "/wt/elsewhere";

function worktree(over: Partial<WorktreeInfo> & { id: string }): WorktreeInfo {
  return {
    displayPath: over.id,
    kind: "linked",
    bare: false,
    detached: false,
    locked: false,
    prunable: false,
    missing: false,
    inWorkspace: false,
    ...over,
  };
}

function treeOf(...worktrees: WorktreeInfo[]): WorktreeTree {
  return {
    gitAvailable: true,
    unreadable: { count: 0, reasons: [] },
    repos: [{ repoId: "/repo/.git", label: "repo", mainPath: "/repo", worktrees }],
  };
}

/** A store over a plain object, so unrelated keys are real and observable. */
function storeOf(initial: Record<string, unknown> = {}): TabBarScopeStore & { state: Record<string, unknown> } {
  const state = { ...initial };
  return {
    state,
    getState: () => state as { worktreeScope?: unknown },
    updateState: (patch) => Object.assign(state, patch),
  };
}

/** One presence scan's report. Most tests only care about the placement half. */
function report(placement: PaneAttribution, waiting: Iterable<string> = []): PaneReport {
  return { placement, waiting: new Set(waiting) };
}

const layouts = (...ids: string[]): Map<string, SplitNode> => new Map(ids.map((id) => [id, createLeaf(id)]));

/**
 * Ask the guard the way the seam asks it: the count comes from `buildTabBarData`,
 * the same pass that draws the badge. Deriving it inside the coordinator is what
 * let the two disagree about an exited pane and suppress a real redraw
 * (round-1 B2), so the tests go through the real derivation too.
 */
function ask(
  scope: TabBarScopeCoordinator,
  tabLayouts: Map<string, SplitNode>,
  exited: readonly string[] = [],
): boolean {
  const panes = [...tabLayouts.values()].flatMap((layout) => getAllSessionIds(layout));
  const source = {
    tabLayouts,
    tabActivePaneIds: new Map<string, string>(),
    terminals: new Map(
      panes.map((id) => [id, { name: id, exited: exited.includes(id), activityStatus: "idle" }]),
    ) as never,
  };
  return scope.shouldRender(tabLayouts, buildTabBarData(source, scope.effectiveScope()).hiddenWaiting);
}

/**
 * A coordinator with the workbench ON. The rollout gate is 1_8's subject and has
 * its own describe block; everywhere else it would only be noise between the
 * behaviour and the assertion.
 */
function coordinator(deps: Omit<TabBarScopeDeps, "workbench"> & { workbench?: boolean }): TabBarScopeCoordinator {
  return new TabBarScopeCoordinator({ workbench: true, ...deps });
}

describe("what a reload restores", () => {
  it("restores a scope the tree still holds", () => {
    const scope = coordinator({ store: storeOf({ worktreeScope: HERE }) });
    scope.applyTree(treeOf(worktree({ id: HERE, branch: "here" })));
    expect(scope.scopedWorktreeId()).toBe(HERE);
    expect(scope.isScoped()).toBe(true);
  });

  it("lands unscoped on an absent, a non-string, and an empty stored value", () => {
    // Fails OPEN: the stored object is cast structurally rather than validated, so
    // anything that is not a worktree id is not a scope. Failing closed would leave
    // a surface filtered by something it could not read (design.md D9).
    for (const stored of [undefined, 42, {}, [], true, null, ""]) {
      const scope = coordinator({ store: storeOf({ worktreeScope: stored }) });
      expect(scope.scopedWorktreeId(), `stored: ${JSON.stringify(stored)}`).toBeNull();
      expect(scope.effectiveScope()).toBeUndefined();
    }
  });

  it("lands unscoped when the read itself throws", () => {
    const scope = coordinator({
      store: {
        getState: () => {
          throw new Error("state unreadable");
        },
        updateState: () => {},
      },
    });
    expect(scope.scopedWorktreeId()).toBeNull();
  });

  it("resolves a persisted id the tree no longer holds to unscoped, and says so", () => {
    const dropped: [string, string][] = [];
    const store = storeOf({ worktreeScope: "/wt/deleted" });
    const scope = coordinator({ store, onScopeDropped: (id, label) => dropped.push([id, label]) });

    scope.applyTree(treeOf(worktree({ id: HERE, branch: "here" })));
    expect(scope.scopedWorktreeId()).toBeNull();
    expect(store.state.worktreeScope).toBeUndefined();
    // No tree ever confirmed this one, so the id is the only name there is.
    expect(dropped).toEqual([["/wt/deleted", "/wt/deleted"]]);
  });
});

describe("a scope re-resolved against the tree", () => {
  it("keeps a worktree the tree reports missing", () => {
    // Still registered, and panes may still be attributed to it (design.md D7).
    const dropped: string[] = [];
    const scope = coordinator({
      store: storeOf({ worktreeScope: HERE }),
      onScopeDropped: (id) => dropped.push(id),
    });
    scope.applyTree(treeOf(worktree({ id: HERE, branch: "here", missing: true, prunable: true })));
    expect(scope.scopedWorktreeId()).toBe(HERE);
    expect(dropped).toEqual([]);
  });

  it("drops one that was removed, naming it by the branch the tree last showed", () => {
    const dropped: [string, string][] = [];
    const store = storeOf();
    const scope = coordinator({ store, onScopeDropped: (id, label) => dropped.push([id, label]) });

    scope.select(HERE);
    scope.applyTree(treeOf(worktree({ id: HERE, branch: "feat/here" }), worktree({ id: ELSEWHERE })));
    expect(scope.scopedWorktreeId()).toBe(HERE);

    scope.applyTree(treeOf(worktree({ id: ELSEWHERE })));
    expect(scope.scopedWorktreeId()).toBeNull();
    expect(scope.isScoped()).toBe(false);
    expect(store.state.worktreeScope).toBeUndefined();
    expect(dropped).toEqual([[HERE, "feat/here"]]);
  });

  it("says nothing while unscoped, and nothing when no tree has arrived", () => {
    const dropped: string[] = [];
    const scope = coordinator({
      store: storeOf({ worktreeScope: HERE }),
      onScopeDropped: (id) => dropped.push(id),
    });
    scope.applyTree(null);
    scope.clear();
    scope.applyTree(treeOf());
    expect(dropped).toEqual([]);
  });

  it("filters nothing on a persisted scope until a tree has confirmed it", () => {
    // The drop is announced by `applyTree`, so before any tree has arrived the
    // coordinator does not yet know whether this id still exists. Filtering on it
    // in the meantime hides tabs on the strength of a guess, and the guess is
    // wrong exactly when the worktree is gone (round-1 W1).
    const scope = coordinator({ store: storeOf({ worktreeScope: HERE }) });
    expect(scope.scopedWorktreeId()).toBeNull();
    expect(scope.effectiveScope()).toBeUndefined();

    scope.applyTree(treeOf(worktree({ id: HERE, branch: "here" })));
    expect(scope.scopedWorktreeId()).toBe(HERE);
  });

  it("stops filtering on a scope a later tree no longer holds, flag off included", () => {
    // Off, the drop is not announced — but the id is no longer confirmed either,
    // so turning the flag on cannot arm a scope the tree has already lost.
    const scope = coordinator({ store: storeOf({ worktreeScope: HERE }), workbench: false });
    scope.applyTree(treeOf(worktree({ id: HERE, branch: "here" })));
    scope.applyTree(treeOf(worktree({ id: ELSEWHERE })));

    scope.setWorkbench(true);
    expect(scope.scopedWorktreeId()).toBeNull();
    expect(scope.effectiveScope()).toBeUndefined();
  });
});

describe("what the surface writes", () => {
  it("preserves every unrelated key across a scope write", () => {
    const store = storeOf({ vaultView: "worktree", worktreeCollapsed: ["/a"], worktreeExpandedRows: ["r1"] });
    const scope = coordinator({ store });

    scope.select(HERE);
    scope.clear();
    expect(store.state).toEqual({
      vaultView: "worktree",
      worktreeCollapsed: ["/a"],
      worktreeExpandedRows: ["r1"],
      worktreeScope: undefined,
    });
  });

  it("writes once per move, and not at all for a set that changes nothing", () => {
    const store = storeOf();
    const writes = vi.spyOn(store, "updateState");
    const scope = coordinator({ store });

    scope.select(HERE);
    scope.select(HERE);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it("lets a failed write throw, leaving the previous scope standing", () => {
    // The wrapper promises no transactionality and no recovery. Recording a scope
    // the surface could not persist would be the lie; the old one is a legal state
    // (design.md D9).
    let armed = false;
    const scope = coordinator({
      store: {
        getState: () => ({ worktreeScope: HERE }),
        updateState: () => {
          if (armed) {
            throw new Error("setState failed");
          }
        },
      },
    });
    // Confirmed first: an unresolved scope is not the "previous scope standing"
    // this is about, and would pass whether the write threw or not.
    scope.applyTree(treeOf(worktree({ id: HERE, branch: "here" }), worktree({ id: ELSEWHERE })));
    armed = true;
    expect(() => scope.select(ELSEWHERE)).toThrow("setState failed");
    expect(scope.scopedWorktreeId()).toBe(HERE);
    expect(scope.scopedLabel()).toBe("here");
  });
});

describe("what counts as a reason to redraw", () => {
  const scoped = () => {
    const s = coordinator({ store: storeOf({ worktreeScope: HERE }) });
    s.applyTree(treeOf(worktree({ id: HERE, branch: "here" }), worktree({ id: ELSEWHERE, branch: "there" })));
    s.setAttribution(report(new Map([["pane-1", HERE]])));
    ask(s, layouts("tab-1"));
    return s;
  };

  it("draws once on the first ask and never again for the same state", () => {
    const scope = scoped();
    expect(ask(scope, layouts("tab-1"))).toBe(false);
    expect(ask(scope, layouts("tab-1"))).toBe(false);
  });

  it("draws once for an attribution that moved a pane, and once for a changed scope", () => {
    const scope = scoped();
    scope.setAttribution(report(new Map([["pane-1", ELSEWHERE]])));
    expect(ask(scope, layouts("tab-1"))).toBe(true);
    expect(ask(scope, layouts("tab-1"))).toBe(false);

    scope.select(ELSEWHERE);
    expect(ask(scope, layouts("tab-1"))).toBe(true);
    expect(ask(scope, layouts("tab-1"))).toBe(false);
  });

  it("ignores the order the attribution arrived in", () => {
    const scope = scoped();
    scope.setAttribution(
      report(
        new Map([
          ["pane-2", ELSEWHERE],
          ["pane-1", HERE],
        ]),
      ),
    );
    expect(ask(scope, layouts("tab-1"))).toBe(true);

    scope.setAttribution(
      report(
        new Map([
          ["pane-1", HERE],
          ["pane-2", ELSEWHERE],
        ]),
      ),
    );
    expect(ask(scope, layouts("tab-1"))).toBe(false);
  });

  // The narrowed requirement: a waiting change redraws only where the bar PRESENTS
  // the difference. The local `activityStatus` half needs no guard here — the
  // activity tracker calls `updateTabBar` on its own (main.ts:112), so this
  // signature answers only for the presence push.
  it("draws when a HIDDEN tab's pane starts waiting", () => {
    const scope = scoped();
    scope.setAttribution(report(new Map([["tab-2", ELSEWHERE]]), ["tab-2"]));
    expect(ask(scope, layouts("tab-1", "tab-2"))).toBe(true);
    expect(ask(scope, layouts("tab-1", "tab-2"))).toBe(false);
  });

  it("draws when the last hidden waiting pane stops waiting, so the mark can go", () => {
    const scope = scoped();
    scope.setAttribution(report(new Map([["tab-2", ELSEWHERE]]), ["tab-2"]));
    ask(scope, layouts("tab-1", "tab-2"));
    scope.setAttribution(report(new Map([["tab-2", ELSEWHERE]])));
    expect(ask(scope, layouts("tab-1", "tab-2"))).toBe(true);
  });

  it("does NOT draw when a PRESENTED pane starts waiting", () => {
    // It was never hidden, so no count moves and nothing on the bar changes.
    const scope = scoped();
    scope.setAttribution(report(new Map([["pane-1", HERE]]), ["pane-1"]));
    expect(ask(scope, layouts("tab-1"))).toBe(false);
  });

  it("does NOT draw when a pane the evidence cannot place starts waiting", () => {
    // Absent from the map means presented in every scope (I18) — never hidden,
    // never counted, so never a reason to redraw. Membership is settled FIRST, so
    // the only thing that moves between the two asks is the waiting set.
    const scope = scoped();
    const placement = new Map([["pane-1", HERE]]);
    scope.setAttribution(report(placement));
    ask(scope, layouts("tab-1", "tab-9"));
    scope.setAttribution(report(placement, ["tab-9"]));
    expect(ask(scope, layouts("tab-1", "tab-9"))).toBe(false);
  });

  it("does NOT draw for any waiting change while the surface is unscoped", () => {
    // Unscoped hides nothing, so no pane can be hidden-and-waiting. Scope,
    // placement and membership are all settled before the waiting set moves.
    const scope = scoped();
    const placement = new Map([["tab-2", ELSEWHERE]]);
    scope.clear();
    scope.setAttribution(report(placement));
    ask(scope, layouts("tab-1", "tab-2"));
    scope.setAttribution(report(placement, ["tab-2"]));
    expect(ask(scope, layouts("tab-1", "tab-2"))).toBe(false);
  });

  it("ignores the order the waiting set arrived in", () => {
    const scope = scoped();
    const placement = new Map([
      ["tab-2", ELSEWHERE],
      ["tab-3", ELSEWHERE],
    ]);
    scope.setAttribution(report(placement, ["tab-2", "tab-3"]));
    expect(ask(scope, layouts("tab-1", "tab-2", "tab-3"))).toBe(true);
    scope.setAttribution(report(placement, ["tab-3", "tab-2"]));
    expect(ask(scope, layouts("tab-1", "tab-2", "tab-3"))).toBe(false);
  });

  it("exposes the waiting panes for the badge to count with its own second source", () => {
    const scope = scoped();
    scope.setAttribution(report(new Map([["tab-2", ELSEWHERE]]), ["tab-2"]));
    expect([...scope.waitingPanes()]).toEqual(["tab-2"]);
  });

  it("draws when a split gains or loses a leaf", () => {
    // Membership decides which panes a tab is judged by, so the join keeps the
    // old answer unless the signature notices.
    const scope = scoped();
    const split = new Map<string, SplitNode>([
      ["tab-1", createBranch("horizontal", createLeaf("tab-1"), createLeaf("pane-2"))],
    ]);
    expect(ask(scope, split)).toBe(true);
    expect(ask(scope, split)).toBe(false);
    expect(ask(scope, layouts("tab-1"))).toBe(true);
  });
});

describe("a push that moved no attribution charges nothing", () => {
  /**
   * One presence push as the surface actually sees it: the tree is re-resolved,
   * a fresh attribution map arrives, and the bar is asked whether to redraw.
   */
  function push(
    scope: TabBarScopeCoordinator,
    entries: [string, string][],
    tree: WorktreeTree,
    tabLayouts: Map<string, SplitNode>,
  ): boolean {
    scope.applyTree(tree);
    scope.setAttribution(report(new Map(entries)));
    return ask(scope, tabLayouts);
  }

  const tree = () => treeOf(worktree({ id: HERE, branch: "here" }), worktree({ id: ELSEWHERE, branch: "there" }));
  const placed = (): [string, string][] => [
    ["pane-1", HERE],
    ["pane-2", ELSEWHERE],
  ];

  it("draws once, then not again however many identical pushes arrive", () => {
    // The envelope carries far more than attribution — a scan timestamp, activity,
    // titles, delegations — and a new object every time. None of it is in the
    // signature, so none of it is a reason to re-enter renderTabBar.
    const scope = coordinator({ store: storeOf({ worktreeScope: HERE }) });
    const tabs = layouts("tab-1", "tab-2");
    expect(push(scope, placed(), tree(), tabs)).toBe(true);
    for (let i = 0; i < 5; i++) {
      expect(push(scope, placed(), tree(), tabs), `push ${i}`).toBe(false);
    }
  });

  it("draws nothing for a tree that moved without moving any attribution", () => {
    const scope = coordinator({ store: storeOf({ worktreeScope: HERE }) });
    const tabs = layouts("tab-1");
    push(scope, placed(), tree(), tabs);

    // A worktree appears and ANOTHER one is renamed. No pane changed hands, the
    // scope still names the same worktree, and the chip still says the same word,
    // so the bar is left untouched — a tree change that moves no attribution and
    // no scope is not a redraw.
    const moved = treeOf(
      worktree({ id: HERE, branch: "here" }),
      worktree({ id: ELSEWHERE, branch: "renamed" }),
      worktree({ id: "/wt/new", branch: "new" }),
    );
    expect(push(scope, placed(), moved, tabs)).toBe(false);
  });

  it("draws for a tree that renamed the SCOPED worktree, and nothing more", () => {
    // The one tree-only reason there is. The chip is on screen naming this branch,
    // so suppressing the redraw leaves it saying a name that no longer exists —
    // the same class of lie as a hidden tab (round-1, accepted suggestion).
    const scope = coordinator({ store: storeOf({ worktreeScope: HERE }) });
    const tabs = layouts("tab-1");
    push(scope, placed(), tree(), tabs);
    expect(scope.scopedLabel()).toBe("here");

    const renamed = treeOf(worktree({ id: HERE, branch: "feat/here" }), worktree({ id: ELSEWHERE, branch: "there" }));
    expect(push(scope, placed(), renamed, tabs)).toBe(true);
    expect(scope.scopedLabel()).toBe("feat/here");
    expect(push(scope, placed(), renamed, tabs)).toBe(false);
  });

  it("draws exactly once for each thing that does move it", () => {
    const scope = coordinator({ store: storeOf({ worktreeScope: HERE }) });
    const tabs = layouts("tab-1");
    push(scope, placed(), tree(), tabs);

    // A pane changes hands.
    const moved: [string, string][] = [
      ["pane-1", ELSEWHERE],
      ["pane-2", ELSEWHERE],
    ];
    expect(push(scope, moved, tree(), tabs)).toBe(true);
    expect(push(scope, moved, tree(), tabs)).toBe(false);

    // A pane the evidence stops placing at all.
    const fewer: [string, string][] = [["pane-2", ELSEWHERE]];
    expect(push(scope, fewer, tree(), tabs)).toBe(true);
    expect(push(scope, fewer, tree(), tabs)).toBe(false);

    // The scope itself.
    scope.select(ELSEWHERE);
    expect(push(scope, fewer, tree(), tabs)).toBe(true);
    expect(push(scope, fewer, tree(), tabs)).toBe(false);

    // A split gaining a leaf, then losing it.
    const split = new Map<string, SplitNode>([
      ["tab-1", createBranch("horizontal", createLeaf("tab-1"), createLeaf("pane-2"))],
    ]);
    expect(push(scope, fewer, tree(), split)).toBe(true);
    expect(push(scope, fewer, tree(), split)).toBe(false);
    expect(push(scope, fewer, tree(), tabs)).toBe(true);

    // And the scope being cleared entirely.
    scope.clear();
    expect(push(scope, fewer, tree(), tabs)).toBe(true);
    expect(push(scope, fewer, tree(), tabs)).toBe(false);
  });
});

describe("every part of this is inert while the setting is off", () => {
  const off = (state: Record<string, unknown> = { worktreeScope: HERE }) =>
    coordinator({ store: storeOf(state), workbench: false });

  it("hides no tab and offers no chip, whatever is persisted", () => {
    // One gate, so the filter, the chip and the visibility rule cannot disagree
    // about whether scoping is on. `effectiveScope()` is what all three read.
    const scope = off();
    expect(scope.scopedWorktreeId()).toBeNull();
    expect(scope.isScoped()).toBe(false);
    expect(scope.effectiveScope()).toBeUndefined();
  });

  it("says nothing when the scoped worktree leaves the tree", () => {
    // A dropped-scope statement about a feature the user never turned on is an
    // effect of that feature.
    const dropped: string[] = [];
    const scope = coordinator({
      store: storeOf({ worktreeScope: HERE }),
      workbench: false,
      onScopeDropped: (id) => dropped.push(id),
    });
    scope.applyTree(treeOf(worktree({ id: ELSEWHERE })));
    expect(dropped).toEqual([]);
  });

  it("keeps the persisted scope through being off, and applies it the moment it is on", () => {
    const store = storeOf({ worktreeScope: HERE });
    const scope = coordinator({ store, workbench: false });

    // Off: untouched, both in the store and as far as anything drawing is concerned.
    scope.applyTree(treeOf(worktree({ id: HERE, branch: "here" })));
    expect(store.state.worktreeScope).toBe(HERE);
    expect(scope.effectiveScope()).toBeUndefined();

    scope.setWorkbench(true);
    expect(scope.scopedWorktreeId()).toBe(HERE);
    expect(scope.effectiveScope()).toEqual({ worktreeId: HERE, attribution: new Map(), waiting: new Set() });

    // And back off again, without losing it.
    scope.setWorkbench(false);
    expect(scope.isScoped()).toBe(false);
    expect(store.state.worktreeScope).toBe(HERE);
  });

  it("redraws the bar on the flip, in both directions", () => {
    // The scope the signature covers is the EFFECTIVE one, so flipping the flag
    // changes what the bar would draw even though nothing else moved.
    const scope = off();
    const tabs = layouts("tab-1");
    scope.applyTree(treeOf(worktree({ id: HERE, branch: "here" })));
    scope.setAttribution(report(new Map([["tab-1", ELSEWHERE]])));
    expect(ask(scope, tabs)).toBe(true);
    expect(ask(scope, tabs)).toBe(false);

    scope.setWorkbench(true);
    expect(ask(scope, tabs)).toBe(true);
    expect(ask(scope, tabs)).toBe(false);

    scope.setWorkbench(false);
    expect(ask(scope, tabs)).toBe(true);
  });

  it("leaves the unscoped visibility rule intact while off", () => {
    // `isScoped` is the bar's SECOND reason to be visible; off, it never supplies
    // one, so the bar falls back to the tab count exactly as it always did.
    const scope = off();
    scope.applyTree(treeOf(worktree({ id: HERE, branch: "here" })));
    expect(scope.isScoped()).toBe(false);
  });

  it("defaults to off when nothing says otherwise", () => {
    const scope = new TabBarScopeCoordinator({ store: storeOf({ worktreeScope: HERE }) });
    expect(scope.isScoped()).toBe(false);
  });
});

describe("what the chip is told to call the scope", () => {
  it("names the branch the tree last showed, never the path", () => {
    // The panel forbids a path on a row (worktree-panel-ui.md § 3.2) and the chip
    // is no different — it is on screen for exactly the same reason.
    const scope = coordinator({ store: storeOf({ worktreeScope: HERE }) });
    scope.applyTree(treeOf(worktree({ id: HERE, branch: "feat/here" })));
    expect(scope.scopedLabel()).toBe("feat/here");
  });

  it("names the branch from the first selection on, not from the second tree on", () => {
    // `applyTree` used to be the only writer of the label, so the FIRST selection
    // announced whatever the previous scope was called — an absolute path, on a
    // fresh surface — and the second announced the first one's branch (round-1 B1).
    const scope = coordinator({ store: storeOf() });
    scope.applyTree(
      treeOf(worktree({ id: HERE, branch: "feat/here" }), worktree({ id: ELSEWHERE, branch: "feat/away" })),
    );

    scope.select(HERE);
    expect(scope.scopedLabel()).toBe("feat/here");
    scope.select(ELSEWHERE);
    expect(scope.scopedLabel()).toBe("feat/away");
    scope.clear();
    expect(scope.scopedLabel()).toBeNull();
  });

  it("names nothing for a persisted scope no tree has confirmed yet", () => {
    // Nothing is scoped until a tree confirms it, so there is nothing to name.
    expect(coordinator({ store: storeOf({ worktreeScope: HERE }) }).scopedLabel()).toBeNull();
  });

  it("names nothing while unscoped or while the workbench is off", () => {
    expect(coordinator({ store: storeOf() }).scopedLabel()).toBeNull();
    expect(coordinator({ store: storeOf({ worktreeScope: HERE }), workbench: false }).scopedLabel()).toBeNull();
  });
});

describe("round-1: the guard moves for every change the badge would draw", () => {
  it("draws when a LIVE pane joins the waiting set of a tab whose other waiting pane has exited", () => {
    // B2: the coordinator used to count "hidden and waiting" itself, with no way
    // to see an exited pane. It answered 1 for the exited pane alone and 1 again
    // once the live one joined — a byte-identical signature, and the badge's move
    // from 0 to 1 never rendered.
    const split = new Map<string, SplitNode>([
      ["tab-1", createLeaf("tab-1")],
      ["tab-2", createBranch("horizontal", createLeaf("gone"), createLeaf("live"))],
    ]);
    const scope = coordinator({ store: storeOf({ worktreeScope: HERE }) });
    scope.applyTree(treeOf(worktree({ id: HERE, branch: "here" }), worktree({ id: ELSEWHERE, branch: "there" })));
    scope.setAttribution(
      report(
        new Map([
          ["tab-1", HERE],
          ["gone", ELSEWHERE],
          ["live", ELSEWHERE],
        ]),
        ["gone"],
      ),
    );
    ask(scope, split, ["gone"]);

    scope.setAttribution(
      report(
        new Map([
          ["tab-1", HERE],
          ["gone", ELSEWHERE],
          ["live", ELSEWHERE],
        ]),
        ["gone", "live"],
      ),
    );

    expect(ask(scope, split, ["gone"])).toBe(true);
  });
});
