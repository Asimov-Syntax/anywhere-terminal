import { describe, expect, it, vi } from "vitest";
import { createGitCapabilities } from "./gitCapabilities";
import type { GitCommandResult, GitCommandRunner } from "./gitCommandRunner";
import type { GitApiAccessor } from "./repoRoots";
import { buildWorktreeTree } from "./WorktreeDiscovery";

function res(over: Partial<GitCommandResult> = {}): GitCommandResult {
  return { code: 0, stdout: Buffer.alloc(0), stderr: "", timedOut: false, failedToSpawn: false, ...over };
}

function nul(...records: string[][]): Buffer {
  return Buffer.from(records.map((f) => `${f.map((x) => `${x}\0`).join("")}\0`).join(""));
}

type Reply = Partial<GitCommandResult>;

/** Runner keyed on `<cwd>|<command>`, where command is the first two args. */
function makeRunner(table: Record<string, Reply>, version = "git version 2.50.1\n") {
  const run = vi.fn(async (args: readonly string[], cwd: string): Promise<GitCommandResult> => {
    if (args[0] === "--version") {
      return res({ stdout: Buffer.from(version), ...table["*|--version"] });
    }
    const key = args[0] === "worktree" ? "worktree-list" : "common-dir";
    const reply = table[`${cwd}|${key}`];
    if (!reply) {
      return res({ code: 128, stderr: "fatal: not a git repository" });
    }
    return res(reply);
  });
  return { runner: { run } as unknown as GitCommandRunner, run };
}

const api =
  (roots: string[]): GitApiAccessor =>
  () =>
    ({
      state: "initialized",
      repositories: roots.map((fsPath) => ({ rootUri: { fsPath } })),
    }) as ReturnType<GitApiAccessor>;

function deps(runner: GitCommandRunner, over: Record<string, unknown> = {}) {
  return {
    runner,
    capabilities: createGitCapabilities(runner),
    normalize: async (p: string) => p.replace(/\/+$/, "") || "/",
    stat: async () => undefined,
    ...over,
  } as Parameters<typeof buildWorktreeTree>[1];
}

const MAIN = ["worktree /repo", "HEAD abc", "branch refs/heads/main"];
const FEAT = ["worktree /repo-wt/feat", "HEAD def", "branch refs/heads/feat"];

function registration(ino: number) {
  return {
    path: "/repo/.git",
    platform: "darwin" as const,
    components: [{ path: "/repo/.git", identity: { dev: 1, ino } }],
  };
}

describe("buildWorktreeTree — git availability", () => {
  it("returns an empty tree for a workspace with no folders, without shelling out", async () => {
    const { runner, run } = makeRunner({});
    const tree = await buildWorktreeTree([], deps(runner));
    expect(tree).toEqual({ repos: [], unreadable: { count: 0, reasons: [] }, gitAvailable: true });
    expect(run).not.toHaveBeenCalled();
  });

  it("reports git as unavailable when it cannot be spawned, without throwing", async () => {
    const { runner } = makeRunner({ "*|--version": { failedToSpawn: true, code: -1 } });
    const tree = await buildWorktreeTree(["/repo"], deps(runner));
    expect(tree.gitAvailable).toBe(false);
    expect(tree.repos).toEqual([]);
    expect(tree.unreadable.reasons.join(" ")).toMatch(/git/i);
  });

  it("reports a git below the floor as unavailable with its version", async () => {
    const { runner } = makeRunner({}, "git version 2.30.2\n");
    const tree = await buildWorktreeTree(["/repo"], deps(runner));
    expect(tree.gitAvailable).toBe(false);
    expect(tree.unreadable.reasons.join(" ")).toMatch(/2\.31/);
  });
});

