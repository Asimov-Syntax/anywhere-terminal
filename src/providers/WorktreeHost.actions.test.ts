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
import type {
  ExtensionToWebViewMessage,
  ProvisionModel,
  WorktreeMutationResultMessage,
  WorktreeRemoveAssessmentMessage,
} from "../types/messages";
import { MAX_CONTINUATION_INSTRUCTION } from "../vault/continuationLimits";
import type { CreateSessionOptions } from "../vault/VaultLauncher";
import type { DebrisIssueResult } from "../worktree/debrisAuthorization";
import { createGitCapabilities, type GitCapabilities } from "../worktree/gitCapabilities";
import type { GitCommandResult, GitCommandRunner } from "../worktree/gitCommandRunner";
import type { OrphanProofs } from "../worktree/orphanProofs";
import type { PresenceProjector } from "../worktree/presenceProjector";
import type { WorktreeAgentRow, WorktreePresence } from "../worktree/presenceTypes";
import type { ReattachVerdict } from "../worktree/reattachProbe";
import type { RebuildGateClock } from "../worktree/rebuildGate";
import type { PullRequestsRead } from "../worktree/repoPullRequests";
import type { RepoRefsInput, RepoRefsRead } from "../worktree/repoRefs";
import type { GitApiAccessor } from "../worktree/repoRoots";
import type { WorktreeTree } from "../worktree/types";
import type { WorktreeTreeDeps } from "../worktree/WorktreeDiscovery";
import type { PaneFact, SessionRecord } from "../worktree/worktreeBlockers";
import {
  createWorktreeHost,
  type WorktreeActions,
  type WorktreeHost,
  type WorktreeHostOptions,
  type WorktreeSurface,
} from "./WorktreeHost";

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
  capabilities?: GitCapabilities,
): WorktreeTreeDeps {
  const isGone = typeof gone === "function" ? gone : () => gone;
  const r = shared ?? runner(gone, extra);
  return {
    runner: r,
    capabilities: capabilities ?? createGitCapabilities(r),
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

type AssessReport = WorktreeRemoveAssessmentMessage["result"] | null;

function recordingActions(assessReport?: AssessReport | (() => Promise<AssessReport>)) {
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
    // Recorded like any other capability, so a test can assert the removal was
    // NOT what an assess reached.
    assessRemovalReport: async (target) => {
      calls.push(["assessRemovalReport", target]);
      if (typeof assessReport === "function") {
        return await assessReport();
      }
      return assessReport === undefined ? null : assessReport;
    },
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
    probeGitEntry?: (p: string) => "present" | "absent" | "unknown";
    issueDebrisAuthorization?: (p: string) => Promise<DebrisIssueResult>;
    /** Add a second, unrelated repository to the workspace. */
    sibling?: boolean;
    /** No watcher can be established, as on a host without file watching. */
    watchFails?: boolean;
    startAgent?: WorktreeActions["startAgent"];
    resumeSessionAt?: WorktreeActions["resumeSessionAt"];
    launchTargets?: WorktreeActions["launchTargets"];
    readProvisioning?: (mainWorktree: string) => Promise<ProvisionModel>;
    previewProvisioningPorts?: WorktreeHostOptions["previewProvisioningPorts"];
    /** What the ref reader should answer. */
    readRefs?: (input: RepoRefsInput) => Promise<RepoRefsRead>;
    /** Collects every input the ref reader was handed. */
    refsInputs?: RepoRefsInput[];
    /** What the pull-request reader should answer. */
    readPullRequests?: (input: { cwd: string }) => Promise<PullRequestsRead>;
    /** Registry sessions the removal assessment should be given. */
    sessions?: readonly SessionRecord[];
    /** What the proof reader should answer. */
    proofs?: OrphanProofs;
    /** Collects every subject the assessment asked the proof reader about. */
    proofSubjects?: { path: string; locked: boolean; branch?: string }[];
    /** One entry per call of the registry read. */
    sessionReads?: number[];
    /** Panes the removal assessment should be given. */
    removalPanes?: readonly PaneFact[];
    /** Identities a pane of this window claimed, keyed entry id → pane id. */
    claimedByPane?: ReadonlyMap<string, string>;
    /** Let `git status --porcelain` answer, so an assessment can reach a verdict. */
    statusReadable?: boolean;
    /**
     * What the read-only removal report should answer. Omitted means `null`; a
     * function lets a test gate or reject the read the way production can.
     */
    assessReport?: AssessReport | (() => Promise<AssessReport>);
    /** § 2.3's corroboration, and every subject it was asked about. */
    probeReattach?: (input: { repoPath: string; branch: string; repairPath: string }) => Promise<ReattachVerdict>;
    probeSubjects?: { repoPath: string; branch: string; repairPath: string }[];
    /** D7's base resolution: the commit a ref names, or undefined for none. */
    resolveBase?: (input: { repoPath: string; ref: string }) => Promise<string | undefined>;
    /**
     * What `realpath` answers, for the containment check that gates the
     * candidate path. Absent entries resolve to themselves, so the default
     * filesystem has no links in it at all.
     */
    symlinks?: Record<string, string>;
  } = {},
) {
  // Mutable, so a test can make a repository LEAVE the workspace — the one
  // event after which nothing ever asks about it again (round-4 B7).
  const folders = { now: over.sibling === true ? ["/repo", OTHER_ROOT] : ["/repo"] };
  const presence: WorktreePresence = { rowsByWorktreeId: { [MAIN_PATH]: rows }, scannedAt: 1, degradedSources: [] };
  const projector: PresenceProjector = {
    project: async () => presence,
    rank: () => undefined,
    rankRevision: () => 0,
    claimedSessionIds: () => new Map<string, string>(),
    forgetDrawOrder: () => {},
  };
  const { actions, calls, reconciles } = recordingActions(over.assessReport);
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
      // A clean worktree, for the cases whose subject is the assessment's
      // VERDICT rather than one unreadable source. Off by default so every
      // pre-existing case keeps the status it was written against.
      if (over.statusReadable === true && args[0] === "status") {
        return res({ code: 0, stdout: Buffer.from("") });
      }
      return base.run(args, cwd);
    },
  };
  // A supported version is believed permanently, so losing git mid-session
  // cannot be staged through the runner — it is staged here instead.
  const gitUsable = { now: true };
  /** Run inside `assessRemoval`, between its reads — see `onAssessment`. */
  const duringAssessment = { now: async (): Promise<void> => {} };
  const probed = createGitCapabilities(shared);
  const capabilities: GitCapabilities = {
    runWithFallback: probed.runWithFallback,
    probeVersion: async () =>
      gitUsable.now ? await probed.probeVersion() : { kind: "absent", reason: "git is no longer on PATH" },
  };
  const host = createWorktreeHost({
    deps: deps(isGone, over.extra ?? [], shared, over.sibling === true, capabilities),
    workspaceFolders: () => [...folders.now],
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
    removalFacts: {
      panes: async () => over.removalPanes ?? [],
      sessions: async () => {
        over.sessionReads?.push(1);
        await duringAssessment.now();
        const records = over.sessions ?? [];
        return { ok: true, value: { live: records, canonical: records, partial: false } };
      },
      proofs: async (subject, sessions) => {
        // Awaits the read it was handed. A fake that ignored it would hide the
        // very thing D3 and D7 are about: one registry read, no extra await.
        await sessions;
        over.proofSubjects?.push(subject);
        return over.proofs ?? { lockAged: "unproven", ownerGone: "unproven", branchMerged: "unproven" };
      },
      ignored: async () => ({ kind: "measured", entries: 0, bytes: 0 }),
      claimedByPane: async () => over.claimedByPane ?? new Map<string, string>(),
    },
    ...(over.exists === undefined ? {} : { exists: over.exists }),
    ...(over.probeGitEntry === undefined ? {} : { probeGitEntry: over.probeGitEntry }),
    ...(over.issueDebrisAuthorization === undefined ? {} : { issueDebrisAuthorization: over.issueDebrisAuthorization }),
    ...(over.createRoot === undefined ? {} : { createRoot: () => ({ value: over.createRoot, explicitlySet: true }) }),
    ...(over.readProvisioning === undefined ? {} : { readProvisioning: over.readProvisioning }),
    ...(over.previewProvisioningPorts === undefined ? {} : { previewProvisioningPorts: over.previewProvisioningPorts }),
    ...(over.readRefs === undefined && over.refsInputs === undefined
      ? {}
      : {
          readRefs: async (input: RepoRefsInput) => {
            over.refsInputs?.push(input);
            return (await over.readRefs?.(input)) ?? { ok: true, refs: [], truncated: false };
          },
        }),
    ...(over.readPullRequests === undefined ? {} : { readPullRequests: over.readPullRequests }),
    ...(over.resolveBase === undefined ? {} : { resolveBase: over.resolveBase }),
    // The host resolves the candidate against the filesystem before it lets the
    // candidate reach `exists`. These tests name paths that are not on disk, so
    // the resolver is the fake one and `symlinks` is what makes it lie.
    resolvedPathDeps: {
      realpath: async (p: string) => over.symlinks?.[p] ?? p,
      lstat: async () => ({}),
    },
    ...(over.probeReattach === undefined && over.probeSubjects === undefined
      ? {}
      : {
          probeReattach: async (input: { repoPath: string; branch: string; repairPath: string }) => {
            over.probeSubjects?.push(input);
            return (
              (await over.probeReattach?.(input)) ?? {
                kind: "declined" as const,
                because: "notALinkedWorktree" as const,
              }
            );
          },
        }),
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
    /**
     * The surface's own attachment. Detaching a surface and disposing the HOST
     * are different lifecycles, and only the host's had a handle here — so the
     * detach path's cleanup was untestable, which is how `liveOpening` came to
     * leak through it (.reviews/round-1.md B5).
     */
    attachment,
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
    /** The workspace becomes exactly these folders, and the tree is rebuilt. */
    setFolders: async (next: string[]) => {
      folders.now = next;
      host.handleMessage(view, { type: "requestWorktreeTree", force: true });
      await settle();
      noteTree(view);
    },
    /** The sibling repository leaves the workspace, and the tree is rebuilt. */
    dropSibling: async () => {
      folders.now = ["/repo"];
      host.handleMessage(view, { type: "requestWorktreeTree", force: true });
      await settle();
      noteTree(view);
    },
    /** Do something to the tree while an assessment is mid-flight. */
    onAssessment: (fn: () => Promise<void>) => {
      duringAssessment.now = fn;
    },
    /**
     * Take git away entirely, so no listing anywhere can be read — the tree the
     * cache still shows is retained, not observed (design.md D12).
     */
    loseGit: async () => {
      gitUsable.now = false;
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
      projector: {
        project: async () => presence,
        rank: () => undefined,
        rankRevision: () => 0,
        claimedSessionIds: () => new Map<string, string>(),
        forgetDrawOrder: () => {},
      },
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
  it("[I10] removes the worktree git named, unforced", async () => {
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
  const REQ = {
    type: "worktreeCreate",
    repoId: "/repo",
    // The form that composed this submit. `liveOpening` is keyed by SURFACE, not
    // by repository, so opening on REPO and submitting for "/repo" is the same
    // opening — which is what these cases have always meant.
    opening: 1,
    path: "/trees/feat",
    disposition: { kind: "free" },
    afterCreate: { kind: "none" },
  } as const;

  /**
   * A host with a create form actually open — the only state a submit is legal
   * in now. Every case in this block needs it, refusals included: the host
   * refuses a create naming an opening the surface does not hold, so without
   * this setup each `calls` assertion below would pass for the WRONG reason,
   * rejected by the opening guard rather than by the shape check it exists to
   * exercise (round-5 W1).
   */
  async function hostWithForm(): Promise<Awaited<ReturnType<typeof builtHost>>> {
    const built = await builtHost();
    built.host.handleMessage(built.view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    await settle();
    return built;
  }

  it("hands the request to the capability", async () => {
    const { host, view, calls, dispose } = await hostWithForm();
    host.handleMessage(view, { ...REQ, mode: { kind: "fresh", branch: "feat", baseRef: "origin/main" } });
    await settle();

    expect(calls).toEqual([
      [
        "createWorktree",
        {
          repoId: "/repo",
          path: "/trees/feat",
          mode: { kind: "fresh", branch: "feat", baseRef: "origin/main" },
          disposition: { kind: "free" },
          afterCreate: { kind: "none" },
          origin: view,
        },
      ],
    ]);
    dispose();
  });

  it("[5_1] refuses a create submitted after its own form closed", async () => {
    // The paired half of "hands the request to the capability" above, and the
    // last door this change left open (round-5 W1). The submit is a request
    // belonging to a form; a form the user cancelled is not still asking for a
    // worktree. Without this, a delayed or replayed create reached
    // `createWorktree` and built a directory nobody wanted any more.
    const { host, view, calls, dispose } = await hostWithForm();
    host.handleMessage(view, { type: "worktreeCreateClosed", opening: 1 });
    host.handleMessage(view, { ...REQ, mode: { kind: "fresh", branch: "feat", baseRef: "origin/main" } });
    await settle();

    expect(
      calls.filter(([name]) => name === "createWorktree"),
      "a retired form still created a worktree",
    ).toEqual([]);
    dispose();
  });

  it("[5_1] refuses a create naming an opening the surface never held", async () => {
    // `0` is the value the panel's counter holds before any form opens, so it
    // is the one an uninitialised or forged sender is most likely to send.
    // Rejected here by the live-opening equality, the same way the refs door
    // rejects it — `namedOpening` is defence in depth behind that, not the
    // thing doing the work.
    const { host, view, calls, dispose } = await hostWithForm();
    for (const opening of [0, 2, 99]) {
      host.handleMessage(view, {
        ...REQ,
        opening,
        mode: { kind: "fresh", branch: "feat", baseRef: "origin/main" },
      } as never);
    }
    await settle();

    expect(
      calls.filter(([name]) => name === "createWorktree"),
      "an unheld opening created a worktree",
    ).toEqual([]);
    dispose();
  });

  it("rejects the agent mode until WT-005.3 supplies the launch", async () => {
    // The form does not offer it; this is the defence behind that, so a hand-sent
    // message cannot reach a launch that does not exist.
    const { host, view, calls, dispose } = await hostWithForm();
    host.handleMessage(view, {
      ...REQ,
      mode: { kind: "fresh", branch: "feat" },
      afterCreate: { kind: "agent" } as never,
    });
    await settle();

    expect(calls).toEqual([]);
    dispose();
  });

  it("rejects a mode that is not one of the documented ones", async () => {
    const { host, view, calls, dispose } = await hostWithForm();
    host.handleMessage(view, {
      ...REQ,
      mode: { kind: "fresh", branch: "feat" },
      afterCreate: { kind: "somethingElse" } as never,
    });
    await settle();

    expect(calls).toEqual([]);
    dispose();
  });

  it("acts on nothing when the path is empty", async () => {
    const { host, view, calls, dispose } = await hostWithForm();
    host.handleMessage(view, { ...REQ, mode: { kind: "fresh", branch: "feat" }, path: "" });
    await settle();

    expect(calls).toEqual([]);
    dispose();
  });

  // Round-1 B1/B2/W1: `messages.contract.test.ts` proves a typed producer cannot
  // build these. `postMessage` erases that proof, so the same shapes are asserted
  // again HERE, where the value arrives as `unknown` and the type is gone.

  async function refuses(over: Record<string, unknown>): Promise<void> {
    const { host, view, calls, dispose } = await hostWithForm();
    host.handleMessage(view, { ...REQ, mode: { kind: "fresh", branch: "feat" }, ...over } as never);
    await settle();

    expect(calls).toEqual([]);
    dispose();
  }

  it("refuses a debris disposition whose authorization does not name this create's own path", async () => {
    // Until 1_7 the debris variant was inadmissible outright, because nothing
    // issued one. Now the panel does, so the check is the BINDING: an
    // authorization that names another directory is not the create the panel
    // composed, and it selects `mustMatchDebrisAuthorization` — which drops the
    // emptiness requirement — on a path nobody authorized (round-1 B2).
    await refuses({
      disposition: { kind: "debris", authorization: { path: "/trees/elsewhere", fingerprint: "forged" } },
    });
  });

  it("refuses a debris disposition whose authorization is malformed", async () => {
    await refuses({ disposition: { kind: "debris", authorization: { path: "/trees/feat", fingerprint: "" } } });
    await refuses({ disposition: { kind: "debris", authorization: { path: "", fingerprint: "fp" } } });
    await refuses({ disposition: { kind: "debris" } });
    await refuses({
      disposition: { kind: "debris", authorization: { path: "/trees/feat", fingerprint: "fp", extra: 1 } },
    });
  });

  it("[B2] admits the debris disposition the panel composes, and hands it on unchanged", async () => {
    // `isKnownDisposition` accepted only `free`, so every debris create was
    // dropped at this boundary and the whole recover path was unreachable in
    // production while the service's own tests passed.
    const { host, view, calls, dispose } = await hostWithForm();
    const disposition = { kind: "debris", authorization: { path: "/trees/feat", fingerprint: "fp-1" } };
    host.handleMessage(view, { ...REQ, mode: { kind: "fresh", branch: "feat" }, disposition } as never);
    await settle();

    expect(calls[0]?.[0]).toBe("createWorktree");
    expect(calls[0]?.[1]).toMatchObject({ path: "/trees/feat", disposition });
    dispose();
  });

  it("refuses a disposition that is not one of the documented ones", async () => {
    await refuses({ disposition: { kind: "somethingElse" } });
    await refuses({ disposition: undefined });
    await refuses({ disposition: { kind: "free", authorization: { path: "/x", fingerprint: "f" } } });
  });

  it("refuses an agent after-create whose setup gate is missing or not a boolean", async () => {
    // `waitForSetup` sequences the agent against the setup runner. Absent, it
    // reaches the capability as `undefined` and the sequencing silently changes.
    await refuses({ afterCreate: { kind: "agent", agent: "claude" } });
    await refuses({ afterCreate: { kind: "agent", agent: "claude", waitForSetup: "yes" } });
  });

  it("refuses launch details riding an after-create that is not launching", async () => {
    // Restored: task 1_2 deleted this on the grounds that the union makes the
    // arrangement unrepresentable. That is true of our own code and false of a
    // message, which is the only place this test ever applied.
    await refuses({ afterCreate: { kind: "none", agent: "claude" } });
    await refuses({ afterCreate: { kind: "terminal", waitForSetup: true } });
  });

  it("refuses a mode carrying a field its own shape does not declare", async () => {
    await refuses({ mode: { kind: "reuse", branch: "feat", baseRef: "main" } });
    await refuses({ mode: { kind: "fresh-detached", baseRef: "HEAD", branch: "feat" } });
    await refuses({ mode: { kind: "fresh", branch: "feat", detach: true } });
  });

  it("refuses a forbidden field even when it holds nothing", async () => {
    // Round-2 W1: an undefined value is not absence. Every optional field a
    // variant legitimately has is already in its own allow-list, so exempting
    // undefined only ever admitted the forbidden keys.
    await refuses({ mode: { kind: "reuse", branch: "feat", baseRef: undefined } });
    await refuses({ afterCreate: { kind: "none", agent: undefined } });
    await refuses({ disposition: { kind: "free", authorization: undefined } });
  });
});

// ── What comes back ──────────────────────────────────────────────────────

describe("the destination a create opens on comes from the host", () => {
  it("answers a defaults request with a root and a free path under it", async () => {
    // The panel may not guess: a webview-computed path states a destination the
    // create could refuse, which the spec forbids outright.
    const { host, view, dispose } = await builtHost();
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    await settle();

    const answer = view.posts.find((m) => m.type === "worktreeCreateDefaults");
    expect(answer).toMatchObject({ type: "worktreeCreateDefaults", repoId: REPO, opening: 1 });
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
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
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
    // The NAME that was taken, not the path to it. The destination line above
    // already carries the path, and stating it twice is what WT-009.3's
    // acceptance forbids (worktree-rpc.md § 2).
    expect(defaults.collidedWith).toBe("repo");
    dispose();
  });

  it("names no collision when the first candidate was free", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], false, { createRoot: "/trees" });
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
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
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: "/not/a/repo", opening: 1 });
    await settle();

    expect(view.posts.filter((m) => m.type === "worktreeCreateDefaults")).toEqual([]);
    dispose();
  });
});

