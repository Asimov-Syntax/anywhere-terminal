// src/providers/TerminalViewProvider.test.ts — Unit tests for TerminalViewProvider
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";

// Track mock PtySession instances for assertions
const mockPtySessions: Array<{
  id: string;
  onData: ((data: string) => void) | undefined;
  onExit: ((code: number) => void) | undefined;
}> = [];

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
    private _onDataCallback: ((data: string) => void) | undefined;
    private _onExitCallback: ((code: number) => void) | undefined;

    get onData(): ((data: string) => void) | undefined {
      return this._onDataCallback;
    }
    set onData(cb: ((data: string) => void) | undefined) {
      this._onDataCallback = cb;
      const tracked = mockPtySessions.find((p) => p.id === this.id);
      if (tracked) {
        tracked.onData = cb;
      }
    }

    get onExit(): ((code: number) => void) | undefined {
      return this._onExitCallback;
    }
    set onExit(cb: ((code: number) => void) | undefined) {
      this._onExitCallback = cb;
      const tracked = mockPtySessions.find((p) => p.id === this.id);
      if (tracked) {
        tracked.onExit = cb;
      }
    }

    constructor(id: string) {
      this.id = id;
      mockPtySessions.push({
        id,
        onData: undefined,
        onExit: undefined,
      });
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
    flush = vi.fn();
    pauseOutput = vi.fn();
    resumeOutput = vi.fn();
    updateWebview = vi.fn();
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

vi.mock("./previewFileLink", () => ({
  previewFileLink: vi.fn(async () => ({
    type: "filePreviewResult",
    path: "test/path",
    requestId: "echo-req",
    status: "ok",
  })),
}));

import type * as vscode from "vscode";
import { SessionManager } from "../session/SessionManager";
import { env as vscodeMockEnv } from "../test/__mocks__/vscode";
import { VaultLaunchError } from "../vault/LaunchBuilder";
import type { VaultLauncher } from "../vault/VaultLauncher";
import type { VaultService } from "../vault/VaultService";
import { FileTreeHost } from "./fileTreeHost";
import { openFileLink } from "./openFileLink";
import { previewFileLink } from "./previewFileLink";
import { TerminalViewProvider } from "./TerminalViewProvider";
import type { VaultWatchCoordinator } from "./VaultWatchCoordinator";

// ─── Test Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  __resetAll();
  __setAppRoot("/mock/vscode/app");
  __setWorkspaceFolders([{ uri: { fsPath: "/mock/workspace" } }]);
  vi.clearAllMocks();
  mockPtySessions.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Helpers ────────────────────────────────────────────────────────

function createMockWebviewView(): {
  webviewView: vscode.WebviewView;
  messageHandlers: Array<(msg: unknown) => void>;
  disposeHandlers: Array<() => void>;
  visibilityHandlers: Array<() => void>;
  postMessageSpy: ReturnType<typeof vi.fn>;
  setVisible: (visible: boolean) => void;
} {
  const messageHandlers: Array<(msg: unknown) => void> = [];
  const disposeHandlers: Array<() => void> = [];
  const visibilityHandlers: Array<() => void> = [];
  const postMessageSpy = vi.fn(() => Promise.resolve(true));
  let _visible = true;

  const webviewView = {
    visible: true,
    viewType: "anywhereTerminal.sidebar",
    webview: {
      html: "",
      options: {},
      cspSource: "https://mock.csp.source",
      asWebviewUri: (uri: { fsPath: string }) => uri.fsPath,
      onDidReceiveMessage: (handler: (msg: unknown) => void) => {
        messageHandlers.push(handler);
        return { dispose: () => {} };
      },
      postMessage: postMessageSpy,
    },
    onDidChangeVisibility: (handler: () => void) => {
      visibilityHandlers.push(handler);
      return { dispose: () => {} };
    },
    onDidDispose: (handler: () => void) => {
      disposeHandlers.push(handler);
      return { dispose: () => {} };
    },
  } as unknown as vscode.WebviewView;

  const setVisible = (visible: boolean) => {
    _visible = visible;
    (webviewView as { visible: boolean }).visible = visible;
    for (const handler of visibilityHandlers) {
      handler();
    }
  };

  return { webviewView, messageHandlers, disposeHandlers, visibilityHandlers, postMessageSpy, setVisible };
}

// ─── getActiveSessionId ─────────────────────────────────────────────

describe("TerminalViewProvider: getActiveSessionId", () => {
  it("returns undefined when no sessions exist", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    expect(provider.getActiveSessionId()).toBeUndefined();

    sm.dispose();
  });

  it("returns the active session ID after resolveWebviewView + ready", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Simulate ready
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    const activeId = provider.getActiveSessionId();
    expect(activeId).toBeDefined();
    expect(typeof activeId).toBe("string");

    sm.dispose();
  });

  it("returns the most recently created session as active", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Simulate ready — creates first session
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    // Create a second session via createTab message
    for (const handler of messageHandlers) {
      handler({ type: "createTab" });
    }

    const tabs = sm.getTabsForView(provider.getViewId());
    expect(tabs).toHaveLength(2);

    // The second session should be active
    const activeId = provider.getActiveSessionId();
    expect(activeId).toBe(tabs[1].id);

    sm.dispose();
  });
});

