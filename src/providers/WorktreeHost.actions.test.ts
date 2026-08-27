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
import type { ExtensionToWebViewMessage, WorktreeMutationResultMessage } from "../types/messages";
import { MAX_CONTINUATION_INSTRUCTION } from "../vault/continuationLimits";
import type { CreateSessionOptions } from "../vault/VaultLauncher";
import { createGitCapabilities } from "../worktree/gitCapabilities";
import type { GitCommandResult, GitCommandRunner } from "../worktree/gitCommandRunner";
import type { PresenceProjector } from "../worktree/presenceProjector";
import type { WorktreeAgentRow, WorktreePresence } from "../worktree/presenceTypes";
import type { RebuildGateClock } from "../worktree/rebuildGate";
import type { GitApiAccessor } from "../worktree/repoRoots";
import type { WorktreeTree } from "../worktree/types";
import type { WorktreeTreeDeps } from "../worktree/WorktreeDiscovery";
import { createWorktreeHost, type WorktreeActions, type WorktreeHost, type WorktreeSurface } from "./WorktreeHost";

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
/** The repo id the fixture's listing produces — git's common dir, not the main path. */
const REPO = "/repo/.git";

/** `gone` is a function where a test needs the worktree to vanish mid-flight. */
function runner(
  gone: boolean | (() => boolean) = false,
  extra: string[][] = [],
  /** The feat worktree's HEAD. Mutable so a test can recreate it elsewhere. */
  head?: { now: string },
): GitCommandRunner {
  const isGone = typeof gone === "function" ? gone : () => gone;
  const run = vi.fn(async (args: readonly string[], cwd: string): Promise<GitCommandResult> => {
    if (args[0] === "--version") {
      return res({ stdout: Buffer.from("git version 2.50.1\n") });
    }
    if (cwd === OTHER_ROOT) {
      return args[0] === "worktree" ? res({ stdout: nul(OTHER) }) : res({ stdout: Buffer.from(`${OTHER_REPO}\n`) });
    }
    if (cwd !== "/repo") {
      return res({ code: 128, stderr: "fatal: not a git repository" });
    }
    const current =
      head === undefined ? FEAT : ["worktree /repo-wt/feat", `HEAD ${head.now}`, "branch refs/heads/feat"];
    const feat = isGone() ? [...current, "prunable gitdir file points to non-existent location"] : current;
    return args[0] === "worktree"
      ? res({ stdout: nul(MAIN, feat, RAW, ...extra) })
      : res({ stdout: Buffer.from("/repo/.git\n") });
  });
  return { run } as unknown as GitCommandRunner;
}

const OTHER_ROOT = "/other";
const OTHER = ["worktree /other", "HEAD 999", "branch refs/heads/main"];
const OTHER_REPO = "/other/.git";

const api: GitApiAccessor = () =>
  ({ state: "initialized", repositories: [{ rootUri: { fsPath: "/repo" } }] }) as ReturnType<GitApiAccessor>;

const apiWithSibling: GitApiAccessor = () =>
  ({
    state: "initialized",
    repositories: [{ rootUri: { fsPath: "/repo" } }, { rootUri: { fsPath: OTHER_ROOT } }],
  }) as ReturnType<GitApiAccessor>;

/** `gone` makes the feat worktree prunable AND absent, which is `missing`. */
function deps(
  gone: boolean | (() => boolean) = false,
  extra: string[][] = [],
  shared?: GitCommandRunner,
  sibling = false,
): WorktreeTreeDeps {
  const isGone = typeof gone === "function" ? gone : () => gone;
  const r = shared ?? runner(gone, extra);
  return {
    runner: r,
    capabilities: createGitCapabilities(r),
    normalize: async (p: string) => p.replace(/\/+$/, "") || "/",
    stat: async (path: string) => {
      if (isGone() && path === FEAT_PATH) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return undefined;
    },
    getGitApi: sibling ? apiWithSibling : api,
  };
}

const clock: RebuildGateClock = { now: () => 0, setTimeout: () => 0, clearTimeout: () => {} };

/**
 * The offer id of the answer the surface most recently received.
 *
 * A launch quotes the answer it was chosen from, so every request here quotes
 * the current one — the tests that care about a STALE quote say so explicitly.
 */
let currentOffer: string | undefined;
const offer = (): string | undefined => currentOffer;

/**
 * The registration token the host last published for the feat worktree.
 *
 * A launch quotes the one its dialog rendered, so every request here quotes the
 * current one — the tests that care about a STALE quote say so explicitly.
 */
let currentGeneration: number | undefined;
const gen = (): number | undefined => currentGeneration;

/** Remember the generation from the most recent tree this surface was posted. */
let lastRepoCount = 0;

function noteTree(view: ReturnType<typeof surface>): void {
  const trees = view.posts.filter((m) => m.type === "worktreeTreeResponse");
  const last = trees[trees.length - 1] as { tree?: WorktreeTree } | undefined;
  if (last?.tree !== undefined) {
    lastRepoCount = last.tree.repos.length;
  }
  const repo = last?.tree?.repos.find((r) => r.worktrees.some((w) => w.id === FEAT_PATH));
  if (repo !== undefined) {
    currentGeneration = repo.generation;
  }
}

/** Publish targets to `view` and remember the offer id the answer carried. */
async function publishTo(host: WorktreeHost, view: ReturnType<typeof surface>): Promise<void> {
  await host.publishLaunchTargets(view);
  const answers = view.posts.filter((m) => m.type === "vaultLaunchTargets");
  currentOffer = (answers[answers.length - 1] as { offerId?: string } | undefined)?.offerId;
}

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
/** The host's own launch-target answer, as the admission door sees it. */
const LAUNCH_TARGETS = [
  {
    agent: "claude" as const,
    displayName: "Claude Code",
    canSeedPrompt: true,
    permissionChoices: [
      { id: "default", label: "Ask for permission" },
      { id: "plan", label: "Plan only" },
    ],
  },
  {
    agent: "opencode" as const,
    displayName: "opencode",
    canSeedPrompt: false,
    permissionChoices: [],
  },
];