// ── The branches a create can pick from ──────────────────────────────────

describe("the list of branches a create can pick from comes from the host", () => {
  it("answers a refs request with what the reader found", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      readRefs: async () => ({ ok: true, refs: [{ name: "main", heldBy: "repo" }, { name: "idle" }], truncated: true }),
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    await settle();

    expect(view.posts.find((m) => m.type === "worktreeRefs")).toEqual({
      type: "worktreeRefs",
      repoId: REPO,
      token: 1,
      refs: [{ name: "main", heldBy: "repo" }, { name: "idle" }],
      truncated: true,
    });
    dispose();
  });

  it("posts the refs without waiting for the pull-request read", async () => {
    // worktree-create.md § 4.1: "a slow or unauthenticated forge never blocks
    // branch search underneath it". The forge read is held open for the whole
    // assertion, so awaiting it anywhere on the refs path fails this.
    let releaseForge: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releaseForge = resolve;
    });
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      readRefs: async () => ({ ok: true, refs: [{ name: "main" }], truncated: false }),
      readPullRequests: async () => {
        await held;
        return { ok: true, pullRequests: [], truncated: false };
      },
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    await settle();

    expect(
      view.posts.find((m) => m.type === "worktreeRefs"),
      "the refs waited for the forge",
    ).toBeDefined();
    expect(view.posts.find((m) => m.type === "worktreePullRequests")).toBeUndefined();

    releaseForge?.();
    await settle();
    expect(view.posts.find((m) => m.type === "worktreePullRequests")).toBeDefined();
    dispose();
  });

  it("answers a pull-request read with what the forge found", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      readPullRequests: async () => ({
        ok: true,
        pullRequests: [
          {
            number: 7,
            title: "Add search",
            headRefName: "feat",
            baseRefName: "main",
            fromFork: false,
            headOwner: "acme",
          },
        ],
        truncated: true,
      }),
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    await settle();

    expect(view.posts.find((m) => m.type === "worktreePullRequests")).toEqual({
      type: "worktreePullRequests",
      repoId: REPO,
      token: 1,
      pullRequests: [
        {
          number: 7,
          title: "Add search",
          headRefName: "feat",
          baseRefName: "main",
          fromFork: false,
          headOwner: "acme",
        },
      ],
      truncated: true,
      available: true,
    });
    dispose();
  });

  it("posts the unavailable state rather than staying silent about it", async () => {
    // Silence would leave "not asked yet" and "asked, and there are none to be
    // had" indistinguishable, and § 5 requires a row for the second one.
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      readPullRequests: async () => ({ ok: false }),
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    await settle();

    expect(view.posts.find((m) => m.type === "worktreePullRequests")).toEqual({
      type: "worktreePullRequests",
      repoId: REPO,
      token: 1,
      available: false,
    });
    dispose();
  });

  it("answers unavailable where the reader threw, rather than leaving the form waiting", async () => {
    // A rejection is one more way the forge did not answer, so it gets the same
    // one row every other failure gets. Swallowed, it would leave the form in
    // "not asked yet" forever — the ONE state D1 exists to collapse every
    // failure out of (.reviews/round-1.md W1).
    //
    // The refs answer and the destination reply must still survive it: this read
    // is discovery, and discovery never takes the create with it.
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      readRefs: async () => ({ ok: true, refs: [{ name: "main" }], truncated: false }),
      readPullRequests: async () => {
        throw new Error("gh exploded");
      },
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    // Asked, so the claim above about the destination is one this test can
    // actually make. It could not before (.reviews/round-2.md S1).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    await settle();

    expect(view.posts.find((m) => m.type === "worktreeRefs")).toBeDefined();
    expect(view.posts.find((m) => m.type === "worktreeCreateDefaults")).toMatchObject({ repoId: REPO });
    expect(view.posts.find((m) => m.type === "worktreePullRequests")).toMatchObject({
      repoId: REPO,
      token: 1,
      available: false,
    });
    dispose();
  });

  it("hands the reader the listing it already holds, so held-by is derived and not re-asked", async () => {
    // A second `git worktree list` for the same repository invites two answers
    // about one instant. The listing that says which worktrees exist already
    // says which branches they hold (design.md D2).
    const refsInputs: RepoRefsInput[] = [];
    const { host, view, dispose } = await builtHost([windowRow()], false, { refsInputs });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    await settle();

    expect(refsInputs).toHaveLength(1);
    expect(refsInputs[0]?.cwd).toBe(MAIN_PATH);
    expect(refsInputs[0]?.worktrees.map((w) => w.branch)).toContain("feat");
    dispose();
  });

  it("posts nothing when the enumeration failed — absent is not an empty repository", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], false, { readRefs: async () => ({ ok: false }) });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    await settle();

    expect(view.posts.filter((m) => m.type === "worktreeRefs")).toEqual([]);
    dispose();
  });

  it("survives a reader that throws, rather than taking the surface down", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      readRefs: async () => {
        throw new Error("git blew up");
      },
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    await settle();

    expect(view.posts.filter((m) => m.type === "worktreeRefs")).toEqual([]);
    dispose();
  });

  it("answers nothing for a repository it never published", async () => {
    const refsInputs: RepoRefsInput[] = [];
    const { host, view, dispose } = await builtHost([windowRow()], false, { refsInputs });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: "/not/a/repo", opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: "/not/a/repo", token: 1 });
    await settle();

    expect(refsInputs).toEqual([]);
    expect(view.posts.filter((m) => m.type === "worktreeRefs")).toEqual([]);
    dispose();
  });

  it("does not post to a surface that detached while git was answering", async () => {
    // The form this list describes is gone. Posting into a detached surface is
    // at best wasted, and at worst revives a dialog the detach forgot.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      readRefs: async () => {
        await gate;
        return { ok: true, refs: [{ name: "main" }], truncated: false };
      },
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    dispose();
    release?.();
    await settle();

    expect(view.posts.filter((m) => m.type === "worktreeRefs")).toEqual([]);
  });

  it("answers nothing when no reader is wired", async () => {
    const { host, view, dispose } = await builtHost();
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    await settle();

    expect(view.posts.filter((m) => m.type === "worktreeRefs")).toEqual([]);
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
    // The form opens first. A branch ask is the user TYPING in a form already
    // open, so it rides an opening the host was told about — one arriving
    // against no opening at all is now answered with nothing (2_1).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, {
      type: "requestWorktreeCreateDefaults",
      repoId: REPO,
      opening: 1,
      branch: "feat/Login UI",
    });
    await settle();

    // The reply for the BRANCH. The opening ask above is answered too, and its
    // answer is the bare default this test exists to distinguish from.
    const answer = view.posts.find((m) => m.type === "worktreeCreateDefaults" && m.branch !== undefined) as {
      path: string;
    };
    expect(answer.path).toBe("/trees/repo-feat-login-ui");
    dispose();
  });

  it("falls back to the bare default when no branch has been typed yet", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], false, { createRoot: "/trees" });
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
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
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    await settle();

    const answer = view.posts.find((m) => m.type === "worktreeCreateDefaults") as {
      path: string;
      collidedWith?: string;
    };
    expect(answer.path).not.toBe("/trees/repo");
    expect(answer.collidedWith).toBe("repo");
    dispose();
  });

  it("never puts a path separator in the taken name", async () => {
    // The field is rendered verbatim beside a destination that already states
    // the path. Anything with a separator in it is a second path by definition,
    // whichever platform drew it.
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      exists: (candidate: string) => candidate === "/trees/repo",
    });
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    await settle();

    const defaults = view.posts.find((m) => m.type === "worktreeCreateDefaults") as {
      collidedWith?: string;
    };
    expect(defaults.collidedWith).toBeDefined();
    expect(defaults.collidedWith).not.toMatch(/[/\\]/);
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
  const REQ = {
    type: "worktreeCreate",
    repoId: REPO,
    opening: 1,
    path: "/trees/feat",
    mode: { kind: "fresh", branch: "feat" },
    disposition: { kind: "free" },
  } as const;

  /**
   * A host with a create form actually open — the only state a submit is legal
   * in now. Every case in this block needs it, refusals included: the host
   * refuses a create naming an opening the surface does not hold, so without
   * this setup each `calls` assertion below would pass for the WRONG reason,
   * rejected by the opening guard rather than by the shape check it exists to
   * exercise (round-5 W1).
   */
  async function hostWithForm(): Promise<Awaited<ReturnType<typeof builtHost>>> {
    const built = await builtHost();
    built.host.handleMessage(built.view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    await settle();
    return built;
  }
  const creates = (calls: Array<[string, ...unknown[]]>) => calls.filter(([name]) => name === "createWorktree");

  it("accepts the agent mode now that a launch exists behind it", async () => {
    const { host, view, calls, dispose } = await hostWithForm();
    host.handleMessage(view, {
      ...REQ,
      afterCreate: { kind: "agent", waitForSetup: false, offerId: offer(), agent: "claude" },
    });
    await settle();
    expect(creates(calls)).toHaveLength(1);
    expect(creates(calls)[0]?.[1]).toMatchObject({
      afterCreate: { kind: "agent", offerId: offer(), agent: "claude" },
    });
    dispose();
  });

  it("creates NOTHING for a launch the host would not admit", async () => {
    // Order is the whole point: refusing after git ran would leave the user a
    // worktree they only asked for as a place to put an agent.
    const { host, view, calls, dispose } = await hostWithForm();
    for (const launch of [
      { offerId: offer(), agent: "codex" },
      { offerId: offer(), agent: "claude", permissionChoiceId: "bypassPermissions" },
      { offerId: offer(), agent: "opencode", prompt: "read the spec" },
    ]) {
      host.handleMessage(view, { ...REQ, afterCreate: { kind: "agent", waitForSetup: false, ...launch } } as never);
    }
    await settle();
    expect(creates(calls)).toHaveLength(0);
    dispose();
  });

  it("refuses an agent mode that describes no launch", async () => {
    // Unrepresentable in our own code now — the agent fields are members of the
    // variant — but the message crosses a boundary where the type is erased, so
    // the host still has to answer for one that arrives anyway.
    const { host, view, calls, dispose } = await hostWithForm();
    host.handleMessage(view, { ...REQ, afterCreate: { kind: "agent", waitForSetup: false } } as never);
    await settle();
    expect(creates(calls)).toHaveLength(0);
    dispose();
  });

  it("refuses an oversized prompt before any create runs", async () => {
    const { host, view, calls, dispose } = await hostWithForm();
    host.handleMessage(view, {
      ...REQ,
      afterCreate: {
        kind: "agent",
        waitForSetup: false,
        offerId: offer(),
        agent: "claude",
        prompt: "x".repeat(MAX_CONTINUATION_INSTRUCTION + 1),
      },
    });
    await settle();
    expect(creates(calls)).toHaveLength(0);
    dispose();
  });
});

// design.md D12 — one claim, "this repository was observed", authorizes both a
// launch and a removal. Round 8 caught the two coming apart: launch admission
// also checked global git, the removal readers did not.
describe("what an unobserved repository authorizes", () => {
  it("authorizes no removal while git itself is unusable", async () => {
    const { host, dispose, loseGit } = await builtHost();
    await loseGit();

    const result = await host.mutationBindings().assessRemoval({ repoId: REPO, worktreeId: FEAT_PATH });

    // Not a refusal — a refusal is an answer, and nobody could read the listing
    // this one would be derived from.
    expect(result).toMatchObject({ kind: "unavailable" });
    expect((result as { unreadable: readonly string[] }).unreadable).toContain("listing");
    expect(host.mutationBindings().observation(REPO)).toBeUndefined();
    dispose();
  });

  it("authorizes no launch while git itself is unusable", async () => {
    const { host, view, calls, dispose, loseGit } = await builtHost();
    const before = gen();
    await loseGit();

    host.handleMessage(view, {
      type: "worktreeLaunchAgent",
      worktreeId: FEAT_PATH,
      agentId: "claude",
      offerId: offer(),
      ...(before === undefined ? {} : { generation: before }),
    } as never);
    await settle();

    expect(calls.filter((c) => c[0] === "startAgent")).toHaveLength(0);
    dispose();
  });

  it("authorizes a removal on a repository nobody can watch, whose listing WAS read", async () => {
    // The negative that keeps D11 honest: an unwatched repository is observed,
    // and refusing there would disable removal on every host without file
    // watching for a reason no user could act on.
    const { host, dispose } = await builtHost([windowRow()], false, { watchFails: true });

    const result = await host.mutationBindings().assessRemoval({ repoId: REPO, worktreeId: FEAT_PATH });

    // The harness's `git status` is unreadable for reasons of its own, so the
    // claim under test is the listing one specifically, not the verdict.
    expect((result as { unreadable?: readonly string[] }).unreadable ?? []).not.toContain("listing");
    expect(host.mutationBindings().observation(REPO)).not.toBeUndefined();
    dispose();
  });
});

