// src/agentHooks/agents/claude.ts — Claude's hook module: the transport hands it
// an authenticated, entitled, duplicate-correlated body, and it folds that into
// the pane's turn per agent-hook-server.md § 4.4.

import type {
  AgentHookChannel,
  AgentHookRegistration,
  AgentHookSession,
  AgentTurnReport,
  AgentTurnSubagent,
} from "../AgentHookRuntime";

/** Frozen: the wrapper script installed in a user's Claude config depends on both. */
export const CLAUDE_HOOK_SLUG = "claude";
export const CLAUDE_HOOK_ENV_VAR = "ANYWHERE_TERMINAL_CLAUDE_URL";

/**
 * Canonical, ordered Claude hook event list (agent-hook-server.md § 4.4, D7).
 * Registered in full now so WT-006.3 needs no second pass over the user's
 * configuration file. Claude ignores event names it does not recognise, so an
 * older build costs the user nothing.
 */
export const CLAUDE_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
] as const;

export type ClaudeHookEvent = (typeof CLAUDE_HOOK_EVENTS)[number];

/** Only `PreToolUse` is matcher-scoped; the rest register without one (D7). */
export const CLAUDE_MATCHER_EVENTS: ReadonlySet<string> = new Set<string>(["PreToolUse"]);

const CLAUDE_HOOK_EVENT_SET: ReadonlySet<string> = new Set<string>(CLAUDE_HOOK_EVENTS);

/**
 * Longest string kept from a payload.
 *
 * The transport already caps the body, but a single field inside a legal body
 * can still be most of a megabyte. These values are held per pane and some are
 * rendered, so each is bounded on the way in rather than wherever it is used.
 */
export const CLAUDE_FIELD_CAP = 4_096;

/** What the reducer reads. A field the payload did not supply is simply absent. */
export interface ClaudeHookPayload {
  event: ClaudeHookEvent;
  agentSessionId?: string;
  transcriptPath?: string;
  toolName?: string;
  /** `SessionStart` only: why the session began, which decides whether a turn completed. */
  source?: string;
  subagentId?: string;
  subagentName?: string;
  interrupted?: boolean;
}

function boundedString(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, CLAUDE_FIELD_CAP) : undefined;
}

/**
 * Decodes one posted body into the fields the reducer reads.
 *
 * The body is data, never instructions: it is parsed, each field is checked for
 * the type it is used as, and anything else is dropped rather than guessed at.
 * An unrecognised event returns `null` — a reducer asked to guess at an event it
 * does not know is how a status pipeline starts inventing turns.
 */
export function decodeClaudeHookPayload(body: Buffer): ClaudeHookPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const raw = parsed as Record<string, unknown>;
  const event = raw.hook_event_name;
  if (typeof event !== "string" || !CLAUDE_HOOK_EVENT_SET.has(event)) {
    return null;
  }
  // Present on every event and the key everything else hangs off; a payload
  // without a usable one describes no session we could attribute it to.
  const agentSessionId = boundedString(raw.session_id);
  if (agentSessionId === undefined) {
    return null;
  }

  const payload: ClaudeHookPayload = { event: event as ClaudeHookEvent, agentSessionId };
  const transcriptPath = boundedString(raw.transcript_path);
  const toolName = boundedString(raw.tool_name);
  const source = boundedString(raw.source);
  const subagentId = boundedString(raw.agent_id);
  const subagentName = boundedString(raw.agent_type);
  if (transcriptPath !== undefined) {
    payload.transcriptPath = transcriptPath;
  }
  if (toolName !== undefined) {
    payload.toolName = toolName;
  }
  if (source !== undefined) {
    payload.source = source;
  }
  if (subagentId !== undefined) {
    payload.subagentId = subagentId;
  }
  if (subagentName !== undefined) {
    payload.subagentName = subagentName;
  }
  // Only ever read, never synthesised: the events this reducer registers do not
  // currently carry it, so its absence is the normal case rather than a gap.
  if (typeof raw.is_interrupt === "boolean") {
    payload.interrupted = raw.is_interrupt;
  }
  return payload;
}

/** The tool name, not the event name, is what makes a `PreToolUse` a wait (§ 4.4). */
const CLAUDE_QUESTION_TOOL = "AskUserQuestion";

/**
 * Most delegations a turn will track. A `Map` stops a repeated start counting
 * twice, but nothing bounds how many distinct children one turn may report.
 */
export const CLAUDE_ROSTER_CAP = 32;

/**
 * Folds Claude's hook events into the turn its pane is having (§ 4.4).
 *
 * Idempotent per event by construction rather than by detection: the next state
 * is a function of the event and the current state, the roster is keyed by the
 * reported child id, and `stateStartedAt` moves only when the published state
 * actually changes. A duplicate the transport did not correlate therefore costs
 * nothing.
 */
class ClaudeHookAgentSession implements AgentHookSession {
  private lead: "working" | "waiting" | "done" = "done";
  private stateStartedAt: number;
  private published: AgentTurnReport["state"] | null = null;
  private readonly roster = new Map<string, AgentTurnSubagent>();
  private agentSessionId: string | undefined;
  private transcriptPath: string | undefined;
  private toolName: string | undefined;
  private interactivePrompt: string | undefined;
  private interrupted: boolean | undefined;
  private sessionBoundary = false;

