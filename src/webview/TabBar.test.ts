// src/webview/TabBar.test.ts — Unit tests for Tab Bar rendering and interactions
//
// Tests renderTabBar output, click handlers, keyboard shortcuts, and tab lifecycle.

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleTabKeyboardShortcut, type RenderTabBarDeps, renderTabBar, type TabKeyboardDeps } from "./TabBarUtils";

// ─── Helpers ────────────────────────────────────────────────────────

/** Create a minimal #tab-bar element in a JSDOM-like environment. */
function createTabBarElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "tab-bar";
  document.body.appendChild(el);
  return el;
}

/** Create mock deps for renderTabBar. */
function createMockDeps(overrides: Partial<RenderTabBarDeps> = {}): RenderTabBarDeps {
  return {
    tabBarEl: createTabBarElement(),
    terminals: new Map(),
    activeTabId: null,
    onTabClick: vi.fn(),
    onTabClose: vi.fn(),
    onAddClick: vi.fn(),
    ...overrides,
  };
}

// ─── Setup / Teardown ───────────────────────────────────────────────

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

// ─── renderTabBar ───────────────────────────────────────────────────

describe("renderTabBar", () => {
  it("hides tab bar when 0 terminals exist", () => {
    const deps = createMockDeps();
    renderTabBar(deps);
    expect(deps.tabBarEl.classList.contains("visible")).toBe(false);
    // Should still have the "+" button
    expect(deps.tabBarEl.querySelector(".tab-add")).toBeTruthy();
  });

  it("hides tab bar when only 1 terminal exists", () => {
    const terminals = new Map<string, { name: string }>([["tab-1", { name: "Terminal 1" }]]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    expect(deps.tabBarEl.classList.contains("visible")).toBe(false);
  });

  it("shows tab bar when 2 terminals exist", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    expect(deps.tabBarEl.classList.contains("visible")).toBe(true);
  });

  it("shows tab bar when 3 terminals exist", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
      ["tab-3", { name: "Terminal 3" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    expect(deps.tabBarEl.classList.contains("visible")).toBe(true);
    const tabs = deps.tabBarEl.querySelectorAll(".tab-item");
    expect(tabs.length).toBe(3);
  });

  it("marks the active tab with 'active' class", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-2" });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll(".tab-item");
    expect(tabs[0].classList.contains("active")).toBe(false);
    expect(tabs[1].classList.contains("active")).toBe(true);
  });

  it("renders tab names correctly", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll(".tab-item");
    expect(tabs[0].querySelector(".tab-name")?.textContent).toBe("Terminal 1");
    expect(tabs[1].querySelector(".tab-name")?.textContent).toBe("Terminal 2");
  });

  it("renders close button on each tab", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    const closeButtons = deps.tabBarEl.querySelectorAll(".tab-close");
    expect(closeButtons.length).toBe(2);
  });

  it("renders add button as last element", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    const lastChild = deps.tabBarEl.lastElementChild;
    expect(lastChild?.classList.contains("tab-add")).toBe(true);
    expect(lastChild?.textContent).toBe("+");
  });

  it("preserves tab elements across re-renders", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    const before = deps.tabBarEl.querySelectorAll(".tab-item");
    renderTabBar(deps);
    const after = deps.tabBarEl.querySelectorAll(".tab-item");
    expect(after.length).toBe(2);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  // ─── Click Handlers ─────────────────────────────────────────────

  it("calls onTabClick when tab is clicked", () => {
    const onTabClick = vi.fn();
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1", onTabClick });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll(".tab-item");
    (tabs[1] as HTMLElement).click();
    expect(onTabClick).toHaveBeenCalledWith("tab-2");
  });

  it("calls onTabClose when close button is clicked with stopPropagation", () => {
    const onTabClick = vi.fn();
    const onTabClose = vi.fn();
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({
      terminals: terminals as never,
      activeTabId: "tab-1",
      onTabClick,
      onTabClose,
    });
    renderTabBar(deps);
    const closeButtons = deps.tabBarEl.querySelectorAll(".tab-close");
    (closeButtons[0] as HTMLElement).click();
    expect(onTabClose).toHaveBeenCalledWith("tab-1");
    // Tab click should NOT have been called (stopPropagation)
    expect(onTabClick).not.toHaveBeenCalled();
  });

  it("calls onAddClick when add button is clicked", () => {
    const onAddClick = vi.fn();
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1", onAddClick });
    renderTabBar(deps);
    const addButton = deps.tabBarEl.querySelector(".tab-add") as HTMLElement;
    addButton.click();
    expect(onAddClick).toHaveBeenCalled();
  });

  // ─── Tab bar after removal ──────────────────────────────────────

  it("hides tab bar after removal leaves 1 tab", () => {
    const terminals = new Map<string, { name: string }>([["tab-1", { name: "Terminal 1" }]]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    expect(deps.tabBarEl.classList.contains("visible")).toBe(false);
  });

  it("shows tab bar after removal leaves 2 tabs", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    expect(deps.tabBarEl.classList.contains("visible")).toBe(true);
  });

  it("handles empty terminals map (0 tabs)", () => {
    const deps = createMockDeps();
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll(".tab-item");
    expect(tabs.length).toBe(0);
    expect(deps.tabBarEl.classList.contains("visible")).toBe(false);
  });

  // ─── Exited State ──────────────────────────────────────────────────

  it("applies tab-exited class when exited is true", () => {
    const terminals = new Map<string, { name: string; exited?: boolean }>([
      ["tab-1", { name: "Terminal 1", exited: true }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll(".tab-item");
    expect(tabs[0].classList.contains("tab-exited")).toBe(true);
    expect(tabs[1].classList.contains("tab-exited")).toBe(false);
  });

  it("shows '(exited)' suffix in tab name when exited is true", () => {
    const terminals = new Map<string, { name: string; exited?: boolean }>([
      ["tab-1", { name: "zsh", exited: true }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll(".tab-item");
    expect(tabs[0].querySelector(".tab-name")?.textContent).toBe("zsh (exited)");
    expect(tabs[1].querySelector(".tab-name")?.textContent).toBe("Terminal 2");
  });

  it("does not apply tab-exited class when exited is false or undefined", () => {
    const terminals = new Map<string, { name: string; exited?: boolean }>([
      ["tab-1", { name: "Terminal 1", exited: false }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll(".tab-item");
    expect(tabs[0].classList.contains("tab-exited")).toBe(false);
    expect(tabs[1].classList.contains("tab-exited")).toBe(false);
  });

  it("renders updated tab names from OSC title changes", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "user@host:~/dir" }],
      ["tab-2", { name: "node index.js" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll(".tab-item");
    expect(tabs[0].querySelector(".tab-name")?.textContent).toBe("user@host:~/dir");
    expect(tabs[1].querySelector(".tab-name")?.textContent).toBe("node index.js");
  });

  it("renders running, idle, and exited status indicators", () => {
    const terminals = new Map<string, { name: string; activityStatus?: "idle" | "running"; exited?: boolean }>([
      ["tab-1", { name: "Codex", activityStatus: "running" }],
      ["tab-2", { name: "Grok", activityStatus: "idle" }],
      ["tab-3", { name: "Shell", activityStatus: "running", exited: true }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });

    renderTabBar(deps);

    const tabs = deps.tabBarEl.querySelectorAll<HTMLElement>(".tab-item");
    expect(tabs[0].dataset.status).toBe("running");
    expect(tabs[0].querySelector(".tab-status-running")).toBeTruthy();
    expect(tabs[1].dataset.status).toBe("idle");
    expect(tabs[1].querySelector(".tab-status-idle")).toBeTruthy();
    expect(tabs[2].dataset.status).toBe("exited");
    expect(tabs[2].querySelector(".tab-status-exited")).toBeTruthy();
  });
});

// ─── handleTabKeyboardShortcut ──────────────────────────────────────

describe("handleTabKeyboardShortcut", () => {
  function createKeyboardDeps(overrides: Partial<TabKeyboardDeps> = {}): TabKeyboardDeps {
    return {
      terminals: new Map(),
      activeTabId: null,
      switchTab: vi.fn(),
      ...overrides,
    };
  }

  function makeKeyEvent(overrides: Partial<{ ctrlKey: boolean; shiftKey: boolean; key: string }> = {}) {
    return {
      ctrlKey: true,
      shiftKey: false,
      key: "Tab",
      ...overrides,
    };
  }

  it("returns false for non-Ctrl+Tab events", () => {
    const deps = createKeyboardDeps();
    expect(handleTabKeyboardShortcut(makeKeyEvent({ ctrlKey: false }), deps)).toBe(false);
    expect(handleTabKeyboardShortcut(makeKeyEvent({ key: "a" }), deps)).toBe(false);
  });

  it("is no-op when single tab exists", () => {
    const terminals = new Map<string, { name: string }>([["tab-1", { name: "Terminal 1" }]]);
    const deps = createKeyboardDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    const result = handleTabKeyboardShortcut(makeKeyEvent(), deps);
    expect(result).toBe(true); // Handled
    expect(deps.switchTab).not.toHaveBeenCalled();
  });

  it("cycles forward with Ctrl+Tab", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
      ["tab-3", { name: "Terminal 3" }],
    ]);
    const deps = createKeyboardDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    handleTabKeyboardShortcut(makeKeyEvent(), deps);
    expect(deps.switchTab).toHaveBeenCalledWith("tab-2");
  });

  it("wraps around forward with Ctrl+Tab", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
      ["tab-3", { name: "Terminal 3" }],
    ]);
    const deps = createKeyboardDeps({ terminals: terminals as never, activeTabId: "tab-3" });
    handleTabKeyboardShortcut(makeKeyEvent(), deps);
    expect(deps.switchTab).toHaveBeenCalledWith("tab-1");
  });

  it("cycles backward with Ctrl+Shift+Tab", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
      ["tab-3", { name: "Terminal 3" }],
    ]);
    const deps = createKeyboardDeps({ terminals: terminals as never, activeTabId: "tab-2" });
    handleTabKeyboardShortcut(makeKeyEvent({ shiftKey: true }), deps);
    expect(deps.switchTab).toHaveBeenCalledWith("tab-1");
  });

  it("wraps around backward with Ctrl+Shift+Tab", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
      ["tab-3", { name: "Terminal 3" }],
    ]);
    const deps = createKeyboardDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    handleTabKeyboardShortcut(makeKeyEvent({ shiftKey: true }), deps);
    expect(deps.switchTab).toHaveBeenCalledWith("tab-3");
  });

  it("is no-op when 0 terminals exist", () => {
    const deps = createKeyboardDeps();
    const result = handleTabKeyboardShortcut(makeKeyEvent(), deps);
    expect(result).toBe(true);
    expect(deps.switchTab).not.toHaveBeenCalled();
  });
});

