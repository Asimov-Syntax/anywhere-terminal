// The no-op render guard's input. The load-bearing case is the spinner: without
// frame-stripping here, one animating title repaints the whole tree at animation
// rate and destroys scroll position and expansion state.

import { describe, expect, it } from "vitest";
import { agentRow, singleRepoPresence, singleRepoTree } from "./worktreeFixtures";
import { worktreeSignature } from "./worktreeRenderSignature";
import type { WorktreePresence } from "./worktreeViewTypes";

const NOW = 1_700_000_000_000;

function presenceWithTitle(title: string): WorktreePresence {
  return {
    scannedAt: NOW,
    degradedSources: [],
    rowsByWorktreeId: { "/repo": [agentRow({ rowId: "a", agent: "claude", activity: "running", title })] },
  };
}

describe("worktreeSignature", () => {
  it("is empty without a tree", () => {
    expect(worktreeSignature(null, null)).toBe("");
  });

  it("is unchanged by a spinner-only title change", () => {
    expect(worktreeSignature(singleRepoTree(), presenceWithTitle("⠋ Building"))).toBe(
      worktreeSignature(singleRepoTree(), presenceWithTitle("⠙ Building")),
    );
  });

  it("still moves when the real title changes", () => {
    expect(worktreeSignature(singleRepoTree(), presenceWithTitle("⠋ Building"))).not.toBe(
      worktreeSignature(singleRepoTree(), presenceWithTitle("⠋ Testing")),
    );
  });

  it("is stable across a rescan that found nothing new", () => {
    // `scannedAt` moves on every poll; including it would make the guard buy nothing.
    const a = singleRepoPresence(NOW);
    const b = { ...singleRepoPresence(NOW), scannedAt: NOW + 30_000 };
    expect(worktreeSignature(singleRepoTree(), a)).toBe(worktreeSignature(singleRepoTree(), b));
  });

  it("moves on every field a marker reads", () => {
    const base = singleRepoTree();
    const baseline = worktreeSignature(base, null);
    for (const mutate of [
      (t: ReturnType<typeof singleRepoTree>) => {
        const wt = t.repos[0]?.worktrees[0];
        if (wt) {
          wt.locked = true;
        }
      },
      (t: ReturnType<typeof singleRepoTree>) => {
        const wt = t.repos[0]?.worktrees[0];
        if (wt) {
          wt.prunable = true;
        }
      },
      (t: ReturnType<typeof singleRepoTree>) => {
        const wt = t.repos[0]?.worktrees[0];
        if (wt) {
          wt.inWorkspace = false;
        }
      },
      (t: ReturnType<typeof singleRepoTree>) => {
        const repo = t.repos[0];
        if (repo) {
          repo.degraded = "exit 128";
        }
      },
      (t: ReturnType<typeof singleRepoTree>) => {
        t.gitAvailable = false;
      },
      (t: ReturnType<typeof singleRepoTree>) => {
        t.unreadable = { count: 2, reasons: ["EACCES"] };
      },
    ]) {
      const mutated = singleRepoTree();
      mutate(mutated);
      expect(worktreeSignature(mutated, null)).not.toBe(baseline);
    }
  });

  it("moves when a degraded source appears", () => {
    const clean = singleRepoPresence(NOW);
    const degraded: WorktreePresence = {
      ...clean,
      degradedSources: [{ source: "registry", reason: "spawn ENOENT", since: NOW }],
    };
    expect(worktreeSignature(singleRepoTree(), degraded)).not.toBe(worktreeSignature(singleRepoTree(), clean));
  });

  it("moves when any clock the age column can fall back to moves", () => {
    // `ageTimestamp` falls back through lastActivityAt and startedAt, so a row
    // whose only moving timestamp is a fallback would otherwise render a frozen age.
    for (const field of ["lastActivityAt", "startedAt"] as const) {
      const base = singleRepoPresence(NOW);
      const moved = singleRepoPresence(NOW);
      const row = Object.values(moved.rowsByWorktreeId)[0]?.[0];
      if (!row) {
        throw new Error("fixture lost its first row");
      }
      row[field] = NOW - 90_000;
      expect(worktreeSignature(singleRepoTree(), moved)).not.toBe(worktreeSignature(singleRepoTree(), base));
    }
  });

  it("is order-sensitive, because the tree renders in array order", () => {
    const reordered = singleRepoTree();
    const repo = reordered.repos[0];
    if (repo) {
      repo.worktrees.reverse();
    }
    expect(worktreeSignature(reordered, null)).not.toBe(worktreeSignature(singleRepoTree(), null));
  });
});