function recordingActions() {
  const calls: Array<[string, ...unknown[]]> = [];
  const reconciles: string[][] = [];
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
    createWorktree: track("createWorktree") as NonNullable<WorktreeActions["createWorktree"]>,
    removeWorktree: track("removeWorktree") as NonNullable<WorktreeActions["removeWorktree"]>,
    lockWorktree: track("lockWorktree") as NonNullable<WorktreeActions["lockWorktree"]>,
    unlockWorktree: track("unlockWorktree") as NonNullable<WorktreeActions["unlockWorktree"]>,
    pruneRepo: track("pruneRepo") as NonNullable<WorktreeActions["pruneRepo"]>,
    // What the host published as startable, which is what it now admits a
    // launch against. Also kept out of `calls` — it is asked per admission, not
    // per user action.
    launchTargets: async () => LAUNCH_TARGETS,
    // Kept OUT of `calls`: this fires on every rebuild rather than on a user
    // action, and folding it in would make every action assertion depend on
    // rebuild timing.
    reconcileFingerprints: (present) => {
      reconciles.push([...present]);
    },
  };
  return { actions, calls, reconciles };
}

/**
 * A surface that records what it was asked to do. `terminals` is the surface's
 * own capability, not one of the injected ones — only a provider can create a
 * pane, so the host asks the surface that raised the request.
 */
function surface(canOpenTerminal = true): WorktreeSurface & {
  posts: ExtensionToWebViewMessage[];
  terminals: string[];
  launches: CreateSessionOptions[];
} {
  const posts: ExtensionToWebViewMessage[] = [];
  const terminals: string[] = [];
  const launches: CreateSessionOptions[] = [];
  return {
    posts,
    terminals,
    launches,
    isReady: () => true,
    post: (m) => posts.push(m),
    launchAgent: async (options) => {
      launches.push(options);
    },
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
async function builtHost(
  rows: WorktreeAgentRow[] = [windowRow()],
  gone = false,
  over: {
    extra?: string[][];
    createRoot?: string;
    exists?: (p: string) => boolean;
    /** Add a second, unrelated repository to the workspace. */
    sibling?: boolean;
    /** No watcher can be established, as on a host without file watching. */
    watchFails?: boolean;
    startAgent?: WorktreeActions["startAgent"];
    resumeSessionAt?: WorktreeActions["resumeSessionAt"];
    launchTargets?: WorktreeActions["launchTargets"];
  } = {},
) {
  const presence: WorktreePresence = { rowsByWorktreeId: { [MAIN_PATH]: rows }, scannedAt: 1, degradedSources: [] };
  const projector: PresenceProjector = {
    project: async () => presence,
    rank: () => undefined,
    rankRevision: () => 0,
  };
  const { actions, calls, reconciles } = recordingActions();
  // One runner for the whole host, so a test can observe which git commands the
  // host actually issued — including the ones it deliberately does not.
  const argv: string[][] = [];
  /** The feat worktree's HEAD, moved by `recreate()`. */
  const head = { now: "def" };
  // Mutable, so a test can make the worktree disappear while a launch resolves.
  const missing = { now: gone };
  /** Flipped by `degrade()`: `git worktree list` starts failing. */
  const listingFails = { now: false };
  const isGone = () => missing.now;
  const base = runner(isGone, over.extra ?? [], head);
  const shared: GitCommandRunner = {
    run: async (args, cwd) => {
      argv.push([...args]);
      if (listingFails.now && args[0] === "worktree") {
        return res({ code: 128, stderr: "fatal: could not read the index" });
      }
      return base.run(args, cwd);
    },
  };
  const host = createWorktreeHost({
    deps: deps(isGone, over.extra ?? [], shared, over.sibling === true),
    workspaceFolders: () => (over.sibling === true ? ["/repo", OTHER_ROOT] : ["/repo"]),
    pool: {
      subscribePattern: () =>
        over.watchFails === true
          ? { active: false, failureReason: "watcher unavailable", dispose: () => {} }
          : { active: true, dispose: () => {} },
    },
    clock,
    projector,
    actions: {
      ...actions,
      ...(over.startAgent === undefined ? {} : { startAgent: over.startAgent }),
      ...(over.resumeSessionAt === undefined ? {} : { resumeSessionAt: over.resumeSessionAt }),
      ...(over.launchTargets === undefined ? {} : { launchTargets: over.launchTargets }),
    },
    now: () => 1000,
    // Without these `assessRemoval` returns null before it reaches git, which
    // would make every assertion about WHICH git commands it issues vacuous.
    removalFacts: { panes: () => [], externalSessions: async () => ({ ok: true, value: [] }) },
    ...(over.exists === undefined ? {} : { exists: over.exists }),
    ...(over.createRoot === undefined ? {} : { createRoot: () => ({ value: over.createRoot, explicitlySet: true }) }),
  });
  const view = surface();
  const attachment = host.attach(view);
  attachment.setDisplayed(true);
  host.handleMessage(view, { type: "worktreeViewVisibility", visible: true });
  host.handleMessage(view, { type: "requestWorktreeTree" });
  // The panel asks this on the way in, and the answer is what admission checks —
  // a host that was never asked has offered nothing and admits nothing.
  await publishTo(host, view);
  await settle();
  noteTree(view);
  view.posts.length = 0;
  return {
    host,
    view,
    calls,
    reconciles,
    /** How many `git status` invocations the host has made so far. */
    statusRuns: () => argv.filter((a) => a[0] === "status").length,
    /** Replace the feat worktree with a different one at the same id. */
    recreate: async () => {
      head.now = "0123456789abcdef0123456789abcdef01234567";
      host.handleMessage(view, { type: "requestWorktreeTree", force: true });
      await settle();
      noteTree(view);
    },
    /**
     * Re-list the repository with git reporting exactly what it reported
     * before — the shape a remove-and-recreate onto the same branch at the same
     * commit produces, which no value git returns can distinguish (round-4 B6).
     */
    relist: async () => {
      host.handleMessage(view, { type: "requestWorktreeTree", force: true });
      await settle();
      noteTree(view);
    },
    /**
     * Make the repository's listing fail, so the cache RETAINS what it holds
     * rather than observing it.
     */
    degrade: async () => {
      listingFails.now = true;
      host.handleMessage(view, { type: "requestWorktreeTree", force: true });
      await settle();
      noteTree(view);
    },
    /** How many repositories the host currently holds. */
    repoCount: () => {
      const trees = view.posts.filter((m) => m.type === "worktreeTreeResponse");
      const last = trees[trees.length - 1] as { tree?: WorktreeTree } | undefined;
      return last?.tree?.repos.length ?? lastRepoCount;
    },
    /** Rebuild ONLY the sibling repository, which this launch has nothing to do with. */
    rebuildSibling: async () => {
      await host.mutationBindings().forceRebuild(OTHER_REPO);
      await settle();
      noteTree(view);
    },
    /** Make the feat worktree vanish and let the host see that it did. */
    vanish: async () => {
      missing.now = true;
      host.handleMessage(view, { type: "requestWorktreeTree", force: true });
      await settle();
      noteTree(view);
    },
    dispose: () => host.dispose(),
  };
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

describe("mutating actions resolve their own target", () => {
  it("locks the worktree git named, with the reason as a separate value", async () => {
    const { host, view, calls, dispose } = await builtHost();
    // The ID travels, not the path: the capability re-resolves it on the far
    // side of a forced rebuild, because a path resolved here would name
    // whatever registration held it when the message arrived rather than when
    // git runs (round-1 B2). RAW is the one whose id and displayPath differ, so
    // a host that quietly substituted the path is caught here. That the id maps
    // to RAW_DISPLAY is proved in worktreeMutationService.test.ts, where the
    // resolution now lives.
    host.handleMessage(view, { type: "worktreeLock", worktreeId: RAW_ID, reason: "release build" });
    await settle();

    expect(calls).toEqual([["lockWorktree", { repoId: REPO, worktreeId: RAW_ID, origin: view }, "release build"]]);
    dispose();
  });

  it("locks without a reason when none was given", async () => {
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, { type: "worktreeLock", worktreeId: FEAT_PATH });
    await settle();

    expect(calls).toEqual([["lockWorktree", { repoId: REPO, worktreeId: FEAT_PATH, origin: view }, undefined]]);
    dispose();
  });

  it("unlocks the worktree git named", async () => {
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, { type: "worktreeUnlock", worktreeId: RAW_ID });
    await settle();

    expect(calls).toEqual([["unlockWorktree", { repoId: REPO, worktreeId: RAW_ID, origin: view }]]);
    dispose();
  });

  it("acts on nothing when the worktree id is not one the host published", async () => {
    // A destructive verb against an unresolvable id is the case where doing
    // nothing is unambiguously right.
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, { type: "worktreeLock", worktreeId: "/not/a/worktree" });
    host.handleMessage(view, { type: "worktreeUnlock", worktreeId: "/not/a/worktree" });
    await settle();

    expect(calls).toEqual([]);
    dispose();
  });

  it("does not lock a worktree whose directory is gone", async () => {
    const { host, view, calls, dispose } = await builtHost([windowRow()], true);
    host.handleMessage(view, { type: "worktreeLock", worktreeId: FEAT_PATH });
    await settle();

    expect(calls).toEqual([]);
    dispose();
  });

  it("prunes against the repository, carrying the count the confirmation named", async () => {
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, { type: "worktreePrune", repoId: "/repo", confirmedCount: 2 });
    await settle();

    expect(calls).toEqual([["pruneRepo", "/repo", 2, view]]);
    dispose();
  });

  it("ignores a prune with no repository to act on", async () => {
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, { type: "worktreePrune", repoId: "", confirmedCount: 1 });
    await settle();

    expect(calls).toEqual([]);
    dispose();
  });
});

