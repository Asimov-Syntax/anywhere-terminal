// src/providers/WorktreeHost.actions.test.ts — what the host will and will not
// act on when a surface raises a read-only action.
//
// The capabilities are all fakes. What is under test is RESOLUTION: which
// target the host picks, which value it hands over, and — the half that matters
// — the requests it refuses to act on at all. The wiring behind the seam is
// src/extension.worktreeActions.test.ts's; performing is not this file's
// subject, choosing is.
//
// See: asimov/changes/wire-worktree-navigation-actions/design.md D2, D3, D4.

import { describe, expect, it, vi } from "vitest";
import type { ExtensionToWebViewMessage } from "../types/messages";
import { createGitCapabilities } from "../worktree/gitCapabilities";
import type { GitCommandResult, GitCommandRunner } from "../worktree/gitCommandRunner";
import type { PresenceProjector } from "../worktree/presenceProjector";
import type { WorktreeAgentRow, WorktreePresence } from "../worktree/presenceTypes";
import type { RebuildGateClock } from "../worktree/rebuildGate";
import type { GitApiAccessor } from "../worktree/repoRoots";
import type { WorktreeTreeDeps } from "../worktree/WorktreeDiscovery";
import { createWorktreeHost, type WorktreeActions, type WorktreeSurface } from "./WorktreeHost";

const MAIN_PATH = "/repo";
const FEAT_PATH = "/repo-wt/feat";
const SESSION = "claude:s1";

function res(over: Partial<GitCommandResult> = {}): GitCommandResult {
  return { code: 0, stdout: Buffer.alloc(0), stderr: "", timedOut: false, failedToSpawn: false, ...over };
}

function nul(...records: string[][]): Buffer {
  return Buffer.from(records.map((f) => `${f.map((x) => `${x}\0`).join("")}\0`).join(""));
}

const MAIN = ["worktree /repo", "HEAD abc", "branch refs/heads/main"];
const FEAT = ["worktree /repo-wt/feat", "HEAD def", "branch refs/heads/feat"];
// Git reports this one with a trailing slash, so its `id` (normalized) and its
// `displayPath` (git's own string) differ — the pair the type says must not be
// swapped: "Copy / reveal use this, never `id`" (worktree/types.ts).
const RAW = ["worktree /repo-wt/raw/", "HEAD 012", "branch refs/heads/raw"];
const RAW_ID = "/repo-wt/raw";
const RAW_DISPLAY = "/repo-wt/raw/";

function runner(gone = false): GitCommandRunner {
  const run = vi.fn(async (args: readonly string[], cwd: string): Promise<GitCommandResult> => {
    if (args[0] === "--version") {
      return res({ stdout: Buffer.from("git version 2.50.1\n") });
    }
    if (cwd !== "/repo") {
      return res({ code: 128, stderr: "fatal: not a git repository" });
    }
    const feat = gone ? [...FEAT, "prunable gitdir file points to non-existent location"] : FEAT;
    return args[0] === "worktree"
      ? res({ stdout: nul(MAIN, feat, RAW) })
      : res({ stdout: Buffer.from("/repo/.git\n") });
  });
  return { run } as unknown as GitCommandRunner;
}

const api: GitApiAccessor = () =>
  ({ state: "initialized", repositories: [{ rootUri: { fsPath: "/repo" } }] }) as ReturnType<GitApiAccessor>;

/** `gone` makes the feat worktree prunable AND absent, which is `missing`. */
function deps(gone = false): WorktreeTreeDeps {
  return {
    runner: runner(gone),
    capabilities: createGitCapabilities(runner(gone)),
    normalize: async (p: string) => p.replace(/\/+$/, "") || "/",
    stat: async (path: string) => {
      if (gone && path === FEAT_PATH) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return undefined;
    },
    getGitApi: api,
  };
}

const clock: RebuildGateClock = { now: () => 0, setTimeout: () => 0, clearTimeout: () => {} };

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function windowRow(over: Partial<WorktreeAgentRow> = {}): WorktreeAgentRow {
  return {
    rowId: "window:a",
    scope: "window",
    agentSource: "launch",
    activity: "running",
    activitySource: "hook",
    paneId: "pane-1",
    viewId: "view-1",
    entryId: SESSION,
    ...over,
  };
}

/** External rows carry no pane, by the presence contract itself. */
function externalRow(over: Partial<WorktreeAgentRow> = {}): WorktreeAgentRow {
  return {
    rowId: "external:claude:s9",
    scope: "external",
    agentSource: "process",
    activity: "running",
    activitySource: "registry",
    entryId: "claude:s9",
    ...over,
  };
}