describe("buildWorktreeTree — grouping", () => {
  it("builds one group per repo in workspace-folder order", async () => {
    const { runner } = makeRunner({
      "/a|common-dir": { stdout: Buffer.from("/a/.git\n") },
      "/a|worktree-list": { stdout: nul(["worktree /a", "HEAD abc", "branch refs/heads/main"]) },
      "/b|common-dir": { stdout: Buffer.from("/b/.git\n") },
      "/b|worktree-list": { stdout: nul(["worktree /b", "HEAD abc", "branch refs/heads/main"]) },
    });
    const tree = await buildWorktreeTree(["/a", "/b"], deps(runner, { getGitApi: api(["/a", "/b"]) }));
    expect(tree.repos.map((r) => r.repoId)).toEqual(["/a/.git", "/b/.git"]);
    expect(tree.repos[0].label).toBe("a");
    expect(tree.repos[0].mainPath).toBe("/a");
  });

  it("degrades rows when the common-directory registration changes during listing", async () => {
    const { runner } = makeRunner({
      "/repo|common-dir": { stdout: Buffer.from("/repo/.git\n") },
      "/repo|worktree-list": { stdout: nul(MAIN) },
    });
    const authorizations = [registration(1), registration(2)];

    const tree = await buildWorktreeTree(
      ["/repo"],
      deps(runner, {
        getGitApi: api(["/repo"]),
        authorizeCommonDirectory: async () => authorizations.shift(),
      }),
    );

    expect(tree.repos[0].worktrees).toEqual([]);
    expect(tree.repos[0].degraded).toMatch(/registration changed/i);
  });

  it("orders worktrees with the main first", async () => {
    const { runner } = makeRunner({
      "/repo|common-dir": { stdout: Buffer.from("/repo/.git\n") },
      "/repo|worktree-list": { stdout: nul(FEAT, MAIN) },
    });
    const tree = await buildWorktreeTree(["/repo"], deps(runner, { getGitApi: api(["/repo"]) }));
    // git listed feat first, so feat parses as "main"; ordering still puts it first.
    expect(tree.repos[0].worktrees[0].kind).toBe("main");
  });

  it("renders a bare main repo", async () => {
    const { runner } = makeRunner({
      "/repo|common-dir": { stdout: Buffer.from("/repo/.git\n") },
      "/repo|worktree-list": { stdout: nul(["worktree /repo", "bare"]) },
    });
    const tree = await buildWorktreeTree(["/repo"], deps(runner, { getGitApi: api(["/repo"]) }));
    expect(tree.repos[0].worktrees[0].bare).toBe(true);
  });
});

describe("buildWorktreeTree — in-workspace marking", () => {
  it("marks a worktree open when a workspace folder lies inside it", async () => {
    // The workspace folder sits inside a linked worktree, so VS Code reports
    // that worktree as the repository root — model § 6.
    const { runner } = makeRunner({
      "/repo-wt/feat|common-dir": { stdout: Buffer.from("/repo/.git\n") },
      "/repo-wt/feat|worktree-list": { stdout: nul(MAIN, FEAT) },
    });
    const tree = await buildWorktreeTree(
      ["/repo-wt/feat/packages/api"],
      deps(runner, { getGitApi: api(["/repo-wt/feat"]) }),
    );
    const byId = Object.fromEntries(tree.repos[0].worktrees.map((w) => [w.id, w.inWorkspace]));
    expect(byId["/repo-wt/feat"]).toBe(true);
    expect(byId["/repo"]).toBe(false);
  });

  it("marks a worktree open when a workspace folder is exactly its path", async () => {
    const { runner } = makeRunner({
      "/repo|common-dir": { stdout: Buffer.from("/repo/.git\n") },
      "/repo|worktree-list": { stdout: nul(MAIN, FEAT) },
    });
    const tree = await buildWorktreeTree(["/repo"], deps(runner, { getGitApi: api(["/repo"]) }));
    const main = tree.repos[0].worktrees.find((w) => w.id === "/repo");
    expect(main?.inWorkspace).toBe(true);
  });

  it("does not mark a sibling whose path merely shares a prefix", async () => {
    const { runner } = makeRunner({
      "/repo|common-dir": { stdout: Buffer.from("/repo/.git\n") },
      "/repo|worktree-list": { stdout: nul(MAIN, ["worktree /repo-other", "HEAD def"]) },
    });
    const tree = await buildWorktreeTree(["/repo"], deps(runner, { getGitApi: api(["/repo"]) }));
    const other = tree.repos[0].worktrees.find((w) => w.id === "/repo-other");
    expect(other?.inWorkspace).toBe(false);
  });
});

