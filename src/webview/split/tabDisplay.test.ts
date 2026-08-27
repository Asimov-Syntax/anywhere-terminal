// A tab is named after the pane it was created from, and that pane can be closed
// while the tab lives on (round-2 B2). Everything here is about that gap.

import { describe, expect, it } from "vitest";
import { createBranch, createLeaf, type SplitNode } from "../SplitModel";
import { resolveTabDisplayPane, type TabDisplayDeps } from "./tabDisplay";

function deps(layouts: Array<[string, SplitNode]>, liveTerminals: string[]): TabDisplayDeps {
  const live = new Set(liveTerminals);
  return { tabLayouts: new Map(layouts), hasTerminal: (id) => live.has(id) };
}

const SPLIT = createBranch("horizontal", createLeaf("t1"), createLeaf("t1-b"));

describe("resolveTabDisplayPane", () => {
  it("prefers the tab's own pane, leaving the ordinary case untouched", () => {
    expect(resolveTabDisplayPane("t1", deps([["t1", SPLIT]], ["t1", "t1-b"]))).toBe("t1");
  });

  it("prefers the tab's own pane even when another live leaf comes first", () => {
    // A split can leave the tab's own pane second in layout order. The resolved
    // pane becomes the fit/focus fallback, so scanning the layout unconditionally
    // would quietly hand that role to a different terminal in the ordinary case.
    const layout = createBranch("horizontal", createLeaf("a"), createLeaf("t1"));
    expect(resolveTabDisplayPane("t1", deps([["t1", layout]], ["a", "t1"]))).toBe("t1");
  });

  it("falls back to a live leaf when the tab's own pane was closed", () => {
    // The whole point: `terminals[tabId]` is gone but the tab still has a pane
    // to show, so it must remain reachable.
    expect(resolveTabDisplayPane("t1", deps([["t1", SPLIT]], ["t1-b"]))).toBe("t1-b");
  });

  it("takes the first live leaf in layout order, not merely any live session", () => {
    const layout = createBranch(
      "vertical",
      createLeaf("t1"),
      createBranch("horizontal", createLeaf("a"), createLeaf("b")),
    );
    expect(resolveTabDisplayPane("t1", deps([["t1", layout]], ["b", "a"]))).toBe("a");
  });

  it("reports nothing when the tab holds no live pane at all", () => {
    expect(resolveTabDisplayPane("t1", deps([["t1", SPLIT]], []))).toBeNull();
  });

  it("reports nothing for a tab with no layout", () => {
    expect(resolveTabDisplayPane("gone", deps([["t1", SPLIT]], ["t1"]))).toBeNull();
  });

  it("does not borrow a live pane from another tab's layout", () => {
    const d = deps(
      [
        ["t1", createLeaf("t1")],
        ["t2", createLeaf("t2")],
      ],
      ["t2"],
    );
    expect(resolveTabDisplayPane("t1", d)).toBeNull();
  });
});
