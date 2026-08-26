// src/providers/WorktreeHost.presence.test.ts — presence published with the
// tree it describes: coalesced, single-flight, and never out of order.
//
// The projector itself is faked. What is under test is the host's publication
// contract — when a projection runs, which result reaches the surface, and what
// a host with no projector does — not the projection's own rules.
//
// See: asimov/changes/project-worktree-agent-presence/design.md D3, D12.

import { describe, expect, it, vi } from "vitest";
import type { ExtensionToWebViewMessage } from "../types/messages";
import { createGitCapabilities } from "../worktree/gitCapabilities";
import type { GitCommandResult, GitCommandRunner } from "../worktree/gitCommandRunner";
import type { PresenceProjector } from "../worktree/presenceProjector";
import type { WorktreePresence } from "../worktree/presenceTypes";
import type { RebuildGateClock } from "../worktree/rebuildGate";
import type { GitApiAccessor } from "../worktree/repoRoots";
import type { WorktreeTreeDeps } from "../worktree/WorktreeDiscovery";
import { createWorktreeHost, PRESENCE_MAX_LATENCY_MS, type WorktreeSurface } from "./WorktreeHost";

function res(over: Partial<GitCommandResult> = {}): GitCommandResult {
  return { code: 0, stdout: Buffer.alloc(0), stderr: "", timedOut: false, failedToSpawn: false, ...over };
}

function nul(...records: string[][]): Buffer {
  return Buffer.from(records.map((f) => `${f.map((x) => `${x}\0`).join("")}\0`).join(""));
}

const MAIN = ["worktree /repo", "HEAD abc", "branch refs/heads/main"];
const A = ["worktree /repo-wt/a", "HEAD def", "branch refs/heads/a"];
const B = ["worktree /repo-wt/b", "HEAD 012", "branch refs/heads/b"];

function oneRepo(...records: string[][]): GitCommandRunner {
  const run = vi.fn(async (args: readonly string[], cwd: string): Promise<GitCommandResult> => {
    if (args[0] === "--version") {
      return res({ stdout: Buffer.from("git version 2.50.1\n") });
    }
    if (cwd !== "/repo") {
      return res({ code: 128, stderr: "fatal: not a git repository" });
    }
    return args[0] === "worktree" ? res({ stdout: nul(...records) }) : res({ stdout: Buffer.from("/repo/.git\n") });
  });
  return { run } as unknown as GitCommandRunner;
}

/** One repo at `/repo` whose `worktree list` result the test can change. */
function changingRepo(...initial: string[][]) {
  let records = initial;
  const run = vi.fn(async (args: readonly string[], cwd: string): Promise<GitCommandResult> => {
    if (args[0] === "--version") {
      return res({ stdout: Buffer.from("git version 2.50.1\n") });
    }
    if (cwd !== "/repo") {
      return res({ code: 128, stderr: "fatal: not a git repository" });
    }
    return args[0] === "worktree" ? res({ stdout: nul(...records) }) : res({ stdout: Buffer.from("/repo/.git\n") });
  });
  return {
    runner: { run } as unknown as GitCommandRunner,
    setRecords: (...next: string[][]) => {
      records = next;
    },
  };
}

const api: GitApiAccessor = () =>
  ({ state: "initialized", repositories: [{ rootUri: { fsPath: "/repo" } }] }) as ReturnType<GitApiAccessor>;