// Round-9 B8. The defect shape this whole change has been chasing, at the one
// boundary the fix never reached: state read on one side of an await, acted on
// from the other. A removal is where it costs the most.
describe("an assessment that spans two observations", () => {
  it("reports the listing unreadable when a rebuild lands mid-assessment", async () => {
    const h = await builtHost();
    // The reads take real time; a watcher-driven rebuild during them replaces
    // the listing `siblings` and the target were taken from.
    h.onAssessment(async () => {
      await h.relist();
    });

    const result = await h.host.mutationBindings().assessRemoval({ repoId: REPO, worktreeId: FEAT_PATH });

    expect((result as { unreadable?: readonly string[] }).unreadable ?? []).toContain("listing");
    h.dispose();
  });

  it("reports it unreadable when git goes away mid-assessment", async () => {
    const h = await builtHost();
    h.onAssessment(async () => {
      await h.loseGit();
    });

    const result = await h.host.mutationBindings().assessRemoval({ repoId: REPO, worktreeId: FEAT_PATH });

    expect((result as { unreadable?: readonly string[] }).unreadable ?? []).toContain("listing");
    h.dispose();
  });

  it("says nothing about the listing when the tree holds still", async () => {
    // The negative that gives the two above their meaning: an assessment that
    // spans one observation is answered from it.
    const h = await builtHost();

    const result = await h.host.mutationBindings().assessRemoval({ repoId: REPO, worktreeId: FEAT_PATH });

    expect((result as { unreadable?: readonly string[] }).unreadable ?? []).not.toContain("listing");
    h.dispose();
  });
});

describe("the provisioning offer the create form is given", () => {
  function model(path: string): ProvisionModel {
    return {
      entries: [{ id: "i1", path, mode: "copy", source: "asimov/worktree.yaml" }],
      setup: [],
      ports: [],
      providers: [{ id: "asimov", files: ["asimov/worktree.yaml"], active: true }],
      excluded: [],
      problems: [],
    };
  }

  function offersIn(view: { posts: unknown[] }) {
    return (view.posts as ExtensionToWebViewMessage[]).filter((p) => p.type === "worktreeProvisionOffer");
  }

  /**
   * Which model an offer carries, named by its rows rather than by its ids.
   *
   * The store remints every selectable id as it issues the offer (round-2 W4),
   * so an offer never equals the adapter model it was built from. What these
   * tests actually assert is *which read* was published, and the path says that.
   */
  function pathsIn(offer: unknown): string[] {
    return (offer as { model: ProvisionModel }).model.entries.map((e) => e.path);
  }

  it("publishes one offer when the form asks for its defaults", async () => {
    const { host, view, dispose } = await builtHost(undefined, false, {
      readProvisioning: async () => model(".env"),
    });
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    await settle();

    const offers = offersIn(view);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ repoId: REPO });
    expect(pathsIn(offers[0])).toEqual([".env"]);
    expect(typeof (offers[0] as { offerId: string }).offerId).toBe("string");
    dispose();
  });

  it("does not mint a second offer as the user types a branch", async () => {
    // The defaults request is re-sent on every keystroke. A fresh offer each
    // time would churn ids under a dialog nobody has stopped looking at, and
    // issuing evicts the previous one — so a submission mid-type would name
    // nothing. A branch-less ask is the form OPENING; one carrying a branch is
    // typing in a form already open.
    let reads = 0;
    const { host, view, dispose } = await builtHost(undefined, false, {
      readProvisioning: async () => {
        reads += 1;
        return model(".env");
      },
    });
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    await settle();
    for (const branch of ["f", "fe", "fea", "feat"]) {
      host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1, branch });
      await settle();
    }

    expect(reads).toBe(1);
    expect(offersIn(view)).toHaveLength(1);
    dispose();
  });

  it("[B5] publishes one offer even when a read is still in flight", async () => {
    // Round 1 asserted that a second form-opening ask JOINS the read in flight.
    // Round 2 showed that is the defect, not the property: joining is how a
    // reopened form inherits its predecessor's model. What must hold is that one
    // live form ends up with one offer — see the reopen test below for the rest.
    let reads = 0;
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { host, view, dispose } = await builtHost(undefined, false, {
      readProvisioning: async () => {
        reads += 1;
        await held;
        return model(".env");
      },
    });

    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    await settle();
    expect(reads).toBe(1);
    // Typing does not re-read; only an opening does.
    for (const branch of ["f", "fe"]) {
      host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1, branch });
      await settle();
    }
    expect(reads).toBe(1);

    release?.();
    await settle();

    expect(offersIn(view)).toHaveLength(1);
    dispose();
  });

  it("[2_1] a repeated ask for the LIVE opening starts no second read", async () => {
    // A repeat is not a reopening. Superseding on one let a duplicated message
    // retire the live read's right to publish and start another whose answer
    // the form has no reason to prefer — so the duplicate could suppress the
    // legitimate result, and reads grew per message rather than per form (D4).
    let reads = 0;
    const { host, view, dispose } = await builtHost(undefined, false, {
      readProvisioning: async () => {
        reads += 1;
        return model(".env.only");
      },
    });

    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 7 });
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 7 });
    await settle();

    expect(reads, "the duplicate started its own read").toBe(1);
    // And the form is still answered — joining the read must not cost the
    // repeat its destination reply.
    expect(view.posts.filter((m) => m.type === "worktreeCreateDefaults")).toHaveLength(2);
    expect(view.posts.find((m) => m.type === "worktreeProvisionOffer")).toMatchObject({ opening: 7 });
    dispose();
  });

  it("[2_1] answers nothing for an opening this surface never held", async () => {
    // A branch ask is the user typing in a form already open. One naming an
    // opening the host was never told about is not that, and adopting it would
    // let a malformed or replayed message spend a form's authority (D2).
    let reads = 0;
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      readProvisioning: async () => {
        reads += 1;
        return model(".env");
      },
    });

    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 99, branch: "feat/x" });
    await settle();

    expect(view.posts.filter((m) => m.type === "worktreeCreateDefaults")).toHaveLength(0);
    expect(reads).toBe(0);
    dispose();
  });

  it("[2_1] echoes the opening it is answering", async () => {
    // The whole point of the field: without the echo the panel cached whatever
    // arrived, because it had no way to ask which form an answer was for.
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      readProvisioning: async () => model(".env"),
    });

    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 42 });
    await settle();

    expect(view.posts.find((m) => m.type === "worktreeCreateDefaults")).toMatchObject({ opening: 42 });
    expect(view.posts.find((m) => m.type === "worktreeProvisionOffer")).toMatchObject({ opening: 42 });
    dispose();
  });

  it("[2_2] a read landing after the form closed publishes nothing", async () => {
    // A cancelled form is the case a "supersede on the next opening" rule never
    // reaches: nothing reopens, so the read kept its right to publish forever
    // and minted host authority for a conversation the user ended (D3).
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { host, view, dispose } = await builtHost(undefined, false, {
      readProvisioning: async () => {
        await held;
        return model(".env.abandoned");
      },
    });

    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 3 });
    await settle();
    host.handleMessage(view, { type: "worktreeCreateClosed", opening: 3 });
    release?.();
    await settle();

    expect(offersIn(view)).toHaveLength(0);
    dispose();
  });

  it("[2_2] a retired opening has no authority left to spend", async () => {
    // Retirement is what makes the offer unredeemable, and § 2.4 already owns
    // what a create citing a dead id does. What is observable here is the other
    // half: the opening itself stops being answerable, so nothing new is issued
    // against it either.
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      readProvisioning: async () => model(".env"),
    });

    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 3 });
    await settle();
    // The setup landed: the opening WAS answerable before the close.
    expect(view.posts.filter((m) => m.type === "worktreeCreateDefaults")).toHaveLength(1);

    host.handleMessage(view, { type: "worktreeCreateClosed", opening: 3 });
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 3, branch: "feat/x" });
    await settle();

    expect(view.posts.filter((m) => m.type === "worktreeCreateDefaults")).toHaveLength(1);
    dispose();
  });

  it("[2_2] a retirement naming a dead opening leaves the live one alone", async () => {
    // Retirement spends the same authority an answer does. An unconditional
    // delete would let a late or replayed close from a form the user already
    // replaced silence the form they are looking at now (D2).
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      readProvisioning: async () => model(".env"),
    });

    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 4 });
    await settle();
    // The predecessor's close arrives after the live form already opened.
    host.handleMessage(view, { type: "worktreeCreateClosed", opening: 3 });
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 4, branch: "feat/x" });
    await settle();

    expect(view.posts.filter((m) => m.type === "worktreeCreateDefaults")).toHaveLength(2);
    dispose();
  });

  it("[r1 B3] answers nothing for an opening that is not a number at all", async () => {
    // The forwarding boundary checks the discriminator and nothing else, so a
    // malformed payload reaches the handler intact. `undefined` was the worst
    // of them: it compared equal to a missing map entry, so absent, malformed
    // and RETIRED were one state and a malformed message kept authority across
    // a close (.reviews/round-1.md B3).
    let reads = 0;
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      readProvisioning: async () => {
        reads += 1;
        return model(".env");
      },
    });

    for (const bad of [undefined, "1", Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1, 0]) {
      host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: bad } as never);
    }
    await settle();

    expect(view.posts.filter((m) => m.type === "worktreeCreateDefaults")).toHaveLength(0);
    expect(reads, "a malformed opening started a provider read").toBe(0);
    dispose();
  });

  it("[r1 B1] a replay of a retired opening does not bring it back", async () => {
    // Retirement DELETES the live entry, so the closed form's own opening ask —
    // replayed, or merely delivered twice with the close in between — found no
    // entry and was adopted as if it were new. The retirement undone by the
    // message that preceded it (B1).
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      readProvisioning: async () => model(".env"),
    });

    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 5 });
    await settle();
    expect(view.posts.filter((m) => m.type === "worktreeCreateDefaults")).toHaveLength(1);

    host.handleMessage(view, { type: "worktreeCreateClosed", opening: 5 });
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 5 });
    await settle();

    expect(view.posts.filter((m) => m.type === "worktreeCreateDefaults")).toHaveLength(1);
    dispose();
  });

  it("[r1 B1] a delayed predecessor never moves the surface backward", async () => {
    // Opening 4 arriving after 5 is the same defect running the other way: it
    // would retire the form the user is looking at and take over its slot.
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      readProvisioning: async () => model(".env"),
    });

    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 5 });
    await settle();
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 4 });
    await settle();

    expect(view.posts.filter((m) => m.type === "worktreeCreateDefaults")).toHaveLength(1);
    // And 5 is still the one being served — the late 4 took nothing with it.
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 5, branch: "feat/x" });
    await settle();
    expect(view.posts.filter((m) => m.type === "worktreeCreateDefaults")).toHaveLength(2);
    dispose();
  });

  it("[r1 B2] a read for another repository cannot publish once its opening is gone", async () => {
    // `liveOpening` is per surface; the read slots are per surface AND
    // repository. An opening that asked about two repositories and was then
    // superseded through only one of them left the other's slot holding it, and
    // that read published an offer for a form that no longer existed.
    const releases: (() => void)[] = [];
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      sibling: true,
      readProvisioning: async () => {
        await new Promise<void>((resolve) => releases.push(resolve));
        return model(".env");
      },
    });

    // Opening 1 asks about this repository; opening 2 supersedes it asking only
    // about the sibling, so nothing rewrites the first repository's slot.
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    await settle();
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: `${OTHER_ROOT}/.git`, opening: 2 });
    await settle();
    for (const release of releases) {
      release();
    }
    await settle();

    // Only the live opening's own read published.
    expect(offersIn(view).map((o) => (o as unknown as { opening: number }).opening)).toEqual([2]);
    dispose();
  });

  it("[r1 B5] detaching a surface takes its opening with it", async () => {
    // `liveOpening` is keyed by the stable string `surfaceKey` mints, so a
    // surface closed with a form open left an entry for the host's lifetime —
    // growth per surface EVER attached, not per attached surface. Detach, not
    // host dispose: they are different lifecycles and only one was cleaned up.
    const { host, view, attachment, dispose } = await builtHost([windowRow()], false, {
      readProvisioning: async () => model(".env"),
    });
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 9 });
    await settle();
    expect(view.posts.filter((m) => m.type === "worktreeCreateDefaults")).toHaveLength(1);

    attachment.dispose();
    // The same surface object, reattached — so `surfaceKey` mints the same key
    // and any leftover entry is reachable again. Nothing it was told before is
    // still owed to it: the opening it held is gone, so a branch ask riding it
    // is answered with nothing.
    host.attach(view).setDisplayed(true);
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 9, branch: "feat/x" });
    await settle();

    expect(view.posts.filter((m) => m.type === "worktreeCreateDefaults")).toHaveLength(1);
    dispose();
  });

  it("[4_2] a repeat delivered after the read finished still starts no second read", async () => {
    // The join marker was cleared when the read SETTLED, so it bounded
    // concurrent duplicates only: a repeat arriving afterwards found nothing and
    // read again, rotating the offer under a dialog the user had not stopped
    // looking at (.reviews/round-1.md B4). One read per opening, not one
    // concurrent read per opening (D4).
    let reads = 0;
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      readProvisioning: async () => {
        reads += 1;
        return model(".env");
      },
    });

    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 6 });
    await settle();
    expect(reads, "the first read never ran, so a repeat proves nothing").toBe(1);

    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 6 });
    await settle();

    expect(reads).toBe(1);
    // And the repeat is still answered — joining the read must not cost it the
    // destination reply.
    expect(view.posts.filter((m) => m.type === "worktreeCreateDefaults")).toHaveLength(2);
    // One offer, not two: nothing rotated under the open form.
    expect(offersIn(view)).toHaveLength(1);
    dispose();
  });

  it("[4_2] a read that FAILED may be retried within its opening", async () => {
    // The marker records that a read succeeded, not that one was attempted. Held
    // through a failure it would cost the user the provisioning section for the
    // life of the form, with no way back but closing and reopening it (D4).
    let reads = 0;
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      readProvisioning: async () => {
        reads += 1;
        if (reads === 1) {
          throw new Error("provider unreadable");
        }
        return model(".env");
      },
    });

    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 6 });
    await settle();
    expect(reads).toBe(1);
    expect(offersIn(view), "the failed read published an offer").toHaveLength(0);

    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 6 });
    await settle();

    expect(reads).toBe(2);
    expect(offersIn(view)).toHaveLength(1);
    dispose();
  });

  it("[r2 B5] a reopened form never receives its predecessor's model", async () => {
    // Keying the read by surface+repo alone made a reopening JOIN the read
    // already in flight, so the second form was handed the first form's answer.
    // One read per form is not the same property as no two reads at once.
    const releases: (() => void)[] = [];
    const models = [".env.first", ".env.second"];
    let reads = 0;
    const { host, view, dispose } = await builtHost(undefined, false, {
      readProvisioning: async () => {
        const mine = models[reads] ?? ".env.other";
        reads += 1;
        await new Promise<void>((resolve) => releases.push(resolve));
        return model(mine);
      },
    });

    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    await settle();
    // The form closes and a new one opens while the first read is unanswered.
    // A reopening mints its OWN opening — that is what makes it a different
    // form rather than a repeat of this one, and 2_1 tells the two apart by
    // exactly this number.
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 2 });
    await settle();
    expect(reads).toBe(2);

    for (const release of releases) {
      release();
    }
    await settle();

    // The stale generation published nothing; only the live form was answered.
    const offers = offersIn(view);
    expect(offers).toHaveLength(1);
    expect(pathsIn(offers[0])).toEqual([".env.second"]);
    dispose();
  });

  it("[B6] publishes nothing when the surface detaches mid-read", async () => {
    // The read outlives the window. A post to a detached surface is at best
    // wasted, and at worst revives an offer the detach was meant to forget.
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { host, view, dispose } = await builtHost(undefined, false, {
      readProvisioning: async () => {
        await held;
        return model(".env");
      },
    });

    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    await settle();
    dispose();
    release?.();
    await settle();

    expect(offersIn(view)).toEqual([]);
  });

  it("still answers the destination when provisioning cannot be read", async () => {
    // The section is not the create. A provider layer that throws must not
    // delay or refuse the destination the form needs.
    const { host, view, dispose } = await builtHost(undefined, false, {
      readProvisioning: async () => {
        throw new Error("no");
      },
    });
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    await settle();

    expect(offersIn(view)).toEqual([]);
    expect((view.posts as ExtensionToWebViewMessage[]).some((p) => p.type === "worktreeCreateDefaults")).toBe(true);
    dispose();
  });

  it("offers nothing on a host with no provisioning reader", async () => {
    // Every surface but the real extension entry point, which behaves exactly
    // as it did before provisioning existed.
    const { host, view, dispose } = await builtHost();
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    await settle();

    expect(offersIn(view)).toEqual([]);
    dispose();
  });
});

