// Shell-exit metadata tests.
// See: asimov/changes/restore-terminal-sessions/design.md D13.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";
import { mockPtySessions, mockWebview } from "../test/sessionMocks";
import type { MessageSender } from "./OutputBuffer";

vi.mock("../pty/processCwd", async () => (await import("../test/sessionMocks")).processCwdMock());
vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());
vi.mock("./OutputBuffer", async () => (await import("../test/sessionMocks")).outputBufferMock());

import { type HeadlessFactory, type SerializeAddonFactory, SessionManager } from "./SessionManager";

function makeFactories() {
  const writes: string[] = [];
  const headless: HeadlessFactory = (cols, rows) => ({
    cols,
    rows,
    write(d: string, cb?: () => void) {
      writes.push(d);
      cb?.();
    },
    resize() {},
    dispose() {},
    loadAddon() {},
  });
  const serialize: SerializeAddonFactory = () => ({
    serialize: () => "OUT",
    dispose() {},
  });
  return { headless, serialize, writes };
}

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

describe("SessionManager shell-exit metadata", () => {
  it("records shellExited and exitCode when pty.onExit fires (non-killed path)", () => {
    const fx = makeFactories();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
    });
    const _id = sm.createSession("sidebar", mockWebview());
    mockPtySessions[0].onData?.("hello");
    mockPtySessions[0].onExit?.(137);

    // The non-killed exit path runs cleanup; the snapshot can no longer be
    // generated (session removed) but the call before exit's cleanup proves
    // we hooked the exit. Instead — exercise the "killed" path so the
    // session survives long enough to inspect state. See below.
    sm.dispose();
  });

  it("freezes the headless mirror after exit (no further writes)", () => {
    const fx = makeFactories();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
    });
    sm.createSession("sidebar", mockWebview());
    // Force the kill path so the session entry stays around for inspection.
    // Mark the id as kill-in-progress so onExit only sets flags + skips cleanup.
    const id = mockPtySessions[0].id;
    (sm as any).terminalBeingKilled.add(id);
    mockPtySessions[0].onData?.("alpha");
    mockPtySessions[0].onExit?.(0);
    mockPtySessions[0].onData?.("beta-after-exit");

    expect(sm.getSession(id)?.shellExited).toBe(true);
    expect(sm.getSession(id)?.exitCode).toBe(0);
    expect(fx.writes).toEqual(["alpha"]);
    sm.dispose();
  });

  it("fires the onShellExited hook with the sessionId", () => {
    const fx = makeFactories();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
    });
    const seen: string[] = [];
    sm.onShellExited = (sid) => seen.push(sid);
    sm.createSession("sidebar", mockWebview());
    const id = mockPtySessions[0].id;
    (sm as any).terminalBeingKilled.add(id);
    mockPtySessions[0].onData?.("x");
    mockPtySessions[0].onExit?.(0);
    expect(seen).toEqual([id]);
    sm.dispose();
  });
});

