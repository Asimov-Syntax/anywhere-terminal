// @vitest-environment jsdom

// VaultPanel collapse behaviour: default-collapsed, toggle/expand persistence,
// header-click toggle, and the session-count badge. The vault is now a
// collapsible section stacked above the file tree (no panel exclusivity).

import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultListResult, VaultSessionEntry } from "../../vault/types";
import { resetTooltipForTests } from "../ui/Tooltip";
import { VaultPanel } from "./VaultPanel";

afterEach(() => {
  // Each createHost() appends a host to document.body and tests never remove it.
  // Close any preview still open (its document-level Esc/pointerdown listeners
  // would otherwise outlive the test), then clear the body so accumulated hosts +
  // stale overlays can't pollute later tests under full-suite scheduling.
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  resetTooltipForTests(); // detach the shared tooltip widget + clear its pending timer
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function createHost(): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host;
}

/** Drain pending microtasks. Copies queue on a promise chain (review B2), so a
 *  click's write is issued a few ticks later rather than synchronously. */
async function flush(): Promise<void> {
  // One macrotask turn: the microtask queue drains completely before it runs, so
  // this settles a chain of any length without counting ticks.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Install a fake `navigator.clipboard` (jsdom ships none) and return the array
 *  it records writes into, in call order. `onWrite` overrides the outcome so a
 *  rejection can be exercised. Restored by the `vi.unstubAllGlobals` afterEach. */
function stubClipboard(onWrite?: () => Promise<void>): string[] {
  const writes: string[] = [];
  vi.stubGlobal("navigator", {
    ...navigator,
    clipboard: {
      writeText: (text: string) => {
        writes.push(text);
        return onWrite ? onWrite() : Promise.resolve();
      },
    },
  });
  return writes;
}

/** Hover a tooltip target, let the show delay elapse, and return what the shared
 *  widget rendered ("" when it stayed hidden). Requires fake timers. */
function hoverTooltipText(target: HTMLElement): string {
  target.dispatchEvent(new MouseEvent("mouseenter"));
  vi.advanceTimersByTime(500);
  const widget = document.getElementById("webview-tooltip-widget");
  const text = widget && widget.style.display !== "none" ? (widget.textContent ?? "") : "";
  target.dispatchEvent(new MouseEvent("mouseleave"));
  return text;
}

function entry(over: Partial<VaultSessionEntry> = {}): VaultSessionEntry {
  return {
    id: "claude:abc",
    agent: "claude",
    sessionId: "abc",
    title: "hello",
    cwd: "/work/repo",
    modified: Date.now(),
    flags: {},
    canFork: false,
    ...over,
  };
}

function result(entries: VaultSessionEntry[], unreadable = 0, reasons: string[] = []): VaultListResult {
  return { entries, unreadable: { count: unreadable, reasons } };
}

describe("VaultPanel collapse", () => {
  it("defaults to collapsed when no initial state is given", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {} });
    expect(panel.isCollapsed()).toBe(true);
    expect(host.classList.contains("vault-collapsed")).toBe(true);
    expect(host.querySelector(".vault-header")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("honours getInitialCollapsed=false (expanded)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    expect(panel.isCollapsed()).toBe(false);
    expect(host.classList.contains("vault-collapsed")).toBe(false);
    expect(host.querySelector(".vault-header")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("does NOT persist the initial seed (persist:false)", () => {
    const host = createHost();
    const persisted: boolean[] = [];
    new VaultPanel({ host, postMessage: () => {}, persistCollapsed: (c) => persisted.push(c) });
    expect(persisted).toEqual([]);
  });

  it("toggleCollapsed flips state and persists", () => {
    const host = createHost();
    const persisted: boolean[] = [];
    const panel = new VaultPanel({ host, postMessage: () => {}, persistCollapsed: (c) => persisted.push(c) });

    panel.toggleCollapsed(); // collapsed -> expanded
    expect(panel.isCollapsed()).toBe(false);
    expect(host.classList.contains("vault-collapsed")).toBe(false);

    panel.toggleCollapsed(); // expanded -> collapsed
    expect(panel.isCollapsed()).toBe(true);
    expect(persisted).toEqual([false, true]);
  });

  it("expand() opens a collapsed panel and is a no-op when already open", () => {
    const host = createHost();
    const persisted: boolean[] = [];
    const panel = new VaultPanel({ host, postMessage: () => {}, persistCollapsed: (c) => persisted.push(c) });

    panel.expand();
    expect(panel.isCollapsed()).toBe(false);
    panel.expand(); // already expanded — no further persist
    expect(persisted).toEqual([false]);
  });

  it("clicking the header toggles collapse", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {} });
    const header = host.querySelector<HTMLElement>(".vault-header");
    expect(panel.isCollapsed()).toBe(true);
    header?.click();
    expect(panel.isCollapsed()).toBe(false);
    header?.click();
    expect(panel.isCollapsed()).toBe(true);
  });

  it("render updates the session-count badge", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {} });
    const count = host.querySelector(".vault-header__count");
    expect(count?.textContent).toBe("");

    panel.render(result([entry({ id: "claude:a" }), entry({ id: "codex:b", agent: "codex" })]));
    expect(count?.textContent).toBe("2");

    panel.render(result([]));
    expect(count?.textContent).toBe("");
  });

  it("count badge reflects the filtered (visible) count, not the total", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {} });
    const count = host.querySelector(".vault-header__count");

    panel.render(
      result([
        entry({ id: "a", cwd: "/work/repo" }),
        entry({ id: "b", cwd: "/work/repo/src" }),
        entry({ id: "c", cwd: "/other/proj" }),
      ]),
    );
    expect(count?.textContent).toBe("3");

    panel.setContextCwd("/work/repo");
    panel.setFolderOnly(true);
    // 2 of 3 sit within /work/repo → the badge tracks what the list shows.
    expect(count?.textContent).toBe("2");
  });

  it("runs the collapse animation (applying the change) on user toggles but not on the seed", () => {
    const host = createHost();
    let calls = 0;
    const panel = new VaultPanel({
      host,
      postMessage: () => {},
      animateCollapse: (apply) => {
        calls++;
        apply();
      },
    });
    // Constructor seed (persist:false) applies directly — not animated.
    expect(calls).toBe(0);
    expect(panel.isCollapsed()).toBe(true);

    panel.toggleCollapsed(); // collapsed -> expanded (user)
    expect(calls).toBe(1);
    expect(panel.isCollapsed()).toBe(false);
    expect(host.classList.contains("vault-collapsed")).toBe(false); // apply() ran

    panel.toggleCollapsed(); // expanded -> collapsed (user)
    expect(calls).toBe(2);

    panel.expand(); // collapsed -> expanded
    panel.expand(); // already expanded — no-op, no animation
    expect(calls).toBe(3);
  });

  it("requests the session list when expanding (refresh on open)", () => {
    const host = createHost();
    const posted: { type: string }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m) });
    const refreshes = () => posted.filter((m) => m.type === "requestVaultSessions").length;

    // Default collapsed → nothing fetched yet.
    expect(refreshes()).toBe(0);

    panel.toggleCollapsed(); // expand → fetch
    expect(refreshes()).toBe(1);

    panel.toggleCollapsed(); // collapse → no fetch
    expect(refreshes()).toBe(1);

    panel.toggleCollapsed(); // expand again → fetch
    expect(refreshes()).toBe(2);
  });

  it("fetches on mount when restored expanded", () => {
    const host = createHost();
    const posted: { type: string }[] = [];
    new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    expect(posted.filter((m) => m.type === "requestVaultSessions")).toHaveLength(1);
  });
});

describe("VaultPanel row rendering (redesign 4_1)", () => {
  it("marks each row with an accent-colored agent dot (no brand icon on rows)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a", agent: "claude" })]));
    const dot = host.querySelector(".vault-row .vault-row-dot");
    expect(dot?.classList.contains("vault-row-dot--claude")).toBe(true);
    // The real brand icon stays on the group/preview headers, not on rows.
    expect(host.querySelector(".vault-row .vault-badge")).toBeNull();
  });

  it("never turns an unknown/session-derived agent into a CSS class (W6)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "ghost:a", agent: "ghost is-maximized" })]));
    const dot = host.querySelector<HTMLElement>(".vault-row .vault-row-dot");
    // Only the closed accent set may add a class; an unknown agent adds none.
    expect(dot?.className).toBe("vault-row-dot");
    expect(Array.from(dot?.classList ?? []).some((c) => c.startsWith("vault-row-dot--"))).toBe(false);
  });

  it("never renders a fork button and never posts vaultFork", () => {
    const host = createHost();
    const posted: { type: string }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    // canFork:true would have produced a fork button under the old UI.
    panel.render(result([entry({ id: "claude:a", canFork: true })]));
    expect(host.querySelector(".vault-action--fork")).toBeNull();
    expect(host.querySelectorAll(".vault-action--resume")).toHaveLength(1);
    expect(posted.some((m) => m.type === "vaultFork")).toBe(false);
  });

  it("writes the (untrusted) title via textContent, not innerHTML", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a", title: "<img src=x onerror=alert(1)>" })]));
    const titleEl = host.querySelector(".vault-row-title");
    expect(titleEl?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(titleEl?.querySelector("img")).toBeNull();
  });

  it("posts vaultResume with the entry id when the icon-only Resume is clicked", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "codex:x1", agent: "codex" })]));
    host.querySelector<HTMLButtonElement>(".vault-action--resume")?.click();
    expect(posted).toContainEqual({ type: "vaultResume", entryId: "codex:x1" });
  });
});

describe("VaultPanel grouping + states (redesign 4_2)", () => {
  it("Recent mode renders a flat list with no group headers", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" }), entry({ id: "codex:b", agent: "codex" })]));
    expect(host.querySelectorAll(".vault-group-header")).toHaveLength(0);
    expect(host.querySelectorAll(".vault-row")).toHaveLength(2);
  });

  it("Agent mode renders a group header per agent with the real brand icon + count", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a", agent: "claude" }), entry({ id: "codex:b", agent: "codex" })]));
    panel.setGroupMode("agent");
    const headers = host.querySelectorAll(".vault-group-header");
    expect(headers).toHaveLength(2);
    // The agent header carries the brand badge SVG (not a plain colored dot).
    const badge = host.querySelector(".vault-group-header .vault-group-badge");
    expect(badge?.querySelector("svg")).not.toBeNull();
    expect(host.querySelector(".vault-group-dot")).toBeNull();
  });

  it("Folder mode collapses a group on header click, hiding its rows", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "a", cwd: "/work/repo" }), entry({ id: "b", cwd: "/work/repo" })]));
    panel.setGroupMode("folder");
    expect(host.querySelectorAll(".vault-row")).toHaveLength(2);
    host.querySelector<HTMLElement>(".vault-group-header--folder")?.click();
    expect(host.querySelectorAll(".vault-row")).toHaveLength(0);
    expect(host.querySelector(".vault-group-header--folder.is-collapsed")).not.toBeNull();
  });

  it("Agent mode collapses/expands a group on header click, hiding its rows", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a", agent: "claude" }), entry({ id: "claude:b", agent: "claude" })]));
    panel.setGroupMode("agent");
    expect(host.querySelectorAll(".vault-row")).toHaveLength(2);
    // The agent header (not just folder) is now a collapse toggle.
    host.querySelector<HTMLElement>(".vault-group-header")?.click();
    expect(host.querySelectorAll(".vault-row")).toHaveLength(0);
    expect(host.querySelector(".vault-group-header.is-collapsed")).not.toBeNull();
    // Re-click expands it back.
    host.querySelector<HTMLElement>(".vault-group-header")?.click();
    expect(host.querySelectorAll(".vault-row")).toHaveLength(2);
    expect(host.querySelector(".vault-group-header.is-collapsed")).toBeNull();
  });

  it("seeds + persists the grouping mode", () => {
    const host = createHost();
    const persisted: string[] = [];
    const panel = new VaultPanel({
      host,
      postMessage: () => {},
      getInitialCollapsed: () => false,
      getInitialGroupMode: () => "agent",
      persistGroupMode: (m) => persisted.push(m),
    });
    expect(host.querySelector('.vault-segmented button[data-mode="agent"]')?.getAttribute("aria-selected")).toBe(
      "true",
    );
    panel.render(result([entry({ id: "claude:a" })]));
    expect(host.querySelectorAll(".vault-group-header")).toHaveLength(1); // grouped on seed
    panel.setGroupMode("folder");
    expect(persisted).toEqual(["folder"]);
  });

  it("shows a distinct no-match state (not the empty state) when a search filters everything out", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "a", title: "hello world" })]));
    const input = host.querySelector<HTMLInputElement>(".vault-search-input");
    if (input) {
      input.value = "zzzznomatch";
      input.dispatchEvent(new Event("input"));
    }
    const empty = host.querySelector(".vault-empty-title");
    expect(empty?.textContent).toBe("No matching sessions");
  });

  it("never renders the unreadable notice, even when the result reports skips", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "a" })], 2, ["Codex: 1 session couldn't be read", "OpenCode: reader failed"]));
    expect(host.querySelector(".vault-notice")).toBeNull();
    expect(host.textContent).not.toContain("couldn't be read");
  });

  it("caps a group at 10 rows behind a 'Show N more' that expands on click", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    const many = Array.from({ length: 14 }, (_, i) => entry({ id: `claude:s${i}`, modified: 1000 + i }));
    panel.render(result(many));
    // Recent mode (flat group) — only the first 10 of 14 show, plus the button.
    expect(host.querySelectorAll(".vault-row")).toHaveLength(10);
    const more = host.querySelector<HTMLButtonElement>(".vault-show-more");
    expect(more?.textContent).toBe("Show 4 more");
    more?.click();
    expect(host.querySelectorAll(".vault-row")).toHaveLength(14);
    expect(host.querySelector(".vault-show-more")).toBeNull();
  });
});

describe("VaultPanel header search toggle", () => {
  const searchBar = (host: HTMLElement) => host.querySelector<HTMLElement>(".vault-header__search");
  const searchBtn = (host: HTMLElement) => host.querySelector<HTMLButtonElement>(".vault-header__search-btn");

  it("hides the inline search by default and there is no standalone search strip", () => {
    const host = createHost();
    new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    // The old always-visible strip is gone; the input lives in a hidden header bar.
    expect(host.querySelector(".vault-search")).toBeNull();
    expect(searchBar(host)?.style.display).toBe("none");
    expect(searchBtn(host)).not.toBeNull();
  });

  it("reveals + focuses the input on button click, and auto-expands when collapsed", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {} }); // default collapsed
    expect(panel.isCollapsed()).toBe(true);
    searchBtn(host)?.click();
    expect(panel.isCollapsed()).toBe(false); // auto-expanded by entering search
    expect(searchBar(host)?.style.display).toBe("flex");
    expect(host.querySelector(".vault-header")?.classList.contains("is-searching")).toBe(true);
    expect(document.activeElement).toBe(host.querySelector(".vault-search-input"));
    expect(searchBtn(host)?.getAttribute("aria-label")).toBe("Close search");
  });

  it("clicking the search button does not toggle the panel collapse", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    searchBtn(host)?.click(); // opens search, must NOT collapse
    expect(panel.isCollapsed()).toBe(false);
    expect(host.querySelector(".vault-header")?.classList.contains("is-searching")).toBe(true);
  });

  it("closing search (button) clears the query and restores the full list", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "a", title: "alpha" }), entry({ id: "b", title: "beta" })]));

    searchBtn(host)?.click(); // enter search
    const input = host.querySelector<HTMLInputElement>(".vault-search-input");
    if (input) {
      input.value = "alpha";
      input.dispatchEvent(new Event("input"));
    }
    expect(host.querySelectorAll(".vault-row")).toHaveLength(1);

    searchBtn(host)?.click(); // close search → clears filter
    expect(searchBar(host)?.style.display).toBe("none");
    expect(host.querySelector(".vault-header__main")?.getAttribute("style") ?? "").not.toContain("display: none");
    expect(host.querySelectorAll(".vault-row")).toHaveLength(2);
    expect(searchBtn(host)?.getAttribute("aria-label")).toBe("Search sessions");
  });

  it("Escape in the input exits search", () => {
    const host = createHost();
    new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    searchBtn(host)?.click();
    const input = host.querySelector<HTMLInputElement>(".vault-search-input");
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(searchBar(host)?.style.display).toBe("none");
    expect(host.querySelector(".vault-header")?.classList.contains("is-searching")).toBe(false);
  });
});

