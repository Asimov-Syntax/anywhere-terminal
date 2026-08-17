// Shared module mocks for SessionManager / provider tests.
//
// Each factory is the superset of what the per-file copies had drifted into, so
// a caller that does not use a member simply ignores it. Call them from inside
// a `vi.mock` factory, which runs lazily and so may await this import:
//
//   vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());

import { vi } from "vitest";
import type { MessageSender } from "../session/OutputBuffer";

/** Registered by every mocked PtySession so a test can drive its callbacks. */
export interface MockPtyHandle {
  id: string;
  onData: ((data: string) => void) | undefined;
  onExit: ((code: number) => void) | undefined;
}

export const mockPtySessions: MockPtyHandle[] = [];

export function processCwdMock() {
  return { queryProcessCwd: vi.fn(async () => undefined) };
}

export function ptyManagerMock() {
  return {
    loadNodePty: vi.fn(() => ({ spawn: vi.fn() })),
    detectShell: vi.fn(() => ({ shell: "/bin/zsh", args: ["--login"] })),
    buildEnvironment: vi.fn(() => ({ PATH: "/usr/bin" })),
    resolveWorkingDirectory: vi.fn(() => "/tmp"),
  };
}

export function ptySessionMock() {
  class MockPtySession {
    id: string;
    pid = 99000;
    spawn = vi.fn();
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
}

export function outputBufferMock() {
  class MockOutputBuffer {
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
      public _i: string,
      public _w: unknown,
      public _p: unknown,
    ) {}
  }
  return { OutputBuffer: MockOutputBuffer };
}

export function mockWebview(): MessageSender {
  return { postMessage: vi.fn(() => Promise.resolve(true)) };
}
