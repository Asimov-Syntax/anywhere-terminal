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
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentHookRuntime } from "./agentHooks/AgentHookRuntime";
import type { WorktreeHost, WorktreeSurface } from "./providers/WorktreeHost";
import { type PaneEvidenceStore, TURN_FRESHNESS_MS } from "./session/PaneEvidenceStore";
import type { ExtensionToWebViewMessage, WebViewToExtensionMessage } from "./types/messages";
import type { VaultSessionEntry } from "./vault/types";
import type { CreateSessionOptions } from "./vault/VaultLauncher";
import { createMessageRouter, type MessageHandlers } from "./webview/messaging/MessageRouter";
import { WorktreeController } from "./webview/worktree/WorktreeController";
import { agentRow } from "./webview/worktree/worktreeFixtures";
import type { WorktreeAgentRow } from "./webview/worktree/worktreeViewTypes";

// A REAL directory: the create-path probe asks the filesystem, and a fake root
// nothing could ever occupy makes that probe untestable (round-4 B12).
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asm-assembly-")));
const REPO = path.join(TMP, "repo");
const REPO_ID = path.join(REPO, ".git");
const LINKED = path.join(TMP, "repo-wt", "feature");
fs.mkdirSync(REPO, { recursive: true });
fs.mkdirSync(LINKED, { recursive: true });

/** Every git invocation the whole assembly made, in order. */
let argv: { args: string[]; cwd: string }[] = [];

/** What this fake repository currently has registered. `worktree remove` drops from it. */
let registered: string[] = [];

