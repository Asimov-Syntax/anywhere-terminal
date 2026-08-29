// src/webview/TabBarUtils.ts — Tab bar rendering utility
//
// Extracted for testability. Pure DOM rendering function with dependency injection.
// See: docs/design/flow-multi-tab.md#Data-Routing-Architecture

import { getAllSessionIds, type SplitNode } from "./SplitModel";
import type { TerminalInstance } from "./state/WebviewStateStore";

/** Minimal terminal info needed for tab bar rendering. */
export interface TabInfo {
  /** Auto-derived name (default "Terminal N"; mutated by OSC title events). */
  name: string;
  /** User-supplied name; when non-null wins over `name` in the rendered label. */
  customName?: string | null;
  /** Whether the terminal process has exited. */
  exited?: boolean;
  /** Recent PTY output activity for the status indicator. */
  activityStatus?: "idle" | "running" | "waiting";
}

/** Minimal store interface for buildTabBarData — avoids importing full WebviewStateStore. */
export interface TabBarDataSource {
  tabLayouts: Map<string, SplitNode>;
  tabActivePaneIds: Map<string, string>;
  terminals: Map<string, TerminalInstance>;
}

/**
 * A surface's scope, and the evidence it filters by. Absent → unscoped, and every
 * tab is presented.
 */
export interface TabBarScope {
  /** The worktree this surface is scoped to. */
  worktreeId: string;
  /**
   * paneId → worktreeId, from the presence projection (design.md D2). An ABSENT
   * key means the evidence does not place that pane, which is presented in every
   * scope — there is no third value, because one would invite a fourth outcome.
   */
  attribution: ReadonlyMap<string, string>;
}

/**
 * Whether a scope can prove this pane belongs to a different worktree. Anything
 * else — placed here, or not placed at all — is presented: the bar hides only
 * what it can prove belongs elsewhere.
 */
function inScope(scope: TabBarScope | undefined, paneId: string): boolean {
  if (!scope) {
    return true;
  }
  const held = scope.attribution.get(paneId);
  return held === undefined || held === scope.worktreeId;
}

/**
 * Build a filtered terminals map for tab bar rendering.
 * Only includes "root" tabs (those with a tabLayout entry).
 * For split tabs, uses the active pane's name.
 */
/**
 * A pane's auto-derived label, falling back to the `Terminal N` it started with
 * when the program cleared its title. Resolved here rather than at each render
 * site so root tabs and split tabs cannot disagree about it, and so nothing
 * downstream has to know that an empty `name` is a real state
 * (process-title-tracking § "OSC Title Change Handling").
 */
function labelFor(instance: TerminalInstance | undefined): string | undefined {
  if (!instance) {
    return undefined;
  }
  return instance.name === "" ? instance.defaultName : instance.name;
}

export function buildTabBarData(store: TabBarDataSource, scope?: TabBarScope): Map<string, TabInfo> {
  const tabTerminals = new Map<string, TabInfo>();
  for (const [tabId, layout] of store.tabLayouts) {
    if (layout.type === "branch") {
      // Split tab — show active pane's name and exited state. Custom name lives
      // on the root tab and wins over per-pane process names (see add-tab-rename
      // design.md D5 + split-focus-management spec). Activity aggregates across
      // panes: any non-exited leaf still producing output lights the tab.
      const activePaneId = store.tabActivePaneIds.get(tabId) ?? tabId;
      const activeInstance = store.terminals.get(activePaneId);
      const rootInstance = store.terminals.get(tabId);
      // A split is one tab over several panes, so the same "prove it belongs
      // elsewhere" rule applies to the SET: it survives while any one of its
      // panes is in scope or unplaced, and is dropped only when every one of
      // them is attributed somewhere else.
      const sessionIds = getAllSessionIds(layout);
      if (!sessionIds.some((sid) => inScope(scope, sid))) {
        continue;
      }
      const leaves = sessionIds.map((sid) => store.terminals.get(sid));
      const anyWaiting = leaves.some((inst) => inst?.activityStatus === "waiting" && !inst.exited);
      const anyRunning = leaves.some((inst) => inst?.activityStatus === "running" && !inst.exited);
      tabTerminals.set(tabId, {
        name: labelFor(activeInstance) ?? labelFor(rootInstance) ?? tabId,
        customName: rootInstance?.customName ?? null,
        exited: (activeInstance ?? rootInstance)?.exited,
        activityStatus: anyWaiting ? "waiting" : anyRunning ? "running" : "idle",
      });
    } else {
      // Single pane tab
      const instance = store.terminals.get(tabId);
      if (instance && inScope(scope, tabId)) {
        tabTerminals.set(tabId, {
          name: labelFor(instance) ?? tabId,
          customName: instance.customName,
          exited: instance.exited,
          activityStatus: instance.activityStatus,
        });
      }
    }
  }
  return tabTerminals;
}

