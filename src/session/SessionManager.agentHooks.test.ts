// src/session/SessionManager.agentHooks.test.ts — Renewable agent-hook
// authority wired through the terminal lifecycle (integrate-cursor-agent 2_3).
// See: design.md D6, D7; specs/cursor-agent-status/spec.md
// #hook-session-isolation, #cursor-status-pane-isolation.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEnvironmentContributor } from "../agentHooks/AgentHookRuntime";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";
import { mockWebview } from "../test/sessionMocks";

// ─── Local PtySession mock (adds throw-on-next-spawn control the shared
// sessionMocks helper doesn't need) ─────────────────────────────────────

interface MockPtyHandle {
  id: string;
  onData: ((data: string) => void) | undefined;
  onExit: ((code: number) => void) | undefined;
}

const mockPtySessions: MockPtyHandle[] = [];
const mockSpawnCalls: Array<{ id: string; env: Record<string, string> }> = [];
let nextSpawnShouldThrow = false;

vi.mock("../pty/processCwd", async () => (await import("../test/sessionMocks")).processCwdMock());
vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("./OutputBuffer", async () => (await import("../test/sessionMocks")).outputBufferMock());

vi.mock("../pty/PtySession", () => {
  class MockPtySession {
    id: string;
    pid = 99000;
    spawn = vi.fn(
      (_nodePty: unknown, _shell: string, _args: string[], opts: { cwd: string; env: Record<string, string> }) => {
        mockSpawnCalls.push({ id: this.id, env: opts.env });
        if (nextSpawnShouldThrow) {
          nextSpawnShouldThrow = false;
          throw new Error("spawn failed");
        }
      },
    );
    write = vi.fn();
    resize = vi.fn();
    kill = vi.fn();
    dispose = vi.fn();
    pause = vi.fn();
    resume = vi.fn();
    setShellIntegrationSink = vi.fn();
    setShellIntegrationNonce = vi.fn();
    private _od: ((d: string) => void) | undefined;
    private _oe: ((c: number) => void) | undefined;
    get onData() {
      return this._od;
    }
    set onData(cb: ((d: string) => void) | undefined) {
      this._od = cb;
      const t = mockPtySessions.find((p) => p.id === this.id);
      if (t) {
        t.onData = cb;
      }
    }
    get onExit() {
      return this._oe;
    }
    set onExit(cb: ((c: number) => void) | undefined) {
      this._oe = cb;
      const t = mockPtySessions.find((p) => p.id === this.id);
      if (t) {
        t.onExit = cb;
      }
    }
    constructor(id: string) {
      this.id = id;
      mockPtySessions.push({ id, onData: undefined, onExit: undefined });
    }
  }
  return { PtySession: MockPtySession };
});

import { type HeadlessFactory, type SerializeAddonFactory, SessionManager } from "./SessionManager";

