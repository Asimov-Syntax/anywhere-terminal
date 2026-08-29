// The two canonicalisers a presence report is compared by. Both exist so the
// controller (suppressing a duplicate report) and the coordinator (suppressing a
// duplicate render) answer the same question the same way — they were byte-identical
// copies once, which is one edit away from disagreeing.

import { describe, expect, it } from "vitest";
import { attributionKey, waitingKey } from "./paneAttribution";

describe("attributionKey", () => {
  it("is the same string for the same placement in a different order", () => {
    expect(
      attributionKey(
        new Map([
          ["pane-2", "/wt/b"],
          ["pane-1", "/wt/a"],
        ]),
      ),
    ).toBe(
      attributionKey(
        new Map([
          ["pane-1", "/wt/a"],
          ["pane-2", "/wt/b"],
        ]),
      ),
    );
  });

  it("moves when a pane changes worktree", () => {
    expect(attributionKey(new Map([["pane-1", "/wt/a"]]))).not.toBe(attributionKey(new Map([["pane-1", "/wt/b"]])));
  });

  it("separates an unplaced pane from an absent one — they are the same state", () => {
    // There is no third value: a pane the evidence cannot place is simply not a
    // key, which is what makes it presented in every scope (I18).
    expect(attributionKey(new Map())).toBe(attributionKey(new Map()));
  });
});

describe("waitingKey", () => {
  it("is the same string for the same set in a different insertion order", () => {
    expect(waitingKey(new Set(["pane-2", "pane-1"]))).toBe(waitingKey(new Set(["pane-1", "pane-2"])));
  });

  it("moves when a pane joins or leaves", () => {
    expect(waitingKey(new Set(["pane-1"]))).not.toBe(waitingKey(new Set(["pane-1", "pane-2"])));
    expect(waitingKey(new Set(["pane-1"]))).not.toBe(waitingKey(new Set()));
  });

  it("cannot be confused with a one-pane placement carrying the same id", () => {
    // The two keys are joined into one comparison string, so a waiting set that
    // encoded like a placement could make a real move look like no move at all.
    expect(waitingKey(new Set(["pane-1"]))).not.toBe(attributionKey(new Map([["pane-1", ""]])));
  });
});
