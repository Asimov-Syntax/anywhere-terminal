// src/providers/WorktreeHost.delegations.test.ts — the host's delegation read:
// who may cause one, how often it happens, and what a roster is allowed to
// claim once its parent row has gone stale.
//
// The reader and the projector are both faked. What is under test is the
// host's custody of a roster — the identity it is keyed by, the copy it is
// applied to, and the publication it waits for — not what a transcript maps to
// (src/worktree/delegations.test.ts owns that).
//
// See: asimov/changes/surface-subagent-history-rows/design.md D1, D2, D3, D8, D11.

import { describe, expect, it, vi } from "vitest";
import type { ExtensionToWebViewMessage } from "../types/messages";
import { createGitCapabilities } from "../worktree/gitCapabilities";
import type { GitCommandResult, GitCommandRunner } from "../worktree/gitCommandRunner";
import type { PresenceProjector } from "../worktree/presenceProjector";
import type {
  DelegationRoster,
  PresenceDegradation,
  WorktreeAgentRow,
  WorktreePresence,
} from "../worktree/presenceTypes";
import type { RebuildGateClock } from "../worktree/rebuildGate";
import type { GitApiAccessor } from "../worktree/repoRoots";
import type { WorktreeTreeDeps } from "../worktree/WorktreeDiscovery";
import { createWorktreeHost, type WorktreeSurface } from "./WorktreeHost";

const WT = "/repo";
const SESSION = "claude:s1";

function res(over: Partial<GitCommandResult> = {}): GitCommandResult {
  return { code: 0, stdout: Buffer.alloc(0), stderr: "", timedOut: false, failedToSpawn: false, ...over };
}

function nul(...records: string[][]): Buffer {
  return Buffer.from(records.map((f) => `${f.map((x) => `${x}\0`).join("")}\0`).join(""));
}

const MAIN = ["worktree /repo", "HEAD abc", "branch refs/heads/main"];

function runner(): GitCommandRunner {
  const run = vi.fn(async (args: readonly string[], cwd: string): Promise<GitCommandResult> => {
    if (args[0] === "--version") {
      return res({ stdout: Buffer.from("git version 2.50.1\n") });
    }
    if (cwd !== "/repo") {
      return res({ code: 128, stderr: "fatal: not a git repository" });
    }
    return args[0] === "worktree" ? res({ stdout: nul(MAIN) }) : res({ stdout: Buffer.from("/repo/.git\n") });
  });
  return { run } as unknown as GitCommandRunner;
}

const api: GitApiAccessor = () =>
  ({ state: "initialized", repositories: [{ rootUri: { fsPath: "/repo" } }] }) as ReturnType<GitApiAccessor>;

function deps(): WorktreeTreeDeps {
  return {
    runner: runner(),
    capabilities: createGitCapabilities(runner()),
    normalize: async (p: string) => p.replace(/\/+$/, "") || "/",
    stat: async () => undefined,
    getGitApi: api,
  };
}

const clock: RebuildGateClock = {
  now: () => 0,
  setTimeout: () => 0,
  clearTimeout: () => {},
};

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function agentRow(over: Partial<WorktreeAgentRow> = {}): WorktreeAgentRow {
  return {
    rowId: "window:a",
    scope: "window",
    agentSource: "launch",
    activity: "running",
    activitySource: "hook",
    entryId: SESSION,
    ...over,
  };
}

function presenceOf(rows: WorktreeAgentRow[], degradedSources: PresenceDegradation[] = []): WorktreePresence {
  return { rowsByWorktreeId: { [WT]: rows }, scannedAt: 1, degradedSources };
}

/** A projector whose answer the test sets, and whose projections it can park. */
function controlledProjector() {
  let answer: WorktreePresence = presenceOf([agentRow()]);
  const parked: Array<(presence: WorktreePresence) => void> = [];
  let parking = false;

  const projector: PresenceProjector = {
    project: async () => (parking ? new Promise<WorktreePresence>((resolve) => parked.push(resolve)) : answer),
    rank: () => undefined,
    rankRevision: () => 0,
    forgetDrawOrder: () => {},
  };

  return {
    projector,
    /** The exact object the projector hands back — a replay returns this one. */
    retained: () => answer,
    setPresence(next: WorktreePresence) {
      answer = next;
    },
    park() {
      parking = true;
    },
    releaseParked(next: WorktreePresence) {
      parking = false;
      answer = next;
      const resolve = parked.shift();
      resolve?.(next);
    },
  };
}

