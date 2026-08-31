// src/webview/messaging/MessageRouter.test.ts — Unit tests for MessageRouter

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionToWebViewMessage } from "../../types/messages";
import { createMessageRouter, type MessageHandlers } from "./MessageRouter";

// ─── Helpers ────────────────────────────────────────────────────────

/** Create a MessageHandlers object with all handlers as vi.fn() stubs. */
function createMockHandlers(): MessageHandlers {
  return {
    onOutput: vi.fn(),
    onExit: vi.fn(),
    onTabCreated: vi.fn(),
    onTabRemoved: vi.fn(),
    onTabRenamed: vi.fn(),
    onRestore: vi.fn(),
    onConfigUpdate: vi.fn(),
    onViewShow: vi.fn(),
    onSplitPane: vi.fn(),
    onSplitPaneCreated: vi.fn(),
    onCloseSplitPane: vi.fn(),
    onCloseSplitPaneById: vi.fn(),
    onSplitPaneAt: vi.fn(),
    onCtxClear: vi.fn(),
    onError: vi.fn(),
    onInsertPathEffect: vi.fn(),
    onFilePreviewResult: vi.fn(),
    onThemeChanged: vi.fn(),
    onHoverPreviewSettings: vi.fn(),
    onReadDirectoryResponse: vi.fn(),
    onWorkspaceRootChanged: vi.fn(),
    onSetFileTreePosition: vi.fn(),
    onRevealInFileTree: vi.fn(),
    onFileTreeSearchResponse: vi.fn(),
    onGitStatusChanged: vi.fn(),
    onFsChangesInvalidated: vi.fn(),
    onFsRehydrate: vi.fn(),
    onSetPanelId: vi.fn(),
    onRestoreFromSnapshot: vi.fn(),
    onRequestScrollbackDump: vi.fn(),
    onFlashPane: vi.fn(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────

describe("createMessageRouter", () => {
  it("dispatches each message type to the correct handler", () => {
    const handlers = createMockHandlers();
    const dispatch = createMessageRouter(handlers);

    const messages: ExtensionToWebViewMessage[] = [
      { type: "output", tabId: "t1", data: "hello" },
      { type: "exit", tabId: "t1", code: 0 },
      { type: "tabCreated", tabId: "t2", name: "Terminal 2", customName: null },
      { type: "tabRemoved", tabId: "t1" },
      { type: "tabRenamed", tabId: "t2", customName: "build" },
      { type: "restore", tabId: "t1", data: "cached" },
      { type: "configUpdate", config: { fontSize: 16 } },
      { type: "viewShow" },
      { type: "splitPane", direction: "horizontal" },
      {
        type: "splitPaneCreated",
        sourcePaneId: "t1",
        newSessionId: "t2",
        newSessionName: "Terminal 2",
        direction: "vertical",
      },
      { type: "closeSplitPane" },
      { type: "closeSplitPaneById", sessionId: "t1" },
      { type: "splitPaneAt", direction: "horizontal", sourcePaneId: "t1" },
      { type: "ctxClear", sessionId: "t1" },
      { type: "error", message: "boom", severity: "error" },
    ];

    const handlerMap: Record<string, keyof MessageHandlers> = {
      output: "onOutput",
      exit: "onExit",
      tabCreated: "onTabCreated",
      tabRemoved: "onTabRemoved",
      tabRenamed: "onTabRenamed",
      restore: "onRestore",
      configUpdate: "onConfigUpdate",
      viewShow: "onViewShow",
      splitPane: "onSplitPane",
      splitPaneCreated: "onSplitPaneCreated",
      closeSplitPane: "onCloseSplitPane",
      closeSplitPaneById: "onCloseSplitPaneById",
      splitPaneAt: "onSplitPaneAt",
      ctxClear: "onCtxClear",
      error: "onError",
    };

    for (const msg of messages) {
      dispatch(msg);
      const handlerName = handlerMap[msg.type];
      expect(handlers[handlerName]).toHaveBeenCalledTimes(1);
    }
  });

  it("does NOT route init messages (handled by main.ts bootstrap)", () => {
    const handlers = createMockHandlers();
    const dispatch = createMessageRouter(handlers);

    dispatch({
      type: "init",
      tabs: [{ id: "t1", name: "Terminal 1", customName: null, isActive: true, isSplitPane: false }],
      config: { fontSize: 14, cursorBlink: true, scrollback: 10000, fontFamily: "" },
      rootGeneration: 0,
      workspaceRoot: null,
      resolvedWorkspaceRoot: null,
      worktreeHasRepo: false,
      worktreeRowActivation: "focus" as const,
      vaultActionsAvailable: true,
    });

    // None of the handlers should be called
    for (const fn of Object.values(handlers)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("silently ignores unknown message types without throwing", () => {
    const handlers = createMockHandlers();
    const dispatch = createMessageRouter(handlers);

    expect(() => {
      dispatch({ type: "unknownType" } as unknown as ExtensionToWebViewMessage);
    }).not.toThrow();

    for (const fn of Object.values(handlers)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("routes agentActivityStatus to the optional handler when present", () => {
    const onAgentActivityStatus = vi.fn();
    const handlers: MessageHandlers = { ...createMockHandlers(), onAgentActivityStatus };
    const dispatch = createMessageRouter(handlers);

    const msg: ExtensionToWebViewMessage = {
      type: "agentActivityStatus",
      tabId: "t1",
      agent: "cursor",
      state: "working",
    };
    dispatch(msg);

    expect(onAgentActivityStatus).toHaveBeenCalledTimes(1);
    expect(onAgentActivityStatus).toHaveBeenCalledWith(msg);
  });

  it("silently ignores agentActivityStatus when no handler is mounted", () => {
    const handlers = createMockHandlers();
    const dispatch = createMessageRouter(handlers);

    expect(() => {
      dispatch({ type: "agentActivityStatus", tabId: "t1", agent: null, state: null });
    }).not.toThrow();
  });
});

describe("the worktree panel's inbound messages", () => {
  // A message in the union with no case is silently dropped — the seam that
  // already lost `requestWorktreeSubagents` once (design.md D7).
  const WORKTREE_MESSAGES: ExtensionToWebViewMessage[] = [
    { type: "worktreeRowActivation", activation: "preview" },
    { type: "worktreeShowPreview", entryId: "claude:s1" },
    { type: "worktreeActivatePane", paneId: "pane-1" },
  ];

  for (const message of WORKTREE_MESSAGES) {
    it(`routes ${message.type} to its handler, with the message intact`, () => {
      const handler = vi.fn();
      const key = `on${message.type.charAt(0).toUpperCase()}${message.type.slice(1)}` as keyof MessageHandlers;
      const dispatch = createMessageRouter({ ...createMockHandlers(), [key]: handler });
      dispatch(message);
      expect(handler).toHaveBeenCalledWith(message);
    });
  }

  it("ignores each of them when no handler is mounted", () => {
    const dispatch = createMessageRouter(createMockHandlers());
    for (const message of WORKTREE_MESSAGES) {
      expect(() => dispatch(message)).not.toThrow();
    }
  });
});

describe("the worktree create dialog's answers reach the controller", () => {
  // Declared, posted and handled but UNROUTED is how `requestWorktreeSubagents`
  // shipped inert with every unit test green. This case exists so the branch
  // list cannot repeat it.
  it("routes the repository's branch list", () => {
    const onWorktreeRefs = vi.fn();
    const dispatch = createMessageRouter({ ...createMockHandlers(), onWorktreeRefs });

    dispatch({
      type: "worktreeRefs",
      repoId: "/repo/.git",
      token: 1,
      refs: [{ name: "main", heldBy: "repo" }],
      truncated: false,
    });

    expect(onWorktreeRefs).toHaveBeenCalledWith({
      type: "worktreeRefs",
      repoId: "/repo/.git",
      token: 1,
      refs: [{ name: "main", heldBy: "repo" }],
      truncated: false,
    });
  });

  it("leaves an unhandled branch list alone rather than throwing", () => {
    const dispatch = createMessageRouter(createMockHandlers());

    expect(() =>
      dispatch({ type: "worktreeRefs", repoId: "/repo/.git", token: 1, refs: [], truncated: false }),
    ).not.toThrow();
  });

  // Declared, posted and handled is only three quarters of a wire:
  // `requestWorktreeSubagents` shipped inert with every module test green
  // because nothing routed it. This is the fourth quarter.
  it("routes the create resolution", () => {
    const onWorktreeCreateResolution = vi.fn();
    const dispatch = createMessageRouter({ ...createMockHandlers(), onWorktreeCreateResolution });
    const msg = {
      type: "worktreeCreateResolution",
      repoId: "/repo/.git",
      token: 3,
      seq: 0,
      query: "feat/search",
      mode: { kind: "reattach", repairPath: "/trees/stale", expectedOid: "abc" },
      freePath: "/trees/repo-feat-search",
      occupiedCandidate: { path: "/trees/repo", disposition: { kind: "debris" } },
    } as const;

    dispatch(msg);

    expect(onWorktreeCreateResolution).toHaveBeenCalledWith(msg);
  });

  it("leaves an unhandled create resolution alone rather than throwing", () => {
    const dispatch = createMessageRouter(createMockHandlers());

    expect(() =>
      dispatch({
        type: "worktreeCreateResolution",
        repoId: "/repo/.git",
        token: 1,
        seq: 0,
        query: "",
        mode: { kind: "fresh" },
        freePath: "/trees/repo",
      }),
    ).not.toThrow();
  });
});
