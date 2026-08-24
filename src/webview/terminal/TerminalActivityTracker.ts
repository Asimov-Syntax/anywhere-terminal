export type TerminalActivityStatus = "idle" | "running" | "waiting";

export interface ActivityTerminal {
  exited: boolean;
  activityStatus: TerminalActivityStatus;
}

export interface TerminalActivityTrackerDeps {
  getTerminal: (sessionId: string) => ActivityTerminal | undefined;
  onStatusChange: (sessionId: string) => void;
  idleDelayMs?: number;
}

interface ActivityEvidence {
  outputActive: boolean;
  semanticWorking: boolean;
  waiting: boolean;
}

/**
 * Projects per-pane terminal activity from bounded PTY output and Cursor's
 * semantic evidence. Repeated output only refreshes its own idle timer.
 */
export class TerminalActivityTracker {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly evidence = new Map<string, ActivityEvidence>();
  private readonly idleDelayMs: number;

  constructor(private readonly deps: TerminalActivityTrackerDeps) {
    this.idleDelayMs = deps.idleDelayMs ?? 1500;
  }

  markOutput(sessionId: string): void {
    if (!this.getLiveTerminal(sessionId)) {
      return;
    }

    this.getEvidence(sessionId).outputActive = true;
    this.project(sessionId);
    this.clearTimer(sessionId);
    this.timers.set(
      sessionId,
      setTimeout(() => {
        this.timers.delete(sessionId);
        const evidence = this.evidence.get(sessionId);
        if (!evidence) {
          return;
        }
        evidence.outputActive = false;
        this.project(sessionId);
      }, this.idleDelayMs),
    );
  }

  setAgentStatus(sessionId: string, state: "working" | "idle" | null): void {
    if (!this.getLiveTerminal(sessionId)) {
      return;
    }

    this.getEvidence(sessionId).semanticWorking = state === "working";
    this.project(sessionId);
  }

  setWaiting(sessionId: string, waiting: boolean): void {
    if (!this.getLiveTerminal(sessionId)) {
      return;
    }

    this.getEvidence(sessionId).waiting = waiting;
    this.project(sessionId);
  }

  delete(sessionId: string): void {
    this.clearTimer(sessionId);
    this.evidence.delete(sessionId);
    const terminal = this.deps.getTerminal(sessionId);
    if (terminal && terminal.activityStatus !== "idle") {
      terminal.activityStatus = "idle";
      this.deps.onStatusChange(sessionId);
    }
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    for (const sessionId of this.evidence.keys()) {
      const terminal = this.deps.getTerminal(sessionId);
      if (terminal && terminal.activityStatus !== "idle") {
        terminal.activityStatus = "idle";
        this.deps.onStatusChange(sessionId);
      }
    }
    this.evidence.clear();
  }

  private getEvidence(sessionId: string): ActivityEvidence {
    let evidence = this.evidence.get(sessionId);
    if (!evidence) {
      evidence = { outputActive: false, semanticWorking: false, waiting: false };
      this.evidence.set(sessionId, evidence);
    }
    return evidence;
  }

  private getLiveTerminal(sessionId: string): ActivityTerminal | undefined {
    const terminal = this.deps.getTerminal(sessionId);
    return terminal && !terminal.exited ? terminal : undefined;
  }

  private project(sessionId: string): void {
    const terminal = this.getLiveTerminal(sessionId);
    const evidence = this.evidence.get(sessionId);
    if (!terminal || !evidence) {
      return;
    }

    const status: TerminalActivityStatus = evidence.waiting
      ? "waiting"
      : evidence.semanticWorking || evidence.outputActive
        ? "running"
        : "idle";
    if (terminal.activityStatus !== status) {
      terminal.activityStatus = status;
      this.deps.onStatusChange(sessionId);
    }
  }

  private clearTimer(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(sessionId);
    }
  }
}
