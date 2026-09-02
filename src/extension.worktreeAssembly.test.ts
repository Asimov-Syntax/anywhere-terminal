// @vitest-environment jsdom
// src/extension.worktreeAssembly.test.ts — one walk down the REAL assembly.
//
// Round 3 rejected this change with eight blockers on a tree carrying 4157
// passing unit tests, every task mutation-checked. Not one of the eight was a
// logic error inside a module: Create was unreachable because the menu never
// rendered an item for the callback the controller supplied, the prune count
// the menu gates on was never sent, the exclude entry was written as a literal
// path where git wanted a pattern. Every module was right and the assembly was
// wrong, and no per-module test could ever have seen it.
//
// So this test owns exactly one claim, and it is a composition claim: starting
// from a menu item the user can actually see, each mutating verb reaches git
// with the argv it should. Only the process boundary is faked — the git runner.
// The webview, the router, the host, the coordinator and the capability wiring
// in `activate` are all the shipped ones.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentHookRuntime } from "./agentHooks/AgentHookRuntime";
import type { WorktreeHost, WorktreeSurface } from "./providers/WorktreeHost";
import { type PaneEvidenceStore, TURN_FRESHNESS_MS } from "./session/PaneEvidenceStore";
import type {
  ExtensionToWebViewMessage,
  WebViewToExtensionMessage,
  WorktreeProvisionResultMessage,
} from "./types/messages";
import type { VaultSessionEntry } from "./vault/types";
import type { CreateSessionOptions } from "./vault/VaultLauncher";
import { createMessageRouter, type MessageHandlers } from "./webview/messaging/MessageRouter";
import { WorktreeController } from "./webview/worktree/WorktreeController";
import { agentRow } from "./webview/worktree/worktreeFixtures";
import { type WorktreeDelegatedHandlers, worktreeDelegatedHandlers } from "./webview/worktree/worktreeMessageHandlers";
import type { WorktreeAgentRow, WorktreePresence } from "./webview/worktree/worktreeViewTypes";
import { MAX_PULL_REQUESTS } from "./worktree/repoPullRequests";
import { MAX_REFS } from "./worktree/repoRefs";

// A REAL directory: the create-path probe asks the filesystem, and a fake root
// nothing could ever occupy makes that probe untestable (round-4 B12).
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asm-assembly-")));
const REPO = path.join(TMP, "repo");
const REPO_ID = path.join(REPO, ".git");
const LINKED = path.join(TMP, "repo-wt", "feature");
fs.mkdirSync(REPO, { recursive: true });
fs.mkdirSync(LINKED, { recursive: true });

/** Every git invocation the whole assembly made, in order. */
let argv: { args: string[]; cwd: string; timeoutMs?: number }[] = [];

/** What this fake repository currently has registered. `worktree remove` drops from it. */
let registered: string[] = [];

/** Set by a test that needs the linked worktree to render as locked. */
let lockedRow = false;
/**
 * The commit the linked registration reports.
 *
 * Mutable so a walk can model a genuine remove-and-recreate at ONE path: the
 * registration leaves the listing and a new one appears there on a different
 * commit. Round-2 B5 established that `head:branch` REPEATS when a worktree is
 * recreated onto the same commit, so a walk that needs the two generations to
 * be distinguishable at all has to move the commit.
 */
let featHead = "2".repeat(40);
/** Set by a test that needs git to report a stale registration.  */
let prunableRow = false;
/** Set by a test that needs the repository's listing to stop being readable. */
let listingFails = false;
/** Set by a test that needs the worktree to carry something a confirmation must name. */
let dirtyPaths: string[] = [];
/** Set by a test that needs git to be killed part-way through a removal. */
let removeTimesOut = false;
/**
 * Set by a test that needs the repositories here WATCHED.
 *
 * Off by default, and deliberately: the walks below rely on every repository
 * being unwatched, which is what the removal-refusal note records. A test that
 * needs a rebuild to be PENDING rather than absent turns it on, and then owns
 * when — or whether — that rebuild is delivered.
 */
let watchRepos = false;
/** Every watcher the pool asked the mock for, with the events it never delivered. */
let watchers: { path: string; deliver: () => void }[] = [];
/**
 * Set by a test that needs git and the filesystem to DISAGREE after a removal.
 *
 * Round-2 B7: this used to skip the whole simulated mutation, leaving BOTH the registration
 * and the directory in place — only the exit code disagreed with the post-state, which is
 * not what I15's second clause is about. It now moves exactly one source: the directory
 * goes, the registration stays, so the listing and the filesystem genuinely differ.
 */
let removeLeavesRegistration = false;

/** Every envelope the host posted to the surface, and every message the webview sent back. */
let posted: ExtensionToWebViewMessage[] = [];
let outbound: WebViewToExtensionMessage[] = [];

function listing(): string {
  const record = (path: string, head: string, branch: string, extra: string[] = []): string[] => [
    `worktree ${path}`,
    `HEAD ${head}`,
    `branch refs/heads/${branch}`,
    ...extra,
    "",
  ];
  return [
    ...record(REPO, "1".repeat(40), "main"),
    ...registered.flatMap((p) =>
      record(p, featHead, "feature", [
        ...(lockedRow ? ["locked"] : []),
        ...(prunableRow ? ["prunable gitdir file points to non-existent location"] : []),
      ]),
    ),
    "",
  ].join("\n");
}

/**
 * The only fake. Keyed by `<cwd>|<args>` so an unscripted command is a visible
 * failure rather than a silent empty answer.
 */
const SCRIPT: Record<string, { code?: number; stdout?: string; stderr?: string }> = {
  [`${process.cwd()}|--version`]: { stdout: "git version 2.45.0\n" },
  [`${REPO}|rev-parse --show-toplevel`]: { stdout: `${REPO}\n` },
  [`${REPO}|rev-parse --path-format=absolute --git-common-dir`]: { stdout: `${REPO_ID}\n` },
  // 129 is how a git without `-z` support answers (gitCapabilities D7), so the
  // shipped fallback to the newline form is the path this test walks.
  [`${REPO}|worktree list --porcelain -z`]: { code: 129, stderr: "usage: git worktree list" },
  // Filled per test from `registered` — a removal really does drop the row, so
  // the outcome is `ok` rather than the indeterminate a static listing forces.
  [`${REPO}|worktree list --porcelain`]: { stdout: "" },
  // Clean by default: nothing at risk, so an unforced removal is not blocked.
  // `dirtyPaths` overrides it for the tests that need a blocker set to exist.
  [`${LINKED}|status --porcelain`]: { stdout: "" },
  // No ignored material either. Left unanswered the walk is `unproven`, and an
  // unproven walk is a confirmable blocker — correctly, since a removal that
  // cannot say what it will delete should be confirmed — which would stop every
  // unforced removal here before it reached git.
  [`${LINKED}|ls-files --others --ignored --exclude-standard -z`]: { stdout: "" },
  [`${REPO}|worktree prune --dry-run --verbose`]: { stderr: "" },
  // The repository's local branches, for the create dialog's combobox. `feature`
  // is the one the linked worktree has checked out, so the list the form
  // receives has to mark it held — derived from the listing, never read here.
  [`${REPO}|for-each-ref --format=%(refname:short) --count=${MAX_REFS + 1} refs/heads/`]: {
    stdout: "main\nfeature\nidle\n",
  },
  // § 2.3 condition 3: the branch's tip, and the directory's own HEAD. They
  // agree here, which is what makes the repair offerable at all.
  [`${REPO}|rev-parse refs/heads/feature`]: { stdout: `${"2".repeat(40)}\n` },
  [`${LINKED}|rev-parse HEAD`]: { stdout: `${"2".repeat(40)}\n` },
  [`${REPO}|worktree repair ${LINKED}`]: { stdout: "" },
  // The forge, through the same faked factory: `createGitCommandRunner` is
  // mocked without regard to its executable, so the `gh` runner the entry point
  // builds lands here too.
  [`${REPO}|pr list --state=open --json=number,title,headRefName,baseRefName,isCrossRepository,headRepositoryOwner --limit=${MAX_PULL_REQUESTS + 1}`]:
    {
      stdout: JSON.stringify([
        {
          number: 42,
          title: "Add search",
          headRefName: "feat-search",
          baseRefName: "main",
          isCrossRepository: false,
          headRepositoryOwner: { login: "acme" },
        },
      ]),
    },
};

vi.mock("./worktree/gitCommandRunner", async (importOriginal) => {
  const real = await importOriginal<typeof import("./worktree/gitCommandRunner")>();
  return {
    ...real,
    createGitCommandRunner: () => ({
      run: async (args: readonly string[], cwd: string, runOptions?: { timeoutMs?: number }) => {
        argv.push({ args: [...args], cwd, timeoutMs: runOptions?.timeoutMs });
        if (args[0] === "worktree" && args[1] === "repair") {
          // Real `worktree repair` rewrites the two-way link, and the listing
          // stops reporting the registration as stale. A fake that left the
          // flag up would make § 2.3 condition 4 unobservable either way.
          prunableRow = false;
        }
        if (args[0] === "worktree" && args[1] === "remove") {
          // Real git drops the registration AND the directory; the host reads
          // both independently, so a fake that moved only one would leave every
          // removal indeterminate.
          const target = args[args.length - 1] ?? "";
          if (!removeLeavesRegistration) {
            registered = registered.filter((p) => p !== target);
          }
          fs.rmSync(target, { recursive: true, force: true });
        }
        const key = `${cwd}|${args.join(" ")}`;
        if (listingFails && args[0] === "worktree" && args[1] === "list") {
          return {
            code: 128,
            stdout: Buffer.from(""),
            stderr: "fatal: could not read the index",
            timedOut: false,
            failedToSpawn: false,
          };
        }
        const scripted = SCRIPT[key] ?? {};
        if (removeTimesOut && args[0] === "worktree" && args[1] === "remove") {
          // A git killed part-way: no exit status to read, and the state it had
          // already moved stays moved. This is the shape I15 exists for.
          return {
            code: -1,
            stdout: Buffer.from(""),
            stderr: "",
            timedOut: true,
            failedToSpawn: false,
          };
        }
        let stdout = key === `${REPO}|worktree list --porcelain` ? listing() : (scripted.stdout ?? "");
        if (key === `${LINKED}|status --porcelain` && dirtyPaths.length > 0) {
          stdout = dirtyPaths.map((p) => ` M ${p}\n`).join("");
        }
        // The dry run has to agree with what the listing flagged, or the
        // service refuses the confirmed count — as it should.
        const stderr =
          key === `${REPO}|worktree prune --dry-run --verbose` && prunableRow
            ? "Removing worktrees/feature: gitdir file points to non-existent location\n"
            : (scripted.stderr ?? "");
        return {
          code: scripted.code ?? 0,
          stdout: Buffer.from(stdout),
          stderr,
          timedOut: false,
          failedToSpawn: false,
        };
      },
    }),
  };
});

const captured: {
  host?: WorktreeHost;
  runtime?: AgentHookRuntime;
  paneEvidence?: PaneEvidenceStore;
  /** The real projector's own answer, before the resume-walk row is merged into it. */
  projection?: WorktreePresence;
} = {};

/**
 * The real runtime and the real pane store, captured on the way past.
 *
 * Neither is replaced: a hook turn reaching a row is a claim about the callback
 * `activate` installs between them, and a stub on either side would assert the
 * stub instead. The loopback socket is a process boundary, so the post below is
 * a real one.
 */
vi.mock("./agentHooks/AgentHookRuntime", async (importOriginal) => {
  const real = await importOriginal<typeof import("./agentHooks/AgentHookRuntime")>();
  return {
    ...real,
    createAgentHookRuntime: async (...args: Parameters<typeof real.createAgentHookRuntime>) => {
      captured.runtime = await real.createAgentHookRuntime(...args);
      return captured.runtime;
    },
  };
});

vi.mock("./session/PaneEvidenceStore", async (importOriginal) => {
  const real = await importOriginal<typeof import("./session/PaneEvidenceStore")>();
  return {
    ...real,
    createPaneEvidenceStore: (options: never) => {
      captured.paneEvidence = real.createPaneEvidenceStore(options);
      return captured.paneEvidence;
    },
  };
});

/** Session options the surface was handed, i.e. what a launch actually became. */
let launched: CreateSessionOptions[] = [];

/** An agent row to publish under the linked worktree, for the resume walk. */
let publishedRow: WorktreeAgentRow | null = null;