/** Every capability, recorded rather than performed. */
function recordingActions() {
  const calls: Array<[string, ...unknown[]]> = [];
  const track =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const actions: WorktreeActions = {
    openFolder: track("openFolder") as WorktreeActions["openFolder"],
    revealInOS: track("revealInOS") as WorktreeActions["revealInOS"],
    copyText: track("copyText") as WorktreeActions["copyText"],
    focusPane: track("focusPane") as WorktreeActions["focusPane"],
    copyResumeCommand: track("copyResumeCommand") as WorktreeActions["copyResumeCommand"],
    revealSessionCwd: track("revealSessionCwd") as WorktreeActions["revealSessionCwd"],
    copySessionCwd: track("copySessionCwd") as WorktreeActions["copySessionCwd"],
  };
  return { actions, calls };
}

/**
 * A surface that records what it was asked to do. `terminals` is the surface's
 * own capability, not one of the injected ones — only a provider can create a
 * pane, so the host asks the surface that raised the request.
 */
function surface(canOpenTerminal = true): WorktreeSurface & {
  posts: ExtensionToWebViewMessage[];
  terminals: string[];
} {
  const posts: ExtensionToWebViewMessage[] = [];
  const terminals: string[] = [];
  return {
    posts,
    terminals,
    isReady: () => true,
    post: (m) => posts.push(m),
    ...(canOpenTerminal
      ? {
          openTerminal: async (cwd: string) => {
            terminals.push(cwd);
          },
        }
      : {}),
  };
}

/** A host already built, with `rows` published and every capability recorded. */
async function builtHost(rows: WorktreeAgentRow[] = [windowRow()], gone = false) {
  const presence: WorktreePresence = { rowsByWorktreeId: { [MAIN_PATH]: rows }, scannedAt: 1, degradedSources: [] };
  const projector: PresenceProjector = {
    project: async () => presence,
    rank: () => undefined,
    rankRevision: () => 0,
  };
  const { actions, calls } = recordingActions();
  const host = createWorktreeHost({
    deps: deps(gone),
    workspaceFolders: () => ["/repo"],
    pool: { subscribePattern: () => ({ active: true, dispose: () => {} }) },
    clock,
    projector,
    actions,
    now: () => 1000,
  });
  const view = surface();
  const attachment = host.attach(view);
  attachment.setDisplayed(true);
  host.handleMessage(view, { type: "worktreeViewVisibility", visible: true });
  host.handleMessage(view, { type: "requestWorktreeTree" });
  await settle();
  view.posts.length = 0;
  return { host, view, calls, dispose: () => host.dispose() };
}

// ── What resolves ────────────────────────────────────────────────────────