describe("VaultPanel context menu (redesign 5_1)", () => {
  function openMenu(host: HTMLElement): HTMLElement | null {
    const row = host.querySelector<HTMLElement>(".vault-row");
    row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    return host.querySelector(".vault-context-menu");
  }

  function _mount(
    entryOver: Partial<VaultSessionEntry>,
    posted: { type: string; entryId?: string | null }[],
  ): VaultPanel {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a", ...entryOver })]));
    return panel;
  }

  it("has no menu until a row is right-clicked (no ⋯ trigger)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    expect(host.querySelector(".vault-context-menu")).toBeNull();
    openMenu(host);
    expect(host.querySelector(".vault-context-menu")).not.toBeNull();
  });

  it("shows all items for a file-backed session", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a", sessionPath: "/store/a.jsonl" })]));
    const menu = openMenu(host);
    const labels = Array.from(menu?.querySelectorAll("button") ?? []).map((b) => b.textContent);
    expect(labels).toEqual([
      "Resume in New Tab",
      "Rename",
      "Open",
      "Reveal in Finder",
      "Copy File Path",
      "Copy Resume Command",
      "Open Working Directory",
    ]);
  });

  it("hides the file-targeting items for a DB-backed session (no sessionPath)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "opencode:a", agent: "opencode", sessionPath: undefined })]));
    const menu = openMenu(host);
    const labels = Array.from(menu?.querySelectorAll("button") ?? []).map((b) => b.textContent);
    expect(labels).toEqual(["Resume in New Tab", "Rename", "Copy Resume Command", "Open Working Directory"]);
    expect(labels).not.toContain("Open");
    expect(labels).not.toContain("Copy File Path");
  });

  it("hides Cursor resume actions while retaining only applicable local actions", () => {
    const host = createHost();
    const posted: Array<{ type: string; entryId?: string | null }> = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "cursor:a", agent: "cursor", canResume: false })]));
    const labels = Array.from(openMenu(host)?.querySelectorAll("button") ?? []).map((b) => b.textContent);
    expect(labels).toEqual(["Rename", "Open Working Directory"]);
    expect(labels).not.toContain("Resume in New Tab");
    expect(labels).not.toContain("Copy Resume Command");
    Array.from(host.querySelectorAll<HTMLButtonElement>(".vault-context-menu button"))
      .find((b) => b.textContent === "Open Working Directory")
      ?.click();
    expect(posted).toContainEqual({ type: "vaultOpenWorkingDir", entryId: "cursor:a" });
    expect(posted.some((m) => m.type === "vaultResume" || m.type === "vaultCopyResumeCommand")).toBe(false);

    openMenu(host);
    panel.render(
      result([entry({ id: "cursor:a", agent: "cursor", canResume: false, sessionPath: "/store/cursor.json" })]),
    );
    const row = host.querySelector<HTMLElement>(".vault-row");
    row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    const fileLabels = Array.from(host.querySelectorAll(".vault-context-menu button")).map((b) => b.textContent);
    expect(fileLabels).toEqual(["Rename", "Open", "Reveal in Finder", "Copy File Path", "Open Working Directory"]);
  });

  it("each item posts the matching entryId-only message", () => {
    const posted: { type: string; entryId?: string | null }[] = [];
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a", sessionPath: "/store/a.jsonl" })]));
    const menu = openMenu(host);
    const click = (label: string) =>
      Array.from(menu?.querySelectorAll("button") ?? [])
        .find((b) => b.textContent === label)
        ?.click();

    click("Copy File Path");
    // Reopen for each (clicking closes the menu).
    openMenu(host);
    Array.from(host.querySelector(".vault-context-menu")?.querySelectorAll("button") ?? [])
      .find((b) => b.textContent === "Copy Resume Command")
      ?.click();
    openMenu(host);
    Array.from(host.querySelector(".vault-context-menu")?.querySelectorAll("button") ?? [])
      .find((b) => b.textContent === "Open Working Directory")
      ?.click();

    expect(posted).toContainEqual({ type: "vaultCopyFilePath", entryId: "claude:a" });
    expect(posted).toContainEqual({ type: "vaultCopyResumeCommand", entryId: "claude:a" });
    expect(posted).toContainEqual({ type: "vaultOpenWorkingDir", entryId: "claude:a" });
    // No path is ever sent — only entryId.
    expect(posted.every((m) => !("path" in m))).toBe(true);
  });

  it("closes on Esc and on click-outside, clearing is-context-open", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));

    openMenu(host);
    expect(host.querySelector(".vault-row.is-context-open")).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(host.querySelector(".vault-context-menu")).toBeNull();
    expect(host.querySelector(".vault-row.is-context-open")).toBeNull();

    openMenu(host);
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(host.querySelector(".vault-context-menu")).toBeNull();
  });
});