// ─── customName render priority (add-tab-rename) ─────────────────────

describe("renderTabBar: customName render priority", () => {
  it("renders customName instead of name when customName is non-null", () => {
    const terminals = new Map<string, { name: string; customName: string | null }>([
      ["tab-1", { name: "Terminal 1", customName: "build" }],
      ["tab-2", { name: "node index.js", customName: null }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll(".tab-item");
    expect(tabs[0].querySelector(".tab-name")?.textContent).toBe("build");
    expect(tabs[1].querySelector(".tab-name")?.textContent).toBe("node index.js");
  });

  it("falls back to name when customName is null or undefined", () => {
    const terminals = new Map<string, { name: string; customName?: string | null }>([
      ["tab-1", { name: "Terminal 1", customName: null }],
      ["tab-2", { name: "Terminal 2" }], // customName field absent
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll(".tab-item");
    expect(tabs[0].querySelector(".tab-name")?.textContent).toBe("Terminal 1");
    expect(tabs[1].querySelector(".tab-name")?.textContent).toBe("Terminal 2");
  });

  it("appends (exited) suffix to customName when the session has exited", () => {
    const terminals = new Map<string, { name: string; customName: string | null; exited: boolean }>([
      ["tab-1", { name: "Terminal 1", customName: "build", exited: true }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-1" });
    renderTabBar(deps);
    expect(deps.tabBarEl.querySelector(".tab-name")?.textContent).toBe("build (exited)");
  });
});

describe("renderTabBar: tab DOM carries data-vscode-context for rename menu", () => {
  it("each tab has data-vscode-context with webviewSection=terminalTab + tabId", () => {
    const terminals = new Map<string, { name: string }>([
      ["tab-abc", { name: "Terminal 1" }],
      ["tab-def", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({ terminals: terminals as never, activeTabId: "tab-abc" });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll<HTMLElement>(".tab-item");
    expect(JSON.parse(tabs[0].dataset.vscodeContext!)).toEqual({
      webviewSection: "terminalTab",
      tabId: "tab-abc",
    });
    expect(JSON.parse(tabs[1].dataset.vscodeContext!)).toEqual({
      webviewSection: "terminalTab",
      tabId: "tab-def",
    });
  });
});

describe("renderTabBar: onTabRename + onAfterRender hooks", () => {
  it("uses native dblclick for rename while preserving the tab node", () => {
    const onTabClick = vi.fn();
    const onTabRename = vi.fn();
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({
      terminals: terminals as never,
      activeTabId: "tab-1",
      onTabClick,
      onTabRename,
    });
    renderTabBar(deps);
    const tab = deps.tabBarEl.querySelectorAll<HTMLElement>(".tab-item")[1];
    deps.activeTabId = "tab-2";
    renderTabBar(deps);
    expect(deps.tabBarEl.querySelectorAll<HTMLElement>(".tab-item")[1]).toBe(tab);

    tab.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    tab.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
    tab.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));

    expect(onTabClick).toHaveBeenCalledTimes(1);
    expect(onTabClick).toHaveBeenCalledWith("tab-2");
    expect(onTabRename).toHaveBeenCalledTimes(1);
    expect(onTabRename).toHaveBeenCalledWith("tab-2", tab);
  });

  it("does not reinterpret regular clicks as rename after another switch path", () => {
    const onTabClick = vi.fn();
    const onTabRename = vi.fn();
    const terminals = new Map<string, { name: string }>([
      ["tab-1", { name: "Terminal 1" }],
      ["tab-2", { name: "Terminal 2" }],
    ]);
    const deps = createMockDeps({
      terminals: terminals as never,
      activeTabId: "tab-1",
      onTabClick,
      onTabRename,
    });
    renderTabBar(deps);
    const tabs = deps.tabBarEl.querySelectorAll<HTMLElement>(".tab-item");
    tabs[1].dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    deps.activeTabId = "tab-2";
    renderTabBar(deps);
    deps.activeTabId = "tab-1";
    renderTabBar(deps);
    tabs[1].dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));

    expect(onTabClick).toHaveBeenCalledTimes(2);
    expect(onTabRename).not.toHaveBeenCalled();
  });

  it("calls onAfterRender at the end of each render (if provided)", () => {
    const onAfterRender = vi.fn();
    const terminals = new Map<string, { name: string }>([["tab-1", { name: "Terminal 1" }]]);
    const deps = createMockDeps({
      terminals: terminals as never,
      activeTabId: "tab-1",
      onAfterRender,
    });
    renderTabBar(deps);
    expect(onAfterRender).toHaveBeenCalledTimes(1);
  });
});