/** Set by the test that needs the host to report nothing able to start a session. */
let noStartableAgents = false;

/**
 * The presence projection is built from THIS window's pane evidence, and the
 * assembly has no panes — so the one row a resume needs is merged into the real
 * projector's answer rather than replacing it.
 */
vi.mock("./worktree/presenceProjector", async (importOriginal) => {
  const real = await importOriginal<typeof import("./worktree/presenceProjector")>();
  return {
    ...real,
    createPresenceProjector: (deps: never) => {
      const inner = real.createPresenceProjector(deps);
      return {
        rank: (id: string) => inner.rank(id),
        rankRevision: () => inner.rankRevision(),
        // Delegated, not stubbed: the removal path reads this to avoid counting
        // a pane's own session twice, and a stub returning nothing would make
        // this test agree with a production bug rather than catch it.
        claimedSessionIds: () => inner.claimedSessionIds(),
        forgetDrawOrder: () => inner.forgetDrawOrder(),
        project: async (ids: readonly string[], options?: never) => {
          const base = await inner.project(ids, options);
          // Captured here because the host→webview contract drops the fields I6 and I7
          // are about: `finishedAt` and `activitySource` never reach a webview message,
          // so the DOM cannot answer either question (round-4 B13).
          captured.projection = base;
          if (publishedRow === null) {
            return base;
          }
          return { ...base, rowsByWorktreeId: { ...base.rowsByWorktreeId, [LINKED]: [publishedRow] } };
        },
      };
    },
  };
});

/**
 * The vault's on-disk stores are the same kind of boundary as the git binary:
 * faked here so a resume resolves deterministically, while the argv it produces
 * is still the real LaunchBuilder's.
 */
vi.mock("./vault/VaultService", async (importOriginal) => {
  const real = await importOriginal<typeof import("./vault/VaultService")>();
  class AssemblyVaultService extends real.VaultService {
    async getLaunchTarget(entryId: string) {
      if (entryId !== STORED_ENTRY.id) {
        return null;
      }
      return { entry: STORED_ENTRY, verify: async () => true };
    }
  }
  return { ...real, VaultService: AssemblyVaultService };
});

/**
 * Which agents this machine has installed is a `which`-style probe — the same
 * kind of boundary as git — so the host's admission answer is fixed here rather
 * than left to whatever the developer happens to have on PATH.
 */
vi.mock("./vault/registry", async (importOriginal) => {
  const real = await importOriginal<typeof import("./vault/registry")>();
  return {
    ...real,
    detectLaunchTargets: async () => (noStartableAgents ? [] : STARTABLE_TARGETS),
  };
});

const STARTABLE_TARGETS = [
  { agent: "claude" as const, displayName: "Claude Code", permissionChoices: [], canSeedPrompt: true },
];

/** The one stored session the faked vault knows about. */
const STORED_ENTRY: VaultSessionEntry = {
  id: "claude:sess-1",
  agent: "claude",
  sessionId: "sess-1",
  title: "worktree walk",
  // Deliberately NOT the worktree: a resume-here must override this.
  cwd: REPO,
  modified: 1,
  flags: {},
  canFork: true,
  canResume: true,
};

/** One entry per call of the session registry reader, so a second scan is visible. */
const registryReads: number[] = [];
const authorizedPaths: string[] = [];
let provisioningAuthorizationStable = true;

vi.mock("./utils/authorizedDirectory", async (importOriginal) => {
  const real = await importOriginal<typeof import("./utils/authorizedDirectory")>();
  return {
    ...real,
    authorizeDirectory: async (...args: Parameters<typeof real.authorizeDirectory>) => {
      authorizedPaths.push(args[0]);
      return real.authorizeDirectory(...args);
    },
    directoryStillAuthorized: (...args: Parameters<typeof real.directoryStillAuthorized>) =>
      provisioningAuthorizationStable ? real.directoryStillAuthorized(...args) : Promise.resolve(false),
  };
});

vi.mock("./vault/readers/runningSessions", async (importOriginal) => {
  const real = await importOriginal<typeof import("./vault/readers/runningSessions")>();
  return {
    ...real,
    listClaudeSessionRecords: (...args: Parameters<typeof real.listClaudeSessionRecords>) => {
      registryReads.push(1);
      return real.listClaudeSessionRecords(...args);
    },
  };
});

vi.mock("./providers/WorktreeHost", async (importOriginal) => {
  const real = await importOriginal<typeof import("./providers/WorktreeHost")>();
  return {
    ...real,
    createWorktreeHost: (options: never) => {
      captured.host = real.createWorktreeHost(options);
      return captured.host;
    },
  };
});

/**
 * Everything `activate` registered, so it can be torn down again.
 *
 * Round-4 W4: this file called `assemble()` once per case and disposed nothing, so each
 * test left an AgentHookRuntime — and its loopback HTTP server — open for the rest of the
 * run. Suites that leak listeners fail by suite ORDER, which is the shape of the
 * PTY_LOAD_FAILED instability recorded against this file.
 */
let subscriptions: Array<{ dispose(): unknown }> = [];

/**
 * The shipped `deactivate`, captured from the SAME module instance that supplied `activate`.
 *
 * `beforeEach` calls `vi.resetModules()`, so importing it here would yield a different instance
 * holding a different `_activeAgentHookController` — teardown would then run against nothing.
 */
let teardown: (() => Promise<void> | void) | undefined;

afterEach(async () => {
  const failures: unknown[] = [];
  try {
    // Round-5 W4: this reached past the controller and disposed the runtime directly, so
    // everything deactivate does BESIDES that — detaching the contributor before disabling —
    // was never exercised, and a regression in it could not fail here.
    await teardown?.();
  } catch (err) {
    failures.push(err);
  } finally {
    // Round-6 W6: a throwing deactivate used to skip the loop below and leave `teardown` set,
    // so the case that DETECTED a lifecycle regression was also the case that leaked past it
    // into every test after — and left a stale teardown to run against the next module.
    teardown = undefined;
    for (const subscription of subscriptions.splice(0)) {
      try {
        subscription.dispose();
      } catch (err) {
        failures.push(err);
      }
    }
  }
  // Swallowing these hid exactly the leak this teardown exists to close.
  expect(failures, "deactivate or a registered disposable threw on teardown").toEqual([]);
});

beforeEach(() => {
  argv = [];
  launched = [];
  publishedRow = null;
  authorizedPaths.length = 0;
  provisioningAuthorizationStable = true;
  noStartableAgents = false;
  lockedRow = false;
  prunableRow = false;
  listingFails = false;
  dirtyPaths = [];
  removeTimesOut = false;
  removeLeavesRegistration = false;
  watchRepos = false;
  watchers = [];
  posted = [];
  outbound = [];
  registered = [LINKED];
  featHead = "2".repeat(40);
  fs.mkdirSync(LINKED, { recursive: true });
  captured.host = undefined;
  captured.runtime = undefined;
  captured.paneEvidence = undefined;
  captured.projection = undefined;
  document.body.replaceChildren();
  vi.resetModules();
});

/**
 * The shipped extension, the shipped host, and a real webview controller wired
 * to each other exactly as production wires them: the controller's outbound
 * messages enter `host.handleMessage(surface, msg)`, and everything the host
 * posts back to that surface goes through the real `routeExtensionMessage`.
 */
async function assemble(): Promise<{ controller: WorktreeController; host: WorktreeHost; surface: WorktreeSurface }> {
  const { activate, deactivate } = await import("./extension");
  subscriptions = [];
  teardown = deactivate;
  const vscode = await import("./test/__mocks__/vscode");
  vscode.__resetAll();
  vscode.__setWorkspaceFolders([{ uri: { fsPath: REPO } }]);
  (vscode.extensions as { onDidChange?: unknown }).onDidChange = () => ({ dispose: () => {} });
  if (watchRepos) {
    // The pool's own fallback is `vscode.workspace.createFileSystemWatcher`, and
    // this mock has none — which is why `tryCreateWatcher` catches and every
    // repository here is unwatched. Installed on the mock object rather than in
    // it: the fake belongs to the one walk that needs a rebuild it can withhold.
    (vscode.workspace as Record<string, unknown>).createFileSystemWatcher = (pattern: {
      baseUri?: { fsPath?: string };
    }) => {
      const created: (() => void)[] = [];
      const deleted: (() => void)[] = [];
      const on = (into: (() => void)[]) => (cb: () => void) => {
        into.push(cb);
        return { dispose: () => {} };
      };
      watchers.push({
        path: pattern.baseUri?.fsPath ?? "",
        deliver: () => {
          for (const cb of [...created, ...deleted]) {
            cb();
          }
        },
      });
      return {
        onDidCreate: on(created),
        onDidChange: on([]),
        onDidDelete: on(deleted),
        dispose: () => {},
      };
    };
  }
  const win = vscode.window as Record<string, unknown>;
  win.state ??= { focused: true, active: true };
  win.onDidChangeWindowState ??= () => ({ dispose: () => {} });
  win.tabGroups ??= { all: [], onDidChangeTabs: () => ({ dispose: () => {} }) };

  await activate({
    extensionUri: { fsPath: "/mock/extension" },
    subscriptions,
    globalState: { get: () => undefined, update: async () => {}, keys: () => [] },
    workspaceState: { get: () => undefined, update: async () => {}, keys: () => [] },
    globalStorageUri: { fsPath: "/mock/storage" },
    storageUri: { fsPath: "/mock/workspace-storage" },
    extensionPath: "/mock/extension",
    logUri: { fsPath: "/mock/log" },
    secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
    environmentVariableCollection: { replace: () => {}, append: () => {}, prepend: () => {}, clear: () => {} },
  } as never);

  const host = captured.host;
  if (host === undefined) {
    throw new Error("activate did not build a worktree host");
  }

  let controller: WorktreeController | undefined;
  // PRODUCTION's own route table, not a copy of it (round-1 W4). A hand-mirrored
  // set is what let `onWorktreePullRequests` exist here while main.ts had no
  // route for it, so this walk stayed green over a feature that shipped dark.
  // Deleting a route from the shared table now fails this file.
  //
  // The two written out below are the two main.ts genuinely writes itself: the
  // tree response goes through the tab-bar scope seam there, and the launch
  // targets reply is routed by the capability it echoes — the vault panel gets
  // `continue`, the worktree controller gets `start`.
  const worktreeHandlers: WorktreeDelegatedHandlers &
    Pick<MessageHandlers, "onWorktreeTreeResponse" | "onVaultLaunchTargets"> = {
    ...worktreeDelegatedHandlers(() => controller),
    onWorktreeTreeResponse: (m) => controller?.handleTreeResponse(m),
    onVaultLaunchTargets: (m) => controller?.handleLaunchTargets(m),
  };
  const route = createMessageRouter(worktreeHandlers as MessageHandlers);
  const surface: WorktreeSurface = {
    isReady: () => true,
    post: (msg: ExtensionToWebViewMessage) => {
      posted.push(msg);
      return route(msg);
    },
    // The provider's half of a launch, recorded rather than opened: a pane needs
    // a webview, and what this walk is about is WHAT would run and WHERE.
    launchAgent: async (options: CreateSessionOptions) => {
      launched.push(options);
    },
  };

  const state: Record<string, unknown> = {};
  controller = WorktreeController.mount({
    host: document.body,
    postMessage: (msg: WebViewToExtensionMessage) => {
      outbound.push(msg);
      // The provider owns this one, not the host: answered here with a fixed set
      // so the walk does not depend on which agents this machine has installed.
      if (msg.type === "requestVaultLaunchTargets") {
        // The provider routes the START capability to the host, which answers and
        // remembers what it answered — the same set its admission door reads.
        if (msg.capability === "start") {
          void host.publishLaunchTargets(surface);
          return;
        }
        route({ type: "vaultLaunchTargets", capability: "continue", targets: STARTABLE_TARGETS });
        return;
      }
      void host.handleMessage(surface, msg as never);
    },
    store: {
      getState: () => state as never,
      updateState: (patch) => Object.assign(state, patch),
    },
    init: { workspaceRoot: REPO, rowActivation: "focus" },
    now: () => 1_000_000,
  });
  document.body.appendChild(controller.element);
  // Both halves of what a live surface declares: the provider says the view is
  // displayed, the webview says it is visible. The host pushes to neither alone.
  host.attach(surface).setDisplayed(true);
  controller.setVisible(true);
  await settleUntil(
    () => document.querySelectorAll('[role="treeitem"]').length > 0,
    "the first worktree tree push to render a row",
  );
  return { controller, host, surface };
}

