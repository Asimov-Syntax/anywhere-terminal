// Two-step deactivate flush + idempotent dispose tests.
// See: asimov/changes/restore-terminal-sessions/design.md D6.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";
import { mockPtySessions, mockWebview } from "../test/sessionMocks";

vi.mock("../pty/processCwd", async () => (await import("../test/sessionMocks")).processCwdMock());
vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());
vi.mock("./OutputBuffer", async () => (await import("../test/sessionMocks")).outputBufferMock());

import { type HeadlessFactory, type SerializeAddonFactory, SessionManager } from "./SessionManager";

function makeStorageMock() {
  const bufferGens = new Map<string, number>();
  let sidecarGen = 0;
  return {
    commitBufferSync: vi.fn((id: string, _data: string) => {
      bufferGens.set(id, (bufferGens.get(id) ?? 0) + 1);
    }),
    commitBufferAsync: vi.fn(async (id: string, _data: string, capturedGen: number) => {
      if ((bufferGens.get(id) ?? 0) !== capturedGen) {
        return "stale-skipped" as const;
      }
      return "renamed" as const;
    }),
    commitIndexSync: vi.fn(() => {
      sidecarGen += 1;
    }),
    commitIndexAsync: vi.fn(async (_idx: unknown, capturedGen: number) => {
      if (sidecarGen !== capturedGen) {
        return "stale-skipped" as const;
      }
      return "renamed" as const;
    }),
    dropBuffer: vi.fn((id: string) => {
      bufferGens.set(id, (bufferGens.get(id) ?? 0) + 1);
    }),
    currentBufferGen: vi.fn((id: string) => bufferGens.get(id) ?? 0),
    currentSidecarGen: vi.fn(() => sidecarGen),
    cleanupOrphanTemps: vi.fn(),
    writeIndexAwaited: vi.fn(async () => {}),
    writeLivePanelsAwaited: vi.fn(async () => {}),
    readBufferFile: () => null,
    listBufferFiles: () => [],
    loadIndex: () => undefined,
    loadLivePanels: () => undefined,
    bufferFilePath: (id: string) => `/tmp/${id}`,
    bufferFileRelativePath: (id: string) => `snapshots/${id}.snapshot.ans`,
    cancelPendingIndex: vi.fn(),
    purge: vi.fn(async () => {}),
  };
}

function makeFactories() {
  const headless: HeadlessFactory = (cols, rows) => ({
    cols,
    rows,
    write(_data, cb) {
      cb?.();
    },
    resize() {},
    dispose() {},
    loadAddon() {},
  });
  const serialize: SerializeAddonFactory = () => ({
    serialize: () => "BUFFER",
    dispose() {},
  });
  return { headless, serialize };
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

describe("SessionManager flushSnapshotsSync + flushIndexAwaited", () => {
  it("flushSnapshotsSync writes each active session's buffer synchronously", () => {
    const fx = makeFactories();
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
      storage: storage as any,
    });
    const a = sm.createSession("sidebar", mockWebview());
    const b = sm.createSession("anywhereTerminal.panel", mockWebview());
    mockPtySessions[0].onData?.("aa");
    mockPtySessions[1].onData?.("bb");
    sm.flushSnapshotsSync();
    expect(storage.commitBufferSync).toHaveBeenCalledTimes(2);
    expect(storage.commitBufferSync).toHaveBeenCalledWith(a, "BUFFER");
    expect(storage.commitBufferSync).toHaveBeenCalledWith(b, "BUFFER");
    sm.dispose();
  });

  it("flushIndexAwaited writes live-panels (Memento) + syncs sidecar (D17)", async () => {
    const fx = makeFactories();
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
      storage: storage as any,
    });
    sm.createSession("sidebar", mockWebview());
    mockPtySessions[0].onData?.("x");
    sm.flushSnapshotsSync();
    await sm.flushIndexAwaited();
    // Live-panels still go to Memento (small + churnier — no dual-source bug
    // class). Snapshot index goes to the sidecar via commitIndexSync.
    expect(storage.writeLivePanelsAwaited).toHaveBeenCalledTimes(1);
    expect(storage.commitIndexSync).toHaveBeenCalled();
    sm.dispose();
  });

  it("flushSnapshotsSync is a no-op after dispose (idempotency)", () => {
    const fx = makeFactories();
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
      storage: storage as any,
    });
    sm.dispose();
    sm.flushSnapshotsSync();
    expect(storage.commitBufferSync).not.toHaveBeenCalled();
  });

  it("dispose is idempotent — second call is a no-op", () => {
    const fx = makeFactories();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
    });
    sm.createSession("sidebar", mockWebview());
    sm.dispose();
    expect(() => sm.dispose()).not.toThrow();
  });

  it("dispose does NOT itself flush — flush is owned by the caller", () => {
    const fx = makeFactories();
    const storage = makeStorageMock();
    const sm = new SessionManager(undefined, {
      restoreEnabled: true,
      headlessFactory: fx.headless,
      serializeAddonFactory: fx.serialize,
      storage: storage as any,
    });
    sm.createSession("sidebar", mockWebview());
    mockPtySessions[0].onData?.("x");
    sm.dispose();
    expect(storage.commitBufferSync).not.toHaveBeenCalled();
    expect(storage.commitIndexSync).not.toHaveBeenCalled();
    expect(storage.writeLivePanelsAwaited).not.toHaveBeenCalled();
  });
});
