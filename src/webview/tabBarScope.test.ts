// src/webview/tabBarScope.test.ts — the surface's tab-bar scope.
//
// Covers what design.md D1 / D7 / D8 / D9 leave to the implementation: what a
// reload restores, what a tree that moved does to a scope, what a failed write
// does, and what does NOT count as a reason to redraw.

import { describe, expect, it, vi } from "vitest";
import { createBranch, createLeaf, type SplitNode } from "./SplitModel";
import { TabBarScopeCoordinator, type TabBarScopeStore } from "./tabBarScope";
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

const layouts = (...ids: string[]): Map<string, SplitNode> => new Map(ids.map((id) => [id, createLeaf(id)]));

describe("what a reload restores", () => {
  it("restores a scope the tree still holds", () => {
    const scope = new TabBarScopeCoordinator({ store: storeOf({ worktreeScope: HERE }) });
    scope.applyTree(treeOf(worktree({ id: HERE, branch: "here" })));
    expect(scope.scopedWorktreeId()).toBe(HERE);
    expect(scope.isScoped()).toBe(true);
  });

  it("lands unscoped on an absent, a non-string, and an empty stored value", () => {
    // Fails OPEN: the stored object is cast structurally rather than validated, so
    // anything that is not a worktree id is not a scope. Failing closed would leave
    // a surface filtered by something it could not read (design.md D9).
    for (const stored of [undefined, 42, {}, [], true, null, ""]) {
      const scope = new TabBarScopeCoordinator({ store: storeOf({ worktreeScope: stored }) });
      expect(scope.scopedWorktreeId(), `stored: ${JSON.stringify(stored)}`).toBeNull();
      expect(scope.effectiveScope()).toBeUndefined();
    }
  });

  it("lands unscoped when the read itself throws", () => {
    const scope = new TabBarScopeCoordinator({
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
    const scope = new TabBarScopeCoordinator({ store, onScopeDropped: (id, label) => dropped.push([id, label]) });

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
    const scope = new TabBarScopeCoordinator({
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
    const scope = new TabBarScopeCoordinator({ store, onScopeDropped: (id, label) => dropped.push([id, label]) });

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
    const scope = new TabBarScopeCoordinator({
      store: storeOf({ worktreeScope: HERE }),
      onScopeDropped: (id) => dropped.push(id),
    });
    scope.applyTree(null);
    expect(scope.scopedWorktreeId()).toBe(HERE);
    scope.clear();
    scope.applyTree(treeOf());
    expect(dropped).toEqual([]);
  });
});

describe("what the surface writes", () => {
  it("preserves every unrelated key across a scope write", () => {
    const store = storeOf({ vaultView: "worktree", worktreeCollapsed: ["/a"], worktreeExpandedRows: ["r1"] });
    const scope = new TabBarScopeCoordinator({ store });

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
    const scope = new TabBarScopeCoordinator({ store });

    scope.select(HERE);
    scope.select(HERE);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it("lets a failed write throw, leaving the previous scope standing", () => {
    // The wrapper promises no transactionality and no recovery. Recording a scope
    // the surface could not persist would be the lie; the old one is a legal state
    // (design.md D9).
    let armed = false;
    const scope = new TabBarScopeCoordinator({
      store: {
        getState: () => ({ worktreeScope: HERE }),
        updateState: () => {
          if (armed) {
            throw new Error("setState failed");
          }
        },
      },
    });
    armed = true;
    expect(() => scope.select(ELSEWHERE)).toThrow("setState failed");
    expect(scope.scopedWorktreeId()).toBe(HERE);
  });
});

describe("what counts as a reason to redraw", () => {
  const scoped = () => {
    const s = new TabBarScopeCoordinator({ store: storeOf({ worktreeScope: HERE }) });
    s.setAttribution(new Map([["pane-1", HERE]]));
    s.shouldRender(layouts("tab-1"));
    return s;
  };

  it("draws once on the first ask and never again for the same state", () => {
    const scope = scoped();
    expect(scope.shouldRender(layouts("tab-1"))).toBe(false);
    expect(scope.shouldRender(layouts("tab-1"))).toBe(false);
  });

  it("draws once for an attribution that moved a pane, and once for a changed scope", () => {
    const scope = scoped();
    scope.setAttribution(new Map([["pane-1", ELSEWHERE]]));
    expect(scope.shouldRender(layouts("tab-1"))).toBe(true);
    expect(scope.shouldRender(layouts("tab-1"))).toBe(false);

    scope.select(ELSEWHERE);
    expect(scope.shouldRender(layouts("tab-1"))).toBe(true);
    expect(scope.shouldRender(layouts("tab-1"))).toBe(false);
  });

  it("ignores the order the attribution arrived in", () => {
    const scope = scoped();
    scope.setAttribution(
      new Map([
        ["pane-2", ELSEWHERE],
        ["pane-1", HERE],
      ]),
    );
    expect(scope.shouldRender(layouts("tab-1"))).toBe(true);

    scope.setAttribution(
      new Map([
        ["pane-1", HERE],
        ["pane-2", ELSEWHERE],
      ]),
    );
    expect(scope.shouldRender(layouts("tab-1"))).toBe(false);
  });

  it("draws when a split gains or loses a leaf", () => {
    // Membership decides which panes a tab is judged by, so the join keeps the
    // old answer unless the signature notices.
    const scope = scoped();
    const split = new Map<string, SplitNode>([
      ["tab-1", createBranch("horizontal", createLeaf("tab-1"), createLeaf("pane-2"))],
    ]);
    expect(scope.shouldRender(split)).toBe(true);
    expect(scope.shouldRender(split)).toBe(false);
    expect(scope.shouldRender(layouts("tab-1"))).toBe(true);
  });
});
