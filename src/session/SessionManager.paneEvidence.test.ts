// src/session/SessionManager.paneEvidence.test.ts — the host's own presence
// signals: pane creation, output, exit, respawn, closure, window disposal.
//
// The lifetime is the point, and it is NOT the session map's. A natural pty
// exit runs `cleanupSession`, which deletes the session while the tab is still
// on screen showing "[Process exited]" — so evidence keyed to `this.sessions`
// would destroy exactly the `exited` state that has to survive.
//
// See: asimov/changes/add-host-pane-evidence/design.md D2, D6.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";
import { mockPtySessions, mockWebview } from "../test/sessionMocks";

vi.mock("../pty/processCwd", async () => (await import("../test/sessionMocks")).processCwdMock());
vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());

/**
 * Local OutputBuffer stand-in — the shared `outputBufferMock` drops the flush
 * callback, and that callback is half of what this suite exists to check.
 *
 * Hoisted with the mock factory: `vi.mock` runs before module-level code.
 */
const output = vi.hoisted(() => {
  interface Flushable {
    tabId: string;
    onFlush?: (tabId: string, at: number) => void;
    emitFlush(at: number): void;
  }
  const buffers: Flushable[] = [];

  class MockOutputBuffer implements Flushable {
    append = vi.fn();
    dispose = vi.fn();
    updateWebview = vi.fn();
    pauseOutput = vi.fn();
    resumeOutput = vi.fn();
    handleAck = vi.fn();
    flush = vi.fn();
    isOutputPaused = false;
    bufferSize = 0;
    unackedCharCount = 0;
    constructor(
      public tabId: string,
      public webview: unknown,
      public pty: unknown,
      public onFlush?: (tabId: string, at: number) => void,
    ) {
      buffers.push(this);
    }
    /** Stand in for a real flush delivering output to the webview. */
    emitFlush(at: number): void {
      this.onFlush?.(this.tabId, at);
    }
  }

  return { MockOutputBuffer, buffers };
});

vi.mock("./OutputBuffer", () => ({ OutputBuffer: output.MockOutputBuffer }));

import { createPaneEvidenceStore, type PaneEvidenceStore } from "./PaneEvidenceStore";
import { SessionManager } from "./SessionManager";

let clock = 1_000_000;

function makeStore(): PaneEvidenceStore {
  return createPaneEvidenceStore({ now: () => clock });
}

function restoreSnapshot(sessionId: string, shellExited: boolean) {
  return {
    metadata: {
      sessionId,
      viewLocation: "sidebar" as const,
      terminalNumber: 1,
      customName: null,
      shell: "/bin/zsh",
      shellArgs: [],
      cwd: "/tmp",
      currentCwd: null,
      cols: 80,
      rows: 24,
      bufferFile: `snapshots/${sessionId}.snapshot.ans`,
      bufferBytes: 0,
      isSplitPane: false,
      rootTabId: sessionId,
      snapshotAt: 1700000000000,
      shellExited,
      exitCode: shellExited ? 0 : null,
    },
    buffer: "",
  };
}