describe("VaultPanel session preview (redesign 5_2)", () => {
  function detail(over: Partial<import("../../vault/types").VaultSessionDetail> = {}) {
    return {
      entryId: "claude:a",
      recentActivity: [],
      timeline: [],
      stats: { messageCount: 0, toolCount: 0, subagentCount: 0 },
      ...over,
    } as import("../../vault/types").VaultSessionDetail;
  }

  it("activating a row opens the preview (loading) and posts requestVaultSessionDetail", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    expect(host.querySelector(".vault-preview.is-open")).not.toBeNull();
    expect(host.querySelector(".vault-preview-loading")).not.toBeNull();
    expect(posted).toContainEqual({ type: "requestVaultSessionDetail", entryId: "claude:a" });
  });

  it("keeps the active row highlighted across a list re-render (W4)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" }), entry({ id: "codex:b", agent: "codex" })]));
    host.querySelector<HTMLElement>('.vault-row[data-entry-id="claude:a"]')?.click();
    expect(host.querySelector('.vault-row[data-entry-id="claude:a"]')?.getAttribute("aria-selected")).toBe("true");
    // Switching group mode rebuilds every row; the open preview's highlight must
    // re-attach to the fresh row, not vanish with the detached one.
    panel.setGroupMode("agent");
    expect(host.querySelector('.vault-row[data-entry-id="claude:a"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("moves the highlight when switching previews and clears it on close", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" }), entry({ id: "codex:b", agent: "codex" })]));
    const sel = (id: string) => host.querySelector(`.vault-row[data-entry-id="${id}"]`)?.getAttribute("aria-selected");

    host.querySelector<HTMLElement>('.vault-row[data-entry-id="claude:a"]')?.click();
    expect(sel("claude:a")).toBe("true");
    // Switching to another row moves the single highlight (old one is cleared).
    host.querySelector<HTMLElement>('.vault-row[data-entry-id="codex:b"]')?.click();
    expect(sel("codex:b")).toBe("true");
    expect(sel("claude:a")).toBeNull();
    // Closing the preview (Esc) clears the highlight entirely.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(host.querySelector(".vault-preview.is-open")).toBeNull();
    expect(sel("codex:b")).toBeNull();
  });

  it("expanding a capped run reveals its hidden steps in place (UI-2)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    const tools = Array.from({ length: 7 }, (_, i) => ({ kind: "tool", tool: "Read", detail: `/f${i}.ts` }) as const);
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({ timeline: [{ kind: "message", role: "user", text: "go", timestamp: 1 }, ...tools] }),
    });
    // The run of 7 tool steps is capped at 3 + a "Show 4 more steps" button (D10).
    expect(host.querySelectorAll(".vault-preview-message-tool")).toHaveLength(3);
    const more = host.querySelector<HTMLButtonElement>(".vault-preview-expand");
    expect(more?.textContent).toBe("Show 4 more steps");
    more?.click();
    // Expanded in place: all 7 shown, button gone (no jump-to-top re-render artifact).
    expect(host.querySelectorAll(".vault-preview-message-tool")).toHaveLength(7);
    expect(host.querySelector(".vault-preview-expand")).toBeNull();
  });

  it("scroll FABs stay hidden until a scroll, reveal per edge, then auto-hide when idle", () => {
    vi.useFakeTimers();
    try {
      const host = createHost();
      const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
      panel.render(result([entry({ id: "claude:a" })]));
      host.querySelector<HTMLElement>(".vault-row")?.click();
      panel.handleSessionDetailResponse({
        type: "vaultSessionDetailResponse",
        entryId: "claude:a",
        detail: detail({ timeline: [{ kind: "message", role: "user", text: "go", timestamp: 1 }] }),
      });
      const body = host.querySelector<HTMLElement>(".vault-preview-body");
      const topBtn = host.querySelector<HTMLElement>(".vault-preview-scroll-top");
      const bottomBtn = host.querySelector<HTMLElement>(".vault-preview-scroll-bottom");
      if (!body || !topBtn || !bottomBtn) {
        throw new Error("missing preview body / scroll FABs");
      }
      // jsdom computes no layout — simulate a scrollable body (1000px content in a
      // 300px viewport) and drive scrollTop to each position.
      Object.defineProperty(body, "scrollHeight", { configurable: true, value: 1000 });
      Object.defineProperty(body, "clientHeight", { configurable: true, value: 300 });
      const setScroll = (top: number): void => {
        body.scrollTop = top;
        body.dispatchEvent(new Event("scroll"));
      };

      // Hidden until the user actually scrolls.
      expect(topBtn.classList.contains("is-visible")).toBe(false);
      expect(bottomBtn.classList.contains("is-visible")).toBe(false);

      // Scroll near the top: only "scroll to bottom" reveals.
      setScroll(0);
      expect(topBtn.classList.contains("is-visible")).toBe(false);
      expect(bottomBtn.classList.contains("is-visible")).toBe(true);

      // In the middle: both reveal.
      setScroll(500);
      expect(topBtn.classList.contains("is-visible")).toBe(true);
      expect(bottomBtn.classList.contains("is-visible")).toBe(true);

      // At the bottom (scrollTop = scrollHeight - clientHeight): only "scroll to top".
      setScroll(700);
      expect(topBtn.classList.contains("is-visible")).toBe(true);
      expect(bottomBtn.classList.contains("is-visible")).toBe(false);

      // Idle past the hide delay → both fade out.
      vi.advanceTimersByTime(1200);
      expect(topBtn.classList.contains("is-visible")).toBe(false);
      expect(bottomBtn.classList.contains("is-visible")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  // Build a timeline of N user messages; the first one carries `firstText` so a
  // test can assert it landed on the session's true first message.
  const userTimeline = (n: number, firstText: string) =>
    Array.from({ length: n }, (_, i) => ({
      kind: "message" as const,
      role: "user" as const,
      text: i === 0 ? firstText : `m${i}`,
    }));

  it("scroll-to-top loads every older window, then lands on the session's first message", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null; limit?: number }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    const detailReqs = (): number => posted.filter((m) => m.type === "requestVaultSessionDetail").length;
    expect(detailReqs()).toBe(1); // initial open

    // First window: truncated, 1 item (older messages remain).
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({ truncated: true, timeline: userTimeline(1, "m0") }),
    });
    // Click "scroll to first message" → must request the next older window.
    host.querySelector<HTMLElement>(".vault-preview-scroll-top")?.click();
    expect(detailReqs()).toBe(2);

    // Still truncated AND the window grew (2 > 1) → keeps loading automatically.
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({ truncated: true, timeline: userTimeline(2, "m0") }),
    });
    expect(detailReqs()).toBe(3);

    // Final window is NOT truncated → stop loading and land on the first message.
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({ truncated: false, timeline: userTimeline(3, "FIRST-OF-SESSION") }),
    });
    expect(detailReqs()).toBe(3); // no further load-more once untruncated
    expect(host.querySelector(".vault-preview-body")?.textContent).toContain("FIRST-OF-SESSION");
  });

  it("scroll-to-top stops when the host stops returning more (cap reached), instead of looping forever", () => {
    const host = createHost();
    const posted: { type: string }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    const detailReqs = (): number => posted.filter((m) => m.type === "requestVaultSessionDetail").length;

    // A session larger than the host cap: every response stays truncated with the
    // SAME timeline length (the host clamps at MAX_DETAIL_LIMIT).
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({ truncated: true, timeline: userTimeline(5, "capped") }),
    });
    host.querySelector<HTMLElement>(".vault-preview-scroll-top")?.click();
    expect(detailReqs()).toBe(2); // one load-more requested

    // Capped response — same length, still truncated → must NOT request again.
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({ truncated: true, timeline: userTimeline(5, "capped") }),
    });
    expect(detailReqs()).toBe(2); // loop terminated, no infinite requests
  });

  it("clears the scroll-to-top walk when a window errors, so a later reply doesn't auto-jump", () => {
    const host = createHost();
    const posted: { type: string }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    const detailReqs = (): number => posted.filter((m) => m.type === "requestVaultSessionDetail").length;

    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({ truncated: true, timeline: userTimeline(1, "m0") }),
    });
    host.querySelector<HTMLElement>(".vault-preview-scroll-top")?.click();
    expect(detailReqs()).toBe(2); // walk started one load-more

    // The older-window request fails mid-walk.
    panel.handleSessionDetailResponse({ type: "vaultSessionDetailResponse", entryId: "claude:a", error: "boom" });

    // A later (still-truncated) reply must render WITHOUT resuming the walk — the
    // pending flag was cleared on error, so no spurious auto load-more fires.
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({ truncated: true, timeline: userTimeline(2, "m0") }),
    });
    expect(detailReqs()).toBe(2); // no auto-jump-to-top loop revived by the stale flag
  });

  it("hides the scroll FAB cluster while the preview is loading (no body yet)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    // Loading placeholder is shown before the detail arrives — no .vault-preview-body.
    expect(host.querySelector(".vault-preview-loading")).not.toBeNull();
    expect(host.querySelector(".vault-preview-scroll-nav")?.classList.contains("is-empty")).toBe(true);
  });

  it("renders a nested sub-session node directly mid-run, never behind the step cap (D10)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    // A team GROUP node buried after 6 tool steps inside ONE run (no intervening
    // user message). Pre-D10 the whole run capped at 5 → the group (run index 6)
    // was sliced off and never entered the DOM. Now it breaks the run.
    const toolsBefore = Array.from(
      { length: 6 },
      (_, i) => ({ kind: "tool", tool: "Read", detail: `/before${i}.ts` }) as const,
    );
    const toolsAfter = Array.from(
      { length: 6 },
      (_, i) => ({ kind: "tool", tool: "Read", detail: `/after${i}.ts` }) as const,
    );
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({
        timeline: [
          { kind: "message", role: "user", text: "go", timestamp: 1 },
          ...toolsBefore,
          { kind: "subagentSession", entryId: "claude:a:team:arco", title: "Team: arco · 4 members" },
          ...toolsAfter,
        ],
      }),
    });
    // The group node is in the DOM (visible), not hidden behind a "Show N more".
    const group = host.querySelector(".vault-preview-subagent-title");
    expect(group?.textContent).toBe("Team: arco · 4 members");
    // A group has no single agent → title-only form (no "agent" badge / @chip).
    expect(host.querySelector(".vault-preview-subagent-badge")).toBeNull();
    // It broke the run into two still-independently-capped halves (6 → 3 + "Show 3 more").
    expect(host.querySelectorAll(".vault-preview-expand")).toHaveLength(2);
  });

  it("renders a teammateTurn as a highlighted node that breaks the run and opens its segment (D13)", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    const before = Array.from({ length: 4 }, (_, i) => ({ kind: "tool", tool: "Read", detail: `/b${i}.ts` }) as const);
    const after = Array.from({ length: 4 }, (_, i) => ({ kind: "tool", tool: "Read", detail: `/a${i}.ts` }) as const);
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({
        timeline: [
          { kind: "message", role: "user", text: "go", timestamp: 1 },
          ...before,
          {
            kind: "teammateTurn",
            entryId: "claude:m:turn:0",
            agentName: "usdg",
            color: "blue",
            from: "leader",
            preview: "do the USDg estimate",
            timestamp: 2,
          },
          ...after,
        ],
      }),
    });
    // The teammate node is visible (not swept into a capped run) and highlighted.
    const node = host.querySelector<HTMLElement>(".vault-preview-teammate");
    expect(node).not.toBeNull();
    expect(host.querySelector(".vault-preview-teammate-name")?.textContent).toBe("@usdg");
    expect(host.querySelector(".vault-preview-teammate-dir")?.textContent).toBe("⟵ leader");
    expect(host.querySelector(".vault-preview-teammate-preview")?.textContent).toBe("do the USDg estimate");
    // Color sanitized to a concrete CSS value (NOT a theme var that can vanish).
    expect(node?.style.getPropertyValue("--turn-color")).toBe("#4aa3ff");
    // It broke the surrounding 4+4 tool run into two independently-capped halves.
    expect(host.querySelectorAll(".vault-preview-expand")).toHaveLength(2);
    // Clicking lazily fetches THIS turn's segment by its view-only :turn: id.
    host.querySelector<HTMLButtonElement>(".vault-preview-teammate-head")?.click();
    expect(node?.classList.contains("is-open")).toBe(true);
    expect(posted).toContainEqual(
      expect.objectContaining({ type: "requestVaultSessionDetail", entryId: "claude:m:turn:0" }),
    );
  });

  it("renders a peer-DM teammateTurn with the peer name as direction + neutral fallback color", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({
        timeline: [
          {
            kind: "teammateTurn",
            entryId: "claude:m:turn:1",
            agentName: "reviewer-b",
            from: "reviewer-a",
            preview: "check the auth path",
            timestamp: 3,
          },
        ],
      }),
    });
    expect(host.querySelector(".vault-preview-teammate-dir")?.textContent).toBe("⟵ reviewer-a");
    // No color supplied → neutral fallback, still a concrete value (never a theme var).
    expect(host.querySelector<HTMLElement>(".vault-preview-teammate")?.style.getPropertyValue("--turn-color")).toBe(
      "#8b949e",
    );
  });

  it("renders an inbound teammateMessage as a color-keyed message (clean body, sender label), not a raw USER bubble (D16)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({
        timeline: [
          {
            kind: "teammateMessage",
            agentName: "reviewer-a",
            color: "blue",
            from: "peer",
            text: "found 2 issues in the auth path",
            timestamp: 6,
          },
        ],
      }),
    });
    const node = host.querySelector<HTMLElement>(".vault-preview-message-teammate");
    expect(node).not.toBeNull();
    // Sender label (an @teammate), never the generic "User" role.
    expect(node?.querySelector(".vault-preview-message-role")?.textContent).toContain("@reviewer-a");
    expect(node?.querySelector(".vault-preview-message-role")?.textContent).not.toContain("User");
    // Clean body — the literal tag never appears in the DOM.
    expect(node?.querySelector("p")?.textContent).toBe("found 2 issues in the auth path");
    expect(host.innerHTML).not.toContain("&lt;teammate-message");
    expect(host.innerHTML).not.toContain("<teammate-message");
    // Color sanitized to a concrete value.
    expect(node?.style.getPropertyValue("--turn-color")).toBe("#4aa3ff");
  });

  it("a leader-sent teammateMessage shows '⟵ leader' rather than @team-lead", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({
        timeline: [
          { kind: "teammateMessage", agentName: "team-lead", from: "leader", text: "review this", timestamp: 2 },
        ],
      }),
    });
    expect(host.querySelector(".vault-preview-message-teammate .vault-preview-message-role")?.textContent).toContain(
      "⟵ leader",
    );
  });

  it("renders the full conversation timeline in order, via textContent", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({
        timeline: [
          { kind: "message", role: "user", text: "<b>do</b> the thing", timestamp: Date.now() },
          { kind: "tool", tool: "Read", detail: "/a.ts" },
          { kind: "subagent", name: "asm-finder", prompt: "find" },
          { kind: "message", role: "assistant", text: "all done", timestamp: Date.now() },
        ],
        stats: { messageCount: 5, toolCount: 1, subagentCount: 1, tokenCount: 1650 },
      }),
    });
    // Messages/tools remain ordinary nodes; a subagent uses the shared AGENT card.
    const items = host.querySelectorAll(".vault-preview-body .vault-preview-message");
    expect(items).toHaveLength(3);
    expect(host.querySelector(".vault-preview-subagent-badge")?.textContent).toBe("agent");
    expect(host.querySelector(".vault-preview-subagent-agent")?.textContent).toBe("@asm-finder");
    // Untrusted text is written via textContent (not parsed as HTML).
    const firstP = host.querySelector(".vault-preview-message-user p");
    expect(firstP?.textContent).toBe("<b>do</b> the thing");
    expect(firstP?.querySelector("b")).toBeNull();
    expect(host.querySelector(".vault-preview-message-tool")?.textContent).toContain("/a.ts");
    expect(host.querySelector(".vault-preview-message-assistant p")?.textContent).toBe("all done");
    expect(host.querySelector(".vault-preview-meta")?.textContent).toContain("1.6k tok");
  });

  it("renders a Cursor subagent run as a collapsible AGENT card with prompt and result", () => {
    const host = createHost();
    const posted: Array<{ type: string }> = [];
    const panel = new VaultPanel({
      host,
      postMessage: (message) => posted.push(message),
      getInitialCollapsed: () => false,
    });
    panel.render(result([entry({ id: "cursor:chat-1", agent: "cursor", source: "cli" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "cursor:chat-1",
      detail: detail({
        entryId: "cursor:chat-1",
        contentKind: "timeline",
        timeline: [
          {
            kind: "subagent",
            name: "Explore",
            title: "Find Claude session listen",
            prompt: "Inspect the watcher and reader flow",
            result: "VaultWatchCoordinator owns live follow.",
            status: "completed",
          },
        ],
        stats: { messageCount: 0, toolCount: 0, subagentCount: 1 },
      }),
    });

    const block = host.querySelector(".vault-preview-subagent");
    const head = host.querySelector<HTMLButtonElement>(".vault-preview-subagent-head");
    expect(block).not.toBeNull();
    expect(host.querySelector(".vault-preview-subagent-badge")?.textContent).toBe("agent");
    expect(host.querySelector(".vault-preview-subagent-agent")?.textContent).toBe("@Explore");
    expect(host.querySelector(".vault-preview-subagent-title")?.textContent).toBe("Find Claude session listen");
    expect(head?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(".vault-preview-subagent-body")?.textContent).toBe("");
    const detailRequests = posted.filter((message) => message.type === "requestVaultSessionDetail").length;

    head?.click();
    expect(posted.filter((message) => message.type === "requestVaultSessionDetail")).toHaveLength(detailRequests);
    expect(block?.classList.contains("is-open")).toBe(true);
    expect(head?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".vault-preview-subagent-body")?.textContent).toContain(
      "PromptInspect the watcher and reader flow",
    );
    expect(host.querySelector(".vault-preview-subagent-body")?.textContent).toContain(
      "Result · completedVaultWatchCoordinator owns live follow.",
    );

    head?.click();
    expect(block?.classList.contains("is-open")).toBe(false);
    expect(head?.getAttribute("aria-expanded")).toBe("false");
  });

  /** The requestId the panel attached to its nth (default last) nested detail
   *  request for a child — replies must echo it to render (W15). */
  const nestedRequestId = (posted: Array<{ type: string }>, entryId: string, nth = -1): string => {
    const req = posted
      .filter((m) => m.type === "requestVaultSessionDetail" && (m as { entryId?: string }).entryId === entryId)
      .at(nth) as { requestId?: string } | undefined;
    if (typeof req?.requestId !== "string") {
      throw new Error(`no nested detail request for ${entryId}`);
    }
    return req.requestId;
  };

  it("opens a saved Cursor child transcript through nested detail IPC", () => {
    const host = createHost();
    const posted: Array<{ type: string; entryId?: string | null }> = [];
    const panel = new VaultPanel({
      host,
      postMessage: (message) => posted.push(message),
      getInitialCollapsed: () => false,
    });
    panel.render(result([entry({ id: "cursor:chat-1", agent: "cursor", source: "cli" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "cursor:chat-1",
      detail: detail({
        entryId: "cursor:chat-1",
        contentKind: "timeline",
        timeline: [
          {
            kind: "subagentSession",
            entryId: "cursor:project:bucket:child-1",
            agent: "Explore",
            title: "Inspect the watcher",
            firstMessage: "Inspect the watcher and reader flow",
            prompt: "Inspect the watcher and reader flow",
            result: "VaultWatchCoordinator owns live follow.",
            status: "completed",
          },
        ],
      }),
    });

    const head = host.querySelector<HTMLButtonElement>(".vault-preview-subagent-head");
    head?.click();
    expect(posted).toContainEqual(
      expect.objectContaining({ type: "requestVaultSessionDetail", entryId: "cursor:project:bucket:child-1" }),
    );
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "cursor:project:bucket:child-1",
      requestId: nestedRequestId(posted, "cursor:project:bucket:child-1"),
      detail: detail({
        entryId: "cursor:project:bucket:child-1",
        contentKind: "timeline",
        timeline: [{ kind: "message", role: "assistant", text: "Child transcript rendered." }],
      }),
    });

    expect(host.querySelector(".vault-preview-subagent-body")?.textContent).toContain("Child transcript rendered.");
    expect(host.querySelector(".vault-preview-subagent-body")?.textContent).not.toContain(
      "VaultWatchCoordinator owns live follow.",
    );
  });

  it("keeps the Cursor invocation fallback when a child detail fails", () => {
    const host = createHost();
    const posted: Array<{ type: string; entryId?: string | null }> = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "cursor:chat-1", agent: "cursor", source: "cli" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "cursor:chat-1",
      detail: detail({
        entryId: "cursor:chat-1",
        contentKind: "timeline",
        timeline: [
          {
            kind: "subagentSession",
            entryId: "cursor:project:bucket:child-1",
            agent: "Explore",
            title: "Inspect the watcher",
            prompt: "Inspect the watcher and reader flow",
            result: "VaultWatchCoordinator owns live follow.",
            status: "completed",
          },
        ],
      }),
    });

    host.querySelector<HTMLButtonElement>(".vault-preview-subagent-head")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "cursor:project:bucket:child-1",
      requestId: nestedRequestId(posted, "cursor:project:bucket:child-1"),
      error: "Child transcript unavailable.",
    });

    const fallback = host.querySelector(".vault-preview-subagent-body");
    expect(fallback?.textContent).toContain("PromptInspect the watcher and reader flow");
    expect(fallback?.textContent).toContain("Result · completedVaultWatchCoordinator owns live follow.");
  });

  it("keeps each invocation fallback when duplicate cards share one failed child detail", () => {
    const host = createHost();
    const posted: Array<{ type: string; entryId?: string | null }> = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "cursor:chat-1", agent: "cursor", source: "cli" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    const parent = {
      type: "vaultSessionDetailResponse",
      entryId: "cursor:chat-1",
      detail: detail({
        entryId: "cursor:chat-1",
        contentKind: "timeline",
        timeline: [
          {
            kind: "subagentSession",
            entryId: "cursor:project:bucket:child-1",
            agent: "Explore",
            title: "First task",
            prompt: "first prompt",
            result: "first result",
          },
          {
            kind: "subagentSession",
            entryId: "cursor:project:bucket:child-1",
            agent: "Explore",
            title: "Second task",
            prompt: "second prompt",
            result: "second result",
          },
        ],
      }),
    } as const;
    panel.handleSessionDetailResponse(parent);

    // Two cards, one child id: each opens on its own click (W15), and both wait on
    // the single shared request.
    for (const head of host.querySelectorAll<HTMLButtonElement>(".vault-preview-subagent-head")) {
      head.click();
    }
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "cursor:project:bucket:child-1",
      requestId: nestedRequestId(posted, "cursor:project:bucket:child-1"),
      error: "Child transcript unavailable.",
    });

    // The fallback renders its own card inside each body; keep the outer two.
    const bodies = [...host.querySelectorAll(".vault-preview-subagent-body")].filter(
      (body) => body.querySelector(".vault-preview-subagent-head") !== null,
    );
    expect(bodies).toHaveLength(2);
    expect(bodies[0].textContent).toContain("first prompt");
    expect(bodies[0].textContent).toContain("first result");
    expect(bodies[0].textContent).not.toContain("second prompt");
    expect(bodies[1].textContent).toContain("second prompt");
    expect(bodies[1].textContent).toContain("second result");
    expect(bodies[1].textContent).not.toContain("first prompt");
  });

  it("drops a stale Cursor child detail response after switching previews", () => {
    const host = createHost();
    const posted: Array<{ type: string; entryId?: string | null }> = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(
      result([
        entry({ id: "cursor:chat-1", agent: "cursor", source: "cli" }),
        entry({ id: "claude:other", agent: "claude" }),
      ]),
    );
    const rows = host.querySelectorAll<HTMLElement>(".vault-row");
    rows[0].click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "cursor:chat-1",
      detail: detail({
        entryId: "cursor:chat-1",
        contentKind: "timeline",
        timeline: [
          {
            kind: "subagentSession",
            entryId: "cursor:project:bucket:child-1",
            agent: "Explore",
            title: "Inspect the watcher",
            prompt: "bounded prompt",
            result: "bounded result",
          },
        ],
      }),
    });
    host.querySelector<HTMLButtonElement>(".vault-preview-subagent-head")?.click();
    const staleRequestId = nestedRequestId(posted, "cursor:project:bucket:child-1");
    rows[1].click();

    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "cursor:project:bucket:child-1",
      requestId: staleRequestId,
      detail: detail({
        entryId: "cursor:project:bucket:child-1",
        timeline: [{ kind: "message", role: "assistant", text: "STALE CHILD" }],
      }),
    });

    expect(host.querySelector(".vault-preview")?.textContent).not.toContain("STALE CHILD");
  });

  /** W15: collapsing one card must not strand the others on "Loading…" — the
   *  request they share survives while any of them is still open. */
  it("keeps a second open card loading when the first one collapses", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "opencode:a", agent: "opencode" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:a",
      detail: detail({
        entryId: "opencode:a",
        timeline: [
          { kind: "subagentSession", entryId: "opencode:ses_dup", title: "Sub A", firstMessage: "p" },
          { kind: "subagentSession", entryId: "opencode:ses_dup", title: "Sub B", firstMessage: "p" },
        ],
      }),
    });
    const heads = () => [...host.querySelectorAll<HTMLButtonElement>(".vault-preview-subagent-head")];
    heads()[0].click();
    heads()[1].click();
    expect(
      posted.filter((m) => m.type === "requestVaultSessionDetail" && m.entryId === "opencode:ses_dup"),
    ).toHaveLength(1);

    heads()[0].click(); // collapse the first — the second is still waiting
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:ses_dup",
      requestId: nestedRequestId(posted, "opencode:ses_dup"),
      detail: detail({ entryId: "opencode:ses_dup", timeline: [{ kind: "message", role: "user", text: "CHILD" }] }),
    });

    const bodies = [...host.querySelectorAll(".vault-preview-subagent-body")];
    expect(bodies[0].textContent).toBe("");
    expect(bodies[1].textContent).toContain("CHILD");
  });

  /** W16: a reply that outlived its preview never paints, even when the same child
   *  is expanded again in the reopened one. */
  it("drops a nested reply from a closed preview and refetches on reopen", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "opencode:a", agent: "opencode" })]));
    const parent = {
      type: "vaultSessionDetailResponse",
      entryId: "opencode:a",
      detail: detail({
        entryId: "opencode:a",
        timeline: [{ kind: "subagentSession", entryId: "opencode:ses_kid", title: "Sub", firstMessage: "p" }],
      }),
    } as const;
    const openAndExpand = () => {
      host.querySelector<HTMLElement>(".vault-row")?.click();
      panel.handleSessionDetailResponse(parent);
      host.querySelector<HTMLButtonElement>(".vault-preview-subagent-head")?.click();
    };
    openAndExpand();
    host.querySelector<HTMLButtonElement>(".vault-preview-close")?.click();
    openAndExpand();

    // The first preview's in-flight reply lands after the reopen: superseded.
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:ses_kid",
      requestId: nestedRequestId(posted, "opencode:ses_kid", 0),
      detail: detail({ entryId: "opencode:ses_kid", timeline: [{ kind: "message", role: "user", text: "STALE" }] }),
    });
    expect(host.querySelector(".vault-preview-subagent-body")?.textContent).not.toContain("STALE");

    // The reopened preview asked again, and its own reply does paint.
    expect(
      posted.filter((m) => m.type === "requestVaultSessionDetail" && m.entryId === "opencode:ses_kid"),
    ).toHaveLength(2);
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:ses_kid",
      requestId: nestedRequestId(posted, "opencode:ses_kid", 1),
      detail: detail({ entryId: "opencode:ses_kid", timeline: [{ kind: "message", role: "user", text: "FRESH" }] }),
    });
    expect(host.querySelector(".vault-preview-subagent-body")?.textContent).toContain("FRESH");
  });

  /** W18: card keys must not shift when load-more PREPENDS an older card naming
   *  the same child — identity is (child, title, nth among identical), not the
   *  card's occurrence index in the whole timeline. */
  it("keeps the open duplicate card expanded when load-more prepends an older same-child card", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "opencode:a", agent: "opencode" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:a",
      detail: detail({
        truncated: true,
        timeline: [{ kind: "subagentSession", entryId: "opencode:ses_dup", title: "Recent task", firstMessage: "p" }],
      }),
    });
    host.querySelector<HTMLButtonElement>(".vault-preview-subagent-head")?.click();
    expect(host.querySelector(".vault-preview-subagent")?.classList.contains("is-open")).toBe(true);

    host.querySelector<HTMLButtonElement>(".vault-preview-loadmore")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:a",
      detail: detail({
        truncated: false,
        timeline: [
          { kind: "subagentSession", entryId: "opencode:ses_dup", title: "Older task", firstMessage: "p" },
          { kind: "subagentSession", entryId: "opencode:ses_dup", title: "Recent task", firstMessage: "p" },
        ],
      }),
    });

    const cards = [...host.querySelectorAll<HTMLElement>(".vault-preview-subagent")];
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector(".vault-preview-subagent-title")?.textContent).toBe("Older task");
    expect(cards[0].classList.contains("is-open")).toBe(false);
    expect(cards[1].querySelector(".vault-preview-subagent-title")?.textContent).toBe("Recent task");
    expect(cards[1].classList.contains("is-open")).toBe(true);
  });

  /** W19: the card-identity tuple must be injective — `(ses_x, a|b)` and
   *  `(ses_x|a, b)` are DIFFERENT cards and must not share an occurrence group,
   *  or a prepend of one renumbers the other and expansion transfers. */
  it("keeps expansion on the open card when a delimiter-colliding tuple is prepended", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "opencode:a", agent: "opencode" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:a",
      detail: detail({
        truncated: true,
        timeline: [{ kind: "subagentSession", entryId: "opencode:ses_x", title: "a|b", firstMessage: "p" }],
      }),
    });
    host.querySelector<HTMLButtonElement>(".vault-preview-subagent-head")?.click();
    expect(host.querySelector(".vault-preview-subagent")?.classList.contains("is-open")).toBe(true);

    host.querySelector<HTMLButtonElement>(".vault-preview-loadmore")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:a",
      detail: detail({
        truncated: false,
        timeline: [
          { kind: "subagentSession", entryId: "opencode:ses_x|a", title: "b", firstMessage: "p" },
          { kind: "subagentSession", entryId: "opencode:ses_x", title: "a|b", firstMessage: "p" },
        ],
      }),
    });

    const cards = [...host.querySelectorAll<HTMLElement>(".vault-preview-subagent")];
    expect(cards).toHaveLength(2);
    expect(cards[0].classList.contains("is-open")).toBe(false);
    expect(cards[1].classList.contains("is-open")).toBe(true);
  });

  /** W15: host reads complete out of order — the reopened preview's own reply can
   *  land BEFORE the closed preview's leftover. Identity comes from the echoed
   *  request id, never from arrival order. */
  it("keeps the fresh nested reply when it lands before the closed preview's leftover", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "opencode:a", agent: "opencode" })]));
    const parent = {
      type: "vaultSessionDetailResponse",
      entryId: "opencode:a",
      detail: detail({
        entryId: "opencode:a",
        timeline: [{ kind: "subagentSession", entryId: "opencode:ses_kid", title: "Sub", firstMessage: "p" }],
      }),
    } as const;
    const openAndExpand = () => {
      host.querySelector<HTMLElement>(".vault-row")?.click();
      panel.handleSessionDetailResponse(parent);
      host.querySelector<HTMLButtonElement>(".vault-preview-subagent-head")?.click();
    };
    openAndExpand();
    host.querySelector<HTMLButtonElement>(".vault-preview-close")?.click();
    openAndExpand();

    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:ses_kid",
      requestId: nestedRequestId(posted, "opencode:ses_kid", 1),
      detail: detail({ entryId: "opencode:ses_kid", timeline: [{ kind: "message", role: "user", text: "FRESH" }] }),
    });
    expect(host.querySelector(".vault-preview-subagent-body")?.textContent).toContain("FRESH");

    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:ses_kid",
      requestId: nestedRequestId(posted, "opencode:ses_kid", 0),
      detail: detail({ entryId: "opencode:ses_kid", timeline: [{ kind: "message", role: "user", text: "STALE" }] }),
    });
    const body = host.querySelector(".vault-preview-subagent-body")?.textContent;
    expect(body).toContain("FRESH");
    expect(body).not.toContain("STALE");
  });

  /** W15: collapsing the LAST waiting card abandons its request; re-expanding asks
   *  again, and the abandoned request's late reply must not satisfy the new one. */
  it("ignores the abandoned reply after the last waiting card collapses and re-expands", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "opencode:a", agent: "opencode" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:a",
      detail: detail({
        entryId: "opencode:a",
        timeline: [{ kind: "subagentSession", entryId: "opencode:ses_kid", title: "Sub", firstMessage: "p" }],
      }),
    });
    const head = () => host.querySelector<HTMLButtonElement>(".vault-preview-subagent-head");
    head()?.click(); // expand → first request
    head()?.click(); // collapse the only waiting card — its request is abandoned
    head()?.click(); // re-expand → second request

    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:ses_kid",
      requestId: nestedRequestId(posted, "opencode:ses_kid", 0),
      detail: detail({ entryId: "opencode:ses_kid", timeline: [{ kind: "message", role: "user", text: "OLD" }] }),
    });
    expect(host.querySelector(".vault-preview-subagent-body")?.textContent).not.toContain("OLD");

    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:ses_kid",
      requestId: nestedRequestId(posted, "opencode:ses_kid", 1),
      detail: detail({ entryId: "opencode:ses_kid", timeline: [{ kind: "message", role: "user", text: "NEW" }] }),
    });
    expect(host.querySelector(".vault-preview-subagent-body")?.textContent).toContain("NEW");
  });

  it("meta block is Folder+branch / Session id+path / Activity age+stats, all copyable", async () => {
    const host = createHost();
    const writes = stubClipboard();
    const posted: Array<{ type: string }> = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(
      result([
        entry({
          id: "claude:a",
          cwd: "/work/repo",
          gitBranch: "main",
          sessionId: "abc-123",
          sessionPath: "/home/me/.claude/projects/-work-repo/abc-123.jsonl",
          modified: Date.now() - 5 * 60_000,
        }),
      ]),
    );
    host.querySelector<HTMLElement>(".vault-row")?.click();

    const rows = Array.from(host.querySelectorAll(".vault-preview-meta dt")).map((dt) => dt.textContent);
    expect(rows).toEqual(["Folder", "Session", "Activity"]);

    const dd = Array.from(host.querySelectorAll<HTMLElement>(".vault-preview-meta dd"));
    expect(dd[0].textContent).toContain("repo");
    expect(dd[0].querySelector(".vault-preview-branch-chip .vault-preview-copyable-text")?.textContent).toBe("main");
    // The id shows in FULL — nothing in the row competes for its width. The
    // transcript path reads "transcript", not the path: rendering the path only
    // repeated the folder and the id while truncating the id to make room.
    expect(dd[1].querySelector(".vault-preview-copyable-text")?.textContent).toBe("abc-123");
    expect(dd[1].textContent).not.toContain(".jsonl");
    const pathBtn = Array.from(dd[1].querySelectorAll<HTMLElement>(".vault-preview-copyable"))[1];
    expect(pathBtn.querySelector(".vault-preview-copyable-text")?.textContent).toBe("transcript");
    // The accessible name is the action, not the raw path the tooltip carries.
    expect(pathBtn.getAttribute("aria-label")).toBe("Copy transcript path");
    // The age is shown before any detail arrives — the row must not appear late.
    expect(dd[2].textContent).toContain("5m ago");

    // Each value copies its own untruncated text, written in the webview. Clicking
    // three in a row must leave the LAST one on the clipboard — the host round-trip
    // this replaced ran a full uncached vault scan per click and let whichever scan
    // finished last win, so the pasted value belonged to an arbitrary button.
    const copyables = Array.from(host.querySelectorAll<HTMLElement>(".vault-preview-meta .vault-preview-copyable"));
    expect(copyables).toHaveLength(4);
    for (const c of copyables) {
      c.click();
    }
    await flush();
    expect(writes).toEqual([
      "/work/repo",
      "main", // the branch chip copies too — it is a copy affordance, not a label
      "abc-123",
      "/home/me/.claude/projects/-work-repo/abc-123.jsonl",
    ]);
    // Nothing crosses the boundary at all now — no round-trip to race with.
    expect(posted.some((m) => m.type.startsWith("vaultCopy"))).toBe(false);
    expect(copyables[0].classList.contains("is-copied")).toBe(true);

    // Stats join the age in place once the detail lands — still three rows.
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({ stats: { messageCount: 24, toolCount: 8, subagentCount: 0, tokenCount: 1650 } }),
    });
    expect(host.querySelectorAll(".vault-preview-meta dt")).toHaveLength(3);
    const activity = host.querySelectorAll<HTMLElement>(".vault-preview-meta dd")[2].textContent ?? "";
    expect(activity).toContain("5m ago");
    expect(activity).toContain("24 msgs");
    expect(activity).toContain("1.6k tok");
  });

  it("hovering a meta value discloses its untruncated text through the shared tooltip", () => {
    const host = createHost();
    stubClipboard();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(
      result([
        entry({
          id: "claude:a",
          cwd: "/work/repo",
          gitBranch: "main",
          sessionId: "abc-123",
          sessionPath: "/home/me/.claude/projects/-work-repo/abc-123.jsonl",
        }),
      ]),
    );
    host.querySelector<HTMLElement>(".vault-row")?.click();

    const copyables = Array.from(host.querySelectorAll<HTMLElement>(".vault-preview-meta .vault-preview-copyable"));
    // Native `title` does not render in a VSCode webview — the reason every meta
    // row disclosed nothing at all. The shared widget is the only tooltip there is.
    expect(copyables.some((c) => c.hasAttribute("title"))).toBe(false);
    vi.useFakeTimers();
    try {
      expect(hoverTooltipText(copyables[0])).toBe("/work/repo");
      expect(hoverTooltipText(copyables[1])).toBe("Git branch: main");
      expect(hoverTooltipText(copyables[2])).toBe("abc-123");
      expect(hoverTooltipText(copyables[3])).toBe("/home/me/.claude/projects/-work-repo/abc-123.jsonl");
    } finally {
      vi.useRealTimers();
    }
  });

  it("meta copy does not confirm when the clipboard rejects the write", async () => {
    const host = createHost();
    stubClipboard(() => Promise.reject(new Error("denied")));
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a", cwd: "/work/repo", sessionId: "abc-123" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();

    const first = host.querySelector<HTMLElement>(".vault-preview-meta .vault-preview-copyable");
    first?.click();
    await Promise.resolve();
    await Promise.resolve();
    // A tick here would tell the user a copy happened when the clipboard is untouched.
    expect(first?.classList.contains("is-copied")).toBe(false);
  });

  it("double-clicking the preview title renames the session", async () => {
    const host = createHost();
    const posted: Array<{ type: string; name?: string }> = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a", title: "old name" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();

    const title = host.querySelector<HTMLElement>(".vault-preview-title");
    expect(title?.textContent).toBe("old name");
    // A single click must still be free to move the card — only a double opens the editor.
    title?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(host.querySelector(".vault-row-rename-input")).toBeNull();

    title?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = host.querySelector<HTMLInputElement>(".vault-preview-header .vault-row-rename-input");
    expect(input).not.toBeNull();
    expect(input?.value).toBe("old name");

    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    // Escape cancels the edit; it must not also close the whole preview.
    expect(host.querySelector(".vault-preview")).not.toBeNull();
    expect(host.querySelector(".vault-row-rename-input")).toBeNull();

    title?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input2 = host.querySelector<HTMLInputElement>(".vault-preview-header .vault-row-rename-input");
    if (input2) {
      input2.value = "new name";
    }
    input2?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(posted.filter((m) => m.type === "vaultRenameSession")).toEqual([
      { type: "vaultRenameSession", entryId: "claude:a", name: "new name" },
    ]);
  });

  it("an open title editor survives a live transcript repaint", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a", title: "old name" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    host
      .querySelector<HTMLElement>(".vault-preview-title")
      ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    const input = host.querySelector<HTMLInputElement>(".vault-preview-header .vault-row-rename-input");
    if (input) {
      input.value = "half-typed";
    }
    // A live-follow update repaints the card. Rebuilding the header here would
    // throw away what the user has typed.
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({ stats: { messageCount: 9, toolCount: 1, subagentCount: 0, tokenCount: 40 } }),
    });
    const after = host.querySelector<HTMLInputElement>(".vault-preview-header .vault-row-rename-input");
    expect(after).not.toBeNull();
    expect(after?.value).toBe("half-typed");
  });

  it("closing mid-rename does not carry the header into the next session (B1)", () => {
    const host = createHost();
    const posted: Array<{ type: string; entryId?: string | null }> = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(
      result([entry({ id: "claude:a", title: "session A" }), entry({ id: "claude:b", title: "session B" })]),
    );
    const rows = host.querySelectorAll<HTMLElement>(".vault-row");
    rows[0].click();
    host
      .querySelector<HTMLElement>(".vault-preview-title")
      ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(host.querySelector(".vault-preview-header .vault-row-rename-input")).not.toBeNull();

    // Close WITHOUT a blur: dispatching on document reaches the shell's close
    // listener without touching the input, mirroring the real hazard — removing a
    // focused node does not reliably fire blur.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    rows[1].click();

    // The reopened header must belong to session B, not to A.
    expect(host.querySelector(".vault-preview-header .vault-row-rename-input")).toBeNull();
    expect(host.querySelector(".vault-preview-title")?.textContent).toBe("session B");
    posted.length = 0;
    host.querySelector<HTMLElement>(".vault-preview-resume")?.click();
    expect(posted.find((m) => m.type === "vaultResume")?.entryId).toBe("claude:b");
  });

  it("copies land on the clipboard in activation order even when writes finish out of order (B2)", async () => {
    const host = createHost();
    const settled: Array<() => void> = [];
    const writes: string[] = [];
    // Every write parks until released, so completion order is ours to choose.
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: {
        writeText: (text: string) =>
          new Promise<void>((resolve) => {
            writes.push(text);
            settled.push(resolve);
          }),
      },
    });
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a", cwd: "/work/repo", sessionId: "abc-123" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();

    const copyables = Array.from(host.querySelectorAll<HTMLElement>(".vault-preview-meta .vault-preview-copyable"));
    copyables[0].click(); // cwd
    copyables[1].click(); // session id
    await flush();
    // Serialized: the second write must not even be issued until the first ends.
    expect(writes).toEqual(["/work/repo"]);
    settled[0]();
    await flush();
    expect(writes).toEqual(["/work/repo", "abc-123"]);
  });

  it("a committed rename updates the title still on screen (W1)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a", title: "old name" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    host
      .querySelector<HTMLElement>(".vault-preview-title")
      ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = host.querySelector<HTMLInputElement>(".vault-preview-header .vault-row-rename-input");
    if (input) {
      input.value = "new name";
    }
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    // The host normalizes and pushes the authoritative entry back.
    panel.render(result([entry({ id: "claude:a", title: "old name", customName: "new name" })]));
    expect(host.querySelector(".vault-preview-title")?.textContent).toBe("new name");
  });

  it("a failed copy never inherits the previous tick (W2)", async () => {
    const host = createHost();
    let fail = false;
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: () => (fail ? Promise.reject(new Error("denied")) : Promise.resolve()) },
    });
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a", cwd: "/work/repo" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();

    const first = host.querySelector<HTMLElement>(".vault-preview-meta .vault-preview-copyable");
    first?.click();
    await flush();
    expect(first?.classList.contains("is-copied")).toBe(true);

    fail = true;
    first?.click();
    await flush();
    // The stale tick from the earlier success would read as "copied" for a copy
    // that was refused.
    expect(first?.classList.contains("is-copied")).toBe(false);
  });

  it("an overlapping activation owns the tick: late success, then rejection (W2)", async () => {
    const host = createHost();
    const settle: Array<(ok: boolean) => void> = [];
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: {
        writeText: () =>
          new Promise<void>((resolve, reject) => {
            settle.push((ok) => (ok ? resolve() : reject(new Error("denied"))));
          }),
      },
    });
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a", cwd: "/work/repo" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    const btn = host.querySelector<HTMLElement>(".vault-preview-meta .vault-preview-copyable");

    btn?.click(); // A — still pending
    btn?.click(); // B — supersedes A before A ever resolves
    await flush();
    settle[0]?.(true); // A succeeds LATE, after B took over
    await flush();
    // A no longer owns the affordance, so its success must not confirm anything.
    expect(btn?.classList.contains("is-copied")).toBe(false);

    settle[1]?.(false); // B, the activation that owns it, is refused
    await flush();
    expect(btn?.classList.contains("is-copied")).toBe(false);
  });

  it("two overlapping successes leave exactly one live confirmation (W2)", async () => {
    const host = createHost();
    const settle: Array<() => void> = [];
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: () => new Promise<void>((resolve) => settle.push(resolve)) },
    });
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a", cwd: "/work/repo" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    const btn = host.querySelector<HTMLElement>(".vault-preview-meta .vault-preview-copyable");

    btn?.click();
    btn?.click();
    await flush();
    settle[0]?.();
    await flush();
    settle[1]?.();
    await flush();
    expect(btn?.classList.contains("is-copied")).toBe(true);
    // The superseded activation must not have left a timer that expires early and
    // clears the live confirmation before its own interval.
    await new Promise((r) => setTimeout(r, 60));
    expect(btn?.classList.contains("is-copied")).toBe(true);
  });

  it("meta block omits the branch and the path when the session records neither", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "opencode:a", agent: "opencode", sessionId: "oc-1" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();

    const dd = Array.from(host.querySelectorAll<HTMLElement>(".vault-preview-meta dd"));
    expect(dd[0].querySelector(".vault-preview-branch-chip")).toBeNull();
    expect(dd[1].textContent).toBe("oc-1");
    expect(host.querySelectorAll(".vault-preview-meta .vault-preview-copyable")).toHaveLength(2);
  });

  it("Alt+Arrow jumps between user messages and never reaches the terminal", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({
        timeline: [
          { kind: "message", role: "user", text: "first ask", timestamp: 1 },
          { kind: "message", role: "assistant", text: "reply", timestamp: 2 },
          { kind: "message", role: "user", text: "second ask", timestamp: 3 },
        ],
      }),
    });
    const body = host.querySelector<HTMLElement>(".vault-preview-body");
    if (!body) {
      throw new Error("preview body missing");
    }
    const scrollTo = vi.fn();
    body.scrollTo = scrollTo as unknown as HTMLElement["scrollTo"];
    // jsdom lays nothing out — every rect is zero, so the jump has no target to
    // find. Give the body and its two user messages real vertical positions.
    const rectAt = (top: number) => () => ({ top }) as DOMRect;
    body.getBoundingClientRect = rectAt(0);
    const users = body.querySelectorAll<HTMLElement>(".vault-preview-message-user");
    expect(users).toHaveLength(2);
    users[0].getBoundingClientRect = rectAt(100);
    users[1].getBoundingClientRect = rectAt(300);

    const press = (key: string, altKey: boolean): KeyboardEvent => {
      const ev = new KeyboardEvent("keydown", { key, altKey, bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
      return ev;
    };

    // Jumps to the next user message — and is claimed, so the pty router
    // downstream never sees the key.
    expect(press("ArrowDown", true).defaultPrevented).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 92 }));
    expect(press("ArrowUp", true).defaultPrevented).toBe(true);

    // A bare arrow is the terminal's — the preview must not touch it.
    expect(press("ArrowDown", false).defaultPrevented).toBe(false);

    // An Alt+Arrow typed into the inline rename editor belongs to the caret.
    scrollTo.mockClear();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(press("ArrowUp", true).defaultPrevented).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("renders an assistant message as rich markdown — line breaks, a table, and a code block (D17)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    const md =
      "Summary:\n- point one\n- point two\n\n| Task | Hours |\n| --- | --- |\n| A | 12 |\n\n```ts\nconst x = 1;\n```";
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({ timeline: [{ kind: "message", role: "assistant", text: md, timestamp: Date.now() }] }),
    });
    const body = host.querySelector(".vault-preview-message-assistant .vault-md");
    expect(body).not.toBeNull();
    // Bullet list rendered as a real <ul>.
    expect(body?.querySelectorAll("ul.md-list li")).toHaveLength(2);
    // Markdown table rendered as a real grid.
    expect(Array.from(body?.querySelectorAll("thead th") ?? []).map((th) => th.textContent)).toEqual(["Task", "Hours"]);
    expect(body?.querySelector("tbody td")?.textContent).toBe("A");
    // Fenced code preserved verbatim in a <pre><code>.
    expect(body?.querySelector("pre.md-pre code")?.textContent).toBe("const x = 1;");
  });

  it("renders only what the timeline contains (no empty filler)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({ timeline: [{ kind: "message", role: "user", text: "just a prompt" }] }),
    });
    const items = host.querySelectorAll(".vault-preview-body .vault-preview-message");
    expect(items).toHaveLength(1);
    expect(host.querySelector(".vault-preview-message-user p")?.textContent).toBe("just a prompt");
  });

  it("shows a limited-detail notice for a partial detail", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "codex:a", agent: "codex" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "codex:a",
      detail: detail({ entryId: "codex:a", firstPrompt: "p", partial: true, limitedReason: "Index only." }),
    });
    expect(host.querySelector(".vault-preview-notice")?.textContent).toBe("Index only.");
  });

  it("opens a compatible Cursor chat preview while Resume remains explicit", () => {
    const host = createHost();
    const posted: Array<{ type: string; entryId?: string | null }> = [];
    const panel = new VaultPanel({
      host,
      postMessage: (message) => posted.push(message),
      getInitialCollapsed: () => false,
    });
    panel.render(result([entry({ id: "cursor:chat-1", agent: "cursor", source: "cli", canResume: true })]));
    expect(host.querySelector(".vault-row-source")?.textContent).toBe("CLI");

    host.querySelector<HTMLElement>(".vault-row")?.click();

    expect(host.querySelector(".vault-preview.is-open")).not.toBeNull();
    expect(host.querySelector(".vault-preview-meta")?.textContent).toContain("SourceCursor CLI");
    expect(posted).toContainEqual({ type: "requestVaultSessionDetail", entryId: "cursor:chat-1" });
    expect(posted).not.toContainEqual({ type: "vaultResume", entryId: "cursor:chat-1" });

    host.querySelector<HTMLButtonElement>(".vault-action--resume")?.click();
    expect(posted).toContainEqual({ type: "vaultResume", entryId: "cursor:chat-1" });
  });

  it.each(["Enter", " "])("opens a Cursor preview with the %s key", (key) => {
    const host = createHost();
    const posted: Array<{ type: string; entryId?: string | null }> = [];
    const panel = new VaultPanel({
      host,
      postMessage: (message) => posted.push(message),
      getInitialCollapsed: () => false,
    });
    panel.render(result([entry({ id: "cursor:chat-1", agent: "cursor", source: "cli", canResume: true })]));

    host.querySelector<HTMLElement>(".vault-row")?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

    expect(host.querySelector(".vault-preview.is-open")).not.toBeNull();
    expect(host.querySelector(".vault-preview-meta")?.textContent).toContain("SourceCursor CLI");
    expect(posted).toContainEqual({ type: "requestVaultSessionDetail", entryId: "cursor:chat-1" });
    expect(posted).not.toContainEqual({ type: "vaultResume", entryId: "cursor:chat-1" });
  });

  it("renders decoded Cursor detail as a normal timeline", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "cursor:chat-1", agent: "cursor", source: "cli", canResume: true })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();

    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "cursor:chat-1",
      detail: detail({
        entryId: "cursor:chat-1",
        contentKind: "timeline",
        timeline: [{ kind: "message", role: "assistant", text: "decoded" }],
      }),
    });

    expect(host.querySelector(".vault-preview-message-assistant")?.textContent).toContain("decoded");
    expect(host.querySelector(".vault-preview-continue")).toBeNull();
  });

  it("renders a non-resumable Cursor chat as a metadata-only preview with Continue", () => {
    const host = createHost();
    const posted: Array<{ type: string; entryId?: string | null; name?: string }> = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(
      result([entry({ id: "cursor:chat-1", agent: "cursor", source: "ide", canResume: false, title: "Cursor chat" })]),
    );

    expect(host.querySelector(".vault-row-dot")?.classList.contains("vault-row-dot--cursor")).toBe(true);
    expect(host.querySelector(".vault-row-source")?.textContent).toBe("IDE");
    expect(host.querySelector(".vault-action--resume")).toBeNull();
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "cursor:chat-1",
      detail: detail({
        entryId: "cursor:chat-1",
        partial: true,
        limitedReason: "Cursor transcript data is unavailable; showing indexed metadata only.",
      }),
    });

    expect(host.querySelector(".vault-preview")?.classList.contains("vault-preview--cursor")).toBe(true);
    expect(host.querySelector(".vault-preview-meta")?.textContent).toContain("SourceCursor IDE");
    expect(host.querySelector(".vault-preview-resume")).toBeNull();
    expect(host.querySelector(".vault-preview-notice")?.textContent).toContain("indexed metadata only");
    expect(host.querySelector<HTMLButtonElement>(".vault-preview-continue")?.textContent).toBe(
      "Continue in New Session",
    );
    expect(host.querySelector(".vault-msg-actions")).toBeNull();
    expect(host.querySelector(".vault-preview-loadmore")).toBeNull();

    host
      .querySelector<HTMLElement>(".vault-preview-title")
      ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const rename = host.querySelector<HTMLInputElement>(".vault-preview-header .vault-row-rename-input");
    expect(rename).not.toBeNull();
    if (rename) {
      rename.value = "Local Cursor name";
    }
    rename?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(posted).toContainEqual({ type: "vaultRenameSession", entryId: "cursor:chat-1", name: "Local Cursor name" });

    host.querySelector<HTMLButtonElement>(".vault-preview-continue")?.click();
    expect(document.querySelector(".vault-continue")).not.toBeNull();
  });

  it.each([
    {
      label: "IDE",
      value: entry({
        id: "cursor:ide:d29ya3NwYWNlLTE:composer-1",
        agent: "cursor",
        sessionId: "ide:d29ya3NwYWNlLTE:composer-1",
        source: "ide",
        canResume: true,
      }),
    },
    {
      label: "Project",
      value: entry({
        id: "cursor:project:cHJvamVjdC0x:chat-1",
        agent: "cursor",
        sessionId: "project:cHJvamVjdC0x:chat-1",
        canResume: true,
      }),
    },
  ])("hides Resume and command-copy for $label Cursor entries despite forged capability", ({ label, value }) => {
    const host = createHost();
    const posted: Array<{ type: string }> = [];
    const panel = new VaultPanel({
      host,
      postMessage: (message) => posted.push(message),
      getInitialCollapsed: () => false,
    });
    panel.render(result([value]));

    expect(host.querySelector(".vault-row-source")?.textContent).toBe(label);
    expect(host.querySelector(".vault-action--resume")).toBeNull();
    const row = host.querySelector<HTMLElement>(".vault-row");
    row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    const labels = Array.from(host.querySelectorAll(".vault-context-menu button")).map((button) => button.textContent);
    expect(labels).not.toContain("Resume in New Tab");
    expect(labels).not.toContain("Copy Resume Command");
    expect(posted.some((message) => message.type === "vaultResume" || message.type === "vaultCopyResumeCommand")).toBe(
      false,
    );
  });

  it("ignores a stale response for a row that is no longer the active preview", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" }), entry({ id: "codex:b", agent: "codex" })]));
    const rows = host.querySelectorAll<HTMLElement>(".vault-row");
    rows[0].click(); // open A
    rows[1].click(); // now B is the active preview
    // A's (slow) response arrives — must be dropped.
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({ entryId: "claude:a", timeline: [{ kind: "message", role: "user", text: "STALE-A-PROMPT" }] }),
    });
    expect(host.querySelector(".vault-preview")?.textContent).not.toContain("STALE-A-PROMPT");
    // B's response renders normally.
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "codex:b",
      detail: detail({ entryId: "codex:b", timeline: [{ kind: "message", role: "user", text: "FRESH-B-PROMPT" }] }),
    });
    expect(host.querySelector(".vault-preview")?.textContent).toContain("FRESH-B-PROMPT");
  });

  it("renders an inline error when the response carries one", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({ type: "vaultSessionDetailResponse", entryId: "claude:a", error: "boom" });
    expect(host.querySelector(".vault-preview-error")?.textContent).toBe("boom");
  });

  it("closes on Esc and on the Close button", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    expect(host.querySelector(".vault-preview.is-open")).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(host.querySelector(".vault-preview.is-open")).toBeNull();

    host.querySelector<HTMLElement>(".vault-row")?.click();
    host.querySelector<HTMLButtonElement>(".vault-preview-close")?.click();
    expect(host.querySelector(".vault-preview.is-open")).toBeNull();
  });

  it("mounts 8 edge/corner resize handles on the open preview", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    expect(host.querySelectorAll(".vault-preview .vault-preview-resize")).toHaveLength(8);
    // Handles survive a content re-render (loading → detail).
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({ timeline: [{ kind: "message", role: "user", text: "hi" }] }),
    });
    expect(host.querySelectorAll(".vault-preview .vault-preview-resize")).toHaveLength(8);
  });

  it("toggles maximize, and REMEMBERS it across close → reopen (geometry persistence)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    const preview = host.querySelector(".vault-preview");
    expect(preview?.classList.contains("vault-preview--max")).toBe(false);
    host.querySelector<HTMLButtonElement>(".vault-preview-maximize")?.click();
    expect(preview?.classList.contains("vault-preview--max")).toBe(true);
    // Re-opening keeps the maximized state (size/position are remembered, #1).
    host.querySelector<HTMLButtonElement>(".vault-preview-close")?.click();
    host.querySelector<HTMLElement>(".vault-row")?.click();
    expect(host.querySelector(".vault-preview")?.classList.contains("vault-preview--max")).toBe(true);
    // Restoring returns to the floating size.
    host.querySelector<HTMLButtonElement>(".vault-preview-maximize")?.click();
    expect(host.querySelector(".vault-preview")?.classList.contains("vault-preview--max")).toBe(false);
  });

  it("Escape with the context menu open dismisses only the menu, leaving the preview open (W5)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    const row = host.querySelector<HTMLElement>(".vault-row");
    row?.click(); // open the preview first (registers its Esc listener first)
    expect(host.querySelector(".vault-preview.is-open")).not.toBeNull();
    row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    expect(host.querySelector(".vault-context-menu")).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(host.querySelector(".vault-context-menu")).toBeNull(); // menu dismissed
    expect(host.querySelector(".vault-preview.is-open")).not.toBeNull(); // preview stays open
  });

  it("renders thinking blocks and indents AI output; user messages carry the agent accent", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "codex:a", agent: "codex" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "codex:a",
      detail: detail({
        entryId: "codex:a",
        timeline: [
          { kind: "message", role: "user", text: "do it" },
          { kind: "thinking", text: "let me think" },
          { kind: "message", role: "assistant", text: "done" },
        ],
      }),
    });
    expect(host.querySelector(".vault-preview-message-thinking p")?.textContent).toBe("let me think");
    // Agent accent class is applied so user messages tint per-agent (codex here).
    expect(host.querySelector(".vault-preview")?.classList.contains("vault-preview--codex")).toBe(true);
  });

  it("collapses long reasoning to a one-line gist that expands on click", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    const reasoning = "**Evaluating schema requirements**\nI'm considering the implications of an empty description.";
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({
        timeline: [
          { kind: "message", role: "user", text: "go" },
          { kind: "thinking", text: reasoning },
        ],
      }),
    });
    const block = host.querySelector(".vault-preview-message-thinking");
    expect(block?.classList.contains("is-collapsible")).toBe(true);
    expect(block?.classList.contains("is-expanded")).toBe(false);
    // Gist = first line with markdown noise stripped (no fade, no half-cut line).
    expect(host.querySelector(".vault-preview-collapsible-gist")?.textContent).toBe("Evaluating schema requirements");
    // Clicking the head expands the full reasoning body.
    const head = host.querySelector<HTMLButtonElement>(".vault-preview-collapsible-head");
    expect(head?.getAttribute("aria-expanded")).toBe("false");
    head?.click();
    expect(block?.classList.contains("is-expanded")).toBe(true);
    expect(head?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".vault-preview-collapsible-body")?.textContent).toContain("empty description");
  });

  it("keeps short reasoning inline (no gist/collapse)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({
        timeline: [
          { kind: "message", role: "user", text: "go" },
          { kind: "thinking", text: "quick note" },
        ],
      }),
    });
    expect(host.querySelector(".vault-preview-message-thinking.is-collapsible")).toBeNull();
    expect(host.querySelector(".vault-preview-collapsible-gist")).toBeNull();
    expect(host.querySelector(".vault-preview-message-thinking p")?.textContent).toBe("quick note");
  });

  it("renders a background-task notice as one collapsed line that expands to its result", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({
        timeline: [
          { kind: "message", role: "user", text: "go" },
          {
            kind: "notice",
            summary: 'Background command "Re-run release 0.17.9" completed (exit code 0)',
            status: "completed",
            body: "## Review\n\nVERDICT: BLOCK",
          },
        ],
      }),
    });
    const block = host.querySelector(".vault-preview-message-notice");
    expect(block).not.toBeNull();
    expect(block?.classList.contains("is-collapsible")).toBe(true);
    expect(block?.classList.contains("is-expanded")).toBe(false);
    expect(host.querySelector(".vault-preview-collapsible-gist")?.textContent).toContain("Re-run release 0.17.9");
    // The status rides the role line so the collapsed line says what happened.
    expect(block?.querySelector(".vault-preview-message-role")?.textContent).toContain("completed");
    const head = block?.querySelector<HTMLButtonElement>(".vault-preview-collapsible-head");
    head?.click();
    expect(block?.classList.contains("is-expanded")).toBe(true);
    expect(block?.querySelector(".vault-preview-collapsible-body")?.textContent).toContain("VERDICT: BLOCK");
  });

  it("renders a body-less notice as a plain line with no expander", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({
        timeline: [
          { kind: "message", role: "user", text: "go" },
          { kind: "notice", summary: "Agent finished", status: "completed" },
        ],
      }),
    });
    const block = host.querySelector(".vault-preview-message-notice");
    expect(block?.classList.contains("is-collapsible")).toBe(false);
    expect(block?.querySelector(".vault-preview-collapsible-head")).toBeNull();
    expect(block?.textContent).toContain("Agent finished");
  });

  it("renders a compaction summary collapsed", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    const text = "This session is being continued from a previous conversation.\n\nSummary:\n1. the user asked for X";
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({
        timeline: [
          { kind: "message", role: "user", text: "go" },
          { kind: "compaction", text },
        ],
      }),
    });
    const block = host.querySelector(".vault-preview-message-compaction");
    expect(block?.classList.contains("is-collapsible")).toBe(true);
    expect(block?.querySelector(".vault-preview-message-role")?.textContent).toContain("Context compacted");
    expect(block?.querySelector(".vault-preview-collapsible-body")?.textContent).toContain("the user asked for X");
  });

  it("never hides a notice behind a run cap", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({
        timeline: [
          { kind: "message", role: "user", text: "go" },
          { kind: "tool", tool: "Bash", detail: "one" },
          { kind: "tool", tool: "Bash", detail: "two" },
          { kind: "tool", tool: "Bash", detail: "three" },
          { kind: "tool", tool: "Bash", detail: "four" },
          { kind: "notice", summary: "Agent finished" },
        ],
      }),
    });
    // The run is capped ("Show N more"), but the notice broke the run and stands.
    expect(host.querySelector(".vault-preview-expand")).not.toBeNull();
    expect(host.querySelector(".vault-preview-message-notice")?.textContent).toContain("Agent finished");
  });

  it("loads older messages when truncated: the button posts a larger limit; the grown response removes it", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null; limit?: number }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    // Initial (truncated) window.
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({ truncated: true, timeline: [{ kind: "message", role: "user", text: "recent" }] }),
    });
    const more = host.querySelector<HTMLButtonElement>(".vault-preview-loadmore");
    expect(more).not.toBeNull();
    more?.click();
    // A load-more request goes out with a larger limit (default 400 + step 400).
    const req = posted.find((m) => m.type === "requestVaultSessionDetail" && typeof m.limit === "number");
    expect(req?.limit).toBe(800);
    // Older window arrives, no longer truncated → button gone, older text shown.
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({
        truncated: false,
        timeline: [
          { kind: "message", role: "user", text: "older" },
          { kind: "message", role: "user", text: "recent" },
        ],
      }),
    });
    expect(host.querySelector(".vault-preview-loadmore")).toBeNull();
    expect(host.querySelector(".vault-preview-body")?.textContent).toContain("older");
  });

  it("caps an AI run at 3 items behind a 'Show N more' that expands in place", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    const tools = Array.from({ length: 8 }, (_, i) => ({ kind: "tool" as const, tool: "Bash", detail: `cmd ${i}` }));
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({ timeline: [{ kind: "message", role: "user", text: "go" }, ...tools] }),
    });
    // user message + first 3 tools = 4 messages, plus the expand button.
    expect(host.querySelectorAll(".vault-preview-body .vault-preview-message")).toHaveLength(4);
    const more = host.querySelector<HTMLButtonElement>(".vault-preview-expand");
    expect(more?.textContent).toBe("Show 5 more steps");
    more?.click();
    expect(host.querySelectorAll(".vault-preview-body .vault-preview-message")).toHaveLength(9);
    expect(host.querySelector(".vault-preview-expand")).toBeNull();
  });

  it("pins the run's concluding assistant message below the cap (head + tail)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    // Run = thinking + 3 tools + a trailing conclusion (5 items, > CAP=3). The
    // conclusion sits at the tail, where a plain head slice would bury it.
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({
        timeline: [
          { kind: "message", role: "user", text: "go" },
          { kind: "thinking", text: "planning" },
          { kind: "tool", tool: "Bash", detail: "step 1" },
          { kind: "tool", tool: "Bash", detail: "step 2" },
          { kind: "tool", tool: "Bash", detail: "step 3" },
          { kind: "message", role: "assistant", text: "FINAL ANSWER" },
        ],
      }),
    });
    // Head = CAP-1 (thinking + first tool) + "Show 2 more steps" + pinned tail.
    const more = host.querySelector<HTMLButtonElement>(".vault-preview-expand");
    expect(more?.textContent).toBe("Show 2 more steps");
    // The conclusion is index 4 (beyond the 2-item head) yet still rendered →
    // it was pinned, not coincidentally inside the head window.
    const assistant = host.querySelector(".vault-preview-body .vault-preview-message-assistant");
    expect(assistant?.textContent).toContain("FINAL ANSWER");
    // Only the head tool is shown; the middle two are hidden behind the expand.
    expect(host.querySelectorAll(".vault-preview-body .vault-preview-message-tool")).toHaveLength(1);
    // The pin sits AFTER the expand button (tail position, not in the head).
    const buttons = Array.from(host.querySelectorAll(".vault-preview-body > *"));
    expect(buttons.indexOf(more as Element)).toBeLessThan(buttons.indexOf(assistant as Element));
    // Expanding reveals every step in natural order; the conclusion remains.
    more?.click();
    expect(host.querySelectorAll(".vault-preview-body .vault-preview-message-tool")).toHaveLength(3);
    expect(host.querySelector(".vault-preview-expand")).toBeNull();
    expect(host.querySelector(".vault-preview-body .vault-preview-message-assistant")?.textContent).toContain(
      "FINAL ANSWER",
    );
  });

  it("pins the run's last assistant message even when a tool step trails it", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    // Run = 3 tools + the concluding assistant line + a trailing tool (5 items > CAP).
    // Agents that end a turn with an AskUserQuestion (or a final bookkeeping command)
    // leave the answer second-to-last — it must still surface, not stay buried.
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({
        timeline: [
          { kind: "message", role: "user", text: "go" },
          { kind: "tool", tool: "Bash", detail: "s1" },
          { kind: "tool", tool: "Bash", detail: "s2" },
          { kind: "tool", tool: "Bash", detail: "s3" },
          { kind: "message", role: "assistant", text: "FINAL ANSWER" },
          { kind: "tool", tool: "Bash", detail: "s4" },
        ],
      }),
    });
    // Head = CAP-1 (first 2 tools) + "Show 2 more steps" + pinned conclusion; the
    // trailing tool stays hidden behind the expand.
    expect(host.querySelector(".vault-preview-expand")?.textContent).toBe("Show 2 more steps");
    expect(host.querySelectorAll(".vault-preview-body .vault-preview-message-tool")).toHaveLength(2);
    const assistant = host.querySelector(".vault-preview-body .vault-preview-message-assistant");
    expect(assistant?.textContent).toContain("FINAL ANSWER");
    // The pin sits AFTER the expand button (tail position), not coincidentally in the head.
    const children = Array.from(host.querySelectorAll(".vault-preview-body > *"));
    const more = host.querySelector(".vault-preview-expand");
    expect(children.indexOf(more as Element)).toBeLessThan(children.indexOf(assistant as Element));
    // Expanding reveals every step in natural order — including the trailing tool.
    host.querySelector<HTMLButtonElement>(".vault-preview-expand")?.click();
    expect(host.querySelectorAll(".vault-preview-body .vault-preview-message-tool")).toHaveLength(4);
    expect(host.querySelector(".vault-preview-body .vault-preview-message-assistant")?.textContent).toContain(
      "FINAL ANSWER",
    );
  });

  it("does NOT pin an assistant message that already falls inside the visible head (no reorder)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    // Run = 2 tools + assistant + 1 tool (4 items > CAP=3). The assistant is at index
    // 2, inside the 3-item head a non-pinned run shows — so it must render in natural
    // order, not be reordered below the expand button.
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: detail({
        timeline: [
          { kind: "message", role: "user", text: "go" },
          { kind: "tool", tool: "Bash", detail: "s1" },
          { kind: "tool", tool: "Bash", detail: "s2" },
          { kind: "message", role: "assistant", text: "MIDPOINT" },
          { kind: "tool", tool: "Bash", detail: "s3" },
        ],
      }),
    });
    expect(host.querySelector(".vault-preview-expand")?.textContent).toBe("Show 1 more step");
    const assistant = host.querySelector(".vault-preview-body .vault-preview-message-assistant");
    expect(assistant?.textContent).toContain("MIDPOINT");
    // Natural order: the assistant sits BEFORE the expand button (head), not pinned after it.
    const children = Array.from(host.querySelectorAll(".vault-preview-body > *"));
    const more = host.querySelector(".vault-preview-expand");
    expect(children.indexOf(assistant as Element)).toBeLessThan(children.indexOf(more as Element));
  });

  it("renders an AskUserQuestion item with its prompt + answer, breaking the run so it always shows", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "opencode:a", agent: "opencode" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    // A long tool run, then the question. As a run-breaking item it renders
    // directly — never hidden behind the run's "Show N more" cap.
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:a",
      detail: detail({
        entryId: "opencode:a",
        timeline: [
          { kind: "message", role: "user", text: "go" },
          { kind: "tool", tool: "Bash", detail: "s1" },
          { kind: "tool", tool: "Bash", detail: "s2" },
          { kind: "tool", tool: "Bash", detail: "s3" },
          { kind: "tool", tool: "Bash", detail: "s4" },
          { kind: "question", questions: [{ prompt: "Approve the plan?", answer: "Approve (Recommended)" }] },
          { kind: "question", questions: [{ prompt: "Run re-review now?" }] },
        ],
      }),
    });
    const blocks = host.querySelectorAll(".vault-preview-body .vault-preview-message-question");
    expect(blocks).toHaveLength(2);
    // Answered question shows the prompt + the user's pick (not pending).
    expect(blocks[0].querySelector(".vault-preview-question-prompt")?.textContent).toBe("Approve the plan?");
    expect(blocks[0].querySelector(".vault-preview-question-answer")?.textContent).toContain("Approve (Recommended)");
    expect(blocks[0].querySelector(".vault-preview-question-answer.is-pending")).toBeNull();
    // Pending question shows the prompt + an "Awaiting answer" marker.
    expect(blocks[1].querySelector(".vault-preview-question-prompt")?.textContent).toBe("Run re-review now?");
    expect(blocks[1].querySelector(".vault-preview-question-answer.is-pending")?.textContent).toBe("Awaiting answer");
    // The question broke the tool run, so the run before it still caps at 3 + expand.
    expect(host.querySelector(".vault-preview-expand")?.textContent).toBe("Show 1 more step");
  });

  it("expands an AskUserQuestion to reveal its options, highlighting the chosen one", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "opencode:a", agent: "opencode" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:a",
      detail: detail({
        entryId: "opencode:a",
        timeline: [
          { kind: "message", role: "user", text: "go" },
          {
            kind: "question",
            questions: [
              {
                prompt: "Which direction?",
                answer: "Built-in",
                options: [
                  { label: "Built-in", description: "use the built-in provider", chosen: true },
                  { label: "Custom", description: "more control" },
                ],
              },
            ],
          },
        ],
      }),
    });
    const block = host.querySelector(".vault-preview-message-question");
    expect(block?.classList.contains("is-collapsible")).toBe(true);
    // Collapsed by default: options are present in the DOM but hidden via the class.
    expect(block?.classList.contains("is-expanded")).toBe(false);
    const options = block?.querySelectorAll(".vault-preview-question-option");
    expect(options).toHaveLength(2);
    expect(options?.[0].classList.contains("is-chosen")).toBe(true);
    expect(options?.[0].querySelector(".vault-preview-question-option-desc")?.textContent).toBe(
      "use the built-in provider",
    );
    expect(options?.[1].classList.contains("is-chosen")).toBe(false);
    // Clicking the header toggles the options open.
    const head = block?.querySelector<HTMLButtonElement>(".vault-preview-question-head");
    head?.click();
    expect(block?.classList.contains("is-expanded")).toBe(true);
    expect(head?.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders a subagentSession as a collapsed block with title + first message", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "opencode:a", agent: "opencode" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:a",
      detail: detail({
        entryId: "opencode:a",
        timeline: [
          {
            kind: "subagentSession",
            entryId: "opencode:ses_kid",
            title: "Review the diff",
            firstMessage: "go review",
            agent: "reviewer",
          },
        ],
      }),
    });
    const block = host.querySelector(".vault-preview-subagent");
    expect(block).not.toBeNull();
    // The agent identity is split out into a badge + accent chip; the description
    // alone lives in `-title` (no more `@reviewer · …` concatenated into one span).
    expect(host.querySelector(".vault-preview-subagent-badge")?.textContent).toBe("agent");
    expect(host.querySelector(".vault-preview-subagent-agent")?.textContent).toBe("@reviewer");
    expect(host.querySelector(".vault-preview-subagent-title")?.textContent).toBe("Review the diff");
    expect(host.querySelector(".vault-preview-subagent-firstmsg")?.textContent).toBe("go review");
    // Collapsed by default — no nested transcript yet.
    expect(block?.classList.contains("is-open")).toBe(false);
    expect(host.querySelector(".vault-preview-subagent-body .vault-preview-message")).toBeNull();
  });

  it("expanding a subagent block lazily requests the child and renders its transcript nested", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "opencode:a", agent: "opencode" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:a",
      detail: detail({
        entryId: "opencode:a",
        timeline: [{ kind: "subagentSession", entryId: "opencode:ses_kid", title: "Sub", firstMessage: "prompt" }],
      }),
    });
    host.querySelector<HTMLButtonElement>(".vault-preview-subagent-head")?.click();
    // Expanding posts a detail request for the CHILD entry id (lazy fetch).
    expect(posted).toContainEqual(
      expect.objectContaining({ type: "requestVaultSessionDetail", entryId: "opencode:ses_kid" }),
    );
    expect(host.querySelector(".vault-preview-subagent")?.classList.contains("is-open")).toBe(true);
    // The child's response renders into the block (not the root, despite entryId ≠ active).
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:ses_kid",
      requestId: nestedRequestId(posted, "opencode:ses_kid"),
      detail: detail({
        entryId: "opencode:ses_kid",
        timeline: [
          { kind: "message", role: "user", text: "child prompt" },
          { kind: "message", role: "assistant", text: "child reply" },
        ],
      }),
    });
    const nested = host.querySelectorAll(".vault-preview-subagent-body .vault-preview-message");
    expect(nested).toHaveLength(2);
    expect(host.querySelector(".vault-preview-subagent-body .vault-preview-message-assistant p")?.textContent).toBe(
      "child reply",
    );
  });

  it("2_4: a workflow board reuses the session-detail preview per agent; a late switch is inert", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:wfp", agent: "claude" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();

    // Root detail: the run shows as one group subagentSession node (the parent timeline form).
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:wfp",
      detail: detail({
        entryId: "claude:wfp",
        timeline: [{ kind: "subagentSession", entryId: "claude:wfp:workflow:wf1", title: "Workflow: design-board" }],
      }),
    });

    // Expanding the group lazily requests the workflow group id.
    host.querySelector<HTMLButtonElement>(".vault-preview-subagent-head")?.click();
    expect(posted).toContainEqual(
      expect.objectContaining({ type: "requestVaultSessionDetail", entryId: "claude:wfp:workflow:wf1" }),
    );

    // The group resolves to a single workflowBoard item → the board mounts nested.
    const AID = "claude:wfp:wfagent:wf1:agent-aaa";
    const BID = "claude:wfp:wfagent:wf1:agent-bbb";
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:wfp:workflow:wf1",
      requestId: nestedRequestId(posted, "claude:wfp:workflow:wf1"),
      detail: detail({
        entryId: "claude:wfp:workflow:wf1",
        timeline: [
          {
            kind: "workflowBoard",
            wfId: "wf1",
            workflowName: "design-board",
            phases: [{ index: 1, title: "Plan" }],
            agents: [
              { label: "alpha", phaseIndex: 1, entryId: AID },
              { label: "beta", phaseIndex: 1, entryId: BID },
            ],
          },
        ],
      }),
    });
    expect(host.querySelector(".vault-preview-subagent-body .vault-wfboard")).not.toBeNull();

    // The board folds itself — expand it, then expand the phase → its two agent leaves.
    host.querySelector<HTMLButtonElement>(".vault-wfboard-header")?.click();
    host.querySelector<HTMLButtonElement>(".vault-wfboard-phase-head")?.click();
    const leaves = () => host.querySelectorAll<HTMLButtonElement>(".vault-wfboard-leaf");
    expect(leaves()).toHaveLength(2);

    // Rapid switch: select alpha, then beta before alpha resolves. Each posts a
    // detail request through the REAL PreviewController populateNested/pendingNested.
    leaves()[0].click();
    leaves()[1].click();
    expect(posted).toContainEqual(expect.objectContaining({ type: "requestVaultSessionDetail", entryId: AID }));
    expect(posted).toContainEqual(expect.objectContaining({ type: "requestVaultSessionDetail", entryId: BID }));

    // beta resolves → its transcript renders in the visible right pane.
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: BID,
      requestId: nestedRequestId(posted, BID),
      detail: detail({ entryId: BID, timeline: [{ kind: "message", role: "assistant", text: "beta transcript" }] }),
    });
    expect(host.querySelector(".vault-wfboard-detail-body")?.textContent).toContain("beta transcript");

    // alpha's LATE reply lands on its orphaned (detached) container — the visible
    // pane still shows beta, never overwritten (D4).
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: AID,
      requestId: nestedRequestId(posted, AID),
      detail: detail({ entryId: AID, timeline: [{ kind: "message", role: "assistant", text: "alpha transcript" }] }),
    });
    const visible = host.querySelector(".vault-wfboard-detail-body")?.textContent ?? "";
    expect(visible).toContain("beta transcript");
    expect(visible).not.toContain("alpha transcript");

    // Re-selecting alpha hits the cache (its late detail was stored, not lost).
    leaves()[0].click();
    expect(host.querySelector(".vault-wfboard-detail-body")?.textContent).toContain("alpha transcript");
  });

  it("2_4b: expanding a run inside an open agent transcript keeps the agent open (issue 4)", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:wfp2", agent: "claude" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();

    // Root detail is the board itself (the run-expansion rerender rebuilds the body).
    const AID = "claude:wfp2:wfagent:wf9:agent-aaa";
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:wfp2",
      detail: detail({
        entryId: "claude:wfp2",
        timeline: [
          {
            kind: "workflowBoard",
            wfId: "wf9",
            workflowName: "wf",
            phases: [{ index: 1, title: "P" }],
            agents: [{ label: "a", phaseIndex: 1, entryId: AID }],
          },
        ],
      }),
    });
    host.querySelector<HTMLButtonElement>(".vault-wfboard-header")?.click(); // expand the board
    host.querySelector<HTMLButtonElement>(".vault-wfboard-phase-head")?.click();
    host.querySelector<HTMLButtonElement>(".vault-wfboard-leaf")?.click();

    // The agent's transcript has a 5-step run → capped behind a "Show 2 more steps".
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: AID,
      requestId: nestedRequestId(posted, AID),
      detail: detail({
        entryId: AID,
        timeline: [1, 2, 3, 4, 5].map((n) => ({ kind: "tool", tool: "Bash", detail: `step ${n}` })),
      }),
    });
    expect(host.querySelector(".vault-wfboard-detail-head")?.textContent).toBe("a");
    const expandBtn = host.querySelector<HTMLButtonElement>(".vault-wfboard-detail-body .vault-preview-expand");
    expect(expandBtn).not.toBeNull();

    // Before the fix this rerender rebuilt the board to its hint, hiding the agent.
    expandBtn?.click();
    expect(host.querySelector(".vault-wfboard-detail-head")?.textContent).toBe("a"); // still open
    expect(host.querySelector(".vault-wfboard-empty")).toBeNull(); // not reset to the hint
    expect(host.querySelector(".vault-wfboard-leaf.sel")?.textContent).toBe("a");
    // Fully expanded now (no remaining "Show N more").
    expect(host.querySelectorAll(".vault-wfboard-detail-body .vault-preview-expand")).toHaveLength(0);
  });

  it("2_4c: scrolls an agent's transcript pane to the last message on open (#3)", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:wfp3", agent: "claude" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    const AID = "claude:wfp3:wfagent:wfx:agent-aaa";
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:wfp3",
      detail: detail({
        entryId: "claude:wfp3",
        timeline: [
          {
            kind: "workflowBoard",
            wfId: "wfx",
            workflowName: "wf",
            phases: [{ index: 1, title: "P" }],
            agents: [{ label: "a", phaseIndex: 1, entryId: AID }],
          },
        ],
      }),
    });
    // jsdom has no layout, so fake the pane's scroll metrics to observe the jump.
    const pane = host.querySelector<HTMLElement>(".vault-wfboard-right");
    if (!pane) {
      throw new Error("missing right pane");
    }
    let scrolledTo = -1;
    Object.defineProperty(pane, "scrollHeight", { value: 777, configurable: true });
    Object.defineProperty(pane, "scrollTop", {
      configurable: true,
      get: () => scrolledTo,
      set: (v: number) => {
        scrolledTo = v;
      },
    });
    host.querySelector<HTMLButtonElement>(".vault-wfboard-header")?.click(); // expand the board
    host.querySelector<HTMLButtonElement>(".vault-wfboard-phase-head")?.click();
    host.querySelector<HTMLButtonElement>(".vault-wfboard-leaf")?.click(); // posts the agent request
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: AID,
      requestId: nestedRequestId(posted, AID),
      detail: detail({ entryId: AID, timeline: [{ kind: "message", role: "assistant", text: "the conclusion" }] }),
    });
    expect(scrolledTo).toBe(777); // jumped to the bottom (last message)
  });

  it("caps + pins the conclusion inside a nested subagent transcript (like the root)", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "opencode:a", agent: "opencode" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:a",
      detail: detail({
        entryId: "opencode:a",
        timeline: [{ kind: "subagentSession", entryId: "opencode:ses_kid", title: "Sub", firstMessage: "prompt" }],
      }),
    });
    host.querySelector<HTMLButtonElement>(".vault-preview-subagent-head")?.click();
    // Child run = thinking + 3 tools + a trailing conclusion (5 items > CAP=3).
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:ses_kid",
      requestId: nestedRequestId(posted, "opencode:ses_kid"),
      detail: detail({
        entryId: "opencode:ses_kid",
        timeline: [
          { kind: "message", role: "user", text: "child prompt" },
          { kind: "thinking", text: "planning" },
          { kind: "tool", tool: "Bash", detail: "s1" },
          { kind: "tool", tool: "Bash", detail: "s2" },
          { kind: "tool", tool: "Bash", detail: "s3" },
          { kind: "message", role: "assistant", text: "CHILD CONCLUSION" },
        ],
      }),
    });
    const body = host.querySelector(".vault-preview-subagent-body");
    // Head shows CAP-1 (thinking + 1 tool) → only 1 tool visible, not all 3.
    expect(body?.querySelectorAll(".vault-preview-message-tool")).toHaveLength(1);
    expect(body?.querySelector(".vault-preview-expand")?.textContent).toBe("Show 2 more steps");
    // The conclusion is pinned below the expand and stays visible.
    expect(body?.querySelector(".vault-preview-message-assistant")?.textContent).toContain("CHILD CONCLUSION");
  });

  it("resolves every block sharing a child entryId from one detail reply (not just the latest)", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "opencode:a", agent: "opencode" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    // Root references the SAME child entryId in two blocks. `truncated` enables a
    // load-more rebuild — the re-render that re-renders BOTH blocks (expansion state
    // is keyed by entryId, so both auto-populate the one pending id).
    const dup = () =>
      detail({
        entryId: "opencode:a",
        truncated: true,
        timeline: [
          { kind: "subagentSession", entryId: "opencode:ses_dup", title: "Sub A", firstMessage: "p" },
          { kind: "subagentSession", entryId: "opencode:ses_dup", title: "Sub B", firstMessage: "p" },
        ],
      });
    panel.handleSessionDetailResponse({ type: "vaultSessionDetailResponse", entryId: "opencode:a", detail: dup() });
    // Expand BOTH blocks → still ONE child request in flight, both bodies in its Set.
    for (const head of host.querySelectorAll<HTMLButtonElement>(".vault-preview-subagent-head")) {
      head.click();
    }
    const childReqs = (): number =>
      posted.filter((m) => m.type === "requestVaultSessionDetail" && m.entryId === "opencode:ses_dup").length;
    expect(childReqs()).toBe(1);
    // A load-more rebuild re-renders both blocks; each keeps its own expansion and
    // re-attaches to the SAME pending id (no second request — already in flight).
    host.querySelector<HTMLButtonElement>(".vault-preview-loadmore")?.click();
    panel.handleSessionDetailResponse({ type: "vaultSessionDetailResponse", entryId: "opencode:a", detail: dup() });
    expect(childReqs()).toBe(1);

    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:ses_dup",
      requestId: nestedRequestId(posted, "opencode:ses_dup"),
      detail: detail({ entryId: "opencode:ses_dup", timeline: [{ kind: "message", role: "user", text: "DUP-CHILD" }] }),
    });
    // Both visible blocks resolve — the earlier one is no longer stuck loading.
    const bodies = Array.from(host.querySelectorAll(".vault-preview-subagent-body"));
    expect(bodies).toHaveLength(2);
    for (const b of bodies) {
      expect(b.textContent).toContain("DUP-CHILD");
    }
  });

  it("does not stack-overflow on a self-referential nested detail (cycle guard)", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "opencode:a", agent: "opencode" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:a",
      detail: detail({
        entryId: "opencode:a",
        timeline: [{ kind: "subagentSession", entryId: "opencode:ses_self", title: "Sub", firstMessage: "p" }],
      }),
    });
    host.querySelector<HTMLButtonElement>(".vault-preview-subagent-head")?.click();
    // The child transcript nests its OWN entryId while expanded — without the guard
    // the synchronous cached re-render recurses until the stack overflows.
    expect(() =>
      panel.handleSessionDetailResponse({
        type: "vaultSessionDetailResponse",
        entryId: "opencode:ses_self",
        requestId: nestedRequestId(posted, "opencode:ses_self"),
        detail: detail({
          entryId: "opencode:ses_self",
          timeline: [
            { kind: "message", role: "user", text: "SELF" },
            { kind: "subagentSession", entryId: "opencode:ses_self", title: "Sub", firstMessage: "p" },
          ],
        }),
      }),
    ).not.toThrow();
    expect(host.querySelector(".vault-preview-subagent-body")?.textContent).toContain("SELF");
  });

  it("gives nested + run controls accessible titles/labels (group subagent had none)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "opencode:a", agent: "opencode" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:a",
      detail: detail({
        entryId: "opencode:a",
        // Group node (no `agent`) — previously had no accessible name.
        timeline: [{ kind: "subagentSession", entryId: "opencode:ses_grp", title: "Workflow run", firstMessage: "go" }],
      }),
    });
    const head = host.querySelector<HTMLButtonElement>(".vault-preview-subagent-head");
    expect(head?.getAttribute("aria-label")).toBe("Nested session: Workflow run");
    expect(head?.title).toBe("Toggle Workflow run");
  });

  it("keeps a nested run's expansion when the ROOT loads older messages", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null; limit?: number }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "opencode:a", agent: "opencode" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    // Root is truncated (older messages available) and holds a subagent node.
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:a",
      detail: detail({
        truncated: true,
        timeline: [{ kind: "subagentSession", entryId: "opencode:ses_kid", title: "Sub", firstMessage: "p" }],
      }),
    });
    // Expand the subagent and deliver a child transcript with a capped run.
    host.querySelector<HTMLButtonElement>(".vault-preview-subagent-head")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:ses_kid",
      requestId: nestedRequestId(posted, "opencode:ses_kid"),
      detail: detail({
        entryId: "opencode:ses_kid",
        timeline: [
          { kind: "message", role: "user", text: "child" },
          { kind: "thinking", text: "t" },
          { kind: "tool", tool: "Bash", detail: "s1" },
          { kind: "tool", tool: "Bash", detail: "s2" },
          { kind: "tool", tool: "Bash", detail: "s3" },
          { kind: "message", role: "assistant", text: "done" },
        ],
      }),
    });
    // Expand the nested run → all 3 child tools visible, no nested expand button.
    host.querySelector<HTMLButtonElement>(".vault-preview-subagent-body .vault-preview-expand")?.click();
    expect(host.querySelectorAll(".vault-preview-subagent-body .vault-preview-message-tool")).toHaveLength(3);
    // Now the ROOT loads older messages (prepends to the root timeline only).
    host.querySelector<HTMLButtonElement>(".vault-preview-loadmore")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:a",
      detail: detail({
        truncated: false,
        timeline: [
          { kind: "message", role: "user", text: "older root msg" },
          { kind: "subagentSession", entryId: "opencode:ses_kid", title: "Sub", firstMessage: "p" },
        ],
      }),
    });
    // The nested run stays expanded — only root-prefixed run keys are cleared.
    expect(host.querySelectorAll(".vault-preview-subagent-body .vault-preview-message-tool")).toHaveLength(3);
    expect(host.querySelector(".vault-preview-subagent-body .vault-preview-expand")).toBeNull();
  });

  it("collapsing a subagent block clears its nested body", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "opencode:a", agent: "opencode" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:a",
      detail: detail({
        entryId: "opencode:a",
        timeline: [{ kind: "subagentSession", entryId: "opencode:ses_kid", title: "Sub" }],
      }),
    });
    const head = () => host.querySelector<HTMLButtonElement>(".vault-preview-subagent-head");
    head()?.click(); // expand
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:ses_kid",
      requestId: nestedRequestId(posted, "opencode:ses_kid"),
      detail: detail({ entryId: "opencode:ses_kid", timeline: [{ kind: "message", role: "user", text: "hi" }] }),
    });
    expect(host.querySelector(".vault-preview-subagent-body .vault-preview-message")).not.toBeNull();
    head()?.click(); // collapse
    expect(host.querySelector(".vault-preview-subagent")?.classList.contains("is-open")).toBe(false);
    expect(host.querySelector(".vault-preview-subagent-body .vault-preview-message")).toBeNull();
  });

  it("collapsing mid-load drops the pending request so a late response can't populate the hidden body (R4)", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "opencode:a", agent: "opencode" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:a",
      detail: detail({
        entryId: "opencode:a",
        timeline: [{ kind: "subagentSession", entryId: "opencode:ses_kid", title: "Sub" }],
      }),
    });
    const head = () => host.querySelector<HTMLButtonElement>(".vault-preview-subagent-head");
    head()?.click(); // expand → request in flight (no response yet)
    head()?.click(); // collapse BEFORE the response arrives
    // A late nested response must be ignored — the body stays empty, not rehydrated.
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:ses_kid",
      requestId: nestedRequestId(posted, "opencode:ses_kid"),
      detail: detail({ entryId: "opencode:ses_kid", timeline: [{ kind: "message", role: "user", text: "late" }] }),
    });
    expect(host.querySelector(".vault-preview-subagent-body .vault-preview-message")).toBeNull();
  });

  it("nests multiple tiers: a child's own subagentSession renders as a further block", () => {
    const host = createHost();
    const posted: { type: string; entryId?: string | null }[] = [];
    const panel = new VaultPanel({ host, postMessage: (m) => posted.push(m), getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "opencode:a", agent: "opencode" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:a",
      detail: detail({
        entryId: "opencode:a",
        timeline: [{ kind: "subagentSession", entryId: "opencode:ses_kid", title: "Parent sub" }],
      }),
    });
    host.querySelector<HTMLButtonElement>(".vault-preview-subagent-head")?.click();
    // The child itself contains a grandchild sub-session.
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "opencode:ses_kid",
      requestId: nestedRequestId(posted, "opencode:ses_kid"),
      detail: detail({
        entryId: "opencode:ses_kid",
        timeline: [{ kind: "subagentSession", entryId: "opencode:ses_grandkid", title: "Grandchild sub" }],
      }),
    });
    // Two subagent blocks now exist (parent + nested grandchild).
    expect(host.querySelectorAll(".vault-preview-subagent").length).toBeGreaterThanOrEqual(2);
    expect(host.querySelector(".vault-preview-subagent-body .vault-preview-subagent")).not.toBeNull();
  });
});

