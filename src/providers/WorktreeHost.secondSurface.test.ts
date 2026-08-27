// src/providers/WorktreeHost.secondSurface.test.ts — "A second surface adds no work",
// asserted once rather than inferred from six tests that each cover one seam.
// See design.md D4.
//
// Literal "no work" is false: the second surface must receive and render a post. The
// boundary the design draws is that no SOURCE-side counter moves — watcher subscriptions,
// git invocations, and projections (which is where the registry and process-table reads
// happen) — while fan-out and posting may. Stating the boundary is what makes the clause
// testable instead of rhetorical.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionToWebViewMessage } from "../types/messages";
import { createGitCapabilities } from "../worktree/gitCapabilities";
import type { GitCommandResult, GitCommandRunner } from "../worktree/gitCommandRunner";
import type { PresenceProjector } from "../worktree/presenceProjector";
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

  const project = vi.fn(async () => ({ rowsByWorktreeId: {}, degradations: [] }));
  const projector = {
    project,
    rank: () => undefined,
    rankRevision: () => 0,
  } as unknown as PresenceProjector;

  const clock: RebuildGateClock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const deps: WorktreeTreeDeps = {
    runner,
    capabilities: createGitCapabilities(runner),
    normalize: async (p: string) => p.replace(/\/+$/, "") || "/",
    stat: async () => undefined,
    getGitApi: ((() => ({ state: "initialized", repositories: [{ rootUri: { fsPath: "/a" } }] })) as unknown) as GitApiAccessor,
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
  it("moves no watcher, git, or projection counter when a second surface is shown", async () => {
    const { show, sourceCost } = harness();
    const first = surface();
    await show(first);

    const before = sourceCost();
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
