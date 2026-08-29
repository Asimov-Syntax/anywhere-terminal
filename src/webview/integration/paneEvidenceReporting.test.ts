// @vitest-environment jsdom
// src/webview/integration/paneEvidenceReporting.test.ts — Pane evidence, end to
// end inside the webview: the factory's title hook and the activity tracker's
// waiting hook both reach the host as `paneEvidence` messages.
//
// Wiring is the thing under test. A reporter unit test proves the gate and
// nothing about whether anyone calls it — and every pane class (root tab, split
// child, restored session, editor panel) reaches the host through the factory's
// single title site, so a broken hook there is silent.
//
// See: asimov/changes/add-host-pane-evidence/design.md D7.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DescendantsOutcome, ProcessTableSnapshot } from "../../pty/processTableSnapshot";
import { createPaneEvidenceStore } from "../../session/PaneEvidenceStore";
import type { PaneEvidenceMessage } from "../../types/messages";
import type { RunningSessionsOutcome } from "../../vault/readers/runningSessions";
import { createPresenceProjectorDeps } from "../../worktree/presenceDeps";
import { createPresenceProjector } from "../../worktree/presenceProjector";
import { createPaneEvidenceReporter } from "../terminal/paneEvidenceReporter";
import { TerminalActivityTracker } from "../terminal/TerminalActivityTracker";
import { TerminalFactory } from "../terminal/TerminalFactory";
import { ICON_TERMINAL } from "../vault/icons";
import { presentedActivity } from "../worktree/worktreeFormat";
import { renderAgentRow } from "../worktree/worktreeTreeView";
import type { WorktreeAgentRow } from "../worktree/worktreeViewTypes";

// ─── xterm stand-in ─────────────────────────────────────────────────
//
// Hoisted with the mock factory: `vi.mock` runs before module-level code, so a
// plain `class` declared below would not exist yet when the factory is invoked.

const xterm = vi.hoisted(() => {
  const titleListeners = new Map<object, (title: string) => void>();

  class FakeTerminal {
    element = document.createElement("div");
    options: Record<string, unknown> = {};
    rows = 24;
    cols = 80;
    buffer = { active: { cursorY: 0, length: 0, getLine: () => undefined, viewportY: 0 } };
    parser = { registerOscHandler: () => ({ dispose: () => {} }) };
    loadAddon = () => {};
    open = () => {};
    focus = () => {};
    resize = () => {};
    write = () => {};
    dispose = () => {};
    attachCustomKeyEventHandler = () => {};
    registerLinkProvider = () => ({ dispose: () => {} });
    onData = () => ({ dispose: () => {} });
    onResize = () => ({ dispose: () => {} });
    onTitleChange = (listener: (title: string) => void) => {
      titleListeners.set(this, listener);
      return { dispose: () => {} };
    };
  }

  return { FakeTerminal, titleListeners };
});

vi.mock("@xterm/xterm", () => ({ Terminal: xterm.FakeTerminal }));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    dispose() {}
  },
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss() {}
    dispose() {}
  },
}));

// ─── Harness ────────────────────────────────────────────────────────