describe("VaultPanel 'This folder only' filter", () => {
  it("shows all entries when the filter is off", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {} });
    panel.render(result([entry({ id: "a", cwd: "/work/repo" }), entry({ id: "b", cwd: "/other/proj" })]));
    expect(host.querySelectorAll(".vault-row")).toHaveLength(2);
  });

  it("scopes to the active pane's folder subtree when on", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {} });
    panel.render(
      result([
        entry({ id: "a", cwd: "/work/repo" }),
        entry({ id: "b", cwd: "/work/repo/src" }),
        entry({ id: "c", cwd: "/other/proj" }),
      ]),
    );

    panel.setContextCwd("/work/repo");
    panel.setFolderOnly(true);
    // /work/repo (equal) + /work/repo/src (inside) match; /other/proj does not.
    expect(host.querySelectorAll(".vault-row")).toHaveLength(2);

    panel.setFolderOnly(false);
    expect(host.querySelectorAll(".vault-row")).toHaveLength(3);
  });

  it("re-filters when the active pane cwd changes", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialFolderOnly: () => true });
    panel.render(result([entry({ id: "a", cwd: "/work/repo" }), entry({ id: "b", cwd: "/other" })]));

    panel.setContextCwd("/work/repo");
    expect(host.querySelectorAll(".vault-row")).toHaveLength(1);
    panel.setContextCwd("/other");
    expect(host.querySelectorAll(".vault-row")).toHaveLength(1);
    // No cwd → can't scope → show all.
    panel.setContextCwd(null);
    expect(host.querySelectorAll(".vault-row")).toHaveLength(2);
  });

  it("matches descendants of a trailing-slash parent without the sibling-prefix trap", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {} });
    panel.render(
      result([
        entry({ id: "a", cwd: "/work/repo" }),
        entry({ id: "b", cwd: "/work/repo/src" }),
        entry({ id: "c", cwd: "/work/repository" }), // sibling-prefix — must NOT match
      ]),
    );

    panel.setContextCwd("/work/repo/");
    panel.setFolderOnly(true);
    expect(host.querySelectorAll(".vault-row")).toHaveLength(2);
  });

  it("treats a root cwd ('/') as containing every absolute session path", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialFolderOnly: () => true });
    panel.render(result([entry({ id: "a", cwd: "/work/repo" }), entry({ id: "b", cwd: "/other" })]));

    panel.setContextCwd("/");
    expect(host.querySelectorAll(".vault-row")).toHaveLength(2);
  });

  it("pulls the live context cwd via getContextCwd on render (not just pushed setContextCwd)", () => {
    const host = createHost();
    let cwd: string | null = null; // OSC 7 hasn't fired yet
    const panel = new VaultPanel({
      host,
      postMessage: () => {},
      getInitialFolderOnly: () => true,
      getContextCwd: () => cwd,
    });

    const data = result([entry({ id: "a", cwd: "/work/repo" }), entry({ id: "b", cwd: "/other" })]);
    panel.render(data);
    // No cwd resolvable → filter falls through to show all (the old no-op bug).
    expect(host.querySelectorAll(".vault-row")).toHaveLength(2);

    // OSC 7 lands; the next render pulls the live value and scopes the list —
    // without any explicit setContextCwd push.
    cwd = "/work/repo";
    panel.render(data);
    expect(host.querySelectorAll(".vault-row")).toHaveLength(1);
  });

  it("seeds + persists the folder-only toggle", () => {
    const host = createHost();
    const persisted: boolean[] = [];
    const panel = new VaultPanel({
      host,
      postMessage: () => {},
      getInitialFolderOnly: () => true,
      persistFolderOnly: (v) => persisted.push(v),
    });
    const toggle = host.querySelector(".vault-folder-toggle");
    const checkbox = host.querySelector<HTMLInputElement>(".vault-folder-toggle-cb");
    expect(checkbox?.checked).toBe(true);
    expect(toggle?.classList.contains("is-active")).toBe(true);
    expect(persisted).toEqual([]); // seed does not persist

    panel.toggleFolderOnly();
    panel.toggleFolderOnly();
    expect(persisted).toEqual([false, true]);
  });

  it("no-op render guard: an identical refresh response does NOT rebuild the rows", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {} });
    // Pin `modified` so the two payloads are value-identical (entry() defaults it
    // to Date.now(), which would otherwise drift between the two builds).
    panel.render(result([entry({ id: "a", modified: 1 }), entry({ id: "b", modified: 2 })]));
    const firstRow = host.querySelector(".vault-row");
    // The cache→fresh no-op case: same entries → preserve the existing DOM nodes
    // (so an open preview / scroll survives).
    panel.render(result([entry({ id: "a", modified: 1 }), entry({ id: "b", modified: 2 })]));
    expect(host.querySelector(".vault-row")).toBe(firstRow);
  });

  it("no-op render guard: a changed entry DOES rebuild", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {} });
    panel.render(result([entry({ id: "a", modified: 1, title: "old" })]));
    const firstRow = host.querySelector(".vault-row");
    panel.render(result([entry({ id: "a", modified: 1, title: "new" })]));
    expect(host.querySelector(".vault-row")).not.toBe(firstRow);
  });

  it("no-op render guard: a local UI render updates the key so a later identical host response no-ops", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getContextCwd: () => "/work" });
    const data = result([entry({ id: "a", cwd: "/work" }), entry({ id: "b", cwd: "/other" })]);
    panel.render(data);
    // Local UI change (folder filter) renders directly; DOM now scoped to 1 row.
    panel.toggleFolderOnly();
    expect(host.querySelectorAll(".vault-row")).toHaveLength(1);
    const scopedRow = host.querySelector(".vault-row");
    // An identical host refresh must not rebuild — the guard tracks the DOM, not
    // just the last host response (avoids churn that would disturb scroll/preview).
    panel.render(data);
    expect(host.querySelector(".vault-row")).toBe(scopedRow);
  });

  it("exposes the filter state via isFolderOnly (gates the host cwd re-probe)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {} });
    expect(panel.isFolderOnly()).toBe(false);
    panel.setFolderOnly(true);
    expect(panel.isFolderOnly()).toBe(true);
    panel.setFolderOnly(false);
    expect(panel.isFolderOnly()).toBe(false);
  });
});

