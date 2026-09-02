import { describe, expect, it, vi } from "vitest";
import type { Pty } from "../../pty/PtyManager";
import { SetupTerminal } from "./setupTerminal";

function child(): { child: Pty; data: (value: string) => void; exit: () => void } {
  let emitData: ((value: string) => void) | undefined;
  let emitExit: ((event: { exitCode: number; signal?: number }) => void) | undefined;
  return {
    child: {
      pid: 1,
      cols: 80,
      rows: 24,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      onData: vi.fn((listener) => {
        emitData = listener;
        return { dispose: vi.fn() };
      }),
      onExit: (listener) => {
        emitExit = listener;
        return { dispose: vi.fn() };
      },
    },
    data: (value) => emitData?.(value),
    exit: () => emitExit?.({ exitCode: 0 }),
  };
}

describe("SetupTerminal", () => {
  it("does not attach a child until open, streams and bounds its transcript, and forwards input", async () => {
    let pseudo:
      | {
          open?: () => void;
          close?: () => void;
          handleInput?: (data: string) => void;
          onDidWrite: (listener: (data: string) => void) => { dispose(): void };
        }
      | undefined;
    const fire = vi.fn();
    const terminal = new SetupTerminal({
      createTerminal: vi.fn((options) => {
        pseudo = options.pty as typeof pseudo;
        return { show: vi.fn(), dispose: vi.fn() };
      }),
      createEmitter: () => ({ event: (listener) => ({ dispose: vi.fn(), listener }), fire, dispose: vi.fn() }),
    });
    const pty = child();

    const opened = terminal.open();
    terminal.attach(pty.child);
    expect(pty.child.onData).not.toHaveBeenCalled();
    pseudo?.open?.();
    expect(await opened).toBe(true);
    expect(pty.child.onData).toHaveBeenCalledOnce();

    pty.data("x".repeat(1024 * 1024 + 9));
    pseudo?.handleInput?.("typed");
    expect(pty.child.write).toHaveBeenCalledWith("typed");
    expect(fire.mock.calls.map(([data]) => data).join("")).toBe("x".repeat(1024 * 1024 + 9));
    expect(terminal.transcript()).toHaveLength(1024 * 1024);
  });

  it("cancels an active child on close and replays a disposed output only to its origin", async () => {
    const terminals: Array<{ show: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = [];
    let pseudo: { open?: () => void; close?: () => void; onDidWrite: unknown } | undefined;
    const terminal = new SetupTerminal({
      createTerminal: vi.fn((options) => {
        pseudo = options.pty as typeof pseudo;
        const created = { show: vi.fn(), dispose: vi.fn() };
        terminals.push(created);
        return created;
      }),
      createEmitter: () => ({ event: vi.fn(), fire: vi.fn(), dispose: vi.fn() }),
      newId: () => "opaque-output",
    });
    const pty = child();

    const opened = terminal.open();
    pseudo?.open?.();
    await opened;
    terminal.attach(pty.child);
    const outputId = terminal.outputId("surface-a");
    pseudo?.close?.();

    expect(pty.child.kill).toHaveBeenCalledWith();
    expect(terminal.reveal(outputId, "surface-b")).toBe(false);
    expect(terminal.reveal(outputId, "surface-a")).toBe(true);
    expect(terminals).toHaveLength(2);
    expect(terminals[1]?.show).toHaveBeenCalled();
    pseudo?.close?.();
    expect(terminal.reveal(outputId, "surface-a")).toBe(true);
    expect(terminals).toHaveLength(3);
    expect(terminals[2]?.show).toHaveBeenCalled();
  });

  it("evicts transcript chunks on UTF-8 boundaries and bounds one oversized event", async () => {
    let pseudo: { open?: () => void } | undefined;
    const terminal = new SetupTerminal({
      createTerminal: vi.fn((options) => {
        pseudo = options.pty as typeof pseudo;
        return { show: vi.fn(), dispose: vi.fn() };
      }),
      createEmitter: () => ({ event: vi.fn(), fire: vi.fn(), dispose: vi.fn() }),
    });
    const pty = child();
    const opened = terminal.open();
    pseudo?.open?.();
    await opened;
    terminal.attach(pty.child);

    pty.data("x".repeat(1024 * 1024 - 2));
    pty.data("🙂END");
    expect(Buffer.byteLength(terminal.transcript())).toBeLessThanOrEqual(1024 * 1024);
    expect(terminal.transcript()).not.toContain("�");
    expect(terminal.transcript()).toMatch(/🙂END$/);

    pty.data("z".repeat(4 * 1024 * 1024));
    expect(Buffer.byteLength(terminal.transcript())).toBe(1024 * 1024);
    expect(terminal.transcript()).toBe("z".repeat(1024 * 1024));
    const retained = terminal as unknown as { tailChunks: Buffer[]; tailHead: number };
    expect(retained.tailChunks.slice(retained.tailHead).every((chunk) => chunk.buffer.byteLength <= 1024 * 1024)).toBe(
      true,
    );
  });

  it("releases fully evicted transcript backing allocations immediately", async () => {
    let pseudo: { open?: () => void } | undefined;
    const terminal = new SetupTerminal({
      createTerminal: vi.fn((options) => {
        pseudo = options.pty as typeof pseudo;
        return { show: vi.fn(), dispose: vi.fn() };
      }),
      createEmitter: () => ({ event: vi.fn(), fire: () => undefined, dispose: vi.fn() }),
    });
    const pty = child();
    const opened = terminal.open();
    pseudo?.open?.();
    await opened;
    terminal.attach(pty.child);

    for (let index = 0; index < 200; index += 1) {
      pty.data(String(index % 10).repeat(768 * 1024));
    }

    const retained = terminal as unknown as { tailChunks: Buffer[] };
    const backingBytes = retained.tailChunks.reduce((total, chunk) => total + chunk.buffer.byteLength, 0);
    expect(backingBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(Buffer.byteLength(terminal.transcript())).toBeLessThanOrEqual(1024 * 1024);
  });

  it("streams one oversized live event without concatenating the whole event", async () => {
    let pseudo: { open?: () => void } | undefined;
    const fire = vi.fn();
    const terminal = new SetupTerminal({
      createTerminal: vi.fn((options) => {
        pseudo = options.pty as typeof pseudo;
        return { show: vi.fn(), dispose: vi.fn() };
      }),
      createEmitter: () => ({ event: vi.fn(), fire, dispose: vi.fn() }),
    });
    const pty = child();
    const opened = terminal.open();
    pseudo?.open?.();
    await opened;
    terminal.attach(pty.child);
    const concat = vi.spyOn(Buffer, "concat");

    const output = `start-${"🙂".repeat(40_000)}-end`;
    pty.data(output);

    expect(fire.mock.calls.map(([data]) => data).join("")).toBe(output);
    expect(fire.mock.calls.every(([data]) => Buffer.byteLength(data) <= 64 * 1024)).toBe(true);
    expect(concat.mock.calls.some(([, length]) => (length ?? 0) > 64 * 1024)).toBe(false);
    concat.mockRestore();
  });

  it("batches live writes by latency and size and drops a pending flush on disposal", async () => {
    vi.useFakeTimers();
    let pseudo: { open?: () => void } | undefined;
    const fire = vi.fn();
    const created = { show: vi.fn(), dispose: vi.fn() };
    const terminal = new SetupTerminal({
      createTerminal: vi.fn((options) => {
        pseudo = options.pty as typeof pseudo;
        return created;
      }),
      createEmitter: () => ({ event: vi.fn(), fire, dispose: vi.fn() }),
    });
    const pty = child();
    const opened = terminal.open();
    pseudo?.open?.();
    await opened;
    terminal.attach(pty.child);

    pty.data("a");
    pty.data("b");
    expect(fire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(7);
    expect(fire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenLastCalledWith("ab");

    pty.data("x".repeat(64 * 1024));
    expect(fire).toHaveBeenCalledTimes(2);
    expect(fire).toHaveBeenLastCalledWith("x".repeat(64 * 1024));

    fire.mockClear();
    const nonAscii = "€".repeat(30_000);
    pty.data(nonAscii);
    expect(fire.mock.calls.map(([data]) => data).join("")).toBe(nonAscii);
    expect(fire.mock.calls.every(([data]) => Buffer.byteLength(data) <= 64 * 1024)).toBe(true);

    pty.data("pending");
    terminal.dispose();
    terminal.dispose();
    await vi.advanceTimersByTimeAsync(8);
    expect(fire).toHaveBeenCalledTimes(2);
    expect(created.dispose).toHaveBeenCalledTimes(1);
    expect(terminal.transcript()).toBe("");
    vi.useRealTimers();
  });

  it("keeps the current child on a foreign detach and settles close when kill throws", async () => {
    let pseudo: { open?: () => void; close?: () => void; handleInput?: (data: string) => void } | undefined;
    const terminal = new SetupTerminal({
      createTerminal: vi.fn((options) => {
        pseudo = options.pty as typeof pseudo;
        return { show: vi.fn(), dispose: vi.fn() };
      }),
      createEmitter: () => ({ event: vi.fn(), fire: vi.fn(), dispose: vi.fn() }),
    });
    const events: string[] = [];
    const current = child();
    current.child.kill = vi.fn(() => {
      events.push("kill");
      throw new Error("already exited");
    });
    const foreign = child();
    const closed = vi.fn(() => events.push("closed"));
    const opened = terminal.open();
    pseudo?.open?.();
    await opened;
    terminal.attach(current.child);
    terminal.onClose(closed);

    terminal.detach(foreign.child);
    pseudo?.handleInput?.("still-current");
    expect(current.child.write).toHaveBeenCalledWith("still-current");
    expect(() => pseudo?.close?.()).not.toThrow();
    expect(closed).toHaveBeenCalledOnce();
    expect(events).toEqual(["closed", "kill"]);
    pseudo?.handleInput?.("after-close");
    expect(current.child.write).toHaveBeenCalledTimes(1);
  });
});