describe("[D5] a switch is a new request with its own identity", () => {
  const OFFERED: ProvisionModel = {
    entries: [{ id: "i1", path: ".env", mode: "copy", source: "asimov/worktree.yaml" }],
    setup: [],
    ports: [],
    providers: [
      { id: "asimov", files: ["asimov/worktree.yaml"], active: true },
      { id: "orca", files: ["orca.yaml", ".worktreeinclude"], active: false },
    ],
    excluded: [],
    problems: [],
  };

  function forProvider(prefer: string | undefined): ProvisionModel {
    if (prefer !== "orca") {
      return OFFERED;
    }
    return {
      ...OFFERED,
      entries: [{ id: "i1", path: "node_modules", mode: "link", source: "orca.yaml" }],
      providers: [
        { id: "orca", files: ["orca.yaml", ".worktreeinclude"], active: true },
        { id: "asimov", files: ["asimov/worktree.yaml"], active: false },
      ],
    };
  }

  function offersIn(view: { posts: unknown[] }) {
    return (view.posts as ExtensionToWebViewMessage[]).filter((p) => p.type === "worktreeProvisionOffer");
  }

  function pathsIn(offer: unknown): string[] {
    return (offer as { model: ProvisionModel }).model.entries.map((e) => e.path);
  }

  /** A host whose form is already open with the asimov offer published. */
  async function opened(
    readProvisioning: (main: string, prefer?: string) => Promise<ProvisionModel>,
    previewProvisioningPorts?: WorktreeHostOptions["previewProvisioningPorts"],
  ) {
    const h = await builtHost(undefined, false, {
      readProvisioning: readProvisioning as never,
      ...(previewProvisioningPorts === undefined ? {} : { previewProvisioningPorts }),
    });
    h.host.handleMessage(h.view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    await settle();
    return h;
  }

  it("publishes a fresh offer carrying the other source's rows", async () => {
    const h = await opened(async (_main, prefer) => forProvider(prefer));

    h.host.handleMessage(h.view, {
      type: "worktreeProvisionSwitch",
      repoId: REPO,
      opening: 1,
      switch: 1,
      provider: "orca",
    });
    await settle();

    const offers = offersIn(h.view);
    expect(offers).toHaveLength(2);
    expect(pathsIn(offers[0])).toEqual([".env"]);
    expect(pathsIn(offers[1])).toEqual(["node_modules"]);
    // A NEW id, and the old one evicted with it: a submission naming the
    // superseded offer would name the model the user stopped looking at.
    expect((offers[1] as { offerId: string }).offerId).not.toBe((offers[0] as { offerId: string }).offerId);
    h.dispose();
  });

  it("previews once for the initial offer and once for a switched-provider offer", async () => {
    const previewed: string[][] = [];
    const h = await opened(
      async (_main, prefer) => ({
        ...forProvider(prefer),
        ports: [
          {
            id: "port",
            name: prefer === "orca" ? "ORCA_PORT" : "APP_PORT",
            source: prefer === "orca" ? "orca.yaml" : "asimov/worktree.yaml",
          },
        ],
      }),
      async (ports) => {
        previewed.push(ports.map((item) => item.name));
        return ports.map((item) => ({ ...item, port: item.name === "ORCA_PORT" ? 5184 : 5183 }));
      },
    );

    h.host.handleMessage(h.view, {
      type: "worktreeProvisionSwitch",
      repoId: REPO,
      opening: 1,
      switch: 1,
      provider: "orca",
    });
    await settle();

    const offers = offersIn(h.view);
    expect(previewed).toEqual([["APP_PORT"], ["ORCA_PORT"]]);
    expect(offers.map((offer) => offer.model.ports[0]?.port)).toEqual([5183, 5184]);
    h.dispose();
  });

  it("creates nothing and submits nothing", async () => {
    const h = await opened(async (_main, prefer) => forProvider(prefer));
    const before = (h.view.posts as ExtensionToWebViewMessage[]).filter(
      (p) => p.type === "worktreeMutationResult",
    ).length;

    h.host.handleMessage(h.view, {
      type: "worktreeProvisionSwitch",
      repoId: REPO,
      opening: 1,
      switch: 1,
      provider: "orca",
    });
    await settle();

    const after = (h.view.posts as ExtensionToWebViewMessage[]).filter(
      (p) => p.type === "worktreeMutationResult",
    ).length;
    expect(after).toBe(before);
    h.dispose();
  });

  it("leaves the LATER choice on screen when two reads resolve in reverse order", async () => {
    // The schedule D5 exists for: the user picks orca, its read is slow; the
    // user picks the task file, that read resolves first and draws; orca's read
    // then lands. Without the sequence the earlier choice overwrites the later.
    const gates = new Map<string, () => void>();
    const h = await opened(async (_main, prefer) => {
      if (prefer === undefined) {
        return OFFERED;
      }
      await new Promise<void>((resolve) => gates.set(prefer, resolve));
      return forProvider(prefer);
    });

    h.host.handleMessage(h.view, {
      type: "worktreeProvisionSwitch",
      repoId: REPO,
      opening: 1,
      switch: 1,
      provider: "orca",
    });
    await settle();
    h.host.handleMessage(h.view, {
      type: "worktreeProvisionSwitch",
      repoId: REPO,
      opening: 1,
      switch: 2,
      provider: "asimov",
    });
    await settle();
    // The LATER request answers first, then the earlier one lands.
    gates.get("asimov")?.();
    await settle();
    gates.get("orca")?.();
    await settle();

    const offers = offersIn(h.view);
    expect(offers).toHaveLength(2);
    expect(pathsIn(offers[1])).toEqual([".env"]);
    h.dispose();
  });

  it("does not publish a superseded offer whose preview resolves late", async () => {
    let releaseOrca: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releaseOrca = resolve;
    });
    const h = await opened(
      async (_main, prefer) => ({
        ...forProvider(prefer),
        ports: [
          {
            id: "port",
            name: prefer === "orca" ? "ORCA_PORT" : "APP_PORT",
            source: "provider",
          },
        ],
      }),
      async (ports) => {
        if (ports[0]?.name === "ORCA_PORT") {
          await held;
        }
        return ports.map((item) => ({ ...item, port: item.name === "ORCA_PORT" ? 5184 : 5183 }));
      },
    );

    h.host.handleMessage(h.view, {
      type: "worktreeProvisionSwitch",
      repoId: REPO,
      opening: 1,
      switch: 1,
      provider: "orca",
    });
    await settle();
    h.host.handleMessage(h.view, {
      type: "worktreeProvisionSwitch",
      repoId: REPO,
      opening: 1,
      switch: 2,
      provider: "asimov",
    });
    await settle();
    expect(offersIn(h.view)).toHaveLength(2);

    releaseOrca?.();
    await settle();
    expect(offersIn(h.view)).toHaveLength(2);
    expect(offersIn(h.view).at(-1)?.model.ports[0]).toMatchObject({ name: "APP_PORT", port: 5183 });
    h.dispose();
  });

  it("refuses a provider the host did not put in the model it offered", async () => {
    let asked = 0;
    const h = await opened(async (_main, prefer) => {
      asked += 1;
      return forProvider(prefer);
    });

    h.host.handleMessage(h.view, {
      type: "worktreeProvisionSwitch",
      repoId: REPO,
      opening: 1,
      switch: 1,
      provider: "vscodeTasks",
    });
    await settle();

    // Refused before any read: the webview names a source the host detected, it
    // never supplies one.
    expect(asked).toBe(1);
    expect(offersIn(h.view)).toHaveLength(1);
    h.dispose();
  });

  it("refuses a payload carrying anything but its four scalars", async () => {
    let asked = 0;
    const h = await opened(async (_main, prefer) => {
      asked += 1;
      return forProvider(prefer);
    });

    h.host.handleMessage(h.view, {
      type: "worktreeProvisionSwitch",
      repoId: REPO,
      opening: 1,
      switch: 1,
      provider: "orca",
      // Not a field of the message. An extra key admitted here is a webview
      // supplying material the host is supposed to be the authority on.
      model: { entries: [{ id: "x", path: "/etc/passwd", mode: "copy", source: "x" }] },
    } as never);
    await settle();

    expect(asked).toBe(1);
    expect(offersIn(h.view)).toHaveLength(1);
    h.dispose();
  });

  it("publishes nothing for a switch that arrives after the form closed", async () => {
    let released: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      released = resolve;
    });
    const h = await opened(async (_main, prefer) => {
      if (prefer === undefined) {
        return OFFERED;
      }
      await held;
      return forProvider(prefer);
    });

    h.host.handleMessage(h.view, {
      type: "worktreeProvisionSwitch",
      repoId: REPO,
      opening: 1,
      switch: 1,
      provider: "orca",
    });
    await settle();
    h.host.handleMessage(h.view, { type: "worktreeCreateClosed", opening: 1 });
    await settle();
    released?.();
    await settle();

    // The read was already running; retirement is what stops its answer from
    // reaching a form the user dismissed.
    expect(offersIn(h.view)).toHaveLength(1);
    h.dispose();
  });

  it("refuses a switch naming an opening this surface is not serving", async () => {
    let asked = 0;
    const h = await opened(async (_main, prefer) => {
      asked += 1;
      return forProvider(prefer);
    });

    h.host.handleMessage(h.view, {
      type: "worktreeProvisionSwitch",
      repoId: REPO,
      opening: 2,
      switch: 1,
      provider: "orca",
    });
    await settle();

    expect(asked).toBe(1);
    expect(offersIn(h.view)).toHaveLength(1);
    h.dispose();
  });

  it("[round-1 F001] refuses a replayed earlier switch after a later one failed", async () => {
    // The ceiling is monotonic until the opening retires. Releasing it when a
    // read rejects re-admits every sequence below the one already seen, and the
    // dialog's own sequence only ever increases — so nothing needed the
    // release, and a delayed or replayed message could publish a choice the
    // user had already moved on from (D5).
    let orcaReads = 0;
    const h = await opened(async (_main, prefer) => {
      if (prefer === undefined) {
        return OFFERED;
      }
      if (prefer === "asimov") {
        throw new Error("unreadable");
      }
      orcaReads += 1;
      if (orcaReads === 1) {
        // Still in flight when the later switch fails.
        await new Promise<void>(() => {});
      }
      return forProvider(prefer);
    });
    const before = offersIn(h.view).length;

    for (const [seq, provider] of [
      [1, "orca"],
      [2, "asimov"],
      [1, "orca"],
    ] as const) {
      h.host.handleMessage(h.view, {
        type: "worktreeProvisionSwitch",
        repoId: REPO,
        opening: 1,
        switch: seq,
        provider,
      });
      await settle();
    }

    expect(offersIn(h.view)).toHaveLength(before);
    h.dispose();
  });

  it("does not carry one dialog's ceiling into the next", async () => {
    // The sequence is per opening. Keyed by surface and repo alone, a dialog
    // that reached switch 5 would leave the next dialog's first switch refused.
    const h = await opened(async (_main, prefer) => forProvider(prefer));
    for (const n of [1, 2, 3]) {
      h.host.handleMessage(h.view, {
        type: "worktreeProvisionSwitch",
        repoId: REPO,
        opening: 1,
        switch: n,
        provider: n % 2 === 1 ? "orca" : "asimov",
      });
      await settle();
    }
    h.host.handleMessage(h.view, { type: "worktreeCreateClosed", opening: 1 });
    await settle();
    h.host.handleMessage(h.view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 2 });
    await settle();
    const before = offersIn(h.view).length;

    h.host.handleMessage(h.view, {
      type: "worktreeProvisionSwitch",
      repoId: REPO,
      opening: 2,
      switch: 1,
      provider: "orca",
    });
    await settle();

    expect(offersIn(h.view)).toHaveLength(before + 1);
    expect(pathsIn(offersIn(h.view).at(-1))).toEqual(["node_modules"]);
    h.dispose();
  });
});

// Cycle-2 B5 at the host boundary. `evaluateRemoval` owns the corroboration,
// but only if the host actually carries the claim into it — and a stub that
// always answered with an empty map would type-check, pass every module test,
// and quietly restore the round-1 B2 regression it exists to prevent.
describe("a registry session held by a pane of this window", () => {
  const SESSION: SessionRecord = {
    sessionId: "s-1",
    entryId: "claude:s-1",
    cwd: FEAT_PATH,
    activity: undefined,
    alive: true,
  };
  const PANE: PaneFact = { paneId: "p-1", cwd: FEAT_PATH, activity: "idle" };

  it("is counted once, as the pane, when the host carries the claim", async () => {
    const h = await builtHost([windowRow()], false, {
      statusReadable: true,
      sessions: [SESSION],
      removalPanes: [PANE],
      claimedByPane: new Map([["claude:s-1", "p-1"]]),
    });

    const result = await h.host.mutationBindings().assessRemoval({ repoId: REPO, worktreeId: FEAT_PATH });

    expect(result).toMatchObject({ kind: "confirmable" });
    h.dispose();
  });

  it("still refuses when nothing in this window claimed it", async () => {
    // The negative that gives the case above its meaning: without the claim the
    // same session refuses, so the test is measuring the claim and not the fake.
    const h = await builtHost([windowRow()], false, {
      statusReadable: true,
      sessions: [SESSION],
      removalPanes: [PANE],
    });

    const result = await h.host.mutationBindings().assessRemoval({ repoId: REPO, worktreeId: FEAT_PATH });

    expect(result).toMatchObject({ kind: "refused", liveExternalSessionIds: ["s-1"] });
    h.dispose();
  });
});

// D7: the proofs are read where the assessment already suspends, and a missing
// worktree is answered without touching a disk that is not there.
describe("the three proofs reach the assessment", () => {
  it("reports what the reader answered, unchanged", async () => {
    const h = await builtHost([windowRow()], false, {
      statusReadable: true,
      proofs: { lockAged: "passed", ownerGone: "passed", branchMerged: "failed" },
    });

    const result = await h.host.mutationBindings().assessRemoval({ repoId: REPO, worktreeId: FEAT_PATH });

    expect(result).toMatchObject({
      kind: "confirmable",
      evidence: { proofs: { lockAged: "passed", ownerGone: "passed", branchMerged: "failed" } },
    });
    h.dispose();
  });

  it("asks about the worktree's own path, once", async () => {
    const proofSubjects: { path: string; locked: boolean; branch?: string }[] = [];
    const h = await builtHost([windowRow()], false, { statusReadable: true, proofSubjects });

    await h.host.mutationBindings().assessRemoval({ repoId: REPO, worktreeId: FEAT_PATH });

    expect(proofSubjects).toHaveLength(1);
    expect(proofSubjects[0]?.path).toBe(FEAT_PATH);
    h.dispose();
  });

  it("scans the registry exactly once, proofs included", async () => {
    // The proofs are handed the read already in flight. A reader that took its
    // own would scan the same directory twice in one assessment, and the two
    // scans could disagree about the same instant (design.md D3).
    const sessionReads: number[] = [];
    const h = await builtHost([windowRow()], false, { statusReadable: true, sessionReads });

    await h.host.mutationBindings().assessRemoval({ repoId: REPO, worktreeId: FEAT_PATH });

    expect(sessionReads).toHaveLength(1);
    h.dispose();
  });

  it("claims no lock and no branch for a worktree whose directory is gone", async () => {
    // Nothing to stat and nothing to compare: asking either question of an
    // absent directory is a read that fails every time, and the honest answer
    // is that the question did not arise (design.md D7).
    const proofSubjects: { path: string; locked: boolean; branch?: string }[] = [];
    const h = await builtHost([windowRow()], true, { statusReadable: true, proofSubjects });

    await h.host.mutationBindings().assessRemoval({ repoId: REPO, worktreeId: FEAT_PATH });

    expect(proofSubjects[0]).toEqual({ path: FEAT_PATH, locked: false });
    h.dispose();
  });
});