describe("VaultPanel refresh button", () => {
  function refreshCount(posted: Array<{ type: string }>): number {
    return posted.filter((m) => m.type === "requestVaultSessions").length;
  }

  it("posts a refresh on click WITHOUT toggling collapse, spins, and the fresh response clears it", () => {
    const host = createHost();
    const posted: Array<{ type: string }> = [];
    const panel = new VaultPanel({
      host,
      postMessage: (m) => posted.push(m as { type: string }),
      getInitialCollapsed: () => false,
    });
    const btn = host.querySelector<HTMLButtonElement>(".vault-header__refresh-btn");
    expect(btn).not.toBeNull();

    const before = refreshCount(posted);
    btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Exactly one refresh request, and the click did NOT collapse the section.
    expect(refreshCount(posted) - before).toBe(1);
    expect(panel.isCollapsed()).toBe(false);
    expect(btn?.classList.contains("is-refreshing")).toBe(true);

    // The authoritative (non-cache) response completes the refresh → spin stops.
    panel.render(result([entry()]), false);
    expect(btn?.classList.contains("is-refreshing")).toBe(false);
  });

  it("keeps spinning on the instant cache echo, stops only on the fresh response", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    const btn = host.querySelector<HTMLButtonElement>(".vault-header__refresh-btn");
    btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(btn?.classList.contains("is-refreshing")).toBe(true);

    panel.render(result([entry()]), true); // cached echo must NOT stop the spinner
    expect(btn?.classList.contains("is-refreshing")).toBe(true);

    panel.render(result([entry()]), false); // fresh response stops it (also clears the timer)
    expect(btn?.classList.contains("is-refreshing")).toBe(false);
  });
});

