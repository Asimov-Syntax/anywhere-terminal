import { describe, expect, it, vi } from "vitest";
import { createGitCapabilities } from "./gitCapabilities";
import type { GitCommandResult, GitCommandRunner } from "./gitCommandRunner";
import { listRepoWorktrees, PRUNABLE_PROBE_CONCURRENCY } from "./WorktreeDiscovery";

function res(over: Partial<GitCommandResult> = {}): GitCommandResult {
  return { code: 0, stdout: Buffer.alloc(0), stderr: "", timedOut: false, failedToSpawn: false, ...over };
}

function nul(...records: string[][]): Buffer {
  return Buffer.from(records.map((f) => `${f.map((x) => `${x}\0`).join("")}\0`).join(""));
}

function lineForm(...records: string[][]): string {
  return `${records.map((f) => `${f.join("\n")}\n`).join("\n")}\n`;
}

const MAIN = ["worktree /repo", "HEAD abc", "branch refs/heads/main"];
const FEAT = ["worktree /repo-wt/feat", "HEAD def", "branch refs/heads/feat"];

/** Runner that answers the `-z` listing and the line-delimited listing. */
function makeRunner(z: GitCommandResult, plain: GitCommandResult = res()) {
  const run = vi.fn(async (args: readonly string[]) => (args.includes("-z") ? z : plain));
  return { runner: { run } as unknown as GitCommandRunner, run };
}

function deps(runner: GitCommandRunner, over: Partial<Parameters<typeof listRepoWorktrees>[1]> = {}) {
  return {
    runner,
    capabilities: createGitCapabilities(runner),
    normalize: async (p: string) => p,
    stat: async () => undefined,
    ...over,
  };
}