describe("a worktree action acts on the worktree the id names", () => {
  it("hands each capability the worktree's own path, never the id it was sent", async () => {
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, { type: "worktreeOpenFolder", worktreeId: FEAT_PATH, mode: "newWindow" });
    host.handleMessage(view, { type: "worktreeRevealInOS", worktreeId: FEAT_PATH });
    host.handleMessage(view, { type: "worktreeCopyPath", worktreeId: FEAT_PATH });
    host.handleMessage(view, { type: "worktreeOpenTerminal", worktreeId: FEAT_PATH });
    await settle();

    expect(calls).toEqual([
      ["openFolder", FEAT_PATH, "newWindow"],
      ["revealInOS", FEAT_PATH],
      ["copyText", FEAT_PATH],
    ]);
    expect(view.terminals).toEqual([FEAT_PATH]);
    dispose();
  });

  it("refuses an open-folder mode that is not one of the two it declares", async () => {
    // The capability treats anything that is not `newWindow` as `addToWorkspace`,
    // so an unvalidated payload would mutate the workspace rather than fail
    // closed (round-1 W1).
    const { host, view, calls, dispose } = await builtHost();
    for (const mode of [undefined, "", "addToWorkSpace", "../new-window", 1]) {
      host.handleMessage(view, {
        type: "worktreeOpenFolder",
        worktreeId: FEAT_PATH,
        mode,
      } as unknown as Parameters<typeof host.handleMessage>[1]);
    }
    await settle();

    expect(calls).toEqual([]);
    dispose();
  });

  it("hands over the path git reported, not the normalized id it resolved by", async () => {
    // The request arrives with the id; every capability must receive the display
    // path. A capability given the id would act on a path git never printed.
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, { type: "worktreeCopyPath", worktreeId: RAW_ID });
    host.handleMessage(view, { type: "worktreeRevealInOS", worktreeId: RAW_ID });
    host.handleMessage(view, { type: "worktreeOpenTerminal", worktreeId: RAW_ID });
    host.handleMessage(view, { type: "worktreeOpenFolder", worktreeId: RAW_ID, mode: "addToWorkspace" });
    await settle();

    expect(calls).toEqual([
      ["copyText", RAW_DISPLAY],
      ["revealInOS", RAW_DISPLAY],
      ["openFolder", RAW_DISPLAY, "addToWorkspace"],
    ]);
    expect(view.terminals).toEqual([RAW_DISPLAY]);
    dispose();
  });

  it("opens a terminal on the surface that asked, because a new tab belongs where the user was", async () => {
    const { host, view, dispose } = await builtHost();
    const other = surface();
    host.attach(other).setDisplayed(true);
    host.handleMessage(other, { type: "worktreeViewVisibility", visible: true });
    host.handleMessage(other, { type: "worktreeOpenTerminal", worktreeId: FEAT_PATH });
    await settle();

    expect(other.terminals).toEqual([FEAT_PATH]);
    expect(view.terminals).toEqual([]);
    dispose();
  });

  it("opens nothing on a surface that cannot open terminals", async () => {
    const { host, dispose } = await builtHost();
    const plain = surface(false);
    host.attach(plain).setDisplayed(true);
    host.handleMessage(plain, { type: "worktreeViewVisibility", visible: true });
    host.handleMessage(plain, { type: "worktreeOpenTerminal", worktreeId: FEAT_PATH });
    await settle();

    expect(plain.terminals).toEqual([]);
    dispose();
  });

  it("performs nothing for a worktree the host does not hold, and acts on no other", async () => {
    // Not a nearest match, not the first repository, not the workspace root: an
    // action against an unintended target is worse than one that did nothing.
    const { host, view, calls, dispose } = await builtHost();
    for (const worktreeId of ["/repo-wt/deleted", "", "/repo-wt", "/"]) {
      host.handleMessage(view, { type: "worktreeOpenFolder", worktreeId, mode: "newWindow" });
      host.handleMessage(view, { type: "worktreeRevealInOS", worktreeId });
      host.handleMessage(view, { type: "worktreeOpenTerminal", worktreeId });
      host.handleMessage(view, { type: "worktreeCopyPath", worktreeId });
    }
    await settle();

    expect(calls).toEqual([]);
    expect(view.terminals).toEqual([]);
    dispose();
  });
});

describe("a worktree whose directory is gone", () => {
  it("copies its path and does nothing else — that is how a user goes and looks", async () => {
    const { host, view, calls, dispose } = await builtHost([windowRow()], true);
    host.handleMessage(view, { type: "worktreeOpenFolder", worktreeId: FEAT_PATH, mode: "newWindow" });
    host.handleMessage(view, { type: "worktreeRevealInOS", worktreeId: FEAT_PATH });
    host.handleMessage(view, { type: "worktreeOpenTerminal", worktreeId: FEAT_PATH });
    host.handleMessage(view, { type: "worktreeCopyPath", worktreeId: FEAT_PATH });
    await settle();

    expect(calls).toEqual([["copyText", FEAT_PATH]]);
    expect(view.terminals).toEqual([]);
    dispose();
  });
});

// ── Rows, and the value they carried ─────────────────────────────────────

describe("an agent action acts on the row's own pane and session", () => {
  it("focuses the pane in the view the ROW carries, not the one that asked", async () => {
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, { type: "worktreeFocusPane", rowId: "window:a", paneId: "pane-1" });
    await settle();

    expect(calls).toEqual([["focusPane", "pane-1", "view-1"]]);
    dispose();
  });

  it("answers a preview back to the asking surface with the host's entry id", async () => {
    // The overlay is webview-owned, so the extension cannot open one. What the
    // host owns is which entry id the surface is allowed to open.
    const { host, view, dispose } = await builtHost();
    host.handleMessage(view, { type: "worktreeOpenPreview", rowId: "window:a", entryId: SESSION });
    await settle();

    expect(view.posts).toEqual([{ type: "worktreeShowPreview", entryId: SESSION }]);
    dispose();
  });

  it("hands the session capabilities the row's own entry id", async () => {
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, { type: "worktreeCopyResumeCommand", rowId: "window:a", entryId: SESSION });
    host.handleMessage(view, { type: "worktreeRevealAgentCwd", rowId: "window:a", entryId: SESSION });
    host.handleMessage(view, { type: "worktreeCopyAgentPath", rowId: "window:a", entryId: SESSION });
    await settle();

    expect(calls).toEqual([
      ["copyResumeCommand", SESSION],
      ["revealSessionCwd", SESSION],
      ["copySessionCwd", SESSION],
    ]);
    dispose();
  });

  it("performs nothing for a row the host does not hold", async () => {
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, { type: "worktreeFocusPane", rowId: "window:gone", paneId: "pane-1" });
    host.handleMessage(view, { type: "worktreeOpenPreview", rowId: "window:gone", entryId: SESSION });
    host.handleMessage(view, { type: "worktreeCopyResumeCommand", rowId: "window:gone", entryId: SESSION });
    await settle();

    expect(calls).toEqual([]);
    expect(view.posts).toEqual([]);
    dispose();
  });
});