describe("removal resolves its target and refuses an unauthorized force", () => {
  it("removes the worktree git named, unforced", async () => {
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, { type: "worktreeRemove", worktreeId: RAW_ID, force: false });
    await settle();

    expect(calls).toEqual([["removeWorktree", { repoId: REPO, worktreeId: RAW_ID, origin: view }, false, undefined]]);
    dispose();
  });

  it("passes a force through with the fingerprint that authorized it", async () => {
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, { type: "worktreeRemove", worktreeId: FEAT_PATH, force: true, fingerprint: "fp-1" });
    await settle();

    expect(calls).toEqual([["removeWorktree", { repoId: REPO, worktreeId: FEAT_PATH, origin: view }, true, "fp-1"]]);
    dispose();
  });

  it("acts on nothing when a force carries no fingerprint", async () => {
    // A force authorizes exactly the blocker set the user saw; with no
    // identifier there is no set, so there is nothing to authorize.
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, { type: "worktreeRemove", worktreeId: FEAT_PATH, force: true });
    await settle();

    expect(calls).toEqual([]);
    dispose();
  });

  it("acts on nothing when an unforced removal carries a fingerprint we never issued for it", async () => {
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, { type: "worktreeRemove", worktreeId: FEAT_PATH, force: false, fingerprint: "fp-1" });
    await settle();

    expect(calls).toEqual([]);
    dispose();
  });

  it("still removes a worktree whose directory is gone, because that is how the registration is pruned", async () => {
    const { host, view, calls, dispose } = await builtHost([windowRow()], true);
    host.handleMessage(view, { type: "worktreeRemove", worktreeId: FEAT_PATH, force: false });
    await settle();

    expect(calls).toEqual([
      ["removeWorktree", { repoId: REPO, worktreeId: FEAT_PATH, origin: view }, false, undefined],
    ]);
    dispose();
  });
});