function makeFactories() {
  const headless: HeadlessFactory = (cols, rows) => ({
    cols,
    rows,
    write(_d: string, cb?: () => void) {
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
  return { headless, serialize };
}

function newSM(agentHookContributor?: SessionEnvironmentContributor) {
  const fx = makeFactories();
  return new SessionManager(undefined, {
    restoreEnabled: true,
    headlessFactory: fx.headless,
    serializeAddonFactory: fx.serialize,
    agentHookContributor,
  });
}

/** Fake renewable-token contributor; each `create` mints a distinguishable token. */
function fakeContributor() {
  let counter = 0;
  const create = vi.fn((sessionId: string) => {
    counter += 1;
    return { ANYWHERE_TERMINAL_CURSOR_URL: `http://127.0.0.1:9/${sessionId}/token-${counter}/cursor` };
  });
  const release = vi.fn();
  return { create, release } satisfies SessionEnvironmentContributor;
}

/** Lets destroySession's operation queue (real setTimeout(0) inside performDestroy) drain. */
async function flushQueue(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(() => {
  __resetAll();
  __setAppRoot("/mock/vscode/app");
  __setWorkspaceFolders([{ uri: { fsPath: "/mock/workspace" } }]);
  vi.clearAllMocks();
  mockPtySessions.length = 0;
  mockSpawnCalls.length = 0;
  nextSpawnShouldThrow = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SessionManager agent-hook authority — initial spawn", () => {
  it("merges fresh hook authority into the initial spawn env", () => {
    const contributor = fakeContributor();
    const sm = newSM(contributor);
    const id = sm.createSession("sidebar", mockWebview());

    expect(contributor.create).toHaveBeenCalledTimes(1);
    expect(contributor.create).toHaveBeenCalledWith(id, expect.any(Object));
    const spawnCall = mockSpawnCalls.find((c) => c.id === id);
    expect(spawnCall?.env.ANYWHERE_TERMINAL_CURSOR_URL).toContain(id);
    sm.dispose();
  });

  // The contribution merges last so a credential can never be shadowed — which
  // is also how it would silently replace a configuration directory the user
  // chose for this terminal, if it were not shown what it is merging into
  // (.reviews/round-1.md B3).
  it("shows the contributor the environment it is merging into", () => {
    const contributor = fakeContributor();
    const sm = newSM(contributor);
    const id = sm.createSession("sidebar", mockWebview(), { env: { OPENCODE_CONFIG_DIR: "/home/u/my-opencode" } });

    expect(contributor.create).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ OPENCODE_CONFIG_DIR: "/home/u/my-opencode" }),
    );
    sm.dispose();
  });

  it("skips contributor calls entirely when none is attached", () => {
    const sm = newSM();
    expect(() => sm.createSession("sidebar", mockWebview())).not.toThrow();
    sm.dispose();
  });

  it("still opens the pane when the contributor throws, spawning without hook env (B3)", () => {
    const contributor = {
      create: vi.fn(() => {
        throw new Error("contributor exploded");
      }),
      release: vi.fn(),
    } satisfies SessionEnvironmentContributor;
    const sm = newSM(contributor);

    let id = "";
    expect(() => {
      id = sm.createSession("sidebar", mockWebview());
    }).not.toThrow();

    const spawnCall = mockSpawnCalls.find((c) => c.id === id);
    expect(spawnCall).toBeDefined();
    expect(spawnCall?.env.ANYWHERE_TERMINAL_CURSOR_URL).toBeUndefined();
    // Best-effort release so a half-minted authority cannot outlive the failure.
    expect(contributor.release).toHaveBeenCalledWith(id);
    sm.dispose();
  });

  it("does not grant hook authority to a read-only restored-exited session (no live PTY)", () => {
    const contributor = fakeContributor();
    const sm = newSM(contributor);
    const restoreFrom = {
      metadata: {
        sessionId: "restored-1",
        viewLocation: "sidebar" as const,
        terminalNumber: 1,
        customName: null,
        shell: "/bin/zsh",
        shellArgs: [],
        cwd: "/proj",
        currentCwd: null,
        cols: 80,
        rows: 30,
        bufferFile: "snapshots/restored-1.snapshot.ans",
        bufferBytes: 0,
        isSplitPane: false,
        rootTabId: "restored-1",
        snapshotAt: 1,
        shellExited: true,
        exitCode: 0,
        isAgentLaunch: false,
      },
      buffer: "",
    };
    sm.createSession("sidebar", mockWebview(), { restoreFrom });
    expect(contributor.create).not.toHaveBeenCalled();
    sm.dispose();
  });
});

describe("SessionManager agent-hook authority — fallback-shell renewal", () => {
  it("releases the old token before issuing a fresh one for the replacement PTY", () => {
    const contributor = fakeContributor();
    const sm = newSM(contributor);
    const id = sm.createSession("sidebar", mockWebview(), {
      shell: "claude",
      shellArgs: ["--resume", "x"],
      isAgentLaunch: true,
    });
    expect(contributor.create).toHaveBeenCalledTimes(1);

    mockPtySessions[0].onExit?.(0); // agent exits → shell-fallback respawn

    expect(contributor.release).toHaveBeenCalledWith(id);
    expect(contributor.create).toHaveBeenCalledTimes(2);
    expect(contributor.create).toHaveBeenNthCalledWith(2, id, expect.any(Object));

    // release ordered strictly before the SECOND create call.
    const releaseOrder = contributor.release.mock.invocationCallOrder[0]!;
    const secondCreateOrder = contributor.create.mock.invocationCallOrder[1]!;
    expect(releaseOrder).toBeLessThan(secondCreateOrder);

    const spawnsForId = mockSpawnCalls.filter((c) => c.id === id);
    expect(spawnsForId).toHaveLength(2);
    expect(spawnsForId[1]?.env.ANYWHERE_TERMINAL_CURSOR_URL).toContain("token-2");
    sm.dispose();
  });
});

describe("SessionManager agent-hook authority — failed spawn", () => {
  it("releases authority when the initial spawn throws", () => {
    const contributor = fakeContributor();
    const sm = newSM(contributor);
    nextSpawnShouldThrow = true;

    expect(() => sm.createSession("sidebar", mockWebview())).toThrow();

    const id = mockPtySessions[0]!.id;
    expect(contributor.create).toHaveBeenCalledWith(id, expect.any(Object));
    expect(contributor.release).toHaveBeenCalledWith(id);
    sm.dispose();
  });
});

describe("SessionManager agent-hook authority — attach/detach toggle", () => {
  it("clears live webview identity when hook authority is detached", () => {
    const contributor = fakeContributor();
    const sm = newSM(contributor);
    const webview = mockWebview();
    const id = sm.createSession("sidebar", webview);

    sm.setAgentHookContributor(undefined);

    expect(webview.postMessage).toHaveBeenCalledWith({
      type: "agentActivityStatus",
      tabId: id,
      agent: null,
      state: null,
    });
    sm.dispose();
  });

  it("stops granting authority once detached, and resumes once reattached", () => {
    const contributor = fakeContributor();
    const sm = newSM();
    sm.setAgentHookContributor(contributor);

    const id1 = sm.createSession("sidebar", mockWebview());
    expect(contributor.create).toHaveBeenCalledTimes(1);
    expect(contributor.create).toHaveBeenCalledWith(id1, expect.any(Object));

    sm.setAgentHookContributor(undefined);
    sm.createSession("sidebar", mockWebview());
    expect(contributor.create).toHaveBeenCalledTimes(1); // unchanged — no contributor attached

    sm.setAgentHookContributor(contributor);
    const id3 = sm.createSession("sidebar", mockWebview());
    expect(contributor.create).toHaveBeenCalledTimes(2);
    expect(contributor.create).toHaveBeenNthCalledWith(2, id3, expect.any(Object));
    sm.dispose();
  });

  it("releases every currently tracked session through the OLD contributor on detach, and a same-reference set is a no-op", () => {
    const contributor = fakeContributor();
    const sm = newSM(contributor);
    const id1 = sm.createSession("sidebar", mockWebview());
    const id2 = sm.createSession("sidebar", mockWebview());
    expect(contributor.create).toHaveBeenCalledTimes(2);

    // Same-reference set: idempotent no-op, no release.
    sm.setAgentHookContributor(contributor);
    expect(contributor.release).not.toHaveBeenCalled();

    // Detach: every currently tracked session's token is released.
    sm.setAgentHookContributor(undefined);
    expect(contributor.release).toHaveBeenCalledTimes(2);
    expect(contributor.release).toHaveBeenCalledWith(id1);
    expect(contributor.release).toHaveBeenCalledWith(id2);

    // No new tokens are minted until reattached.
    sm.createSession("sidebar", mockWebview());
    expect(contributor.create).toHaveBeenCalledTimes(2);
    sm.dispose();
  });

  it("releases every currently tracked session through the OLD contributor before swapping to a NEW one", () => {
    const contributorA = fakeContributor();
    const contributorB = fakeContributor();
    const sm = newSM(contributorA);
    const id1 = sm.createSession("sidebar", mockWebview());

    sm.setAgentHookContributor(contributorB);

    expect(contributorA.release).toHaveBeenCalledWith(id1);
    expect(contributorB.release).not.toHaveBeenCalled();

    const id2 = sm.createSession("sidebar", mockWebview());
    expect(contributorB.create).toHaveBeenCalledWith(id2, expect.any(Object));
    expect(contributorA.create).toHaveBeenCalledTimes(1); // never asked to mint id2's token
    sm.dispose();
  });
});

describe("SessionManager agent-hook authority — exit and destroy", () => {
  it("releases authority on natural (non-agent) exit", () => {
    const contributor = fakeContributor();
    const sm = newSM(contributor);
    const id = sm.createSession("sidebar", mockWebview());

    mockPtySessions[0]!.onExit?.(0);

    expect(contributor.release).toHaveBeenCalledWith(id);
    sm.dispose();
  });

  it("releases authority when a session is explicitly destroyed", async () => {
    const contributor = fakeContributor();
    const sm = newSM(contributor);
    const id = sm.createSession("sidebar", mockWebview());

    sm.destroySession(id);
    await flushQueue();

    expect(contributor.release).toHaveBeenCalledWith(id);
    sm.dispose();
  });
});

describe("SessionManager agent-hook authority — manager disposal", () => {
  it("releases authority for every live session on dispose()", () => {
    const contributor = fakeContributor();
    const sm = newSM(contributor);
    const id1 = sm.createSession("sidebar", mockWebview());
    const id2 = sm.createSession("sidebar", mockWebview());

    sm.dispose();

    expect(contributor.release).toHaveBeenCalledWith(id1);
    expect(contributor.release).toHaveBeenCalledWith(id2);
  });
});
