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
import {
  createWorktreeHost,
  EXTERNAL_SCAN_INTERVAL_MS,
  PRESENCE_MAX_LATENCY_MS,
  type WorktreeSurface,
} from "./WorktreeHost";

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

/** One repo at `/repo` whose `worktree list` the test can break, degrading it. */
function breakableRepo(...records: string[][]) {
  let broken = false;
  const run = vi.fn(async (args: readonly string[], cwd: string): Promise<GitCommandResult> => {
    if (args[0] === "--version") {
      return res({ stdout: Buffer.from("git version 2.50.1\n") });
    }
    if (cwd !== "/repo") {
      return res({ code: 128, stderr: "fatal: not a git repository" });
    }
    if (args[0] !== "worktree") {
      return res({ stdout: Buffer.from("/repo/.git\n") });
    }
    return broken ? res({ code: 128, stderr: "fatal: could not read worktrees" }) : res({ stdout: nul(...records) });
  });
  return {
    runner: { run } as unknown as GitCommandRunner,
    break: () => {
      broken = true;
    },
  };
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
        // Re-checked: a timer cleared from inside an earlier callback in this
        // same tick must not still fire, which is what real clearTimeout does.
        if (!timers.has(id)) {
          continue;
        }
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

  const modes: Array<boolean> = [];
  let rankLookups = 0;
  let revision = 0;

  const projector: PresenceProjector = {
    project: async (worktreeIds, options) => {
      seen.push([...worktreeIds]);
      modes.push(options?.external === true);
      return next;
    },
    rank: (id) => {
      rankLookups += 1;
      return ranks[id];
    },
    rankRevision: () => revision,
    claimedSessionIds: () => new Set<string>(),
  };

  return {
    projector,
    seen,
    /** How many times the ordering key has been asked for. */
    rankLookups: () => rankLookups,
    /** Whether each projection, in order, was the external-only pass. */
    modes,
    calls: () => seen.length,
    setPresence(presence: WorktreePresence) {
      next = presence;
    },
    setRanks(values: Record<string, number>) {
      ranks = values;
    },
    /** Move the ranking the projector publishes, as a projection would. */
    bumpRevision() {
      revision += 1;
    },
  };
}

/** A projector that parks each projection until the test releases or fails it. */
function blockingProjector() {
  const parked: Array<{ release: (presence: WorktreePresence) => void; fail: (err: Error) => void }> = [];
  /** Whether each projection, in order, was the external-only pass. */
  const modes: Array<boolean> = [];
  /** Whether each projection, in order, was asked to enrich its rows. */
  const enriched: Array<boolean> = [];
  const projector: PresenceProjector = {
    project: async (_worktreeIds, options) => {
      modes.push(options?.external === true);
      enriched.push(options?.enrich === true);
      return new Promise<WorktreePresence>((resolve, reject) => {
        parked.push({ release: resolve, fail: reject });
      });
    },
    rank: () => undefined,
    rankRevision: () => 0,
    claimedSessionIds: () => new Set<string>(),
  };
  return { projector, parked, modes, enriched };
}

interface HostOptions {
  runner?: GitCommandRunner;
  projector?: PresenceProjector;
  /** What the first surface declares it draws. Omitted means rows. */
  level?: "rows" | "presence";
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
  const attachment = host.attach(view);
  attachment.setDisplayed(true);
  host.handleMessage(view, {
    type: "worktreeViewVisibility",
    visible: true,
    ...(options.level === undefined ? {} : { level: options.level }),
  });
  host.handleMessage(view, { type: "requestWorktreeTree" });
  await settle();
  view.posts.length = 0;

  /** Attach a second surface, already showing the view. */
  function showAnother() {
    const other = surface();
    const otherAttachment = host.attach(other);
    otherAttachment.setDisplayed(true);
    host.handleMessage(other, { type: "worktreeViewVisibility", visible: true });
    return { other, attachment: otherAttachment };
  }