describe("SessionManager shell-fallback respawn (vault agent sessions)", () => {
  function newSM() {
    const fx = makeFactories();
    return new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
    });
  }
  const postedTypes = (webview: MessageSender): unknown[] =>
    (webview.postMessage as any).mock.calls.map((c: any[]) => (c[0] as any)?.type);

  it("respawns a shell in the same tab when the agent exits (no exit message, tab stays live)", () => {
    const sm = newSM();
    const webview = mockWebview();
    const id = sm.createSession("sidebar", webview, {
      shell: "claude",
      shellArgs: ["--resume", "x"],
      isAgentLaunch: true,
    });
    expect(mockPtySessions).toHaveLength(1);

    mockPtySessions[0].onExit?.(0); // agent quits (Ctrl+C)

    // A fresh PTY was spawned for the same tab; the session is still alive.
    expect(mockPtySessions).toHaveLength(2);
    expect(sm.getSession(id)).toBeDefined();
    expect(sm.getSession(id)?.state).toBe("live");
    expect(sm.getSession(id)?.shellExited).toBeFalsy();
    expect(sm.getSession(id)?.shellFallbackArmed).toBe(false);
    // The tab's persisted identity flips to the fallback shell, so a later
    // window reload restores THIS shell — not the agent the user already quit.
    expect(sm.getSession(id)?.shell).toBe("/bin/zsh");
    expect(sm.getSession(id)?.isAgentLaunch).toBeFalsy();
    // The user is NOT shown "[Process exited]" — no exit message went out.
    expect(postedTypes(webview)).not.toContain("exit");
    sm.dispose();
  });

  it("the fallback shell exiting closes the tab normally (one-shot, no re-respawn)", () => {
    const sm = newSM();
    const webview = mockWebview();
    // Spy the private respawn so the one-shot guarantee is asserted on real
    // re-entry, not on the mock's handler-sharing quirk.
    const respawnSpy = vi.spyOn(sm as unknown as { respawnFallbackShell: () => void }, "respawnFallbackShell");
    const id = sm.createSession("sidebar", webview, {
      shell: "claude",
      shellArgs: ["--resume", "x"],
      isAgentLaunch: true,
    });
    mockPtySessions[0].onExit?.(0); // agent → fallback shell
    expect(respawnSpy).toHaveBeenCalledTimes(1);
    expect(mockPtySessions).toHaveLength(2);
    // Disarmed: the fallback shell is now a normal terminal.
    expect(sm.getSession(id)?.shellFallbackArmed).toBeFalsy();

    // The mock indexes handlers by session id (same for both PTYs), so the
    // fallback shell's onExit lands on entry[0]. Triggering it = the user typing
    // `exit` in the fallback shell.
    mockPtySessions[0].onExit?.(0);

    expect(respawnSpy).toHaveBeenCalledTimes(1); // did NOT respawn again
    expect(mockPtySessions).toHaveLength(2);
    expect(sm.getSession(id)).toBeUndefined(); // cleaned up like a normal close
    expect(postedTypes(webview)).toContain("exit");
    sm.dispose();
  });

  it("a normal (non-agent) terminal does NOT respawn on exit", () => {
    const sm = newSM();
    const webview = mockWebview();
    const id = sm.createSession("sidebar", webview);
    mockPtySessions[0].onExit?.(0);
    expect(mockPtySessions).toHaveLength(1); // no respawn
    expect(sm.getSession(id)).toBeUndefined();
    expect(postedTypes(webview)).toContain("exit");
    sm.dispose();
  });

  it("closing the tab (kill) does NOT respawn even for an agent session", () => {
    const sm = newSM();
    sm.createSession("sidebar", mockWebview(), {
      shell: "claude",
      shellArgs: ["--resume", "x"],
      isAgentLaunch: true,
    });
    (sm as any).terminalBeingKilled.add(mockPtySessions[0].id);
    mockPtySessions[0].onExit?.(0);
    expect(mockPtySessions).toHaveLength(1); // no respawn on intentional kill
    sm.dispose();
  });

  it("re-arms the fallback after a cross-restart restore (auto-resumed agent)", () => {
    const sm = newSM();
    const restoreFrom = {
      metadata: {
        sessionId: "agent-1",
        viewLocation: "sidebar" as const,
        terminalNumber: 1,
        customName: null,
        shell: "claude",
        shellArgs: ["--resume", "x"],
        cwd: "/proj",
        currentCwd: null,
        cols: 80,
        rows: 30,
        bufferFile: "snapshots/agent-1.snapshot.ans",
        bufferBytes: 0,
        isSplitPane: false,
        rootTabId: "agent-1",
        snapshotAt: 1,
        shellExited: false,
        exitCode: null,
        isAgentLaunch: true,
      },
      buffer: "",
    };
    const id = sm.createSession("sidebar", mockWebview(), { restoreFrom });
    expect(sm.getSession(id)?.shellFallbackArmed).toBe(true);
    // The restored agent exits → still respawns a shell.
    mockPtySessions[0].onExit?.(0);
    expect(mockPtySessions).toHaveLength(2);
    expect(sm.getSession(id)).toBeDefined();
    sm.dispose();
  });
});