/** Let the host's rebuild, its git calls and the resulting push all land. */
/**
 * Make the linked worktree look like one git could repair: a `.git` FILE whose
 * `gitdir:` names an administrative directory that exists. Without both, the
 * probe answers adopt or declines, and the repair is correctly never offered.
 */
function linkTheWorktree(): void {
  const admin = path.join(REPO_ID, "worktrees", "feature");
  fs.mkdirSync(admin, { recursive: true });
  fs.writeFileSync(path.join(LINKED, ".git"), `gitdir: ${admin}\n`);
}

async function settle(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

/**
 * Pump until `ready` holds, then stop. A fixed pump count assumes how many event-loop
 * turns the host's rebuild costs; under full-suite load it costs more, and the walk then
 * reads a tree that has not been painted yet — which surfaced as `openMenu` reporting zero
 * rendered rows, intermittently and only in a full run. Waiting on the condition drops the
 * assumption without waiting any longer than it has to, and says what it waited for when
 * the condition genuinely never arrives.
 */
async function settleUntil(ready: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (ready()) {
      return;
    }
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Open the row's context menu the way a user does, and return its items. */
function openMenu(rowText: string): HTMLElement[] {
  const rows = [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')];
  const row = rows.find((r) => (r.textContent ?? "").includes(rowText));
  if (row === undefined) {
    throw new Error(`no rendered row matching ${rowText} — rows: ${rows.map((r) => r.textContent).join(" | ")}`);
  }
  row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  const items = [...document.querySelectorAll<HTMLElement>(".vault-context-menu [role='menuitem']")];
  if (items.length === 0) {
    throw new Error("the context menu rendered no items");
  }
  return items;
}

/** Open a worktree card so the agent rows it holds collapsed are on screen. */
function expandCard(rowText: string): void {
  const card = [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')].find((r) =>
    (r.textContent ?? "").includes(rowText),
  );
  if (card === undefined) {
    throw new Error(`no rendered card matching ${rowText}`);
  }
  card.click();
}

/** Click a menu item by its visible label. Absence IS the failure. */
function clickItem(items: HTMLElement[], label: RegExp): void {
  const item = items.find((i) => label.test(i.textContent ?? ""));
  if (item === undefined) {
    throw new Error(`no menu item matching ${label} — offered: ${items.map((i) => i.textContent).join(" | ")}`);
  }
  item.click();
}

/**
 * Answer the removal report the menu now opens (design.md D6).
 *
 * The menu item ASKS what the removal would cost; nothing is deleted until this
 * confirms. Types the branch name first where the report earned a typed
 * confirmation, so one helper covers both controls.
 */
function confirmRemoval(branch: string): void {
  const field = document.querySelector<HTMLInputElement>('[role="dialog"] #wt-confirm-name');
  if (field !== null) {
    field.value = branch;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const confirm = document.querySelector<HTMLButtonElement>('[role="dialog"] button.wt-btn--danger');
  if (confirm === null) {
    throw new Error(
      `the removal report offered no confirmation — dialog: ${document.querySelector('[role="dialog"]')?.textContent ?? "none"}`,
    );
  }
  confirm.click();
}

function gitCalls(verb: string): string[][] {
  return argv.filter((c) => c.args[0] === "worktree" && c.args[1] === verb).map((c) => c.args);
}

describe("a mutating verb reaches git from the menu item a user can see", () => {
  it("renders the linked worktree the shipped discovery found", async () => {
    await assemble();
    expect(document.body.textContent).toContain("feature");
  });

  it("bounds the ignored walk at the process, not only in the module that computes the bound", async () => {
    // Cycle-2 B4. The production wrapper was `(args, cwd) => runner.run(args, cwd)`
    // — a two-parameter arrow that silently DROPPED the third, so every deadline
    // the walk computed was discarded here while the module's own unit test,
    // which asserts against its own injected fake, stayed green. This is the
    // boundary the bound has to survive, so this is where it is asserted.
    await assemble();
    clickItem(openMenu("feature"), /remove/i);
    await settle();

    const listing = argv.find((c) => c.args[0] === "ls-files");
    expect(listing, "the removal never asked for the ignored listing").toBeDefined();
    expect(listing?.timeoutMs).toBeGreaterThan(0);
  });

  it("removes: menu item → webview message → host → coordinator → git argv", async () => {
    await assemble();
    clickItem(openMenu("feature"), /remove/i);
    await settle();
    // The menu click removes nothing: it asks, and the report is what the user
    // answers (design.md D6). A removal here would be round-3 B1 back.
    expect(gitCalls("remove")).toEqual([]);
    confirmRemoval("feature");
    await settle();
    // The unforced removal the confirmation posts, carried all the way down. A
    // `--force` here would mean the assessment was skipped.
    expect(gitCalls("remove")).toEqual([["worktree", "remove", LINKED]]);
  });

  it("[2_5] reports what a clean removal would cost, and removes only once that is answered", async () => {
    // The whole of round-3 B1, walked through the shipped wiring: a worktree with
    // nothing wrong with it used to be deleted from the first menu click, because
    // the only path that produced a report was the one that had already attempted
    // the deletion. The report now comes from a message that acts on nothing.
    await assemble();

    clickItem(openMenu("feature"), /remove/i);
    await settle();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog, "the menu click opened no report").not.toBeNull();
    // A report, not a bare "are you sure": every check the host evaluated is named.
    expect([...(dialog?.querySelectorAll("[data-check]") ?? [])].length).toBeGreaterThan(0);
    expect(gitCalls("remove"), "git ran before the user had answered anything").toEqual([]);

    // Nothing at risk, so the host issued no fingerprint and the ordinary control
    // is what is offered — a typed confirmation here would mean force authority
    // was minted for a healthy worktree (design.md D7).
    expect(dialog?.querySelector("#wt-confirm-name")).toBeNull();
    confirmRemoval("feature");
    await settle();

    expect(gitCalls("remove")).toEqual([["worktree", "remove", LINKED]]);
  });

  it("[2_5] makes the typed confirmation the thing that authorizes a forced removal", async () => {
    dirtyPaths = ["a.txt"];
    await assemble();

    clickItem(openMenu("feature"), /remove/i);
    await settle();

    const confirm = document.querySelector<HTMLButtonElement>('[role="dialog"] button.wt-btn--danger');
    expect(confirm?.textContent).toBe("Force remove");
    // Clicking before typing is not an authorization, and the assertion is on
    // git rather than on `disabled`: a control that looks locked and still fires
    // is the failure worth catching.
    confirm?.click();
    await settle();
    expect(gitCalls("remove"), "the destructive button authorized before the name was typed").toEqual([]);

    confirmRemoval("feature");
    await settle();

    expect(gitCalls("remove")).toEqual([["worktree", "remove", "--force", LINKED]]);
  });

  it("runs no removal command once the repository stops being observed (round-9 W9)", async () => {
    // The binding-level tests prove `assessRemoval` refuses. What they cannot
    // see is whether the shipped mutation service honours that refusal — this
    // change's own round-3 finding was that module tests miss the wiring.
    //
    // Note also what the PASSING removal above proves: this assembly's vscode
    // mock has no `createFileSystemWatcher`, so every repository here is
    // unwatched — an unwatched repository is not refused a removal (D11).
    const { host } = await assemble();
    listingFails = true;
    await host.mutationBindings().forceRebuild(REPO_ID);
    await settle();

    clickItem(openMenu("feature"), /remove/i);
    await settle();

    expect(gitCalls("remove")).toEqual([]);
  });

  it("[3_4] removes the replacement the barrier resolved, never the predecessor the cache held", async () => {
    // Round-4 B3, through the shipped wiring, end to end. The assess used to
    // read straight from the cache, so with a watcher rebuild still pending it
    // described the predecessor while reading the replacement's evidence — and
    // minted force authority over it. Taking the coordinator's barrier is what
    // makes the registration the report describes the one the confirmation acts
    // on (D10).
    //
    // Round-6 S2: this walk previously modelled the "replacement" by flipping
    // one lock bit, never delivered the watcher event it held, and stopped at
    // the dialog. It now removes and recreates a registration at one path on a
    // different commit, delivers the rebuild, and confirms — so the title is
    // something the walk earns rather than something it asserts.
    watchRepos = true;
    await assemble();

    // The setup has to have landed, or every assertion below is about a walk
    // that never happened: the predecessor is registered and rendered, the
    // repository is genuinely watched, and nothing has rebuilt since.
    expect(document.body.textContent).toContain("feature");
    expect(watchers.length, "no watcher was created, so no rebuild could be pending").toBeGreaterThan(0);
    const listings = (): number => argv.filter((c) => c.args[0] === "worktree" && c.args[1] === "list").length;
    const before = listings();

    // The replacement, as git would report it: the registration LEAVES and one
    // appears at the same path on a different commit, carrying a lock the
    // predecessor did not. Its watcher event is deliberately withheld for now —
    // `watchers[0].deliver()` is the rebuild this walk controls.
    registered = registered.filter((p) => p !== LINKED);
    expect(registered, "the predecessor never left, so there is only one generation").toEqual([]);
    featHead = "3".repeat(40);
    lockedRow = true;
    registered = [LINKED];
    await settle();
    expect(listings(), "a rebuild landed before the click, so nothing was stale").toBe(before);

    clickItem(openMenu("feature"), /remove/i);
    await settle();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog, "the menu click opened no report at all").not.toBeNull();
    // Read from the replacement: the lock is named, the control is the typed
    // one, and a fingerprint was therefore issued. Against the cached
    // predecessor this report is clean and confirms with a plain Remove.
    expect(
      dialog?.querySelector("#wt-confirm-name"),
      "the report was built from the cached registration",
    ).not.toBeNull();
    expect(dialog?.textContent ?? "").toMatch(/lock/i);
    expect(gitCalls("remove"), "git ran before the user had answered anything").toEqual([]);

    // The withheld rebuild lands NOW, between the report and the answer — the
    // schedule the cache-reading version could never survive, and the one a
    // real watcher produces once the debounce expires.
    watchers[0]?.deliver();
    await settle();

    confirmRemoval("feature");
    await settle();

    // The confirmation reached git, and reached it for the replacement: the
    // report was issued against generation two and generation two is what the
    // removal names. A report built from the predecessor would either have
    // offered a plain confirmation above or had its authority refused here.
    const removals = gitCalls("remove");
    expect(removals, "the confirmation never reached git").toHaveLength(1);
    expect(removals[0]?.[removals[0].length - 1]).toBe(LINKED);
    expect(registered, "the registration git was told to drop is still listed").toEqual([]);
  });

  it("shows the removal's outcome, in the order the coordinator really produces", async () => {
    // The coordinator awaits its rebuild in a `finally`, so the tree WITHOUT the
    // row reaches this surface before the outcome does. Every earlier fix for
    // this was verified by a controller test that chose the opposite order
    // (round-4 B1) — here the order is production's, not the test's.
    await assemble();
    clickItem(openMenu("feature"), /remove/i);
    await settle();
    confirmRemoval("feature");
    await settle();
    expect(document.body.textContent).toContain("Remove done.");
    expect(document.body.textContent).toContain("feature");
  });

  it("locks, and then unlocks, from the same item", async () => {
    await assemble();
    clickItem(openMenu("feature"), /lock/i);
    await settle();
    expect(gitCalls("lock").map((a) => a.slice(0, 3))).toEqual([["worktree", "lock", LINKED]]);
  });

  it("unlocks a locked row from its own menu item", async () => {
    lockedRow = true;
    await assemble();
    clickItem(openMenu("feature"), /unlock/i);
    await settle();
    expect(gitCalls("unlock")).toEqual([["worktree", "unlock", LINKED]]);
  });

  it("submits the create form the menu opened, down to `worktree add`", async () => {
    await assemble();
    clickItem(openMenu("feature"), /new worktree/i);
    await settle();
    const branch = document.querySelector<HTMLInputElement>("#wt-branch");
    if (branch === null) {
      throw new Error("the create form has no branch field");
    }
    branch.value = "feat/login";
    branch.dispatchEvent(new Event("input", { bubbles: true }));
    branch.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();

    const create = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      /create worktree/i.test(b.textContent ?? ""),
    );
    if (create === undefined) {
      throw new Error("the create form has no submit button");
    }
    expect(create.disabled).toBe(false);
    create.click();
    await settle();

    const added = gitCalls("add");
    expect(added).toHaveLength(1);
    // The branch the user typed, and a destination the HOST resolved.
    expect(added[0]).toContain("feat/login");
    expect(added[0]?.some((a) => a.startsWith(TMP))).toBe(true);
  });

  it("prunes on a confirmed count, from the menu item the count unlocks", async () => {
    prunableRow = true;
    await assemble();
    clickItem(openMenu("feature"), /prune/i);
    await settle();
    // D13: the number is confirmed before the repository is touched.
    expect(gitCalls("prune")).toEqual([]);
    const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      /^Prune \d+$/.test(b.textContent ?? ""),
    );
    if (confirm === undefined) {
      throw new Error("no prune confirmation was offered");
    }
    confirm.click();
    await settle();
    expect(gitCalls("prune").some((a) => !a.includes("--dry-run"))).toBe(true);
  });

  it("offers Create, and the item opens a form the host has resolved a path for", async () => {
    await assemble();
    clickItem(openMenu("feature"), /new worktree/i);
    await settle();
    // B1: the callback existed and nothing rendered an item for it, so no test
    // that called the callback directly could see the action was unreachable.
    const dialog = document.querySelector(".wt-create-dialog, [role='dialog']");
    expect(dialog).not.toBeNull();
    // And the destination came from the host, not from a webview guess.
    const shown = [...(dialog?.querySelectorAll<HTMLInputElement>("input") ?? [])].map((i) => i.value);
    expect(shown.some((v) => v.startsWith("/"))).toBe(true);
  });

  it("proves the destination against the real filesystem, not only the registry", async () => {
    // B12 shipped twice: the host has probed `exists` since round 3 and nothing
    // in `activate` supplied it, so a directory nobody registered still read as
    // free. Only a walk through the shipped wiring can see that.
    const host = (await assemble()).host;
    const answers: { path: string; collidedWith?: string; branch?: string }[] = [];
    const probe: WorktreeSurface = {
      isReady: () => true,
      post: (m) => {
        if (m.type === "worktreeCreateDefaults") {
          answers.push({
            path: m.path,
            ...(m.collidedWith === undefined ? {} : { collidedWith: m.collidedWith }),
            ...(m.branch === undefined ? {} : { branch: m.branch }),
          });
        }
      },
    };
    host.attach(probe).setDisplayed(true);
    // One opening for the whole walk. This fixture named none at all until the
    // host began validating the field, and it passed only because an absent
    // opening compared equal to an unheld one — which is the defect round-1 B3
    // reported, visible here as a test that could not have failed.
    const OPENING = 1;
    const ask = async (branch?: string): Promise<{ path: string; collidedWith?: string; branch?: string }> => {
      answers.length = 0;
      host.handleMessage(probe, {
        type: "requestWorktreeCreateDefaults",
        repoId: REPO_ID,
        opening: OPENING,
        branch,
      } as never);
      await settle();
      const answer = answers[0];
      if (answer === undefined) {
        throw new Error("the host did not answer");
      }
      return answer;
    };

    // Self-calibrating: ask once to learn the path it would take, then OCCUPY
    // that path with a directory no worktree registers, and ask again.
    const first = await ask();
    expect(first.collidedWith).toBeUndefined();
    fs.mkdirSync(first.path, { recursive: true });
    const second = await ask();
    expect(second.path).not.toBe(first.path);
    // The taken NAME, so the form can state it beside a destination that
    // already carries the path (worktree-rpc.md § 2).
    expect(second.collidedWith).toBe(path.basename(first.path));

    // And the answer names the question, so a form can tell it from a stale one.
    expect((await ask("feat/login")).branch).toBe("feat/login");
  });

  it("starts an agent from the menu item, in the worktree that item was on", async () => {
    await assemble();
    clickItem(openMenu("feature"), /start an agent here/i);
    await settle();
    const prompt = document.querySelector<HTMLTextAreaElement>("#wt-prompt");
    if (prompt === null) {
      throw new Error("the launch dialog has no prompt field");
    }
    prompt.value = "read the failing test";
    prompt.dispatchEvent(new Event("input", { bubbles: true }));
    const start = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      /^Start agent/.test(b.textContent ?? ""),
    );
    if (start === undefined) {
      throw new Error("the launch dialog has no start button");
    }
    start.click();
    await settle();

    // The real registry template, the real builder: a positional prompt for
    // Claude, and the worktree the menu was opened on as the directory.
    expect(launched).toEqual([
      expect.objectContaining({
        shell: "claude",
        shellArgs: ["read the failing test"],
        cwd: LINKED,
        isAgentLaunch: true,
      }),
    ]);
  });

  it("refuses the assembled launch when the worktree is re-observed under the open dialog", async () => {
    // The whole assembly, against the boundary rounds 1-4 kept finding defects
    // at: the dialog renders one registration, something re-lists the repository
    // while the user is answering, and the submit must not be admitted against
    // whatever occupies that path now (design.md D10, round-4 B1/B5/B6).
    const { host } = await assemble();
    clickItem(openMenu("feature"), /start an agent here/i);
    await settle();
    // A forced re-list is what a git structural change, a refresh or a
    // concurrent mutation produces. It advances the registration token.
    await host.mutationBindings().forceRebuild(path.join(REPO, ".git"));
    await settle();
    const start = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      /^Start agent/.test(b.textContent ?? ""),
    );
    start?.click();
    await settle();
    expect(launched).toEqual([]);
  });

  it("offers no launch items at all when nothing on this host can start a session", async () => {
    noStartableAgents = true;
    await assemble();
    const labels = openMenu("feature").map((i) => i.textContent ?? "");
    expect(labels.some((l) => /start an agent here/i.test(l))).toBe(false);
  });

  it("launches the agent a create asked for, in the worktree the create just made", async () => {
    await assemble();
    clickItem(openMenu("feature"), /new worktree/i);
    await settle();
    const branch = document.querySelector<HTMLInputElement>("#wt-branch");
    const after = document.querySelector<HTMLSelectElement>("#wt-after");
    if (branch === null || after === null) {
      throw new Error("the create form is missing a field this walk needs");
    }
    branch.value = "feat/agent";
    branch.dispatchEvent(new Event("input", { bubbles: true }));
    // A settled edit, which is when the form asks the host — `input` alone is a
    // keystroke, and the resolution the submit gate waits for is asked for once
    // the edit stops (round-3 B6).
    branch.dispatchEvent(new Event("change", { bubbles: true }));
    after.value = "agent";
    after.dispatchEvent(new Event("change"));
    await settle();
    const create = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      /create worktree/i.test(b.textContent ?? ""),
    );
    create?.click();
    await settle();

    // Order matters: git first, and the launch only against the path it made.
    const added = gitCalls("add");
    expect(added).toHaveLength(1);
    const destination = added[0]?.find((a) => a.startsWith(TMP) && a.includes("agent"));
    expect(destination).toBeDefined();
    expect(launched).toEqual([expect.objectContaining({ shell: "claude", cwd: destination })]);
  });

  it("resumes a row's stored session in the worktree it is published under", async () => {
    // The entry records a DIFFERENT cwd; resume-here overrides it with the
    // worktree the row was published under, which is the whole action.
    publishedRow = {
      rowId: "row-1",
      scope: "window",
      agent: "claude",
      agentSource: "launch",
      activity: "idle",
      activitySource: "hook",
      title: "worktree walk",
      entryId: STORED_ENTRY.id,
    };
    await assemble();
    // The card holds its agents collapsed until it is opened, exactly as a user
    // must open it before the row is there to right-click.
    const card = [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')].find((r) =>
      (r.textContent ?? "").includes("feature"),
    );
    card?.click();
    await settle();
    clickItem(openMenu("worktree walk"), /resume session here/i);
    await settle();

    expect(launched).toEqual([
      expect.objectContaining({
        shell: "claude",
        shellArgs: expect.arrayContaining(["--resume", STORED_ENTRY.sessionId]),
        cwd: LINKED,
      }),
    ]);
  });

  it("does not offer Prune when git reports nothing prunable", async () => {
    await assemble();
    const labels = openMenu("feature").map((i) => i.textContent ?? "");
    // Absent, not disabled: an offered prune that drops nothing is a claim the
    // repository has stale registrations (worktree-actions.md § 3.5).
    expect(labels.some((l) => /prune/i.test(l))).toBe(false);
  });
});