/** Wire the reporter, tracker, and factory exactly the way main.ts does. */
function wireSurface() {
  const posted: PaneEvidenceMessage[] = [];
  const reporter = createPaneEvidenceReporter((msg) => posted.push(msg));

  const terminals = new Map<string, { exited: boolean; activityStatus: "idle" | "running" | "waiting" }>();
  const tracker = new TerminalActivityTracker({
    getTerminal: (sessionId) => terminals.get(sessionId),
    onStatusChange: () => {},
    onWaitingChange: (sessionId, waiting) => reporter.reportWaiting(sessionId, waiting),
    idleDelayMs: 100,
  });

  const store = {
    terminals: new Map(),
    tabLayouts: new Map(),
    tabActivePaneIds: new Map(),
    activeTabId: null,
    currentConfig: undefined,
    persist: vi.fn(),
  };
  const factory = new TerminalFactory({
    themeManager: { getTheme: () => ({}), getMinimumContrastRatio: () => 1, kind: "dark" } as any,
    store: store as any,
    postMessage: vi.fn(),
    onTabBarUpdate: vi.fn(),
    getIsComposing: () => false,
    getHoverPreviewTheme: () => "dark",
    getHoverPreviewSettings: () => ({ delay: 300, blockSensitive: true }),
    onTitleEvidence: (sessionId, rawTitle) => {
      reporter.reportTitle(sessionId, rawTitle);
      tracker.setTitle(sessionId, rawTitle);
    },
  });

  function emitTitle(instance: { terminal: unknown }, title: string): void {
    const listener = xterm.titleListeners.get(instance.terminal as object);
    if (!listener) {
      throw new Error("factory never registered an onTitleChange listener");
    }
    listener(title);
  }

  return { posted, reporter, tracker, terminals, factory, emitTitle };
}

const CONFIG = { fontSize: 14, fontFamily: "monospace", cursorBlink: false, scrollback: 1000 };

beforeEach(() => {
  // The factory mounts every terminal into the webview's single container.
  document.body.innerHTML = '<div id="terminal-container"></div>';
});