/** A reader the test resolves or rejects by hand, counting what it was asked. */
function controlledReader() {
  const asked: string[] = [];
  const pending: Array<{ resolve: (r: DelegationRoster) => void; reject: (e: Error) => void }> = [];
  const read = vi.fn(
    (entryId: string) =>
      new Promise<DelegationRoster>((resolve, reject) => {
        asked.push(entryId);
        pending.push({ resolve, reject });
      }),
  );
  return { read, asked, pending };
}

function surface(): WorktreeSurface & { posts: ExtensionToWebViewMessage[] } {
  const posts: ExtensionToWebViewMessage[] = [];
  return { posts, isReady: () => true, post: (m) => posts.push(m) };
}

/** A host already built and pushing to one displayed surface. */
async function builtHost() {
  const projector = controlledProjector();
  const reader = controlledReader();
  let notifyFolders: (() => void) | undefined;

  const host = createWorktreeHost({
    deps: deps(),
    workspaceFolders: () => ["/repo"],
    pool: { subscribePattern: () => ({ active: true, dispose: () => {} }) },
    clock,
    projector: projector.projector,
    readDelegations: reader.read,
    onDidChangeWorkspaceFolders: (listener) => {
      notifyFolders = listener;
      return { dispose: () => {} };
    },
    now: () => 1000,
  });

  const view = surface();
  const attachment = host.attach(view);
  attachment.setDisplayed(true);
  host.handleMessage(view, { type: "worktreeViewVisibility", visible: true });
  host.handleMessage(view, { type: "requestWorktreeTree" });
  await settle();
  view.posts.length = 0;

  return {
    host,
    view,
    projector,
    reader,
    expand: (rowId = "window:a", entryId = SESSION) =>
      host.handleMessage(view, { type: "requestWorktreeSubagents", rowId, entryId }),
    /** Move the tree, which is what makes the host rebuild and re-project. */
    rebuild: () => notifyFolders?.(),
  };
}

function published(view: { posts: ExtensionToWebViewMessage[] }): WorktreePresence[] {
  return view.posts
    .filter(
      (m): m is Extract<ExtensionToWebViewMessage, { type: "worktreeTreeResponse" }> =>
        m.type === "worktreeTreeResponse",
    )
    .map((m) => m.presence);
}

function lastRows(view: { posts: ExtensionToWebViewMessage[] }): WorktreeAgentRow[] {
  const presences = published(view);
  return presences[presences.length - 1]?.rowsByWorktreeId[WT] ?? [];
}

function lastRoster(view: { posts: ExtensionToWebViewMessage[] }, rowId = "window:a"): DelegationRoster | undefined {
  return lastRows(view).find((row) => row.rowId === rowId)?.delegations;
}

const ONE_ROW: DelegationRoster = { kind: "ok", rows: [{ name: "librarian", status: "completed", live: false }] };