// ─── openFile dispatch ─────────────────────────────────────────────

describe("TerminalViewProvider: openFile dispatch", () => {
  it("forwards an openFile message to openFileLink with the expected deps shape", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Initialize a session via ready
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    const openFileMsg = {
      type: "openFile" as const,
      path: "src/foo.ts",
      sessionId: "sess-XYZ",
      line: 42,
      col: 7,
    };

    for (const handler of messageHandlers) {
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

  it("ignores openFile messages with non-string path or sessionId", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    (openFileLink as unknown as ReturnType<typeof vi.fn>).mockClear();

    for (const handler of messageHandlers) {
      handler({ type: "openFile", path: 123 as unknown, sessionId: "x" });
      handler({ type: "openFile", path: "x", sessionId: 0 as unknown });
    }

    expect(openFileLink).not.toHaveBeenCalled();

    sm.dispose();
  });
});

// ─── file-tree action dispatch ─────────────────────────────────────

describe("TerminalViewProvider: file-tree action dispatch", () => {
  it("delegates all file-tree path action messages to FileTreeHost", () => {
    const spy = vi.spyOn(FileTreeHost.prototype, "handleMessage").mockReturnValue(true);
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    const messages = [
      { type: "file-tree-reveal-in-os", rootGeneration: 0, path: "/mock/workspace/a.ts" },
      { type: "file-tree-copy-path", rootGeneration: 0, path: "/mock/workspace/a.ts" },
      { type: "file-tree-copy-relative-path", rootGeneration: 0, path: "/mock/workspace/a.ts" },
      { type: "file-tree-delete", rootGeneration: 0, path: "/mock/workspace/a.ts" },
    ] as const;

    for (const msg of messages) {
      for (const handler of messageHandlers) {
        handler(msg);
      }
    }

    expect(spy).toHaveBeenCalledTimes(4);
    expect(spy.mock.calls.map(([msg]) => (msg as { type: string }).type)).toEqual(messages.map((msg) => msg.type));

    sm.dispose();
  });
});

// ─── requestFilePreview dispatch (task 2_3) ─────────────────────────

describe("TerminalViewProvider: requestFilePreview dispatch", () => {
  // Round-2 W3: handler rejects unknown sessionIds. These tests use the literal
  // "s1" placeholder; stub `sm.getSession` to accept any id so the supersession /
  // dispatch behaviors remain testable without spawning a real PTY session.
  function stubSession(sm: SessionManager): void {
    vi.spyOn(sm, "getSession").mockImplementation(() => ({}) as never);
  }

  it("cancels a prior in-flight token when a new request for the same session arrives", async () => {
    const sm = new SessionManager();
    stubSession(sm);
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    // Make previewFileLink hang indefinitely so we can observe cancellation.
    let cancellations = 0;
    (previewFileLink as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_msg, _deps, token) => {
      const t = token as { onCancellationRequested?: (cb: () => void) => { dispose(): void } };
      await new Promise<void>((resolve) => {
        t.onCancellationRequested?.(() => {
          cancellations++;
          resolve();
        });
      });
      return null; // cancelled — no result posted.
    });

    for (const handler of messageHandlers) {
      handler({ type: "requestFilePreview", requestId: "r1", sessionId: "s1", path: "foo.ts" });
    }
    await Promise.resolve();
    for (const handler of messageHandlers) {
      handler({ type: "requestFilePreview", requestId: "r2", sessionId: "s1", path: "bar.ts" });
    }
    await new Promise((r) => setTimeout(r, 5));

    expect(cancellations).toBeGreaterThanOrEqual(1);

    sm.dispose();
  });

  it("posts the result back when previewFileLink resolves", async () => {
    const sm = new SessionManager();
    stubSession(sm);
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    postMessageSpy.mockClear();

    (previewFileLink as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      type: "filePreviewResult",
      path: "test/path",
      requestId: "r1",
      status: "ok",
      absPath: "/x/foo.ts",
    });

    for (const handler of messageHandlers) {
      handler({ type: "requestFilePreview", requestId: "r1", sessionId: "s1", path: "foo.ts" });
    }
    await new Promise((r) => setTimeout(r, 10));

    const previewPosts = postMessageSpy.mock.calls.filter(
      (args) => (args[0] as { type?: string }).type === "filePreviewResult",
    );
    expect(previewPosts).toHaveLength(1);
    expect(previewPosts[0][0]).toMatchObject({ requestId: "r1", status: "ok" });

    sm.dispose();
  });

  it("does NOT post a result when previewFileLink returns null (cancelled mid-flight)", async () => {
    const sm = new SessionManager();
    stubSession(sm);
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    postMessageSpy.mockClear();

    (previewFileLink as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    for (const handler of messageHandlers) {
      handler({ type: "requestFilePreview", requestId: "r-cancel", sessionId: "s1", path: "foo.ts" });
    }
    await new Promise((r) => setTimeout(r, 10));

    const previewPosts = postMessageSpy.mock.calls.filter(
      (args) => (args[0] as { type?: string }).type === "filePreviewResult",
    );
    expect(previewPosts).toHaveLength(0);

    sm.dispose();
  });

  it("supersession: a cancelled prior request that later resolves with non-null does NOT post a result", async () => {
    const sm = new SessionManager();
    stubSession(sm);
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    postMessageSpy.mockClear();

    // Pause the first request so we can supersede it before it resolves.
    let resolveFirst: (() => void) | undefined;
    const firstReady = new Promise<void>((r) => {
      resolveFirst = r;
    });
    (previewFileLink as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      await firstReady;
      return {
        type: "filePreviewResult",
        path: "test/path",
        requestId: "r1",
        status: "ok",
        absPath: "/x/foo.ts",
      };
    });
    (previewFileLink as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      type: "filePreviewResult",
      path: "test/path",
      requestId: "r2",
      status: "ok",
      absPath: "/x/bar.ts",
    });

    for (const handler of messageHandlers) {
      handler({ type: "requestFilePreview", requestId: "r1", sessionId: "s1", path: "foo.ts" });
    }
    await Promise.resolve();
    // Supersede before the first resolves.
    for (const handler of messageHandlers) {
      handler({ type: "requestFilePreview", requestId: "r2", sessionId: "s1", path: "bar.ts" });
    }
    await new Promise((r) => setTimeout(r, 5));
    // Now let the first one resolve (it's been cancelled by the supersession).
    resolveFirst?.();
    await new Promise((r) => setTimeout(r, 10));

    const previewPosts = postMessageSpy.mock.calls.filter(
      (args) => (args[0] as { type?: string }).type === "filePreviewResult",
    );
    // Only the second request's result should have been posted.
    expect(previewPosts).toHaveLength(1);
    expect(previewPosts[0][0]).toMatchObject({ requestId: "r2" });

    sm.dispose();
  });

  it("ignores requestFilePreview messages with non-string requestId / sessionId / path", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    (previewFileLink as unknown as ReturnType<typeof vi.fn>).mockClear();

    for (const handler of messageHandlers) {
      handler({ type: "requestFilePreview", requestId: 1 as unknown, sessionId: "s1", path: "foo.ts" });
      handler({ type: "requestFilePreview", requestId: "r1", sessionId: 0 as unknown, path: "foo.ts" });
      handler({ type: "requestFilePreview", requestId: "r1", sessionId: "s1", path: null as unknown });
    }
    expect(previewFileLink).not.toHaveBeenCalled();

    sm.dispose();
  });

  it("cancels the in-flight preview token when closeTab arrives for the same session", async () => {
    const sm = new SessionManager();
    stubSession(sm);
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    let cancelled = false;
    (previewFileLink as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_msg, _deps, token) => {
      const t = token as { onCancellationRequested?: (cb: () => void) => { dispose(): void } };
      await new Promise<void>((resolve) => {
        t.onCancellationRequested?.(() => {
          cancelled = true;
          resolve();
        });
      });
      return null;
    });

    for (const handler of messageHandlers) {
      handler({ type: "requestFilePreview", requestId: "r1", sessionId: "target", path: "foo.ts" });
    }
    await Promise.resolve();
    for (const handler of messageHandlers) {
      handler({ type: "closeTab", tabId: "target" });
    }
    await new Promise((r) => setTimeout(r, 5));

    expect(cancelled).toBe(true);

    sm.dispose();
  });

  it("cancels all in-flight preview tokens on webview dispose", async () => {
    const sm = new SessionManager();
    stubSession(sm);
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers, disposeHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    let cancellations = 0;
    (previewFileLink as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_msg, _deps, token) => {
      const t = token as { onCancellationRequested?: (cb: () => void) => { dispose(): void } };
      await new Promise<void>((resolve) => {
        t.onCancellationRequested?.(() => {
          cancellations++;
          resolve();
        });
      });
      return null;
    });

    for (const handler of messageHandlers) {
      handler({ type: "requestFilePreview", requestId: "r1", sessionId: "s1", path: "a" });
      handler({ type: "requestFilePreview", requestId: "r2", sessionId: "s2", path: "b" });
    }
    await Promise.resolve();
    for (const handler of disposeHandlers) {
      handler();
    }
    await new Promise((r) => setTimeout(r, 5));

    expect(cancellations).toBe(2);

    sm.dispose();
  });
});

