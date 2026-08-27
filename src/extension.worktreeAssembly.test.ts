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
import type { WorktreeHost, WorktreeSurface } from "./providers/WorktreeHost";
import type { ExtensionToWebViewMessage, WebViewToExtensionMessage } from "./types/messages";
import type { VaultSessionEntry } from "./vault/types";
import type { CreateSessionOptions } from "./vault/VaultLauncher";
import { createMessageRouter, type MessageHandlers } from "./webview/messaging/MessageRouter";
import { WorktreeController } from "./webview/worktree/WorktreeController";
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
  // Clean: nothing at risk, so an unforced removal is not blocked.
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
        const scripted = SCRIPT[key] ?? {};
        const stdout = key === `${REPO}|worktree list --porcelain` ? listing() : (scripted.stdout ?? "");
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

const captured: { host?: WorktreeHost } = {};

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
  registered = [LINKED];
  fs.mkdirSync(LINKED, { recursive: true });
  captured.host = undefined;
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
    post: (msg: ExtensionToWebViewMessage) => route(msg),
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
      // The provider owns this one, not the host: answered here with a fixed set
      // so the walk does not depend on which agents this machine has installed.
      if (msg.type === "requestVaultLaunchTargets") {
        route({
          type: "vaultLaunchTargets",
          capability: msg.capability ?? "continue",
          targets: noStartableAgents ? [] : STARTABLE_TARGETS,
        });
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
  await settle();
  return { controller, host };
}

/** Let the host's rebuild, its git calls and the resulting push all land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
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