describe("who may cause a delegation read", () => {
  it("reads the transcript the HOST holds, not the one the request named", async () => {
    // The request's entry id is an expected-version token: a forged one must not
    // be able to steer the read at a transcript the row does not own.
    const h = await builtHost();
    h.expand("window:a", SESSION);
    await settle();
    expect(h.reader.asked).toEqual([SESSION]);
  });

  it("reads nothing for a row whose session moved on", async () => {
    // The surface's last envelope may have been skipped or thrown, so it can
    // still show the previous session under the same stable row id.
    const h = await builtHost();
    h.expand("window:a", "claude:previous");
    await settle();
    expect(h.reader.asked).toEqual([]);
    expect(lastRoster(h.view)).toBeUndefined();
  });

  it("reads nothing for a row that has no session", async () => {
    const h = await builtHost();
    h.projector.setPresence(presenceOf([agentRow({ entryId: undefined })]));
    h.rebuild();
    await settle();
    h.expand("window:a", SESSION);
    await settle();
    expect(h.reader.asked).toEqual([]);
  });

  it("reads nothing for a row it never published", async () => {
    const h = await builtHost();
    h.expand("window:ghost", SESSION);
    await settle();
    expect(h.reader.asked).toEqual([]);
  });

  it("reads nothing when no reader is wired", async () => {
    // Every surface but the real extension entry point, which is how this
    // stays inert rather than throwing where the feature is not configured.
    const projector = controlledProjector();
    const host = createWorktreeHost({
      deps: deps(),
      workspaceFolders: () => ["/repo"],
      pool: { subscribePattern: () => ({ active: true, dispose: () => {} }) },
      clock,
      projector: projector.projector,
      now: () => 1000,
    });
    const view = surface();
    host.attach(view).setDisplayed(true);
    host.handleMessage(view, { type: "worktreeViewVisibility", visible: true });
    host.handleMessage(view, { type: "requestWorktreeTree" });
    await settle();
    expect(() =>
      host.handleMessage(view, { type: "requestWorktreeSubagents", rowId: "window:a", entryId: SESSION }),
    ).not.toThrow();
    expect(lastRoster(view)).toBeUndefined();
  });
});

describe("how often a row is read", () => {
  it("does not read again once the row's roster is held", async () => {
    const h = await builtHost();
    h.expand();
    await settle();
    h.reader.pending[0]?.resolve(ONE_ROW);
    await settle();

    h.expand();
    await settle();
    expect(h.reader.asked).toEqual([SESSION]);
  });

  it("joins a read already in flight instead of starting a second", async () => {
    const h = await builtHost();
    h.expand();
    h.expand();
    await settle();
    expect(h.reader.asked).toEqual([SESSION]);
  });

  it("does not answer a new session with the previous one's history under the same row", async () => {
    // One pane ends a session and starts another: the row id is stable across
    // both, so a roster kept by row alone would be published against a
    // transcript it was never read from.
    const h = await builtHost();
    h.expand();
    await settle();
    h.reader.pending[0]?.resolve(ONE_ROW);
    await settle();
    expect(lastRoster(h.view)).toEqual(ONE_ROW);

    h.projector.setPresence(presenceOf([agentRow({ entryId: "claude:s2" })]));
    h.rebuild();
    await settle();
    expect(lastRoster(h.view)).toBeUndefined();

    h.expand("window:a", "claude:s2");
    await settle();
    expect(h.reader.asked).toEqual([SESSION, "claude:s2"]);
  });

  it("reads again after the row left the tree and came back", async () => {
    // Eviction is what makes this a fresh read: a roster that outlived its row
    // would answer the second expansion with the first session's history.
    const h = await builtHost();
    h.expand();
    await settle();
    h.reader.pending[0]?.resolve(ONE_ROW);
    await settle();

    h.projector.setPresence(presenceOf([]));
    h.rebuild();
    await settle();
    h.projector.setPresence(presenceOf([agentRow()]));
    h.rebuild();
    await settle();
    expect(lastRoster(h.view)).toBeUndefined();

    h.expand();
    await settle();
    expect(h.reader.asked).toEqual([SESSION, SESSION]);
  });
});