describe("VaultPanel header tooltips", () => {
  it("attaches custom tooltips to search + refresh: strips native title, sets aria-describedby", () => {
    const host = createHost();
    new VaultPanel({ host, postMessage: () => {} });
    const searchBtn = host.querySelector<HTMLButtonElement>(".vault-header__search-btn");
    const refreshBtn = host.querySelector<HTMLButtonElement>(".vault-header__refresh-btn");
    // Native `title` is unreliable in VSCode webviews → stripped in favor of the
    // shared custom-tooltip widget, referenced via aria-describedby (WCAG).
    expect(searchBtn?.hasAttribute("title")).toBe(false);
    expect(refreshBtn?.hasAttribute("title")).toBe(false);
    expect(searchBtn?.getAttribute("aria-describedby")).toBe("webview-tooltip-widget");
    expect(refreshBtn?.getAttribute("aria-describedby")).toBe("webview-tooltip-widget");
  });

  it("preview header icon buttons use the custom tooltip (no slow native title)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click(); // opens the preview (header built)
    const close = host.querySelector<HTMLButtonElement>(".vault-preview-close");
    const max = host.querySelector<HTMLButtonElement>(".vault-preview-maximize");
    expect(close?.hasAttribute("title")).toBe(false);
    expect(close?.getAttribute("aria-describedby")).toBe("webview-tooltip-widget");
    expect(max?.hasAttribute("title")).toBe(false);
    expect(max?.getAttribute("aria-describedby")).toBe("webview-tooltip-widget");
    // Toggling maximize must NOT reintroduce a native title — getText drives the
    // stateful label, so the in-place button mutation never re-sets `.title`.
    max?.click();
    expect(host.querySelector<HTMLButtonElement>(".vault-preview-maximize")?.hasAttribute("title")).toBe(false);
  });

  it("opening search does not re-introduce a native title (dynamic getText drives the hint)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    const searchBtn = host.querySelector<HTMLButtonElement>(".vault-header__search-btn");
    searchBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true })); // enter search
    expect(panel.isCollapsed()).toBe(false);
    expect(searchBtn?.getAttribute("aria-label")).toBe("Close search");
    expect(searchBtn?.hasAttribute("title")).toBe(false); // no native tooltip resurrected
  });
});