beforeEach(() => {
  __resetAll();
  __setAppRoot("/mock/vscode/app");
  __setWorkspaceFolders([{ uri: { fsPath: "/mock/workspace" } }]);
  vi.clearAllMocks();
  mockPtySessions.length = 0;
  output.buffers.length = 0;
  clock = 1_000_000;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Creation ───────────────────────────────────────────────────────

describe("a pane coming into existence", () => {
  it("gets an entry, live", () => {
    const paneEvidence = makeStore();
    const sm = new SessionManager(undefined, { paneEvidence });
    const id = sm.createSession("sidebar", mockWebview());

    expect(paneEvidence.read(id)).toBeDefined();
    expect(paneEvidence.activityFor(id)).toBe("idle");
    sm.dispose();
  });

  it("gets an entry already exited when it is a restored read-only tab", () => {
    const paneEvidence = makeStore();
    const sm = new SessionManager(undefined, { restoreEnabled: true, paneEvidence });
    const id = sm.createSession("sidebar", mockWebview(), { restoreFrom: restoreSnapshot("RESTORED-1", true) });

    expect(paneEvidence.activityFor(id)).toBe("exited");
    sm.dispose();
  });

  it("gets a live entry when the restored tab's shell was still running", () => {
    const paneEvidence = makeStore();
    const sm = new SessionManager(undefined, { restoreEnabled: true, paneEvidence });
    const id = sm.createSession("sidebar", mockWebview(), { restoreFrom: restoreSnapshot("RESTORED-2", false) });

    expect(paneEvidence.activityFor(id)).toBe("idle");
    sm.dispose();
  });
});

// ─── Output ─────────────────────────────────────────────────────────

describe("output", () => {
  it("is observed when the flush delivers it, not when the pty produced it", () => {
    const paneEvidence = makeStore();
    const sm = new SessionManager(undefined, { paneEvidence });
    const id = sm.createSession("sidebar", mockWebview());

    // The pty produced output, but nothing has been delivered yet.
    mockPtySessions[0].onData?.("hello");
    expect(paneEvidence.activityFor(id)).toBe("idle");

    output.buffers[0].emitFlush(clock);
    expect(paneEvidence.activityFor(id)).toBe("running");

    clock += 1500;
    expect(paneEvidence.activityFor(id)).toBe("idle");
    sm.dispose();
  });

  it("is observed for the replacement buffer after a fallback respawn", () => {
    const paneEvidence = makeStore();
    const sm = new SessionManager(undefined, { paneEvidence });
    const id = sm.createSession("sidebar", mockWebview(), { isAgentLaunch: true });

    mockPtySessions[0].onExit?.(0);
    expect(output.buffers.length).toBeGreaterThan(1);

    output.buffers[output.buffers.length - 1].emitFlush(clock);
    expect(paneEvidence.activityFor(id)).toBe("running");
    sm.dispose();
  });
});

// ─── Exit ───────────────────────────────────────────────────────────

describe("a process exiting", () => {
  it("leaves durable exited evidence, even though the session is gone", () => {
    const paneEvidence = makeStore();
    const sm = new SessionManager(undefined, { paneEvidence });
    const id = sm.createSession("sidebar", mockWebview());

    mockPtySessions[0].onExit?.(0);

    expect(sm.getSession(id)).toBeUndefined();
    expect(paneEvidence.activityFor(id)).toBe("exited");
    sm.dispose();
  });

  it("does not mark exited when a fallback shell takes the pane over", () => {
    const paneEvidence = makeStore();
    const sm = new SessionManager(undefined, { paneEvidence });
    const id = sm.createSession("sidebar", mockWebview(), { isAgentLaunch: true });

    mockPtySessions[0].onExit?.(0);

    expect(sm.getSession(id)).toBeDefined();
    expect(paneEvidence.activityFor(id)).toBe("idle");
    sm.dispose();
  });
});

// ─── Closure ────────────────────────────────────────────────────────

describe("a pane closing", () => {
  it("drops its evidence", () => {
    const paneEvidence = makeStore();
    const sm = new SessionManager(undefined, { paneEvidence });
    const id = sm.createSession("sidebar", mockWebview());

    sm.destroySession(id);

    expect(paneEvidence.read(id)).toBeUndefined();
    sm.dispose();
  });

  it("drops its evidence even when its process had already exited", () => {
    const paneEvidence = makeStore();
    const sm = new SessionManager(undefined, { paneEvidence });
    const id = sm.createSession("sidebar", mockWebview());

    // Natural exit first: the session is already gone from the map, so a
    // delete keyed on finding one would leak this entry for the window's life.
    mockPtySessions[0].onExit?.(0);
    expect(paneEvidence.read(id)).toBeDefined();

    sm.destroySession(id);

    expect(paneEvidence.read(id)).toBeUndefined();
    sm.dispose();
  });
});

// ─── A whole view closing ───────────────────────────────────────────

describe("a view closing", () => {
  it("drops the evidence of every pane it held", async () => {
    const paneEvidence = makeStore();
    const sm = new SessionManager(undefined, { paneEvidence });
    const a = sm.createSession("editor-1", mockWebview());
    const b = sm.createSession("editor-1", mockWebview());
    const other = sm.createSession("sidebar", mockWebview());

    sm.destroyAllForView("editor-1");

    // Synchronous: the queued drain runs a tick later, and a pane's evidence
    // must not survive the moment its view was closed.
    expect(paneEvidence.read(a)).toBeUndefined();
    expect(paneEvidence.read(b)).toBeUndefined();
    expect(paneEvidence.read(other)).toBeDefined();
    sm.dispose();
  });

  it("drops the evidence of a pane whose process had already exited", () => {
    const paneEvidence = makeStore();
    const sm = new SessionManager(undefined, { paneEvidence });
    const id = sm.createSession("editor-1", mockWebview());

    // A natural exit removes the session from `sessions` AND from
    // `viewSessions` while the tab is still open, so a view close that walks
    // either map cannot reach this pane. See .reviews/round-1.md B1.
    mockPtySessions[0].onExit?.(0);
    expect(paneEvidence.read(id)).toBeDefined();

    sm.destroyAllForView("editor-1");

    expect(paneEvidence.read(id)).toBeUndefined();
    sm.dispose();
  });
});

// ─── Window disposal ────────────────────────────────────────────────

describe("the window going away", () => {
  it("clears every pane's evidence, including one that never routed through cleanup", () => {
    const paneEvidence = makeStore();
    const sm = new SessionManager(undefined, { paneEvidence });
    const a = sm.createSession("sidebar", mockWebview());
    const b = sm.createSession("sidebar", mockWebview());

    sm.dispose();

    expect(paneEvidence.read(a)).toBeUndefined();
    expect(paneEvidence.read(b)).toBeUndefined();
  });
});

// ─── Semantic status ────────────────────────────────────────────────

describe("agent semantic status", () => {
  it("is cleared on the same event that revokes the webview's copy", () => {
    const paneEvidence = makeStore();
    const sm = new SessionManager(undefined, { paneEvidence });
    const id = sm.createSession("sidebar", mockWebview());

    paneEvidence.setSemantic(id, "working");
    expect(paneEvidence.activityFor(id)).toBe("running");

    // A natural exit releases hook authority for the session.
    mockPtySessions[0].onExit?.(0);

    expect(paneEvidence.read(id)?.semantic).toBeNull();
    sm.dispose();
  });
});

// ─── Optional dependency ────────────────────────────────────────────

describe("without a store", () => {
  it("runs the whole lifecycle unchanged", () => {
    const sm = new SessionManager();
    const id = sm.createSession("sidebar", mockWebview());
    expect(() => {
      output.buffers[0].emitFlush(clock);
      mockPtySessions[0].onExit?.(0);
      sm.destroySession(id);
      sm.dispose();
    }).not.toThrow();
  });
});