describe("create validates the shape before it delegates", () => {
  const REQ = { type: "worktreeCreate", repoId: "/repo", path: "/trees/feat", openAfter: "none" } as const;

  it("hands the request to the capability", async () => {
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, { ...REQ, branch: "feat", baseRef: "origin/main" });
    await settle();

    expect(calls).toEqual([
      [
        "createWorktree",
        {
          repoId: "/repo",
          path: "/trees/feat",
          branch: "feat",
          baseRef: "origin/main",
          detach: undefined,
          openAfter: "none",
          origin: view,
        },
      ],
    ]);
    dispose();
  });

  it("rejects the agent mode until WT-005.3 supplies the launch", async () => {
    // The form does not offer it; this is the defence behind that, so a hand-sent
    // message cannot reach a launch that does not exist.
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, { ...REQ, openAfter: "agent" as never });
    await settle();

    expect(calls).toEqual([]);
    dispose();
  });

  it("rejects a mode that is not one of the documented ones", async () => {
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, { ...REQ, openAfter: "somethingElse" as never });
    await settle();

    expect(calls).toEqual([]);
    dispose();
  });

  it("acts on nothing when the path is empty", async () => {
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, { ...REQ, path: "" });
    await settle();

    expect(calls).toEqual([]);
    dispose();
  });
});

// ── What comes back ──────────────────────────────────────────────────────

describe("the destination a create opens on comes from the host", () => {
  it("answers a defaults request with a root and a free path under it", async () => {
    // The panel may not guess: a webview-computed path states a destination the
    // create could refuse, which the spec forbids outright.
    const { host, view, dispose } = await builtHost();
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO });
    await settle();

    const answer = view.posts.find((m) => m.type === "worktreeCreateDefaults");
    expect(answer).toMatchObject({ type: "worktreeCreateDefaults", repoId: REPO });
    const defaults = answer as { root: string; path: string };
    expect(defaults.path.startsWith(defaults.root)).toBe(true);
    dispose();
  });

  it("does not suggest a path a registration already holds", async () => {
    // The default name under `/trees` is `/trees/worktree`, and this repo has a
    // registration sitting exactly there. Suggesting it would state a
    // destination the create refuses on its first git call, so the host has to
    // hand its own registrations to the suggester rather than name the
    // candidate blind.
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      extra: [["worktree /trees/repo", "HEAD 345", "branch refs/heads/taken"]],
    });
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO });
    await settle();

    const defaults = view.posts.find((m) => m.type === "worktreeCreateDefaults") as {
      root: string;
      prefix: string;
      path: string;
      collidedWith?: string;
    };
    expect(defaults.root).toBe("/trees");
    // The repo's own name, so the form's `…/<prefix>-<branch>` placeholder and
    // the destination it opens on describe one scheme rather than two.
    expect(defaults.prefix).toBe("repo");
    expect(defaults.path).not.toBe("/trees/repo");
    expect(defaults.collidedWith).toBe("/trees/repo");
    dispose();
  });

  it("names no collision when the first candidate was free", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], false, { createRoot: "/trees" });
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO });
    await settle();

    const defaults = view.posts.find((m) => m.type === "worktreeCreateDefaults") as {
      path: string;
      collidedWith?: string;
    };
    expect(defaults.path).toBe("/trees/repo");
    expect(defaults.collidedWith).toBeUndefined();
    dispose();
  });

  it("answers nothing for a repository it never published", async () => {
    const { host, view, dispose } = await builtHost();
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: "/not/a/repo" });
    await settle();

    expect(view.posts.filter((m) => m.type === "worktreeCreateDefaults")).toEqual([]);
    dispose();
  });
});

describe("an outcome returns to the surface that asked for it", () => {
  const OK: WorktreeMutationResultMessage = {
    type: "worktreeMutationResult",
    verb: "remove",
    repoId: REPO,
    result: { kind: "ok" },
  };

  it("posts the result to the originating surface and to no other", async () => {
    // D17: the tree broadcasts because a vanished worktree must vanish
    // everywhere, but the OUTCOME belongs to the surface still holding the
    // dialog state the mutation left behind.
    const { host, view, dispose } = await builtHost();
    const other = surface();
    host.attach(other).setDisplayed(true);
    other.posts.length = 0;

    host.reportMutation({ origin: view, message: OK });

    expect(view.posts).toEqual([OK]);
    expect(other.posts.filter((m) => m.type === "worktreeMutationResult")).toEqual([]);
    dispose();
  });

  it("drops an outcome whose origin is gone rather than picking a surface for it", async () => {
    const { host, view, dispose } = await builtHost();
    host.reportMutation({ origin: null, message: OK });

    expect(view.posts.filter((m) => m.type === "worktreeMutationResult")).toEqual([]);
    dispose();
  });

  it("opens the terminal a create asked for on that same surface", async () => {
    const { host, view, dispose } = await builtHost();
    const other = surface();
    host.attach(other).setDisplayed(true);

    host.reportMutation({
      origin: view,
      message: { ...OK, verb: "create" },
      openTerminalAt: "/repo-wt/new",
    });
    await settle();

    expect(view.terminals).toEqual(["/repo-wt/new"]);
    expect(other.terminals).toEqual([]);
    dispose();
  });

  it("opens no terminal for a create that did not ask for one", async () => {
    const { host, view, dispose } = await builtHost();
    host.reportMutation({ origin: view, message: { ...OK, verb: "create" } });
    await settle();

    expect(view.terminals).toEqual([]);
    dispose();
  });

  it("reports nothing once the host is disposed", async () => {
    const { host, view } = await builtHost();
    host.dispose();
    host.reportMutation({ origin: view, message: OK });

    expect(view.posts.filter((m) => m.type === "worktreeMutationResult")).toEqual([]);
  });
});

describe("a rebuild is an observation of what still exists", () => {
  it("hands every authoritative rebuild the ids it found, so a vanished confirmation dies", async () => {
    // Round-3 B5: reconciliation lived only in the removal path, so a worktree
    // deleted by another window or by hand left its confirmation live.
    const { reconciles, dispose } = await builtHost();

    expect(reconciles.length).toBeGreaterThan(0);
    expect(reconciles.at(-1)).toEqual([MAIN_PATH, FEAT_PATH, RAW_ID]);
    dispose();
  });

  it("counts a REGISTERED worktree as present even when its directory is gone", async () => {
    // The absence D15 acts on is the registration's. A `missing` worktree is
    // still removable, so its confirmation must survive to authorize that.
    const { reconciles, dispose } = await builtHost([windowRow()], true);

    expect(reconciles.at(-1)).toContain(FEAT_PATH);
    dispose();
  });
});

