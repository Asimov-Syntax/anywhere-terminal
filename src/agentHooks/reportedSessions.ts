// src/agentHooks/reportedSessions.ts — The session each terminal last said it
// was running.
//
// One entry per live terminal, replaced by the newest report and dropped when
// the terminal's credential is revoked, so this map is bounded by the pane set
// rather than by how long the window has been open.

import type { AgentSessionReport, ReportingAgent } from "./reportTypes";

export interface ReportedSession {
  agent: ReportingAgent;
  sessionId: string;
}

export class ReportedSessions {
  private readonly byTerminal = new Map<string, ReportedSession>();

  /** The newest report wins: one pane can start a second session without restarting. */
  public record(report: AgentSessionReport): void {
    this.byTerminal.set(report.terminalId, { agent: report.agent, sessionId: report.sessionId });
  }

  public get(terminalId: string): ReportedSession | undefined {
    return this.byTerminal.get(terminalId);
  }

  /** Called with the credential's revocation, so a dead pane leaves nothing behind. */
  public release(terminalId: string): void {
    this.byTerminal.delete(terminalId);
  }

  public clear(): void {
    this.byTerminal.clear();
  }
}