// ── What a create against the typed selection would actually do ──────────

describe("the host resolves a selection before the create runs", () => {
  type Resolution = {
    type: "worktreeCreateResolution";
    repoId: string;
    token: number;
    query: string;
    mode: { kind: string; repairPath?: string; expectedOid?: string; adoptPath?: string };
    freePath: string;
    occupiedCandidate?: { path: string; disposition: { kind: string } };
    blockedBy?: { ownerPath: string };
    baseValid?: { ok: boolean; oid?: string; reason?: string };
  };

  function resolutionIn(view: { posts: ExtensionToWebViewMessage[] }): Resolution | undefined {
    return view.posts.find((m) => m.type === "worktreeCreateResolution") as Resolution | undefined;
  }

  it("answers nothing for a probe whose opening the host does not hold", async () => {
    // Keyed by repository alone, a probe borrowed whichever read arrived last —
    // including one another surface or another opening started (round-1 W2).
    // It is not answered by a fail-open either: an unowned token belongs to no
    // live question, and minting sequence state for one is what let a
    // superseded or invented opening accumulate it (round-4 B7).
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: true, refs: [{ name: "idle" }], truncated: false }),
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 7, seq: 0, query: "idle" });
    await settle();

    expect(resolutionIn(view)).toBeUndefined();
    // The opening it does hold still answers, so this is a refusal and not a
    // host that has stopped resolving.
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "idle" });
    await settle();
    expect(resolutionIn(view)).toMatchObject({ token: 1, mode: { kind: "reuse" } });
    dispose();
  });

  it("answers only the newest probe of an opening, never the one it overtook", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: true, refs: [{ name: "idle" }], truncated: false }),
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 4 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 4 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 4, seq: 1, query: "idle" });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 4, seq: 2, query: "other" });
    await settle();

    const answers = view.posts.filter((m) => m.type === "worktreeCreateResolution");
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ seq: 2, query: "other" });
    dispose();
  });

  it("drops a probe that was still suspended on the enumeration when a newer one arrived", async () => {
    // The gate at dispatch cannot catch this one: probe A is already past it and
    // suspended inside the refs read when B arrives. Without the check on the
    // far side of the await, A resumes and posts a classification the form has
    // moved past — and under a slow read every keystroke's continuation would
    // resume and re-classify (round-1 B5, B6).
    let release: ((r: RepoRefsRead) => void) | undefined;
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      readRefs: () =>
        new Promise<RepoRefsRead>((resolve) => {
          release = resolve;
        }),
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 9 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 9 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 9, seq: 1, query: "first" });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 9, seq: 2, query: "second" });
    // Both are now suspended on the SAME unresolved read.
    expect(view.posts.filter((m) => m.type === "worktreeCreateResolution")).toHaveLength(0);
    release?.({ ok: true, refs: [{ name: "first" }], truncated: false });
    await settle();

    const answers = view.posts.filter((m) => m.type === "worktreeCreateResolution");
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ seq: 2, query: "second" });
    dispose();
  });

  it("ignores a probe that arrives below the opening's newest seq", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: true, refs: [{ name: "idle" }], truncated: false }),
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 4 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 4 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 4, seq: 5, query: "newer" });
    await settle();
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 4, seq: 2, query: "older" });
    await settle();

    const answers = view.posts.filter((m) => m.type === "worktreeCreateResolution");
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ seq: 5 });
    dispose();
  });

  it("refuses a malformed probe rather than carrying it into async work", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], false, { createRoot: "/trees" });
    host.handleMessage(view, {
      type: "worktreeCreateProbe",
      repoId: REPO,
      token: 1,
      seq: Number.NaN,
      query: "idle",
    } as never);
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: 5 } as never);
    await settle();

    expect(view.posts.filter((m) => m.type === "worktreeCreateResolution")).toHaveLength(0);
    dispose();
  });

  it("reports a base that names no commit, before any create is attempted", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: true, refs: [], truncated: false }),
      resolveBase: async () => undefined,
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 2 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 2 });
    host.handleMessage(view, {
      type: "worktreeCreateProbe",
      repoId: REPO,
      token: 2,
      seq: 0,
      query: "brand-new",
      base: { kind: "ref", ref: "no-such-ref" },
    });
    await settle();

    expect(resolutionIn(view)).toMatchObject({
      mode: { kind: "fresh" },
      baseValid: { ok: false },
    });
    dispose();
  });

  it("refuses a probe whose payload is not exactly the declared contract", async () => {
    // Every one of these reaches async work if the guard lets it through, and
    // `base` is the field that reaches git argv (round-3 W1).
    const resolveBase = vi.fn(async () => "deadbeef");
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: true, refs: [], truncated: false }),
      resolveBase,
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 2 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 2 });
    await settle();
    view.posts.length = 0;

    const malformed: Record<string, unknown>[] = [
      // `base` was unvalidated entirely: this one threw on `base.kind` inside
      // a detached promise nobody was awaiting.
      { base: null },
      { base: {} },
      { base: { kind: "ref" } },
      { base: { kind: "ref", ref: "" } },
      { base: { kind: "ref", ref: "main", extra: 1 } },
      { base: { kind: "detached", ref: "main" } },
      { base: { kind: "tag", ref: "v1" } },
      // `Number.isFinite` admitted all of these, and the comparisons that
      // supersede an answer mean nothing on them.
      { seq: -1 },
      { seq: 0.5 },
      { token: -2 },
      { token: Number.MAX_SAFE_INTEGER + 2 },
      { query: 7 },
      { unexpected: "field" },
    ];
    for (const [index, patch] of malformed.entries()) {
      host.handleMessage(view, {
        type: "worktreeCreateProbe",
        repoId: REPO,
        token: 2,
        // A fresh seq each time, so a refusal is the guard's and not the
        // supersession gate dropping a repeat.
        seq: index + 1,
        query: "brand-new",
        ...patch,
      } as never);
    }
    await settle();

    expect(view.posts.filter((m) => m.type === "worktreeCreateResolution")).toEqual([]);
    expect(resolveBase).not.toHaveBeenCalled();

    // The negatives only mean something if the well-formed payload still goes
    // through the same guard.
    host.handleMessage(view, {
      type: "worktreeCreateProbe",
      repoId: REPO,
      token: 2,
      seq: 99,
      query: "brand-new",
      base: { kind: "ref", ref: "main" },
    });
    await settle();
    expect(resolutionIn(view)).toMatchObject({ baseValid: { ok: true, oid: "deadbeef" } });
    dispose();
  });

  it("carries the commit a valid base resolves to", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: true, refs: [], truncated: false }),
      resolveBase: async () => "deadbeef",
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 2 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 2 });
    host.handleMessage(view, {
      type: "worktreeCreateProbe",
      repoId: REPO,
      token: 2,
      seq: 0,
      query: "brand-new",
      base: { kind: "ref", ref: "main" },
    });
    await settle();

    expect(resolutionIn(view)).toMatchObject({ baseValid: { ok: true, oid: "deadbeef" } });
    dispose();
  });

  it("validates the base for adopt too, which the form turns into a new create", async () => {
    // The dialog has no adopt action yet and falls back to creating one, so a
    // withheld verdict here is a withheld verdict on the path that is actually
    // taken (round-3 B4).
    const { host, view, dispose } = await builtHost([windowRow()], true, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: true, refs: [{ name: "feat", heldBy: "feat" }], truncated: false }),
      probeReattach: async ({ repairPath }) => ({ kind: "adopt", adoptPath: repairPath }),
      resolveBase: async () => undefined,
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, {
      type: "worktreeCreateProbe",
      repoId: REPO,
      token: 1,
      seq: 0,
      query: "feat",
      base: { kind: "ref", ref: "no-such-ref" },
    });
    await settle();

    expect(resolutionIn(view)).toMatchObject({ mode: { kind: "adopt" }, baseValid: { ok: false } });
    dispose();
  });

  it("withholds a base verdict where the mode refuses a base at all", async () => {
    // `reuse` starts from something that already exists, so a verdict here
    // would imply a control the form has disabled is still live (D7).
    const resolveBase = vi.fn(async () => "deadbeef");
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: true, refs: [{ name: "idle" }], truncated: false }),
      resolveBase,
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 3 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 3 });
    host.handleMessage(view, {
      type: "worktreeCreateProbe",
      repoId: REPO,
      token: 3,
      seq: 0,
      query: "idle",
      base: { kind: "ref", ref: "main" },
    });
    await settle();

    expect(resolutionIn(view)).toMatchObject({ mode: { kind: "reuse" } });
    expect(resolutionIn(view)?.baseValid).toBeUndefined();
    expect(resolveBase).not.toHaveBeenCalled();
    dispose();
  });

  it("reuses an existing branch no worktree holds, echoing the opening and the query", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: true, refs: [{ name: "idle" }], truncated: false }),
    });
    // The dialog opens by asking for the branch list; the probe rides that
    // read rather than taking a second one (design.md D2).
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 7 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 7 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 7, seq: 0, query: "idle" });
    await settle();

    expect(resolutionIn(view)).toMatchObject({
      repoId: REPO,
      token: 7,
      query: "idle",
      mode: { kind: "reuse" },
      freePath: "/trees/repo-idle",
    });
    dispose();
  });

  it("blocks on the worktree that already holds the branch, and names its path", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: true, refs: [{ name: "feat", heldBy: "feat" }], truncated: false }),
    });
    // The dialog opens by asking for the branch list; the probe rides that
    // read rather than taking a second one (design.md D2).
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "feat" });
    await settle();

    expect(resolutionIn(view)).toMatchObject({ mode: { kind: "reuse" }, blockedBy: { ownerPath: "/repo-wt/feat" } });
    dispose();
  });

  it("creates a branch nothing has heard of", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: true, refs: [{ name: "feat" }], truncated: false }),
    });
    // The dialog opens by asking for the branch list; the probe rides that
    // read rather than taking a second one (design.md D2).
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "brand-new" });
    await settle();

    expect(resolutionIn(view)).toMatchObject({ mode: { kind: "fresh" }, freePath: "/trees/repo-brand-new" });
    dispose();
  });

  it("fails OPEN to fresh when the enumeration could not be taken", async () => {
    // A branch we cannot confirm exists is treated as one to create, and git's
    // own refusal at `add` is the backstop, surfaced verbatim (§ 6). Answering
    // `reuse` here would state that a branch exists on a read that failed.
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: false }),
    });
    // The dialog opens by asking for the branch list; the probe rides that
    // read rather than taking a second one (design.md D2).
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "feat" });
    await settle();

    expect(resolutionIn(view)).toMatchObject({ mode: { kind: "fresh" } });
    dispose();
  });

  it("offers a repair once the prunable claim is corroborated", async () => {
    const subjects: { repoPath: string; branch: string; repairPath: string }[] = [];
    const { host, view, dispose } = await builtHost([windowRow()], true, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: true, refs: [{ name: "feat", heldBy: "feat" }], truncated: false }),
      probeSubjects: subjects,
      probeReattach: async ({ repairPath }) => ({ kind: "offer", repairPath, expectedOid: "def" }),
    });
    // The dialog opens by asking for the branch list; the probe rides that
    // read rather than taking a second one (design.md D2).
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "feat" });
    await settle();

    expect(subjects).toEqual([{ repoPath: MAIN_PATH, branch: "feat", repairPath: "/repo-wt/feat" }]);
    expect(resolutionIn(view)).toMatchObject({
      mode: { kind: "reattach", repairPath: "/repo-wt/feat", expectedOid: "def" },
    });
    dispose();
  });

  it("reports adopt as its own state rather than as a repair", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], true, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: true, refs: [{ name: "feat", heldBy: "feat" }], truncated: false }),
      probeReattach: async ({ repairPath }) => ({ kind: "adopt", adoptPath: repairPath }),
    });
    // The dialog opens by asking for the branch list; the probe rides that
    // read rather than taking a second one (design.md D2).
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "feat" });
    await settle();

    expect(resolutionIn(view)).toMatchObject({ mode: { kind: "adopt", adoptPath: "/repo-wt/feat" } });
    dispose();
  });

  it("falls back to fresh at the FREE path when corroboration declines", async () => {
    // Never `fresh` at the stale path, which would suffix a near-duplicate
    // beside a checkout that is already sitting there (D3).
    const { host, view, dispose } = await builtHost([windowRow()], true, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: true, refs: [{ name: "feat", heldBy: "feat" }], truncated: false }),
      probeReattach: async () => ({ kind: "declined", because: "headMoved" }),
    });
    // The dialog opens by asking for the branch list; the probe rides that
    // read rather than taking a second one (design.md D2).
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "feat" });
    await settle();

    expect(resolutionIn(view)).toMatchObject({ mode: { kind: "fresh" }, freePath: "/trees/repo-feat" });
    dispose();
  });

  it("does not offer a repair where nothing can corroborate one", async () => {
    // No `probeReattach` — every surface but the real extension entry point.
    // The prunable claim alone is not enough, and an uncorroborated repair
    // offer is exactly what D3 exists to prevent.
    const { host, view, dispose } = await builtHost([windowRow()], true, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: true, refs: [{ name: "feat", heldBy: "feat" }], truncated: false }),
    });
    // The dialog opens by asking for the branch list; the probe rides that
    // read rather than taking a second one (design.md D2).
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "feat" });
    await settle();

    expect(resolutionIn(view)).toMatchObject({ mode: { kind: "fresh" } });
    dispose();
  });

  it("names the skipped candidate and what was found there, with nothing to delete it by", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      exists: (p: string) => p === "/trees/repo-feat",
      readRefs: async () => ({ ok: true, refs: [], truncated: false }),
    });
    // The dialog opens by asking for the branch list; the probe rides that
    // read rather than taking a second one (design.md D2).
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "feat" });
    await settle();

    const answer = resolutionIn(view);
    expect(answer?.freePath).not.toBe("/trees/repo-feat");
    expect(answer?.occupiedCandidate).toEqual({ path: "/trees/repo-feat", disposition: { kind: "debris" } });
    // The whole point of the narrower type: a probe the form sends on every
    // settled edit must not hand out a delete authorization (D4).
    expect(Object.keys(answer?.occupiedCandidate?.disposition ?? {})).toEqual(["kind"]);
    dispose();
  });

  it("mints no authorization while a destination is merely being resolved", async () => {
    // The probe fires on every settled edit. A token on that answer would be a
    // delete authorization for a path nobody asked to delete (design.md D6).
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      exists: (p: string) => p === "/trees/repo-feat",
      readRefs: async () => ({ ok: true, refs: [], truncated: false }),
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "feat" });
    await settle();

    const answer = resolutionIn(view);
    expect(answer?.occupiedCandidate?.disposition).toEqual({ kind: "debris" });
    expect(JSON.stringify(answer)).not.toContain("fingerprint");
    dispose();
  });

  it("[r3 B2] a replayed refs ask cannot bring a retired opening's authority back", async () => {
    // The gap [4_1] could not see. Retirement sweeps the `openings` records, but
    // `requestWorktreeRefs` is the writer that CREATES them and it was
    // unguarded — so replaying it with the retired token rebuilt the record and
    // the probe-then-authorize pair reached the issuer again, exactly as before
    // the close. Closing the sweep without closing the writer left D5's own
    // sentence false (.reviews/round-3.md B2).
    let issued = 0;
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      exists: (p: string) => p === "/trees/repo-feat",
      readRefs: async () => ({ ok: true, refs: [], truncated: false }),
      issueDebrisAuthorization: async (p: string) => {
        issued += 1;
        return { ok: true as const, fingerprint: `fp-for-${p}`, entries: ["stale.log"] };
      },
    });
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "feat" });
    await settle();
    expect(view.posts.some((m) => m.type === "worktreeCreateResolution")).toBe(true);

    host.handleMessage(view, { type: "worktreeCreateClosed", opening: 1 });
    // The replay: the same refs ask that seeded the record the close just swept.
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 1, query: "feat" });
    await settle();
    host.handleMessage(view, {
      type: "worktreeAuthorizeDebris",
      repoId: REPO,
      token: 1,
      ask: 1,
      path: "/trees/repo-feat",
    });
    await settle();

    expect(issued, "a replayed refs ask reopened the deletion channel").toBe(0);
    expect(view.posts.filter((m) => m.type === "worktreeDebrisAuthorized")).toHaveLength(0);
    dispose();
  });

  it("[r3 B2] a refs ask naming an opening the host does not hold seeds nothing", async () => {
    // Token 0 is the sharp case: `namedOpening` rejects it on the defaults
    // channel, but this writer accepted it and the probe's own ordinal check is
    // non-negative, so it passed there too. What rejects all three here is the
    // live-opening equality, not the shape check — an unopened surface holds no
    // opening, so nothing can equal it. Dropping `namedOpening` alone therefore
    // survives mutation by construction, which the guard's comment records.
    let reads = 0;
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      readRefs: async () => {
        reads += 1;
        return { ok: true, refs: [{ name: "main" }], truncated: false };
      },
    });

    for (const token of [0, 1, 99]) {
      host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token });
      host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token, seq: 0, query: "feat" });
    }
    await settle();

    expect(reads, "an unheld opening reached the ref reader").toBe(0);
    expect(view.posts.filter((m) => m.type === "worktreeRefs")).toHaveLength(0);
    expect(view.posts.filter((m) => m.type === "worktreeCreateResolution")).toHaveLength(0);
    dispose();
  });

  it("[r3 B2] a refs read resolving after the close publishes nothing", async () => {
    // The read was legitimate when it started. Retirement outranks it: a list
    // arriving for a form the user closed is a reply to a conversation that
    // ended, and the panel's own guard is not the host's excuse for sending it.
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      readRefs: async () => {
        await held;
        return { ok: true, refs: [{ name: "main" }], truncated: false };
      },
      readPullRequests: async () => {
        await held;
        return { ok: true, pullRequests: [], truncated: false };
      },
    });
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    await settle();

    host.handleMessage(view, { type: "worktreeCreateClosed", opening: 1 });
    release?.();
    await settle();

    expect(view.posts.filter((m) => m.type === "worktreeRefs")).toHaveLength(0);
    expect(view.posts.filter((m) => m.type === "worktreePullRequests")).toHaveLength(0);
    dispose();
  });

  it("[4_1] a cancelled form can no longer mint a debris authorization", async () => {
    // The most serious thing one opening token buys: a debris authorization is
    // DELETION authority, and closing the form used to leave the per-repository
    // `openings` record that grants it entirely intact (.reviews/round-1.md B2).
    // The carve-out's own rule is unchanged — a deletion still needs an explicit
    // authorization naming a fingerprint. What changes is that a form the user
    // cancelled can no longer be the thing that names one.
    let issued = 0;
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      exists: (p: string) => p === "/trees/repo-feat",
      readRefs: async () => ({ ok: true, refs: [], truncated: false }),
      issueDebrisAuthorization: async (p: string) => {
        issued += 1;
        return { ok: true as const, fingerprint: `fp-for-${p}`, entries: ["stale.log"] };
      },
    });
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "feat" });
    await settle();
    // The setup landed: this opening COULD have authorized before the close.
    expect(view.posts.some((m) => m.type === "worktreeCreateResolution")).toBe(true);

    host.handleMessage(view, { type: "worktreeCreateClosed", opening: 1 });
    host.handleMessage(view, {
      type: "worktreeAuthorizeDebris",
      repoId: REPO,
      token: 1,
      ask: 1,
      path: "/trees/repo-feat",
    });
    await settle();

    expect(issued, "the cancelled form reached the issuer").toBe(0);
    expect(view.posts.filter((m) => m.type === "worktreeDebrisAuthorized")).toHaveLength(0);
    dispose();
  });

  it("[4_1] a cancelled form's probe publishes nothing", async () => {
    // Same record, the other reader. A retired opening publishes no discovery
    // reply either — one token, one retirement, every channel it carries (D5).
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: true, refs: [], truncated: false }),
    });
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "feat" });
    await settle();
    const before = view.posts.filter((m) => m.type === "worktreeCreateResolution").length;
    expect(before, "no probe ever answered, so refusing one proves nothing").toBeGreaterThan(0);

    host.handleMessage(view, { type: "worktreeCreateClosed", opening: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 1, query: "other" });
    await settle();

    expect(view.posts.filter((m) => m.type === "worktreeCreateResolution")).toHaveLength(before);
    dispose();
  });

  it("issues an authorization over the entries it reports, when one is asked for", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      exists: (p: string) => p === "/trees/repo-feat",
      readRefs: async () => ({ ok: true, refs: [], truncated: false }),
      issueDebrisAuthorization: async (p: string) => ({
        ok: true as const,
        fingerprint: `fp-for-${p}`,
        entries: ["stale.log", "sub"],
      }),
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    // The probe first: it is what PUBLISHES the debris candidate, and only a
    // published candidate can be authorized (round-1 B1).
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "feat" });
    await settle();
    host.handleMessage(view, {
      type: "worktreeAuthorizeDebris",
      repoId: REPO,
      token: 1,
      ask: 1,
      path: "/trees/repo-feat",
    });
    await settle();

    const posted = view.posts.find((m) => m.type === "worktreeDebrisAuthorized");
    expect(posted).toMatchObject({
      granted: true,
      path: "/trees/repo-feat",
      authorization: { path: "/trees/repo-feat", fingerprint: "fp-for-/trees/repo-feat" },
      entries: ["stale.log", "sub"],
    });
    dispose();
  });

  it("refuses to authorize a path the issuer will not vouch for", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      exists: (p: string) => p === "/trees/repo-feat",
      readRefs: async () => ({ ok: true, refs: [], truncated: false }),
      issueDebrisAuthorization: async () => ({ ok: false as const, because: "notDebris" as const }),
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "feat" });
    await settle();
    host.handleMessage(view, {
      type: "worktreeAuthorizeDebris",
      repoId: REPO,
      token: 1,
      ask: 1,
      path: "/trees/repo-feat",
    });
    await settle();

    const posted = view.posts.find((m) => m.type === "worktreeDebrisAuthorized");
    expect(posted).toMatchObject({ granted: false, because: "notDebris" });
    expect(JSON.stringify(posted)).not.toContain("fingerprint");
    dispose();
  });

  it("[B1] issues nothing for a path this opening never published as debris", async () => {
    // The endpoint used to take the request's path straight to the issuer, so a
    // message could enumerate and obtain a delete token for any readable
    // non-git directory on the machine. Only the candidate the panel actually
    // showed is authorizable.
    const asked: string[] = [];
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      exists: (p: string) => p === "/trees/repo-feat",
      readRefs: async () => ({ ok: true, refs: [], truncated: false }),
      issueDebrisAuthorization: async (p: string) => {
        asked.push(p);
        return { ok: true as const, fingerprint: "fp", entries: [] };
      },
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "feat" });
    await settle();

    host.handleMessage(view, {
      type: "worktreeAuthorizeDebris",
      repoId: REPO,
      token: 1,
      ask: 1,
      path: "/Users/dev/Documents",
    });
    await settle();

    expect(asked, "the issuer read a directory the panel never showed").toEqual([]);
    expect(view.posts.find((m) => m.type === "worktreeDebrisAuthorized")).toBeUndefined();

    // The published candidate still works, so this is a binding and not a
    // handler that stopped answering.
    host.handleMessage(view, {
      type: "worktreeAuthorizeDebris",
      repoId: REPO,
      token: 1,
      ask: 1,
      path: "/trees/repo-feat",
    });
    await settle();
    expect(asked).toEqual(["/trees/repo-feat"]);
    dispose();
  });

  it("[B1] stops authorizing a candidate a newer answer withdrew", async () => {
    const asked: string[] = [];
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      exists: (p: string) => p === "/trees/repo-feat",
      readRefs: async () => ({ ok: true, refs: [], truncated: false }),
      issueDebrisAuthorization: async (p: string) => {
        asked.push(p);
        return { ok: true as const, fingerprint: "fp", entries: [] };
      },
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "feat" });
    await settle();
    // A different branch resolves to a free destination, so this opening's
    // latest answer publishes no debris at all.
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 1, query: "other" });
    await settle();

    host.handleMessage(view, {
      type: "worktreeAuthorizeDebris",
      repoId: REPO,
      token: 1,
      ask: 1,
      path: "/trees/repo-feat",
    });
    await settle();

    expect(asked).toEqual([]);
    dispose();
  });

  it("[round-2 B1] does not authorize a candidate the form would never offer", async () => {
    // A repair acts on the registration's own path, so the dialog never offers
    // the skipped candidate for one. Recording it anyway left a path
    // authorizable that no form could have put on screen.
    const asked: string[] = [];
    const { host, view, dispose } = await builtHost([windowRow()], true, {
      createRoot: "/trees",
      exists: (p: string) => p === "/trees/repo-feat",
      readRefs: async () => ({ ok: true, refs: [{ name: "feat", heldBy: "feat" }], truncated: false }),
      probeReattach: async ({ repairPath }: { repairPath: string }) => ({
        kind: "offer" as const,
        repairPath,
        expectedOid: "def",
      }),
      issueDebrisAuthorization: async (p: string) => {
        asked.push(p);
        return { ok: true as const, fingerprint: "fp", entries: [] };
      },
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "feat" });
    await settle();
    const answer = resolutionIn(view);
    // The setup is only meaningful if the resolution really did classify a
    // repair AND report debris — otherwise this passes for the wrong reason.
    expect(answer?.mode.kind, "the setup did not produce a reattach resolution").toBe("reattach");
    expect(answer?.occupiedCandidate?.disposition).toEqual({ kind: "debris" });

    host.handleMessage(view, {
      type: "worktreeAuthorizeDebris",
      repoId: REPO,
      token: 1,
      ask: 1,
      path: answer?.occupiedCandidate?.path ?? "",
    });
    await settle();

    expect(asked, "the host authorized a candidate no form offers").toEqual([]);
    dispose();
  });

  it("[round-2 B1] stops authorizing the previous candidate the moment a newer probe is admitted", async () => {
    // Not when the newer ANSWER lands: between admitting the probe and posting
    // its answer the withdrawn path stayed authorizable, which is the whole
    // window the user's edit was supposed to close.
    const asked: string[] = [];
    let releaseSecond: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let reads = 0;
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      exists: (p: string) => p === "/trees/repo-feat",
      readRefs: async () => ({ ok: true, refs: [], truncated: false }),
      resolveBase: async () => {
        reads += 1;
        if (reads > 1) {
          await gate;
        }
        return "oid-1";
      },
      issueDebrisAuthorization: async (p: string) => {
        asked.push(p);
        return { ok: true as const, fingerprint: "fp", entries: [] };
      },
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, {
      type: "worktreeCreateProbe",
      repoId: REPO,
      token: 1,
      seq: 0,
      query: "feat",
      base: { kind: "ref", ref: "main" },
    });
    await settle();
    expect(resolutionIn(view)?.occupiedCandidate?.path, "the setup published no debris").toBe("/trees/repo-feat");

    // A newer probe is ADMITTED but its answer is still in flight.
    host.handleMessage(view, {
      type: "worktreeCreateProbe",
      repoId: REPO,
      token: 1,
      seq: 1,
      query: "other",
      base: { kind: "ref", ref: "main" },
    });
    host.handleMessage(view, {
      type: "worktreeAuthorizeDebris",
      repoId: REPO,
      token: 1,
      ask: 1,
      path: "/trees/repo-feat",
    });
    await settle();

    expect(asked, "a withdrawn candidate was still authorizable while the newer answer was in flight").toEqual([]);
    releaseSecond?.();
    await settle();
    dispose();
  });

  it("answers nothing for an authorization request under an unowned token", async () => {
    let asked = 0;
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: true, refs: [], truncated: false }),
      issueDebrisAuthorization: async () => {
        asked += 1;
        return { ok: true as const, fingerprint: "fp", entries: [] };
      },
    });
    // No opening was minted for token 9.
    host.handleMessage(view, {
      type: "worktreeAuthorizeDebris",
      repoId: REPO,
      token: 9,
      ask: 1,
      path: "/trees/repo-feat",
    });
    await settle();

    expect(asked).toBe(0);
    expect(view.posts.find((m) => m.type === "worktreeDebrisAuthorized")).toBeUndefined();
    dispose();
  });

  it("does not call a skipped candidate debris when a .git survives in it", async () => {
    // The registration proxy this replaced would answer `debris` here — the path
    // is occupied and unregistered — and offer to delete a checkout whose entry
    // was pruned, which is WT-012.15's to re-register (design.md D1).
    const asked: string[] = [];
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      exists: (p: string) => p === "/trees/repo-feat",
      probeGitEntry: (p: string) => {
        asked.push(p);
        return "present";
      },
      readRefs: async () => ({ ok: true, refs: [], truncated: false }),
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "feat" });
    await settle();

    const answer = resolutionIn(view);
    expect(answer?.occupiedCandidate).toEqual({ path: "/trees/repo-feat", disposition: { kind: "free" } });
    // The reading came from the candidate's own `.git`, not from the listing.
    expect(asked).toEqual(["/trees/repo-feat/.git"]);
    dispose();
  });

  it("says nothing about a candidate the suffixing never skipped", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: true, refs: [], truncated: false }),
    });
    // The dialog opens by asking for the branch list; the probe rides that
    // read rather than taking a second one (design.md D2).
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "feat" });
    await settle();

    expect(resolutionIn(view)?.occupiedCandidate).toBeUndefined();
    dispose();
  });

  it("ignores a candidate path outside the create root", async () => {
    // The answer states whether a path is occupied. Honouring an arbitrary one
    // would turn a probe the form sends per edit into an existence oracle for
    // the whole filesystem.
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      exists: (p: string) => p === "/etc/secrets",
      readRefs: async () => ({ ok: true, refs: [], truncated: false }),
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, {
      type: "worktreeCreateProbe",
      repoId: REPO,
      token: 1,
      seq: 0,
      query: "feat",
      candidatePath: "/etc/secrets",
    });
    await settle();

    const answer = resolutionIn(view);
    expect(answer?.freePath).toBe("/trees/repo-feat");
    expect(answer?.occupiedCandidate).toBeUndefined();
    dispose();
  });

  it("retires a superseded opening rather than retaining it for the host's life", async () => {
    // One record per surface and repository, REPLACED by the next opening: the
    // per-opening keying that stopped a new opening overwriting the old is
    // exactly what made them accumulate, one settled read and one sequence per
    // dialog open, for the life of the extension host (round-3 B7, round-4 W8).
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: true, refs: [{ name: "feat", heldBy: "feat" }], truncated: false }),
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "feat" });
    await settle();
    expect(resolutionIn(view)).toMatchObject({ mode: { kind: "reuse" } });
    view.posts.length = 0;

    // A second opening. Nothing can reach the first one from here.
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 2 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 2 });
    await settle();
    view.posts.length = 0;

    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "feat" });
    await settle();
    expect(resolutionIn(view), "the retired opening still answered").toBeUndefined();

    // And the replacement is live, so the retirement did not take the current
    // opening with it.
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 2, seq: 0, query: "feat" });
    await settle();
    expect(resolutionIn(view)).toMatchObject({ token: 2, mode: { kind: "reuse" } });
    dispose();
  });

  it("[7_2] drops a suspended probe rather than corroborating for a departed repository", async () => {
    // Releasing the map entry cannot reach a continuation that captured the
    // opening OBJECT before its await, so the probe resumed and classified from
    // facts about a repository the workspace no longer has. Identity after every
    // await is what authorizes the answer (round-5 B7, design.md D9).
    //
    // Each window needs its own case: the gates are sequential, so whichever is
    // reached first catches a departure and the ones after it never run. What
    // separates them is the WORK between them — this one proves the
    // corroboration never happens.
    let release: ((r: RepoRefsRead) => void) | undefined;
    const probeSubjects: { repoPath: string; branch: string; repairPath: string }[] = [];
    const { host, view, setFolders, dispose } = await builtHost([windowRow()], true, {
      createRoot: "/trees",
      sibling: true,
      probeSubjects,
      probeReattach: async () => ({ kind: "declined", because: "headMoved" }),
      readRefs: () =>
        new Promise<RepoRefsRead>((resolve) => {
          release = resolve;
        }),
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    // `feat` is held by a worktree git reports prunable, so it classifies as a
    // reattach CANDIDATE — the one mode that corroborates.
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "feat" });
    await settle();
    expect(
      view.posts.filter((m) => m.type === "worktreeCreateResolution"),
      "the probe answered before the read",
    ).toHaveLength(0);

    await setFolders([OTHER_ROOT]);
    expect(host.openingsHeld(), "the setup never released the opening").toBe(0);

    release?.({ ok: true, refs: [{ name: "feat", heldBy: "feat" }], truncated: false });
    await settle();

    expect(probeSubjects, "a departed repository was still corroborated").toEqual([]);
    expect(view.posts.filter((m) => m.type === "worktreeCreateResolution")).toHaveLength(0);
    dispose();
  });

  it("[7_2] drops a probe whose repository leaves while it is corroborating", async () => {
    const baseAsks: string[] = [];
    let depart: () => Promise<void> = async () => {};
    const { host, view, setFolders, dispose } = await builtHost([windowRow()], true, {
      createRoot: "/trees",
      sibling: true,
      readRefs: async () => ({ ok: true, refs: [{ name: "feat", heldBy: "feat" }], truncated: false }),
      probeReattach: async () => {
        await depart();
        return { kind: "declined", because: "headMoved" };
      },
      resolveBase: async ({ ref }) => {
        baseAsks.push(ref);
        return "abc";
      },
    });
    depart = () => setFolders([OTHER_ROOT]);
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, {
      type: "worktreeCreateProbe",
      repoId: REPO,
      token: 1,
      seq: 0,
      query: "feat",
      base: { kind: "ref", ref: "origin/main" },
    });
    // The departure runs its own rebuild inside the corroboration, so the
    // continuation resumes a turn later than the settle that released it.
    await settle();
    await settle();

    // A declined corroboration falls back to `fresh`, which is the one mode that
    // goes on to resolve a base — so the base ask is what says this continuation
    // kept running for a repository that had left.
    expect(baseAsks, "a departed repository was still asked to resolve a base").toEqual([]);
    expect(view.posts.filter((m) => m.type === "worktreeCreateResolution")).toHaveLength(0);
    dispose();
  });

  it("[7_2] drops a probe whose repository leaves while its base is being resolved", async () => {
    let depart: () => Promise<void> = async () => {};
    const { host, view, setFolders, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      sibling: true,
      readRefs: async () => ({ ok: true, refs: [], truncated: false }),
      resolveBase: async () => {
        await depart();
        return "abc";
      },
    });
    depart = () => setFolders([OTHER_ROOT]);
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, {
      type: "worktreeCreateProbe",
      repoId: REPO,
      token: 1,
      seq: 0,
      query: "brand-new",
      base: { kind: "ref", ref: "origin/main" },
    });
    await settle();
    await settle();

    expect(view.posts.filter((m) => m.type === "worktreeCreateResolution")).toHaveLength(0);
    dispose();
  });

  it("forgets the openings of a repository that left the workspace", async () => {
    // Retirement rode a LATER refs request for the same repository, and a
    // repository that has left is never the subject of one again — so its
    // opening survived to surface detach or host disposal (round-4 B7).
    const { host, view, dropSibling, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      sibling: true,
      readRefs: async () => ({ ok: true, refs: [{ name: "feat" }], truncated: false }),
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: OTHER_REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: OTHER_REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: OTHER_REPO, token: 1, seq: 0, query: "feat" });
    await settle();
    expect(resolutionIn(view), "the setup never opened on the sibling at all").toBeDefined();
    view.posts.length = 0;

    expect(host.openingsHeld()).toBe(1);

    await dropSibling();

    // Released, not merely unreachable. A departed repository's opening answers
    // nothing either way — the repo lookup refuses first — so the count is the
    // only thing that can tell retaining it from releasing it.
    expect(host.openingsHeld()).toBe(0);
    view.posts.length = 0;
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: OTHER_REPO, token: 1, seq: 1, query: "feat" });
    await settle();
    expect(resolutionIn(view)).toBeUndefined();
    dispose();
  });

  it("ignores a candidate path that is spelled inside the root but resolves outside it", async () => {
    // Lexical containment is not enough: the answer authorizes `exists`, which
    // follows symlinks, so a link under the root would let the probe report on
    // a path the root does not contain (round-3 B8).
    const probed: string[] = [];
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      symlinks: { "/trees/link": "/etc/secrets" },
      exists: (p: string) => {
        probed.push(p);
        return p === "/etc/secrets" || p === "/trees/link";
      },
      readRefs: async () => ({ ok: true, refs: [], truncated: false }),
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, {
      type: "worktreeCreateProbe",
      repoId: REPO,
      token: 1,
      seq: 0,
      query: "feat",
      candidatePath: "/trees/link",
    });
    await settle();

    const answer = resolutionIn(view);
    expect(answer?.freePath).toBe("/trees/repo-feat");
    expect(answer?.occupiedCandidate).toBeUndefined();
    // Not merely a different answer: the outside path was never read.
    expect(probed).not.toContain("/trees/link");
    dispose();
  });

  it("honours a candidate path inside the create root", async () => {
    // The negative above only means something if the positive works.
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: true, refs: [], truncated: false }),
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, {
      type: "worktreeCreateProbe",
      repoId: REPO,
      token: 1,
      seq: 0,
      query: "feat",
      candidatePath: "/trees/somewhere-else",
    });
    await settle();

    expect(resolutionIn(view)?.freePath).toBe("/trees/somewhere-else");
    dispose();
  });

  it("rides the enumeration the opening already took, rather than asking git again", async () => {
    // D2: classification is a function over facts the host already holds. A
    // probe per settled edit that re-enumerates is the per-keystroke read D2
    // rejected, and two reads of one repository can disagree about one instant.
    const refsInputs: RepoRefsInput[] = [];
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      refsInputs,
      readRefs: async () => ({ ok: true, refs: [{ name: "idle" }], truncated: false }),
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "idle" });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "idle" });
    await settle();

    // Both settles classified against the list, and both classified correctly.
    expect(refsInputs).toHaveLength(1);
    expect(resolutionIn(view)).toMatchObject({ mode: { kind: "reuse" } });
    dispose();
  });

  it("joins a read still in flight instead of answering around it", async () => {
    // A settle landing inside the read window must not resolve `fresh` on a
    // list that is about to arrive.
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      readRefs: async () => {
        await gate;
        return { ok: true, refs: [{ name: "idle" }], truncated: false };
      },
    });
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "idle" });
    await settle();
    expect(resolutionIn(view), "the probe answered before the list it depends on").toBeUndefined();

    release();
    await settle();

    expect(resolutionIn(view)).toMatchObject({ mode: { kind: "reuse" } });
    dispose();
  });

  it("answers nothing when no opening has asked for a list yet", async () => {
    // The fail-OPEN is for an enumeration that FAILED — the case below — and
    // not for a probe with no opening behind it at all. The form's own gate
    // holds Create until an answer lands, so silence here is honest where a
    // `fresh` on no evidence would not be (round-4 B7).
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      createRoot: "/trees",
      readRefs: async () => ({ ok: true, refs: [{ name: "idle" }], truncated: false }),
    });
    host.handleMessage(view, { type: "worktreeCreateProbe", repoId: REPO, token: 1, seq: 0, query: "idle" });
    await settle();

    expect(resolutionIn(view)).toBeUndefined();
    dispose();
  });

  it("answers nothing for a repository the host does not hold", async () => {
    const { host, view, dispose } = await builtHost([windowRow()], false, { createRoot: "/trees" });
    // The dialog opens by asking for the branch list; the probe rides that
    // read rather than taking a second one (design.md D2).
    // The form opens first: refs rides an opening the host already holds, and the
    // branch-less defaults ask is the only door that establishes one (round-3 B2).
    host.handleMessage(view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    host.handleMessage(view, { type: "requestWorktreeRefs", repoId: REPO, token: 1 });
    host.handleMessage(view, {
      type: "worktreeCreateProbe",
      repoId: "/elsewhere/.git",
      token: 1,
      seq: 0,
      query: "feat",
    });
    await settle();

    expect(resolutionIn(view)).toBeUndefined();
    dispose();
  });
});