describe("assessing a worktree whose directory is gone", () => {
  it("does not ask an absent directory for its status", async () => {
    // Round-3 B8: the spawn fails every time, so the assessment was permanently
    // `unavailable` and the stale registration could never be pruned by removal.
    const { host, dispose, statusRuns } = await builtHost([windowRow()], true);
    const assess = host.mutationBindings().assessRemoval;
    const before = statusRuns();

    const result = await assess({ repoId: REPO, worktreeId: FEAT_PATH });

    expect(statusRuns()).toBe(before);
    expect(result).toMatchObject({ kind: "confirmable" });
    dispose();
  });

  it("still asks a directory that IS there", async () => {
    // The negative that gives the case above its meaning: only an absent
    // directory is exempt, so D16 still holds everywhere else.
    const { host, dispose, statusRuns } = await builtHost();
    const assess = host.mutationBindings().assessRemoval;
    const before = statusRuns();

    await assess({ repoId: REPO, worktreeId: FEAT_PATH });

    expect(statusRuns()).toBe(before + 1);
    dispose();
  });
});

describe("the destination the host resolves for a branch", () => {
  it("resolves against the branch-derived name, not the bare default", async () => {
    // Round-3 B12: the host checked `<root>/<label>` for collisions while the
    // form submitted `<parent>/<prefix>-<branch>`, so the path proved free and
    // the path created were different paths.
    const { host, view, dispose } = await builtHost([windowRow()], false, { createRoot: "/trees" });
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, branch: "feat/Login UI" });
    await settle();

    const answer = view.posts.find((m) => m.type === "worktreeCreateDefaults") as { path: string };
    expect(answer.path).toBe("/trees/repo-feat-login-ui");
    dispose();
  });

  it("falls back to the bare default when no branch has been typed yet", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], false, { createRoot: "/trees" });
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO });
    await settle();

    expect((view.posts.find((m) => m.type === "worktreeCreateDefaults") as { path: string }).path).toBe("/trees/repo");
    dispose();
  });

  it("treats a directory nobody registered as taken", async () => {
    // `git worktree add` fails on any existing non-empty directory, registered
    // or not, so proving a path free against the listing alone proves nothing.
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      exists: (p: string) => p === "/trees/repo",
    });
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO });
    await settle();

    const answer = view.posts.find((m) => m.type === "worktreeCreateDefaults") as {
      path: string;
      collidedWith?: string;
    };
    expect(answer.path).not.toBe("/trees/repo");
    expect(answer.collidedWith).toBe("/trees/repo");
    dispose();
  });
});

