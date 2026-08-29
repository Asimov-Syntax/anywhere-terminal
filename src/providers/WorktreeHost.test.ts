import { describe, expect, it, vi } from "vitest";
import type { ExtensionToWebViewMessage } from "../types/messages";
import { createGitCapabilities } from "../worktree/gitCapabilities";
import type { GitCommandResult, GitCommandRunner } from "../worktree/gitCommandRunner";
import type { WorktreePresence } from "../worktree/presenceTypes";
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

/** One repo at `/repo` whose `worktree list` result can change between calls. */
function growingRepo(...initial: string[][]) {
  let records = initial;
  const run = vi.fn(async (args: readonly string[], cwd: string): Promise<GitCommandResult> => {
    if (args[0] === "--version") {
      return res({ stdout: Buffer.from("git version 2.50.1\n") });
    }
    if (cwd !== "/repo") {
      return res({ code: 128, stderr: "fatal: not a git repository" });
    }
    if (args[0] === "worktree") {
      return res({ stdout: nul(...records) });
    }
    return res({ stdout: Buffer.from("/repo/.git\n") });
  });
  return {
    runner: { run } as unknown as GitCommandRunner,
    run,
    setRecords: (...next: string[][]) => {
      records = next;
    },
  };
}

function surface(ready = true): WorktreeSurface & { posts: ExtensionToWebViewMessage[] } {
  const posts: ExtensionToWebViewMessage[] = [];
  return { posts, isReady: () => ready, post: (m) => posts.push(m) };
}

/**
 * Attach a surface the window is displaying — the normal case, and what every
 * test written before the display gate existed assumed implicitly.
 */
function attachShown(h: ReturnType<typeof host>, s: WorktreeSurface) {
  const attachment = h.attach(s);
  attachment.setDisplayed(true);
  return attachment;
}

/** Let the gate's run and the git listing behind it settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

interface Subscription {
  baseDir: string;
  glob: string;
  handlers: { create?: () => void; change?: () => void; delete?: () => void };
}

/**
 * Records every pattern subscription and can fail chosen `<baseDir> <glob>`
 * targets individually. Two of the four watch targets share each base, so
 * failing a whole base (as `WorktreeHost.invalidation.test.ts`'s fakePool
 * does) cannot construct a partial failure — this one keys on the target.
 */
function fakePool(failFor: readonly string[] = []) {
  const subs: Subscription[] = [];
  return {
    subs,
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
      const key = `${baseDir} ${glob}`;
      const active = !failFor.includes(key);
      return {
        active,
        ...(active ? {} : { failureReason: `ENOSPC: could not watch ${key}` }),
        dispose: () => {},
      };
    },
  };
}

const pool = fakePool();