// ─── theme bridge (task 1_3) ────────────────────────────────────────

describe("TerminalViewProvider: theme bridge", () => {
  it("posts the initial theme on ready for each ColorThemeKind", async () => {
    const cases: Array<{ kind: number; expected: string }> = [
      { kind: 1 /* Light */, expected: "light" },
      { kind: 2 /* Dark */, expected: "dark" },
      { kind: 3 /* HighContrast */, expected: "hc-dark" },
      { kind: 4 /* HighContrastLight */, expected: "hc-light" },
    ];

    const { __setActiveColorTheme } = await import("../test/__mocks__/vscode");

    for (const { kind, expected } of cases) {
      __setActiveColorTheme(kind);
      const sm = new SessionManager();
      const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
      const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
      provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

      for (const handler of messageHandlers) {
        handler({ type: "ready" });
      }

      const themeMessages = postMessageSpy.mock.calls
        .map((args) => args[0] as { type?: string; kind?: string })
        .filter((m) => m && m.type === "themeChanged");
      expect(themeMessages.length).toBeGreaterThan(0);
      expect(themeMessages[0]).toEqual({ type: "themeChanged", kind: expected });

      sm.dispose();
    }
  });

  it("posts themeChanged when onDidChangeActiveColorTheme fires after ready", async () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    postMessageSpy.mockClear();

    const { __setActiveColorTheme } = await import("../test/__mocks__/vscode");
    __setActiveColorTheme(1 /* Light */);

    const themeCalls = postMessageSpy.mock.calls.filter(
      (args) => (args[0] as { type?: string }).type === "themeChanged",
    );
    expect(themeCalls).toHaveLength(1);
    expect(themeCalls[0][0]).toEqual({ type: "themeChanged", kind: "light" });

    sm.dispose();
  });

  it("does NOT post themeChanged before ready", async () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    // No 'ready' message yet.

    postMessageSpy.mockClear();
    const { __setActiveColorTheme } = await import("../test/__mocks__/vscode");
    __setActiveColorTheme(1 /* Light */);

    const themeCalls = postMessageSpy.mock.calls.filter(
      (args) => (args[0] as { type?: string }).type === "themeChanged",
    );
    expect(themeCalls).toHaveLength(0);

    sm.dispose();
  });

  it("disposes the theme subscription on webview dispose", async () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");
    const { webviewView, messageHandlers, disposeHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }
    postMessageSpy.mockClear();

    // Simulate webview dispose — should unsubscribe theme listener.
    for (const handler of disposeHandlers) {
      handler();
    }

    const { __setActiveColorTheme, __getThemeListenerCount } = await import("../test/__mocks__/vscode");
    expect(__getThemeListenerCount()).toBe(0);

    __setActiveColorTheme(1 /* Light */);
    const themeCalls = postMessageSpy.mock.calls.filter(
      (args) => (args[0] as { type?: string }).type === "themeChanged",
    );
    expect(themeCalls).toHaveLength(0);

    sm.dispose();
  });
});