describe("launching an agent", () => {
  const OPTS: CreateSessionOptions = { shell: "claude", shellArgs: [], cwd: FEAT_PATH, isAgentLaunch: true };
  const ok = () => vi.fn(async () => OPTS);

  it("resolves the worktree from its own tree and opens the pane on the asking surface", async () => {
    const startAgent = ok();
    const { host, view, dispose } = await builtHost([windowRow()], false, { startAgent });
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      offerId: offer(),
      worktreeId: FEAT_PATH,
      agent: "claude",
    });
    await settle();
    expect(startAgent).toHaveBeenCalledWith("claude", FEAT_PATH, {});
    expect(view.launches).toEqual([OPTS]);
    dispose();
  });

  it("passes the display path git reported, never the normalized id", async () => {
    const startAgent = ok();
    const { host, view, dispose } = await builtHost([windowRow()], false, { startAgent });
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      offerId: offer(),
      worktreeId: RAW_ID,
      agent: "claude",
    });
    await settle();
    expect(startAgent).toHaveBeenCalledWith("claude", RAW_DISPLAY, {});
    dispose();
  });

  it("launches nothing for a worktree the host does not hold", async () => {
    const startAgent = ok();
    const { host, view, dispose } = await builtHost([windowRow()], false, { startAgent });
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      offerId: offer(),
      worktreeId: "/somewhere/else",
      agent: "claude",
    });
    await settle();
    expect(startAgent).not.toHaveBeenCalled();
    expect(view.launches).toEqual([]);
    dispose();
  });

  it("carries the posture and prompt through untouched", async () => {
    const startAgent = ok();
    const { host, view, dispose } = await builtHost([windowRow()], false, { startAgent });
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      offerId: offer(),
      worktreeId: FEAT_PATH,
      agent: "claude",
      permissionChoiceId: "plan",
      prompt: "read the spec",
    });
    await settle();
    expect(startAgent).toHaveBeenCalledWith("claude", FEAT_PATH, {
      permissionChoiceId: "plan",
      prompt: "read the spec",
    });
    dispose();
  });

  it("refuses an agent the host never published as startable", async () => {
    // The launcher would happily run any agent the registry declares. What the
    // panel was OFFERED is a smaller set, and that is the set a request has to
    // come from — a stale list or a forged message is not a second opinion.
    const startAgent = ok();
    const { host, view, dispose } = await builtHost([windowRow()], false, { startAgent });
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      offerId: offer(),
      worktreeId: FEAT_PATH,
      agent: "codex",
    });
    await settle();
    expect(startAgent).not.toHaveBeenCalled();
    expect(view.launches).toEqual([]);
    dispose();
  });

  it("refuses a posture the chosen agent does not declare", async () => {
    const startAgent = ok();
    const { host, view, dispose } = await builtHost([windowRow()], false, { startAgent });
    for (const permissionChoiceId of ["bypassPermissions", "read-only"]) {
      host.handleMessage(view, {
        type: "worktreeLaunchAgent",
        generation: gen(),
        offerId: offer(),
        worktreeId: FEAT_PATH,
        agent: "claude",
        permissionChoiceId,
      });
    }
    // And one the agent declares no postures at all for.
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      offerId: offer(),
      worktreeId: FEAT_PATH,
      agent: "opencode",
      permissionChoiceId: "default",
    });
    await settle();
    expect(startAgent).not.toHaveBeenCalled();
    dispose();
  });

  it("refuses a prompt for an agent the host did not report as seedable", async () => {
    const startAgent = ok();
    const { host, view, dispose } = await builtHost([windowRow()], false, { startAgent });
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      offerId: offer(),
      worktreeId: FEAT_PATH,
      agent: "opencode",
      prompt: "read the spec",
    });
    await settle();
    expect(startAgent).not.toHaveBeenCalled();
    // The same agent WITHOUT one is fine — seeding is the part it cannot do.
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      offerId: offer(),
      worktreeId: FEAT_PATH,
      agent: "opencode",
    });
    await settle();
    expect(startAgent).toHaveBeenCalledWith("opencode", FEAT_PATH, {});
    dispose();
  });

  it("launches nothing when this host publishes no launch targets at all", async () => {
    const startAgent = ok();
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      startAgent,
      launchTargets: async () => [],
    });
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      offerId: offer(),
      worktreeId: FEAT_PATH,
      agent: "claude",
    });
    await settle();
    expect(startAgent).not.toHaveBeenCalled();
    dispose();
  });

  it("survives a launch payload whose fields are not what the type says", async () => {
    // The router asserts a message NAME; the payload is whatever arrived. A null
    // prompt must be refused, not thrown on before anything can catch it.
    const startAgent = ok();
    const { host, view, dispose } = await builtHost([windowRow()], false, { startAgent });
    for (const bad of [{ prompt: null }, { agent: 7 }, { permissionChoiceId: {} }]) {
      expect(() =>
        host.handleMessage(view, {
          type: "worktreeLaunchAgent",
          generation: gen(),
          offerId: offer(),
          worktreeId: FEAT_PATH,
          agent: "claude",
          ...bad,
        } as never),
      ).not.toThrow();
    }
    await settle();
    expect(startAgent).not.toHaveBeenCalled();
    dispose();
  });

  it("admits against what this surface was OFFERED, not against what is installed now", async () => {
    // The drift the second probe could not see: an agent that becomes
    // detectable AFTER the panel was answered was still never offered, so a
    // request naming it is a request from a list the user never saw.
    const startAgent = ok();
    let answer = [LAUNCH_TARGETS[0] as (typeof LAUNCH_TARGETS)[number]];
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      startAgent,
      launchTargets: async () => answer,
    });
    answer = [...LAUNCH_TARGETS];
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      offerId: offer(),
      worktreeId: FEAT_PATH,
      agent: "opencode",
    });
    await settle();
    expect(startAgent).not.toHaveBeenCalled();
    // And once the surface is answered again, the same request is admitted.
    await publishTo(host, view);
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      offerId: offer(),
      worktreeId: FEAT_PATH,
      agent: "opencode",
    });
    await settle();
    expect(startAgent).toHaveBeenCalledWith("opencode", FEAT_PATH, {});
    dispose();
  });

  it("refuses a launch quoting an answer this surface no longer holds", async () => {
    // The panel may hold an answer the host has replaced — a refresh landing
    // while a dialog is open, or a post that never arrived. Admitting on the
    // NEW set would judge the request against a list nobody rendered.
    const startAgent = ok();
    const { host, view, dispose } = await builtHost([windowRow()], false, { startAgent });
    const stale = offer();
    await publishTo(host, view);
    expect(offer()).not.toBe(stale);
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      worktreeId: FEAT_PATH,
      agent: "claude",
      offerId: stale,
    });
    await settle();
    expect(startAgent).not.toHaveBeenCalled();
    dispose();
  });

  it("refuses a launch that quotes no answer at all", async () => {
    const startAgent = ok();
    const { host, view, dispose } = await builtHost([windowRow()], false, { startAgent });
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      worktreeId: FEAT_PATH,
      agent: "claude",
    });
    await settle();
    expect(startAgent).not.toHaveBeenCalled();
    dispose();
  });

  it("admits nothing on a surface that was never answered", async () => {
    const startAgent = ok();
    const { host, dispose } = await builtHost([windowRow()], false, { startAgent });
    // A second surface, attached but never asking: it holds no offer of its own.
    const other = surface();
    host.attach(other).setDisplayed(true);
    host.handleMessage(other, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      offerId: offer(),
      worktreeId: FEAT_PATH,
      agent: "claude",
    });
    await settle();
    expect(startAgent).not.toHaveBeenCalled();
    dispose();
  });

  it("does not hand over a launch whose worktree went away while it resolved", async () => {
    // Admission and executable resolution both await. The path read at the
    // request is the one thing that cannot be trusted at the handoff.
    let release: (() => void) | undefined;
    const startAgent = vi.fn(
      async () =>
        new Promise<CreateSessionOptions>((resolve) => {
          release = () => resolve(OPTS);
        }),
    );
    const { host, view, dispose, vanish } = await builtHost([windowRow()], false, { startAgent });
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      offerId: offer(),
      worktreeId: FEAT_PATH,
      agent: "claude",
    });
    await settle();
    expect(startAgent).toHaveBeenCalled();
    // The worktree disappears mid-resolution, then the launcher answers.
    await vanish();
    release?.();
    await settle();
    expect(view.launches).toEqual([]);
    dispose();
  });

  it("does not hand over a launch to a worktree RECREATED at the same id", async () => {
    // Presence is not identity: remove-then-recreate answers "something is
    // there" while being a different worktree than the one the user picked.
    let release: (() => void) | undefined;
    const startAgent = vi.fn(
      async () =>
        new Promise<CreateSessionOptions>((resolve) => {
          release = () => resolve(OPTS);
        }),
    );
    const { host, view, dispose, recreate } = await builtHost([windowRow()], false, { startAgent });
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      worktreeId: FEAT_PATH,
      agent: "claude",
      offerId: offer(),
    });
    await settle();
    await recreate();
    release?.();
    await settle();
    expect(view.launches).toEqual([]);
    dispose();
  });

  it("does not hand over a launch across a re-list that reported the very same worktree", async () => {
    // The one git cannot answer: removed and recreated at the same path, on the
    // same branch, at the same commit lists identically. `head:branch` admitted
    // it (round-4 B6); the host's own registration token does not, because the
    // token says "I re-observed" rather than "nothing changed".
    let release: (() => void) | undefined;
    const startAgent = vi.fn(
      async () =>
        new Promise<CreateSessionOptions>((resolve) => {
          release = () => resolve(OPTS);
        }),
    );
    const { host, view, dispose, relist } = await builtHost([windowRow()], false, { startAgent });
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      offerId: offer(),
      worktreeId: FEAT_PATH,
      agent: "claude",
    });
    await settle();
    expect(startAgent).toHaveBeenCalled();
    await relist();
    release?.();
    await settle();
    expect(view.launches).toEqual([]);
    dispose();
  });

  it("hands over a launch that no rebuild interrupted", async () => {
    // The other half of the guard: refusing is only correct if the ordinary
    // path still goes through. A token that refused everything would pass every
    // staleness test and ship a dead feature.
    const startAgent = ok();
    const { host, view, dispose } = await builtHost([windowRow()], false, { startAgent });
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      offerId: offer(),
      worktreeId: FEAT_PATH,
      agent: "claude",
    });
    await settle();
    expect(view.launches).toHaveLength(1);
    dispose();
  });

  it("admits nothing while the repository's listing is retained rather than observed", async () => {
    // The cache keeps the last-good worktrees when a listing fails — right for
    // display, and no basis at all for authority. A dialog opened now has no
    // registration to quote, and one opened before quotes a number that is
    // gone; both refuse (round-5 B7).
    const startAgent = ok();
    const { host, view, dispose, degrade } = await builtHost([windowRow()], false, { startAgent });
    const stale = gen();
    await degrade();
    // Still displayed, so this is a refusal of authority, not of existence.
    expect(view.posts.filter((m) => m.type === "worktreeTreeResponse").length).toBeGreaterThan(0);
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: stale,
      offerId: offer(),
      worktreeId: FEAT_PATH,
      agent: "claude",
    });
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      offerId: offer(),
      worktreeId: FEAT_PATH,
      agent: "claude",
    });
    await settle();
    expect(startAgent).not.toHaveBeenCalled();
    dispose();
  });

  it("refuses a launch quoting the registration a re-list has already replaced", async () => {
    // Refused at ADMISSION, before the launcher is asked to resolve anything:
    // a stale quote is not a request to check later, it is already wrong.
    const startAgent = ok();
    const { host, view, dispose, relist } = await builtHost([windowRow()], false, { startAgent });
    const stale = gen();
    await relist();
    expect(gen()).not.toBe(stale);
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: stale,
      offerId: offer(),
      worktreeId: FEAT_PATH,
      agent: "claude",
    });
    await settle();
    expect(startAgent).not.toHaveBeenCalled();
    dispose();
  });

  it("hands over a launch that only an UNRELATED repository's rebuild interrupted", async () => {
    // The reason the token is per repository rather than the global tree
    // version: someone else's repository moving is not news about this one, and
    // refusing there would make the guard fire constantly in a multi-repo
    // workspace (design.md D10, round-7 W6).
    let release: (() => void) | undefined;
    const startAgent = vi.fn(
      async () =>
        new Promise<CreateSessionOptions>((resolve) => {
          release = () => resolve(OPTS);
        }),
    );
    const { host, view, dispose, rebuildSibling, repoCount } = await builtHost([windowRow()], false, {
      sibling: true,
      startAgent,
    });
    // Otherwise the rebuild below is a no-op and this test proves nothing.
    expect(repoCount()).toBe(2);
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      offerId: offer(),
      worktreeId: FEAT_PATH,
      agent: "claude",
    });
    await settle();
    expect(startAgent).toHaveBeenCalled();
    await rebuildSibling();
    release?.();
    await settle();
    expect(view.launches).toHaveLength(1);
    dispose();
  });

  it("still admits a launch from a repository it cannot WATCH, and says the tree may be stale", async () => {
    // D11's boundary, made explicit: "this listing failed" withdraws authority,
    // "I cannot watch this for later changes" does not — the registrations were
    // read either way, and refusing here would leave a watcher-less host with no
    // launch capability at all. The disclosure is what makes that acceptable, so
    // both halves are asserted together (round-7 W6, W8).
    const startAgent = ok();
    const { host, view, dispose } = await builtHost([windowRow()], false, { watchFails: true, startAgent });
    host.handleMessage(view, { type: "requestWorktreeTree", force: true });
    await settle();
    const trees = view.posts.filter((m) => m.type === "worktreeTreeResponse");
    const last = trees[trees.length - 1] as { tree?: WorktreeTree } | undefined;
    const repo = last?.tree?.repos.find((r) => r.worktrees.some((w) => w.id === FEAT_PATH));
    expect(repo?.degraded).toContain("not being watched");
    noteTree(view);
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      offerId: offer(),
      worktreeId: FEAT_PATH,
      agent: "claude",
    });
    await settle();
    expect(view.launches).toHaveLength(1);
    dispose();
  });

  it("refuses a prompt past the published bound rather than truncating it", async () => {
    const startAgent = ok();
    const { host, view, dispose } = await builtHost([windowRow()], false, { startAgent });
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      offerId: offer(),
      worktreeId: FEAT_PATH,
      agent: "claude",
      prompt: "x".repeat(MAX_CONTINUATION_INSTRUCTION + 1),
    });
    await settle();
    expect(startAgent).not.toHaveBeenCalled();
    dispose();
  });

  it("tells the asking surface when the launch fails", async () => {
    // NOT swallowed to a log the way a copy or a reveal is: the user asked for a
    // pane and did not get one, and this is the only error surface it has.
    const startAgent = vi.fn(async () => {
      throw new Error("No executable found for Claude Code");
    });
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      startAgent: startAgent as unknown as WorktreeActions["startAgent"],
    });
    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      offerId: offer(),
      worktreeId: FEAT_PATH,
      agent: "claude",
    });
    await settle();
    expect(view.launches).toEqual([]);
    expect(view.posts).toContainEqual({
      type: "error",
      message: "No executable found for Claude Code",
      severity: "error",
    });
    dispose();
  });

  it("offers no launch at all from a surface that cannot open a pane", async () => {
    const startAgent = ok();
    const { host, dispose } = await builtHost([windowRow()], false, { startAgent });
    const paneless: WorktreeSurface = { isReady: () => true, post: () => {} };
    host.attach(paneless).setDisplayed(true);
    host.handleMessage(paneless, { type: "worktreeViewVisibility", visible: true });
    await settle();
    host.handleMessage(paneless, {
      type: "worktreeLaunchAgent",
      generation: gen(),
      offerId: offer(),
      worktreeId: FEAT_PATH,
      agent: "claude",
    });
    await settle();
    expect(startAgent).not.toHaveBeenCalled();
    dispose();
  });
});

