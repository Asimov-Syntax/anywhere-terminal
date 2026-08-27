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

/** The tool name, not the event name, is what makes a `PreToolUse` a wait (§ 4.4). */
const CLAUDE_QUESTION_TOOL = "AskUserQuestion";

/** Most questions carried from one `AskUserQuestion`; the rest are dropped. */
export const CLAUDE_QUESTION_CAP = 8;

/** One question as the panel needs it: what was asked, and nothing executable. */
export interface ClaudeReportedQuestion {
  question: string;
  header?: string;
}

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
  /** `PreToolUse` for the question tool only: what the agent actually asked. */
  questions?: readonly ClaudeReportedQuestion[];
  /** `PermissionRequest` only: what is being approved, derived rather than reported. */
  approvalSummary?: string;
}

function boundedString(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, CLAUDE_FIELD_CAP) : undefined;
}

/**
 * An identifier the payload had to supply, or nothing.
 *
 * The empty string is a string, so the plain bound would let `""` through every
 * `!== undefined` guard downstream: an empty child id would open a roster entry
 * for a delegation that does not exist, which is invented work rather than
 * missing work (.reviews/round-1.md W4).
 */
function requiredString(value: unknown): string | undefined {
  const bounded = boundedString(value);
  return bounded === undefined || bounded.length === 0 ? undefined : bounded;
}

/**
 * The questions an `AskUserQuestion` asked, bounded in count and in length.
 *
 * Only the two human-readable fields are kept. The options carry the answers the
 * panel cannot submit yet (§ 4.4 defers answering), and nothing else in a tool
 * input is something this row needs to hold.
 */
function boundedQuestions(value: unknown): ClaudeReportedQuestion[] | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const raw = (value as Record<string, unknown>).questions;
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const questions: ClaudeReportedQuestion[] = [];
  for (const item of raw.slice(0, CLAUDE_QUESTION_CAP)) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const question = requiredString(record.question);
    if (question === undefined) {
      continue;
    }
    const header = requiredString(record.header);
    questions.push({ question, ...(header === undefined ? {} : { header }) });
  }
  return questions.length === 0 ? undefined : questions;
}

/**
 * What a permission request is asking for, as one bounded line.
 *
 * § 4.4 documents a `summary` on the approval shape, but no hook payload carries
 * one — `PermissionRequest` sends `tool_name` and `tool_input` and nothing else.
 * So it is derived from the request that was actually made rather than left to a
 * field that is never sent (D6's rule, applied to a smaller gap).
 */