// ─── vault fresh-response supersession (review round-2 F4) ──────────

describe("TerminalViewProvider: vault fresh-response supersession (F4)", () => {
  function freshResult(id: string) {
    return {
      entries: [
        {
          id: `claude:${id}`,
          agent: "claude",
          sessionId: id,
          title: "t",
          cwd: "/x",
          modified: 1,
          flags: {},
          canFork: false,
        },
      ],
      unreadable: { count: 0, reasons: [] },
    };
  }

  it("does not re-post a superseded fresh list on retry after a newer request arrives", async () => {
    const sm = new SessionManager();
    let refreshes = 0;
    const fakeVault = {
      listCached: () => null, // no instant-cache post — isolate the fresh path
      refresh: async () => freshResult(`r${++refreshes}`),
    } as unknown as VaultService;
    const provider = new TerminalViewProvider(
      { fsPath: "/mock/extension" } as vscode.Uri,
      sm,
      "sidebar",
      null, // gitDecorationProvider
      null, // watcherPool
      fakeVault,
    );

    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    postMessageSpy.mockReset();
    const isFresh = (m: unknown, id: string) => {
      const x = m as { type?: string; fromCache?: boolean; result?: { entries: Array<{ id: string }> } };
      return x.type === "vaultSessionsResponse" && x.fromCache === false && x.result?.entries[0]?.id === `claude:${id}`;
    };
    let firedSecond = false;
    postMessageSpy.mockImplementation((msg: unknown) => {
      // On token-1's FIRST fresh post attempt: fire a newer request (bumps the seq
      // synchronously), then fail this attempt to push token-1 into its retry window.
      if (!firedSecond && isFresh(msg, "r1")) {
        firedSecond = true;
        for (const handler of messageHandlers) {
          handler({ type: "requestVaultSessions" });
        }
        return Promise.resolve(false);
      }
      return Promise.resolve(true);
    });

    for (const handler of messageHandlers) {
      handler({ type: "requestVaultSessions" }); // token-1
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));

    const r1Posts = postMessageSpy.mock.calls.filter(([m]) => isFresh(m, "r1"));
    const r2Posts = postMessageSpy.mock.calls.filter(([m]) => isFresh(m, "r2"));
    // token-1's retry is aborted: r1 is posted exactly once (the failed first attempt),
    // never re-sent after token-2 superseded it.
    expect(r1Posts).toHaveLength(1);
    // The newer list still reaches the webview.
    expect(r2Posts.length).toBeGreaterThanOrEqual(1);

    sm.dispose();
  });
});

