import { describe, expect, it } from "vitest";
import type { WorktreeInfo } from "./types";
import { orderWorktrees } from "./worktreeOrder";

function wt(id: string, over: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    id,
    displayPath: id,
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

const ids = (list: WorktreeInfo[]) => list.map((w) => w.id);

describe("orderWorktrees", () => {
  it("puts the main worktree first even when it sorts last by every other key", () => {
    const input = [wt("/a", { branch: "aaa" }), wt("/z", { kind: "main", branch: "zzz", missing: true })];
    expect(ids(orderWorktrees(input))).toEqual(["/z", "/a"]);
  });

  it("orders unranked worktrees by branch, case-insensitively", () => {
    const input = [wt("/c", { branch: "Charlie" }), wt("/a", { branch: "alpha" }), wt("/b", { branch: "Bravo" })];
    expect(ids(orderWorktrees(input))).toEqual(["/a", "/b", "/c"]);
  });

  it("breaks an equal branch on id", () => {
    const input = [wt("/z", { branch: "same" }), wt("/a", { branch: "same" })];
    expect(ids(orderWorktrees(input))).toEqual(["/a", "/z"]);
  });

  it("ranks active worktrees ahead of the rest, most recent first", () => {
    const input = [wt("/idle", { branch: "aaa" }), wt("/old", { branch: "zzz" }), wt("/new", { branch: "zzz" })];
    const rank = (id: string) => ({ "/old": 10, "/new": 20 })[id];
    expect(ids(orderWorktrees(input, rank))).toEqual(["/new", "/old", "/idle"]);
  });

  it("treats every worktree as unranked when no rank is supplied", () => {
    const input = [wt("/b", { branch: "bbb" }), wt("/a", { branch: "aaa" })];
    expect(ids(orderWorktrees(input))).toEqual(["/a", "/b"]);
  });

  it("sorts missing and prunable last within their bucket", () => {
    const input = [
      wt("/gone", { branch: "aaa", missing: true }),
      wt("/stale", { branch: "aab", prunable: true }),
      wt("/live", { branch: "zzz" }),
    ];
    expect(ids(orderWorktrees(input))).toEqual(["/live", "/gone", "/stale"]);
  });

  it("keeps a missing worktree inside its own bucket rather than demoting it past unranked ones", () => {
    const input = [wt("/ranked-gone", { branch: "aaa", missing: true }), wt("/plain", { branch: "aaa" })];
    const rank = (id: string) => (id === "/ranked-gone" ? 5 : undefined);
    expect(ids(orderWorktrees(input, rank))).toEqual(["/ranked-gone", "/plain"]);
  });

  it("orders a detached worktree, which has no branch, by id", () => {
    const input = [wt("/z", { detached: true }), wt("/a", { detached: true })];
    expect(ids(orderWorktrees(input))).toEqual(["/a", "/z"]);
  });

  it("produces one order regardless of input order", () => {
    const base = [
      wt("/m", { kind: "main", branch: "main" }),
      wt("/b", { branch: "bravo" }),
      wt("/a", { branch: "alpha" }),
      wt("/x", { branch: "alpha", missing: true }),
    ];
    const expected = ids(orderWorktrees(base));
    const shuffles = [
      [base[3], base[1], base[0], base[2]],
      [base[2], base[3], base[1], base[0]],
      [base[1], base[0], base[3], base[2]],
    ];
    for (const shuffled of shuffles) {
      expect(ids(orderWorktrees(shuffled))).toEqual(expected);
    }
  });

  it("does not mutate its input", () => {
    const input = [wt("/b", { branch: "bbb" }), wt("/a", { branch: "aaa" })];
    orderWorktrees(input);
    expect(ids(input)).toEqual(["/b", "/a"]);
  });
});