function approvalSummaryOf(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return requiredString(value);
  }
  try {
    return requiredString(JSON.stringify(value));
  } catch {
    return undefined;
  }
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
  const agentSessionId = requiredString(raw.session_id);
  if (agentSessionId === undefined) {
    return null;
  }

  const payload: ClaudeHookPayload = { event: event as ClaudeHookEvent, agentSessionId };
  const transcriptPath = boundedString(raw.transcript_path);
  const toolName = boundedString(raw.tool_name);
  const source = boundedString(raw.source);
  const subagentId = requiredString(raw.agent_id);
  const subagentName = requiredString(raw.agent_type);
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
  // The tool input is read for exactly the two events whose prompt shape § 4.4
  // documents, and never carried whole.
  if (payload.event === "PreToolUse" && toolName === CLAUDE_QUESTION_TOOL) {
    const questions = boundedQuestions(raw.tool_input);
    if (questions !== undefined) {
      payload.questions = questions;
    }
  }
  if (payload.event === "PermissionRequest") {
    const approvalSummary = approvalSummaryOf(raw.tool_input);
    if (approvalSummary !== undefined) {
      payload.approvalSummary = approvalSummary;
    }
  }
  return payload;
}

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
  /**
   * Children the cap displaced while they were working, still by id.
   *
   * A count would be cheaper and wrong: it cannot tell a stop for one of these
   * from a stop for a child nothing recorded starting, so any stray or repeated
   * stop would settle an overflow it knows nothing about (.reviews/round-2.md
   * B4).
   */
  private readonly overflow = new Set<string>();
  /**
   * Set only when identity itself overflowed, and cleared only at a session
   * boundary.
   *
   * Past this point the turn genuinely does not know which children are still
   * running, so it holds open rather than guessing. Nothing a later event says
   * can clear it — that is the difference between bounded and merely small.
   */
  private overflowUnknown = false;
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
    this.channel.publish(this.report());
  }

  public dispose(): void {
    this.roster.clear();
    this.overflow.clear();
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
        this.overflow.clear();
        this.overflowUnknown = false;
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
          this.interactivePrompt = JSON.stringify({ questions: payload.questions ?? null });
          return true;
        }
        this.lead = "working";
        return true;
      case "PermissionRequest":
        this.clearPerEvent();
        this.toolName = payload.toolName;
        this.lead = "waiting";
        this.interactivePrompt = JSON.stringify({
          approval: {
            tool: payload.toolName ?? null,
            ...(payload.approvalSummary === undefined ? {} : { summary: payload.approvalSummary }),
          },
        });
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
        if (payload.subagentId === undefined || !this.upsertChild(payload.subagentId, payload.subagentName)) {
          // A repeat that started nothing changed nothing, and an event that
          // changed nothing must publish nothing — republishing here would
          // clear the question the row is still waiting on (round-2.md W8).
          return false;
        }
        this.clearPerEvent();
        // The cached lead is left exactly as it was: § 4.4 makes this row a
        // roster change only. `effectiveState` overlays `working` for as long as
        // a child is running, so promoting the lead here would say the same
        // thing once and then keep saying it after the child had stopped
        // (.reviews/round-1.md B3).
        return true;
      }
      case "SubagentStop": {
        if (payload.subagentId === undefined) {
          return false;
        }
        // A stop settles the child it names and no other. Matching by identity
        // is what stops a stray or repeated stop from retiring some unrelated
        // delegation the cap had displaced.
        if (!this.roster.delete(payload.subagentId) && !this.overflow.delete(payload.subagentId)) {
          // A child nothing recorded starting makes no claim about this pane.
          return false;
        }
        this.clearPerEvent();
        return true;
      }
    }
  }

  /** Returns whether this actually started a delegation nothing was tracking. */
  private upsertChild(id: string, name: string | undefined): boolean {
    // A repeated start is one child, wherever that child is already tracked, and
    // it does not restart its clock.
    if (this.roster.has(id) || this.overflow.has(id)) {
      return false;
    }
    if (this.roster.size >= CLAUDE_ROSTER_CAP) {
      // The cap bounds what the roster REMEMBERS, and must not bound what the
      // turn admits is still running: dropping a working child outright would
      // let the pane report a finished turn while that child worked on. An idle
      // child is forgettable; otherwise the newcomer is remembered by id alone,
      // which holds the turn open without holding its whole record.
      const spare = [...this.roster.values()].find((child) => child.state !== "working");
      if (spare === undefined) {
        if (this.overflow.size >= CLAUDE_ROSTER_CAP) {
          // Identity itself has now overflowed. Holding open on a sticky flag is
          // the honest answer: the turn cannot say which children remain, and
          // guessing is what makes a status pipeline lie.
          this.overflowUnknown = true;
          return true;
        }
        this.overflow.add(id);
        return true;
      }
      this.roster.delete(spare.id);
    }
    this.roster.set(id, {
      id,
      ...(name === undefined ? {} : { name }),
      state: "working",
      startedAt: this.channel.now(),
    });
    return true;
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
    if (this.lead !== "done") {
      return this.lead;
    }
    const working =
      this.overflowUnknown ||
      this.overflow.size > 0 ||
      [...this.roster.values()].some((child) => child.state === "working");
    return working ? "working" : "done";
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