describe("a removal is reported without being performed", () => {
  const REPORT = (fingerprint: string | null): WorktreeRemoveAssessmentMessage["result"] => ({
    kind: "assessed",
    assessment: { checks: [{ id: "dirty", cls: "confirmable", outcome: "passed" }], contained: [] },
    fingerprint,
  });

  it("answers the asking surface and never reaches the removal", async () => {
    const { host, view, calls, dispose } = await builtHost([windowRow()], false, { assessReport: REPORT(null) });
    host.handleMessage(view, { type: "worktreeRemoveAssess", worktreeId: RAW_ID, token: "t-1" });
    await settle();

    // The whole point of round-3 B1: asking must not be a way of removing. The
    // full `calls` list, not a filter — a `removeWorktree` entry appearing here
    // is the defect, and a filtered assertion would not see it.
    expect(calls).toEqual([["assessRemovalReport", { repoId: REPO, worktreeId: RAW_ID, origin: view }]]);
    expect(view.posts).toEqual([
      { type: "worktreeRemoveAssessment", worktreeId: RAW_ID, token: "t-1", result: REPORT(null) },
    ]);
    dispose();
  });

  it("carries the fingerprint the service issued, and carries none when it issued none", async () => {
    const withRisk = await builtHost([windowRow()], false, { assessReport: REPORT("fp-9") });
    withRisk.host.handleMessage(withRisk.view, { type: "worktreeRemoveAssess", worktreeId: RAW_ID, token: "t-1" });
    await settle();
    const risky = withRisk.view.posts[0];
    expect(
      risky?.type === "worktreeRemoveAssessment" && risky.result.kind === "assessed" && risky.result.fingerprint,
    ).toBe("fp-9");
    withRisk.dispose();

    // D7: a clean report is not a weaker version of the same message, it is one
    // that authorizes nothing. Asserted separately so a change that started
    // issuing unconditionally fails here rather than passing both cases.
    const clean = await builtHost([windowRow()], false, { assessReport: REPORT(null) });
    clean.host.handleMessage(clean.view, { type: "worktreeRemoveAssess", worktreeId: RAW_ID, token: "t-1" });
    await settle();
    const post = clean.view.posts[0];
    expect(
      post?.type === "worktreeRemoveAssessment" && post.result.kind === "assessed" && post.result.fingerprint,
    ).toBe(null);
    clean.dispose();
  });

  it("reaches no capability for an id that names nothing, and still answers", async () => {
    // D12 admits no exception: an unanswered request leaves the panel's own
    // duplicate-request guard waiting on a reply that is never coming, and the
    // menu item dead for that row.
    const { host, view, calls, dispose } = await builtHost([windowRow()], false, { assessReport: REPORT(null) });
    host.handleMessage(view, { type: "worktreeRemoveAssess", worktreeId: "/nowhere", token: "t-1" });
    await settle();

    expect(calls).toEqual([]);
    expect(view.posts).toEqual([
      {
        type: "worktreeRemoveAssessment",
        worktreeId: "/nowhere",
        token: "t-1",
        result: { kind: "unavailable", unreadable: ["the worktree is no longer registered"] },
      },
    ]);
    dispose();
  });

  it("posts nothing when the assessment could not be made at all", async () => {
    // D8: `unavailable` travels as its own arm. A flat report would arrive with
    // every check unproven, which since 1_5 reads as a hard refusal — the host
    // would be telling the user a worktree it merely could not READ may never
    // be removed.
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      assessReport: { kind: "unavailable", unreadable: ["/repo-wt/feat"] },
    });
    host.handleMessage(view, { type: "worktreeRemoveAssess", worktreeId: RAW_ID, token: "t-1" });
    await settle();

    const post = view.posts[0];
    expect(post?.type === "worktreeRemoveAssessment" && post.result.kind).toBe("unavailable");
    dispose();
  });

  it("[W5] answers an assessment that threw, rather than leaving the action unanswered", async () => {
    // The catch used to post nothing, so a failed read made Remove Worktree look
    // inert: nothing deleted, nothing said, and no retry — the surface D8
    // defines is reachable only through a typed `unavailable` (D12).
    const { host, view, dispose } = await builtHost([windowRow()], false, {
      assessReport: async () => {
        throw new Error("status read failed");
      },
    });
    host.handleMessage(view, { type: "worktreeRemoveAssess", worktreeId: RAW_ID, token: "t-1" });
    await settle();

    expect(view.posts).toEqual([
      {
        type: "worktreeRemoveAssessment",
        worktreeId: RAW_ID,
        token: "t-1",
        result: { kind: "unavailable", unreadable: ["the assessment"] },
      },
    ]);
    dispose();
  });

  it("[W5] posts nothing when the assessment throws after the surface detached", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { host, view, calls, dispose } = await builtHost([windowRow()], false, {
      assessReport: async () => {
        await gate;
        throw new Error("status read failed");
      },
    });
    host.handleMessage(view, { type: "worktreeRemoveAssess", worktreeId: RAW_ID, token: "t-1" });
    dispose();
    release?.();
    await settle();

    // The read has to have actually been reached, or "posted nothing" is a
    // claim about a walk that never happened.
    expect(calls).toEqual([["assessRemovalReport", { repoId: REPO, worktreeId: RAW_ID, origin: view }]]);
    expect(view.posts).toEqual([]);
  });
});