describe("what a completed read publishes", () => {
  it("publishes the roster on the row it was read for", async () => {
    const h = await builtHost();
    h.expand();
    await settle();
    h.reader.pending[0]?.resolve(ONE_ROW);
    await settle();
    expect(lastRoster(h.view)).toEqual(ONE_ROW);
  });

  it("publishes a failed read as failure, never as a session that delegated nothing", async () => {
    const h = await builtHost();
    h.expand();
    await settle();
    h.reader.pending[0]?.reject(new Error("EACCES /vault"));
    await settle();
    expect(lastRoster(h.view)).toEqual({ kind: "failed", reason: "EACCES /vault" });
  });

  it("keeps each session's roster on its own row when two reads finish in reverse order", async () => {
    const h = await builtHost();
    h.projector.setPresence(
      presenceOf([
        agentRow({ rowId: "window:a", entryId: "claude:a" }),
        agentRow({ rowId: "window:b", entryId: "claude:b" }),
      ]),
    );
    h.rebuild();
    await settle();

    h.expand("window:a", "claude:a");
    h.expand("window:b", "claude:b");
    await settle();
    // b first, a second: a shared key would let the later completion evict the
    // earlier result and the next expansion would re-read it.
    h.reader.pending[1]?.resolve({ kind: "ok", rows: [{ name: "b-child", status: "completed", live: false }] });
    await settle();
    h.reader.pending[0]?.resolve({ kind: "ok", rows: [{ name: "a-child", status: "completed", live: false }] });
    await settle();

    expect(lastRoster(h.view, "window:a")).toEqual({
      kind: "ok",
      rows: [{ name: "a-child", status: "completed", live: false }],
    });
    expect(lastRoster(h.view, "window:b")).toEqual({
      kind: "ok",
      rows: [{ name: "b-child", status: "completed", live: false }],
    });
  });

  it("survives a rebuild and a re-projection of the same row", async () => {
    const h = await builtHost();
    h.expand();
    await settle();
    h.reader.pending[0]?.resolve(ONE_ROW);
    await settle();

    h.rebuild();
    await settle();
    expect(lastRoster(h.view)).toEqual(ONE_ROW);
  });

  it("writes the roster onto a copy, leaving the projector's own row untouched", async () => {
    // The rows a replay hands back are the projector's retained objects; writing
    // through one would leave a roster inside its replay state.
    const h = await builtHost();
    h.expand();
    await settle();
    h.reader.pending[0]?.resolve(ONE_ROW);
    await settle();

    expect(lastRoster(h.view)).toEqual(ONE_ROW);
    expect(h.projector.retained().rowsByWorktreeId[WT]?.[0]?.delegations).toBeUndefined();
  });

  it("publishes nothing while the projection is behind the tree, then publishes on the commit that lands", async () => {
    const h = await builtHost();
    h.expand();
    await settle();

    h.projector.park();
    h.rebuild();
    await settle();
    const before = published(h.view).length;

    h.reader.pending[0]?.resolve(ONE_ROW);
    await settle();
    expect(published(h.view).length).toBe(before);

    h.projector.releaseParked(presenceOf([agentRow()]));
    await settle();
    expect(lastRoster(h.view)).toEqual(ONE_ROW);
  });

  it("publishes nothing for a read that lands after disposal", async () => {
    const h = await builtHost();
    h.expand();
    await settle();
    h.host.dispose();
    h.reader.pending[0]?.resolve(ONE_ROW);
    await settle();
    expect(published(h.view)).toHaveLength(0);
  });
});

const DECAYED: DelegationRoster = {
  kind: "ok",
  rows: [
    { name: "librarian", status: "unknown", live: false },
    { name: "finder", status: "completed", live: false },
  ],
};

const RUNNING_CHILD: DelegationRoster = {
  kind: "ok",
  rows: [
    { name: "librarian", status: "running", live: false },
    { name: "finder", status: "completed", live: false },
  ],
};

async function withRunningChild(parent: Partial<WorktreeAgentRow>, degraded: PresenceDegradation[] = []) {
  const h = await builtHost();
  h.projector.setPresence(presenceOf([agentRow(parent)], degraded));
  h.rebuild();
  await settle();
  h.expand();
  await settle();
  h.reader.pending[0]?.resolve(RUNNING_CHILD);
  await settle();
  return h;
}

