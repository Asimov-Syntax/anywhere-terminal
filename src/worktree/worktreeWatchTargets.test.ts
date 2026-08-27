import { describe, expect, it, vi } from "vitest";
import type { PatternSubscription } from "../providers/fsWatcherPool";
import { watchRepoStructure, worktreeWatchTargets } from "./worktreeWatchTargets";

type Handlers = {
  create?: (uri: unknown) => void;
  change?: (uri: unknown) => void;
  delete?: (uri: unknown) => void;
};

interface Call {
  baseDir: string;
  glob: string;
  handlers: Handlers;
}

/** A pool that records every pattern subscription and can fail chosen globs. */
function fakePool(failures: Record<string, string> = {}) {
  const calls: Call[] = [];
  const disposed: string[] = [];
  return {
    calls,
    disposed,
    subscribePattern(baseDir: string, glob: string, handlers: Handlers): PatternSubscription {
      calls.push({ baseDir, glob, handlers });
      const reason = failures[glob];
      return {
        active: reason === undefined,
        ...(reason === undefined ? {} : { failureReason: reason }),
        dispose: () => disposed.push(glob),
      };
    },
  };
}

const REPO = "/repo/.git";

describe("worktreeWatchTargets", () => {
  it("describes exactly the four documented patterns", () => {
    expect(worktreeWatchTargets(REPO)).toEqual([
      { baseDir: REPO, glob: "HEAD", events: ["change"] },
      { baseDir: REPO, glob: "worktrees", events: ["create", "delete"] },
      { baseDir: `${REPO}/worktrees`, glob: "*", events: ["create", "delete"] },
      { baseDir: `${REPO}/worktrees`, glob: "*/HEAD", events: ["change"] },
    ]);
  });

  it("uses at most one recursive watcher, scoped to linked-worktree metadata", () => {
    const recursiveTargets = worktreeWatchTargets(REPO).filter(({ glob }) => glob.includes("**") || glob.includes("/"));

    // VS Code recursively watches patterns with `**` or path segments.
    expect(recursiveTargets).toHaveLength(1);
    expect(recursiveTargets[0]).toEqual({
      baseDir: `${REPO}/worktrees`,
      glob: "*/HEAD",
      events: ["change"],
    });
  });
});

describe("watchRepoStructure", () => {
  it("subscribes all four patterns with the events each one declares", () => {
    const pool = fakePool();

    watchRepoStructure(REPO, pool, () => {});

    expect(pool.calls.map((c) => [c.baseDir, c.glob])).toEqual([
      [REPO, "HEAD"],
      [REPO, "worktrees"],
      [`${REPO}/worktrees`, "*"],
      [`${REPO}/worktrees`, "*/HEAD"],
    ]);
    expect(Object.keys(pool.calls[0].handlers)).toEqual(["change"]);
    expect(Object.keys(pool.calls[1].handlers).sort()).toEqual(["create", "delete"]);
    expect(Object.keys(pool.calls[2].handlers).sort()).toEqual(["create", "delete"]);
    expect(Object.keys(pool.calls[3].handlers)).toEqual(["change"]);
  });

  it("reports a linked worktree added or removed", () => {
    const pool = fakePool();
    const onChanged = vi.fn();

    watchRepoStructure(REPO, pool, onChanged);
    pool.calls[1].handlers.create?.({});
    pool.calls[1].handlers.delete?.({});

    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("reports a branch switch in a linked worktree and in the main worktree", () => {
    const pool = fakePool();
    const onChanged = vi.fn();

    watchRepoStructure(REPO, pool, onChanged);
    // `subscribe()` creates its watcher with `ignoreChange` and would never see
    // either of these — a branch switch rewrites HEAD in place.
    pool.calls[3].handlers.change?.({});
    pool.calls[0].handlers.change?.({});

    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("is watched with no reason when all four subscriptions are live", () => {
    const watch = watchRepoStructure(REPO, fakePool(), () => {});

    expect(watch.failureReason).toBeUndefined();
  });

  it("reports a reason naming every pattern that was never established", () => {
    const pool = fakePool({
      worktrees: "ENOSPC: could not watch /repo/.git/worktrees",
      HEAD: "EMFILE: could not watch /repo/.git/HEAD",
    });

    const watch = watchRepoStructure(REPO, pool, () => {});

    expect(watch.failureReason).toContain("ENOSPC");
    expect(watch.failureReason).toContain("EMFILE");
  });

  it("stays degraded when only one of the four fails", () => {
    const pool = fakePool({ "*/HEAD": "ENOSPC: could not watch /repo/.git/worktrees/*/HEAD" });

    const watch = watchRepoStructure(REPO, pool, () => {});

    // Two live watchers still leave branch switches invisible, so the repo is
    // not honestly "watched".
    expect(watch.failureReason).toContain("ENOSPC");
  });

  it("releases all four subscriptions on one disposal", () => {
    const pool = fakePool();

    watchRepoStructure(REPO, pool, () => {}).dispose();

    expect(pool.disposed).toEqual(["HEAD", "worktrees", "*", "*/HEAD"]);
  });

  it("stops reporting changes once disposed", () => {
    const pool = fakePool();
    const onChanged = vi.fn();

    const watch = watchRepoStructure(REPO, pool, onChanged);
    watch.dispose();
    watch.dispose();
    pool.calls[1].handlers.create?.({});

    expect(onChanged).not.toHaveBeenCalled();
    expect(pool.disposed).toHaveLength(4);
  });
});
