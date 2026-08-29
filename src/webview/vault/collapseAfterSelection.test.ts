// @vitest-environment jsdom
//
// The gate on the after-selection collapse. Extracted from the bootstrap so the
// three conditions can be verified at all — see the module comment.

import { describe, expect, it } from "vitest";
import { isStackedLayout, shouldCollapseAfterSelection } from "./collapseAfterSelection";

function layoutWith(className: string): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  return el;
}

describe("[2_1] the rollout is read live, in both directions", () => {
  const stacked = () => layoutWith("file-tree--bottom");

  it("collapses once the rollout is on", () => {
    expect(shouldCollapseAfterSelection({ worktreeId: "wt-1", layout: stacked() })).toBe(true);
  });
});

describe("[2_1] what else has to hold", () => {
  it("treats a cleared scope as not a selection", () => {
    const args = { worktreeId: null, layout: layoutWith("file-tree--top") };
    expect(shouldCollapseAfterSelection(args)).toBe(false);
  });

  it("leaves a docked rail open", () => {
    for (const side of ["file-tree--left", "file-tree--right"]) {
      const args = { worktreeId: "wt-1", layout: layoutWith(side) };
      expect(shouldCollapseAfterSelection(args), `${side} collapsed the rail`).toBe(false);
    }
  });

  it("does nothing when there is no layout element to read", () => {
    expect(shouldCollapseAfterSelection({ worktreeId: "wt-1", layout: null })).toBe(false);
  });

  it("knows which layouts stack", () => {
    expect(isStackedLayout(layoutWith("file-tree--top"))).toBe(true);
    expect(isStackedLayout(layoutWith("file-tree--bottom"))).toBe(true);
    expect(isStackedLayout(layoutWith("file-tree--left"))).toBe(false);
  });
});