describe("a value that went stale acts on nothing", () => {
  it("refuses a pane the row no longer has", async () => {
    // The surface's last envelope may have been skipped: it still shows the
    // previous pane under a stable row id, and acting on the id it sent would
    // focus a pane that moved.
    const { host, view, calls, dispose } = await builtHost([windowRow({ paneId: "pane-2" })]);
    host.handleMessage(view, { type: "worktreeFocusPane", rowId: "window:a", paneId: "pane-1" });
    await settle();

    expect(calls).toEqual([]);
    dispose();
  });

  it("refuses a session the row no longer has, rather than opening the wrong transcript", async () => {
    const { host, view, calls, dispose } = await builtHost([windowRow({ entryId: "claude:s2" })]);
    host.handleMessage(view, { type: "worktreeOpenPreview", rowId: "window:a", entryId: SESSION });
    host.handleMessage(view, { type: "worktreeCopyResumeCommand", rowId: "window:a", entryId: SESSION });
    host.handleMessage(view, { type: "worktreeRevealAgentCwd", rowId: "window:a", entryId: SESSION });
    host.handleMessage(view, { type: "worktreeCopyAgentPath", rowId: "window:a", entryId: SESSION });
    await settle();

    expect(calls).toEqual([]);
    expect(view.posts).toEqual([]);
    dispose();
  });

  it("refuses a row that has no session at all", async () => {
    const { host, view, calls, dispose } = await builtHost([windowRow({ entryId: undefined })]);
    host.handleMessage(view, { type: "worktreeOpenPreview", rowId: "window:a", entryId: SESSION });
    await settle();

    expect(view.posts).toEqual([]);
    expect(calls).toEqual([]);
    dispose();
  });
});

describe("an external row cannot be focused, however it is asked", () => {
  it("resolves no pane for a row the presence contract gives none", async () => {
    // The view's absent menu item and the setting's override are the other two
    // barriers; this is the innermost, and it holds when both are wrong.
    const { host, view, calls, dispose } = await builtHost([externalRow()]);
    host.handleMessage(view, { type: "worktreeFocusPane", rowId: "external:claude:s9", paneId: "pane-1" });
    await settle();

    expect(calls).toEqual([]);
    dispose();
  });

  it("still previews an external row — that is the one activation it has", async () => {
    const { host, view, dispose } = await builtHost([externalRow()]);
    host.handleMessage(view, { type: "worktreeOpenPreview", rowId: "external:claude:s9", entryId: "claude:s9" });
    await settle();

    expect(view.posts).toEqual([{ type: "worktreeShowPreview", entryId: "claude:s9" }]);
    dispose();
  });
});

describe("the host without capabilities behaves as it did before actions existed", () => {
  it("ignores every action when none are wired", async () => {
    const presence: WorktreePresence = {
      rowsByWorktreeId: { [MAIN_PATH]: [windowRow()] },
      scannedAt: 1,
      degradedSources: [],
    };
    const host = createWorktreeHost({
      deps: deps(),
      workspaceFolders: () => ["/repo"],
      pool: { subscribePattern: () => ({ active: true, dispose: () => {} }) },
      clock,
      projector: { project: async () => presence, rank: () => undefined, rankRevision: () => 0 },
      now: () => 1000,
    });
    const view = surface();
    host.attach(view).setDisplayed(true);
    host.handleMessage(view, { type: "worktreeViewVisibility", visible: true });
    host.handleMessage(view, { type: "requestWorktreeTree" });
    await settle();
    view.posts.length = 0;

    host.handleMessage(view, { type: "worktreeCopyPath", worktreeId: FEAT_PATH });
    host.handleMessage(view, { type: "worktreeOpenPreview", rowId: "window:a", entryId: SESSION });
    await settle();

    expect(view.posts).toEqual([]);
    host.dispose();
  });

  it("performs nothing after disposal", async () => {
    const { host, view, calls } = await builtHost();
    host.dispose();
    host.handleMessage(view, { type: "worktreeCopyPath", worktreeId: FEAT_PATH });
    host.handleMessage(view, { type: "worktreeOpenPreview", rowId: "window:a", entryId: SESSION });
    await settle();

    expect(calls).toEqual([]);
    expect(view.posts).toEqual([]);
  });
});