function deps(runner: GitCommandRunner): WorktreeTreeDeps {
  return {
    runner,
    capabilities: createGitCapabilities(runner),
    normalize: async (p: string) => p.replace(/\/+$/, "") || "/",
    stat: async () => undefined,
    getGitApi: api,
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
    pending: () => timers.size,
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

function fakePool() {
  return {
    subscribePattern: () => ({ active: true, dispose: () => {} }),
  };
}

function surface(): WorktreeSurface & { posts: ExtensionToWebViewMessage[] } {
  const posts: ExtensionToWebViewMessage[] = [];
  return { posts, isReady: () => true, post: (m) => posts.push(m) };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function emptyPresence(scannedAt: number): WorktreePresence {
  return { rowsByWorktreeId: {}, scannedAt, degradedSources: [] };
}

/** A projector whose every answer the test controls, counting its projections. */
function fakeProjector() {
  let next: WorktreePresence = emptyPresence(1);
  let ranks: Record<string, number> = {};
  const seen: string[][] = [];

  const projector: PresenceProjector = {
    project: async (worktreeIds) => {
      seen.push([...worktreeIds]);
      return next;
    },
    rank: (id) => ranks[id],
  };

  return {
    projector,
    seen,
    calls: () => seen.length,
    setPresence(presence: WorktreePresence) {
      next = presence;
    },
    setRanks(values: Record<string, number>) {
      ranks = values;
    },
  };
}

/** A projector that parks each projection until the test releases or fails it. */
function blockingProjector() {
  const parked: Array<{ release: (presence: WorktreePresence) => void; fail: (err: Error) => void }> = [];
  const projector: PresenceProjector = {
    project: async () =>
      new Promise<WorktreePresence>((resolve, reject) => {
        parked.push({ release: resolve, fail: reject });
      }),
    rank: () => undefined,
  };
  return { projector, parked };
}

interface HostOptions {
  runner?: GitCommandRunner;
  projector?: PresenceProjector;
}

/** A host already built once, pushing to one surface the window is displaying. */
async function builtHost(options: HostOptions = {}) {
  const runner = options.runner ?? oneRepo(MAIN, A, B);
  const { clock, advance, pending } = fakeClock();
  let notifyPaneChange: (() => void) | undefined;

  const host = createWorktreeHost({
    deps: deps(runner),
    workspaceFolders: () => ["/repo"],
    pool: fakePool(),
    clock,
    projector: options.projector,
    onPaneChange: (listener) => {
      notifyPaneChange = listener;
      return {
        dispose: () => {
          notifyPaneChange = undefined;
        },
      };
    },
    now: () => 1000,
  });

  const view = surface();
  host.attach(view).setDisplayed(true);
  host.handleMessage(view, { type: "worktreeViewVisibility", visible: true });
  host.handleMessage(view, { type: "requestWorktreeTree" });
  await settle();
  view.posts.length = 0;

  return {
    host,
    view,
    advance,
    pending,
    paneChanged: () => notifyPaneChange?.(),
    isSubscribed: () => notifyPaneChange !== undefined,
  };
}

function presencesIn(view: { posts: ExtensionToWebViewMessage[] }): WorktreePresence[] {
  return view.posts
    .filter(
      (m): m is Extract<ExtensionToWebViewMessage, { type: "worktreeTreeResponse" }> =>
        m.type === "worktreeTreeResponse",
    )
    .map((m) => m.presence);
}

describe("presence travels with the tree", () => {
  it("puts the projection on the same message as the tree it describes", async () => {
    const fake = fakeProjector();
    fake.setPresence({ rowsByWorktreeId: { "/repo": [] }, scannedAt: 77, degradedSources: [] });
    const h = await builtHost({ projector: fake.projector });

    h.paneChanged();
    h.advance(PRESENCE_MAX_LATENCY_MS);
    await settle();

    const [post] = h.view.posts;
    expect(post).toMatchObject({ type: "worktreeTreeResponse" });
    expect(presencesIn(h.view)[0]).toMatchObject({ scannedAt: 77 });
    expect((post as { tree: unknown }).tree).toBeDefined();
    h.host.dispose();
  });

  it("projects against the worktrees the cache currently holds", async () => {
    const fake = fakeProjector();
    const h = await builtHost({ projector: fake.projector });
    expect(fake.seen[0]).toEqual(expect.arrayContaining(["/repo", "/repo-wt/a", "/repo-wt/b"]));
    h.host.dispose();
  });

  it("projects before every git-rebuild broadcast, not only on pane changes", async () => {
    const fake = fakeProjector();
    const h = await builtHost({ projector: fake.projector });
    const before = fake.calls();

    h.host.handleMessage(h.view, { type: "requestWorktreeTree", force: true });
    await settle();

    expect(fake.calls()).toBe(before + 1);
    h.host.dispose();
  });
});

describe("coalescing", () => {
  it("turns a burst of pane changes into one push", async () => {
    const fake = fakeProjector();
    const h = await builtHost({ projector: fake.projector });

    for (let i = 0; i < 20; i += 1) {
      h.paneChanged();
    }
    h.advance(PRESENCE_MAX_LATENCY_MS);
    await settle();

    expect(h.view.posts).toHaveLength(1);
    h.host.dispose();
  });

  it("bounds a continuous stream instead of pushing per flush", async () => {
    // A resettable debounce would push the deadline out for as long as output
    // kept arriving, and the row would never move at all. The cap is what makes
    // a stream cost one push per window rather than one per flush.
    const fake = fakeProjector();
    const h = await builtHost({ projector: fake.projector });

    for (let tick = 0; tick < 1000; tick += 1) {
      h.paneChanged();
      h.advance(1);
      await settle();
    }

    const windows = Math.floor(1000 / PRESENCE_MAX_LATENCY_MS);
    expect(h.view.posts.length).toBeLessThanOrEqual(windows + 1);
    expect(h.view.posts.length).toBeGreaterThan(0);
    h.host.dispose();
  });

  it("does not push the cap out when a later change arrives inside it", async () => {
    const fake = fakeProjector();
    const h = await builtHost({ projector: fake.projector });

    h.paneChanged();
    h.advance(PRESENCE_MAX_LATENCY_MS - 1);
    h.paneChanged();
    h.advance(1);
    await settle();

    expect(h.view.posts).toHaveLength(1);
    h.host.dispose();
  });

  it("ignores a pane change before the first build, which projects for itself", async () => {
    const fake = fakeProjector();
    const { clock, advance } = fakeClock();
    let notify: (() => void) | undefined;
    const host = createWorktreeHost({
      deps: deps(oneRepo(MAIN)),
      workspaceFolders: () => ["/repo"],
      pool: fakePool(),
      clock,
      projector: fake.projector,
      onPaneChange: (listener) => {
        notify = listener;
        return { dispose: () => {} };
      },
    });
    notify?.();
    advance(PRESENCE_MAX_LATENCY_MS);
    await settle();
    expect(fake.calls()).toBe(0);
    host.dispose();
  });
});

describe("a push never replaces newer state with older", () => {
  it("re-projects rather than publishing a result the rebuild has overtaken", async () => {
    const blocking = blockingProjector();
    const h = await builtHost({ projector: blocking.projector });
    // The build's own projection is parked too; release it so the host is idle.
    blocking.parked.shift()?.release(emptyPresence(1));
    await settle();
    h.view.posts.length = 0;

    h.paneChanged();
    h.advance(PRESENCE_MAX_LATENCY_MS);
    await settle();
    const stale = blocking.parked.shift();

    // A git rebuild moves the tree while that projection is still out.
    h.host.handleMessage(h.view, { type: "requestWorktreeTree", force: true });
    await settle();

    stale?.release(emptyPresence(100));
    await settle();

    // Not dropped — re-run against the tree that superseded it.
    expect(blocking.parked).toHaveLength(1);
    blocking.parked.shift()?.release(emptyPresence(200));
    await settle();

    const published = presencesIn(h.view).map((p) => p.scannedAt);
    expect(published).not.toContain(100);
    expect(published.at(-1)).toBe(200);
    h.host.dispose();
  });

  it("never enters the projector twice at once", async () => {
    // The projector holds per-pane slots and per-row timestamps. Two concurrent
    // projections interleave writes to those maps, and the older can commit last.
    const blocking = blockingProjector();
    const h = await builtHost({ projector: blocking.projector });
    blocking.parked.shift()?.release(emptyPresence(1));
    await settle();

    h.paneChanged();
    h.advance(PRESENCE_MAX_LATENCY_MS);
    await settle();
    h.host.handleMessage(h.view, { type: "requestWorktreeTree", force: true });
    h.paneChanged();
    h.advance(PRESENCE_MAX_LATENCY_MS);
    await settle();

    expect(blocking.parked).toHaveLength(1);
    h.host.dispose();
  });

  it("does not let a cached tree request swallow a pane projection", async () => {
    // A delivery attempt is not a tree move. Versioning on broadcasts made a
    // cached request — or one that posted to nobody — invalidate real work.
    const blocking = blockingProjector();
    const h = await builtHost({ projector: blocking.projector });
    blocking.parked.shift()?.release(emptyPresence(1));
    await settle();
    h.view.posts.length = 0;

    h.paneChanged();
    h.advance(PRESENCE_MAX_LATENCY_MS);
    await settle();
    const inFlight = blocking.parked.shift();

    h.host.handleMessage(h.view, { type: "requestWorktreeTree" });
    await settle();

    inFlight?.release(emptyPresence(42));
    await settle();

    expect(presencesIn(h.view).map((p) => p.scannedAt)).toContain(42);
    expect(blocking.parked).toHaveLength(0);
    h.host.dispose();
  });

  it("re-runs once for a change that arrived while a projection was in flight", async () => {
    const blocking = blockingProjector();
    const h = await builtHost({ projector: blocking.projector });
    blocking.parked.shift()?.release(emptyPresence(1));
    await settle();

    h.paneChanged();
    h.advance(PRESENCE_MAX_LATENCY_MS);
    await settle();
    expect(blocking.parked).toHaveLength(1);

    // Arrives mid-projection: it must not start a second concurrent one, and it
    // must not be swallowed either.
    h.paneChanged();
    h.advance(PRESENCE_MAX_LATENCY_MS);
    await settle();
    expect(blocking.parked).toHaveLength(1);

    blocking.parked.shift()?.release(emptyPresence(2));
    await settle();
    expect(blocking.parked).toHaveLength(1);
    h.host.dispose();
  });
});

describe("the envelope is committed, not assembled at delivery", () => {
  const worktreesIn = (post: ExtensionToWebViewMessage | undefined) =>
    (post as { tree: { repos: { worktrees: { id: string }[] }[] } }).tree.repos.flatMap((r) =>
      r.worktrees.map((w) => w.id),
    );

  /**
   * A host whose tree has just lost a worktree, with the rebuild's projection
   * still parked — so the cache and the last projection disagree.
   */
  async function treeMovedAheadOfPresence() {
    const repo = changingRepo(MAIN, A, B);
    const blocking = blockingProjector();
    const h = await builtHost({ projector: blocking.projector, runner: repo.runner });
    blocking.parked.shift()?.release({
      rowsByWorktreeId: { "/repo-wt/b": [] },
      scannedAt: 1,
      degradedSources: [],
    });
    await settle();
    h.view.posts.length = 0;

    repo.setRecords(MAIN, A);
    h.host.handleMessage(h.view, { type: "requestWorktreeTree", force: true });
    await settle();
    return { h, blocking };
  }

  it("serves a cached tree request from the last committed pair, not the live cache", async () => {
    const { h, blocking } = await treeMovedAheadOfPresence();

    h.host.handleMessage(h.view, { type: "requestWorktreeTree" });
    await settle();

    // The presence still names /repo-wt/b, so the tree beside it must too.
    for (const post of h.view.posts) {
      const named = Object.keys((post as { presence: WorktreePresence }).presence.rowsByWorktreeId);
      expect(worktreesIn(post)).toEqual(expect.arrayContaining(named));
    }
    blocking.parked.shift()?.release(emptyPresence(2));
    h.host.dispose();
  });

  it("serves a surface that becomes displayed from the same committed pair", async () => {
    const { h, blocking } = await treeMovedAheadOfPresence();
    const second = surface();
    const attachment = h.host.attach(second);
    h.host.handleMessage(second, { type: "worktreeViewVisibility", visible: true });
    attachment.setDisplayed(true);
    await settle();

    for (const post of second.posts) {
      const named = Object.keys((post as { presence: WorktreePresence }).presence.rowsByWorktreeId);
      expect(worktreesIn(post)).toEqual(expect.arrayContaining(named));
    }
    blocking.parked.shift()?.release(emptyPresence(2));
    h.host.dispose();
  });

  it("publishes nothing while the projection is behind the tree", async () => {
    const { h, blocking } = await treeMovedAheadOfPresence();
    expect(h.view.posts).toHaveLength(0);

    blocking.parked.shift()?.release(emptyPresence(5));
    await settle();
    expect(presencesIn(h.view).map((p) => p.scannedAt)).toEqual([5]);
    expect(worktreesIn(h.view.posts.at(-1))).toEqual(["/repo", "/repo-wt/a"]);
    h.host.dispose();
  });

  it("publishes nothing when the projection throws, rather than pairing the new tree with old presence", async () => {
    const { h, blocking } = await treeMovedAheadOfPresence();

    blocking.parked.shift()?.fail(new Error("projector blew up"));
    await settle();

    expect(h.view.posts).toHaveLength(0);
    h.host.dispose();
  });

  it("publishes once when two callers join the same projection cycle", async () => {
    // Single-flight projection is not single-flight publication: both callers
    // used to attach their own broadcast to the one promise they shared.
    const blocking = blockingProjector();
    const h = await builtHost({ projector: blocking.projector });
    blocking.parked.shift()?.release(emptyPresence(1));
    await settle();
    h.view.posts.length = 0;

    h.paneChanged();
    h.advance(PRESENCE_MAX_LATENCY_MS);
    await settle();
    h.host.handleMessage(h.view, { type: "requestWorktreeTree", force: true });
    await settle();

    blocking.parked.shift()?.release(emptyPresence(3));
    await settle();
    blocking.parked.shift()?.release(emptyPresence(3));
    await settle();

    expect(presencesIn(h.view).filter((p) => p.scannedAt === 3)).toHaveLength(1);
    h.host.dispose();
  });
});

describe("the first build has no envelope to deliver", () => {
  /** A projector-backed host whose very first projection is still parked. */
  async function firstBuildPending() {
    const blocking = blockingProjector();
    const { clock, advance } = fakeClock();
    const host = createWorktreeHost({
      deps: deps(oneRepo(MAIN, A, B)),
      workspaceFolders: () => ["/repo"],
      pool: fakePool(),
      clock,
      projector: blocking.projector,
      now: () => 1000,
    });
    const view = surface();
    const attachment = host.attach(view);
    attachment.setDisplayed(true);
    host.handleMessage(view, { type: "worktreeViewVisibility", visible: true });
    host.handleMessage(view, { type: "requestWorktreeTree" });
    await settle();
    // The cache is written and `built` is true; the projection is not back.
    expect(blocking.parked).toHaveLength(1);
    expect(view.posts).toHaveLength(0);
    return { host, view, blocking, advance };
  }

  it("answers a cached request by finishing the projection, not by sending half an envelope", async () => {
    const { host, view, blocking } = await firstBuildPending();

    host.handleMessage(view, { type: "requestWorktreeTree" });
    await settle();
    expect(view.posts).toHaveLength(0);

    blocking.parked.shift()?.release({ rowsByWorktreeId: { "/repo-wt/a": [] }, scannedAt: 9, degradedSources: [] });
    await settle();

    expect(presencesIn(view).map((p) => p.scannedAt)).toEqual([9]);
    expect(Object.keys(presencesIn(view)[0].rowsByWorktreeId)).toEqual(["/repo-wt/a"]);
    host.dispose();
  });

  it("does not serve a surface that becomes displayed before the first commit", async () => {
    const { host, blocking } = await firstBuildPending();
    const second = surface();
    const attachment = host.attach(second);
    host.handleMessage(second, { type: "worktreeViewVisibility", visible: true });
    attachment.setDisplayed(true);
    await settle();
    expect(second.posts).toHaveLength(0);

    // The commit reaches it, because it is showing by then.
    blocking.parked.shift()?.release(emptyPresence(9));
    await settle();
    expect(second.posts).toHaveLength(1);
    host.dispose();
  });

  it("a host with no projector still serves its first build immediately", async () => {
    const h = await builtHost();
    h.host.handleMessage(h.view, { type: "requestWorktreeTree" });
    await settle();
    expect(h.view.posts.length).toBeGreaterThan(0);
    h.host.dispose();
  });
});

describe("a failed projection cycle", () => {
  it("publishes nothing when the failure changed no tree", async () => {
    // The previous envelope's tree version still matches, so an unconditional
    // commit would republish it as if the projection had succeeded.
    const blocking = blockingProjector();
    const h = await builtHost({ projector: blocking.projector });
    blocking.parked.shift()?.release(emptyPresence(1));
    await settle();
    h.view.posts.length = 0;

    h.paneChanged();
    h.advance(PRESENCE_MAX_LATENCY_MS);
    await settle();
    blocking.parked.shift()?.fail(new Error("pane read blew up"));
    await settle();

    expect(h.view.posts).toHaveLength(0);
    h.host.dispose();
  });

  it("re-runs the work a caller joined onto a run that then failed", async () => {
    const blocking = blockingProjector();
    const h = await builtHost({ projector: blocking.projector });
    blocking.parked.shift()?.release(emptyPresence(1));
    await settle();
    h.view.posts.length = 0;

    h.paneChanged();
    h.advance(PRESENCE_MAX_LATENCY_MS);
    await settle();
    const doomed = blocking.parked.shift();

    // A rebuild joins the run that is about to fail.
    h.host.handleMessage(h.view, { type: "requestWorktreeTree", force: true });
    await settle();

    doomed?.fail(new Error("blew up"));
    await settle();

    // Its work is not done just because the promise it awaited resolved.
    expect(blocking.parked).toHaveLength(1);
    blocking.parked.shift()?.release(emptyPresence(7));
    await settle();
    expect(presencesIn(h.view).map((p) => p.scannedAt)).toEqual([7]);
    h.host.dispose();
  });
});

describe("ranking", () => {
  it("orders the listing by the projector's rank", async () => {
    const fake = fakeProjector();
    fake.setRanks({ "/repo-wt/b": 500 });
    const h = await builtHost({ projector: fake.projector });

    h.host.handleMessage(h.view, { type: "requestWorktreeTree", force: true });
    await settle();

    const tree = (h.view.posts.at(-1) as { tree: { repos: { worktrees: { id: string }[] }[] } }).tree;
    const ids = tree.repos[0].worktrees.map((w) => w.id);
    // main first, then the ranked worktree, then the unranked one.
    expect(ids).toEqual(["/repo", "/repo-wt/b", "/repo-wt/a"]);
    h.host.dispose();
  });

  it("keeps the unranked order when no projector is supplied", async () => {
    const h = await builtHost();
    h.host.handleMessage(h.view, { type: "requestWorktreeTree", force: true });
    await settle();
    const tree = (h.view.posts.at(-1) as { tree: { repos: { worktrees: { id: string }[] }[] } }).tree;
    expect(tree.repos[0].worktrees.map((w) => w.id)).toEqual(["/repo", "/repo-wt/a", "/repo-wt/b"]);
    h.host.dispose();
  });
});

describe("a host with no projector", () => {
  it("still sends the empty presence envelope with every tree", async () => {
    const h = await builtHost();
    h.host.handleMessage(h.view, { type: "requestWorktreeTree" });
    await settle();
    expect(presencesIn(h.view)[0]).toEqual({ rowsByWorktreeId: {}, scannedAt: 1000, degradedSources: [] });
    h.host.dispose();
  });

  it("arms nothing when a pane changes", async () => {
    const h = await builtHost();
    h.paneChanged();
    h.advance(PRESENCE_MAX_LATENCY_MS);
    await settle();
    expect(h.view.posts).toHaveLength(0);
    h.host.dispose();
  });
});

describe("disposal", () => {
  it("cancels a pending presence rebuild", async () => {
    const fake = fakeProjector();
    const h = await builtHost({ projector: fake.projector });
    const before = fake.calls();

    h.paneChanged();
    h.host.dispose();
    h.advance(PRESENCE_MAX_LATENCY_MS);
    await settle();

    expect(fake.calls()).toBe(before);
    expect(h.pending()).toBe(0);
    expect(h.view.posts).toHaveLength(0);
  });

  it("drops the pane subscription", async () => {
    const fake = fakeProjector();
    const h = await builtHost({ projector: fake.projector });
    h.host.dispose();
    expect(h.isSubscribed()).toBe(false);
  });

  it("publishes nothing from a projection that returns after disposal", async () => {
    const blocking = blockingProjector();
    const h = await builtHost({ projector: blocking.projector });
    blocking.parked.shift()?.release(emptyPresence(1));
    await settle();

    h.paneChanged();
    h.advance(PRESENCE_MAX_LATENCY_MS);
    await settle();
    const parked = blocking.parked.shift();

    h.host.dispose();
    h.view.posts.length = 0;
    parked?.release(emptyPresence(9));
    await settle();

    expect(h.view.posts).toHaveLength(0);
  });
});
