// src/providers/TerminalViewProvider.worktree.test.ts — the surface wiring:
// one window-scoped host, every provider a surface of it
// (cache-and-broadcast-worktree-tree 4_1).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __fireConfigChange,
  __resetAll,
  __setAppRoot,
  __setConfigValues,
  __setWorkspaceFolders,
} from "../test/__mocks__/vscode";

vi.mock("../pty/PtyManager", () => ({
  loadNodePty: vi.fn(() => ({ spawn: vi.fn() })),
  detectShell: vi.fn(() => ({ shell: "/bin/zsh", args: [] })),
  buildEnvironment: vi.fn(() => ({})),
  resolveWorkingDirectory: vi.fn(() => "/tmp"),
}));
vi.mock("../pty/PtySession", () => ({ PtySession: class {} }));
vi.mock("../session/OutputBuffer", () => ({ OutputBuffer: class {} }));

import type * as vscode from "vscode";
import * as vscodeApi from "vscode";
import { SessionManager } from "../session/SessionManager";
import { WORKTREE_MESSAGE_TYPES } from "../types/messages";
import { createGitCapabilities } from "../worktree/gitCapabilities";
import type { GitCommandResult, GitCommandRunner } from "../worktree/gitCommandRunner";
import type { GitApiAccessor } from "../worktree/repoRoots";
import type { WorktreeTreeDeps } from "../worktree/WorktreeDiscovery";
import { TerminalEditorProvider } from "./TerminalEditorProvider";
import { TerminalPanelSerializer } from "./TerminalPanelSerializer";
import { TerminalViewProvider } from "./TerminalViewProvider";
import { createWorktreeHost, type WorktreeHost, type WorktreeSurface } from "./WorktreeHost";