describe("resuming a session into a worktree", () => {
  const OPTS: CreateSessionOptions = {
    shell: "claude",
    shellArgs: ["--resume", "s1"],
    cwd: FEAT_PATH,
    isAgentLaunch: true,
  };
  const ok = () => vi.fn(async () => OPTS);

  it("resumes the published row's own session, in the resolved worktree", async () => {
    const resumeSessionAt = ok();
    const { host, view, dispose } = await builtHost([windowRow()], false, { resumeSessionAt });
    host.handleMessage(view, {
      type: "worktreeResumeHere",
      generation: gen(),
      worktreeId: FEAT_PATH,
      rowId: "window:a",
      entryId: SESSION,
    });
    await settle();
    expect(resumeSessionAt).toHaveBeenCalledWith(SESSION, FEAT_PATH);
    expect(view.launches).toEqual([OPTS]);
    dispose();
  });

  it("refuses a RESUME quoting the registration the row was rendered under, once replaced", async () => {
    // A resume is raised on a rendered row, so it inherits the same rule as a
    // choice made from a rendered list: the row can survive a replacement — the
    // session is still that session — while the worktree under it does not
    // (round-5 B5).
    const resumeSessionAt = vi.fn(async () => OPTS);
    const { host, view, dispose, relist } = await builtHost([windowRow()], false, { resumeSessionAt });
    const stale = gen();
    await relist();
    host.handleMessage(view, {
      type: "worktreeResumeHere",
      generation: stale,
      worktreeId: FEAT_PATH,
      rowId: "window:a",
      entryId: SESSION,
    });
    await settle();
    expect(resumeSessionAt).not.toHaveBeenCalled();
    dispose();
  });

  it("does not hand over a RESUME whose worktree changed while the session resolved", async () => {
    // Resume Here goes through the same handoff as a fresh launch, and has the
    // same window: the vault read is asynchronous too.
    let release: (() => void) | undefined;
    const resumeSessionAt = vi.fn(
      async () =>
        new Promise<CreateSessionOptions>((resolve) => {
          release = () => resolve(OPTS);
        }),
    );
    const { host, view, dispose, vanish } = await builtHost([windowRow()], false, { resumeSessionAt });
    host.handleMessage(view, {
      type: "worktreeResumeHere",
      generation: gen(),
      worktreeId: FEAT_PATH,
      rowId: "window:a",
      entryId: SESSION,
    });
    await settle();
    expect(resumeSessionAt).toHaveBeenCalled();
    await vanish();
    release?.();
    await settle();
    expect(view.launches).toEqual([]);
    dispose();
  });

  it("resumes nothing when the row no longer holds the session the request names", async () => {
    const resumeSessionAt = ok();
    const { host, view, dispose } = await builtHost([windowRow({ entryId: "claude:moved" })], false, {
      resumeSessionAt,
    });
    host.handleMessage(view, {
      type: "worktreeResumeHere",
      generation: gen(),
      worktreeId: FEAT_PATH,
      rowId: "window:a",
      entryId: SESSION,
    });
    await settle();
    expect(resumeSessionAt).not.toHaveBeenCalled();
    dispose();
  });

  it("resumes nothing when the worktree went stale, even with a matching row", async () => {
    const resumeSessionAt = ok();
    const { host, view, dispose } = await builtHost([windowRow()], false, { resumeSessionAt });
    host.handleMessage(view, {
      type: "worktreeResumeHere",
      generation: gen(),
      worktreeId: "/gone",
      rowId: "window:a",
      entryId: SESSION,
    });
    await settle();
    expect(resumeSessionAt).not.toHaveBeenCalled();
    dispose();
  });
});