/** Set by a test that needs the linked worktree to render as locked. */
let lockedRow = false;
/** Set by a test that needs git to report a stale registration.  */
let prunableRow = false;
/** Set by a test that needs the repository's listing to stop being readable. */
let listingFails = false;
/** Set by a test that needs the worktree to carry something a confirmation must name. */
let dirtyPaths: string[] = [];
/** Set by a test that needs git to be killed part-way through a removal. */
let removeTimesOut = false;

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
      record(p, "2".repeat(40), "feature", [
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
  [`${REPO}|worktree prune --dry-run --verbose`]: { stderr: "" },
};

vi.mock("./worktree/gitCommandRunner", async (importOriginal) => {
  const real = await importOriginal<typeof import("./worktree/gitCommandRunner")>();
  return {
    ...real,
    createGitCommandRunner: () => ({
      run: async (args: readonly string[], cwd: string) => {
        argv.push({ args: [...args], cwd });
        if (args[0] === "worktree" && args[1] === "remove") {
          // Real git drops the registration AND the directory; the host reads
          // both independently, so a fake that moved only one would leave every
          // removal indeterminate.
          const target = args[args.length - 1] ?? "";
          registered = registered.filter((p) => p !== target);
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

const captured: { host?: WorktreeHost; runtime?: AgentHookRuntime; paneEvidence?: PaneEvidenceStore } = {};

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
        project: async (ids: readonly string[], options?: never) => {
          const base = await inner.project(ids, options);
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

beforeEach(() => {
  argv = [];
  launched = [];
  publishedRow = null;
  noStartableAgents = false;
  lockedRow = false;
  prunableRow = false;
  listingFails = false;
  dirtyPaths = [];
  removeTimesOut = false;
  posted = [];
  outbound = [];
  registered = [LINKED];
  fs.mkdirSync(LINKED, { recursive: true });
  captured.host = undefined;
  captured.runtime = undefined;
  captured.paneEvidence = undefined;
  document.body.replaceChildren();
  vi.resetModules();
});

/**
 * The shipped extension, the shipped host, and a real webview controller wired
 * to each other exactly as production wires them: the controller's outbound
 * messages enter `host.handleMessage(surface, msg)`, and everything the host
 * posts back to that surface goes through the real `routeExtensionMessage`.
 */
async function assemble(): Promise<{ controller: WorktreeController; host: WorktreeHost }> {
  const { activate } = await import("./extension");
  const vscode = await import("./test/__mocks__/vscode");
  vscode.__resetAll();
  vscode.__setWorkspaceFolders([{ uri: { fsPath: REPO } }]);
  (vscode.extensions as { onDidChange?: unknown }).onDidChange = () => ({ dispose: () => {} });
  const win = vscode.window as Record<string, unknown>;
  win.state ??= { focused: true, active: true };
  win.onDidChangeWindowState ??= () => ({ dispose: () => {} });
  win.tabGroups ??= { all: [], onDidChangeTabs: () => ({ dispose: () => {} }) };

  await activate({
    extensionUri: { fsPath: "/mock/extension" },
    subscriptions: [],
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
  // The routing main.ts performs, on the messages this change added.
  // The terminal handlers are required by the router's type and irrelevant here;
  // only the four worktree ones carry this walk.
  const worktreeHandlers: Pick<
    MessageHandlers,
    "onWorktreeTreeResponse" | "onWorktreeCreateDefaults" | "onWorktreeMutationResult" | "onVaultLaunchTargets"
  > = {
    onWorktreeTreeResponse: (m) => controller?.handleTreeResponse(m),
    onWorktreeCreateDefaults: (m) => controller?.handleCreateDefaults(m),
    onWorktreeMutationResult: (m) => controller?.handleMutationResult(m),
    // Routed by the capability it echoes, exactly as main.ts does — the vault
    // panel gets `continue`, the worktree controller gets `start`.
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
  return { controller, host };
}

/** Let the host's rebuild, its git calls and the resulting push all land. */
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

function gitCalls(verb: string): string[][] {
  return argv.filter((c) => c.args[0] === "worktree" && c.args[1] === verb).map((c) => c.args);
}

describe("a mutating verb reaches git from the menu item a user can see", () => {
  it("renders the linked worktree the shipped discovery found", async () => {
    await assemble();
    expect(document.body.textContent).toContain("feature");
  });

  it("removes: menu item → webview message → host → coordinator → git argv", async () => {
    await assemble();
    clickItem(openMenu("feature"), /remove/i);
    await settle();
    // The unforced removal the webview posts, carried all the way down. A
    // `--force` here would mean the assessment was skipped.
    expect(gitCalls("remove")).toEqual([["worktree", "remove", LINKED]]);
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

  it("shows the removal's outcome, in the order the coordinator really produces", async () => {
    // The coordinator awaits its rebuild in a `finally`, so the tree WITHOUT the
    // row reaches this surface before the outcome does. Every earlier fix for
    // this was verified by a controller test that chose the opposite order
    // (round-4 B1) — here the order is production's, not the test's.
    await assemble();
    clickItem(openMenu("feature"), /remove/i);
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
    const ask = async (branch?: string): Promise<{ path: string; collidedWith?: string; branch?: string }> => {
      answers.length = 0;
      host.handleMessage(probe, { type: "requestWorktreeCreateDefaults", repoId: REPO_ID, branch } as never);
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
    expect(second.collidedWith).toBe(first.path);

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

  it("[I9] does not re-render, and sends nothing, for a spinner-only title change", async () => {
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
    // Same node, not merely equal markup: a replaced element is a re-render.
    expect(after).toBe(before);
    expect(outbound.length).toBe(sentBefore);
  });

  it("[I14] re-prompts instead of removing when a blocker appears after the confirmation", async () => {
    dirtyPaths = ["a.txt"];
    await assemble();

    // An unforced remove against a non-empty blocker set does not run: it comes
    // back as a notice offering the confirmation, which is what opens the dialog.
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
    confirm?.click();
    await settle();

    // The force the user authorized was for the set they were SHOWN. It is not
    // spent on a set that grew underneath it — and the user is told why, rather
    // than watching the action silently do nothing.
    expect(gitCalls("remove").filter((a) => a.includes("--force"))).toEqual([]);
    expect(document.body.textContent).toContain("changed since you confirmed");
  });

  it("[I15] reports a killed removal as indeterminate, and still rebuilds", async () => {
    removeTimesOut = true;
    await assemble();
    const listsBefore = gitCalls("list").length;

    clickItem(openMenu("feature"), /remove/i);
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

  it("never posts presence for a worktree the paired tree does not carry", async () => {
    publishedRow = agentRowFixture();
    await assemble();
    await settleUntil(() => posted.some((m) => m.type === "worktreeTreeResponse"), "a tree envelope");

    const envelopes = posted.filter((m) => m.type === "worktreeTreeResponse");
    expect(envelopes.length).toBeGreaterThan(0);
    for (const envelope of envelopes) {
      const ids = new Set(treeIds(envelope));
      const named = Object.keys(
        (envelope as Extract<ExtensionToWebViewMessage, { type: "worktreeTreeResponse" }>).presence.rowsByWorktreeId,
      );
      // Atomicity is structural here — one message carries both — and this is
      // what asserts the structure has not been split behind the invariant.
      expect(named.filter((id) => !ids.has(id))).toEqual([]);
    }
  });
});

/** A window-scoped agent row under the linked worktree, built by the shipped fixture. */
function agentRowFixture(): WorktreeAgentRow {
  return agentRow({ rowId: "row-1", paneId: "pane-1", viewId: "view-1", title: "worktree walk", agent: "claude" });
}