// ─── safeSendWithRetry ──────────────────────────────────────────────

describe("TerminalViewProvider: safeSendWithRetry via createTab", () => {
  it("retries postMessage when first attempt returns false then succeeds", async () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Simulate ready
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    // Reset spy and make it fail once then succeed
    postMessageSpy.mockReset();
    let callCount = 0;
    postMessageSpy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(false); // First attempt fails
      }
      return Promise.resolve(true); // Retry succeeds
    });

    // Trigger createTab which uses safeSendWithRetry
    for (const handler of messageHandlers) {
      handler({ type: "createTab" });
    }

    // Wait for retries to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    // Should have been called at least twice (retry)
    expect(postMessageSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

    sm.dispose();
  });

  it("returns false after all retries exhausted", async () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Simulate ready
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    // Reset spy and make it always fail
    postMessageSpy.mockReset();
    postMessageSpy.mockImplementation(() => Promise.resolve(false));

    // Trigger createTab which uses safeSendWithRetry
    for (const handler of messageHandlers) {
      handler({ type: "createTab" });
    }

    // Wait for all retries to complete (3 attempts × 50ms delay)
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    // Should have been called 3 times (initial + 2 retries)
    expect(postMessageSpy.mock.calls.length).toBe(3);

    sm.dispose();
  });
});

