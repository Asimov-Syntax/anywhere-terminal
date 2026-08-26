import { describe, expect, it, vi } from "vitest";
import type { ExtensionToWebViewMessage } from "../types/messages";
import { createGitCapabilities } from "../worktree/gitCapabilities";
import type { GitCommandResult, GitCommandRunner } from "../worktree/gitCommandRunner";
import type { GitApiAccessor } from "../worktree/repoRoots";
import type { WorktreeTreeDeps } from "../worktree/WorktreeDiscovery";
import { createWorktreeHost, type WorktreeSurface } from "./WorktreeHost";

function res(over: Partial<GitCommandResult> = {}): GitCommandResult {
  return { code: 0, stdout: Buffer.alloc(0), stderr: "", timedOut: false, failedToSpawn: false, ...over };
}

function nul(...records: string[][]): Buffer {
  return Buffer.from(records.map((f) => `${f.map((x) => `${x}\0`).join("")}\0`).join(""));
}

/** Runner keyed on `<cwd>|<command>`, where command is the first two args. */
function makeRunner(table: Record<string, Partial<GitCommandResult>>) {
  const run = vi.fn(async (args: readonly string[], cwd: string): Promise<GitCommandResult> => {
    if (args[0] === "--version") {
      return res({ stdout: Buffer.from("git version 2.50.1\n") });
    }
    const reply = table[`${cwd}|${args[0] === "worktree" ? "worktree-list" : "common-dir"}`];
    return reply ? res(reply) : res({ code: 128, stderr: "fatal: not a git repository" });
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

function deps(runner: GitCommandRunner, roots: string[]): WorktreeTreeDeps {
  return {
    runner,
    capabilities: createGitCapabilities(runner),
    normalize: async (p: string) => p.replace(/\/+$/, "") || "/",
    stat: async () => undefined,
    getGitApi: api(roots),
  };
}

const MAIN = ["worktree /repo", "HEAD abc", "branch refs/heads/main"];
const FEAT = ["worktree /repo-wt/feat", "HEAD def", "branch refs/heads/feat"];

/** One repo at `/repo`, listing whatever records are given. */
function oneRepo(...records: string[][]) {
  return makeRunner({
    "/repo|common-dir": { stdout: Buffer.from("/repo/.git\n") },
    "/repo|worktree-list": { stdout: nul(...records) },
  });
}

function surface(ready = true): WorktreeSurface & { posts: ExtensionToWebViewMessage[] } {
  const posts: ExtensionToWebViewMessage[] = [];
  return { posts, isReady: () => ready, post: (m) => posts.push(m) };
}

/** Let the gate's run and the git listing behind it settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const pool = { subscribePattern: () => ({ active: true, dispose: () => {} }) };

function host(runner: GitCommandRunner, folders = ["/repo"]) {
  return createWorktreeHost({ deps: deps(runner, folders), workspaceFolders: () => folders, pool, now: () => 1000 });
}

describe("WorktreeHost — init payload", () => {
  it("reports a repository without running a single git command", () => {
    const { runner, run } = oneRepo(MAIN);
    const worktrees = createWorktreeHost({
      deps: deps(runner, ["/repo"]),
      workspaceFolders: () => ["/repo"],
      pool,
      exists: (p) => p === "/repo/.git",
    });
    expect(worktrees.initPayload()).toEqual({ worktreeHasRepo: true });
    expect(run).not.toHaveBeenCalled();
    worktrees.dispose();
  });

  it("reports no repository for a workspace that holds none", () => {
    const { runner } = oneRepo(MAIN);
    const worktrees = createWorktreeHost({
      deps: deps(runner, ["/plain"]),
      workspaceFolders: () => ["/plain"],
      pool,
      exists: () => false,
    });
    expect(worktrees.initPayload()).toEqual({ worktreeHasRepo: false });
    worktrees.dispose();
  });

  it("reads the folder set at call time, so a folder added later counts", () => {
    const { runner } = oneRepo(MAIN);
    let folders: string[] = [];
    const worktrees = createWorktreeHost({
      deps: deps(runner, ["/repo"]),
      workspaceFolders: () => folders,
      pool,
      exists: (p) => p === "/repo/.git",
    });
    expect(worktrees.initPayload().worktreeHasRepo).toBe(false);
    folders = ["/repo"];
    expect(worktrees.initPayload().worktreeHasRepo).toBe(true);
    worktrees.dispose();
  });
});

describe("WorktreeHost — attachment", () => {
  it("costs no git command to attach a surface", async () => {
    const { runner, run } = oneRepo(MAIN);
    const worktrees = host(runner);

    worktrees.attach(surface());
    worktrees.attach(surface());
    await settle();

    expect(run).not.toHaveBeenCalled();
  });

  it("stops posting to a detached surface", async () => {
    const { runner } = oneRepo(MAIN, FEAT);
    const worktrees = host(runner);
    const gone = surface();
    const kept = surface();
    const detach = worktrees.attach(gone);
    worktrees.attach(kept);
    worktrees.handleMessage(gone, { type: "worktreeViewVisibility", visible: true });
    worktrees.handleMessage(kept, { type: "worktreeViewVisibility", visible: true });

    detach.dispose();
    worktrees.handleMessage(kept, { type: "requestWorktreeTree" });
    await settle();

    expect(gone.posts).toHaveLength(0);
    expect(kept.posts).toHaveLength(1);
  });

  it("ignores a message from a surface that never attached", async () => {
    const { runner, run } = oneRepo(MAIN);
    const worktrees = host(runner);
    const stranger = surface();

    worktrees.handleMessage(stranger, { type: "requestWorktreeTree", force: true });
    await settle();

    expect(run).not.toHaveBeenCalled();
    expect(stranger.posts).toHaveLength(0);
  });
});

describe("WorktreeHost — visibility gating", () => {
  it("delivers a push to every surface showing the view and to no other", async () => {
    const { runner } = oneRepo(MAIN, FEAT);
    const worktrees = host(runner);
    const first = surface();
    const second = surface();
    const hidden = surface();
    const silent = surface();
    for (const one of [first, second, hidden, silent]) {
      worktrees.attach(one);
    }
    worktrees.handleMessage(first, { type: "worktreeViewVisibility", visible: true });
    worktrees.handleMessage(second, { type: "worktreeViewVisibility", visible: true });
    worktrees.handleMessage(hidden, { type: "worktreeViewVisibility", visible: false });
    // `silent` never declares at all.

    worktrees.handleMessage(first, { type: "requestWorktreeTree" });
    await settle();

    expect(first.posts).toHaveLength(1);
    expect(second.posts).toHaveLength(1);
    expect(hidden.posts).toHaveLength(0);
    expect(silent.posts).toHaveLength(0);
  });

  it("skips a visible surface whose webview is not ready", async () => {
    const { runner } = oneRepo(MAIN);
    const worktrees = host(runner);
    const notReady = surface(false);
    worktrees.attach(notReady);
    worktrees.handleMessage(notReady, { type: "worktreeViewVisibility", visible: true });

    worktrees.handleMessage(notReady, { type: "requestWorktreeTree" });
    await settle();

    expect(notReady.posts).toHaveLength(0);
  });

  it("starts pushing once a surface declares the view visible", async () => {
    const { runner } = oneRepo(MAIN);
    const worktrees = host(runner);
    const late = surface();
    worktrees.attach(late);

    worktrees.handleMessage(late, { type: "requestWorktreeTree" });
    await settle();
    expect(late.posts).toHaveLength(0);

    worktrees.handleMessage(late, { type: "worktreeViewVisibility", visible: true });
    worktrees.handleMessage(late, { type: "requestWorktreeTree" });
    await settle();

    expect(late.posts).toHaveLength(1);
  });
});

describe("WorktreeHost — answering a request", () => {
  it("answers with the tree and the presence projection in one message", async () => {
    const { runner } = oneRepo(MAIN, FEAT);
    const worktrees = host(runner);
    const view = surface();
    worktrees.attach(view);
    worktrees.handleMessage(view, { type: "worktreeViewVisibility", visible: true });

    worktrees.handleMessage(view, { type: "requestWorktreeTree" });
    await settle();

    const message = view.posts[0];
    expect(message.type).toBe("worktreeTreeResponse");
    if (message.type !== "worktreeTreeResponse") {
      throw new Error("expected a worktreeTreeResponse");
    }
    expect(message.tree.repos[0].worktrees).toHaveLength(2);
    expect(message.presence).toEqual({ rowsByWorktreeId: {}, scannedAt: 1000, degradedSources: [] });
  });

  it("runs one rebuild and produces one push for two concurrent requests", async () => {
    const { runner, run } = oneRepo(MAIN, FEAT);
    const worktrees = host(runner);
    const view = surface();
    worktrees.attach(view);
    worktrees.handleMessage(view, { type: "worktreeViewVisibility", visible: true });

    worktrees.handleMessage(view, { type: "requestWorktreeTree" });
    worktrees.handleMessage(view, { type: "requestWorktreeTree" });
    await settle();

    expect(view.posts).toHaveLength(1);
    expect(run.mock.calls.filter((c) => c[0][0] === "worktree")).toHaveLength(1);
  });

  it("serves a later unforced request from the cache without shelling out again", async () => {
    const { runner, run } = oneRepo(MAIN);
    const worktrees = host(runner);
    const view = surface();
    worktrees.attach(view);
    worktrees.handleMessage(view, { type: "worktreeViewVisibility", visible: true });
    worktrees.handleMessage(view, { type: "requestWorktreeTree" });
    await settle();
    const listedOnce = run.mock.calls.length;

    worktrees.handleMessage(view, { type: "requestWorktreeTree" });
    await settle();

    expect(view.posts).toHaveLength(2);
    expect(run.mock.calls).toHaveLength(listedOnce);
  });

  it("rebuilds before answering a forced request", async () => {
    const { runner, run } = oneRepo(MAIN);
    const worktrees = host(runner);
    const view = surface();
    worktrees.attach(view);
    worktrees.handleMessage(view, { type: "worktreeViewVisibility", visible: true });
    worktrees.handleMessage(view, { type: "requestWorktreeTree" });
    await settle();

    // Forced, so the rate floor must not defer it.
    worktrees.handleMessage(view, { type: "requestWorktreeTree", force: true });
    await settle();

    expect(view.posts).toHaveLength(2);
    expect(run.mock.calls.filter((c) => c[0][0] === "worktree")).toHaveLength(2);
  });

  it("answers a workspace with no folders without shelling out", async () => {
    const { runner, run } = oneRepo(MAIN);
    const worktrees = host(runner, []);
    const view = surface();
    worktrees.attach(view);
    worktrees.handleMessage(view, { type: "worktreeViewVisibility", visible: true });

    worktrees.handleMessage(view, { type: "requestWorktreeTree" });
    await settle();

    expect(view.posts).toHaveLength(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("ignores a message type it does not own", async () => {
    const { runner, run } = oneRepo(MAIN);
    const worktrees = host(runner);
    const view = surface();
    worktrees.attach(view);
    worktrees.handleMessage(view, { type: "worktreeViewVisibility", visible: true });

    worktrees.handleMessage(view, { type: "ready" });
    await settle();

    expect(view.posts).toHaveLength(0);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("WorktreeHost — disposal", () => {
  it("posts nothing after disposal", async () => {
    const { runner } = oneRepo(MAIN);
    const worktrees = host(runner);
    const view = surface();
    worktrees.attach(view);
    worktrees.handleMessage(view, { type: "worktreeViewVisibility", visible: true });

    worktrees.handleMessage(view, { type: "requestWorktreeTree" });
    worktrees.dispose();
    worktrees.dispose();
    await settle();

    expect(view.posts).toHaveLength(0);
  });

  it("keeps broadcasting when one surface's post throws", async () => {
    const { runner } = oneRepo(MAIN);
    const worktrees = host(runner);
    const broken: WorktreeSurface = {
      isReady: () => true,
      post: () => {
        throw new Error("webview is gone");
      },
    };
    const view = surface();
    worktrees.attach(broken);
    worktrees.attach(view);
    worktrees.handleMessage(broken, { type: "worktreeViewVisibility", visible: true });
    worktrees.handleMessage(view, { type: "worktreeViewVisibility", visible: true });

    worktrees.handleMessage(view, { type: "requestWorktreeTree" });
    await settle();

    expect(view.posts).toHaveLength(1);
  });
});
