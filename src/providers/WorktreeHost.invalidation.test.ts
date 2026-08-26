import { describe, expect, it, vi } from "vitest";
import type { ExtensionToWebViewMessage } from "../types/messages";
import { createGitCapabilities } from "../worktree/gitCapabilities";
import type { GitCommandResult, GitCommandRunner } from "../worktree/gitCommandRunner";
import type { RebuildGateClock } from "../worktree/rebuildGate";
import type { GitApiAccessor } from "../worktree/repoRoots";
import type { WorktreeTreeDeps } from "../worktree/WorktreeDiscovery";
import { createWorktreeHost, type WorktreeSurface } from "./WorktreeHost";

function res(over: Partial<GitCommandResult> = {}): GitCommandResult {
  return { code: 0, stdout: Buffer.alloc(0), stderr: "", timedOut: false, failedToSpawn: false, ...over };
}

function nul(...records: string[][]): Buffer {
  return Buffer.from(records.map((f) => `${f.map((x) => `${x}\0`).join("")}\0`).join(""));
}

/** Two repositories, `/a` and `/b`, each listing its own main worktree. */
function twoRepos() {
  const run = vi.fn(async (args: readonly string[], cwd: string): Promise<GitCommandResult> => {
    if (args[0] === "--version") {
      return res({ stdout: Buffer.from("git version 2.50.1\n") });
    }
    if (args[0] === "worktree") {
      return res({ stdout: nul([`worktree ${cwd}`, "HEAD abc", "branch refs/heads/main"]) });
    }
    return res({ stdout: Buffer.from(`${cwd}/.git\n`) });
  });
  return { runner: { run } as unknown as GitCommandRunner, run };
}

/** Every `worktree list` this test drove, by repository. */
function listedRepos(run: ReturnType<typeof twoRepos>["run"]): string[] {
  return run.mock.calls.filter((call) => call[0][0] === "worktree").map((call) => call[1]);
}

const api =
  (roots: () => string[]): GitApiAccessor =>
  () =>
    ({
      state: "initialized",
      repositories: roots().map((fsPath) => ({ rootUri: { fsPath } })),
    }) as ReturnType<GitApiAccessor>;

function deps(runner: GitCommandRunner, roots: () => string[]): WorktreeTreeDeps {
  return {
    runner,
    capabilities: createGitCapabilities(runner),
    normalize: async (p: string) => p.replace(/\/+$/, "") || "/",
    stat: async () => undefined,
    getGitApi: api(roots),
  };
}

interface Subscription {
  baseDir: string;
  glob: string;
  handlers: { create?: () => void; change?: () => void; delete?: () => void };
}

/** Records every pattern subscription and can fail the ones for a chosen base. */
function fakePool(failFor?: string) {
  const subs: Subscription[] = [];
  let live = 0;
  return {
    subs,
    liveCount: () => live,
    /** Fire one event on `<baseDir>`'s subscription for `glob`. */
    fire(baseDir: string, glob: string, event: "create" | "change" | "delete"): void {
      const sub = subs.find((one) => one.baseDir === baseDir && one.glob === glob);
      if (!sub) {
        throw new Error(`no subscription for ${baseDir} ${glob}`);
      }
      sub.handlers[event]?.();
    },
    subscribePattern(baseDir: string, glob: string, handlers: Subscription["handlers"]) {
      subs.push({ baseDir, glob, handlers });
      const active = failFor !== baseDir;
      live += 1;
      return {
        active,
        ...(active ? {} : { failureReason: "ENOSPC: could not watch" }),
        dispose: () => {
          live -= 1;
        },
      };
    },
  };
}