afterEach(() => {
  xterm.titleListeners.clear();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────

describe("title evidence reaches the host through the factory", () => {
  it("reports a real title change once", () => {
    const { posted, factory, emitTitle } = wireSurface();
    const instance = factory.createTerminal("pane-1", "Terminal 1", CONFIG as any, false, null);

    emitTitle(instance, "Fix tests");

    expect(posted).toEqual([{ type: "paneEvidence", paneId: "pane-1", title: "Fix tests", decorated: false }]);
  });

  it("[I9] sends nothing for a spinner frame advancing behind an unchanged title", () => {
    const { posted, factory, emitTitle } = wireSurface();
    const instance = factory.createTerminal("pane-1", "Terminal 1", CONFIG as any, false, null);

    emitTitle(instance, "⠋ Fix tests");
    posted.length = 0;
    emitTitle(instance, "⠙ Fix tests");
    emitTitle(instance, "⠹ Fix tests");

    expect(posted).toEqual([]);
  });

  // Round-4, specialist-direct: the [I9] tag sat only on the "sends nothing" half. A
  // regression that dropped the FINAL transition, or sent the decorated title, left every
  // tagged assertion green — so the tag claimed more than its test proved.
  it("[I9] reports the spinner stopping, which the signature alone would hide", () => {
    const { posted, factory, emitTitle } = wireSurface();
    const instance = factory.createTerminal("pane-1", "Terminal 1", CONFIG as any, false, null);

    emitTitle(instance, "⠙ Fix tests");
    posted.length = 0;
    emitTitle(instance, "Fix tests");

    expect(posted).toEqual([{ type: "paneEvidence", paneId: "pane-1", title: "Fix tests", decorated: false }]);
    // The stripped title is what reaches comparison and render: a report still carrying its
    // spinner would make every later frame look like a new title.
    expect(posted[0]).toMatchObject({ title: "Fix tests", decorated: false });
    expect(String((posted[0] as { title: string }).title)).not.toMatch(/[⠋⠙⠹]/);
  });

  it("never states waiting on a title report", () => {
    const { posted, factory, emitTitle } = wireSurface();
    const instance = factory.createTerminal("pane-1", "Terminal 1", CONFIG as any, false, null);

    emitTitle(instance, "Fix tests");

    expect(posted[0]).not.toHaveProperty("waiting");
  });

  it("keeps two panes' evidence apart", () => {
    const { posted, factory, emitTitle } = wireSurface();
    const a = factory.createTerminal("pane-a", "Terminal 1", CONFIG as any, false, null);
    const b = factory.createTerminal("pane-b", "Terminal 2", CONFIG as any, false, null);

    emitTitle(a, "Fix tests");
    emitTitle(b, "Fix tests");

    expect(posted.map((m) => m.paneId)).toEqual(["pane-a", "pane-b"]);
  });
});

describe("waiting evidence reaches the host through the tracker", () => {
  it("reports a waiting flip without restating the title", () => {
    const { posted, tracker, terminals } = wireSurface();
    terminals.set("pane-1", { exited: false, activityStatus: "idle" });

    tracker.setWaiting("pane-1", true);

    expect(posted).toEqual([{ type: "paneEvidence", paneId: "pane-1", waiting: true }]);
  });

  it("stays silent for a pane that has never waited", () => {
    const { posted, tracker, terminals } = wireSurface();
    terminals.set("pane-1", { exited: false, activityStatus: "idle" });

    tracker.markOutput("pane-1");
    tracker.setWaiting("pane-1", false);

    expect(posted).toEqual([]);
  });

  it("interleaves title and waiting evidence without either overwriting the other", () => {
    const { posted, tracker, terminals, factory, emitTitle } = wireSurface();
    terminals.set("pane-1", { exited: false, activityStatus: "idle" });
    const instance = factory.createTerminal("pane-1", "Terminal 1", CONFIG as any, false, null);

    emitTitle(instance, "Fix tests");
    tracker.setWaiting("pane-1", true);
    emitTitle(instance, "Run build");

    expect(posted).toEqual([
      { type: "paneEvidence", paneId: "pane-1", title: "Fix tests", decorated: false },
      { type: "paneEvidence", paneId: "pane-1", waiting: true },
      { type: "paneEvidence", paneId: "pane-1", title: "Run build", decorated: false },
    ]);
  });
});

describe("forget drops local dedup state only", () => {
  it("lets an unchanged title be reported again after the pane is forgotten", () => {
    const { posted, reporter, factory, emitTitle } = wireSurface();
    const instance = factory.createTerminal("pane-1", "Terminal 1", CONFIG as any, false, null);

    emitTitle(instance, "Fix tests");
    emitTitle(instance, "Fix tests");
    expect(posted).toHaveLength(1);

    reporter.forget("pane-1");
    emitTitle(instance, "Fix tests");
    expect(posted).toHaveLength(2);
  });

  it("sends no retraction when a pane is forgotten", () => {
    const { posted, reporter, tracker, terminals } = wireSurface();
    terminals.set("pane-1", { exited: false, activityStatus: "idle" });
    tracker.setWaiting("pane-1", true);
    posted.length = 0;

    reporter.forget("pane-1");

    expect(posted).toEqual([]);
  });
});

// ─── WT-004.1 — one title, one activity on both sides ───────────────

describe("the tab and the worktree row cannot disagree about a pane", () => {
  /**
   * The host's own store, fed exactly what the surface reported. If these two
   * ever answer differently for one title, the tab bar and the worktree row are
   * showing the user contradictory states for the same pane.
   */
  function hostStore() {
    const store = createPaneEvidenceStore({ now: () => 5_000 });
    store.create("t1");
    return store;
  }

  it.each([
    ["a shell title", "zsh", "idle"],
    ["an agent title", "claude", "running"],
    ["a decoration-only title", "⠋", "running"],
    ["a neutral title", "Terminal", "running"],
  ])("agrees on %s", (_label, title, expected) => {
    const { posted, factory, terminals, tracker, emitTitle } = wireSurface();
    const instance = factory.createTerminal("t1", "Terminal 1", CONFIG as any, false, null);
    terminals.set("t1", { exited: false, activityStatus: "idle" });

    // Both sides see the same output, then the same title.
    tracker.markOutput("t1");
    const host = hostStore();
    host.markOutput("t1", 5_000);

    emitTitle(instance, title);
    for (const msg of posted) {
      host.report(msg);
    }

    expect(terminals.get("t1")?.activityStatus).toBe(expected);
    expect(host.activityFor("t1")).toBe(expected);
    expect(terminals.get("t1")?.activityStatus).toBe(host.activityFor("t1"));
  });

  it("agrees that a shell title does not hide a waiting pane", () => {
    const { posted, factory, terminals, tracker, emitTitle } = wireSurface();
    const instance = factory.createTerminal("t1", "Terminal 1", CONFIG as any, false, null);
    terminals.set("t1", { exited: false, activityStatus: "idle" });

    tracker.setWaiting("t1", true);
    emitTitle(instance, "zsh");

    const host = hostStore();
    for (const msg of posted) {
      host.report(msg);
    }

    expect(terminals.get("t1")?.activityStatus).toBe("waiting");
    expect(host.activityFor("t1")).toBe("waiting");
  });
});

// ─── I2, composed ───────────────────────────────────────────────────
//
// Round 5: `[I2]` sat on a render-end assertion over a hand-built row, which proves the
// renderer honours `agentSource` and proves nothing about what production puts there.
// This runs the real chain — evidence → store → classification → projection → render —
// so a change that started classifying a title as `launch` fails it (design.md D5).

const IDENTITY_WORKTREE = "/repo/wt-0";
const NOW = 1_700_000_000_000;

/** The production chain, minus the one hop that is a single call in `main.ts`. */
function wireIdentity() {
  const store = createPaneEvidenceStore({ now: () => NOW });
  const reporter = createPaneEvidenceReporter((msg) => store.report(msg));
  // No launch proof: a plain shell, and a pid whose process table shows no agent below it.
  store.create("pane-1", { viewId: "sidebar", cwd: IDENTITY_WORKTREE, ptyPid: 4242, shell: "zsh" });

  const outcome: DescendantsOutcome = { kind: "ok", pids: [] };
  const table = {
    open: async () => ({ descendantsOf: () => outcome }),
    descendantsOf: async () => outcome,
  } as unknown as ProcessTableSnapshot;

  const deps = createPresenceProjectorDeps({
    store,
    table,
    // Nothing in the registry either, so every rank above the title finds nothing.
    listRunning: async (): Promise<RunningSessionsOutcome> => ({ kind: "ok", sessions: [] }),
    sessionMtime: async () => 1,
    sessionPath: async () => null,
    now: () => NOW,
  });
  return { store, reporter, projector: createPresenceProjector(deps) };
}

describe("a spinner frame proves activity, never identity", () => {
  it("[I2] classifies a title-named agent as title-sourced and renders it undecorated", async () => {
    const { reporter, projector } = wireIdentity();

    reporter.reportTitle("pane-1", "⠋ claude");
    const row = (await projector.project([IDENTITY_WORKTREE])).rowsByWorktreeId[IDENTITY_WORKTREE]?.[0];

    // Asserted BEFORE the render, and this is the half the render-end test could not reach:
    // production did name an agent, and did record how weakly it knows. A row that resolved
    // nothing at all would render the same terminal glyph for an entirely different reason.
    expect(row, "the pane produced no row to classify").toBeDefined();
    expect(row).toMatchObject({ agent: "claude", agentSource: "title" });

    const icon = renderAgentRow(
      row as WorktreeAgentRow,
      { activity: presentedActivity(row as WorktreeAgentRow, [], NOW), now: NOW },
      { onActivate: () => {} },
    ).querySelector<HTMLElement>(".wt-aicon");
    // Through a parse on both sides: jsdom rewrites `<rect …/>` to `<rect …></rect>`, so
    // comparing rendered markup against the raw constant fails on the serializer, not the claim.
    const expected = document.createElement("span");
    expected.innerHTML = ICON_TERMINAL;
    expect(icon?.innerHTML).toBe(expected.innerHTML);
    expect(icon?.title).toBe("");
    expect(icon?.style.color).toBe("");
  });
});