function host(runner: GitCommandRunner, folders = ["/repo"], usePool = pool) {
  return createWorktreeHost({
    deps: deps(runner, folders),
    workspaceFolders: () => folders,
    pool: usePool,
    now: () => 1000,
  });
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

    attachShown(worktrees, surface());
    attachShown(worktrees, surface());
    await settle();

    expect(run).not.toHaveBeenCalled();
  });

  it("stops posting to a detached surface", async () => {
    const { runner } = oneRepo(MAIN, FEAT);
    const worktrees = host(runner);
    const gone = surface();
    const kept = surface();
    const detach = attachShown(worktrees, gone);
    attachShown(worktrees, kept);
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
      attachShown(worktrees, one);
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
    attachShown(worktrees, notReady);
    worktrees.handleMessage(notReady, { type: "worktreeViewVisibility", visible: true });

    worktrees.handleMessage(notReady, { type: "requestWorktreeTree" });
    await settle();

    expect(notReady.posts).toHaveLength(0);
  });

  it("starts pushing once a surface declares the view visible", async () => {
    const { runner } = oneRepo(MAIN);
    const worktrees = host(runner);
    const late = surface();
    attachShown(worktrees, late);

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
    attachShown(worktrees, view);
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
    attachShown(worktrees, view);
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
    attachShown(worktrees, view);
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
    attachShown(worktrees, view);
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
    attachShown(worktrees, view);
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
    attachShown(worktrees, view);
    worktrees.handleMessage(view, { type: "worktreeViewVisibility", visible: true });

    worktrees.handleMessage(view, { type: "ready" });
    await settle();

    expect(view.posts).toHaveLength(0);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("WorktreeHost — watch targets", () => {
  it("rebuilds a repository with no linked worktrees when it gains its first one", async () => {
    const { runner, setRecords } = growingRepo(MAIN);
    const watchPool = fakePool();
    const worktrees = createWorktreeHost({
      deps: deps(runner, ["/repo"]),
      workspaceFolders: () => ["/repo"],
      pool: watchPool,
      now: () => 1000,
    });
    const view = surface();
    attachShown(worktrees, view);
    worktrees.handleMessage(view, { type: "worktreeViewVisibility", visible: true });
    worktrees.handleMessage(view, { type: "requestWorktreeTree" });
    await settle();

    const first = view.posts[0];
    if (first.type !== "worktreeTreeResponse") {
      throw new Error("expected a worktreeTreeResponse");
    }
    expect(first.tree.repos[0].worktrees).toHaveLength(1);

    // The linked-worktree metadata directory does not exist yet — driven
    // through W2 (base `<commonDir>`, glob `worktrees`, event `create`),
    // the target that reports it appearing without depending on a watcher
    // rooted at a not-yet-existing directory (W3/W4's base).
    setRecords(MAIN, FEAT);
    watchPool.fire("/repo/.git", "worktrees", "create");
    await settle();

    const second = view.posts[1];
    if (second.type !== "worktreeTreeResponse") {
      throw new Error("expected a worktreeTreeResponse");
    }
    expect(second.tree.repos[0].worktrees).toHaveLength(2);
  });

  it("marks the repository degraded when only some of its four targets fail", async () => {
    const { runner } = oneRepo(MAIN, FEAT);
    // Only W2 (`worktrees`, create/delete) fails; W1, W3, W4 stay live.
    const watchPool = fakePool(["/repo/.git worktrees"]);
    const worktrees = createWorktreeHost({
      deps: deps(runner, ["/repo"]),
      workspaceFolders: () => ["/repo"],
      pool: watchPool,
      now: () => 1000,
    });
    const view = surface();
    attachShown(worktrees, view);
    worktrees.handleMessage(view, { type: "worktreeViewVisibility", visible: true });
    worktrees.handleMessage(view, { type: "requestWorktreeTree" });
    await settle();

    const message = view.posts[0];
    if (message.type !== "worktreeTreeResponse") {
      throw new Error("expected a worktreeTreeResponse");
    }
    const degraded = message.tree.repos[0].degraded;
    expect(degraded).toContain("not being watched");
    expect(degraded).toContain("ENOSPC");
    // Partial, not total: exactly one of the four targets contributed a failure.
    expect(degraded?.split("ENOSPC").length).toBe(2);
  });
});

describe("WorktreeHost — disposal", () => {
  it("posts nothing after disposal", async () => {
    const { runner } = oneRepo(MAIN);
    const worktrees = host(runner);
    const view = surface();
    attachShown(worktrees, view);
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
    attachShown(worktrees, broken);
    attachShown(worktrees, view);
    worktrees.handleMessage(broken, { type: "worktreeViewVisibility", visible: true });
    worktrees.handleMessage(view, { type: "worktreeViewVisibility", visible: true });

    worktrees.handleMessage(view, { type: "requestWorktreeTree" });
    await settle();

    expect(view.posts).toHaveLength(1);
  });
});

// The falling edge (audit B1). `retainContextWhenHidden` keeps a hidden webview's
// DOM and its declaration, so the declaration alone cannot say whether anyone can
// see the panel — the window's own answer has to gate the push too.
describe("WorktreeHost — a surface the window is not displaying", () => {
  it("skips it while a displayed sibling is still served", async () => {
    const { runner } = oneRepo(MAIN);
    const worktrees = host(runner);
    const shown = surface();
    const offscreen = surface();
    worktrees.attach(shown).setDisplayed(true);
    // `offscreen` declares the body shown but the window never displays it.
    worktrees.attach(offscreen);
    worktrees.handleMessage(shown, { type: "worktreeViewVisibility", visible: true });
    worktrees.handleMessage(offscreen, { type: "worktreeViewVisibility", visible: true });

    worktrees.handleMessage(shown, { type: "requestWorktreeTree" });
    await settle();

    expect(shown.posts).toHaveLength(1);
    expect(offscreen.posts).toHaveLength(0);
  });

  it("stops pushing to it the moment the window hides it", async () => {
    const { runner } = oneRepo(MAIN);
    const worktrees = host(runner);
    const view = surface();
    const attachment = worktrees.attach(view);
    attachment.setDisplayed(true);
    worktrees.handleMessage(view, { type: "worktreeViewVisibility", visible: true });
    worktrees.handleMessage(view, { type: "requestWorktreeTree" });
    await settle();
    expect(view.posts).toHaveLength(1);

    attachment.setDisplayed(false);
    worktrees.handleMessage(view, { type: "requestWorktreeTree", force: true });
    await settle();

    // Still one: the rebuild ran, and reached nobody.
    expect(view.posts).toHaveLength(1);
  });
});

// The falling edge is only safe if the rising edge repairs it: the moment the
// user can see the panel again is the moment it has to be current.
describe("WorktreeHost — a surface displayed again", () => {
  it("receives listings that changed while it was not displayed, running no rebuild", async () => {
    const repo = growingRepo(MAIN);
    const worktrees = host(repo.runner);
    const shown = surface();
    const away = surface();
    attachShown(worktrees, shown);
    const awayAttachment = worktrees.attach(away);
    awayAttachment.setDisplayed(true);
    for (const one of [shown, away]) {
      worktrees.handleMessage(one, { type: "worktreeViewVisibility", visible: true });
    }
    worktrees.handleMessage(shown, { type: "requestWorktreeTree" });
    await settle();
    expect(away.posts).toHaveLength(1);

    awayAttachment.setDisplayed(false);
    repo.setRecords(MAIN, FEAT);
    worktrees.handleMessage(shown, { type: "requestWorktreeTree", force: true });
    await settle();
    // The rebuild happened; it just did not reach the surface nobody can see.
    expect(shown.posts).toHaveLength(2);
    expect(away.posts).toHaveLength(1);
    const listingsBefore = repo.run.mock.calls.filter((c) => c[0][0] === "worktree").length;

    awayAttachment.setDisplayed(true);
    await settle();

    const latest = away.posts.at(-1);
    expect(away.posts).toHaveLength(2);
    expect(latest?.type === "worktreeTreeResponse" && latest.tree.repos[0].worktrees).toHaveLength(2);
    expect(repo.run.mock.calls.filter((c) => c[0][0] === "worktree")).toHaveLength(listingsBefore);
  });

  it("pushes nothing further when the window repeats a report it already made", async () => {
    const { runner } = oneRepo(MAIN);
    const worktrees = host(runner);
    const view = surface();
    const attachment = worktrees.attach(view);
    attachment.setDisplayed(true);
    worktrees.handleMessage(view, { type: "worktreeViewVisibility", visible: true });
    worktrees.handleMessage(view, { type: "requestWorktreeTree" });
    await settle();
    expect(view.posts).toHaveLength(1);

    attachment.setDisplayed(true);
    await settle();

    expect(view.posts).toHaveLength(1);
  });
});

// Review round 1, W1. The rise is the only thing that serves a re-shown surface,
// so consuming it on a delivery that never landed strands the panel until some
// unrelated rebuild happens by.
describe("WorktreeHost — a re-show whose delivery did not land", () => {
  /** A surface that can refuse to deliver, either by throwing or by not being ready. */
  function flaky() {
    const posts: ExtensionToWebViewMessage[] = [];
    const state = { ready: true, throws: false };
    return {
      posts,
      state,
      surface: {
        isReady: () => state.ready,
        post: (m: ExtensionToWebViewMessage) => {
          if (state.throws) {
            throw new Error("webview is gone");
          }
          posts.push(m);
        },
      } as WorktreeSurface,
    };
  }

  async function shownOnce(subject: ReturnType<typeof flaky>) {
    const { runner } = oneRepo(MAIN);
    const worktrees = host(runner);
    const attachment = worktrees.attach(subject.surface);
    attachment.setDisplayed(true);
    worktrees.handleMessage(subject.surface, { type: "worktreeViewVisibility", visible: true });
    worktrees.handleMessage(subject.surface, { type: "requestWorktreeTree" });
    await settle();
    expect(subject.posts).toHaveLength(1);
    return attachment;
  }

  it("serves the next report after a post that threw", async () => {
    const subject = flaky();
    const attachment = await shownOnce(subject);

    attachment.setDisplayed(false);
    subject.state.throws = true;
    attachment.setDisplayed(true);
    await settle();
    expect(subject.posts).toHaveLength(1);

    subject.state.throws = false;
    attachment.setDisplayed(true);
    await settle();

    expect(subject.posts).toHaveLength(2);
  });

  it("serves the next report after a rise the surface was not ready for", async () => {
    const subject = flaky();
    const attachment = await shownOnce(subject);

    attachment.setDisplayed(false);
    subject.state.ready = false;
    attachment.setDisplayed(true);
    await settle();
    expect(subject.posts).toHaveLength(1);

    subject.state.ready = true;
    attachment.setDisplayed(true);
    await settle();

    expect(subject.posts).toHaveLength(2);
  });
});

describe("[1_1] a surface can subscribe to presence without drawing rows", () => {
  /** A host whose projector records the options each projection was given. */
  function scoped() {
    const { runner } = oneRepo(MAIN, FEAT);
    const options: ({ external?: boolean; enrich?: boolean } | undefined)[] = [];
    const presence: WorktreePresence = { rowsByWorktreeId: {}, scannedAt: 1, degradedSources: [] };
    const worktrees = createWorktreeHost({
      deps: deps(runner, ["/repo"]),
      workspaceFolders: () => ["/repo"],
      pool,
      now: () => 1000,
      projector: {
        project: async (_ids, opts) => {
          options.push(opts);
          return presence;
        },
        rank: () => undefined,
        rankRevision: () => 0,
      },
    });
    return { worktrees, options };
  }

  it("still serves a presence-only subscriber", async () => {
    // The whole point: a scope's chip, escape control and count survive a
    // collapsed rail, and they are drawn from presence.
    const { worktrees } = scoped();
    const s = surface();
    attachShown(worktrees, s);

    worktrees.handleMessage(s, { type: "worktreeViewVisibility", visible: true, level: "presence" });
    worktrees.handleMessage(s, { type: "requestWorktreeTree" });
    await settle();

    expect(s.posts.length, "a presence-only subscriber received nothing").toBeGreaterThan(0);
  });

  it("tells the projection not to enrich when every subscriber is presence-only", async () => {
    const { worktrees, options } = scoped();
    const s = surface();
    attachShown(worktrees, s);

    worktrees.handleMessage(s, { type: "worktreeViewVisibility", visible: true, level: "presence" });
    worktrees.handleMessage(s, { type: "requestWorktreeTree" });
    await settle();

    expect(options.length, "no projection ran at all").toBeGreaterThan(0);
    expect(
      options.every((o) => o?.enrich === false),
      "per-row work ran for a body drawing no rows",
    ).toBe(true);
  });

  it("enriches for the whole window as soon as one surface draws rows", async () => {
    // The predicate is an OR across surfaces: presence is broadcast, so one
    // drawing surface has to be served even while another is collapsed.
    const { worktrees, options } = scoped();
    const collapsed = surface();
    const drawing = surface();
    attachShown(worktrees, collapsed);
    attachShown(worktrees, drawing);

    worktrees.handleMessage(collapsed, { type: "worktreeViewVisibility", visible: true, level: "presence" });
    worktrees.handleMessage(drawing, { type: "worktreeViewVisibility", visible: true, level: "rows" });
    worktrees.handleMessage(drawing, { type: "requestWorktreeTree" });
    await settle();

    expect(
      options.some((o) => o?.enrich === true),
      "a drawing surface was served un-enriched rows",
    ).toBe(true);
  });

  it("treats a sender that omits the level as drawing rows", async () => {
    // The field is additive; every existing sender means what it always meant.
    const { worktrees, options } = scoped();
    const s = surface();
    attachShown(worktrees, s);

    worktrees.handleMessage(s, { type: "worktreeViewVisibility", visible: true });
    worktrees.handleMessage(s, { type: "requestWorktreeTree" });
    await settle();

    expect(options.some((o) => o?.enrich === true)).toBe(true);
  });

  it("serves nothing to a surface that never subscribed", async () => {
    const { worktrees } = scoped();
    const s = surface();
    attachShown(worktrees, s);
    worktrees.handleMessage(s, { type: "requestWorktreeTree" });
    await settle();

    expect(s.posts).toEqual([]);
  });
});