describe("assessment traffic is bounded by one job per repository", () => {
  const REPORT: WorktreeRemoveAssessmentMessage["result"] = {
    kind: "assessed",
    assessment: { checks: [], contained: [] },
    fingerprint: null,
  };

  /**
   * The count of `assessRemovalReport` calls IS the count of mutation-queue
   * jobs. In production the whole body of that capability runs inside
   * `coordinator.run`, so a second call here is a second job sitting ahead of
   * every destructive mutation on that repository — which is what round-6 B5
   * measured (design.md D1).
   */
  const assessed = (calls: Array<[string, ...unknown[]]>) => calls.filter((c) => c[0] === "assessRemovalReport");
  const targetsOf = (calls: Array<[string, ...unknown[]]>) =>
    assessed(calls).map((c) => (c[1] as { worktreeId: string }).worktreeId);
  const tokensOf = (posts: readonly ExtensionToWebViewMessage[]) =>
    posts.filter((p) => p.type === "worktreeRemoveAssessment").map((p) => (p as { token: string }).token);

  /** Holds every assessment open, so a test can inspect the lane mid-flight. */
  function heldAssess() {
    const waiting: Array<() => void> = [];
    return {
      report: () =>
        new Promise<AssessReport>((resolve) => {
          waiting.push(() => resolve(REPORT));
        }),
      /** Let them finish one at a time, so a re-enqueue can happen between. */
      drain: async () => {
        for (let guard = 0; guard < 20 && waiting.length > 0; guard += 1) {
          waiting.shift()?.();
          await settle();
        }
      },
    };
  }

  it("adds no job while one is outstanding, and then serves only the latest question", async () => {
    const gate = heldAssess();
    const { host, view, calls, dispose } = await builtHost([windowRow()], false, { assessReport: gate.report });

    host.handleMessage(view, { type: "worktreeRemoveAssess", worktreeId: RAW_ID, token: "t-1" });
    await settle();
    // Alternating two rows is exactly what defeated the panel-side guard: it
    // dropped only a repeat of the ONE live worktree id (round-6 B5).
    host.handleMessage(view, { type: "worktreeRemoveAssess", worktreeId: FEAT_PATH, token: "t-2" });
    host.handleMessage(view, { type: "worktreeRemoveAssess", worktreeId: RAW_ID, token: "t-3" });
    await settle();

    expect(assessed(calls)).toHaveLength(1);

    await gate.drain();

    // Two jobs, never three. `t-2` was replaced while still pending, so it is
    // never assessed at all — the work is dropped, not merely its answer.
    expect(targetsOf(calls)).toEqual([RAW_ID, RAW_ID]);
    expect(tokensOf(view.posts)).toEqual(["t-1", "t-3"]);
    dispose();
  });

  it("queues nothing more however many surfaces attach, ask and detach", async () => {
    const gate = heldAssess();
    const { host, view, calls, dispose } = await builtHost([windowRow()], false, { assessReport: gate.report });

    host.handleMessage(view, { type: "worktreeRemoveAssess", worktreeId: RAW_ID, token: "t-1" });
    await settle();

    // The counterexample that refuted a slot keyed by (surface, repository):
    // detaching deletes the record but cannot retract a job already appended,
    // so N cycles left N jobs ahead of a mutation with nothing attached.
    for (let i = 0; i < 8; i += 1) {
      const extra = surface();
      const attachment = host.attach(extra);
      host.handleMessage(extra, { type: "worktreeRemoveAssess", worktreeId: FEAT_PATH, token: `churn-${i}` });
      attachment.dispose();
    }
    await settle();
    expect(assessed(calls)).toHaveLength(1);

    await gate.drain();

    // And nothing is left owing afterwards: every churned request went with the
    // surface that made it.
    expect(assessed(calls)).toHaveLength(1);
    dispose();
  });

  it("serves each asking surface in turn rather than the newest question", async () => {
    const gate = heldAssess();
    const { host, view, calls, dispose } = await builtHost([windowRow()], false, { assessReport: gate.report });
    const second = surface();
    const secondAttachment = host.attach(second);

    host.handleMessage(view, { type: "worktreeRemoveAssess", worktreeId: RAW_ID, token: "a-1" });
    await settle();
    // Both panels keep asking while the first job is held, and `second` asks
    // LAST. A lane serving the newest pending request would answer `second`
    // next and leave `view` behind its own newer question; the rotation answers
    // `view` next because it is the one whose turn it is.
    host.handleMessage(second, { type: "worktreeRemoveAssess", worktreeId: FEAT_PATH, token: "b-1" });
    host.handleMessage(view, { type: "worktreeRemoveAssess", worktreeId: RAW_ID, token: "a-2" });
    host.handleMessage(second, { type: "worktreeRemoveAssess", worktreeId: FEAT_PATH, token: "b-2" });
    await settle();

    expect(assessed(calls)).toHaveLength(1);
    await gate.drain();

    expect(targetsOf(calls)).toEqual([RAW_ID, RAW_ID, FEAT_PATH]);
    // `b-1` was replaced while still pending, so it is never assessed and never
    // answered — but `second` is still answered, which is the anti-starvation
    // property the round-robin exists for.
    expect(tokensOf(view.posts)).toEqual(["a-1", "a-2"]);
    expect(tokensOf(second.posts)).toEqual(["b-2"]);
    secondAttachment.dispose();
    dispose();
  });

  it("gives each repository its own lane", async () => {
    const gate = heldAssess();
    const { host, view, calls, dispose } = await builtHost([windowRow()], false, {
      sibling: true,
      assessReport: gate.report,
    });

    host.handleMessage(view, { type: "worktreeRemoveAssess", worktreeId: RAW_ID, token: "r-1" });
    host.handleMessage(view, { type: "worktreeRemoveAssess", worktreeId: OTHER_ROOT, token: "o-1" });
    await settle();

    // One lane each: a busy repository must not hold up a question about a
    // different one, because they are different mutation queues.
    expect(assessed(calls)).toHaveLength(2);

    // And the lanes bound independently — a repeat into either adds nothing
    // while that one is busy, which is what makes this two lanes rather than
    // no lane at all.
    host.handleMessage(view, { type: "worktreeRemoveAssess", worktreeId: RAW_ID, token: "r-2" });
    host.handleMessage(view, { type: "worktreeRemoveAssess", worktreeId: OTHER_ROOT, token: "o-2" });
    await settle();
    expect(assessed(calls)).toHaveLength(2);
    await gate.drain();
    dispose();
  });
});

