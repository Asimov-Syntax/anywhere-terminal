// src/agentHooks/agents/cursor.ts — Cursor's hook module: JSON decode plus the
// exact D7 event → semantic-state table, per-session quiet window and freshness
// expiry. Transport, auth, dedup, and containment belong to AgentHookRuntime.

import type { AgentHookChannel, AgentHookRegistration, AgentHookSession } from "../AgentHookRuntime";

export type CursorSemanticState = "working" | "idle";

export const CURSOR_HOOK_QUIET_WINDOW_MS = 1_500;
export const CURSOR_HOOK_FRESHNESS_MS = 30 * 60 * 1000;

/** Frozen: already referenced by wrapper scripts installed in users' Cursor config. */
export const CURSOR_HOOK_SLUG = "cursor";
export const CURSOR_HOOK_ENV_VAR = "ANYWHERE_TERMINAL_CURSOR_URL";

/**
 * Canonical, ordered Cursor hook event list. The installer registers exactly
 * these, and `EVENT_EFFECTS` below is keyed by them, so a drift between what
 * Cursor is told to send and what this module decodes is a type error rather
 * than a silently ignored event.
 */
export const CURSOR_HOOK_EVENTS = [
  "sessionStart",
  "beforeSubmitPrompt",
  "preToolUse",
  "postToolUse",
  "postToolUseFailure",
  "beforeShellExecution",
  "afterShellExecution",
  "beforeMCPExecution",
  "afterMCPExecution",
  "afterAgentResponse",
  "stop",
  "sessionEnd",
] as const;

export type CursorHookEvent = (typeof CURSOR_HOOK_EVENTS)[number];

/** Exact D7 event → effect table. No hook produces "waiting"; unknown events are ignored. */
type CursorHookEventEffect = "clear" | "working" | "quiet";

const EVENT_EFFECTS: Record<CursorHookEvent, CursorHookEventEffect> = {
  sessionStart: "clear",
  beforeSubmitPrompt: "working",
  preToolUse: "working",
  postToolUse: "working",
  postToolUseFailure: "working",
  beforeShellExecution: "working",
  afterShellExecution: "working",
  beforeMCPExecution: "working",
  afterMCPExecution: "working",
  afterAgentResponse: "quiet",
  stop: "quiet",
  sessionEnd: "quiet",
};

export interface CursorAgentOptions {
  quietWindowMs?: number;
  freshnessMs?: number;
}

class CursorHookAgentSession implements AgentHookSession {
  private quietTimer: unknown;
  private freshnessTimer: unknown;

  public constructor(
    private readonly channel: AgentHookChannel,
    private readonly quietWindowMs: number,
    private readonly freshnessMs: number,
  ) {}

  public handle(body: Buffer): void {
    const effect = this.decode(body);
    if (!effect) {
      return;
    }
    if (effect === "clear") {
      this.cancelTimers();
      this.channel.publish(null);
      return;
    }
    if (effect === "working") {
      if (this.quietTimer !== undefined) {
        this.channel.clearTimer(this.quietTimer);
        this.quietTimer = undefined;
      }
      this.channel.publish("working");
      this.armFreshness();
      return;
    }
    // "quiet": (re)arm a single cancelable candidate-idle window.
    if (this.quietTimer !== undefined) {
      this.channel.clearTimer(this.quietTimer);
    }
    this.quietTimer = this.channel.setTimer(() => {
      this.quietTimer = undefined;
      this.channel.publish("idle");
      this.armFreshness();
    }, this.quietWindowMs);
  }

  public dispose(): void {
    this.cancelTimers();
    this.channel.publish(null);
  }

  /** D10: parse only the event name — never retain the body. */
  private decode(body: Buffer): CursorHookEventEffect | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf8"));
    } catch {
      this.channel.reason("malformed-json");
      return undefined;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      this.channel.reason("malformed-json");
      return undefined;
    }
    const eventName = (parsed as Record<string, unknown>).hook_event_name;
    if (typeof eventName !== "string" || eventName.length === 0) {
      this.channel.reason("malformed-json");
      return undefined;
    }
    const effect = (EVENT_EFFECTS as Record<string, CursorHookEventEffect | undefined>)[eventName];
    if (!effect) {
      this.channel.reason("unknown-event");
      return undefined;
    }
    return effect;
  }

  private armFreshness(): void {
    if (this.freshnessTimer !== undefined) {
      this.channel.clearTimer(this.freshnessTimer);
    }
    this.freshnessTimer = this.channel.setTimer(() => {
      this.freshnessTimer = undefined;
      this.channel.publish(null);
    }, this.freshnessMs);
  }

  private cancelTimers(): void {
    if (this.quietTimer !== undefined) {
      this.channel.clearTimer(this.quietTimer);
      this.quietTimer = undefined;
    }
    if (this.freshnessTimer !== undefined) {
      this.channel.clearTimer(this.freshnessTimer);
      this.freshnessTimer = undefined;
    }
  }
}

export function cursorAgentRegistration(options: CursorAgentOptions = {}): AgentHookRegistration {
  const quietWindowMs = options.quietWindowMs ?? CURSOR_HOOK_QUIET_WINDOW_MS;
  const freshnessMs = options.freshnessMs ?? CURSOR_HOOK_FRESHNESS_MS;
  return {
    id: "cursor",
    slug: CURSOR_HOOK_SLUG,
    envVar: CURSOR_HOOK_ENV_VAR,
    createSession: (channel) => new CursorHookAgentSession(channel, quietWindowMs, freshnessMs),
  };
}
