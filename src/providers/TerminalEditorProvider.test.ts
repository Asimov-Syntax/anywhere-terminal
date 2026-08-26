// src/providers/TerminalEditorProvider.test.ts — Unit tests for TerminalEditorProvider
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";

// Mock PtyManager so no real PTY is spawned
vi.mock("../pty/PtyManager", () => ({
  loadNodePty: vi.fn(() => ({
    spawn: vi.fn(() => ({
      onData: vi.fn(() => ({ dispose: () => {} })),
      onExit: vi.fn(() => ({ dispose: () => {} })),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      pid: 12345,
      process: "zsh",
    })),
  })),
  detectShell: vi.fn(() => ({ shell: "/bin/zsh", args: ["--login"] })),
  buildEnvironment: vi.fn(() => ({ PATH: "/usr/bin" })),
  resolveWorkingDirectory: vi.fn(() => "/tmp"),
}));

// Mock PtySession
vi.mock("../pty/PtySession", () => {
  class MockPtySession {
    id: string;
    spawn = vi.fn();
    write = vi.fn();
    resize = vi.fn();
    kill = vi.fn();
    pause = vi.fn();
    resume = vi.fn();
    setShellIntegrationSink = vi.fn();
    setShellIntegrationNonce = vi.fn();
    onData: ((data: string) => void) | null = null;
    onExit: ((code: number) => void) | null = null;
    constructor(id: string) {
      this.id = id;
    }
  }
  return { PtySession: MockPtySession };
});

// Mock OutputBuffer
vi.mock("../session/OutputBuffer", () => {
  class MockOutputBuffer {
    append = vi.fn();
    handleAck = vi.fn();
    dispose = vi.fn();
    constructor(
      public _tabId: string,
      public _webview: unknown,
      public _pty: unknown,
    ) {}
  }
  return { OutputBuffer: MockOutputBuffer };
});

vi.mock("./openFileLink", () => ({
  openFileLink: vi.fn(async () => {}),
}));

import { SessionManager } from "../session/SessionManager";
import { FileTreeHost } from "./fileTreeHost";
import { openFileLink } from "./openFileLink";
import { TerminalEditorProvider } from "./TerminalEditorProvider";

// ─── Test Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  __resetAll();
  __setAppRoot("/mock/vscode/app");
  __setWorkspaceFolders([{ uri: { fsPath: "/mock/workspace" } }]);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Helper ─────────────────────────────────────────────────────────

function createMockContext() {
  return {
    extensionUri: { fsPath: "/mock/extension" },
    subscriptions: [],
  } as unknown as import("vscode").ExtensionContext;
}

// ─── createPanel ────────────────────────────────────────────────────

