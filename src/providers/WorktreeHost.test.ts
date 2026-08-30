import { describe, expect, it, vi } from "vitest";
import type { ExtensionToWebViewMessage } from "../types/messages";
import { createGitCapabilities } from "../worktree/gitCapabilities";
import type { GitCommandResult, GitCommandRunner } from "../worktree/gitCommandRunner";
import type { WorktreePresence } from "../worktree/presenceTypes";
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
  /**
   * A host whose projector records the options each projection was given, and
   * whose timers the test drives. The scan is the point: a presence-only
   * subscriber has to keep ARMING it, and a test that drives the projection with
   * a direct tree request proves the enrich plumbing while staying green if scan
   * arming stopped for `"presence"` — the freeze this change exists to prevent
   * (round-1 W2).
   */
  function scoped() {
    const { runner } = oneRepo(MAIN, FEAT);
    const options: ({ external?: boolean; enrich?: boolean } | undefined)[] = [];
    let forgotten = 0;
    let hold: Promise<void> | undefined;
    let cap = Number.POSITIVE_INFINITY;
    let failNext = false;
    const presence: WorktreePresence = { rowsByWorktreeId: {}, scannedAt: 1, degradedSources: [] };
    const timers = new Map<number, () => void>();
    let nextHandle = 1;
    const clock: RebuildGateClock = {
      now: () => 0,
      setTimeout: (fn) => {
        const handle = nextHandle++;
        timers.set(handle, fn);
        return handle;
      },
      clearTimeout: (handle) => {
        timers.delete(handle as number);
      },
    };
    const worktrees = createWorktreeHost({
      deps: deps(runner, ["/repo"]),
      workspaceFolders: () => ["/repo"],
      pool,
      now: () => 1000,
      clock,
      projector: {
        project: async (_ids, opts) => {
          options.push(opts);
          if (options.length > cap) {
            // A runaway pass loop never yields control back, so a test that only
            // awaited `settle()` would hang instead of failing. Throwing turns
            // "did not terminate" into an assertion the run's own catch lets us
            // reach.
            throw new Error(`projection pass loop did not terminate: ${options.length} passes`);
          }
          if (failNext) {
            failNext = false;
            throw new Error("projection failed");
          }
          if (hold) {
            await hold;
          }
          return presence;
        },
        rank: () => undefined,
        rankRevision: () => 0,
        forgetDrawOrder: () => {
          forgotten += 1;
        },
      },
    });
    return {
      worktrees,
      options,
      /** How many times the projector was told its rows are no longer drawn. */
      forgotten: () => forgotten,
      /** Park every projection until the returned function is called. */
      holdProjections(): () => void {
        let release = () => {};
        hold = new Promise<void>((r) => {
          release = r;
        });
        return () => {
          hold = undefined;
          release();
        };
      },
      /** Stop the projector after `n` passes, so a runaway loop fails rather than hangs. */
      capProjections(n: number): void {
        cap = n;
      },
      /** Make the next projection reject. */
      failNextProjection(): void {
        failNext = true;
      },
      /** How many timers are currently armed. */
      armed: () => timers.size,
      /** Fire every armed timer once. */
      async fire(): Promise<void> {
        for (const [handle, fn] of [...timers]) {
          timers.delete(handle);
          fn();
        }
        await settle();
      },
    };
  }

  describe("the row-drawing falling edge", () => {
    /** Drive a surface up to drawing rows and hand back the forget count there. */
    async function drawingRows() {
      const h = scoped();
      const s = surface();
      const attachment = h.worktrees.attach(s);
      attachment.setDisplayed(true);
      h.worktrees.handleMessage(s, { type: "worktreeViewVisibility", visible: true, level: "rows" });
      await settle();
      return { ...h, s, attachment, before: h.forgotten() };
    }

    // The projector's turn order holds exactly the ids being drawn, and the only
    // thing that reconciles it is an ENRICHED projection — which is exactly what
    // stops arriving once nothing draws rows. Each edge below left the order
    // standing, so a reopened window granted by pre-hide position rather than
    // taking every returned identity as an arrival (round-4 B1, design.md D10).

    it("owes an enriched pass when the edge lands mid-projection", async () => {
      // `projectedEnriched` records what was REQUESTED. The projector's fence
      // skips the preview half of a projection that loses its last drawing
      // surface, and the envelope was still marked enriched — so the reopening
      // surface was told nothing was owed (round-6 W1).
      const h = await drawingRows();
      const release = h.holdProjections();
      h.worktrees.handleMessage(h.s, { type: "requestWorktreeTree" });
      await settle();

      h.worktrees.handleMessage(h.s, { type: "worktreeViewVisibility", visible: true, level: "presence" });
      release();
      await settle();
      h.options.length = 0;

      h.worktrees.handleMessage(h.s, { type: "worktreeViewVisibility", visible: true, level: "rows" });
      await settle();

      expect(h.options.some((o) => o?.enrich === true)).toBe(true);
    });

    it("publishes exactly one replacement pass when a surface reopens mid-projection", async () => {
      // The obligation used to clear where the RUN starts. `requestProjection` is
      // single-flight, so a surface reopening mid-run JOINS that run and never
      // reaches the clear; the joined pass then finished clean, found the
      // obligation still standing, and dirtied itself — forever, publishing
      // nothing (round-1 B1, design.md D1a).
      const h = await drawingRows();
      h.capProjections(8);
      const release = h.holdProjections();
      h.worktrees.handleMessage(h.s, { type: "requestWorktreeTree" });
      await settle();

      // The falling edge records the obligation against the parked projection.
      h.worktrees.handleMessage(h.s, { type: "worktreeViewVisibility", visible: true, level: "presence" });
      await settle();
      // ...and the surface comes back BEFORE that projection is released, so its
      // request joins the run in flight rather than starting one.
      h.worktrees.handleMessage(h.s, { type: "worktreeViewVisibility", visible: true, level: "rows" });
      await settle();
      h.options.length = 0;
      h.s.posts.length = 0;

      release();
      await settle();

      expect(h.options.length, "the joined run kept re-projecting without publishing").toBeLessThanOrEqual(1);
      expect(
        h.options.some((o) => o?.enrich === true),
        "the reopening surface was never served an enriched pass",
      ).toBe(true);
      // The pass count alone would stay green if the replacement pass ran and
      // the broadcast never followed, which is the half of the defect the
      // reopening surface actually feels (round-2 W1).
      const published = h.s.posts.filter((m) => m.type === "worktreeTreeResponse");
      expect(published, "the replacement pass was never published to the reopened surface").toHaveLength(1);
    });

    it("still owes the pass when the replacement projection fails", async () => {
      // A pass that cleared the obligation and then threw left `projectedEnriched`
      // holding `true` from the cut-short pass, so the owed predicate read as
      // satisfied and the missing second line waited for the next external scan
      // (round-1 W1, design.md D1a).
      const h = await drawingRows();
      const release = h.holdProjections();
      h.worktrees.handleMessage(h.s, { type: "requestWorktreeTree" });
      await settle();
      h.worktrees.handleMessage(h.s, { type: "worktreeViewVisibility", visible: true, level: "presence" });
      release();
      await settle();

      h.failNextProjection();
      h.worktrees.handleMessage(h.s, { type: "worktreeViewVisibility", visible: true, level: "rows" });
      await settle();
      h.options.length = 0;

      // Any later settle of the drawing state re-reads the obligation.
      h.attachment.setDisplayed(false);
      await settle();
      h.attachment.setDisplayed(true);
      await settle();

      expect(
        h.options.some((o) => o?.enrich === true),
        "a replacement pass that failed was treated as delivered",
      ).toBe(true);
    });

    it("owes nothing after a falling edge with no projection running", async () => {
      // The reconcile is a state settle, not an edge check, so it runs on every
      // mutation while nothing draws. Recording an obligation there is what moved
      // 19 cases; gating on a projection in flight is what keeps this quiet (D2).
      const h = await drawingRows();
      h.worktrees.handleMessage(h.s, { type: "requestWorktreeTree" });
      await settle();
      h.worktrees.handleMessage(h.s, { type: "worktreeViewVisibility", visible: true, level: "presence" });
      await settle();
      for (let i = 0; i < 3; i++) {
        h.attachment.setDisplayed(false);
        h.attachment.setDisplayed(true);
        await settle();
      }
      h.options.length = 0;

      h.worktrees.handleMessage(h.s, { type: "worktreeViewVisibility", visible: true, level: "rows" });
      await settle();

      expect(h.options.some((o) => o?.enrich === true)).toBe(false);
    });

    it("forgets the order when the last drawing surface collapses to presence-only", async () => {
      const h = await drawingRows();
      h.worktrees.handleMessage(h.s, { type: "worktreeViewVisibility", visible: true, level: "presence" });
      await settle();
      expect(h.forgotten()).toBeGreaterThan(h.before);
    });

    it("forgets the order when the last drawing surface stops being displayed", async () => {
      const h = await drawingRows();
      h.attachment.setDisplayed(false);
      await settle();
      expect(h.forgotten()).toBeGreaterThan(h.before);
    });

    it("forgets the order when the last drawing surface detaches", async () => {
      const h = await drawingRows();
      h.attachment.dispose();
      await settle();
      expect(h.forgotten()).toBeGreaterThan(h.before);
    });
  });

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

  it("arms the scan for a presence-only subscriber, and runs it without enriching", async () => {
    // Both halves matter. Arming is what keeps the hidden-waiting count moving;
    // not enriching is what makes the collapsed rail cheap.
    const h = scoped();
    const s = surface();
    attachShown(h.worktrees, s);

    h.worktrees.handleMessage(s, { type: "worktreeViewVisibility", visible: true, level: "presence" });
    await settle();
    expect(h.armed(), "a presence-only subscriber did not arm the scan").toBeGreaterThan(0);

    h.options.length = 0;
    await h.fire();

    expect(h.options.length, "the armed scan ran no projection").toBeGreaterThan(0);
    expect(
      h.options.every((o) => o?.enrich === false),
      "per-row work ran for a body drawing no rows",
    ).toBe(true);
  });

  it("stops arming once the last presence subscription ends", async () => {
    const h = scoped();
    const s = surface();
    attachShown(h.worktrees, s);
    h.worktrees.handleMessage(s, { type: "worktreeViewVisibility", visible: true, level: "presence" });
    await settle();
    expect(h.armed()).toBeGreaterThan(0);

    h.worktrees.handleMessage(s, { type: "worktreeViewVisibility", visible: false });
    await settle();

    expect(h.armed(), "the scan stayed armed after the last subscriber left").toBe(0);
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

  it("enriches when a retained rows surface becomes displayed", async () => {
    // `setDisplayed` mutates an input to the drawing predicate without going
    // through the visibility handler, so this rise reached no promotion at all:
    // a reopened rail drew fallback titles and no previews until the next scan.
    const { worktrees, options } = scoped();
    const s = surface();
    const attachment = worktrees.attach(s);
    attachment.setDisplayed(true);
    worktrees.handleMessage(s, { type: "worktreeViewVisibility", visible: true, level: "rows" });
    // Collapse to presence-only, then let a bare envelope be published.
    worktrees.handleMessage(s, { type: "worktreeViewVisibility", visible: true, level: "presence" });
    worktrees.handleMessage(s, { type: "requestWorktreeTree" });
    await settle();
    attachment.setDisplayed(false);
    await settle();
    options.length = 0;

    // Back to drawing rows, by the route that goes nowhere near the handler.
    worktrees.handleMessage(s, { type: "worktreeViewVisibility", visible: true, level: "rows" });
    await settle();
    options.length = 0;
    attachment.setDisplayed(true);
    await settle();

    expect(
      options.some((o) => o?.enrich === true),
      "a rail that became displayed was left holding the un-enriched envelope",
    ).toBe(true);
  });

  it("issues no extra projection when the published envelope is already enriched", async () => {
    // The obligation is the CONJUNCTION — rows drawn and what we published was
    // bare. Drawing rows on its own is not a reason to redo anything.
    const { worktrees, options } = scoped();
    const s = surface();
    const attachment = worktrees.attach(s);
    attachment.setDisplayed(true);
    worktrees.handleMessage(s, { type: "worktreeViewVisibility", visible: true, level: "rows" });
    worktrees.handleMessage(s, { type: "requestWorktreeTree" });
    await settle();
    expect(options.some((o) => o?.enrich === true)).toBe(true);

    options.length = 0;
    attachment.setDisplayed(true);
    worktrees.handleMessage(s, { type: "worktreeViewVisibility", visible: true, level: "rows" });
    await settle();

    expect(options, "an already-enriched window redid its projection").toHaveLength(0);
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

  it("re-projects with enrichment when a surface is promoted against a bare envelope", async () => {
    // A tree request would only rebroadcast what is published, and what is
    // published came from a presence-only pass with no titles and no previews.
    // The host owns that fact, so the host is what redoes it (round-2 W1).
    const h = scoped();
    const s = surface();
    attachShown(h.worktrees, s);
    h.worktrees.handleMessage(s, { type: "worktreeViewVisibility", visible: true, level: "presence" });
    h.worktrees.handleMessage(s, { type: "requestWorktreeTree" });
    await settle();
    expect(
      h.options.some((o) => o?.enrich === false),
      "nothing bare was published to begin with",
    ).toBe(true);

    h.options.length = 0;
    h.worktrees.handleMessage(s, { type: "worktreeViewVisibility", visible: true, level: "rows" });
    await settle();

    expect(
      h.options.some((o) => o?.enrich === true),
      "a reopened rail kept the bare presence-only envelope",
    ).toBe(true);
  });

  it("does not re-project when what is published was already enriched", async () => {
    const h = scoped();
    const rows = surface();
    const other = surface();
    attachShown(h.worktrees, rows);
    attachShown(h.worktrees, other);
    h.worktrees.handleMessage(rows, { type: "worktreeViewVisibility", visible: true, level: "rows" });
    h.worktrees.handleMessage(rows, { type: "requestWorktreeTree" });
    await settle();

    h.options.length = 0;
    h.worktrees.handleMessage(other, { type: "worktreeViewVisibility", visible: true, level: "rows" });
    await settle();

    expect(h.options, "an already-enriched envelope was projected again for nothing").toEqual([]);
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