describe("the provisioning a create is actually given", () => {
  const REQ = {
    type: "worktreeCreate",
    repoId: REPO,
    opening: 1,
    path: "/trees/feat",
    mode: { kind: "fresh", branch: "feat" },
    disposition: { kind: "free" },
    afterCreate: { kind: "none" },
  } as const;

  const CREATED: WorktreeMutationResultMessage = {
    type: "worktreeMutationResult",
    verb: "create",
    repoId: REPO,
    result: { kind: "ok" },
  };

  function twoEntries(): ProvisionModel {
    return {
      entries: [
        { id: "a", path: ".env", mode: "copy", source: "asimov/worktree.yaml" },
        { id: "b", path: "node_modules", mode: "link", source: "asimov/worktree.yaml" },
      ],
      setup: [],
      ports: [],
      providers: [{ id: "asimov", files: ["asimov/worktree.yaml"], active: true }],
      excluded: [],
      problems: [],
    };
  }

  /**
   * A form open on a two-row model, plus the offer it was shown.
   *
   * The offer's ids are the store's, not `twoEntries`' — issuing remints them.
   * Reading them back from the post is the only way a test can name a selection
   * the way the panel does, and it is also what makes these assertions about
   * RESOLUTION rather than about a list the test spelled twice.
   */
  async function formWithOffer() {
    const built = await builtHost(undefined, false, { readProvisioning: async () => twoEntries() });
    built.host.handleMessage(built.view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    await settle();
    const offer = (built.view.posts as ExtensionToWebViewMessage[]).find(
      (p) => p.type === "worktreeProvisionOffer",
    ) as unknown as { offerId: string; model: ProvisionModel };
    return { ...built, offer };
  }

  const creates = (calls: Array<[string, ...unknown[]]>) => calls.filter(([name]) => name === "createWorktree");
  const given = (calls: Array<[string, ...unknown[]]>) =>
    (creates(calls)[0]?.[1] as { provision?: readonly { path: string; mode: string }[] } | undefined)?.provision;

  it("previews named ports before issuing the offer", async () => {
    const previews: Array<{ names: readonly string[]; paths: readonly string[] }> = [];
    const model: ProvisionModel = {
      ...twoEntries(),
      ports: [{ id: "port-a", name: "APP", source: "asimov/worktree.yaml" }],
    };
    const built = await builtHost(undefined, false, {
      readProvisioning: async () => model,
      previewProvisioningPorts: async (ports, paths) => {
        previews.push({ names: ports.map((item) => item.name), paths });
        return ports.map((item) => ({ ...item, port: 5183 }));
      },
    });

    built.host.handleMessage(built.view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    await settle();

    const offer = (built.view.posts as ExtensionToWebViewMessage[]).find(
      (message) => message.type === "worktreeProvisionOffer",
    );
    expect(offer?.type === "worktreeProvisionOffer" && offer.model.ports[0]).toMatchObject({ name: "APP", port: 5183 });
    expect(previews).toEqual([{ names: ["APP"], paths: expect.arrayContaining([MAIN_PATH]) }]);
    built.dispose();
  });

  it("issues one unavailable preview when previewing fails", async () => {
    let attempts = 0;
    const model: ProvisionModel = {
      ...twoEntries(),
      ports: [{ id: "port-a", name: "APP", source: "asimov/worktree.yaml", port: 5000 }],
    };
    const built = await builtHost(undefined, false, {
      readProvisioning: async () => model,
      previewProvisioningPorts: async () => {
        attempts += 1;
        throw new Error("probe failed");
      },
    });

    built.host.handleMessage(built.view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    await settle();

    const offer = (built.view.posts as ExtensionToWebViewMessage[]).find(
      (message) => message.type === "worktreeProvisionOffer",
    );
    expect(attempts).toBe(1);
    expect(offer?.type === "worktreeProvisionOffer" && offer.model.ports[0]?.port).toBeUndefined();
    built.dispose();
  });

  it("hands selected ports to create separately from selected entries", async () => {
    const model: ProvisionModel = {
      ...twoEntries(),
      ports: [
        { id: "port-a", name: "APP", source: "asimov/worktree.yaml", port: 5183 },
        { id: "port-b", name: "APP", source: "asimov/worktree.yaml", port: 5183 },
      ],
    };
    const built = await builtHost(undefined, false, { readProvisioning: async () => model });
    built.host.handleMessage(built.view, { type: "requestWorktreeCreateDefaults", repoId: REPO, opening: 1 });
    await settle();
    const offer = (built.view.posts as ExtensionToWebViewMessage[]).find(
      (message) => message.type === "worktreeProvisionOffer",
    );
    if (offer?.type !== "worktreeProvisionOffer") {
      throw new Error("expected provisioning offer");
    }

    built.host.handleMessage(built.view, {
      ...REQ,
      provision: {
        offerId: offer.offerId,
        itemIds: [offer.model.entries[0]?.id ?? "", offer.model.ports[1]?.id ?? ""],
      },
    });
    await settle();

    const request = creates(built.calls)[0]?.[1] as
      | { provision?: readonly ProvisionModel["entries"][number][]; ports?: readonly ProvisionModel["ports"][number][] }
      | undefined;
    expect(new Set(offer.model.ports.map((item) => item.id)).size).toBe(2);
    expect(request?.provision).toEqual([offer.model.entries[0]]);
    expect(request?.ports).toEqual([offer.model.ports[1]]);
    built.dispose();
  });

  it("hands over the host's own entries, never a path the webview spelled", async () => {
    const { host, view, calls, offer, dispose } = await formWithOffer();
    host.handleMessage(view, {
      ...REQ,
      provision: { offerId: offer.offerId, itemIds: offer.model.entries.map((e) => e.id) },
    });
    await settle();

    expect(creates(calls)).toHaveLength(1);
    expect(given(calls)).toEqual(offer.model.entries);
    dispose();
  });

  it("carries only the rows the user checked", async () => {
    const { host, view, calls, offer, dispose } = await formWithOffer();
    const second = offer.model.entries[1];
    host.handleMessage(view, { ...REQ, provision: { offerId: offer.offerId, itemIds: [second?.id ?? ""] } });
    await settle();

    expect(given(calls)).toEqual([second]);
    dispose();
  });

  it("invents no entry for an item id the offer never named", async () => {
    // The selection arrives from the webview, so it is an input and not a fact.
    // An id the model does not hold must resolve to nothing — the alternative
    // is a create provisioning a row the user was never shown.
    const { host, view, calls, offer, dispose } = await formWithOffer();
    host.handleMessage(view, {
      ...REQ,
      provision: { offerId: offer.offerId, itemIds: ["../../etc/passwd", offer.model.entries[0]?.id ?? ""] },
    });
    await settle();

    expect(given(calls)).toEqual([offer.model.entries[0]]);
    dispose();
  });

  it("[F001] says WHY it refused a stale offer, on the arm the panel already reads", async () => {
    // The absent create was the only thing the first version of this test
    // asserted, and it is exactly half the contract: D3 says the refusal is
    // stated "on the existing worktreeMutationResult error arm". A Create
    // button that silently does nothing teaches the user nothing about the one
    // recovery that works.
    const { host, view, calls, offer, dispose } = await formWithOffer();
    host.handleMessage(view, {
      ...REQ,
      provision: { offerId: `${offer.offerId}-stale`, itemIds: offer.model.entries.map((e) => e.id) },
    });
    await settle();

    expect(creates(calls)).toEqual([]);
    const refusal = (view.posts as ExtensionToWebViewMessage[]).find((m) => m.type === "worktreeMutationResult") as
      | WorktreeMutationResultMessage
      | undefined;
    expect(refusal).toMatchObject({ verb: "create", repoId: REPO, result: { kind: "error" } });
    expect(refusal?.result.kind === "error" && refusal.result.message).toMatch(/reopen the dialog/i);
    dispose();
  });

  it.each([
    ["item ids that are not a list", (o: string) => ({ offerId: o, itemIds: "all" })],
    ["item ids that are not strings", (o: string) => ({ offerId: o, itemIds: [1, 2] })],
    ["a field nobody declared", (o: string) => ({ offerId: o, itemIds: [], andAlso: "/etc/passwd" })],
    ["no offer id at all", () => ({ itemIds: [] })],
    ["nothing that is even an object", () => "nope"],
  ])("[F006] refuses a selection with %s, and says nothing about it", async (_label, build) => {
    // Built on the LIVE offer id, which is the whole point. The first version
    // of this test used a made-up id, so every case was refused by the stale-
    // offer branch one line below and the guard could be deleted with the suite
    // still green — it witnessed the wrong layer. With the live id, only the
    // shape check stands between these messages and a create.
    //
    // Two assertions, because "no create" alone does not separate the two
    // refusals: a stale offer is a state the user can recover from and SAYS so,
    // a malformed message is a protocol violation that fails closed in silence
    // (worktree-rpc.md § 4).
    const { host, view, calls, offer, dispose } = await formWithOffer();
    view.posts.length = 0;
    expect(() =>
      host.handleMessage(view, { ...REQ, provision: build(offer.offerId) } as unknown as Parameters<
        typeof host.handleMessage
      >[1]),
    ).not.toThrow();
    await settle();

    expect(creates(calls)).toEqual([]);
    expect((view.posts as ExtensionToWebViewMessage[]).filter((m) => m.type === "worktreeMutationResult")).toEqual([]);
    dispose();
  });

  it("[F006] throws nothing for item ids that are not iterable at all", async () => {
    // `new Set(null)` throws, and this handler is reached from a dispatch that
    // returns BEFORE its try — so without the guard this one escaped into VS
    // Code's message callback rather than failing closed.
    const { host, view, calls, offer, dispose } = await formWithOffer();
    expect(() =>
      host.handleMessage(view, {
        ...REQ,
        provision: { offerId: offer.offerId, itemIds: null },
      } as unknown as Parameters<typeof host.handleMessage>[1]),
    ).not.toThrow();
    await settle();

    expect(creates(calls)).toEqual([]);
    dispose();
  });

  it("creates NOTHING against an offer the store no longer holds", async () => {
    // D3, and the reason it is a refusal rather than a downgrade: honouring a
    // stale id would provision from a model the user has stopped looking at,
    // and creating the worktree WITHOUT its files would leave them a tree that
    // silently lacks what they asked for. Neither half happens.
    const { host, view, calls, offer, dispose } = await formWithOffer();
    host.handleMessage(view, {
      ...REQ,
      provision: { offerId: `${offer.offerId}-stale`, itemIds: offer.model.entries.map((e) => e.id) },
    });
    await settle();

    expect(creates(calls)).toEqual([]);
    dispose();
  });

  it("asks for no provisioning at all when the form sent no selection", async () => {
    const { host, view, calls, dispose } = await formWithOffer();
    host.handleMessage(view, REQ);
    await settle();

    expect(creates(calls)).toHaveLength(1);
    expect(creates(calls)[0]?.[1]).not.toHaveProperty("provision");
    dispose();
  });

  it("reports what provisioning did after the create's own outcome, to that surface only", async () => {
    // Ordering is the contract (D17): the user reads whether the worktree
    // exists before they read what was put in it. A second surface holds no
    // dialog this answers.
    const { host, view, dispose } = await builtHost();
    const other = surface();
    host.attach(other).setDisplayed(true);
    other.posts.length = 0;

    host.reportMutation({
      origin: view,
      message: CREATED,
      provisionResult: {
        type: "worktreeProvisionResult",
        worktreeId: "/trees/feat",
        steps: [{ id: "a", path: ".env", outcome: { kind: "copied" } }],
        ports: [],
      },
    });

    expect(
      (view.posts as ExtensionToWebViewMessage[])
        .filter((m) => m.type === "worktreeMutationResult" || m.type === "worktreeProvisionResult")
        .map((m) => m.type),
    ).toEqual(["worktreeMutationResult", "worktreeProvisionResult"]);
    expect((other.posts as ExtensionToWebViewMessage[]).filter((m) => m.type === "worktreeProvisionResult")).toEqual(
      [],
    );
    dispose();
  });

  it("posts no provisioning result for a create that provisioned nothing", async () => {
    const { host, view, dispose } = await builtHost();
    host.reportMutation({ origin: view, message: CREATED });

    expect((view.posts as ExtensionToWebViewMessage[]).filter((m) => m.type === "worktreeProvisionResult")).toEqual([]);
    dispose();
  });
});