describe("listRepoWorktrees", () => {
  it("lists each worktree once and marks the first main", async () => {
    const { runner } = makeRunner(res({ stdout: nul(MAIN, FEAT) }));
    const listing = await listRepoWorktrees("/repo", deps(runner));
    expect(listing.degraded).toBeUndefined();
    expect(listing.worktrees.map((w) => w.id)).toEqual(["/repo", "/repo-wt/feat"]);
    expect(listing.worktrees[0].kind).toBe("main");
    expect(listing.worktrees[1].kind).toBe("linked");
  });

  it("keeps git's exact string as displayPath while id is normalized", async () => {
    const { runner } = makeRunner(res({ stdout: nul(["worktree /var/repo", "HEAD abc"]) }));
    const listing = await listRepoWorktrees("/repo", deps(runner, { normalize: async () => "/private/var/repo" }));
    expect(listing.worktrees[0].id).toBe("/private/var/repo");
    expect(listing.worktrees[0].displayPath).toBe("/var/repo");
  });

  // design.md D7 / research § 1: exit 129 is the `-z` rejection signal.
  it("falls back to the line-delimited listing when -z is rejected", async () => {
    const { runner, run } = makeRunner(
      res({ code: 129, stderr: "unknown switch `z'" }),
      res({ stdout: Buffer.from(lineForm(MAIN, FEAT)) }),
    );
    const listing = await listRepoWorktrees("/repo", deps(runner));
    expect(listing.worktrees.map((w) => w.id)).toEqual(["/repo", "/repo-wt/feat"]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("remembers the -z rejection so a second listing skips it", async () => {
    const { runner, run } = makeRunner(
      res({ code: 129, stderr: "unknown switch `z'" }),
      res({ stdout: Buffer.from(lineForm(MAIN)) }),
    );
    const shared = deps(runner);
    await listRepoWorktrees("/repo", shared);
    await listRepoWorktrees("/repo", shared);
    expect(run.mock.calls.filter((c) => c[0].includes("-z"))).toHaveLength(1);
  });

  it("degrades the repo with a reason when the listing fails", async () => {
    const { runner } = makeRunner(
      res({ code: 128, stderr: "fatal: not a git repository" }),
      res({ code: 128, stderr: "fatal: not a git repository" }),
    );
    const listing = await listRepoWorktrees("/repo", deps(runner));
    expect(listing.worktrees).toEqual([]);
    expect(listing.degraded).toMatch(/not a git repository/);
  });

  it("degrades on a timeout rather than throwing", async () => {
    const timedOut = res({ code: -1, timedOut: true, stderr: "" });
    const { runner } = makeRunner(timedOut, timedOut);
    const listing = await listRepoWorktrees("/repo", deps(runner));
    expect(listing.degraded).toMatch(/timed out/i);
  });

  it("propagates parser reasons for an ambiguous record", async () => {
    const bad = "worktree /repo/we\nird\nHEAD abc\n\n";
    const { runner } = makeRunner(res({ code: 129, stderr: "unknown switch `z'" }), res({ stdout: Buffer.from(bad) }));
    const listing = await listRepoWorktrees("/repo", deps(runner));
    expect(listing.worktrees).toEqual([]);
    expect(listing.reasons).toHaveLength(1);
  });

  it("skips and reports a path that cannot be normalized", async () => {
    const { runner } = makeRunner(res({ stdout: nul(MAIN, FEAT) }));
    const normalize = async (p: string) => (p === "/repo-wt/feat" ? null : p);
    const listing = await listRepoWorktrees("/repo", deps(runner, { normalize }));
    expect(listing.worktrees.map((w) => w.id)).toEqual(["/repo"]);
    expect(listing.reasons).toHaveLength(1);
  });
});

describe("listRepoWorktrees — missing probe", () => {
  const enoent = () => {
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    throw err;
  };

  it("marks a prunable linked worktree missing when its directory is gone", async () => {
    const { runner } = makeRunner(
      res({ stdout: nul(MAIN, [...FEAT, "prunable gitdir file points to non-existent location"]) }),
    );
    const listing = await listRepoWorktrees("/repo", deps(runner, { stat: async () => enoent() }));
    expect(listing.worktrees[1]).toMatchObject({ prunable: true, missing: true });
  });

  it("never probes a locked worktree, so a lock keeps missing false", async () => {
    const stat = vi.fn(async () => undefined);
    const { runner } = makeRunner(res({ stdout: nul(MAIN, [...FEAT, "prunable stale", "locked on removable media"]) }));
    const listing = await listRepoWorktrees("/repo", deps(runner, { stat }));
    expect(listing.worktrees[1]).toMatchObject({ locked: true, missing: false });
    expect(stat).not.toHaveBeenCalled();
  });

  it("never probes the main worktree", async () => {
    const stat = vi.fn(async () => undefined);
    const { runner } = makeRunner(res({ stdout: nul([...MAIN, "prunable stale"]) }));
    await listRepoWorktrees("/repo", deps(runner, { stat }));
    expect(stat).not.toHaveBeenCalled();
  });

  it("does not probe a worktree git did not flag prunable", async () => {
    const stat = vi.fn(async () => undefined);
    const { runner } = makeRunner(res({ stdout: nul(MAIN, FEAT) }));
    const listing = await listRepoWorktrees("/repo", deps(runner, { stat }));
    expect(stat).not.toHaveBeenCalled();
    expect(listing.worktrees[1].missing).toBe(false);
  });

  it("leaves missing false when the directory is still there", async () => {
    const { runner } = makeRunner(res({ stdout: nul(MAIN, [...FEAT, "prunable stale"]) }));
    const listing = await listRepoWorktrees("/repo", deps(runner, { stat: async () => undefined }));
    expect(listing.worktrees[1]).toMatchObject({ prunable: true, missing: false });
  });

  it("bounds probe concurrency", async () => {
    const records = Array.from({ length: 30 }, (_, i) => [
      `worktree /wt/${i}`,
      "HEAD abc",
      `branch refs/heads/b${i}`,
      "prunable stale",
    ]);
    let inFlight = 0;
    let peak = 0;
    const stat = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
    };
    const { runner } = makeRunner(res({ stdout: nul(MAIN, ...records) }));
    await listRepoWorktrees("/repo", deps(runner, { stat }));
    expect(peak).toBeLessThanOrEqual(PRUNABLE_PROBE_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
  });
});

// Round-1 review W1, W3.
describe("listRepoWorktrees — probe failure classification", () => {
  function failWith(code: string) {
    return async () => {
      const error = new Error(code) as NodeJS.ErrnoException;
      error.code = code;
      throw error;
    };
  }

  const prunableFeat = () => res({ stdout: nul(MAIN, [...FEAT, "prunable stale"]) });

  it("marks missing for ENOTDIR as well as ENOENT", async () => {
    const { runner } = makeRunner(prunableFeat());
    const listing = await listRepoWorktrees("/repo", deps(runner, { stat: failWith("ENOTDIR") }));
    expect(listing.worktrees[1].missing).toBe(true);
  });

  it("leaves missing false when the probe fails for a reason other than absence", async () => {
    const { runner } = makeRunner(prunableFeat());
    const listing = await listRepoWorktrees("/repo", deps(runner, { stat: failWith("EACCES") }));
    expect(listing.worktrees[1]).toMatchObject({ prunable: true, missing: false });
  });

  it("leaves missing false when the probe rejects without an error code", async () => {
    const { runner } = makeRunner(prunableFeat());
    const listing = await listRepoWorktrees(
      "/repo",
      deps(runner, { stat: async () => Promise.reject(new Error("x")) }),
    );
    expect(listing.worktrees[1].missing).toBe(false);
  });
});

describe("listRepoWorktrees — skipped count", () => {
  it("counts each skipped record even when the reason repeats", async () => {
    const bad = "worktree /repo/a\nstray\n\nworktree /repo/b\nstray\n\n";
    const { runner } = makeRunner(res({ code: 129, stderr: "unknown switch `z'" }), res({ stdout: Buffer.from(bad) }));
    const listing = await listRepoWorktrees("/repo", deps(runner));
    expect(listing.reasons).toHaveLength(1);
    expect(listing.skipped).toBe(2);
  });

  it("counts a path that cannot be normalized", async () => {
    const { runner } = makeRunner(res({ stdout: nul(MAIN, FEAT) }));
    const normalize = async (p: string) => (p === "/repo-wt/feat" ? null : p);
    const listing = await listRepoWorktrees("/repo", deps(runner, { normalize }));
    expect(listing.skipped).toBe(1);
  });

  it("reports zero skipped for a clean listing", async () => {
    const { runner } = makeRunner(res({ stdout: nul(MAIN, FEAT) }));
    expect((await listRepoWorktrees("/repo", deps(runner))).skipped).toBe(0);
  });
});