function fakeClock() {
  let millis = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: RebuildGateClock = {
    now: () => millis,
    setTimeout: (fn, ms) => {
      const id = ++nextId;
      timers.set(id, { at: millis + ms, fn });
      return id;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
  };
  return {
    clock,
    advance(ms: number): void {
      millis += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= millis) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
  };
}

function surface(): WorktreeSurface & { posts: ExtensionToWebViewMessage[] } {
  const posts: ExtensionToWebViewMessage[] = [];
  return { posts, isReady: () => true, post: (m) => posts.push(m) };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** A host over `folders`, already built once and pushing to one visible surface. */
async function builtHost(options: { folders?: string[]; failWatchFor?: string } = {}) {
  const folders = options.folders ?? ["/a", "/b"];
  let current = [...folders];
  const { runner, run } = twoRepos();
  const pool = fakePool(options.failWatchFor);
  const { clock, advance } = fakeClock();
  let onFolders: (() => void) | undefined;

  const host = createWorktreeHost({
    deps: deps(runner, () => current),
    workspaceFolders: () => current,
    pool,
    onDidChangeWorkspaceFolders: (listener) => {
      onFolders = listener;
      return { dispose: () => {} };
    },
    clock,
  });
  const view = surface();
  host.attach(view);
  host.handleMessage(view, { type: "worktreeViewVisibility", visible: true });
  host.handleMessage(view, { type: "requestWorktreeTree" });
  await settle();

  return {
    host,
    view,
    pool,
    run,
    advance,
    async setFolders(next: string[]): Promise<void> {
      current = next;
      onFolders?.();
      await settle();
    },
  };
}

describe("WorktreeHost — watch targets", () => {
  it("watches each repository with exactly the three documented patterns", async () => {
    const { pool } = await builtHost();

    expect(pool.subs.map((s) => `${s.baseDir} ${s.glob}`)).toEqual([
      "/a/.git worktrees/*",
      "/a/.git worktrees/*/HEAD",
      "/a/.git HEAD",
      "/b/.git worktrees/*",
      "/b/.git worktrees/*/HEAD",
      "/b/.git HEAD",
    ]);
  });

  it("adds no watcher and no git command when a second surface shows the view", async () => {
    const { host, pool, run } = await builtHost();
    const subsBefore = pool.subs.length;
    const listedBefore = listedRepos(run).length;

    const second = surface();
    host.attach(second);
    host.handleMessage(second, { type: "worktreeViewVisibility", visible: true });
    host.handleMessage(second, { type: "requestWorktreeTree" });
    await settle();

    expect(pool.subs).toHaveLength(subsBefore);
    expect(listedRepos(run)).toHaveLength(listedBefore);
    expect(second.posts).toHaveLength(1);
  });

  it("releases every subscription on disposal", async () => {
    const { host, pool } = await builtHost();

    host.dispose();

    expect(pool.liveCount()).toBe(0);
  });
});

describe("WorktreeHost — confining a rebuild", () => {
  it("rebuilds only the repository whose worktree set changed", async () => {
    const { pool, run, view } = await builtHost();
    run.mockClear();

    pool.fire("/a/.git", "worktrees/*", "create");
    await settle();

    expect(listedRepos(run)).toEqual(["/a"]);
    expect(view.posts).toHaveLength(2);
  });

  it("rebuilds exactly once when a linked worktree's HEAD is rewritten in place", async () => {
    const { pool, run } = await builtHost();
    run.mockClear();

    pool.fire("/a/.git", "worktrees/*/HEAD", "change");
    await settle();

    expect(listedRepos(run)).toEqual(["/a"]);
  });

  it("rebuilds the repository when the main worktree switches branch", async () => {
    const { pool, run } = await builtHost();
    run.mockClear();

    pool.fire("/b/.git", "HEAD", "change");
    await settle();

    expect(listedRepos(run)).toEqual(["/b"]);
  });

  it("costs at most two git invocations for the repository it affects", async () => {
    const { pool, run } = await builtHost();
    run.mockClear();

    pool.fire("/a/.git", "worktrees/*", "delete");
    await settle();

    // No root re-resolution and no version probe: one `worktree list`.
    expect(run.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe("WorktreeHost — bounding the rebuild rate", () => {
  it("collapses a sustained stream of signals to one rebuild per second", async () => {
    const { pool, run, advance } = await builtHost();
    run.mockClear();

    pool.fire("/a/.git", "worktrees/*", "create");
    await settle();
    for (let i = 0; i < 5; i += 1) {
      advance(100);
      pool.fire("/a/.git", "worktrees/*/HEAD", "change");
      await settle();
    }

    expect(listedRepos(run)).toEqual(["/a"]);

    advance(600);
    await settle();

    expect(listedRepos(run)).toEqual(["/a", "/a"]);
  });

  it("runs a forced refresh immediately inside the floor", async () => {
    const { host, view, pool, run } = await builtHost();
    run.mockClear();
    pool.fire("/a/.git", "worktrees/*", "create");
    await settle();

    host.handleMessage(view, { type: "requestWorktreeTree", force: true });
    await settle();

    // The forced rebuild is whole-tree, so both repos list again right away.
    expect(listedRepos(run)).toEqual(["/a", "/a", "/b"]);
  });
});

describe("WorktreeHost — workspace changes", () => {
  it("watches a repository added to the workspace and drops one removed from it", async () => {
    const { pool, setFolders } = await builtHost({ folders: ["/a"] });
    expect(pool.subs.map((s) => s.baseDir)).toEqual(["/a/.git", "/a/.git", "/a/.git"]);

    await setFolders(["/b"]);

    expect(pool.subs.filter((s) => s.baseDir === "/b/.git")).toHaveLength(3);
    expect(pool.liveCount()).toBe(3);
  });

  it("rebuilds the whole tree when the workspace folders change", async () => {
    const { run, setFolders, view } = await builtHost({ folders: ["/a"] });
    run.mockClear();

    await setFolders(["/a", "/b"]);

    expect(listedRepos(run)).toEqual(["/a", "/b"]);
    expect(view.posts).toHaveLength(2);
  });
});

describe("WorktreeHost — an unestablished watch", () => {
  it("marks the repository degraded rather than presenting it as watched", async () => {
    const { view } = await builtHost({ failWatchFor: "/a/.git" });

    const message = view.posts[0];
    if (message.type !== "worktreeTreeResponse") {
      throw new Error("expected a worktreeTreeResponse");
    }
    expect(message.tree.repos[0].degraded).toContain("ENOSPC");
    expect(message.tree.repos[1].degraded).toBeUndefined();
  });

  it("keeps the listing reachable, so a forced refresh still shows its worktrees", async () => {
    const { host, view } = await builtHost({ failWatchFor: "/a/.git" });

    host.handleMessage(view, { type: "requestWorktreeTree", force: true });
    await settle();

    const message = view.posts[1];
    if (message.type !== "worktreeTreeResponse") {
      throw new Error("expected a worktreeTreeResponse");
    }
    expect(message.tree.repos[0].worktrees).toHaveLength(1);
    expect(message.tree.repos[0].degraded).toContain("ENOSPC");
  });
});