interface TabHandlers {
  id: string;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabRename?: (tabId: string, tabEl: HTMLElement) => void;
}

const tabHandlers = new WeakMap<HTMLElement, TabHandlers>();

/** Dependencies for renderTabBar — injected for testability. */
export interface RenderTabBarDeps {
  tabBarEl: HTMLElement;
  terminals: Map<string, TabInfo>;
  activeTabId: string | null;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onAddClick: () => void;
  /**
   * Double-click on a tab triggers inline rename. Receives the tab id and the
   * tab element so the caller can spawn an overlay anchored to it.
   * Optional so tests not exercising rename can omit it.
   */
  onTabRename?: (tabId: string, tabEl: HTMLElement) => void;
  /**
   * Hook called at the tail of renderTabBar — used by callers to reposition
   * an active inline-rename overlay over the (possibly re-rendered) tab DOM.
   */
  onAfterRender?: () => void;
  /**
   * Present exactly while this surface is scoped, which is why it is ONE field
   * rather than a boolean beside a label: the chip is the only thing on screen
   * saying the list is a subset, and a filter without it is the invisible filter
   * the whole change exists to avoid. It is also the SECOND, independent reason
   * for the bar to be visible — not a reinterpretation of the tab count — so a
   * scope filtering down to one tab cannot hide its own escape hatch (D3, D4).
   */
  scope?: { label: string; onClear: () => void };
}

/**
 * Render the tab bar UI inside the given element.
 *
 * - Reconciles tab elements by ID so in-flight pointer events survive updates
 * - Updates tab name, status, active state, and close button in place
 * - Appends "+" add button
 * - Hides tab bar when <= 1 tab and the surface is unscoped (clean single-tab UX)
 * - Shows tab bar when 2+ tabs, or whatever the count while the surface is scoped
 */