describe("create with a launch", () => {
  const REQ = { type: "worktreeCreate", repoId: REPO, path: "/trees/feat" } as const;
  const creates = (calls: Array<[string, ...unknown[]]>) => calls.filter(([name]) => name === "createWorktree");

  it("accepts the agent mode now that a launch exists behind it", async () => {
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, { ...REQ, openAfter: "agent", launch: { offerId: offer(), agent: "claude" } });
    await settle();
    expect(creates(calls)).toHaveLength(1);
    expect(creates(calls)[0]?.[1]).toMatchObject({ openAfter: "agent", launch: { offerId: offer(), agent: "claude" } });
    dispose();
  });

  it("creates NOTHING for a launch the host would not admit", async () => {
    // Order is the whole point: refusing after git ran would leave the user a
    // worktree they only asked for as a place to put an agent.
    const { host, view, calls, dispose } = await builtHost();
    for (const launch of [
      { offerId: offer(), agent: "codex" },
      { offerId: offer(), agent: "claude", permissionChoiceId: "bypassPermissions" },
      { offerId: offer(), agent: "opencode", prompt: "read the spec" },
    ]) {
      host.handleMessage(view, { ...REQ, openAfter: "agent", launch } as never);
    }
    await settle();
    expect(creates(calls)).toHaveLength(0);
    dispose();
  });

  it("refuses an agent mode that describes no launch", async () => {
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, { ...REQ, openAfter: "agent" } as never);
    await settle();
    expect(creates(calls)).toHaveLength(0);
    dispose();
  });

  it("refuses launch details riding a mode that is not launching", async () => {
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, { ...REQ, openAfter: "none", launch: { offerId: offer(), agent: "claude" } } as never);
    await settle();
    expect(creates(calls)).toHaveLength(0);
    dispose();
  });

  it("refuses an oversized prompt before any create runs", async () => {
    const { host, view, calls, dispose } = await builtHost();
    host.handleMessage(view, {
      ...REQ,
      openAfter: "agent",
      launch: { offerId: offer(), agent: "claude", prompt: "x".repeat(MAX_CONTINUATION_INSTRUCTION + 1) },
    });
    await settle();
    expect(creates(calls)).toHaveLength(0);
    dispose();
  });
});
