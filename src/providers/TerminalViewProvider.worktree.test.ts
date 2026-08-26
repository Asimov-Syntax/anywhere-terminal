// src/providers/TerminalViewProvider.worktree.test.ts — the surface wiring:
// one window-scoped host, every provider a surface of it
// (cache-and-broadcast-worktree-tree 4_1).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";

vi.mock("../pty/PtyManager", () => ({
  loadNodePty: vi.fn(() => ({ spawn: vi.fn() })),
  detectShell: vi.fn(() => ({ shell: "/bin/zsh", args: [] })),
  buildEnvironment: vi.fn(() => ({})),
  resolveWorkingDirectory: vi.fn(() => "/tmp"),
}));
vi.mock("../pty/PtySession", () => ({ PtySession: class {} }));
vi.mock("../session/OutputBuffer", () => ({ OutputBuffer: class {} }));

import type * as vscode from "vscode";
import { SessionManager } from "../session/SessionManager";
import { createGitCapabilities } from "../worktree/gitCapabilities";
import type { GitCommandResult, GitCommandRunner } from "../worktree/gitCommandRunner";
import type { GitApiAccessor } from "../worktree/repoRoots";
import type { WorktreeTreeDeps } from "../worktree/WorktreeDiscovery";
import { TerminalViewProvider } from "./TerminalViewProvider";
import { createWorktreeHost, type WorktreeHost } from "./WorktreeHost";

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
