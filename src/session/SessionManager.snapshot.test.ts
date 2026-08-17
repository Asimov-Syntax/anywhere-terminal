// Snapshot-generator tests: SerializeAddon caching + metadata shape + truncation.
// See: asimov/changes/restore-terminal-sessions/design.md D1, D4, D5, D13.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";
import { mockPtySessions, mockWebview } from "../test/sessionMocks";

vi.mock("../pty/processCwd", async () => (await import("../test/sessionMocks")).processCwdMock());
vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());
vi.mock("./OutputBuffer", async () => (await import("../test/sessionMocks")).outputBufferMock());

import {
  type HeadlessFactory,
  type HeadlessTerminalLike,
  type SerializeAddonFactory,
  type SerializeAddonLike,
  SessionManager,
  truncateSnapshotBuffer,
} from "./SessionManager";

function makeFactories() {
  const builtHeadless: Array<HeadlessTerminalLike & { addons: SerializeAddonLike[] }> = [];
  const builtAddons: Array<
    SerializeAddonLike & {
      id: number;
      calls: number;
      output: string;
      disposed: boolean;
      lastOptions?: { scrollback?: number; excludeAltBuffer?: boolean; excludeModes?: boolean };
    }
  > = [];
  let addonCtorCount = 0;

  const headless: HeadlessFactory = (cols, rows) => {
    const inst = {
      cols,
      rows,
      addons: [] as SerializeAddonLike[],
      write(_data: string) {},
      resize(_c: number, _r: number) {},
      dispose() {},
      loadAddon(addon: unknown) {
        this.addons.push(addon as SerializeAddonLike);
      },
    };
    builtHeadless.push(inst);
    return inst;
  };
  const serializeAddon: SerializeAddonFactory = () => {
    addonCtorCount++;
    const inst = {
      id: addonCtorCount,
      calls: 0,
      output: `BUF#${addonCtorCount}`,
      disposed: false,
      lastOptions: undefined as { scrollback?: number; excludeAltBuffer?: boolean; excludeModes?: boolean } | undefined,
      serialize(opts?: { scrollback?: number; excludeAltBuffer?: boolean; excludeModes?: boolean }) {
        this.calls++;
        this.lastOptions = opts;
        return this.output;
      },
      dispose() {
        this.disposed = true;
      },
    };
    builtAddons.push(inst);
    return inst;
  };
  return {
    headless,
    serializeAddon,
    builtHeadless,
    builtAddons,
    get addonCtorCount() {
      return addonCtorCount;
    },
  };
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

describe("SessionManager.generateSnapshotMetadata", () => {
  it("returns null when restoreEnabled === false (no headless mirror)", () => {
    const fx = makeFactories();
    const sm = new SessionManager(undefined, {
      restoreEnabled: false,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serializeAddon,
    });
    const id = sm.createSession("sidebar", mockWebview());
    mockPtySessions[0].onData?.("data");
    expect(sm.generateSnapshotMetadata(id)).toBeNull();
    sm.dispose();
  });

  it("returns null when the session has not produced data (no mirror yet)", () => {
    const fx = makeFactories();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serializeAddon,
    });
    const id = sm.createSession("sidebar", mockWebview());
    expect(sm.generateSnapshotMetadata(id)).toBeNull();
    sm.dispose();
  });

  it("calls SerializeAddon.serialize with exact options matching VS Code core", () => {
    const fx = makeFactories();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serializeAddon,
    });
    const id = sm.createSession("sidebar", mockWebview());
    mockPtySessions[0].onData?.("data");
    sm.generateSnapshotMetadata(id);
    expect(fx.builtAddons[0].lastOptions).toEqual({
      scrollback: 1000,
      excludeAltBuffer: true,
      excludeModes: true,
    });
    sm.dispose();
  });

  it("constructs the SerializeAddon instance at most once per session across N calls", () => {
    const fx = makeFactories();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serializeAddon,
    });
    const id = sm.createSession("sidebar", mockWebview());
    mockPtySessions[0].onData?.("data");
    for (let i = 0; i < 5; i++) {
      sm.generateSnapshotMetadata(id);
    }
    expect(fx.addonCtorCount).toBe(1);
    expect(fx.builtAddons[0].calls).toBe(5);
    sm.dispose();
  });

  it("uses a distinct SerializeAddon instance per session", () => {
    const fx = makeFactories();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serializeAddon,
    });
    const a = sm.createSession("sidebar", mockWebview());
    const b = sm.createSession("anywhereTerminal.panel", mockWebview());
    mockPtySessions[0].onData?.("a");
    mockPtySessions[1].onData?.("b");
    sm.generateSnapshotMetadata(a);
    sm.generateSnapshotMetadata(b);
    expect(fx.addonCtorCount).toBe(2);
    expect(fx.builtAddons[0].id).not.toBe(fx.builtAddons[1].id);
    sm.dispose();
  });

  it("returns metadata with the correct viewLocation, dims, and identity fields", () => {
    const fx = makeFactories();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serializeAddon,
    });
    const id = sm.createSession("editor-PANEL123", mockWebview(), { shell: "/bin/bash", shellArgs: ["-l"] });
    sm.resizeSession(id, 100, 30);
    mockPtySessions[0].onData?.("data");
    const result = sm.generateSnapshotMetadata(id);
    expect(result).not.toBeNull();
    const m = result!.metadata;
    expect(m.sessionId).toBe(id);
    expect(m.viewLocation).toBe("editor");
    expect(m.panelId).toBe("PANEL123");
    expect(m.cols).toBe(100);
    expect(m.rows).toBe(30);
    expect(m.shell).toBe("/bin/bash");
    expect(m.shellArgs).toEqual(["-l"]);
    expect(m.bufferFile).toBe(`snapshots/${id}.snapshot.ans`);
    expect(m.shellExited).toBe(false);
    expect(m.exitCode).toBeNull();
    expect(m.bufferBytes).toBe(Buffer.byteLength(result!.buffer, "utf8"));
    sm.dispose();
  });

  it("persists isAgentLaunch for vault agent launches (omitted otherwise)", () => {
    const fx = makeFactories();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serializeAddon,
    });
    const agent = sm.createSession("anywhereTerminal.sidebar", mockWebview(), {
      shell: "claude",
      shellArgs: ["--resume", "x"],
      isAgentLaunch: true,
    });
    mockPtySessions[0].onData?.("data");
    expect(sm.generateSnapshotMetadata(agent)!.metadata.isAgentLaunch).toBe(true);

    const plain = sm.createSession("anywhereTerminal.sidebar", mockWebview());
    mockPtySessions[1].onData?.("data");
    expect(sm.generateSnapshotMetadata(plain)!.metadata.isAgentLaunch).toBeUndefined();
    sm.dispose();
  });

  it("attaches trackedCommands to metadata when commandTracking has entries", () => {
    const fx = makeFactories();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serializeAddon,
    });
    const id = sm.createSession("anywhereTerminal.sidebar", mockWebview());
    mockPtySessions[0].onData?.("x");
    const session = sm.getSession(id);
    expect(session).toBeDefined();
    // Drive a real B+D pair so we exercise the tracker's public API rather
    // than reaching into the (now-readonly) `commands` array.
    session?.commandTracking.open({ id: "cmd-1", now: 100, cwd: "/tmp" });
    session?.commandTracking.setCommandLine("echo hello");
    session?.commandTracking.appendOutput("hello");
    session?.commandTracking.close({ exitCode: 0, now: 200 });
    const m = sm.generateSnapshotMetadata(id)!.metadata;
    expect(m.trackedCommands).toHaveLength(1);
    expect(m.trackedCommands?.[0].commandLine).toBe("echo hello");
    // Defensive copy: mutating the metadata array must not affect the runtime.
    m.trackedCommands?.pop();
    expect(session?.commandTracking.commands).toHaveLength(1);
    sm.dispose();
  });

  it("round-trips trackedCommands: restoreFrom seeds commandTracking; in-flight dropped", () => {
    const fx = makeFactories();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serializeAddon,
    });
    const sessionId = "restored-session";
    const completed = {
      id: "cmd-A",
      commandLine: "ls -la",
      output: "total 8",
      exitCode: 0,
      cwd: "/tmp",
      startedAt: 100,
      endedAt: 200,
      outputChars: 7,
      outputTruncated: false,
    };
    const inFlight = {
      id: "cmd-B",
      commandLine: "tail -f /var/log/syslog",
      output: "...",
      exitCode: null,
      cwd: "/tmp",
      startedAt: 300,
      endedAt: null,
      outputChars: 3,
      outputTruncated: false,
    };
    const id = sm.createSession("anywhereTerminal.sidebar", mockWebview(), {
      restoreFrom: {
        metadata: {
          sessionId,
          viewLocation: "sidebar",
          terminalNumber: 1,
          customName: null,
          shell: "/bin/zsh",
          shellArgs: [],
          cwd: "/tmp",
          currentCwd: null,
          cols: 80,
          rows: 24,
          bufferFile: `snapshots/${sessionId}.snapshot.ans`,
          bufferBytes: 100,
          isSplitPane: false,
          rootTabId: sessionId,
          snapshotAt: Date.now() - 1000,
          shellExited: false,
          exitCode: null,
          trackedCommands: [completed, inFlight],
        },
        buffer: "stale content",
      },
    });
    const session = sm.getSession(id);
    expect(session?.commandTracking.commands).toHaveLength(1);
    expect(session?.commandTracking.commands[0].id).toBe("cmd-A");
    // In-flight at persist time MUST NOT be resurrected (no D marker → invariant).
    expect(session?.commandTracking.inFlight).toBeNull();
    sm.dispose();
  });

  it("omits trackedCommands from metadata when commandTracking is empty", () => {
    const fx = makeFactories();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serializeAddon,
    });
    const id = sm.createSession("anywhereTerminal.sidebar", mockWebview());
    mockPtySessions[0].onData?.("x");
    const m = sm.generateSnapshotMetadata(id)!.metadata;
    expect(m.trackedCommands).toBeUndefined();
    sm.dispose();
  });

  it("uses sidebar viewLocation by default and panel viewLocation for the panel container", () => {
    const fx = makeFactories();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serializeAddon,
    });
    const a = sm.createSession("anywhereTerminal.sidebar", mockWebview());
    const b = sm.createSession("anywhereTerminal.panel", mockWebview());
    mockPtySessions[0].onData?.("x");
    mockPtySessions[1].onData?.("x");
    expect(sm.generateSnapshotMetadata(a)!.metadata.viewLocation).toBe("sidebar");
    expect(sm.generateSnapshotMetadata(b)!.metadata.viewLocation).toBe("panel");
    sm.dispose();
  });
});

describe("truncateSnapshotBuffer", () => {
  it("returns the input unchanged when under the cap", () => {
    const s = "hello\nworld\n";
    expect(truncateSnapshotBuffer(s, 1024)).toBe(s);
  });

  it("trims leading bytes and aligns to the next LF when over the cap", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line-${i.toString().padStart(3, "0")}`).join("\n");
    // Force a tiny cap: 30 bytes. The tail should land at a CR/LF boundary.
    const out = truncateSnapshotBuffer(lines, 30);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.startsWith("line-")).toBe(true);
  });
});