describe("TerminalEditorProvider.createPanel", () => {
  it("returns a Disposable", () => {
    const ctx = createMockContext();
    const sm = new SessionManager();
    const disposable = TerminalEditorProvider.createPanel(ctx, sm);

    expect(disposable).toBeDefined();
    expect(typeof disposable.dispose).toBe("function");

    sm.dispose();
  });

  it("creates a panel that responds to ready message by sending init", async () => {
    const ctx = createMockContext();
    const sm = new SessionManager();

    // Spy on createWebviewPanel to capture the panel
    const vscode = await import("vscode");
    const createSpy = vi.spyOn(vscode.window, "createWebviewPanel");

    TerminalEditorProvider.createPanel(ctx, sm);

    expect(createSpy).toHaveBeenCalledWith(
      "anywhereTerminal.editor",
      "Terminal",
      expect.anything(),
      expect.objectContaining({
        enableScripts: true,
        retainContextWhenHidden: true,
      }),
    );

    sm.dispose();
  });

  it("sets data-terminal-location=editor in HTML", async () => {
    const ctx = createMockContext();
    const sm = new SessionManager();

    const vscode = await import("vscode");
    const createSpy = vi.spyOn(vscode.window, "createWebviewPanel");

    TerminalEditorProvider.createPanel(ctx, sm);

    // The panel's webview.html should contain the location attribute
    const panel = createSpy.mock.results[0].value;
    expect(panel.webview.html).toContain('data-terminal-location="editor"');

    sm.dispose();
  });

  it("sets CSP with nonce in HTML", async () => {
    const ctx = createMockContext();
    const sm = new SessionManager();

    const vscode = await import("vscode");
    const createSpy = vi.spyOn(vscode.window, "createWebviewPanel");

    TerminalEditorProvider.createPanel(ctx, sm);

    const panel = createSpy.mock.results[0].value;
    expect(panel.webview.html).toContain("Content-Security-Policy");
    expect(panel.webview.html).toMatch(/nonce-[a-f0-9]{32}/);

    sm.dispose();
  });

  it("spawns PTY on ready message and sends init", async () => {
    const ctx = createMockContext();
    const sm = new SessionManager();

    const vscode = await import("vscode");
    const createSpy = vi.spyOn(vscode.window, "createWebviewPanel");

    TerminalEditorProvider.createPanel(ctx, sm);

    const panel = createSpy.mock.results[0].value;
    const postMessageSpy = vi.spyOn(panel.webview, "postMessage");

    // Simulate webview sending 'ready'
    for (const handler of panel.__messageHandlers) {
      handler({ type: "ready" });
    }

    // Should have sent 'init' message
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "init",
        tabs: expect.arrayContaining([
          expect.objectContaining({
            name: "Terminal 1",
            isActive: true,
          }),
        ]),
        config: expect.objectContaining({
          fontSize: 14,
          cursorBlink: true,
          scrollback: 10000,
        }),
      }),
    );

    sm.dispose();
  });

  it("cleans up PTY on panel dispose", async () => {
    const ctx = createMockContext();
    const sm = new SessionManager();

    const vscode = await import("vscode");
    const createSpy = vi.spyOn(vscode.window, "createWebviewPanel");

    TerminalEditorProvider.createPanel(ctx, sm);

    const panel = createSpy.mock.results[0].value;

    // Trigger ready to create PTY session
    for (const handler of panel.__messageHandlers) {
      handler({ type: "ready" });
    }

    // Dispose the panel — should not throw
    expect(() => panel.dispose()).not.toThrow();

    sm.dispose();
  });

  it("creates independent panels on multiple invocations", () => {
    const ctx = createMockContext();
    const sm = new SessionManager();
    const d1 = TerminalEditorProvider.createPanel(ctx, sm);
    const d2 = TerminalEditorProvider.createPanel(ctx, sm);

    expect(d1).not.toBe(d2);

    // Clean up
    d1.dispose();
    d2.dispose();
    sm.dispose();
  });

  it("forwards an openFile message to openFileLink with the expected deps shape", async () => {
    const ctx = createMockContext();
    const sm = new SessionManager();
    const vscode = await import("vscode");
    const createSpy = vi.spyOn(vscode.window, "createWebviewPanel");

    TerminalEditorProvider.createPanel(ctx, sm);

    const panel = createSpy.mock.results[0].value;
    // Initialize session via ready
    for (const handler of panel.__messageHandlers) {
      handler({ type: "ready" });
    }

    (openFileLink as unknown as ReturnType<typeof vi.fn>).mockClear();

    const openFileMsg = {
      type: "openFile" as const,
      path: "src/foo.ts",
      sessionId: "sess-EDITOR",
      line: 7,
    };
    for (const handler of panel.__messageHandlers) {
      handler(openFileMsg);
    }

    expect(openFileLink).toHaveBeenCalledTimes(1);
    const [msgArg, depsArg] = (openFileLink as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(msgArg).toEqual(openFileMsg);
    expect(depsArg).toEqual(
      expect.objectContaining({
        getInitialCwd: expect.any(Function),
        getCurrentCwd: expect.any(Function),
        getLiveCwd: expect.any(Function),
        stat: expect.any(Function),
        findFiles: expect.any(Function),
        showWarning: expect.any(Function),
        showError: expect.any(Function),
        showTextDocument: expect.any(Function),
        showQuickPick: expect.any(Function),
      }),
    );

    sm.dispose();
  });

  it("delegates all file-tree path action messages to FileTreeHost", async () => {
    const spy = vi.spyOn(FileTreeHost.prototype, "handleMessage").mockReturnValue(true);
    const ctx = createMockContext();
    const sm = new SessionManager();
    const vscode = await import("vscode");
    const createSpy = vi.spyOn(vscode.window, "createWebviewPanel");

    TerminalEditorProvider.createPanel(ctx, sm);
    const panel = createSpy.mock.results[0].value;

    const messages = [
      { type: "file-tree-reveal-in-os", rootGeneration: 0, path: "/mock/workspace/a.ts" },
      { type: "file-tree-copy-path", rootGeneration: 0, path: "/mock/workspace/a.ts" },
      { type: "file-tree-copy-relative-path", rootGeneration: 0, path: "/mock/workspace/a.ts" },
      { type: "file-tree-delete", rootGeneration: 0, path: "/mock/workspace/a.ts" },
    ] as const;

    for (const msg of messages) {
      for (const handler of panel.__messageHandlers) {
        handler(msg);
      }
    }

    expect(spy).toHaveBeenCalledTimes(4);
    expect(spy.mock.calls.map(([msg]) => (msg as { type: string }).type)).toEqual(messages.map((msg) => msg.type));

    sm.dispose();
  });
});

// The editor panel subscribes to view-state changes BEFORE it attaches its
// worktree surface, so the handler closes over a binding assigned later. If that
// ordering ever breaks the panel silently stops reporting and the host, which
// pushes only to a surface the window displays, goes quiet forever.
describe("TerminalEditorProvider — worktree display reporting", () => {
  function recordingHost() {
    const reported: boolean[] = [];
    return {
      reported,
      host: {
        initPayload: () => ({ worktreeHasRepo: false }),
        attach: () => ({ dispose: () => {}, setDisplayed: (d: boolean) => reported.push(d) }),
        handleMessage: () => {},
        dispose: () => {},
      },
    };
  }

  it("seeds from the panel and reports every view-state change after it", async () => {
    const ctx = createMockContext();
    const sm = new SessionManager();
    const vscode = await import("vscode");
    const createSpy = vi.spyOn(vscode.window, "createWebviewPanel");
    const { host, reported } = recordingHost();

    TerminalEditorProvider.createPanel(
      ctx,
      sm,
      null,
      null,
      host as unknown as Parameters<typeof TerminalEditorProvider.createPanel>[4],
    );

    const panel = createSpy.mock.results[0]?.value as {
      visible: boolean;
      __viewStateHandlers: Array<(e: { webviewPanel: { visible: boolean } }) => void>;
    };
    // Seeded at attach: a panel created already active fires no event.
    expect(reported).toEqual([true]);

    for (const visible of [false, true]) {
      panel.visible = visible;
      for (const h of panel.__viewStateHandlers) {
        h({ webviewPanel: { visible } });
      }
    }

    expect(reported).toEqual([true, false, true]);
    sm.dispose();
  });
});