describe("VaultPanel session-preview geometry persistence", () => {
  /** Make getBoundingClientRect reflect the element's inline left/top/width/height
   *  (jsdom computes no layout) so capture-on-drag sees the dragged position. */
  function rectFromStyle(el: HTMLElement, fallback: { left: number; top: number; width: number; height: number }) {
    Object.defineProperty(el, "getBoundingClientRect", {
      configurable: true,
      value: () => {
        const num = (v: string, d: number) => {
          const n = Number.parseFloat(v);
          return Number.isFinite(n) ? n : d;
        };
        const left = num(el.style.left, fallback.left);
        const top = num(el.style.top, fallback.top);
        const width = num(el.style.width, fallback.width);
        const height = num(el.style.height, fallback.height);
        return {
          left,
          top,
          width,
          height,
          right: left + width,
          bottom: top + height,
          x: left,
          y: top,
          toJSON: () => ({}),
        };
      },
    });
  }

  function openPreview(host: HTMLElement): HTMLElement {
    host.querySelector<HTMLElement>(".vault-row")?.click();
    return host.querySelector<HTMLElement>(".vault-preview") as HTMLElement;
  }

  it("restores seeded geometry (clamped) onto the preview when opened", () => {
    const host = createHost();
    const panel = new VaultPanel({
      host,
      postMessage: () => {},
      getInitialCollapsed: () => false,
      getInitialPreviewGeometry: () => ({ top: 50, left: 100, width: 600, height: 400 }),
    });
    panel.render(result([entry({ id: "claude:a" })]));
    const preview = openPreview(host);
    expect(preview.style.left).toBe("100px");
    expect(preview.style.top).toBe("50px");
    expect(preview.style.width).toBe("600px");
    expect(preview.style.height).toBe("400px");
    // Not maximized (no flag) → no full-viewport class.
    expect(preview.classList.contains("vault-preview--max")).toBe(false);
  });

  it("restores the maximized state from seeded geometry", () => {
    const host = createHost();
    const panel = new VaultPanel({
      host,
      postMessage: () => {},
      getInitialCollapsed: () => false,
      getInitialPreviewGeometry: () => ({ top: 50, left: 100, width: 600, height: 400, maximized: true }),
    });
    panel.render(result([entry({ id: "claude:a" })]));
    const preview = openPreview(host);
    expect(preview.classList.contains("vault-preview--max")).toBe(true);
  });

  it("persists the new position after dragging the header", () => {
    const host = createHost();
    const persisted: import("../state/WebviewState").VaultPreviewGeometry[] = [];
    const panel = new VaultPanel({
      host,
      postMessage: () => {},
      getInitialCollapsed: () => false,
      getInitialPreviewGeometry: () => ({ top: 50, left: 100, width: 600, height: 400 }),
      persistPreviewGeometry: (g) => persisted.push(g),
    });
    panel.render(result([entry({ id: "claude:a" })]));
    const preview = openPreview(host);
    rectFromStyle(preview, { left: 100, top: 50, width: 600, height: 400 });
    const titleRow = preview.querySelector<HTMLElement>(".vault-preview-title-row") as HTMLElement;

    titleRow.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 200, clientY: 200 }),
    );
    document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 230, clientY: 240 }));
    document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));

    // left 100→130 (+30), top 50→90 (+40); size unchanged.
    expect(persisted.at(-1)).toEqual({ top: 90, left: 130, width: 600, height: 400, maximized: false });
  });

  it("does not persist on a plain header click (no drag movement)", () => {
    const host = createHost();
    const persisted: import("../state/WebviewState").VaultPreviewGeometry[] = [];
    const panel = new VaultPanel({
      host,
      postMessage: () => {},
      getInitialCollapsed: () => false,
      getInitialPreviewGeometry: () => ({ top: 50, left: 100, width: 600, height: 400 }),
      persistPreviewGeometry: (g) => persisted.push(g),
    });
    panel.render(result([entry({ id: "claude:a" })]));
    const preview = openPreview(host);
    rectFromStyle(preview, { left: 100, top: 50, width: 600, height: 400 });
    const titleRow = preview.querySelector<HTMLElement>(".vault-preview-title-row") as HTMLElement;

    titleRow.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 200, clientY: 200 }),
    );
    document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
    expect(persisted).toHaveLength(0);
  });

  it("starts a move when dragging the header padding, not just the title", () => {
    const host = createHost();
    const persisted: import("../state/WebviewState").VaultPreviewGeometry[] = [];
    const panel = new VaultPanel({
      host,
      postMessage: () => {},
      getInitialCollapsed: () => false,
      getInitialPreviewGeometry: () => ({ top: 50, left: 100, width: 600, height: 400 }),
      persistPreviewGeometry: (g) => persisted.push(g),
    });
    panel.render(result([entry({ id: "claude:a" })]));
    const preview = openPreview(host);
    rectFromStyle(preview, { left: 100, top: 50, width: 600, height: 400 });
    // Press the header itself (the padding area), not the inner title row.
    const header = preview.querySelector<HTMLElement>(".vault-preview-header") as HTMLElement;
    header.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 200, clientY: 200 }),
    );
    document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 230, clientY: 240 }));
    document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
    expect(persisted.at(-1)).toEqual({ top: 90, left: 130, width: 600, height: 400, maximized: false });
  });

  it("does not start a move when pressing the meta block (keeps it selectable)", () => {
    const host = createHost();
    const persisted: import("../state/WebviewState").VaultPreviewGeometry[] = [];
    const panel = new VaultPanel({
      host,
      postMessage: () => {},
      getInitialCollapsed: () => false,
      getInitialPreviewGeometry: () => ({ top: 50, left: 100, width: 600, height: 400 }),
      persistPreviewGeometry: (g) => persisted.push(g),
    });
    panel.render(result([entry({ id: "claude:a" })]));
    const preview = openPreview(host);
    rectFromStyle(preview, { left: 100, top: 50, width: 600, height: 400 });
    const meta = preview.querySelector<HTMLElement>(".vault-preview-meta") as HTMLElement;
    meta.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 200, clientY: 200 }),
    );
    document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 230, clientY: 240 }));
    document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
    expect(persisted).toHaveLength(0);
    expect(preview.style.left).toBe("100px");
  });

  it("ignores a second pointer mid-drag so it can't hijack the move", () => {
    const host = createHost();
    const persisted: import("../state/WebviewState").VaultPreviewGeometry[] = [];
    const panel = new VaultPanel({
      host,
      postMessage: () => {},
      getInitialCollapsed: () => false,
      getInitialPreviewGeometry: () => ({ top: 50, left: 100, width: 600, height: 400 }),
      persistPreviewGeometry: (g) => persisted.push(g),
    });
    panel.render(result([entry({ id: "claude:a" })]));
    const preview = openPreview(host);
    rectFromStyle(preview, { left: 100, top: 50, width: 600, height: 400 });
    const titleRow = preview.querySelector<HTMLElement>(".vault-preview-title-row") as HTMLElement;

    titleRow.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 200, clientY: 200 }),
    );
    // A foreign pointer (id 2) moving across the document must not drive this drag.
    document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 2, clientX: 400, clientY: 400 }));
    expect(preview.style.left).toBe("100px");
    expect(preview.style.top).toBe("50px");
    // The owning pointer (id 1) still drives it; release commits the new position.
    document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 230, clientY: 240 }));
    document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
    expect(persisted.at(-1)).toEqual({ top: 90, left: 130, width: 600, height: 400, maximized: false });
  });
});

