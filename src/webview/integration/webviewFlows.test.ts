// @vitest-environment jsdom
// src/webview/integration/webviewFlows.test.ts — Integration tests for critical webview flows
//
// Wires real module instances together to test cross-module interactions.

import type { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlowControl } from "../flow/FlowControl";
import { createMessageRouter, type MessageHandlers } from "../messaging/MessageRouter";
import { createBranch, createLeaf, getAllSessionIds, removeLeaf, replaceNode } from "../SplitModel";
import { WebviewStateStore } from "../state/WebviewStateStore";
import { createMockTerminal } from "../test-utils/mockTerminal";

// ─── Setup ──────────────────────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Integration Tests ──────────────────────────────────────────────

describe("Integration: ack routing through FlowControl + MessageRouter", () => {
  it("routes output to FlowControl and sends ack with correct tabId", () => {
    const postMessage = vi.fn();
    const flowControl = new FlowControl(postMessage);

    // Create a mock handler that feeds output data through FlowControl
    const handlers: MessageHandlers = {
      onOutput: vi.fn((msg) => {
        flowControl.ackChars(msg.data.length, msg.tabId);
      }),
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

    const dispatch = createMessageRouter(handlers);

    // Send enough output to trigger ack (5000 chars)
    const bigOutput = "x".repeat(5000);
    dispatch({ type: "output", tabId: "session-42", data: bigOutput });

    expect(handlers.onOutput).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      type: "ack",
      charCount: 5000,
      tabId: "session-42",
    });
  });
});

describe("Integration: tab lifecycle with WebviewStateStore", () => {
  it("manages terminal addition, tab switching, and layout cleanup", () => {
    const api = {
      getState: vi.fn(() => null),
      setState: vi.fn(),
    };
    const store = new WebviewStateStore(api);

    // Add two terminals
    const t1 = createMockTerminal();
    const t2 = createMockTerminal();

    store.terminals.set("tab-1", {
      id: "tab-1",
      name: "Terminal 1",
      customName: null,
      terminal: t1 as unknown as Terminal,
      container: document.createElement("div"),
      exited: false,
      activityStatus: "idle",
    });

    store.terminals.set("tab-2", {
      id: "tab-2",
      name: "Terminal 2",
      customName: null,
      terminal: t2 as unknown as Terminal,
      container: document.createElement("div"),
      exited: false,
      activityStatus: "idle",
    });

    store.setActiveTab("tab-1");
    expect(store.activeTabId).toBe("tab-1");

    // Switch tabs
    store.setActiveTab("tab-2");
    expect(store.activeTabId).toBe("tab-2");

    // Remove tab-2
    store.terminals.delete("tab-2");
    store.deleteLayout("tab-2");

    // Verify cleanup
    expect(store.terminals.has("tab-2")).toBe(false);
    expect(store.tabLayouts.has("tab-2")).toBe(false);

    // Fall back to remaining tab
    store.setActiveTab("tab-1");
    expect(store.activeTabId).toBe("tab-1");
    expect(store.terminals.size).toBe(1);
  });
});

describe("Integration: split pane layout with SplitModel + WebviewStateStore", () => {
  it("manages split creation, pane tracking, and removal", () => {
    const api = {
      getState: vi.fn(() => null),
      setState: vi.fn(),
    };
    const store = new WebviewStateStore(api);

    // Start with a single-pane layout
    const initialLayout = createLeaf("s1");
    store.setLayout("tab-1", initialLayout);
    store.setActivePaneId("tab-1", "s1");

    // Split: replace s1 with a branch containing s1 and s2
    const splitLayout = replaceNode(initialLayout, "s1", createBranch("vertical", createLeaf("s1"), createLeaf("s2")));
    store.setLayout("tab-1", splitLayout);
    store.setActivePaneId("tab-1", "s2");

    // Verify layout has both sessions
    const sessionIds = getAllSessionIds(store.tabLayouts.get("tab-1")!);
    expect(sessionIds).toEqual(["s1", "s2"]);
    expect(store.getActivePaneId("tab-1")).toBe("s2");

    // Remove s2 from the split — collapses back to s1
    const afterRemove = removeLeaf(splitLayout, "s2");
    expect(afterRemove).not.toBeNull();
    store.setLayout("tab-1", afterRemove!);

    const remainingIds = getAllSessionIds(store.tabLayouts.get("tab-1")!);
    expect(remainingIds).toEqual(["s1"]);

    // Persist and verify state is saved
    store.persist();
    expect(api.setState).toHaveBeenCalled();
  });
});

describe("Integration: config update applied to terminals via store", () => {
  it("updates terminal options when config changes", () => {
    const api = {
      getState: vi.fn(() => null),
      setState: vi.fn(),
    };
    const store = new WebviewStateStore(api);

    const t1 = createMockTerminal();
    const t2 = createMockTerminal();
    store.terminals.set("tab-1", {
      id: "tab-1",
      name: "Terminal 1",
      customName: null,
      terminal: t1 as unknown as Terminal,
      container: document.createElement("div"),
      exited: false,
      activityStatus: "idle",
    });
    store.terminals.set("tab-2", {
      id: "tab-2",
      name: "Terminal 2",
      customName: null,
      terminal: t2 as unknown as Terminal,
      container: document.createElement("div"),
      exited: false,
      activityStatus: "idle",
    });

    // Simulate config update
    const newConfig = { fontSize: 18, fontFamily: "Fira Code" };
    store.currentConfig = { ...store.currentConfig, ...newConfig };

    // Apply config to all terminals (like main.ts would)
    for (const inst of store.terminals.values()) {
      const term = inst.terminal as unknown as ReturnType<typeof createMockTerminal>;
      term.options.fontSize = store.currentConfig.fontSize;
      term.options.fontFamily = store.currentConfig.fontFamily;
    }

    expect(t1.options.fontSize).toBe(18);
    expect(t1.options.fontFamily).toBe("Fira Code");
    expect(t2.options.fontSize).toBe(18);
    expect(t2.options.fontFamily).toBe("Fira Code");
  });
});
