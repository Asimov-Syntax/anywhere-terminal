import {
  classifyTitle,
  type LiveActivity,
  MAX_REPORTED_TITLE_CHARS,
  OUTPUT_IDLE_WINDOW_MS,
  projectLiveActivity,
  type TitleClass,
} from "../../shared/paneEvidence";
import { boundedTitleSignature } from "./titleSignature";

/**
 * Alias of the shared three-state activity, kept as its own name because
 * `WebviewState` and `TabBarUtils` spell the tab's status this way throughout.
 * Declaring it as the alias is what stops the tab's vocabulary and the shared
 * rules drifting apart (add-host-pane-evidence design.md D5).
 */
export type TerminalActivityStatus = LiveActivity;

export interface ActivityTerminal {
  exited: boolean;
  activityStatus: TerminalActivityStatus;
}

export interface TerminalActivityTrackerDeps {
  getTerminal: (sessionId: string) => ActivityTerminal | undefined;
  onStatusChange: (sessionId: string) => void;
  /**
   * Called when a pane's waiting evidence FLIPS — never on the repeated
   * `setWaiting(id, false)` the output path issues on every write.
   *
   * The gate is the point: a pane that has never waited must report nothing, so
   * the host can tell "no waiting evidence yet" from "proven not waiting"
   * (add-host-pane-evidence design.md D3, D7).
   */
  onWaitingChange?: (sessionId: string, waiting: boolean) => void;
  idleDelayMs?: number;
}

/** Mirrors the host store's classification so both sides agree on one title. */
interface ActivityEvidence {
  outputActive: boolean;
  semanticWorking: boolean;
  waiting: boolean;
  /** What the pane's last title claimed — the same rule the host applies. */
  titleClass: TitleClass;
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
    this.idleDelayMs = deps.idleDelayMs ?? OUTPUT_IDLE_WINDOW_MS;
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

  /**
   * Record what this pane's title claims.
   *
   * Normalized with the SAME function the host reporter uses, so the tab and the
   * worktree row classify one title identically — the whole reason the rule
   * lives in `shared/paneEvidence.ts` rather than in each of them.
   */
  setTitle(sessionId: string, rawTitle: string): void {
    const evidence = this.getEvidence(sessionId);
    const next = classifyTitle(boundedTitleSignature(rawTitle, MAX_REPORTED_TITLE_CHARS));
    if (evidence.titleClass === next) {
      return;
    }
    evidence.titleClass = next;
    this.project(sessionId);
  }

  setWaiting(sessionId: string, waiting: boolean): void {
    if (!this.getLiveTerminal(sessionId)) {
      return;
    }

    const evidence = this.getEvidence(sessionId);
    if (evidence.waiting === waiting) {
      return;
    }
    evidence.waiting = waiting;
    this.project(sessionId);
    this.deps.onWaitingChange?.(sessionId, waiting);
  }

  delete(sessionId: string): void {
    this.clearTimer(sessionId);
    this.retractWaiting(sessionId);
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
      this.retractWaiting(sessionId);
      const terminal = this.deps.getTerminal(sessionId);
      if (terminal && terminal.activityStatus !== "idle") {
        terminal.activityStatus = "idle";
        this.deps.onStatusChange(sessionId);
      }
    }
    this.evidence.clear();
  }

  /**
   * A pane going away stops waiting; a pane that was not waiting reports
   * nothing, so teardown cannot manufacture proven-absent evidence for a pane
   * nothing was ever known about.
   */
  private retractWaiting(sessionId: string): void {
    const evidence = this.evidence.get(sessionId);
    if (evidence?.waiting) {
      evidence.waiting = false;
      this.deps.onWaitingChange?.(sessionId, false);
    }
  }

  private getEvidence(sessionId: string): ActivityEvidence {
    let evidence = this.evidence.get(sessionId);
    if (!evidence) {
      evidence = { outputActive: false, semanticWorking: false, waiting: false, titleClass: "unknown" };
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

    // `titleClass` is supplied for real in WT-004.1 task 1_4, which feeds the
    // tab the same classification the host uses; `unknown` is today's behaviour.
    const status = projectLiveActivity(evidence);
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
