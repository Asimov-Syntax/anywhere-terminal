import { describe, expect, it } from "vitest";
import {
  type ResolutionWorktree,
  reportableDisposition,
  resolveSelection,
  type SelectionFacts,
} from "./createResolution";

function wt(displayPath: string, over: Partial<ResolutionWorktree> = {}): ResolutionWorktree {
  return { displayPath, bare: false, detached: false, prunable: false, ...over };
}

function facts(over: Partial<SelectionFacts> = {}): SelectionFacts {
  return { query: "feat/search", refs: [], worktrees: [], ...over };
}

describe("resolveSelection", () => {
  it("a name no branch carries is a fresh create", () => {
    expect(resolveSelection(facts({ refs: [{ name: "main" }] })).mode).toEqual({ kind: "fresh" });
  });

  it("an existing branch nothing holds is reused, not duplicated", () => {
    // The failure this task deletes: creating `feat/search-2` beside a
    // `feat/search` that already exists and that nobody is using.
    const read = resolveSelection(facts({ refs: [{ name: "feat/search" }] }));

    expect(read.mode).toEqual({ kind: "reuse" });
    expect(read.blockedBy).toBeUndefined();
  });

  it("a branch a live worktree holds is blocked, and names the holder's PATH", () => {
    const read = resolveSelection(
      facts({
        refs: [{ name: "feat/search", heldBy: "search-spike" }],
        worktrees: [wt("/wt/search-spike", { branch: "feat/search" })],
      }),
    );

    expect(read.blockedBy).toEqual({ ownerPath: "/wt/search-spike" });
  });

  it("a branch only a PRUNABLE worktree holds is not blocked", () => {
    // That registration is exactly what a repair fixes. Treating it as a live
    // claim would refuse the one action that resolves it.
    const read = resolveSelection(
      facts({
        refs: [{ name: "feat/search" }],
        worktrees: [wt("/wt/stale", { branch: "feat/search", prunable: true })],
      }),
    );

    expect(read.blockedBy).toBeUndefined();
    expect(read.mode).toEqual({ kind: "reattachCandidate", repairPath: "/wt/stale" });
  });

  it("a live holder beside a prunable one still blocks", () => {
    // git permits one worktree per branch, so this is a listing mid-prune. The
    // live claim is the one that decides, because git will refuse regardless.
    const read = resolveSelection(
      facts({
        refs: [{ name: "feat/search" }],
        worktrees: [
          wt("/wt/stale", { branch: "feat/search", prunable: true }),
          wt("/wt/live", { branch: "feat/search" }),
        ],
      }),
    );

    expect(read.blockedBy).toEqual({ ownerPath: "/wt/live" });
    expect(read.mode).toEqual({ kind: "reuse" });
  });

  it("a bare or detached worktree holds no branch", () => {
    const read = resolveSelection(
      facts({
        refs: [{ name: "feat/search" }],
        worktrees: [
          wt("/repo/bare", { bare: true, branch: "feat/search" }),
          wt("/wt/spike", { detached: true, branch: "feat/search" }),
        ],
      }),
    );

    expect(read.blockedBy).toBeUndefined();
    expect(read.mode).toEqual({ kind: "reuse" });
  });

  it("nothing typed resolves nothing rather than guessing a mode", () => {
    expect(resolveSelection(facts({ query: "   ", refs: [{ name: "main" }] })).mode).toEqual({ kind: "none" });
  });

  it("surrounding whitespace does not make an existing branch look new", () => {
    expect(resolveSelection(facts({ query: "  feat/search  ", refs: [{ name: "feat/search" }] })).mode).toEqual({
      kind: "reuse",
    });
  });
});

describe("reportableDisposition", () => {
  it("drops the authorization a debris disposition carries", () => {
    // A probe goes out on every settled edit. An answer carrying a delete
    // authorization would hand one out for a removal nobody confirmed.
    const reported = reportableDisposition({
      kind: "debris",
      authorization: { path: "/wt/junk", fingerprint: "fp-1" },
    });

    expect(reported).toEqual({ kind: "debris" });
    expect(Object.hasOwn(reported, "authorization")).toBe(false);
  });

  it("a free destination stays free", () => {
    expect(reportableDisposition({ kind: "free" })).toEqual({ kind: "free" });
  });
});
