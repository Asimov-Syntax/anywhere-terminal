// src/providers/WorktreeHost.scale.test.ts — Burst and stream bounds on ONE joined path.
// See design.md D3, docs/design/worktree-model.md § 7.
//
// The pool's debounce and the gate's floor were each covered alone. Composed they are a
// different claim, and the composition is where a fixture can lie: the pool's debounce is
// trailing and resets per event (fsWatcherPool.ts), so a stream paced faster than 150 ms
// delivers NOTHING until it stops. A test pacing at 10 ms would see one rebuild while never
// reaching the floor it claims to test. Every stream here is paced above DEBOUNCE_MS and
// below REBUILD_FLOOR_MS, so both mechanisms are actually exercised.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { GIT_INVOCATIONS_PER_BURST } from "../test/invariants/budgets";
import { createGitCapabilities } from "../worktree/gitCapabilities";
import type { GitCommandResult, GitCommandRunner } from "../worktree/gitCommandRunner";
import type { RebuildGateClock } from "../worktree/rebuildGate";
import { REBUILD_FLOOR_MS } from "../worktree/rebuildGate";
import type { GitApiAccessor } from "../worktree/repoRoots";
import type { WorktreeTreeDeps } from "../worktree/WorktreeDiscovery";
import { createWatcherPool, DEBOUNCE_MS } from "./fsWatcherPool";
import { createWorktreeHost, type WorktreeActions, type WorktreeSurface } from "./WorktreeHost";

/** Paced so the trailing debounce delivers, and the floor still has to collapse them. */
const STREAM_INTERVAL_MS = DEBOUNCE_MS + 50;

function res(over: Partial<GitCommandResult> = {}): GitCommandResult {
  return { code: 0, stdout: Buffer.alloc(0), stderr: "", timedOut: false, failedToSpawn: false, ...over };
}

function nul(...records: string[][]): Buffer {
  return Buffer.from(records.map((f) => `${f.map((x) => `${x}\0`).join("")}\0`).join(""));
}

function emitter<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    event: ((l: (value: T) => void) => {
      listeners.add(l);
      return { dispose: () => listeners.delete(l) };
    }) as vscode.Event<T>,
    fire: (v: T) => {
      for (const l of [...listeners]) {
        l(v);
      }
    },
  };
}

/** Records every watcher the pool creates, so a test can fire on a chosen one. */
function watcherFactory() {
  const made: Array<{ pattern: unknown; change: ReturnType<typeof emitter<vscode.Uri>> }> = [];
  const fn = vi.fn((pattern: vscode.GlobPattern) => {
    const change = emitter<vscode.Uri>();
    made.push({ pattern, change });
    return {
      onDidCreate: emitter<vscode.Uri>().event,
      onDidChange: change.event,
      onDidDelete: emitter<vscode.Uri>().event,
      dispose: () => {},
    } as unknown as vscode.FileSystemWatcher;
  });
  return { fn, made };
}