  public constructor(private readonly channel: AgentHookChannel) {
    this.stateStartedAt = channel.now();
  }

  public handle(body: Buffer): void {
    const payload = decodeClaudeHookPayload(body);
    if (payload === null) {
      return;
    }
    if (!this.apply(payload)) {
      return;
    }
    this.seen = true;
    this.channel.publish(this.report());
  }

  public dispose(): void {
    this.roster.clear();
  }

  /** Returns whether the event said anything about this pane at all. */
  private apply(payload: ClaudeHookPayload): boolean {
    // Identity travels with every event and is only ever carried, never acted on.
    this.agentSessionId = payload.agentSessionId;
    if (payload.transcriptPath !== undefined) {
      this.transcriptPath = payload.transcriptPath;
    }

    switch (payload.event) {
      case "SessionStart":
        // A resume, clear, or return from compaction lands idle. Recorded as a
        // boundary so nothing downstream reads it as a turn that completed.
        this.clearPerEvent();
        this.roster.clear();
        this.lead = "done";
        this.sessionBoundary = true;
        return true;
      case "UserPromptSubmit":
        this.clearPerEvent();
        this.lead = "working";
        return true;
      case "PreToolUse":
        this.clearPerEvent();
        this.toolName = payload.toolName;
        if (payload.toolName === CLAUDE_QUESTION_TOOL) {
          this.lead = "waiting";
          this.interactivePrompt = JSON.stringify({ questions: null });
          return true;
        }
        this.lead = "working";
        return true;
      case "PermissionRequest":
        this.clearPerEvent();
        this.toolName = payload.toolName;
        this.lead = "waiting";
        this.interactivePrompt = JSON.stringify({ approval: { tool: payload.toolName ?? null } });
        return true;
      case "Stop":
      case "StopFailure":
        this.clearPerEvent();
        this.lead = "done";
        if (payload.interrupted !== undefined) {
          this.interrupted = payload.interrupted;
        }
        return true;
      case "SubagentStart": {
        if (payload.subagentId === undefined) {
          return false;
        }
        this.clearPerEvent();
        this.upsertChild(payload.subagentId, payload.subagentName);
        // A delegation running proves the pane is working even where no lead
        // event established it — but it never fabricates lead completion.
        if (this.lead === "done") {
          this.lead = "working";
        }
        return true;
      }
      case "SubagentStop": {
        // A child nothing recorded starting makes no claim about this pane.
        if (payload.subagentId === undefined || !this.roster.has(payload.subagentId)) {
          return false;
        }
        this.clearPerEvent();
        this.roster.delete(payload.subagentId);
        return true;
      }
    }
  }

  private upsertChild(id: string, name: string | undefined): void {
    const existing = this.roster.get(id);
    if (existing !== undefined) {
      // A repeated start is one child, and does not restart its clock.
      return;
    }
    if (this.roster.size >= CLAUDE_ROSTER_CAP) {
      const oldest = this.roster.keys().next().value;
      if (oldest !== undefined) {
        this.roster.delete(oldest);
      }
    }
    this.roster.set(id, {
      id,
      ...(name === undefined ? {} : { name }),
      state: "working",
      startedAt: this.channel.now(),
    });
  }

  /**
   * Drops everything that describes one event rather than the turn.
   *
   * An interactive prompt carried into the next event is how a stale question
   * card outlives the question it asked.
   */
  private clearPerEvent(): void {
    this.interactivePrompt = undefined;
    this.toolName = undefined;
    this.interrupted = undefined;
    this.sessionBoundary = false;
  }

  /**
   * The state the pane is in, which is the lead's — except that a lead who
   * finished while a delegation is still running has not finished.
   */
  private effectiveState(): AgentTurnReport["state"] {
    if (this.lead === "done" && [...this.roster.values()].some((child) => child.state === "working")) {
      return "working";
    }
    return this.lead;
  }

  private report(): AgentTurnReport {
    const state = this.effectiveState();
    if (this.published !== state) {
      this.stateStartedAt = this.channel.now();
      this.published = state;
    }
    return {
      state,
      stateStartedAt: this.stateStartedAt,
      ...(this.agentSessionId === undefined ? {} : { agentSessionId: this.agentSessionId }),
      ...(this.transcriptPath === undefined ? {} : { transcriptPath: this.transcriptPath }),
      ...(this.toolName === undefined ? {} : { toolName: this.toolName }),
      ...(this.interactivePrompt === undefined ? {} : { interactivePrompt: this.interactivePrompt }),
      ...(this.interrupted === undefined ? {} : { interrupted: this.interrupted }),
      ...(this.sessionBoundary ? { sessionBoundary: true } : {}),
      subagents: [...this.roster.values()],
    };
  }
}

export function claudeAgentRegistration(): AgentHookRegistration {
  return {
    id: "claude",
    slug: CLAUDE_HOOK_SLUG,
    envVar: CLAUDE_HOOK_ENV_VAR,
    createSession: (channel: AgentHookChannel) => new ClaudeHookAgentSession(channel),
  };
}