// ─── WT-006.3 — a hook turn reaching the pane it describes ──────────

describe("a Claude turn reaches the pane's evidence through the real assembly", () => {
  /** Mint coordinates for a pane the store knows, then post as the wrapper does. */
  async function reportingPane(paneId = "pane-1") {
    await assemble();
    await settle();
    const runtime = captured.runtime;
    const store = captured.paneEvidence;
    if (runtime === undefined || store === undefined) {
      throw new Error("activate built no hook runtime or no pane store");
    }
    runtime.setAgentEnabled("claude", true);
    store.create(paneId);
    const env = runtime.create(paneId);
    const url = env.ANYWHERE_TERMINAL_CLAUDE_URL;
    if (url === undefined) {
      throw new Error("no claude coordinates were minted");
    }
    return {
      store,
      runtime,
      paneId,
      post: (body: unknown) =>
        fetch(`${url}/claude`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
    };
  }

  it("carries a published turn onto the pane the report names", async () => {
    const h = await reportingPane();

    await h.post({ hook_event_name: "UserPromptSubmit", session_id: "sess-1", prompt: "go" });

    expect(h.store.read(h.paneId)?.turn?.report).toMatchObject({ state: "working", agentSessionId: "sess-1" });
  });

  // Round-5 W4: teardown used to dispose the captured runtime directly, which closed the
  // socket without ever running production deactivation. That made the leak invisible AND
  // the fix unfalsifiable — the endpoint closed either way. This asserts the shipped path.
  it("closes the hook endpoint on deactivate, so a reload leaves no listener behind", async () => {
    const h = await reportingPane();
    const open = await h.post({ hook_event_name: "UserPromptSubmit", session_id: "sess-1", prompt: "go" });
    expect(open.ok, "the endpoint was never open, so closing it proves nothing").toBe(true);

    await teardown?.();
    teardown = undefined;

    await expect(h.post({ hook_event_name: "Stop", session_id: "sess-1" })).rejects.toThrow();
  });

  it("leaves the pane on inference when the agent's entitlement is revoked", async () => {
    const h = await reportingPane();
    await h.post({ hook_event_name: "UserPromptSubmit", session_id: "sess-1", prompt: "go" });

    h.runtime.release(h.paneId);
    await h.post({ hook_event_name: "Stop", session_id: "sess-1" });

    // Released coordinates publish nothing, so the row cannot be moved by a
    // process whose authority is gone.
    const turn = h.store.read(h.paneId)?.turn;
    expect(turn?.report.state).toBe("working");
    // And the turn it left behind stops deciding the row immediately rather
    // than running out its freshness window — waiting would leave the pane
    // reported as working on the authority of a revoked source (round-1 W6).
    // The record itself survives, so the identity it carried is not lost.
    expect(Date.now() - (turn?.receivedAt ?? 0)).toBeGreaterThanOrEqual(TURN_FRESHNESS_MS);
  });

  it("gives a restored pane no turn to inherit", async () => {
    const h = await reportingPane();
    await h.post({ hook_event_name: "UserPromptSubmit", session_id: "sess-1", prompt: "go" });

    // What a window reload is, from the store's side: every pane torn down and
    // recreated. Hook status is not persisted across it.
    h.store.delete(h.paneId);
    h.store.create(h.paneId);

    expect(h.store.read(h.paneId)?.turn).toBeUndefined();
  });
});

// ─── I6 / I7 — the routing `activate` installs, through the real thing ──────
//
// These used to live in extension.crossLayer.test.ts against a lighter harness that could
// not run `activate()`, so it re-implemented the onStatus routing branch by hand and stated
// the mirror in its header. A mirrored seam cannot fail when the original changes, which is
// the one thing a cross-layer test exists to do (round-4 B13). The routing is only reachable
// by standing up the extension, so the tests moved to where it is reachable.

describe("the routing activate installs between a hook turn and a projected row", () => {
  /** A pane at a worktree the tree contains, so the real projector emits a row for it. */
  async function pipeline(paneId = "pane-i6") {
    await assemble();
    await settle();
    const { runtime, paneEvidence: store } = captured;
    if (runtime === undefined || store === undefined) {
      throw new Error("activate built no hook runtime or no pane store");
    }
    runtime.setAgentEnabled("claude", true);
    store.create(paneId, { viewId: "sidebar", cwd: LINKED, ptyPid: 4242, shell: "claude", isAgentLaunch: true });
    const url = runtime.create(paneId).ANYWHERE_TERMINAL_CLAUDE_URL;
    if (url === undefined) {
      throw new Error("no claude coordinates were minted");
    }
    return {
      runtime,
      store,
      post: (body: unknown) =>
        fetch(`${url}/claude`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      /** Re-project through the host, then read the projector's own answer. */
      row: async (): Promise<WorktreeAgentRow | undefined> => {
        await captured.host?.mutationBindings().forceRebuild(REPO_ID);
        await settle();
        return captured.projection?.rowsByWorktreeId[LINKED]?.[0];
      },
    };
  }

  it("[I6] stamps no finish for a session boundary, though the pane does read idle", async () => {
    const p = await pipeline();
    await p.post({ hook_event_name: "UserPromptSubmit", session_id: "sess-1", prompt: "go" });
    // Projected between the events: the finish rule is a TRANSITION (running → idle), so a
    // single projection at the end would never see one and the check would pass for the
    // wrong reason.
    expect((await p.row())?.activity).toBe("running");

    await p.post({ hook_event_name: "SessionStart", session_id: "sess-1", source: "resume" });
    const row = await p.row();

    expect(row?.activity).toBe("idle");
    expect(row?.finishedAt, "a boundary was recorded as a finished turn").toBeUndefined();
  });

  it("[I6] does stamp a finish for a turn that actually ended, so the check above is not vacuous", async () => {
    const p = await pipeline();
    await p.post({ hook_event_name: "UserPromptSubmit", session_id: "sess-1", prompt: "go" });
    expect((await p.row())?.activity).toBe("running");

    await p.post({ hook_event_name: "Stop", session_id: "sess-1" });
    const row = await p.row();

    expect(row?.activity).toBe("idle");
    expect(row?.finishedAt).toBeDefined();
  });

  it("[I7] returns the pane to inference when the source that published it goes away", async () => {
    const p = await pipeline();
    await p.post({ hook_event_name: "UserPromptSubmit", session_id: "sess-1", prompt: "go" });
    expect((await p.row())?.activitySource).toBe("hook");

    // A reload DISPOSES the runtime — it closes the server and marks itself disposed. That
    // is a different event from `setAgentEnabled(false)`, which is a user revoking an
    // entitlement, and I7 is about the first one (round-1 B4).
    p.runtime.dispose();
    await new Promise((resolve) => setImmediate(resolve));

    expect((await p.row())?.activitySource).not.toBe("hook");
    // And it cannot come back: a disposed runtime republishing is the same defect from the
    // other side, so the socket it minted must no longer accept a turn.
    await expect(p.post({ hook_event_name: "UserPromptSubmit", session_id: "sess-1" })).rejects.toThrow();
    expect((await p.row())?.activitySource).not.toBe("hook");
  });
});

// ── Cross-layer invariants (design.md D5) ────────────────────────────────
//
// Each of these spans the host and the webview. A unit test at either end can
// pass while the composition is broken, which is what docs/PLAN.md WT-007.1
// means by "cross-layer verification cannot live inside any single feature
// task". They live in this file rather than a second harness because standing
// up this composition twice would be the duplication the invariants argue against.

describe("the invariants that span the host and the webview", () => {
  /** Every worktree id the tree in this envelope actually contains. */
  function treeIds(msg: ExtensionToWebViewMessage): string[] {
    if (msg.type !== "worktreeTreeResponse") {
      return [];
    }
    return msg.tree.repos.flatMap((repo) => repo.worktrees.map((w) => w.id));
  }

  // Round-1 B5: this used to claim "and sends nothing", counting webview→host traffic after
  // mutating an already-published host row — it never stimulated the webview boundary where
  // the strip happens, so the no-message half was not proven here. That half is proven at
  // its own source in paneEvidenceReporting.test.ts, tagged [I9] there. What THIS test owns
  // is the far end: a spinner frame that did reach the host must not repaint the tree.
  it("[I9] does not repaint the tree for a spinner-only title change", async () => {
    publishedRow = { ...agentRowFixture(), title: "⠋ building" };
    const { host } = await assemble();
    // The card holds its agents collapsed until it is opened — the same click a
    // user makes before the row is on screen at all.
    expandCard("feature");
    await settle();
    await settleUntil(() => document.body.textContent?.includes("building") === true, "the agent row to render");

    const before = document.querySelector("[data-row-id]");
    const sentBefore = outbound.length;

    // The frame advances. Nothing about the session did.
    publishedRow = { ...publishedRow, title: "⠙ building" };
    await host.mutationBindings().forceRebuild(REPO_ID);
    await settle();

    const after = document.querySelector("[data-row-id]");
    expect(before, "the agent row never rendered, so sameness proves nothing").not.toBeNull();
    // Same node, not merely equal markup: a replaced element is a re-render.
    expect(after).toBe(before);
    expect(outbound.length).toBe(sentBefore);
  });

  it("[3_2] drops a predecessor's provisioning offer and honours the live opening's", async () => {
    // The whole point of the opening, walked end to end: a read that resolves
    // after the form it belonged to was replaced must not publish into the form
    // the user is looking at now. Every module test asserts one half of this
    // against its own fake — this one runs the real host, the real router and
    // the real dialog, which is the arrangement the provisioning offer shipped
    // dark under (.reviews/round-1.md B1).
    fs.mkdirSync(path.join(REPO, "asimov"), { recursive: true });
    fs.writeFileSync(path.join(REPO, ".env"), "TOKEN=1\n");
    fs.writeFileSync(path.join(REPO, "asimov", "worktree.yaml"), "copy:\n  - .env\n");
    const { surface } = await assemble();

    // The first form's offer is intercepted on the wire rather than delayed by
    // slowing the read: what this asserts is what the panel does with an answer
    // that arrives late, and racing a real filesystem read for that would make
    // the test's meaning depend on how fast the disk is.
    const late: ExtensionToWebViewMessage[] = [];
    const deliver = surface.post;
    surface.post = (msg: ExtensionToWebViewMessage) => {
      if (msg.type === "worktreeProvisionOffer" && late.length === 0) {
        late.push(msg);
        return;
      }
      return deliver(msg);
    };

    clickItem(openMenu("feature"), /new worktree/i);
    await settle();
    expect(late, "the first opening's read never produced an offer to hold").toHaveLength(1);

    // The provider file moves between the two forms, so the two reads are
    // telling the user different things. Without that, a section redrawn from
    // the predecessor's model would be indistinguishable from the right one.
    fs.writeFileSync(path.join(REPO, ".env.second"), "TOKEN=2\n");
    fs.writeFileSync(path.join(REPO, "asimov", "worktree.yaml"), "copy:\n  - .env.second\n");

    // A second form. Superseding is the host's job and 2_1 owns it; what this
    // walk adds is that the panel refuses the first one even so.
    clickItem(openMenu("feature"), /new worktree/i);
    await settle();
    expect(
      [...document.querySelectorAll(".wt-bring-box .wt-brow-code")].map((e) => e.textContent),
      "the live opening was never answered, so the replay below proves nothing",
    ).toEqual([".env.second"]);

    surface.post = deliver;
    const held = late[0];
    if (held === undefined) {
      throw new Error("nothing was held");
    }
    surface.post(held);
    await settle();

    // Still the live opening's own model. The predecessor's arrived, was routed
    // by the shipped table, and the panel declined to draw it.
    expect([...document.querySelectorAll(".wt-bring-box .wt-brow-code")].map((e) => e.textContent)).toEqual([
      ".env.second",
    ]);
  });

  it("fails selected provisioning when production observes a changed checkout identity", async () => {
    fs.mkdirSync(path.join(REPO, "asimov"), { recursive: true });
    fs.writeFileSync(path.join(REPO, ".env"), "TOKEN=1\n");
    fs.writeFileSync(path.join(REPO, "asimov", "worktree.yaml"), "copy:\n  - .env\n");
    const { surface } = await assemble();
    const provisionResults: WorktreeProvisionResultMessage[] = [];
    const deliver = surface.post;
    surface.post = (message: ExtensionToWebViewMessage) => {
      if (message.type === "worktreeProvisionResult") {
        provisionResults.push(message);
      }
      return deliver(message);
    };

    clickItem(openMenu("feature"), /new worktree/i);
    await settleUntil(
      () => document.querySelectorAll(".wt-bring-box .wt-brow-cb").length > 0,
      "the create form to offer the provider's file",
    );
    const branch = document.querySelector<HTMLInputElement>("#wt-branch");
    if (branch === null) {
      throw new Error("the create form has no branch field");
    }
    branch.value = "feat/unstable";
    branch.dispatchEvent(new Event("input", { bubbles: true }));
    branch.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    const box = document.querySelector<HTMLInputElement>(".wt-bring-box .wt-brow-cb");
    if (box === null) {
      throw new Error("the form did not offer the file");
    }
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    const destination = document.querySelector<HTMLInputElement>("#wt-path")?.value;
    if (destination === undefined || destination === "") {
      throw new Error("the host resolved no destination");
    }
    fs.mkdirSync(destination, { recursive: true });
    provisioningAuthorizationStable = false;

    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => /create worktree/i.test(button.textContent ?? ""))
      ?.click();
    await settleUntil(() => provisionResults.length > 0, "the failed provisioning result");

    expect(provisionResults[0]?.steps[0]?.outcome.kind).toBe("failed");
    expect(fs.existsSync(path.join(destination, ".env"))).toBe(false);
  });

  it("[3_2] brings a ticked file over and reports it on the create's OWN notice", async () => {
    // Round-2 F017, end to end. The create outcome carried no `worktreeId`, so
    // the merge key the provisioning message arrives under matched nothing and
    // the panel invented a SECOND notice with a fabricated `outcome: "ok"`. My
    // round-1 witness could not see it: it built the create message by hand,
    // with an id production never emits. Here nothing is written down — the id
    // is whatever `normalizeWorktreeId` returns for the path the host resolved.
    fs.mkdirSync(path.join(REPO, "asimov"), { recursive: true });
    fs.writeFileSync(path.join(REPO, ".env"), "TOKEN=1\n");
    fs.writeFileSync(path.join(REPO, "asimov", "worktree.yaml"), "copy:\n  - .env\nports:\n  APP: 5183\n");
    const { surface } = await assemble();
    const provisionResults: WorktreeProvisionResultMessage[] = [];
    const deliver = surface.post;
    surface.post = (message: ExtensionToWebViewMessage) => {
      if (message.type === "worktreeProvisionResult") {
        provisionResults.push(message);
      }
      return deliver(message);
    };

    clickItem(openMenu("feature"), /new worktree/i);
    await settleUntil(
      () => document.querySelectorAll(".wt-bring-box .wt-brow-cb").length > 0,
      "the create form to offer the provider's file",
    );

    // The branch first: the host re-resolves the destination from it, so a path
    // read before this one is the default the form opened on.
    const branch = document.querySelector<HTMLInputElement>("#wt-branch");
    if (branch === null) {
      throw new Error("the create form has no branch field");
    }
    branch.value = "feat/bring";
    branch.dispatchEvent(new Event("input", { bubbles: true }));
    branch.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();

    const boxes = [...document.querySelectorAll<HTMLInputElement>(".wt-bring-box .wt-brow-cb")];
    if (boxes.length !== 2) {
      throw new Error("the form did not offer both the file and port");
    }
    for (const box of boxes) {
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await settle();

    // git is a recorder here, so nothing materializes the destination. The
    // walk is real and would otherwise fail on a directory that is not there,
    // which would prove the merge and nothing about the copy.
    const destination = document.querySelector<HTMLInputElement>("#wt-path")?.value;
    if (destination === undefined || destination === "") {
      throw new Error("the host resolved no destination");
    }
    fs.mkdirSync(destination, { recursive: true });

    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => /create worktree/i.test(b.textContent ?? ""))
      ?.click();
    await settleUntil(
      () => document.querySelectorAll(".wt-notice").length > 0,
      "the create to report something back to the panel",
    );
    await settle();

    // The file and port claim actually arrived, through the production bindings.
    expect(fs.readFileSync(path.join(destination, ".env"), "utf8")).toBe("TOKEN=1\n");
    expect(fs.readFileSync(path.join(destination, ".env.worktree"), "utf8")).toMatch(/^APP=[1-9][0-9]{0,4}\n$/);
    expect(provisionResults).toHaveLength(1);
    expect(provisionResults[0]?.steps).toHaveLength(1);
    expect(provisionResults[0]?.ports).toHaveLength(1);
    expect(provisionResults[0]?.ports[0]?.outcome.kind).toBe("allocated");
    expect(authorizedPaths).toContain(REPO);
    expect(authorizedPaths).toContain(LINKED);
    expect(authorizedPaths).toContain(destination);
    expect(fs.readFileSync(path.join(REPO, ".git", "info", "exclude"), "utf8")).toContain("/.env.worktree\n");
    // ONE notice. Two means the provisioning message found no create to land on
    // and made its own — which is what shipped.
    // ONE create notice. The panel also carries an unrelated "not being watched"
    // notice in this assembly, so the count is taken over the create's own.
    const notices = [...document.querySelectorAll(".wt-notice")].filter((n) =>
      (n.textContent ?? "").includes("Create done."),
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]?.textContent).toContain("1 of 1 brought over.");
  });

  /**
   * The provider files the assembly's repository carries, cleared.
   *
   * `REPO` outlives a test, so a file another walk wrote is still there — and
   * detection is about which files EXIST, so a leftover would silently decide
   * the answer these two tests are about.
   */
  function noProviderFiles(): void {
    for (const rel of [
      ".vscode/worktree.json",
      "asimov/worktree.yaml",
      "orca.yaml",
      ".worktreeinclude",
      ".vscode/tasks.json",
    ]) {
      fs.rmSync(path.join(REPO, rel), { force: true });
    }
  }

  it("[3_4] fills the section from an orca repository, through the shipped wiring", async () => {
    // The module suites prove the adapter reads orca. Only the entry point
    // proves the adapter is REACHED: WT-012.1's binding named the asimov reader
    // directly, and a detection order nothing calls is inert with every unit
    // test green.
    noProviderFiles();
    fs.writeFileSync(
      path.join(REPO, "orca.yaml"),
      "worktree:\n  sharedDirectories:\n    - node_modules\n\nscripts:\n  setup: |\n    pnpm install\n",
    );
    fs.writeFileSync(path.join(REPO, ".worktreeinclude"), "# what a fresh checkout needs\n.env\n");
    await assemble();

    clickItem(openMenu("feature"), /new worktree/i);
    await settleUntil(
      () => document.querySelectorAll(".wt-bring-box .wt-brow").length > 0,
      "the create form to offer orca's files",
    );

    const rows = [...document.querySelectorAll(".wt-bring-box .wt-brow")];
    const subjects = rows.map((r) => r.querySelector(".wt-brow-meta")?.textContent ?? "");
    expect(subjects.some((t) => t.includes("node_modules"))).toBe(true);
    expect(subjects.some((t) => t.includes(".env"))).toBe(true);
    // Each row names the file it came from, and orca's two are told apart.
    const sources = rows.map((r) => r.querySelector(".wt-brow-src")?.textContent ?? "");
    expect(sources).toContain("orca.yaml");
    expect(sources).toContain(".worktreeinclude");
    // The section is orca's alone; the comment line is the file's syntax, not a
    // path, and produced no row.
    expect(rows).toHaveLength(3);
  });

  it("[3_2] draws one merged, attributed list for a repository carrying both files", async () => {
    // The module suites prove the merge. Only the entry point proves it is
    // REACHED: a dispatcher that resolved `extends` perfectly and was never
    // called from the shipped wiring is inert with every unit test green.
    noProviderFiles();
    fs.mkdirSync(path.join(REPO, "node_modules"), { recursive: true });
    fs.mkdirSync(path.join(REPO, ".cache"), { recursive: true });
    fs.writeFileSync(path.join(REPO, ".env.local"), "TOKEN=3\n");
    fs.writeFileSync(
      path.join(REPO, "orca.yaml"),
      "worktree:\n  sharedDirectories:\n    - node_modules\n    - .cache\n",
    );
    fs.mkdirSync(path.join(REPO, ".vscode"), { recursive: true });
    fs.writeFileSync(
      path.join(REPO, ".vscode", "worktree.json"),
      `{
  // Build on orca, take node_modules by copy instead, and drop the cache.
  "extends": "orca.yaml",
  "copy": ["node_modules", ".env.local"],
  "exclude": [".cache"],
}`,
    );
    await assemble();

    clickItem(openMenu("feature"), /new worktree/i);
    await settleUntil(
      () => document.querySelectorAll(".wt-bring-box .wt-brow").length > 0,
      "the create form to offer the merged section",
    );

    const rows = [...document.querySelectorAll(".wt-bring-box .wt-brow")];
    const row = (subject: string) =>
      rows.find((r) => (r.querySelector(".wt-brow-code")?.textContent ?? "") === subject);

    // The shared path: one row, the repository's own mode, its own file.
    const shared = row("node_modules");
    expect(rows.filter((r) => r.querySelector(".wt-brow-code")?.textContent === "node_modules")).toHaveLength(1);
    expect(shared?.querySelector("b")?.textContent).toBe("Copy");
    expect(shared?.querySelector(".wt-brow-src")?.textContent).toBe(".vscode/worktree.json");
    // The native file's own addition.
    expect(row(".env.local")?.querySelector(".wt-brow-src")?.textContent).toBe(".vscode/worktree.json");
    // The removal, drawn as deliberate and still naming the file that declared
    // it — not the file that removed it.
    const dropped = row(".cache");
    expect(dropped?.classList.contains("wt-brow--excluded")).toBe(true);
    expect(dropped?.querySelector(".wt-brow-src")?.textContent).toBe("orca.yaml");
    expect(dropped?.querySelector("input")).toBeNull();
    expect(rows).toHaveLength(3);
    // Both providers contributed, so neither offers to switch to itself.
    expect(document.querySelectorAll(".wt-bring-switch")).toHaveLength(0);
    expect(document.querySelector(".wt-bring-sum")?.textContent).toBe("2 copied");
  });

  it("[3_4] takes a switch and redraws the section from the other source, creating nothing", async () => {
    noProviderFiles();
    fs.mkdirSync(path.join(REPO, "asimov"), { recursive: true });
    fs.writeFileSync(path.join(REPO, "asimov", "worktree.yaml"), "copy:\n  - .env\n");
    fs.writeFileSync(path.join(REPO, "orca.yaml"), "worktree:\n  sharedDirectories:\n    - node_modules\n");
    await assemble();

    clickItem(openMenu("feature"), /new worktree/i);
    await settleUntil(
      () => document.querySelectorAll(".wt-bring-box .wt-brow").length > 0,
      "the create form to offer the first source's file",
    );

    // asimov wins the fixed order, and orca is named rather than hidden.
    const first = [...document.querySelectorAll(".wt-bring-box .wt-brow-meta")].map((m) => m.textContent ?? "");
    expect(first.some((t) => t.includes(".env"))).toBe(true);
    expect(first.some((t) => t.includes("node_modules"))).toBe(false);
    const offered = [...document.querySelectorAll(".wt-bring-switch")];
    expect(offered).toHaveLength(1);
    expect(offered[0]?.querySelector(".wt-bring-switch-files")?.textContent).toBe("orca.yaml, .worktreeinclude");

    const noticesBefore = document.querySelectorAll(".wt-notice").length;
    document.querySelector<HTMLButtonElement>(".wt-bring-switch-take")?.click();
    await settleUntil(
      () =>
        [...document.querySelectorAll(".wt-bring-box .wt-brow-meta")].some((m) =>
          (m.textContent ?? "").includes("node_modules"),
        ),
      "the switch to redraw the section from orca",
    );

    // Replaced, not merged: the asimov row is gone, and the row that offers to
    // switch is now the source that just lost.
    const after = [...document.querySelectorAll(".wt-bring-box .wt-brow-meta")].map((m) => m.textContent ?? "");
    expect(after.some((t) => t.includes("node_modules"))).toBe(true);
    expect(after.some((t) => t.includes(".env"))).toBe(false);
    expect(document.querySelector(".wt-bring-switch-files")?.textContent).toBe("asimov/worktree.yaml");
    // Taking a switch submits nothing and creates nothing.
    expect(document.querySelectorAll(".wt-notice")).toHaveLength(noticesBefore);
    expect(document.querySelector("#wt-branch")).not.toBeNull();
  });

  it("[3_2] carries the retirement from the dialog's Cancel to the shipped host", async () => {
    // The signal only exists if it travels. A retirement the panel posts and no
    // route delivers is the same defect as one never posted — and it is the
    // cancel exit, the one nothing ever reopens to supersede (D3).
    await assemble();
    clickItem(openMenu("feature"), /new worktree/i);
    await settle();
    const opening = outbound
      .filter((m) => m.type === "requestWorktreeCreateDefaults")
      .map((m) => (m as { opening: number }).opening)
      .at(-1);

    [...document.querySelectorAll("button")].find((b) => b.textContent === "Cancel")?.click();
    await settle();

    expect(outbound.filter((m) => m.type === "worktreeCreateClosed")).toEqual([
      { type: "worktreeCreateClosed", opening },
    ]);
  });

  it("supplies a ref reader, so a refs request reaches git rather than being ignored", async () => {
    // The host ignores the request outright when no reader is wired, and every
    // module test supplies its own — which is exactly how the provisioning
    // offer shipped dark with a green suite (.reviews/round-1.md B1).
    await assemble();
    clickItem(openMenu("feature"), /new worktree/i);
    await settle();

    const reads = argv.filter((c) => c.args[0] === "for-each-ref");
    expect(reads).toHaveLength(1);
    // Bounded by the module's own cap, not by whatever the entry point felt
    // like passing — and run in the repository, not the linked worktree.
    expect(reads[0]?.args).toContain(`--count=${MAX_REFS + 1}`);
    expect(reads[0]?.cwd).toBe(REPO);
  });

  it("offers the repository's branches in the create dialog, marking the one a worktree holds", async () => {
    // The module tests assert against their own injected fakes, so none of them
    // can see an entry point that never supplies a reader — which is exactly
    // how the provisioning offer shipped dark (.reviews/round-1.md B1). This
    // runs the real `activate()` closure: the rows below exist only if the
    // request reached the host, the host reached `readRepoRefs`, and the answer
    // was routed back through the webview to the form.
    await assemble();
    clickItem(openMenu("feature"), /new worktree/i);
    await settle();

    const branch = document.querySelector<HTMLInputElement>("#wt-branch");
    if (branch === null) {
      throw new Error("the create form has no branch field");
    }
    branch.focus();
    branch.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    await settle();

    const rows = [...document.querySelectorAll<HTMLElement>("#wt-branch-list [role='option']")];
    // `pr-42` sits between the refs and create-new because the same assembly
    // now answers the forge too (§ 4.1's order). The refs assertions below are
    // what this test is about and are unchanged.
    expect(rows.map((r) => r.dataset.branch ?? r.dataset.kind)).toEqual(["main", "feature", "idle", "pr-42", "new"]);
    // Derived from the listing this assembly already holds, not read from git a
    // second time — and it names the DIRECTORY, never the path (design.md D2).
    const feature = rows.find((r) => r.dataset.branch === "feature");
    expect(feature?.dataset.heldBy).toBe("feature");
    expect(feature?.getAttribute("aria-disabled")).toBe("true");
    expect(feature?.textContent).not.toContain(TMP);
    // One git read for the list. A producer that re-listed the worktrees to
    // answer held-by would show a second call here.
    expect(argv.filter((c) => c.args[0] === "for-each-ref")).toHaveLength(1);
  });

  it("offers the repository's pull requests in the same list, through the real wiring", async () => {
    // The same hole this file exists to catch, one feature later: every module
    // test for the forge read passes against its own fake, so an entry point
    // that never supplies `readPullRequests` would ship a combobox with no pull
    // requests in it and nothing red anywhere (.reviews/round-1.md B1).
    await assemble();
    clickItem(openMenu("feature"), /new worktree/i);
    await settle();

    const branch = document.querySelector<HTMLInputElement>("#wt-branch");
    if (branch === null) {
      throw new Error("the create form has no branch field");
    }
    branch.focus();
    branch.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    await settle();

    const rows = [...document.querySelectorAll<HTMLElement>("#wt-branch-list [role='option']")];
    // § 4.1's order, end to end: refs, then the pull request, then create-new.
    expect(rows.map((r) => r.dataset.branch ?? r.dataset.kind)).toEqual(["main", "feature", "idle", "pr-42", "new"]);
    expect(rows.find((r) => r.dataset.pr === "42")?.textContent).toContain("Add search");
    // Asked once, and asked where the repository is — `gh` resolves it from the
    // checkout rather than from a name assembled here.
    const asked = argv.filter((c) => c.args[0] === "pr");
    expect(asked).toHaveLength(1);
    expect(asked[0]?.cwd).toBe(REPO);
  });

  it("[4_1] answers a probe through the real wiring, and the answer reaches the form", async () => {
    // A module test asserting against its own injected fake cannot see a
    // wrapper that drops an argument, and it cannot see a message that is
    // declared, posted and handled but never routed — which is how
    // `requestWorktreeSubagents` shipped inert with a green suite.
    prunableRow = true;
    linkTheWorktree();
    await assemble();
    clickItem(openMenu("feature"), /new worktree/i);
    await settle();

    const branch = document.querySelector<HTMLInputElement>("#wt-branch");
    if (branch === null) {
      throw new Error("the create form has no branch field");
    }
    branch.focus();
    branch.value = "feature";
    branch.dispatchEvent(new Event("input", { bubbles: true }));
    branch.dispatchEvent(new Event("change", { bubbles: true }));
    // Waited on the ANSWER, not on the note: the note shows as soon as the form
    // classifies the typed text itself, so waiting on it would pass with the
    // resolution still in flight and prove nothing about the wire.
    await settleUntil(
      () => posted.some((m) => m.type === "worktreeCreateResolution" && m.query === "feature"),
      "the resolution for the typed branch",
    );

    // The mode the whole chain produced: the listing said prunable, the probe
    // corroborated the link and the HEAD, and the form states what the create
    // will do rather than discovering it after the create failed.
    expect(document.querySelector<HTMLElement>("#wt-base-note")?.textContent).toContain("already on disk");
    expect(document.querySelector<HTMLInputElement>("#wt-base")?.disabled).toBe(true);
    // Corroborated, not assumed: git was asked for both commits.
    expect(argv.some((c) => c.args.join(" ") === "rev-parse refs/heads/feature" && c.cwd === REPO)).toBe(true);
    expect(argv.some((c) => c.args.join(" ") === "rev-parse HEAD" && c.cwd === LINKED)).toBe(true);
  });

  /** The destination the form is STATING, which is what the user is going on. */
  function displayedDestination(): string | null {
    return document.querySelector<HTMLElement>(".wt-dest")?.getAttribute("aria-label") ?? null;
  }

  /** Type a branch and let the edit settle, then wait for its resolution. */
  async function settleBranch(name: string): Promise<void> {
    const branch = document.querySelector<HTMLInputElement>("#wt-branch");
    if (branch === null) {
      throw new Error("no branch input");
    }
    branch.focus();
    branch.value = name;
    branch.dispatchEvent(new Event("input", { bubbles: true }));
    branch.dispatchEvent(new Event("change", { bubbles: true }));
    await settleUntil(
      () => posted.some((m) => m.type === "worktreeCreateResolution" && m.query === name),
      `the resolution for ${name}`,
    );
  }

  function clickCreate(): void {
    const btn = clickCreate.button();
    expect(btn.disabled, "the form would not have submitted, so the argv below would prove nothing").toBe(false);
    btn.click();
  }
  clickCreate.button = (): HTMLButtonElement => {
    const btn = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.textContent?.startsWith("Create worktree"),
    );
    if (btn === undefined) {
      throw new Error("no Create button");
    }
    return btn;
  };

  it("[5_4] carries one typed selection from probe to issued argv, through the real form", async () => {
    // The repair test below reaches the host directly. That is what let three
    // blockers survive a green gate: the resolution-to-submit seam — mode
    // translation, the displayed path, the submit gating — was never crossed
    // (round-1 W7).
    prunableRow = true;
    linkTheWorktree();
    await assemble();
    clickItem(openMenu("feature"), /new worktree/i);
    await settle();

    const branch = document.querySelector<HTMLInputElement>("#wt-branch");
    if (branch === null) {
      throw new Error("no branch input");
    }
    branch.focus();
    branch.value = "feature";
    branch.dispatchEvent(new Event("input", { bubbles: true }));
    branch.dispatchEvent(new Event("change", { bubbles: true }));
    await settleUntil(
      () => posted.some((m) => m.type === "worktreeCreateResolution" && m.query === "feature"),
      "the resolution for the typed branch",
    );

    // What the user is told, before anything is submitted.
    expect(document.querySelector<HTMLElement>("#wt-action-note")?.textContent).toContain("Repairs the stale");

    const create = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.textContent?.startsWith("Create worktree"),
    );
    if (create === undefined) {
      throw new Error("no Create button");
    }
    expect(create.disabled, "the form would not have submitted, so the argv below would prove nothing").toBe(false);
    // Read while the form is still open — the submit disposes it.
    const shown = displayedDestination();
    create.click();
    await settle();

    const issued = argv.map((c) => c.args);
    expect(issued.some((a) => a[0] === "worktree" && a[1] === "repair" && a[2] === LINKED)).toBe(true);
    expect(issued.some((a) => a[0] === "worktree" && a[1] === "add")).toBe(false);
    expect(prunableRow).toBe(false);

    // ONE path, at all three places it is stated. Asserting only the argv left
    // the form free to show a free suffix beside the checkout while repairing
    // something else — the seam the earlier assertions could not see
    // (round-3 W7).
    expect(shown).toBe(LINKED);
    expect(outbound.find((m) => m.type === "worktreeCreate")).toMatchObject({
      path: LINKED,
      mode: { kind: "reattach", branch: "feature", repairPath: LINKED },
    });
  });

  it("[5_4] carries a fresh selection's own destination to the same three places", async () => {
    await assemble();
    clickItem(openMenu("feature"), /new worktree/i);
    await settle();
    await settleBranch("brand-new");

    expect(document.querySelector<HTMLElement>("#wt-action-note")?.textContent).toContain("Creates");
    const shown = displayedDestination();
    expect(shown, "the form stated no destination, so the rest proves nothing").toBeTruthy();

    clickCreate();
    await settle();

    expect(outbound.find((m) => m.type === "worktreeCreate")).toMatchObject({
      path: shown,
      mode: { kind: "fresh", branch: "brand-new" },
    });
    const added = argv.map((c) => c.args).find((a) => a[0] === "worktree" && a[1] === "add");
    expect(added, "no `worktree add` was issued").toBeDefined();
    expect(added).toContain(shown);
  });

  it("[6_2] refuses the destination override for a repair, rather than showing two paths", async () => {
    // The override moved the displayed and posted path while the submitted mode
    // still carried `repairPath`, so the form stated one directory and the
    // mutation repaired another (round-4 B3).
    prunableRow = true;
    linkTheWorktree();
    await assemble();
    clickItem(openMenu("feature"), /new worktree/i);
    await settle();
    await settleBranch("feature");

    const path = document.querySelector<HTMLInputElement>("#wt-path");
    if (path === null) {
      throw new Error("no destination override input");
    }
    expect(path.disabled).toBe(true);
    expect(document.querySelector<HTMLElement>("#wt-path-note")?.textContent).toContain("already on disk");

    const shown = displayedDestination();
    clickCreate();
    await settle();

    expect(shown).toBe(LINKED);
    expect(outbound.find((m) => m.type === "worktreeCreate")).toMatchObject({
      path: LINKED,
      mode: { kind: "reattach", repairPath: LINKED },
    });
    expect(argv.map((c) => c.args).some((a) => a[0] === "worktree" && a[1] === "repair" && a[2] === LINKED)).toBe(true);
  });

  it("[6_2] resolves a fresh destination override before it can be submitted", async () => {
    await assemble();
    clickItem(openMenu("feature"), /new worktree/i);
    await settle();
    await settleBranch("brand-new");

    const advanced = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.classList.contains("wt-advanced-toggle"),
    );
    advanced?.click();
    const path = document.querySelector<HTMLInputElement>("#wt-path");
    if (path === null) {
      throw new Error("no destination override input");
    }
    const mine = `${path.value || REPO}-override`;
    path.focus();
    path.value = mine;
    path.dispatchEvent(new Event("input", { bubbles: true }));
    // Not yet settled: the host has not been told, so the form must not offer a
    // create against a path nobody resolved.
    expect(clickCreate.button().disabled).toBe(true);

    path.dispatchEvent(new Event("change", { bubbles: true }));
    await settleUntil(
      () => outbound.some((m) => m.type === "worktreeCreateProbe" && m.candidatePath === mine),
      "the probe carrying the override",
    );
    await settle();

    const shown = displayedDestination();
    expect(shown).toBe(mine);
    clickCreate();
    await settle();

    expect(outbound.find((m) => m.type === "worktreeCreate")).toMatchObject({ path: mine });
    const added = argv.map((c) => c.args).find((a) => a[0] === "worktree" && a[1] === "add");
    expect(added, "no `worktree add` was issued").toBeDefined();
    expect(added).toContain(mine);
  });

  it("[7_3] submits the path the host answered when the override is occupied", async () => {
    // Every override walk written so far used a FREE candidate, where the
    // supplied path and the resolved target cannot differ — so two green gates
    // over B3 proved nothing about the case the decision is actually about
    // (round-5 W7). This one occupies the candidate, so the two must differ.
    await assemble();
    clickItem(openMenu("feature"), /new worktree/i);
    await settle();
    await settleBranch("brand-new");

    const advanced = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.classList.contains("wt-advanced-toggle"),
    );
    advanced?.click();
    const pathInput = document.querySelector<HTMLInputElement>("#wt-path");
    if (pathInput === null) {
      throw new Error("no destination override input");
    }
    // The destination the host derived is free; a sibling of it is not, because
    // this makes it a real directory on the real filesystem the probe reads.
    const derived = pathInput.value;
    const taken = `${derived}-taken`;
    fs.mkdirSync(taken, { recursive: true });
    pathInput.focus();
    pathInput.value = taken;
    pathInput.dispatchEvent(new Event("input", { bubbles: true }));
    pathInput.dispatchEvent(new Event("change", { bubbles: true }));
    await settleUntil(
      () => outbound.some((m) => m.type === "worktreeCreateProbe" && m.candidatePath === taken),
      "the probe carrying the occupied override",
    );
    await settle();

    // The candidate is the QUESTION and stays in the field; the answer is what
    // the form states and submits.
    expect(pathInput.value, "the answer overwrote the candidate").toBe(taken);
    const shown = displayedDestination();
    clickCreate();
    await settle();

    expect(shown).toBe(derived);
    expect(outbound.find((m) => m.type === "worktreeCreate")).toMatchObject({ path: derived });
    const added = argv.map((c) => c.args).find((a) => a[0] === "worktree" && a[1] === "add");
    expect(added, "no `worktree add` was issued").toBeDefined();
    expect(added).toContain(derived);
    expect(added).not.toContain(taken);
  });

  it("[7_3] submits the repair target when a reattach withdraws a standing override", async () => {
    prunableRow = true;
    linkTheWorktree();
    await assemble();
    clickItem(openMenu("feature"), /new worktree/i);
    await settle();
    // Fresh FIRST, so the destination control is live and an override can stand
    // before the repair arrives to withdraw it.
    await settleBranch("brand-new");

    const advanced = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.classList.contains("wt-advanced-toggle"),
    );
    advanced?.click();
    const pathInput = document.querySelector<HTMLInputElement>("#wt-path");
    if (pathInput === null) {
      throw new Error("no destination override input");
    }
    const mine = `${pathInput.value}-override`;
    pathInput.focus();
    pathInput.value = mine;
    pathInput.dispatchEvent(new Event("input", { bubbles: true }));
    pathInput.dispatchEvent(new Event("change", { bubbles: true }));
    await settleUntil(
      () => outbound.some((m) => m.type === "worktreeCreateProbe" && m.candidatePath === mine),
      "the probe carrying the override",
    );
    await settle();
    expect(displayedDestination(), "the setup never took the override").toBe(mine);

    // The branch now names the stale registration, so the answer is a repair —
    // which acts on its own directory and withdraws the override.
    await settleBranch("feature");
    await settle();

    const shown = displayedDestination();
    clickCreate();
    await settle();

    expect(shown).toBe(LINKED);
    expect(outbound.find((m) => m.type === "worktreeCreate")).toMatchObject({
      path: LINKED,
      mode: { kind: "reattach", repairPath: LINKED },
    });
    expect(argv.map((c) => c.args).some((x) => x[0] === "worktree" && x[1] === "repair" && x[2] === LINKED)).toBe(true);
  });

  it("[5_4] refuses a base that names no commit, before any create is issued", async () => {
    // The base and its verdict travel the production sender, not a value a test
    // injected into the dialog — which is how D7 was satisfied on paper while
    // `baseValid` was never produced at all (round-3 B4, W7).
    await assemble();
    clickItem(openMenu("feature"), /new worktree/i);
    await settle();
    await settleBranch("brand-new");

    const base = document.querySelector<HTMLInputElement>("#wt-base");
    if (base === null) {
      throw new Error("no base input");
    }
    base.focus();
    base.value = "no-such-ref";
    base.dispatchEvent(new Event("input", { bubbles: true }));
    base.dispatchEvent(new Event("change", { bubbles: true }));
    await settleUntil(
      () => posted.some((m) => m.type === "worktreeCreateResolution" && m.baseValid?.ok === false),
      "the verdict on the typed base",
    );

    expect(outbound.some((m) => m.type === "worktreeCreateProbe" && m.base?.kind === "ref")).toBe(true);
    expect(document.querySelector<HTMLElement>("#wt-action-note")?.textContent).toContain("no-such-ref");
    expect(clickCreate.button().disabled).toBe(true);
    expect(argv.some((c) => c.args[0] === "worktree" && c.args[1] === "add")).toBe(false);
  });

  it("[4_1] repairs the stale registration it really has, and never adds beside it", async () => {
    prunableRow = true;
    linkTheWorktree();
    const { host, surface } = await assemble();

    // The form has to exist before it can submit: a create now names the opening
    // it was composed in, and the host refuses one naming an opening the surface
    // does not hold (round-5 W1). Hand-sending the submit alone would refuse
    // here and the repair below would go unreached for the wrong reason.
    await host.handleMessage(surface, { type: "requestWorktreeCreateDefaults", repoId: REPO_ID, opening: 1 });
    await settle();
    await host.handleMessage(surface, {
      type: "worktreeCreate",
      repoId: REPO_ID,
      opening: 1,
      path: LINKED,
      mode: { kind: "reattach", branch: "feature", repairPath: LINKED, expectedOid: "2".repeat(40) },
      disposition: { kind: "free" },
      afterCreate: { kind: "none" },
    } as never);
    await settle();

    const issued = argv.map((c) => c.args);
    expect(issued.some((a) => a[0] === "worktree" && a[1] === "repair" && a[2] === LINKED)).toBe(true);
    expect(issued.some((a) => a[0] === "worktree" && a[1] === "add")).toBe(false);
    // § 2.3 condition 4, observed rather than claimed: the repair cleared the
    // flag, and the create reported success on THAT rather than on git's code.
    expect(prunableRow).toBe(false);
    expect(posted.find((m) => m.type === "worktreeMutationResult")).toMatchObject({
      verb: "create",
      result: { kind: "ok" },
    });
  });

  it("carries the three proofs across the production boundary", async () => {
    // The module test asserts against its own injected fake, so it cannot see a
    // production wrapper that drops the registry read it was handed — which is
    // exactly the shape cycle-2 B4 shipped. This runs the real `activate()`
    // closure: `ownerGone` is answered from the registry, which it can only be
    // if the read actually reached the reader.
    await assemble();

    const assessment = await captured.host?.mutationBindings().assessRemoval({
      repoId: REPO_ID,
      worktreeId: LINKED,
    });

    expect(assessment).toMatchObject({ kind: "confirmable" });
    const proofs = (assessment as unknown as { evidence: { proofs: Record<string, string> } }).evidence.proofs;
    // Unlocked, so its age was never in question — not "passed", which would
    // claim a reading nobody took.
    expect(proofs.lockAged).toBe("notApplicable");
    // The registry read arrived and named nobody rooted here.
    expect(proofs.ownerGone).toBe("passed");
    // And no fetch was issued to answer the merge, whatever it answered.
    expect(argv.some((c) => c.args.includes("fetch"))).toBe(false);
  });

  it("scans the session registry once per assessment, proofs included", async () => {
    // The producer is HANDED the read the assessment already issued. One that
    // took its own would scan the same directory twice in one assessment, and
    // the two scans could disagree about the same instant — the second `readdir`
    // design.md D3 rejects. No module test can see this: the host's own fake
    // stands in for the production closure that would do the scanning.
    await assemble();
    registryReads.length = 0;

    await captured.host?.mutationBindings().assessRemoval({ repoId: REPO_ID, worktreeId: LINKED });

    expect(registryReads).toHaveLength(1);
  });

  /**
   * A report carrying a confirmable risk asks for the worktree's name before the
   * destructive button will answer (WT-013.4). Typing it is part of authorizing,
   * not a separate case, so the invariant tests below walk through it.
   */
  function typeConfirmation(name: string): void {
    const field = document.querySelector<HTMLInputElement>('[role="dialog"] #wt-confirm-name');
    if (field === null) {
      return;
    }
    field.value = name;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("[I14] re-prompts instead of removing when a blocker appears after the confirmation", async () => {
    dirtyPaths = ["a.txt"];
    await assemble();

    // The menu click asks rather than removes, so the dialog it opens IS the
    // report (design.md D6). What this walk still proves is the blocked path
    // underneath it: the confirmation is answered against a set that has since
    // changed, and the host re-prompts rather than acting.
    clickItem(openMenu("feature"), /remove/i);
    await settle();
    expect(gitCalls("remove")).toEqual([]);
    const force = [...document.querySelectorAll<HTMLElement>("button")].find((b) =>
      /force remove/i.test(b.textContent ?? ""),
    );
    expect(force, "the blocked removal offered no way to confirm").toBeDefined();
    force?.click();
    await settle();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    // A second file appears between the confirmation being shown and being answered.
    dirtyPaths = ["a.txt", "b.txt"];
    const confirm = [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find((b) =>
      /remove/i.test(b.textContent ?? ""),
    );
    expect(confirm, "the dialog offered no confirm button").toBeDefined();
    typeConfirmation("feature");
    confirm?.click();
    await settle();

    // The force the user authorized was for the set they were SHOWN. It is not
    // spent on a set that grew underneath it — and the user is told why, rather
    // than watching the action silently do nothing.
    expect(gitCalls("remove").filter((a) => a.includes("--force"))).toEqual([]);
    expect(document.body.textContent).toContain("changed since you confirmed");
  });

  it("[I14] refuses a confirmation once the agent starts working under the open dialog", async () => {
    // Round-2 B6: the row used to be running before assembly, so the very first assessment
    // refused and the "became working" in the name never happened. D5's clause is about a
    // transition UNDER the open confirmation: the dialog opens on a removable worktree, the
    // agent starts a turn, and the force the user then authorizes must not be spent.
    dirtyPaths = ["a.txt"];
    publishedRow = agentRow({
      rowId: "row-busy",
      paneId: "pane-busy",
      viewId: "view-1",
      title: "idle for now",
      agent: "claude",
      activity: "idle",
      activitySource: "hook",
    });
    const { host } = await assemble();

    // Blocked on the dirty file only — an agent that is idle blocks nothing.
    clickItem(openMenu("feature"), /remove/i);
    await settle();
    const force = [...document.querySelectorAll<HTMLElement>("button")].find((b) =>
      /force remove/i.test(b.textContent ?? ""),
    );
    expect(force, "an idle agent should leave the removal merely confirmable").toBeDefined();
    force?.click();
    await settle();
    const confirm = [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find((b) =>
      /force remove/i.test(b.textContent ?? ""),
    );
    expect(
      confirm,
      `offered: ${[...document.querySelectorAll('[role="dialog"] button')].map((b) => b.textContent).join(" | ")}`,
    ).toBeDefined();
    typeConfirmation("feature");

    // NOW the agent starts working, while the confirmation the user is looking at stays open.
    publishedRow = { ...publishedRow, activity: "running" };
    await host.mutationBindings().forceRebuild(REPO_ID);
    await settle();

    confirm?.click();
    await settle();

    // The force never reaches git: the agent that started working turned a CONFIRMABLE
    // removal into a REFUSED one under the open dialog.
    expect(gitCalls("remove").filter((a) => a.includes("--force"))).toEqual([]);

    // And re-opening now shows why, with no confirm button to try again with — the same
    // affordance that was confirmable a moment ago is a refusal.
    const reopen = [...document.querySelectorAll<HTMLElement>("button")].find((b) =>
      /force remove/i.test(b.textContent ?? ""),
    );
    expect(reopen, "the refusal offered no way to see the reason").toBeDefined();
    reopen?.click();
    await settle();
    expect(document.body.textContent).toContain("out from under a working agent");
    const retry = [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].filter((b) =>
      /force remove/i.test(b.textContent ?? ""),
    );
    expect(retry).toEqual([]);
  });

  it("[I15] reports a killed removal as indeterminate, and still rebuilds", async () => {
    removeTimesOut = true;
    await assemble();
    const listsBefore = gitCalls("list").length;

    clickItem(openMenu("feature"), /remove/i);
    await settle();
    confirmRemoval("feature");
    await settle();

    // Not "Couldn't remove": git never reported an outcome, so a clean failure
    // would be a claim nobody made. Asserted on the reason the TIMEOUT leg
    // produces, not on the shared "partly applied" title — three other branches
    // reach that title, and an assertion on it passes with this leg deleted.
    expect(document.body.textContent).toContain("partly applied");
    expect(document.body.textContent).toContain("stopped before git reported an outcome");
    expect(document.body.textContent).not.toContain("Couldn't remove");
    // The rebuild happens on the failure path too, or the tree keeps showing a
    // row whose folder may be half-gone.
    expect(gitCalls("list").length).toBeGreaterThan(listsBefore);
  });

  it("[I15] reports a success git and the filesystem disagree about as indeterminate", async () => {
    // Round-1 B7: the timeout fixture moved BOTH sources together, so I15's second clause —
    // "a state git and the filesystem disagree about is reported as indeterminate, never as
    // a clean failure" — had no test at all. Here git exits 0 and the registration survives.
    removeLeavesRegistration = true;
    await assemble();

    clickItem(openMenu("feature"), /remove/i);
    await settle();
    confirmRemoval("feature");
    await settle();

    expect(gitCalls("remove")).toEqual([["worktree", "remove", LINKED]]);
    expect(document.body.textContent).toContain("partly applied");
    expect(document.body.textContent).toContain("is still registered");
    // Not the success the exit code claimed, and not a clean failure either.
    expect(document.body.textContent).not.toContain("Remove done.");
    expect(document.body.textContent).not.toContain("Couldn't remove");
  });

  it("never posts presence for a worktree the paired tree does not carry", async () => {
    publishedRow = agentRowFixture();
    await assemble();
    await settleUntil(() => posted.some((m) => m.type === "worktreeTreeResponse"), "a tree envelope");

    const envelopes = posted.filter((m) => m.type === "worktreeTreeResponse");
    expect(envelopes.length).toBeGreaterThan(0);
    // Round-1 B8: the subset relation is satisfied by an empty presence map, so dropping
    // every row passed this test. Both halves have to be populated before the relation
    // says anything, and at least one envelope has to carry the row we seeded.
    let paired = 0;
    for (const envelope of envelopes) {
      const ids = new Set(treeIds(envelope));
      const named = Object.keys(
        (envelope as Extract<ExtensionToWebViewMessage, { type: "worktreeTreeResponse" }>).presence.rowsByWorktreeId,
      );
      // Atomicity is structural here — one message carries both — and this is
      // what asserts the structure has not been split behind the invariant.
      expect(named.filter((id) => !ids.has(id))).toEqual([]);
      if (ids.has(LINKED) && named.includes(LINKED)) {
        paired++;
      }
    }
    expect(paired, "no envelope carried both the worktree and its presence row").toBeGreaterThan(0);
  });
});

/** A window-scoped agent row under the linked worktree, built by the shipped fixture. */
function agentRowFixture(): WorktreeAgentRow {
  return agentRow({ rowId: "row-1", paneId: "pane-1", viewId: "view-1", title: "worktree walk", agent: "claude" });
}