describe("VaultPanel dispose", () => {
  it("closes an open preview via the dispose chain", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();
    expect(host.querySelector(".vault-preview.is-open")).not.toBeNull();
    panel.dispose();
    expect(host.querySelector(".vault-preview.is-open")).toBeNull();
  });

  it("tears down the open context menu and is idempotent + inert afterwards", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host
      .querySelector<HTMLElement>(".vault-row")
      ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    expect(host.querySelector(".vault-context-menu")).not.toBeNull();
    panel.dispose();
    expect(host.querySelector(".vault-context-menu")).toBeNull();
    // A second dispose + stray document events must not throw (listeners detached).
    expect(() => {
      panel.dispose();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    }).not.toThrow();
  });
});

describe("VaultPanel fresh-update flash", () => {
  function mkDetail(over: Partial<import("../../vault/types").VaultSessionDetail> = {}) {
    return {
      entryId: "claude:a",
      recentActivity: [],
      timeline: [],
      stats: { messageCount: 0, toolCount: 0, subagentCount: 0 },
      ...over,
    } as import("../../vault/types").VaultSessionDetail;
  }

  it("does not flash any row on the first paint", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {} });
    panel.render(
      result([entry({ id: "claude:a", modified: 1000 }), entry({ id: "codex:b", agent: "codex", modified: 1000 })]),
    );
    expect(host.querySelectorAll(".vault-row.is-fresh")).toHaveLength(0);
  });

  it("flashes only the row whose modified increased on a later render", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {} });
    panel.render(
      result([entry({ id: "claude:a", modified: 1000 }), entry({ id: "codex:b", agent: "codex", modified: 1000 })]),
    );
    // b's transcript grew; a is untouched.
    panel.render(
      result([entry({ id: "claude:a", modified: 1000 }), entry({ id: "codex:b", agent: "codex", modified: 2000 })]),
    );
    const fresh = Array.from(host.querySelectorAll<HTMLElement>(".vault-row.is-fresh"));
    expect(fresh.map((r) => r.dataset.entryId)).toEqual(["codex:b"]);
    // The flash overlay is tinted with the agent's accent (closed set → CSS var).
    expect(fresh[0].style.getPropertyValue("--_accent")).toContain("vault-accent-codex");
  });

  it("flashes a newly appeared session row", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {} });
    panel.render(result([entry({ id: "claude:a", modified: 1000 })]));
    panel.render(
      result([entry({ id: "claude:a", modified: 1000 }), entry({ id: "codex:b", agent: "codex", modified: 1500 })]),
    );
    const fresh = Array.from(host.querySelectorAll<HTMLElement>(".vault-row.is-fresh"));
    expect(fresh.map((r) => r.dataset.entryId)).toEqual(["codex:b"]);
  });

  it("does not re-flash rows on a local re-render (group-mode change, no data change)", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {} });
    panel.render(result([entry({ id: "claude:a", modified: 1000 })]));
    panel.render(result([entry({ id: "claude:a", modified: 2000 })])); // a real update → flashes
    expect(host.querySelectorAll(".vault-row.is-fresh")).toHaveLength(1);
    panel.setGroupMode("agent"); // local rebuild, no new data
    expect(host.querySelectorAll(".vault-row.is-fresh")).toHaveLength(0);
  });

  it("flashes the newest message on a live-follow update, but not on the initial detail", () => {
    const host = createHost();
    const panel = new VaultPanel({ host, postMessage: () => {}, getInitialCollapsed: () => false });
    panel.render(result([entry({ id: "claude:a" })]));
    host.querySelector<HTMLElement>(".vault-row")?.click();

    // Initial detail render must NOT flash — it isn't a "new chat arrived" event.
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      detail: mkDetail({
        timeline: [
          { kind: "message", role: "user", text: "go", timestamp: 1 },
          { kind: "message", role: "assistant", text: "first reply", timestamp: 2 },
        ],
      }),
    });
    expect(host.querySelectorAll(".vault-preview-message.is-fresh")).toHaveLength(0);

    // A live-follow push appends a new assistant message → only its bubble flashes.
    panel.handleSessionDetailResponse({
      type: "vaultSessionDetailResponse",
      entryId: "claude:a",
      followUpdate: true,
      detail: mkDetail({
        timeline: [
          { kind: "message", role: "user", text: "go", timestamp: 1 },
          { kind: "message", role: "assistant", text: "first reply", timestamp: 2 },
          { kind: "message", role: "assistant", text: "second reply", timestamp: 3 },
        ],
      }),
    });
    const flashed = Array.from(host.querySelectorAll<HTMLElement>(".vault-preview-message.is-fresh"));
    expect(flashed).toHaveLength(1);
    expect(flashed[0].textContent).toContain("second reply");
  });
});