describe("a child's running does not outlive its parent's freshness", () => {
  it("keeps running while the parent is working and its evidence source is healthy", async () => {
    const h = await withRunningChild({ activity: "running", activitySource: "hook" });
    expect(lastRoster(h.view)).toEqual(RUNNING_CHILD);
  });

  it("keeps running while the parent is waiting on the user", async () => {
    const h = await withRunningChild({ activity: "waiting", activitySource: "hook" });
    expect(lastRoster(h.view)).toEqual(RUNNING_CHILD);
  });

  it("[I12] republishes running as unknown once the parent has stopped working", async () => {
    const h = await withRunningChild({ activity: "idle", activitySource: "hook" });
    expect(lastRoster(h.view)).toEqual(DECAYED);
  });

  it("[I12] republishes running as unknown when the parent's own evidence source is degraded", async () => {
    const h = await withRunningChild({ activity: "running", activitySource: "registry" }, [
      { source: "registry", reason: "spawn ENOENT", since: 1 },
    ]);
    expect(lastRoster(h.view)).toEqual(DECAYED);
  });

  it("ignores a degraded source that says nothing about this row's evidence", async () => {
    const h = await withRunningChild({ activity: "running", activitySource: "hook" }, [
      { source: "registry", reason: "spawn ENOENT", since: 1 },
    ]);
    expect(lastRoster(h.view)).toEqual(RUNNING_CHILD);
  });

  it("republishes running as unknown when nothing evidenced the parent's activity", async () => {
    const h = await withRunningChild({ activity: "running", activitySource: "none" });
    expect(lastRoster(h.view)).toEqual(DECAYED);
  });

  it("[I12] decays what it publishes, not what it holds — a parent going live again reports running", async () => {
    const h = await withRunningChild({ activity: "idle", activitySource: "hook" });
    h.projector.setPresence(presenceOf([agentRow({ activity: "running", activitySource: "hook" })]));
    h.rebuild();
    await settle();
    expect(lastRoster(h.view)).toEqual(RUNNING_CHILD);
  });

  it("leaves a failed roster alone whatever the parent is doing", async () => {
    const h = await builtHost();
    h.projector.setPresence(presenceOf([agentRow({ activity: "exited", activitySource: "none" })]));
    h.rebuild();
    await settle();
    h.expand();
    await settle();
    h.reader.pending[0]?.resolve({ kind: "failed", reason: "ENOENT" });
    await settle();
    expect(lastRoster(h.view)).toEqual({ kind: "failed", reason: "ENOENT" });
  });
});

// ─── WT-006.3 — a roster the agent reported itself ──────────────────

describe("a reported roster outranks the transcript's", () => {
  const reportedRoster = (): DelegationRoster => ({
    kind: "ok",
    reported: true,
    rows: [{ name: "code-reviewer", status: "running", live: true }],
  });

  it("survives the host's delegation pass instead of being overwritten by history", async () => {
    const h = await builtHost();
    // The transcript read happened and is cached, exactly as it would be for a
    // row the user had expanded.
    h.expand();
    h.reader.pending[0]?.resolve({ kind: "ok", rows: [{ name: "code-reviewer", status: "completed", live: false }] });
    await settle();

    h.projector.setPresence(presenceOf([agentRow({ delegations: reportedRoster() })]));
    h.rebuild();
    await settle();

    expect(lastRoster(h.view)).toEqual(reportedRoster());
  });

  it("still lets the transcript answer for a row whose agent reported nothing", async () => {
    const h = await builtHost();
    h.expand();
    h.reader.pending[0]?.resolve({ kind: "ok", rows: [{ name: "explorer", status: "completed", live: false }] });
    await settle();

    expect(lastRoster(h.view)).toMatchObject({ kind: "ok", rows: [{ name: "explorer", live: false }] });
  });

  it("does not decay a reported roster against the parent's inferred freshness", async () => {
    // Decay exists because a transcript's `running` is a stale claim once the
    // parent stops looking live. A reported roster is not a stale claim — the
    // projector already dropped it if the report went stale.
    const h = await builtHost();
    h.expand();
    h.reader.pending[0]?.resolve({ kind: "ok", rows: [{ name: "code-reviewer", status: "running", live: false }] });
    await settle();

    h.projector.setPresence(
      presenceOf([agentRow({ activity: "idle", activitySource: "none", delegations: reportedRoster() })]),
    );
    h.rebuild();
    await settle();

    expect(lastRoster(h.view)).toEqual(reportedRoster());
  });
});
