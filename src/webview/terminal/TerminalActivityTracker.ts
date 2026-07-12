export interface ActivityTerminal {
  exited: boolean;
  activityStatus: "idle" | "running";
}

export interface TerminalActivityTrackerDeps {
  getTerminal: (sessionId: string) => ActivityTerminal | undefined;
  onStatusChange: (sessionId: string) => void;
  idleDelayMs?: number;
}

/**
 * Converts PTY output into a bounded tab activity signal. Repeated output only
 * refreshes the idle timer, so high-volume terminals do not continuously
 * rebuild the tab bar.
 */
export class TerminalActivityTracker {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly idleDelayMs: number;

  constructor(private readonly deps: TerminalActivityTrackerDeps) {
    this.idleDelayMs = deps.idleDelayMs ?? 1500;
  }

  markOutput(sessionId: string): void {
    const terminal = this.deps.getTerminal(sessionId);
    if (!terminal || terminal.exited) {
      return;
    }

    if (terminal.activityStatus !== "running") {
      terminal.activityStatus = "running";
      this.deps.onStatusChange(sessionId);
    }

    this.clearTimer(sessionId);
    this.timers.set(
      sessionId,
      setTimeout(() => {
        this.timers.delete(sessionId);
        const current = this.deps.getTerminal(sessionId);
        if (!current || current.exited || current.activityStatus === "idle") {
          return;
        }
        current.activityStatus = "idle";
        this.deps.onStatusChange(sessionId);
      }, this.idleDelayMs),
    );
  }

  delete(sessionId: string): void {
    this.clearTimer(sessionId);
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private clearTimer(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(sessionId);
    }
  }
}
