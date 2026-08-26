// The pane-focus half of a worktree row activation (design.md D4). The case that
// matters is the one round-1 B2 found: a tab whose ROOT pane was closed keeps its
// layout under the same id but loses the terminal the tab switch is keyed on.

import { describe, expect, it } from "vitest";
import { createBranch, createLeaf, type SplitNode } from "../SplitModel";
import { type ActivatePaneDeps, activatePane } from "./activatePane";

/** `displayableTabs` holds TAB ids, not session ids — in main.ts this predicate is
 *  `resolveTabDisplayPane(tabId) !== null`, which is true for a tab that lost the
 *  pane it was named after but kept a live leaf (round-2 B2). */
function harness(
  layouts: Array<[string, SplitNode]>,
  displayableTabs: string[],
): { deps: ActivatePaneDeps; log: string[] } {
  const live = new Set(displayableTabs);
  const log: string[] = [];
  return {
    log,
    deps: {
      tabLayouts: new Map(layouts),
      canDisplayTab: (id) => live.has(id),
      setActivePane: (tabId, paneId) => log.push(`active:${tabId}=${paneId}`),
      persist: () => log.push("persist"),
      showTab: (tabId) => log.push(`show:${tabId}`),
      updateActivePaneVisual: (tabId) => log.push(`visual:${tabId}`),
      focusPane: (paneId) => log.push(`focus:${paneId}`),
    },
  };
}

const SPLIT = createBranch("horizontal", createLeaf("t1"), createLeaf("t1-b"));

describe("activatePane", () => {
  it("makes a leaf the owning tab's active pane before showing it", () => {
    // Showing the tab first would bring it forward on whichever pane was last
    // active there, which is not the row the user clicked.
    const { deps, log } = harness([["t1", SPLIT]], ["t1"]);
    expect(activatePane("t1-b", deps)).toBe(true);
    expect(log).toEqual(["active:t1=t1-b", "persist", "show:t1", "visual:t1", "focus:t1-b"]);
  });

  it("activates a tab that is its own single pane", () => {
    const { deps, log } = harness([["t1", createLeaf("t1")]], ["t1"]);
    expect(activatePane("t1", deps)).toBe(true);
    expect(log).toContain("show:t1");
  });

  it("searches every tab, not only the first", () => {
    const { deps, log } = harness(
      [
        ["t1", createLeaf("t1")],
        ["t2", SPLIT],
      ],
      ["t1", "t2"],
    );
    expect(activatePane("t1-b", deps)).toBe(true);
    expect(log).toContain("show:t2");
  });

  it("activates a pane in a tab that lost the pane it was named after", () => {
    // Closing a split's root pane deletes `terminals[tabId]` while `tabLayouts`
    // keeps the tab and its remaining live leaves. Round 1 reported this as a
    // failure; round-2 B2 is that the pane must actually come forward, because
    // the tab is displayable through the leaf that survived.
    const { deps, log } = harness([["t1", SPLIT]], ["t1"]);
    expect(activatePane("t1-b", deps)).toBe(true);
    expect(log).toEqual(["active:t1=t1-b", "persist", "show:t1", "visual:t1", "focus:t1-b"]);
  });

  it("reports failure, and changes nothing, when the tab holds no live pane at all", () => {
    const { deps, log } = harness([["t1", SPLIT]], []);
    expect(activatePane("t1-b", deps)).toBe(false);
    expect(log).toEqual([]);
  });

  it("reports failure for a pane no tab holds", () => {
    const { deps, log } = harness([["t1", SPLIT]], ["t1"]);
    expect(activatePane("gone", deps)).toBe(false);
    expect(log).toEqual([]);
  });

  it("reports failure when there are no tabs at all", () => {
    const { deps } = harness([], []);
    expect(activatePane("t1", deps)).toBe(false);
  });
});