export function renderTabBar(deps: RenderTabBarDeps): void {
  const { tabBarEl, terminals, activeTabId, onTabClick, onTabClose, onAddClick, onTabRename, onAfterRender, scope } =
    deps;

  const existingTabs = new Map<string, HTMLDivElement>();
  for (const child of Array.from(tabBarEl.children)) {
    if (child instanceof HTMLDivElement && child.classList.contains("tab-item") && child.dataset.tabId) {
      existingTabs.set(child.dataset.tabId, child);
    }
  }

  // The chip is the head of the same reconciled child list the tabs and the "+"
  // live in, so it survives a re-render the way they do and needs no second render
  // path (design.md D4).
  let chip = tabBarEl.querySelector<HTMLDivElement>(":scope > .tab-scope") ?? undefined;
  if (scope) {
    if (!chip) {
      chip = document.createElement("div");
      chip.className = "tab-scope";
      // A generic div carries no role, and an `aria-label` on one is not a
      // dependable accessible name — a screen reader would reach the branch and
      // the clear button without ever being told the list is filtered.
      chip.setAttribute("role", "group");
      const name = document.createElement("span");
      name.className = "tab-scope-name";
      chip.appendChild(name);
      const clear = document.createElement("button");
      clear.className = "tab-scope-clear";
      clear.type = "button";
      clear.textContent = "\u00d7";
      chip.appendChild(clear);
    }
    const name = chip.querySelector<HTMLElement>(".tab-scope-name");
    if (name && name.textContent !== scope.label) {
      name.textContent = scope.label;
    }
    // Said, not implied by a visual mark: the bar looks complete either way, so
    // the only thing distinguishing a subset from the whole list is this sentence.
    chip.title = `Showing only tabs in ${scope.label}`;
    chip.setAttribute("aria-label", `Showing only tabs in ${scope.label}`);
    const clear = chip.querySelector<HTMLButtonElement>(".tab-scope-clear");
    if (clear) {
      clear.setAttribute("aria-label", `Clear the ${scope.label} scope`);
      // Rebound on every render, so a stale closure never outlives the scope it named.
      clear.onclick = () => {
        const hadFocus = document.activeElement === clear;
        scope.onClear();
        // The click destroys the button it came from, so focus would land on
        // `<body>` and a keyboard user would restart from the top of the document.
        // Handed to the nearest surviving control in the same widget (round-2 V8).
        if (hadFocus) {
          tabBarEl.querySelector<HTMLButtonElement>(".tab-add")?.focus();
        }
      };
    }
  } else if (chip) {
    chip.remove();
    chip = undefined;
  }

  const orderedTabs: HTMLDivElement[] = [];
  for (const [id, instance] of terminals) {
    let tab = existingTabs.get(id);
    if (!tab) {
      tab = document.createElement("div");
      const statusSpan = document.createElement("span");
      statusSpan.className = "tab-status";
      statusSpan.setAttribute("aria-hidden", "true");
      tab.appendChild(statusSpan);

      const nameSpan = document.createElement("span");
      nameSpan.className = "tab-name";
      tab.appendChild(nameSpan);

      const closeBtn = document.createElement("button");
      closeBtn.className = "tab-close";
      closeBtn.textContent = "\u00d7";
      closeBtn.type = "button";
      closeBtn.setAttribute("aria-label", "Close terminal tab");
      closeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        const handlers = tabHandlers.get(tab!);
        if (handlers) {
          handlers.onTabClose(handlers.id);
        }
      });
      closeBtn.addEventListener("dblclick", (event) => event.stopPropagation());
      tab.appendChild(closeBtn);

      tab.addEventListener("click", (event) => {
        // The second click of a native double-click is followed by `dblclick`.
        // Skip only that click; unlike the old timestamp heuristic, this cannot
        // consume a later click after a keyboard/programmatic tab switch.
        if (event.detail > 1) {
          return;
        }
        const handlers = tabHandlers.get(tab!);
        if (handlers) {
          handlers.onTabClick(handlers.id);
        }
      });
      tab.addEventListener("dblclick", (event) => {
        event.preventDefault();
        const handlers = tabHandlers.get(tab!);
        handlers?.onTabRename?.(handlers.id, tab!);
      });
    }
    existingTabs.delete(id);
    orderedTabs.push(tab);
    tabHandlers.set(tab, { id, onTabClick, onTabClose, onTabRename });

    tab.className = `tab-item${id === activeTabId ? " active" : ""}${instance.exited ? " tab-exited" : ""}`;
    tab.dataset.tabId = id;
    // VS Code native context menu support — `webviewSection == 'terminalTab'`
    // gates the `Rename Tab…` entry. The tabId is read by the command handler.
    tab.dataset.vscodeContext = JSON.stringify({ webviewSection: "terminalTab", tabId: id });

    // Custom name takes priority over the auto-derived (OSC-mutated) `name`.
    // See add-tab-rename design.md D1.
    const displayName = instance.customName ?? instance.name;
    const nameSpan = tab.querySelector<HTMLElement>(".tab-name")!;
    const renderedName = instance.exited ? `${displayName} (exited)` : displayName;
    if (nameSpan.textContent !== renderedName) {
      nameSpan.textContent = renderedName;
    }

    const status = instance.exited ? "exited" : (instance.activityStatus ?? "idle");
    const statusSpan = tab.querySelector<HTMLElement>(".tab-status")!;
    statusSpan.className = `tab-status tab-status-${status}`;
    statusSpan.title =
      status === "waiting"
        ? "Cursor approval required"
        : status === "running"
          ? "Terminal is producing output"
          : status === "exited"
            ? "Terminal exited"
            : "Terminal idle";
    tab.setAttribute("aria-label", status === "waiting" ? `${renderedName}: Cursor approval required` : renderedName);
    tab.dataset.status = status;
  }

  for (const staleTab of existingTabs.values()) {
    staleTab.remove();
  }

  let addBtn = Array.from(tabBarEl.children).find((child) => child.classList.contains("tab-add")) as
    | HTMLButtonElement
    | undefined;
  if (!addBtn) {
    addBtn = document.createElement("button");
    addBtn.className = "tab-add";
    addBtn.textContent = "+";
    addBtn.type = "button";
    addBtn.setAttribute("aria-label", "Create terminal tab");
  }
  addBtn.onclick = () => onAddClick();

  // Preserve nodes that are already in the right position. Avoiding even a
  // same-parent remove/reinsert is what keeps pointerdown/up targeting stable.
  let cursor = tabBarEl.firstElementChild;
  if (chip) {
    if (chip !== cursor) {
      tabBarEl.insertBefore(chip, cursor);
    }
    cursor = chip.nextElementSibling;
  }
  for (const tab of orderedTabs) {
    if (tab !== cursor) {
      tabBarEl.insertBefore(tab, cursor);
    }
    cursor = tab.nextElementSibling;
  }
  if (addBtn !== cursor) {
    tabBarEl.insertBefore(addBtn, cursor);
  }
  cursor = addBtn.nextElementSibling;
  while (cursor) {
    const next = cursor.nextElementSibling;
    cursor.remove();
    cursor = next;
  }

  // Toggle visibility: hide when <= 1 tab and unscoped, show when 2+ OR scoped.
  if (terminals.size >= 2 || scope !== undefined) {
    tabBarEl.classList.add("visible");
  } else {
    tabBarEl.classList.remove("visible");
  }

  // After-render hook (e.g. reposition the inline-rename overlay so it stays
  // anchored to the target tab across re-renders). See add-tab-rename D4.
  if (onAfterRender) {
    onAfterRender();
  }
}

