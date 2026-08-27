// src/agentHooks/agents/claude.ts — Claude's hook module. In WT-006.2 it is
// transport-only (install-claude-hooks D6): the runtime authenticates, entitles,
// dedups, and contains the post, and this session deliberately publishes nothing.
// The event → turn-state reducer of agent-hook-server.md § 4.4 is WT-006.3's
// work; inventing a coarse mapping here would be a mapping no design owns.

import type { AgentHookChannel, AgentHookRegistration, AgentHookSession } from "../AgentHookRuntime";

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

/**
 * Accepts and drops. Not a placeholder for missing work — the transport
 * guarantees (auth, entitlement, dedup, containment) all run before `handle`
 * is reached, so WT-006.3 replaces this body without touching transport or
 * configuration.
 */
class ClaudeHookAgentSession implements AgentHookSession {
  public handle(_body: Buffer): void {
    // Intentionally empty: no state is published until WT-006.3.
  }

  public dispose(): void {
    // No timers or state to release.
  }
}

export function claudeAgentRegistration(): AgentHookRegistration {
  return {
    id: "claude",
    slug: CLAUDE_HOOK_SLUG,
    envVar: CLAUDE_HOOK_ENV_VAR,
    createSession: (_channel: AgentHookChannel) => new ClaudeHookAgentSession(),
  };
}
