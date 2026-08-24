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
    expect(terminal.activityStatus).toBe("idle");
    expect(onStatusChange).toHaveBeenCalledTimes(2);
  });

  it("projects waiting above semantic and output activity", () => {
    const terminal: ActivityTerminal = { exited: false, activityStatus: "idle" };
    const tracker = new TerminalActivityTracker({
      getTerminal: () => terminal,
      onStatusChange: vi.fn(),
      idleDelayMs: 100,
    });

    tracker.markOutput("tab-1");
    tracker.setAgentStatus("tab-1", "working");
    tracker.setWaiting("tab-1", true);
    expect(terminal.activityStatus).toBe("waiting");

    tracker.setWaiting("tab-1", false);
    expect(terminal.activityStatus).toBe("running");
    tracker.setAgentStatus("tab-1", "idle");
    expect(terminal.activityStatus).toBe("running");
    vi.advanceTimersByTime(100);
    expect(terminal.activityStatus).toBe("idle");
  });

  it("keeps semantic activity when the output quiet period expires", () => {
    const terminal: ActivityTerminal = { exited: false, activityStatus: "idle" };
    const tracker = new TerminalActivityTracker({
      getTerminal: () => terminal,
      onStatusChange: vi.fn(),
      idleDelayMs: 100,
    });

    tracker.markOutput("tab-1");
    tracker.setAgentStatus("tab-1", "working");
    vi.advanceTimersByTime(100);

    expect(terminal.activityStatus).toBe("running");
    tracker.setAgentStatus("tab-1", null);
    expect(terminal.activityStatus).toBe("idle");
  });

  it("immediately clears all evidence on delete and ignores unknown panes", () => {
    const terminals = new Map<string, ActivityTerminal>([
      ["tab-1", { exited: false, activityStatus: "idle" }],
      ["tab-2", { exited: false, activityStatus: "idle" }],
    ]);
    const tracker = new TerminalActivityTracker({
      getTerminal: (sessionId) => terminals.get(sessionId),
      onStatusChange: vi.fn(),
      idleDelayMs: 100,
    });

    tracker.setAgentStatus("unknown", "working");
    tracker.setWaiting("unknown", true);
    expect(terminals.get("tab-1")?.activityStatus).toBe("idle");

    tracker.setAgentStatus("tab-1", "working");
    tracker.setWaiting("tab-2", true);
    expect(terminals.get("tab-1")?.activityStatus).toBe("running");
    expect(terminals.get("tab-2")?.activityStatus).toBe("waiting");

    tracker.delete("tab-1");
    expect(terminals.get("tab-1")?.activityStatus).toBe("idle");
    expect(terminals.get("tab-2")?.activityStatus).toBe("waiting");
  });

  it("clears all evidence and timers on disposal", () => {
    const terminals = new Map<string, ActivityTerminal>([
      ["tab-1", { exited: false, activityStatus: "idle" }],
      ["tab-2", { exited: false, activityStatus: "idle" }],
    ]);
    const tracker = new TerminalActivityTracker({
      getTerminal: (sessionId) => terminals.get(sessionId),
      onStatusChange: vi.fn(),
      idleDelayMs: 100,
    });

    tracker.markOutput("tab-1");
    tracker.setAgentStatus("tab-1", "working");
    tracker.setWaiting("tab-2", true);
    tracker.dispose();
    vi.runAllTimers();

    expect(terminals.get("tab-1")?.activityStatus).toBe("idle");
    expect(terminals.get("tab-2")?.activityStatus).toBe("idle");
  });
});