/** Dependencies for tab keyboard shortcut handler. */
export interface TabKeyboardDeps {
  terminals: Map<string, TabInfo>;
  activeTabId: string | null;
  switchTab: (tabId: string) => void;
}

/**
 * Handle Ctrl+Tab / Ctrl+Shift+Tab keyboard events for tab cycling.
 * Returns true if the event was handled (caller should preventDefault).
 *
 * See: docs/design/flow-multi-tab.md#Keyboard-Shortcut
 */
export function handleTabKeyboardShortcut(
  e: { ctrlKey: boolean; shiftKey: boolean; key: string },
  deps: TabKeyboardDeps,
): boolean {
  if (!e.ctrlKey || e.key !== "Tab") {
    return false;
  }

  const tabIds = Array.from(deps.terminals.keys());
  if (tabIds.length <= 1) {
    return true; // Handled but no-op (single tab)
  }

  const currentIndex = deps.activeTabId ? tabIds.indexOf(deps.activeTabId) : -1;
  if (currentIndex === -1) {
    return true;
  }

  let nextIndex: number;
  if (e.shiftKey) {
    // Ctrl+Shift+Tab: cycle backward with wrap-around
    nextIndex = (currentIndex - 1 + tabIds.length) % tabIds.length;
  } else {
    // Ctrl+Tab: cycle forward with wrap-around
    nextIndex = (currentIndex + 1) % tabIds.length;
  }

  deps.switchTab(tabIds[nextIndex]);
  return true;
}
