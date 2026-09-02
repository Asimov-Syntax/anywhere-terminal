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
    expect(fire).toHaveBeenLastCalledWith("x".repeat(1024 * 1024 + 9));
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
  });
});
