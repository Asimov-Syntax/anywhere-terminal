// src/providers/WorktreeHost.secondSurface.test.ts — "A second surface adds no work",
// asserted once rather than inferred from six tests that each cover one seam.
// See design.md D4.
//
// Literal "no work" is false: the second surface must receive and render a post. The
// boundary the design draws is that no SOURCE-side counter moves — watcher subscriptions,
// git invocations, registry reads, process-table reads, projections, and polling timers —
// while fan-out and posting may. Stating the boundary is what makes the clause testable
// instead of rhetorical, and all six are counted here rather than three (round-1 B11).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DescendantsOutcome, ProcessTableSnapshot } from "../pty/processTableSnapshot";
import { createPaneEvidenceStore } from "../session/PaneEvidenceStore";
import type { ExtensionToWebViewMessage } from "../types/messages";
import type { RunningSessionsOutcome } from "../vault/readers/runningSessions";
import { createGitCapabilities } from "../worktree/gitCapabilities";
import type { GitCommandResult, GitCommandRunner } from "../worktree/gitCommandRunner";
import { createPresenceProjectorDeps } from "../worktree/presenceDeps";
import type { PresenceProjector } from "../worktree/presenceProjector";
import { createPresenceProjector } from "../worktree/presenceProjector";
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

function surface(): WorktreeSurface & { posts: ExtensionToWebViewMessage[] } {
  const posts: ExtensionToWebViewMessage[] = [];
  return { posts, isReady: () => true, post: (m) => posts.push(m) };
}

async function drain(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function harness() {
  const run = vi.fn(async (args: readonly string[], cwd: string): Promise<GitCommandResult> => {
    if (args[0] === "--version") {
      return res({ stdout: Buffer.from("git version 2.50.1\n") });
    }
    if (args[0] === "worktree") {
      return res({ stdout: nul([`worktree ${cwd}`, "HEAD abc", "branch refs/heads/main"]) });
    }
    return res({ stdout: Buffer.from(`${cwd}/.git\n`) });
  });
  const runner = { run } as unknown as GitCommandRunner;

  const subs: Array<{ dispose: () => void }> = [];
  const pool = {
    subscribePattern: () => {
      const sub = { active: true, dispose: () => {} };
      subs.push(sub);
      return sub;
    },
  };

  // Round-1 B11: the projector used to be a stub, which made three of D4's six counters
  // structurally unobservable — the registry read and the process-table read happen INSIDE
  // it. Composed from the production `createPresenceProjectorDeps` now, with the spies at
  // the real seams, so "no work" can be checked against the whole inventory.
  const openTable = vi.fn(async () => ({ descendantsOf: () => ({ kind: "ok", pids: [] }) as DescendantsOutcome }));
  const listRunning = vi.fn(async (): Promise<RunningSessionsOutcome> => ({ kind: "ok", sessions: [] }));
  const store = createPaneEvidenceStore({ now: () => 1_700_000_000_000 });
  store.create("pane-1", { viewId: "sidebar", cwd: "/a", ptyPid: 4321, shell: "claude" });
  const inner = createPresenceProjector(
    createPresenceProjectorDeps({
      store,
      table: {
        open: openTable,
        descendantsOf: async () => ({ kind: "ok", pids: [] }),
      } as unknown as ProcessTableSnapshot,
      listRunning,
      sessionMtime: async () => 1,
      sessionPath: async () => null,
      now: () => 1_700_000_000_000,
    }),
  );
  const project = vi.fn((ids: readonly string[], options?: never) => inner.project(ids, options));
  const projector = {
    project,
    rank: (id: string) => inner.rank(id),
    rankRevision: () => inner.rankRevision(),
    forgetDrawOrder: () => inner.forgetDrawOrder(),
  } as unknown as PresenceProjector;

  // Every timer the host arms, so "and no new polling timer" is counted rather than assumed.
  const timers = vi.fn();
  const clock: RebuildGateClock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => {
      timers(ms);
      return setTimeout(fn, ms);
    },
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const deps: WorktreeTreeDeps = {
    runner,
    capabilities: createGitCapabilities(runner),
    normalize: async (p: string) => p.replace(/\/+$/, "") || "/",
    stat: async () => undefined,
    getGitApi: (() => ({
      state: "initialized",
      repositories: [{ rootUri: { fsPath: "/a" } }],
    })) as unknown as GitApiAccessor,
  };

  const host = createWorktreeHost({
    deps,
    workspaceFolders: () => ["/a"],
    pool: pool as never,
    onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
    clock,
    projector,
  });

  /** Everything a second surface must NOT move. */
  const sourceCost = () => ({
    watchers: subs.length,
    gitInvocations: run.mock.calls.length,
    projections: project.mock.calls.length,
    registryReads: listRunning.mock.calls.length,
    processTableReads: openTable.mock.calls.length,
    pollingTimers: timers.mock.calls.length,
  });

  const show = async (view: WorktreeSurface) => {
    host.attach(view).setDisplayed(true);
    host.handleMessage(view, { type: "worktreeViewVisibility", visible: true });
    host.handleMessage(view, { type: "requestWorktreeTree" });
    await drain();
  };
  return { host, show, sourceCost };
}

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a second surface adds no source-side work", () => {
  it("moves none of the six source counters when a second surface is shown", async () => {
    const { show, sourceCost } = harness();
    const first = surface();
    await show(first);

    const before = sourceCost();
    // A counter that never moved for the FIRST surface is not evidence about the second.
    // Every one of D4's six has to be live before equality means anything.
    for (const [name, count] of Object.entries(before)) {
      expect(count, `${name} never moved for the first surface, so holding it flat proves nothing`).toBeGreaterThan(0);
    }
    const second = surface();
    await show(second);

    expect(sourceCost()).toEqual(before);
  });

  it("still serves the second surface, so the clause is a boundary and not an absence", async () => {
    const { show } = harness();
    const first = surface();
    await show(first);

    const second = surface();
    await show(second);

    expect(second.posts.length).toBeGreaterThan(0);
  });

  it("serves the newcomer from the cache rather than rebuilding for it", async () => {
    const { show, sourceCost } = harness();
    const first = surface();
    await show(first);
    const before = sourceCost();

    const second = surface();
    await show(second);

    expect(sourceCost().gitInvocations).toBe(before.gitInvocations);
    expect(sourceCost().projections).toBe(before.projections);
  });
});