// ─── Scrollback Replay on Re-creation ───────────────────────────────

describe("TerminalViewProvider: scrollback replay on re-creation", () => {
  it("first-time creation creates a new session", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Simulate ready
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    const tabs = sm.getTabsForView(provider.getViewId());
    expect(tabs).toHaveLength(1);

    // Should have sent init with the new session
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "init",
        tabs: expect.arrayContaining([expect.objectContaining({ isActive: true })]),
      }),
    );

    sm.dispose();
  });

  it("re-creation restores existing sessions without creating new ones", async () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    // First creation
    const { webviewView: wv1, messageHandlers: mh1 } = createMockWebviewView();
    provider.resolveWebviewView(wv1, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of mh1) {
      handler({ type: "ready" });
    }

    const tabsBefore = sm.getTabsForView(provider.getViewId());
    expect(tabsBefore).toHaveLength(1);
    const sessionId = tabsBefore[0].id;

    // Simulate PTY output to build scrollback
    const ptyMock = mockPtySessions.find((p) => p.id === sessionId);
    ptyMock!.onData?.("hello world");

    // Simulate re-creation (new webview view)
    const { webviewView: wv2, messageHandlers: mh2, postMessageSpy: pms2 } = createMockWebviewView();
    provider.resolveWebviewView(wv2, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of mh2) {
      handler({ type: "ready" });
    }
    // onReady is async — Phase A awaits init delivery before the restore loop.
    // Flush microtasks so the for-loop runs before assertions.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // Should NOT have created a new session
    const tabsAfter = sm.getTabsForView(provider.getViewId());
    expect(tabsAfter).toHaveLength(1);
    expect(tabsAfter[0].id).toBe(sessionId);

    // Should have sent init with existing tabs
    expect(pms2).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "init",
        tabs: expect.arrayContaining([expect.objectContaining({ id: sessionId })]),
      }),
    );

    // Should have sent restore message with scrollback data
    expect(pms2).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "restore",
        tabId: sessionId,
        data: "hello world",
      }),
    );

    sm.dispose();
  });
});

// ─── Visibility Pause/Resume ────────────────────────────────────────

describe("TerminalViewProvider: visibility pause/resume", () => {
  it("pauses output when view becomes hidden", () => {
    const sm = new SessionManager();
    const pauseSpy = vi.spyOn(sm, "pauseOutputForView");
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers, setVisible } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Simulate ready
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    // Hide the view
    setVisible(false);

    expect(pauseSpy).toHaveBeenCalledWith(provider.getViewId());

    sm.dispose();
  });

  it("resumes output when view becomes visible", () => {
    const sm = new SessionManager();
    const resumeSpy = vi.spyOn(sm, "resumeOutputForView");
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers, setVisible } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Simulate ready
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    // Hide then show
    setVisible(false);
    setVisible(true);

    expect(resumeSpy).toHaveBeenCalledWith(provider.getViewId());

    sm.dispose();
  });

  it("does NOT destroy sessions on webview dispose (PTY survives)", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers, disposeHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Simulate ready — creates a session
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    const tabsBefore = sm.getTabsForView(provider.getViewId());
    expect(tabsBefore).toHaveLength(1);

    // Simulate webview dispose
    for (const handler of disposeHandlers) {
      handler();
    }

    // Sessions should still exist (PTY anchored to Extension Host)
    const tabsAfter = sm.getTabsForView(provider.getViewId());
    expect(tabsAfter).toHaveLength(1);
    expect(tabsAfter[0].id).toBe(tabsBefore[0].id);

    sm.dispose();
  });

  it("pauses output on webview dispose", () => {
    const sm = new SessionManager();
    const pauseSpy = vi.spyOn(sm, "pauseOutputForView");
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers, disposeHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Simulate ready
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    // Simulate webview dispose
    for (const handler of disposeHandlers) {
      handler();
    }

    expect(pauseSpy).toHaveBeenCalledWith(provider.getViewId());

    sm.dispose();
  });
});

