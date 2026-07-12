import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ActivityTerminal, TerminalActivityTracker } from "./TerminalActivityTracker";

describe("TerminalActivityTracker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("marks output as running and returns to idle after the quiet period", () => {
    const terminal: ActivityTerminal = { exited: false, activityStatus: "idle" };
    const onStatusChange = vi.fn();
    const tracker = new TerminalActivityTracker({
      getTerminal: () => terminal,
      onStatusChange,
      idleDelayMs: 100,
    });

    tracker.markOutput("tab-1");
    expect(terminal.activityStatus).toBe("running");
    expect(onStatusChange).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(99);
    expect(terminal.activityStatus).toBe("running");
    vi.advanceTimersByTime(1);
    expect(terminal.activityStatus).toBe("idle");
    expect(onStatusChange).toHaveBeenCalledTimes(2);
  });

  it("refreshes the idle deadline without emitting duplicate running updates", () => {
    const terminal: ActivityTerminal = { exited: false, activityStatus: "idle" };
    const onStatusChange = vi.fn();
    const tracker = new TerminalActivityTracker({
      getTerminal: () => terminal,
      onStatusChange,
      idleDelayMs: 100,
    });

    tracker.markOutput("tab-1");
    vi.advanceTimersByTime(75);
    tracker.markOutput("tab-1");
    vi.advanceTimersByTime(75);

    expect(terminal.activityStatus).toBe("running");
    expect(onStatusChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(25);
    expect(terminal.activityStatus).toBe("idle");
  });

  it("ignores exited terminals and cancels deleted session timers", () => {
    const terminal: ActivityTerminal = { exited: true, activityStatus: "idle" };
    const onStatusChange = vi.fn();
    const tracker = new TerminalActivityTracker({
      getTerminal: () => terminal,
      onStatusChange,
      idleDelayMs: 100,
    });

    tracker.markOutput("tab-1");
    expect(terminal.activityStatus).toBe("idle");

    terminal.exited = false;
    tracker.markOutput("tab-1");
    tracker.delete("tab-1");
    vi.runAllTimers();
    expect(terminal.activityStatus).toBe("running");
    expect(onStatusChange).toHaveBeenCalledTimes(1);
  });
});