describe("buildWorktreeTree — degradation", () => {
  // spec: One repository's listing failure leaves the others intact
  it("confines a failing listing to its own repo", async () => {
    const { runner } = makeRunner({
      "/bad|common-dir": { stdout: Buffer.from("/bad/.git\n") },
      "/bad|worktree-list": { code: 128, stderr: "fatal: bad object HEAD" },
      "/good|common-dir": { stdout: Buffer.from("/good/.git\n") },
      "/good|worktree-list": { stdout: nul(["worktree /good", "HEAD abc", "branch refs/heads/main"]) },
    });
    const tree = await buildWorktreeTree(["/bad", "/good"], deps(runner, { getGitApi: api(["/bad", "/good"]) }));
    expect(tree.gitAvailable).toBe(true);
    expect(tree.repos[0]).toMatchObject({ repoId: "/bad/.git", worktrees: [] });
    expect(tree.repos[0].degraded).toMatch(/bad object/);
    expect(tree.repos[1].worktrees).toHaveLength(1);
  });

  it("skips a workspace folder that is not a repository", async () => {
    const { runner } = makeRunner({
      "/repo|common-dir": { stdout: Buffer.from("/repo/.git\n") },
      "/repo|worktree-list": { stdout: nul(["worktree /repo", "HEAD abc"]) },
    });
    const tree = await buildWorktreeTree(["/plain", "/repo"], deps(runner, { getGitApi: api(["/repo"]) }));
    expect(tree.repos).toHaveLength(1);
    expect(tree.unreadable.count).toBe(0);
  });

  it("deduplicates unreadable reasons across repos and counts occurrences", async () => {
    const ambiguous = "worktree /x/we\nird\nHEAD abc\n\n";
    const { runner } = makeRunner({
      "/a|common-dir": { stdout: Buffer.from("/a/.git\n") },
      "/a|worktree-list": { code: 129, stderr: "unknown switch `z'" },
      "/b|common-dir": { stdout: Buffer.from("/b/.git\n") },
      "/b|worktree-list": { code: 129, stderr: "unknown switch `z'" },
    });
    // Both repos fall back to the line form, which the runner answers identically.
    const fallbackRunner = {
      run: vi.fn(async (args: readonly string[], cwd: string) => {
        if (args[0] === "--version") {
          return res({ stdout: Buffer.from("git version 2.50.1\n") });
        }
        if (args[0] === "rev-parse") {
          return res({ stdout: Buffer.from(`${cwd}/.git\n`) });
        }
        if (args.includes("-z")) {
          return res({ code: 129, stderr: "unknown switch `z'" });
        }
        return res({ stdout: Buffer.from(ambiguous) });
      }),
    } as unknown as GitCommandRunner;
    void runner;
    const tree = await buildWorktreeTree(["/a", "/b"], deps(fallbackRunner, { getGitApi: api(["/a", "/b"]) }));
    expect(tree.unreadable.reasons).toHaveLength(1);
    expect(tree.unreadable.count).toBe(2);
  });
});

// Round-1 review W3, W4, W5.
describe("buildWorktreeTree — review round 1", () => {
  it("counts every skipped record in one repo while showing the reason once", async () => {
    const bad = "worktree /repo/a\nstray\n\nworktree /repo/b\nstray\n\n";
    const run = vi.fn(async (args: readonly string[], cwd: string) => {
      if (args[0] === "--version") {
        return res({ stdout: Buffer.from("git version 2.50.1\n") });
      }
      if (args[0] === "rev-parse") {
        return res({ stdout: Buffer.from(`${cwd}/.git\n`) });
      }
      if (args.includes("-z")) {
        return res({ code: 129, stderr: "unknown switch `z'" });
      }
      return res({ stdout: Buffer.from(bad) });
    });
    const runner = { run } as unknown as GitCommandRunner;
    const tree = await buildWorktreeTree(["/a"], deps(runner, { getGitApi: api(["/a"]) }));
    expect(tree.unreadable.reasons).toHaveLength(1);
    expect(tree.unreadable.count).toBe(2);
  });

  it("starts repository listings concurrently and still returns them in root order", async () => {
    let inFlight = 0;
    let peak = 0;
    const run = vi.fn(async (args: readonly string[], cwd: string) => {
      if (args[0] === "--version") {
        return res({ stdout: Buffer.from("git version 2.50.1\n") });
      }
      if (args[0] === "rev-parse") {
        return res({ stdout: Buffer.from(`${cwd}/.git\n`) });
      }
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return res({ stdout: nul([`worktree ${cwd}`, "HEAD abc", "branch refs/heads/main"]) });
    });
    const runner = { run } as unknown as GitCommandRunner;
    const tree = await buildWorktreeTree(["/a", "/b", "/c"], deps(runner, { getGitApi: api(["/a", "/b", "/c"]) }));
    expect(peak).toBeGreaterThan(1);
    expect(tree.repos.map((r) => r.repoId)).toEqual(["/a/.git", "/b/.git", "/c/.git"]);
  });

  it("marks a worktree at the filesystem root open when a folder lies under it", async () => {
    const { runner } = makeRunner({
      "/|common-dir": { stdout: Buffer.from("/.git\n") },
      "/|worktree-list": { stdout: nul(["worktree /", "HEAD abc", "branch refs/heads/main"]) },
    });
    const tree = await buildWorktreeTree(["/work/app"], deps(runner, { getGitApi: api(["/"]) }));
    expect(tree.repos[0].worktrees[0].inWorkspace).toBe(true);
  });
});