// ─── Vault Watch Coordinator Delegation ─────────────────────────────

describe("TerminalViewProvider: vault watch coordinator", () => {
  it("attaches, delegates session watches, and disposes the resolved webview client", async () => {
    const sm = new SessionManager();
    const client = { watchSession: vi.fn(async () => {}), dispose: vi.fn() };
    const coordinator = { attach: vi.fn(() => client), dispose: vi.fn() } as unknown as VaultWatchCoordinator;
    const provider = new TerminalViewProvider(
      { fsPath: "/mock/extension" } as vscode.Uri,
      sm,
      "sidebar",
      null,
      null,
      null,
      null,
      coordinator,
    );
    const { webviewView, messageHandlers, disposeHandlers } = createMockWebviewView();

    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    expect(coordinator.attach).toHaveBeenCalledTimes(1);

    for (const handler of messageHandlers) {
      handler({ type: "vaultWatchSession", entryId: "claude:s1" });
    }
    await Promise.resolve();
    expect(client.watchSession).toHaveBeenCalledWith("claude:s1");

    for (const handler of disposeHandlers) {
      handler();
    }
    expect(client.dispose).toHaveBeenCalledTimes(1);
    sm.dispose();
  });

  it("keeps late messages and disposal bound to the client captured by each resolution", async () => {
    const sm = new SessionManager();
    const firstClient = { watchSession: vi.fn(async () => {}), dispose: vi.fn() };
    const secondClient = { watchSession: vi.fn(async () => {}), dispose: vi.fn() };
    const coordinator = {
      attach: vi.fn().mockReturnValueOnce(firstClient).mockReturnValueOnce(secondClient),
      dispose: vi.fn(),
    } as unknown as VaultWatchCoordinator;
    const provider = new TerminalViewProvider(
      { fsPath: "/mock/extension" } as vscode.Uri,
      sm,
      "sidebar",
      null,
      null,
      null,
      null,
      coordinator,
    );
    const first = createMockWebviewView();
    const second = createMockWebviewView();

    provider.resolveWebviewView(
      first.webviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken,
    );
    provider.resolveWebviewView(
      second.webviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken,
    );

    for (const handler of first.messageHandlers) {
      handler({ type: "vaultWatchSession", entryId: "claude:old" });
    }
    await Promise.resolve();
    expect(firstClient.watchSession).toHaveBeenCalledWith("claude:old");
    expect(secondClient.watchSession).not.toHaveBeenCalled();

    for (const handler of first.disposeHandlers) {
      handler();
    }
    expect(secondClient.dispose).not.toHaveBeenCalled();

    for (const handler of second.messageHandlers) {
      handler({ type: "vaultWatchSession", entryId: "claude:new" });
    }
    await Promise.resolve();
    expect(secondClient.watchSession).toHaveBeenCalledWith("claude:new");
    sm.dispose();
  });
});

// ─── Split Pane Ghost Tab Fix ───────────────────────────────────────