beforeEach(() => {
  __resetAll();
  __setAppRoot("/mock/vscode/app");
  __setWorkspaceFolders([{ uri: { fsPath: "/repo" } }]);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** One repository at `/repo` with a main worktree and one linked worktree. */
function gitDeps(): { deps: WorktreeTreeDeps; run: ReturnType<typeof vi.fn> } {
  const records = [
    ["worktree /repo", "HEAD abc", "branch refs/heads/main"],
    ["worktree /repo-wt/feat", "HEAD def", "branch refs/heads/feat"],
  ];
  const run = vi.fn(async (args: readonly string[]): Promise<GitCommandResult> => {
    const base = { code: 0, stderr: "", timedOut: false, failedToSpawn: false };
    if (args[0] === "--version") {
      return { ...base, stdout: Buffer.from("git version 2.50.1\n") };
    }
    if (args[0] === "worktree") {
      return {
        ...base,
        stdout: Buffer.from(records.map((f) => `${f.map((x) => `${x}\0`).join("")}\0`).join("")),
      };
    }
    return { ...base, stdout: Buffer.from("/repo/.git\n") };
  });
  const runner = { run } as unknown as GitCommandRunner;
  return {
    run,
    deps: {
      runner,
      capabilities: createGitCapabilities(runner),
      normalize: async (p: string) => p.replace(/\/+$/, "") || "/",
      stat: async () => undefined,
      getGitApi: (() =>
        ({
          state: "initialized",
          repositories: [{ rootUri: { fsPath: "/repo" } }],
        }) as ReturnType<GitApiAccessor>) as GitApiAccessor,
    },
  };
}

/** Mount one provider as a surface of `host`, returning its webview seams. */
function mountSurface(host: WorktreeHost, location: "sidebar" | "panel") {
  const sessions = new SessionManager();
  const provider = new TerminalViewProvider(
    { fsPath: "/mock/extension" } as vscode.Uri,
    sessions,
    location,
    null,
    null,
    null,
    null,
    null,
    host,
  );
  const handlers: Array<(msg: unknown) => void> = [];
  const disposeHandlers: Array<() => void> = [];
  const visibilityHandlers: Array<() => void> = [];
  const postMessage = vi.fn((_msg: unknown) => Promise.resolve(true));
  const webviewView = {
    visible: true,
    viewType: `anywhereTerminal.${location}`,
    webview: {
      html: "",
      options: {},
      cspSource: "https://mock.csp.source",
      asWebviewUri: (uri: { fsPath: string }) => uri.fsPath,
      onDidReceiveMessage: (h: (msg: unknown) => void) => {
        handlers.push(h);
        return { dispose: () => {} };
      },
      postMessage,
    },
    onDidChangeVisibility: (h: () => void) => {
      visibilityHandlers.push(h);
      return { dispose: () => {} };
    },
    onDidDispose: (h: () => void) => {
      disposeHandlers.push(h);
      return { dispose: () => {} };
    },
  } as unknown as vscode.WebviewView;

  provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

  return {
    send: (msg: unknown) => {
      for (const h of handlers) {
        h(msg);
      }
    },
    closeWebview: () => {
      for (const h of disposeHandlers) {
        h();
      }
    },
    /** Move what VS Code reports about this view, then fire its event. */
    setWindowVisible: (visible: boolean) => {
      (webviewView as unknown as { visible: boolean }).visible = visible;
      for (const h of visibilityHandlers) {
        h();
      }
    },
    trees: () => postMessage.mock.calls.filter(([m]) => (m as { type?: string }).type === "worktreeTreeResponse"),
    /** Everything the extension pushed to this view, in order. */
    posts: (type: string) =>
      postMessage.mock.calls.map(([m]) => m as Record<string, unknown>).filter((m) => m.type === type),
    forget: () => postMessage.mockClear(),
    /** The raw delivery mock — lets a test make an attempt fail. */
    postMessage,
    /** Every push in order, by type, for asserting relative ordering. */
    postTypes: () => postMessage.mock.calls.map(([m]) => (m as { type?: string }).type ?? ""),
    dispose: () => sessions.dispose(),
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const pool = { subscribePattern: () => ({ active: true, dispose: () => {} }) };

function makeHost(deps: WorktreeTreeDeps): WorktreeHost {
  return createWorktreeHost({
    deps,
    workspaceFolders: () => ["/repo"],
    pool,
  });
}

describe("TerminalViewProvider — worktree surface", () => {
  it("answers a request only after the surface declares the view visible", async () => {
    const { deps } = gitDeps();
    const host = makeHost(deps);
    const view = mountSurface(host, "sidebar");
    view.send({ type: "ready" });
    await settle();

    view.send({ type: "requestWorktreeTree" });
    await settle();
    expect(view.trees()).toHaveLength(0);

    view.send({ type: "worktreeViewVisibility", visible: true });
    view.send({ type: "requestWorktreeTree" });
    await settle();

    const message = view.trees()[0][0] as { tree: { repos: Array<{ worktrees: unknown[] }> }; presence: unknown };
    expect(message.tree.repos[0].worktrees).toHaveLength(2);
    expect(message.presence).toBeDefined();
    view.dispose();
    host.dispose();
  });

  it("broadcasts one window's tree to every visible surface, with one set of git calls", async () => {
    const { deps, run } = gitDeps();
    const host = makeHost(deps);
    const sidebar = mountSurface(host, "sidebar");
    const panel = mountSurface(host, "panel");
    for (const view of [sidebar, panel]) {
      view.send({ type: "ready" });
      view.send({ type: "worktreeViewVisibility", visible: true });
    }
    await settle();

    sidebar.send({ type: "requestWorktreeTree" });
    await settle();

    expect(sidebar.trees()).toHaveLength(1);
    expect(panel.trees()).toHaveLength(1);
    expect(run.mock.calls.filter((c) => c[0][0] === "worktree")).toHaveLength(1);
    sidebar.dispose();
    panel.dispose();
    host.dispose();
  });

  it("stops delivering to a surface whose webview was disposed", async () => {
    const { deps } = gitDeps();
    const host = makeHost(deps);
    const closing = mountSurface(host, "sidebar");
    const kept = mountSurface(host, "panel");
    for (const view of [closing, kept]) {
      view.send({ type: "ready" });
      view.send({ type: "worktreeViewVisibility", visible: true });
    }
    await settle();

    closing.closeWebview();
    kept.send({ type: "requestWorktreeTree" });
    await settle();

    expect(closing.trees()).toHaveLength(0);
    expect(kept.trees()).toHaveLength(1);
    closing.dispose();
    kept.dispose();
    host.dispose();
  });

  it("works without a host wired, as tests and older call sites construct it", async () => {
    const sessions = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sessions, "sidebar");
    const handlers: Array<(msg: unknown) => void> = [];
    const webviewView = {
      visible: true,
      viewType: "anywhereTerminal.sidebar",
      webview: {
        html: "",
        options: {},
        cspSource: "https://mock.csp.source",
        asWebviewUri: (uri: { fsPath: string }) => uri.fsPath,
        onDidReceiveMessage: (h: (msg: unknown) => void) => {
          handlers.push(h);
          return { dispose: () => {} };
        },
        postMessage: vi.fn(() => Promise.resolve(true)),
      },
      onDidChangeVisibility: () => ({ dispose: () => {} }),
      onDidDispose: () => ({ dispose: () => {} }),
    } as unknown as vscode.WebviewView;

    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const h of handlers) {
      h({ type: "requestWorktreeTree" });
    }
    await settle();

    sessions.dispose();
  });
});

// The window's own answer, not the webview's. `retainContextWhenHidden` keeps the
// declaration alive across a hide, so this is the only signal that falsifies it.
describe("TerminalViewProvider — a view the window has hidden", () => {
  it("stops receiving pushes, and is brought up to date when shown again", async () => {
    const { deps } = gitDeps();
    const host = makeHost(deps);
    const view = mountSurface(host, "sidebar");
    view.send({ type: "ready" });
    view.send({ type: "worktreeViewVisibility", visible: true });
    view.send({ type: "requestWorktreeTree" });
    await settle();
    const served = view.trees().length;
    expect(served).toBeGreaterThan(0);

    view.setWindowVisible(false);
    view.send({ type: "requestWorktreeTree", force: true });
    await settle();
    // The rebuild ran; nobody could see the panel, so nothing was serialized into it.
    expect(view.trees()).toHaveLength(served);

    view.setWindowVisible(true);
    await settle();

    // Shown again, and current — without the webview having to ask.
    expect(view.trees()).toHaveLength(served + 1);
    view.dispose();
  });
});

// ─── Expansion requests ─────────────────────────────────────────────
//
// Both provider switches enumerate the worktree message types by hand, so a new
// type compiles, ships, and is silently dropped at the surface — which is what
// happened to `requestWorktreeSubagents` (round-1 B1). The claim under test is
// delivery: the message reaches the host, named with the surface it came from.

/** A host that records what reached it, standing in for the window's real one. */
function recordingHost(): { host: WorktreeHost; routed: ReturnType<typeof vi.fn> } {
  const routed = vi.fn();
  const host: WorktreeHost = {
    initPayload: () => ({ worktreeHasRepo: false }),
    attach: () => ({ setDisplayed: () => {}, dispose: () => {} }),
    handleMessage: routed,
    dispose: () => {},
  };
  return { host, routed };
}

function panelSeam(): { panel: vscode.WebviewPanel; handlers: Array<(msg: unknown) => void> } {
  const handlers: Array<(msg: unknown) => void> = [];
  const panel = {
    visible: true,
    active: true,
    viewColumn: 1,
    title: "Terminal",
    webview: {
      html: "",
      options: {},
      cspSource: "https://mock.csp.source",
      asWebviewUri: (uri: { fsPath: string }) => uri.fsPath,
      onDidReceiveMessage: (h: (msg: unknown) => void) => {
        handlers.push(h);
        return { dispose: () => {} };
      },
      postMessage: vi.fn(() => Promise.resolve(true)),
    },
    onDidDispose: () => ({ dispose: () => {} }),
    onDidChangeViewState: () => ({ dispose: () => {} }),
    reveal: vi.fn(),
    dispose: vi.fn(),
  } as unknown as vscode.WebviewPanel;
  return { panel, handlers };
}

function mockContext(): vscode.ExtensionContext {
  return { extensionUri: { fsPath: "/mock/extension" }, subscriptions: [] } as unknown as vscode.ExtensionContext;
}

function surfaceOf(handlers: Array<(msg: unknown) => void>, sessions: SessionManager) {
  return {
    send: (msg: unknown) => {
      for (const h of handlers) {
        h(msg);
      }
    },
    dispose: () => sessions.dispose(),
  };
}

/** An editor panel VS Code created directly. */
function mountEditorSurface(host: WorktreeHost) {
  const sessions = new SessionManager();
  const { panel, handlers } = panelSeam();
  vi.spyOn(vscodeApi.window, "createWebviewPanel").mockReturnValue(panel);
  TerminalEditorProvider.createPanel(mockContext(), sessions, null, null, host, null);
  return surfaceOf(handlers, sessions);
}

/**
 * An editor panel VS Code revived after a window reload. A distinct construction
 * path — `TerminalPanelSerializer` never touches `createPanel` — so a host
 * threaded only through the direct path would leave every restored editor's
 * expansion inert (round 2 W2).
 */
async function mountRevivedEditorSurface(host: WorktreeHost) {
  const sessions = new SessionManager();
  const { panel, handlers } = panelSeam();
  const serializer = new TerminalPanelSerializer(mockContext(), sessions, null, null, host, null);
  await serializer.deserializeWebviewPanel(panel, { panelId: "panel-1" });
  return surfaceOf(handlers, sessions);
}

const EXPANSION = { type: "requestWorktreeSubagents", rowId: "window:a", entryId: "claude:s1" };

type Surface = { send: (msg: unknown) => void; dispose: () => void };

/** A minimal well-formed message of each worktree type, keyed by type. */
const SAMPLE: Record<(typeof WORKTREE_MESSAGE_TYPES)[number], Record<string, unknown>> = {
  requestWorktreeTree: { type: "requestWorktreeTree" },
  requestWorktreeSubagents: EXPANSION,
  worktreeViewVisibility: { type: "worktreeViewVisibility", visible: true },
  worktreeOpenFolder: { type: "worktreeOpenFolder", worktreeId: "/repo-wt/feat", mode: "newWindow" },
  worktreeRevealInOS: { type: "worktreeRevealInOS", worktreeId: "/repo-wt/feat" },
  worktreeCopyPath: { type: "worktreeCopyPath", worktreeId: "/repo-wt/feat" },
  worktreeOpenTerminal: { type: "worktreeOpenTerminal", worktreeId: "/repo-wt/feat" },
  worktreeFocusPane: { type: "worktreeFocusPane", rowId: "window:a", paneId: "pane-1" },
  worktreeOpenPreview: { type: "worktreeOpenPreview", rowId: "window:a", entryId: "claude:s1" },
  worktreeCopyResumeCommand: { type: "worktreeCopyResumeCommand", rowId: "window:a", entryId: "claude:s1" },
  worktreeRevealAgentCwd: { type: "worktreeRevealAgentCwd", rowId: "window:a", entryId: "claude:s1" },
  worktreeCopyAgentPath: { type: "worktreeCopyAgentPath", rowId: "window:a", entryId: "claude:s1" },
};

describe("every worktree message type routes through every surface", () => {
  // Driven from WORKTREE_MESSAGE_TYPES, so a type declared later without a route
  // fails THIS test rather than needing a new one — which is the failure the
  // enumerated switches produced: `requestWorktreeSubagents` was declared,
  // posted and handled, and reached neither provider (design.md D7).
  const mounts: Array<[string, (host: WorktreeHost) => Surface | Promise<Surface>]> = [
    ["sidebar", (host) => mountSurface(host, "sidebar")],
    ["bottom panel", (host) => mountSurface(host, "panel")],
    ["editor panel", (host) => mountEditorSurface(host)],
    ["revived editor panel", (host) => mountRevivedEditorSurface(host)],
  ];

  for (const [name, mount] of mounts) {
    it(`routes every declared worktree type from the ${name}`, async () => {
      const { host, routed } = recordingHost();
      const surface = await mount(host);

      for (const type of WORKTREE_MESSAGE_TYPES) {
        surface.send(SAMPLE[type]);
      }

      expect(routed.mock.calls.map((c) => (c[1] as { type: string }).type)).toEqual([...WORKTREE_MESSAGE_TYPES]);
      surface.dispose();
    });
  }

  it("does not route a message that is not the worktree host's", () => {
    // `paneEvidence` is window state with its own store, and the guard is a name
    // test — so the one inbound type that looks adjacent must stay out of it.
    const { host, routed } = recordingHost();
    const surface = mountSurface(host, "sidebar");

    surface.send({ type: "paneEvidence", paneId: "pane-1", title: "Fix tests", decorated: false });

    expect(routed).not.toHaveBeenCalled();
    surface.dispose();
  });
});

describe("the row-activation setting reaches the view", () => {
  // Read host-side because the webview has no `workspace.getConfiguration`.
  // Carried in `init` so the first click cannot race a request, and pushed on
  // change so a view already open does not need reopening (design.md D5).

  /**
   * A view that has reached `init`. The first-run branch of `onReady` spawns a
   * PTY, which no test here can do, so this takes the re-attach branch instead —
   * it posts the same `init` payload.
   */
  async function readyView(): Promise<ReturnType<typeof mountSurface> & { close: () => void }> {
    const spy = vi.spyOn(SessionManager.prototype, "getAllSessionsForView").mockReturnValue([{ id: "t1" }] as never);
    const view = mountSurface(recordingHost().host, "sidebar");
    view.send({ type: "ready" });
    await settle();
    return Object.assign(view, {
      close: () => {
        spy.mockRestore();
        view.dispose();
      },
    });
  }

  it("carries the configured value in init", async () => {
    __setConfigValues({ "anywhereTerminal.worktree.rowActivation": "preview" });
    const view = await readyView();

    expect(view.posts("init")[0]?.worktreeRowActivation).toBe("preview");
    view.close();
  });

  it("falls back to focus for a value the view cannot render", async () => {
    // A hand-edited settings.json, or a downgrade from a later enum, must not
    // travel as a mode with no renderer behind it.
    for (const stored of [undefined, "sideways", 7]) {
      __setConfigValues(stored === undefined ? {} : { "anywhereTerminal.worktree.rowActivation": stored });
      const view = await readyView();

      expect(view.posts("init")[0]?.worktreeRowActivation, `stored: ${String(stored)}`).toBe("focus");
      view.close();
    }
  });

  it("reaches a view that is already open when the setting changes", async () => {
    __setConfigValues({ "anywhereTerminal.worktree.rowActivation": "focus" });
    const view = await readyView();
    view.forget();

    __setConfigValues({ "anywhereTerminal.worktree.rowActivation": "preview" });
    __fireConfigChange(["anywhereTerminal.worktree.rowActivation"]);
    await settle();

    // `forget()` cleared the post-init re-send, so this is the change alone.
    expect(view.posts("worktreeRowActivation")).toEqual([{ type: "worktreeRowActivation", activation: "preview" }]);
    view.close();
  });

  it("stays quiet for a configuration change that is not this setting", async () => {
    __setConfigValues({ "anywhereTerminal.worktree.rowActivation": "focus" });
    const view = await readyView();
    view.forget();

    __fireConfigChange(["anywhereTerminal.fontSize"]);
    await settle();

    expect(view.posts("worktreeRowActivation")).toEqual([]);
    view.close();
  });

  it("reaches an editor panel too, which owns its own listener", async () => {
    __setConfigValues({ "anywhereTerminal.worktree.rowActivation": "focus" });
    const spy = vi.spyOn(SessionManager.prototype, "getAllSessionsForView").mockReturnValue([{ id: "t1" }] as never);
    const sessions = new SessionManager();
    const { panel, handlers } = panelSeam();
    vi.spyOn(vscodeApi.window, "createWebviewPanel").mockReturnValue(panel);
    TerminalEditorProvider.createPanel(mockContext(), sessions, null, null, recordingHost().host, null);
    for (const h of handlers) {
      h({ type: "ready" });
    }
    await settle();

    __setConfigValues({ "anywhereTerminal.worktree.rowActivation": "preview" });
    __fireConfigChange(["anywhereTerminal.worktree.rowActivation"]);
    await settle();

    const posted = (panel.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls
      .map(([m]) => m as Record<string, unknown>)
      .filter((m) => m.type === "worktreeRowActivation");
    // The first is the post-init re-send (W2); the change itself is the last.
    expect(posted.at(-1)).toEqual({ type: "worktreeRowActivation", activation: "preview" });
    spy.mockRestore();
    sessions.dispose();
  });

  it("re-sends the setting after init, so an update that raced it is not lost", async () => {
    // `_ready` flips before init is delivered and the webview builds its worktree
    // controller only when init arrives, so an update posted in that window is
    // dropped and then overwritten by the value init carried (round-1 W2).
    __setConfigValues({ "anywhereTerminal.worktree.rowActivation": "preview" });
    const view = await readyView();

    const inits = view.posts("init");
    const updates = view.posts("worktreeRowActivation");
    expect(inits).toHaveLength(1);
    expect(updates).toEqual([{ type: "worktreeRowActivation", activation: "preview" }]);
    view.close();
  });

  it("does not push to a view that never became ready", async () => {
    // Posting before `init` would land in a webview with no router attached.
    __setConfigValues({ "anywhereTerminal.worktree.rowActivation": "focus" });
    const view = mountSurface(recordingHost().host, "sidebar");

    __setConfigValues({ "anywhereTerminal.worktree.rowActivation": "preview" });
    __fireConfigChange(["anywhereTerminal.worktree.rowActivation"]);
    await settle();

    expect(view.posts("worktreeRowActivation")).toEqual([]);
    view.dispose();
  });
});

describe("a terminal request creates a pane in the surface that asked", () => {
  // The one capability the extension cannot supply: creating a pane needs a view
  // id and a webview, which only the provider owning the surface holds, so it
  // rides `WorktreeSurface` rather than the host's injected actions (D2). What
  // is pinned here is that each provider actually implements it.
  it("is implemented by a view surface", () => {
    const { host } = recordingHost();
    let captured: WorktreeSurface | undefined;
    const spy: WorktreeHost = {
      initPayload: () => host.initPayload(),
      handleMessage: (surface, msg) => host.handleMessage(surface, msg),
      dispose: () => host.dispose(),
      attach: (surface) => {
        captured = surface;
        return { setDisplayed: () => {}, dispose: () => {} };
      },
    };
    const view = mountSurface(spy, "sidebar");

    expect(typeof captured?.openTerminal).toBe("function");
    view.dispose();
  });

  it("is implemented by an editor surface", () => {
    const { host } = recordingHost();
    let captured: WorktreeSurface | undefined;
    const spy: WorktreeHost = {
      initPayload: () => host.initPayload(),
      handleMessage: (surface, msg) => host.handleMessage(surface, msg),
      dispose: () => host.dispose(),
      attach: (surface) => {
        captured = surface;
        return { setDisplayed: () => {}, dispose: () => {} };
      },
    };
    const editor = mountEditorSurface(spy);

    expect(typeof captured?.openTerminal).toBe("function");
    editor.dispose();
  });
});

describe("an expansion request reaches the host from every surface", () => {
  const cases: Array<[string, (host: WorktreeHost) => Surface | Promise<Surface>]> = [
    ["sidebar", (host) => mountSurface(host, "sidebar")],
    ["bottom panel", (host) => mountSurface(host, "panel")],
    ["editor panel", (host) => mountEditorSurface(host)],
    ["revived editor panel", (host) => mountRevivedEditorSurface(host)],
  ];

  for (const [name, mount] of cases) {
    it(`forwards it from the ${name}`, async () => {
      const { host, routed } = recordingHost();
      const surface = await mount(host);

      surface.send(EXPANSION);

      expect(routed).toHaveBeenCalledTimes(1);
      expect(routed.mock.calls[0][1]).toEqual(EXPANSION);
      // Named with its own surface, so the host answers this one, not the window.
      expect(routed.mock.calls[0][0]).toBeDefined();
      surface.dispose();
    });
  }
});

describe("cold-created surfaces order activation after init", () => {
  it("does not let the activation post overtake a retried init", async () => {
    // The reloaded and restored branches already await delivery. A cold create
    // did not: if init's first attempt failed, the activation post went out
    // immediately, reached a webview with no controller yet, and was dropped —
    // leaving the surface on whatever the retried init carried (round-2 W2).
    vi.spyOn(SessionManager.prototype, "createSession").mockReturnValue(undefined as never);
    vi.spyOn(SessionManager.prototype, "getTabsForView").mockReturnValue([] as never);
    const { deps } = gitDeps();
    const view = mountSurface(makeHost(deps), "sidebar");
    // Fail the FIRST init only — `themeChanged` and `hoverPreviewSettings` are
    // pushed before it, so a bare mockImplementationOnce would land on those.
    let initAttempts = 0;
    view.postMessage.mockImplementation((msg: unknown) => {
      if ((msg as { type?: string }).type === "init") {
        initAttempts += 1;
        return Promise.resolve(initAttempts > 1);
      }
      return Promise.resolve(true);
    });

    view.send({ type: "ready" });
    // Past the 50ms retry sleep, so the retry that actually lands is observed.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await settle();

    // The first init ATTEMPT is synchronous either way, so the telling order is
    // against the retry that actually landed: activation must follow the last
    // init push, not sit between the failed attempt and its retry.
    const types = view.postTypes();
    expect(types.filter((t) => t === "init")).toHaveLength(2);
    expect(types.indexOf("worktreeRowActivation")).toBeGreaterThan(types.lastIndexOf("init"));
    view.dispose();
  });
});