  return {
    host,
    view,
    attachment,
    showAnother,
    hide: () => host.handleMessage(view, { type: "worktreeViewVisibility", visible: false }),
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

describe("a committed projection reorders the tree it is published with", () => {
  /** The worktree ids of the last tree posted to `view`, in published order. */
  function orderIn(view: { posts: ExtensionToWebViewMessage[] }): string[] {
    const posts = view.posts.filter(
      (m): m is Extract<ExtensionToWebViewMessage, { type: "worktreeTreeResponse" }> =>
        m.type === "worktreeTreeResponse",
    );
    const last = posts[posts.length - 1];
    return last ? last.tree.repos.flatMap((repo) => repo.worktrees.map((w) => w.id)) : [];
  }

  it("moves a worktree that gained activity, with no git rebuild behind it", async () => {
    // Order is baked into the cache at assemble time. A presence-only projection
    // never re-reads git, so without the re-rank the newly active worktree stays
    // where the last git listing put it (design.md D8).
    const fake = fakeProjector();
    const h = await builtHost({ projector: fake.projector });
    expect(orderIn(h.view)).toEqual([]);

    fake.setRanks({ "/repo-wt/b": 900 });
    fake.bumpRevision();
    h.paneChanged();
    h.advance(PRESENCE_MAX_LATENCY_MS);
    await settle();

    expect(orderIn(h.view)).toEqual(["/repo", "/repo-wt/b", "/repo-wt/a"]);
    h.host.dispose();
  });

  it("leaves the order alone when the projection reports the ranking unchanged", async () => {
    // The poll runs every 5 s and almost never moves anything. Re-sorting every
    // group per poll prices the copy and the comparator on a tree that is
    // already in order; the projector knows for free whether it moved
    // (.reviews/round-2.md W2).
    const fake = fakeProjector();
    const h = await builtHost({ projector: fake.projector });
    const before = fake.rankLookups();

    h.advance(EXTERNAL_SCAN_INTERVAL_MS);
    await settle();

    expect(fake.rankLookups()).toBe(before);
    h.host.dispose();
  });

  it("does not acknowledge a rank change on a cache write that did not apply it", async () => {
    // Only `reorder` orders the whole cache. `merge` deliberately RETAINS the
    // stored worktree array for a degraded listing, so a rebuild can write the
    // cache without establishing the captured ranking — and a marker advanced
    // there leaves the old order with no mismatch left to notice
    // (.reviews/round-3.md B3, design.md D12).
    const repo = breakableRepo(MAIN, A, B);
    const fake = fakeProjector();
    const h = await builtHost({ projector: fake.projector, runner: repo.runner });

    fake.setRanks({ "/repo-wt/b": 900 });
    fake.bumpRevision();
    repo.break();
    h.host.handleMessage(h.view, { type: "requestWorktreeTree", force: true });
    await settle();

    expect(orderIn(h.view)).toEqual(["/repo", "/repo-wt/b", "/repo-wt/a"]);
    h.host.dispose();
  });

  it("moves it back when the activity goes away", async () => {
    const fake = fakeProjector();
    const h = await builtHost({ projector: fake.projector });

    fake.setRanks({ "/repo-wt/b": 900 });
    fake.bumpRevision();
    h.paneChanged();
    h.advance(PRESENCE_MAX_LATENCY_MS);
    await settle();
    expect(orderIn(h.view)).toEqual(["/repo", "/repo-wt/b", "/repo-wt/a"]);

    fake.setRanks({});
    fake.bumpRevision();
    h.paneChanged();
    h.advance(PRESENCE_MAX_LATENCY_MS);
    await settle();

    expect(orderIn(h.view)).toEqual(["/repo", "/repo-wt/a", "/repo-wt/b"]);
    h.host.dispose();
  });
});

describe("the external scan is paced, and only while the view is shown", () => {
  it("polls on the interval, and asks for the external-only pass", async () => {
    // A full projection every 5 s would re-resolve every pane with no proven
    // identity — negatives are deliberately not cached — and shell out to `ps`
    // forever (design.md D6).
    const fake = fakeProjector();
    const h = await builtHost({ projector: fake.projector });
    const before = fake.calls();

    h.advance(EXTERNAL_SCAN_INTERVAL_MS);
    await settle();

    expect(fake.calls()).toBe(before + 1);
    expect(fake.modes[fake.modes.length - 1]).toBe(true);
    h.host.dispose();
  });

  it("keeps polling — one fire does not end the schedule", async () => {
    const fake = fakeProjector();
    const h = await builtHost({ projector: fake.projector });
    const before = fake.calls();

    h.advance(EXTERNAL_SCAN_INTERVAL_MS);
    await settle();
    h.advance(EXTERNAL_SCAN_INTERVAL_MS);
    await settle();

    expect(fake.calls()).toBe(before + 2);
    h.host.dispose();
  });

  it("stops when the only surface stops showing the view", async () => {
    const fake = fakeProjector();
    const h = await builtHost({ projector: fake.projector });

    h.hide();
    const before = fake.calls();
    h.advance(EXTERNAL_SCAN_INTERVAL_MS * 4);
    await settle();

    expect(fake.calls()).toBe(before);
    h.host.dispose();
  });

  it("keeps polling while a second surface still shows it", async () => {
    // "Showing on at least one surface" is a window-level fact; three surfaces
    // render this view independently.
    const fake = fakeProjector();
    const h = await builtHost({ projector: fake.projector });
    h.showAnother();

    h.hide();
    const before = fake.calls();
    h.advance(EXTERNAL_SCAN_INTERVAL_MS);
    await settle();

    expect(fake.calls()).toBe(before + 1);
    h.host.dispose();
  });

  it("stops when the last showing surface DETACHES rather than hides", async () => {
    // Reconciling only on the visibility and displayed edges leaves the timer
    // armed forever when the surface is disposed out from under it.
    const fake = fakeProjector();
    const h = await builtHost({ projector: fake.projector });

    h.attachment.dispose();
    const before = fake.calls();
    h.advance(EXTERNAL_SCAN_INTERVAL_MS * 4);
    await settle();

    expect(fake.calls()).toBe(before);
    h.host.dispose();
  });

  it("leaves no timer behind when the host is disposed", async () => {
    const fake = fakeProjector();
    const h = await builtHost({ projector: fake.projector });

    h.host.dispose();

    expect(h.pending()).toBe(0);
  });

  it("does not poll at all in a host with no projector", async () => {
    const h = await builtHost();
    h.view.posts.length = 0;

    h.advance(EXTERNAL_SCAN_INTERVAL_MS * 3);
    await settle();

    expect(h.view.posts).toHaveLength(0);
    h.host.dispose();
  });

  it("absorbs a pane cap the poll already covers, rather than projecting twice", async () => {
    // The cap and the poll landing together used to serialize into two
    // back-to-back projections and two publications.
    const fake = fakeProjector();
    const h = await builtHost({ projector: fake.projector });
    const before = fake.calls();

    h.paneChanged();
    h.advance(EXTERNAL_SCAN_INTERVAL_MS);
    await settle();
    h.advance(PRESENCE_MAX_LATENCY_MS);
    await settle();

    expect(fake.calls()).toBe(before + 1);
    h.host.dispose();
  });

  it("projects the PANES it absorbed, not just something", async () => {
    // Absorbing the cap into an external-only pass drops the pane evidence that
    // armed it — the pane pass is exactly what that mode skips. Counting
    // projections cannot see this; only the mode can (.reviews/round-1.md B1).
    const fake = fakeProjector();
    const h = await builtHost({ projector: fake.projector });

    h.paneChanged();
    h.advance(EXTERNAL_SCAN_INTERVAL_MS);
    await settle();

    expect(fake.modes[fake.modes.length - 1]).toBe(false);
    h.host.dispose();
  });

  it("re-runs a full pass when pane evidence lands during an external-only projection", async () => {
    // Joining without dirtying is right for a poll and wrong for pane evidence:
    // the run in flight is skipping the very panes that just changed.
    const blocking = blockingProjector();
    const h = await builtHost({ projector: blocking.projector });
    blocking.parked[0].release(emptyPresence(1));
    await settle();
    const before = blocking.parked.length;

    h.advance(EXTERNAL_SCAN_INTERVAL_MS);
    await settle();
    expect(blocking.parked).toHaveLength(before + 1);

    h.paneChanged();
    h.advance(PRESENCE_MAX_LATENCY_MS);
    await settle();
    blocking.parked[before].release(emptyPresence(2));
    await settle();

    expect(blocking.parked).toHaveLength(before + 2);
    h.host.dispose();
  });

  it("leaves the next scan in full mode when the absorbed projection rejects", async () => {
    // The cap is cancelled the moment the scan absorbs it, so a projection that
    // then rejects strands the pane evidence that armed it: the next scan reads
    // a cleared cap and polls external-only forever. The evidence has to outlive
    // the cap, and only a full projection that COMPLETED may clear it
    // (.reviews/round-2.md B1).
    const blocking = blockingProjector();
    const h = await builtHost({ projector: blocking.projector });
    blocking.parked[0].release(emptyPresence(1));
    await settle();

    h.paneChanged();
    h.advance(EXTERNAL_SCAN_INTERVAL_MS);
    await settle();
    expect(blocking.modes[blocking.modes.length - 1]).toBe(false);
    blocking.parked[blocking.parked.length - 1].fail(new Error("projector blew up"));
    await settle();

    h.advance(EXTERNAL_SCAN_INTERVAL_MS);
    await settle();

    expect(blocking.modes[blocking.modes.length - 1]).toBe(false);
    h.host.dispose();
  });

  it("keeps the evidence outstanding when it arrives after the pass in flight read the panes", async () => {
    // A boolean says evidence EXISTS; the question is whether THIS pass saw it.
    // A pane event landing while a full projection is already running is
    // indistinguishable from one that landed before it, so the pass clears a
    // flag it never honoured and the next scan polls external-only
    // (.reviews/round-3.md B1, design.md D11).
    const blocking = blockingProjector();
    const h = await builtHost({ projector: blocking.projector });
    blocking.parked[0].release(emptyPresence(1));
    await settle();

    h.paneChanged();
    h.advance(PRESENCE_MAX_LATENCY_MS);
    await settle();
    expect(blocking.modes[blocking.modes.length - 1]).toBe(false);

    h.paneChanged();
    blocking.parked[blocking.parked.length - 1].release(emptyPresence(2));
    await settle();

    h.advance(EXTERNAL_SCAN_INTERVAL_MS);
    await settle();

    expect(blocking.modes[blocking.modes.length - 1]).toBe(false);
    h.host.dispose();
  });

  it("returns to the external-only pass once a full projection has consumed the evidence", async () => {
    // The other half of the same rule: a flag that is never cleared turns every
    // poll into the full pass D6 exists to avoid.
    const blocking = blockingProjector();
    const h = await builtHost({ projector: blocking.projector });
    blocking.parked[0].release(emptyPresence(1));
    await settle();

    h.paneChanged();
    h.advance(EXTERNAL_SCAN_INTERVAL_MS);
    await settle();
    blocking.parked[blocking.parked.length - 1].release(emptyPresence(2));
    await settle();

    h.advance(EXTERNAL_SCAN_INTERVAL_MS);
    await settle();

    expect(blocking.modes[blocking.modes.length - 1]).toBe(true);
    h.host.dispose();
  });

  it("follows a bare pass promoted mid-flight with exactly one enriching pass", async () => {
    // A promotion arriving during a pass joins a run that already decided not to
    // enrich, and `join` deliberately does not dirty it — so without the run's
    // own invariant, nothing follows and the window keeps the bare envelope.
    const blocking = blockingProjector();
    const h = await builtHost({ projector: blocking.projector, level: "presence" });
    blocking.parked[0].release(emptyPresence(1));
    await settle();

    h.advance(EXTERNAL_SCAN_INTERVAL_MS);
    await settle();
    const bareAt = blocking.parked.length - 1;
    expect(blocking.enriched[bareAt]).toBe(false);

    h.host.handleMessage(h.view, { type: "worktreeViewVisibility", visible: true, level: "rows" });
    await settle();
    blocking.parked[bareAt].release(emptyPresence(2));
    await settle();

    expect(blocking.parked.length - 1 - bareAt, "the promotion bought no pass, or more than one").toBe(1);
    expect(blocking.enriched[blocking.enriched.length - 1], "the follow-up pass did not enrich").toBe(true);
    h.host.dispose();
  });

  it("follows the very FIRST bare pass too, where the remembered flag still reads true", async () => {
    // `projectedEnriched` starts life `true`, which suppressed the old inline
    // check outright during the first pass. The invariant reads the flag only
    // after a pass has set it, so this case stopped being special.
    const blocking = blockingProjector();
    const h = await builtHost({ projector: blocking.projector, level: "presence" });
    expect(blocking.enriched[0]).toBe(false);

    h.host.handleMessage(h.view, { type: "worktreeViewVisibility", visible: true, level: "rows" });
    await settle();
    blocking.parked[0].release(emptyPresence(1));
    await settle();

    expect(blocking.parked).toHaveLength(2);
    expect(blocking.enriched[1]).toBe(true);
    h.host.dispose();
  });

  it("resolves a promotion without spinning", async () => {
    // The bound is one promotion-CAUSED follow-up. "It terminates" does not
    // discriminate — today's code terminates too, by doing nothing.
    const blocking = blockingProjector();
    const h = await builtHost({ projector: blocking.projector, level: "presence" });
    h.host.handleMessage(h.view, { type: "worktreeViewVisibility", visible: true, level: "rows" });
    await settle();

    for (let i = 0; i < 5 && i < blocking.parked.length; i += 1) {
      blocking.parked[i].release(emptyPresence(i + 1));
      await settle();
    }

    expect(blocking.parked.length, "the enrichment obligation re-armed itself").toBe(2);
    h.host.dispose();
  });

  it("still consumes pane evidence when a promotion lands during the full pass", async () => {
    // The obligation must not look like invalidation: a clean full pass that is
    // marked dirty for enrichment stops advancing the applied-evidence mark, and
    // every later scan then runs full for no reason.
    const blocking = blockingProjector();
    const h = await builtHost({ projector: blocking.projector, level: "presence" });
    blocking.parked[0].release(emptyPresence(1));
    await settle();

    h.paneChanged();
    h.advance(PRESENCE_MAX_LATENCY_MS);
    await settle();
    const fullAt = blocking.parked.length - 1;
    expect(blocking.modes[fullAt], "expected the full pass the evidence asks for").toBe(false);

    h.host.handleMessage(h.view, { type: "worktreeViewVisibility", visible: true, level: "rows" });
    await settle();
    blocking.parked[fullAt].release(emptyPresence(2));
    await settle();
    blocking.parked[blocking.parked.length - 1].release(emptyPresence(3));
    await settle();

    h.advance(EXTERNAL_SCAN_INTERVAL_MS);
    await settle();

    expect(blocking.modes[blocking.modes.length - 1], "the scan reverted to a full pass").toBe(true);
    h.host.dispose();
  });

  it("keeps a rerun full when a promotion races new pane evidence", async () => {
    // An already-invalidated pass needs no help from the obligation, and forcing
    // it external-only would make the rerun skip exactly the panes the evidence
    // exists to read.
    const blocking = blockingProjector();
    const h = await builtHost({ projector: blocking.projector, level: "presence" });
    blocking.parked[0].release(emptyPresence(1));
    await settle();

    h.advance(EXTERNAL_SCAN_INTERVAL_MS);
    await settle();
    const bareAt = blocking.parked.length - 1;
    expect(blocking.modes[bareAt], "expected the external-only poll").toBe(true);

    h.paneChanged();
    h.advance(PRESENCE_MAX_LATENCY_MS);
    h.host.handleMessage(h.view, { type: "worktreeViewVisibility", visible: true, level: "rows" });
    await settle();
    blocking.parked[bareAt].release(emptyPresence(2));
    await settle();

    expect(blocking.modes[blocking.modes.length - 1], "the rerun was downgraded to skip the panes").toBe(false);
    expect(blocking.enriched[blocking.enriched.length - 1]).toBe(true);
    h.host.dispose();
  });

  it("joins a projection already in flight instead of dirtying it", async () => {
    // A poll carries no new pane evidence. Marking the run in flight dirty would
    // make it loop once more on release — a second projection bought to answer a
    // scan the first one was already performing.
    const blocking = blockingProjector();
    const h = await builtHost({ projector: blocking.projector });
    expect(blocking.parked).toHaveLength(1);

    h.advance(EXTERNAL_SCAN_INTERVAL_MS);
    await settle();
    blocking.parked[0].release(emptyPresence(9));
    await settle();

    expect(blocking.parked).toHaveLength(1);
    h.host.dispose();
  });
});

describe("what counts as showing, for the scan", () => {
  it("keeps polling for a surface whose first post could not be delivered", async () => {
    // `state.showing` records whether a post actually landed — it stays false
    // after one that was skipped as not-ready or that threw. Pacing the scan off
    // it would silently stop scanning for a surface that is showing the view.
    const fake = fakeProjector();
    const h = await builtHost({ projector: fake.projector });

    const late: WorktreeSurface & { posts: ExtensionToWebViewMessage[] } = {
      posts: [],
      isReady: () => false,
      post(m) {
        this.posts.push(m);
      },
    };
    const lateAttachment = h.host.attach(late);
    h.host.handleMessage(late, { type: "worktreeViewVisibility", visible: true });
    lateAttachment.setDisplayed(true);
    expect(late.posts).toHaveLength(0);

    // The surface that DID take a post goes away; only the undeliverable one is
    // left, and it is showing the view.
    h.attachment.dispose();
    const before = fake.calls();
    h.advance(EXTERNAL_SCAN_INTERVAL_MS);
    await settle();

    expect(fake.calls()).toBe(before + 1);
    h.host.dispose();
  });
});