describe("TerminalViewProvider: split pane ghost tab fix", () => {
  it("creates split pane session with isSplitPane flag", () => {
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView, messageHandlers } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    // Simulate ready — creates root session
    for (const handler of messageHandlers) {
      handler({ type: "ready" });
    }

    const tabsBefore = sm.getTabsForView(provider.getViewId());
    expect(tabsBefore).toHaveLength(1);
    const rootTabId = tabsBefore[0].id;

    // Simulate split request
    for (const handler of messageHandlers) {
      handler({ type: "requestSplitSession", direction: "vertical", sourcePaneId: rootTabId });
    }

    // getTabsForView should still return only the root tab (split pane filtered out)
    const tabsAfter = sm.getTabsForView(provider.getViewId());
    expect(tabsAfter).toHaveLength(1);
    expect(tabsAfter[0].id).toBe(rootTabId);

    // Root tab should still be active
    expect(tabsAfter[0].isActive).toBe(true);

    sm.dispose();
  });

  it("init on re-creation includes split pane sessions with isSplitPane flag", () => {
    // Contract change (restore-terminal-sessions design.md D12): init MUST
    // carry every session — roots AND split-pane children — so the webview
    // can recreate every xterm referenced by `tabLayouts` on reload. Splits
    // are still filtered from the tab strip (root-only), but the WIRE-level
    // init now exposes them tagged with `isSplitPane: true`.
    const sm = new SessionManager();
    const provider = new TerminalViewProvider({ fsPath: "/mock/extension" } as vscode.Uri, sm, "sidebar");

    const { webviewView: wv1, messageHandlers: mh1 } = createMockWebviewView();
    provider.resolveWebviewView(wv1, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of mh1) {
      handler({ type: "ready" });
    }

    const rootTabId = sm.getTabsForView(provider.getViewId())[0].id;

    for (const handler of mh1) {
      handler({ type: "requestSplitSession", direction: "horizontal", sourcePaneId: rootTabId });
    }

    const { webviewView: wv2, messageHandlers: mh2, postMessageSpy: pms2 } = createMockWebviewView();
    provider.resolveWebviewView(wv2, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    for (const handler of mh2) {
      handler({ type: "ready" });
    }

    const initCall = pms2.mock.calls.find((call: unknown[]) => (call[0] as { type: string }).type === "init");
    expect(initCall).toBeDefined();
    const initMsg = initCall![0] as { tabs: Array<{ id: string; isSplitPane?: boolean }> };
    expect(initMsg.tabs).toHaveLength(2);
    const root = initMsg.tabs.find((t) => t.id === rootTabId);
    const split = initMsg.tabs.find((t) => t.id !== rootTabId);
    expect(root?.isSplitPane).toBe(false);
    expect(split?.isSplitPane).toBe(true);

    // Tab strip still filters splits — the root-only view stays root-only.
    expect(sm.getTabsForView(provider.getViewId())).toHaveLength(1);

    sm.dispose();
  });
});

// ─── vaultCopyResumeCommand ─────────────────────────────────────────

describe("TerminalViewProvider: vaultCopyResumeCommand", () => {
  function wireCopy(launcher: Partial<VaultLauncher>): {
    sm: SessionManager;
    send: (msg: unknown) => void;
    writeText: ReturnType<typeof vi.fn>;
    postMessageSpy: ReturnType<typeof vi.fn>;
  } {
    const writeText = vi.fn(async () => {});
    // The mock module has no clipboard of its own; the provider imports this
    // very object, so defining it here is enough (and stays inside the test).
    (vscodeMockEnv as { clipboard?: { writeText: unknown } }).clipboard = { writeText };
    const sm = new SessionManager();
    const provider = new TerminalViewProvider(
      { fsPath: "/mock/extension" } as vscode.Uri,
      sm,
      "sidebar",
      null,
      null,
      {} as VaultService,
      launcher as VaultLauncher,
    );
    const { webviewView, messageHandlers, postMessageSpy } = createMockWebviewView();
    provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    return {
      sm,
      send: (msg: unknown) => {
        for (const handler of messageHandlers) {
          handler(msg);
        }
      },
      writeText,
      postMessageSpy,
    };
  }

  afterEach(() => {
    delete (vscodeMockEnv as { clipboard?: unknown }).clipboard;
  });

  it("copies the command the launcher built after its own gates passed", async () => {
    const buildResumeCommand = vi.fn(async () => "cursor-agent --resume chat-1");
    const { sm, send, writeText } = wireCopy({ buildResumeCommand });
    send({ type: "vaultCopyResumeCommand", entryId: "cursor:chat-1" });
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("cursor-agent --resume chat-1"));
    expect(buildResumeCommand).toHaveBeenCalledWith("cursor:chat-1");
    sm.dispose();
  });

  it("leaves the clipboard untouched when the launcher refuses the entry", async () => {
    const buildResumeCommand = vi.fn(async () => {
      throw new VaultLaunchError("Couldn't verify the stored session identity", "resume-unsupported");
    });
    const { sm, send, writeText, postMessageSpy } = wireCopy({ buildResumeCommand });
    send({ type: "vaultCopyResumeCommand", entryId: "cursor:chat-1" });
    await vi.waitFor(() =>
      expect(postMessageSpy.mock.calls.some((call: unknown[]) => (call[0] as { type: string }).type === "error")).toBe(
        true,
      ),
    );
    expect(writeText).not.toHaveBeenCalled();
    sm.dispose();
  });
});
