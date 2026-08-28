// src/agentHooks/reportTypes.ts — What an agent says about the session it is
// running, and how an untrusted body becomes that.
//
// One dialect today: OpenCode's plugin sends its session id under `sessionID`.
// The normalization lives here so the receiver carries no per-agent branch and
// nothing downstream ever sees a raw body.
//
// See: asimov/changes/agent-session-hook-identity/design.md D3, D6.

/**
 * Agents that report the session they are running.
 *
 * Claude has its PID registry. Codex would need a trust grant it does not have
 * (design.md D3), and Cursor reports no session id at all — so neither is here
 * until it can actually report.
 */
export type ReportingAgent = "opencode";

export interface AgentSessionReport {
  /** The terminal whose credential carried this report — never taken from the body. */
  terminalId: string;
  agent: ReportingAgent;
  sessionId: string;
}

/** Long enough for every id dialect seen, short enough that a bad body cannot be stored. */
export const MAX_REPORT_ID_CHARS = 256;

/** A control character in an id is a malformed body, not a long one. */
function bounded(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > max) {
    return undefined;
  }
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return undefined;
    }
  }
  return trimmed;
}

/**
 * Read a producer's body as a report, or null when it names no session.
 *
 * Only the session id is read. Everything else a producer might send — prompt
 * text, tool input, model output — is dropped here rather than downstream, so
 * it never reaches a map, a log, or a row.
 */
export function parseAgentSessionReport(
  terminalId: string,
  agent: ReportingAgent,
  body: unknown,
): AgentSessionReport | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const sessionId = bounded((body as Record<string, unknown>).sessionID, MAX_REPORT_ID_CHARS);
  return sessionId === undefined ? null : { terminalId, agent, sessionId };
}