async function drain(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

/** One repo per folder, each listing only its own main worktree. */
function gitFor(folders: string[]) {
  const run = vi.fn(async (args: readonly string[], cwd: string): Promise<GitCommandResult> => {
    if (args[0] === "--version") {
      return res({ stdout: Buffer.from("git version 2.50.1\n") });
    }
    if (args[0] === "worktree") {
      return res({ stdout: nul([`worktree ${cwd}`, "HEAD abc", "branch refs/heads/main"]) });
    }
    return res({ stdout: Buffer.from(`${cwd}/.git\n`) });
  });
  const listsFor = (repo: string) =>
    run.mock.calls.filter((call) => call[0][0] === "worktree" && call[1] === repo).length;
  return { runner: { run } as unknown as GitCommandRunner, run, listsFor, folders };
}

/** Real pool, real host, real gate — all on the one clock vi.useFakeTimers controls. */
async function joined(folders: string[] = ["/a", "/b"], actions?: WorktreeActions) {
  const git = gitFor(folders);
  const factory = watcherFactory();
  const pool = createWatcherPool({
    createFileSystemWatcher: factory.fn,
    onDidChangeWindowState: emitter<vscode.WindowState>().event,
    initialWindowFocused: true,
  });
  const clock: RebuildGateClock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const deps: WorktreeTreeDeps = {
    runner: git.runner,
    capabilities: createGitCapabilities(git.runner),
    normalize: async (p: string) => p.replace(/\/+$/, "") || "/",
    stat: async () => undefined,
    getGitApi: (() => ({
      state: "initialized",
      repositories: folders.map((fsPath) => ({ rootUri: { fsPath } })),
    })) as unknown as GitApiAccessor,
  };
  const host = createWorktreeHost({
    deps,
    workspaceFolders: () => folders,
    pool,
    onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
    clock,
    ...(actions === undefined ? {} : { actions }),
  });
  const view: WorktreeSurface = { isReady: () => true, post: () => {} };
  host.attach(view).setDisplayed(true);
  host.handleMessage(view, { type: "worktreeViewVisibility", visible: true });
  host.handleMessage(view, { type: "requestWorktreeTree" });
  await vi.advanceTimersByTimeAsync(0);
  await drain();

  /** Fire on every watcher whose pattern names this repo. */
  const fireOn = (repo: string): void => {
    const owned = factory.made.filter((w) => JSON.stringify(w.pattern).includes(repo));
    expect(owned.length, `no watcher for ${repo}`).toBeGreaterThan(0);
    owned[0].change.fire({ fsPath: `${repo}/.git/worktrees/x/HEAD` } as vscode.Uri);
  };
  return { host, git, fireOn, factory, view };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("watcher burst and sustained stream, composed", () => {
  it("collapses a burst inside the debounce window to one rebuild for the affected repo", async () => {
    const { git, fireOn } = await joined();
    const before = git.listsFor("/a");

    for (let i = 0; i < 12; i += 1) {
      fireOn("/a");
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 10);
    }
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + REBUILD_FLOOR_MS);
    await drain();

    expect(git.listsFor("/a") - before).toBe(GIT_INVOCATIONS_PER_BURST.exactly);
  });

  it("runs no git for a sibling repository the burst did not name", async () => {
    const { git, fireOn } = await joined();
    const before = git.listsFor("/b");

    for (let i = 0; i < 12; i += 1) {
      fireOn("/a");
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 10);
    }
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + REBUILD_FLOOR_MS);
    await drain();

    expect(git.listsFor("/b") - before).toBe(0);
  });

  it("holds a stream that clears the debounce to one rebuild per floor window", async () => {
    const { git, fireOn } = await joined();
    const before = git.listsFor("/a");
    const windows = 3;
    const ticks = Math.floor((windows * REBUILD_FLOOR_MS) / STREAM_INTERVAL_MS);

    for (let i = 0; i < ticks; i += 1) {
      fireOn("/a");
      await vi.advanceTimersByTimeAsync(STREAM_INTERVAL_MS);
      await drain();
    }
    await vi.advanceTimersByTimeAsync(REBUILD_FLOOR_MS);
    await drain();

    // Each tick clears the trailing debounce on its own, so the gate sees `ticks`
    // separate signals; the floor is the only thing collapsing them.
    // 15 signals, 3 floor windows: one rebuild runs immediately, then exactly one per
    // window expiry. Exact, not a range — a range would pass a gate that stopped collapsing.
    expect(ticks).toBeGreaterThan(windows);
    expect(git.listsFor("/a") - before).toBe(windows + 1);
  });

  it("serves a forced refresh immediately, without waiting out the floor", async () => {
    // Round-1 B10: D3 names five facts and three were asserted. This is the fourth — a
    // force is a user asking now, and making it queue behind the per-repo floor would make
    // the affordance a lie. Fired straight after a burst, so the floor is genuinely armed.
    const { host, git, fireOn } = await joined();
    fireOn("/a");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    await drain();
    const before = git.listsFor("/a");

    // The repo IDENTITY, not the folder: `rev-parse --git-common-dir` above answers
    // `<folder>/.git`, and that is the key the gate is scoped by.
    await host.mutationBindings().forceRebuild("/a/.git");
    await drain();

    expect(git.listsFor("/a") - before).toBe(GIT_INVOCATIONS_PER_BURST.exactly);
  });

  it("counts per repository, not in aggregate, when two are affected at once", async () => {
    // Round-1 B10: the fifth fact. Every earlier assertion watches one repo while its
    // sibling stays quiet, which cannot tell a per-repo bound from a global one — a host
    // that collapsed both repos into a single rebuild would pass all three.
    const { git, fireOn } = await joined();
    const beforeA = git.listsFor("/a");
    const beforeB = git.listsFor("/b");

    fireOn("/a");
    fireOn("/b");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    await drain();

    expect(git.listsFor("/a") - beforeA).toBe(GIT_INVOCATIONS_PER_BURST.exactly);
    expect(git.listsFor("/b") - beforeB).toBe(GIT_INVOCATIONS_PER_BURST.exactly);
  });
});

describe("assessment traffic against the shared mutation queue", () => {
  /**
   * The growth axis round-6 B5 named: requests per repository. Each assessment
   * runs inside `coordinator.run`, so an admitted one is a job on that
   * repository's mutation queue and everything queued behind it waits.
   */
  function heldActions() {
    const started: string[] = [];
    const waiting: Array<() => void> = [];
    const removals: string[] = [];
    const actions = {
      assessRemovalReport: (target: { worktreeId: string }) => {
        started.push(target.worktreeId);
        return new Promise<null>((resolve) => {
          waiting.push(() => resolve(null));
        });
      },
      removeWorktree: async (target: { worktreeId: string }) => {
        removals.push(target.worktreeId);
      },
    } as unknown as WorktreeActions;
    return {
      actions,
      started,
      removals,
      /** In flight right now — admitted and not yet answered. */
      inFlight: () => waiting.length,
      release: async () => {
        for (let guard = 0; guard < 40 && waiting.length > 0; guard += 1) {
          waiting.shift()?.();
          await drain();
        }
      },
    };
  }

  it("admits one assessment per repository however large the burst", async () => {
    const held = heldActions();
    const { host, view } = await joined(["/a", "/b"], held.actions);
    const second: WorktreeSurface = { isReady: () => true, post: () => {} };
    host.attach(second).setDisplayed(true);

    // Alternating two repositories from two surfaces, forty times. Under the
    // panel-side guard this was forty jobs; the bound is now structural and
    // lives on the repository, which is the key the queue itself uses.
    for (let i = 0; i < 20; i += 1) {
      for (const surface of [view, second]) {
        host.handleMessage(surface, { type: "worktreeRemoveAssess", worktreeId: "/a", token: `a-${i}` });
        host.handleMessage(surface, { type: "worktreeRemoveAssess", worktreeId: "/b", token: `b-${i}` });
      }
    }
    await drain();

    // Two repositories, one lane each — never eighty, and never one shared lane
    // that would let a busy repository hold up a question about the other.
    expect(held.inFlight()).toBe(2);
    expect([...held.started].sort()).toEqual(["/a", "/b"]);

    await held.release();
  });

  it("runs a removal ahead of every assessment admitted after it", async () => {
    const held = heldActions();
    const { host, view } = await joined(["/a", "/b"], held.actions);

    host.handleMessage(view, { type: "worktreeRemoveAssess", worktreeId: "/a", token: "first" });
    await drain();
    expect(held.inFlight()).toBe(1);

    host.handleMessage(view, { type: "worktreeRemove", worktreeId: "/a", force: false });
    for (let i = 0; i < 10; i += 1) {
      host.handleMessage(view, { type: "worktreeRemoveAssess", worktreeId: "/a", token: `late-${i}` });
    }
    await drain();

    // Nothing later was admitted: the lane already had its one job, so the
    // removal is behind exactly one assessment rather than eleven.
    expect(held.started).toEqual(["/a"]);

    await held.release();
    expect(held.removals, "the removal never ran").toEqual(["/a"]);
    // And the one request still owed was served afterwards, not dropped: the
    // last token wins, and the nine it superseded cost no job at all.
    expect(held.started).toEqual(["/a", "/a"]);
  });
});
