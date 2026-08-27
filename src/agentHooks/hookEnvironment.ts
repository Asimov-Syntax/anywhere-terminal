// src/agentHooks/hookEnvironment.ts — What a terminal's environment carries so
// the agent inside it can report.
//
// Two things, from two owners: the per-terminal credential the receiver issues,
// and the configuration directory holding OpenCode's plugin. They are composed
// here rather than in the receiver, because the credential is per terminal and
// the directory is per window — and because reporting for one agent must not
// depend on another agent's hooks being switched on.

import type { SessionEnvironmentContributor } from "../cursor/CursorHookRuntime";

/**
 * Add a fixed set of variables to whatever the credential issuer contributes.
 *
 * `release` still reaches the issuer: the credential is what expires, and the
 * directory has nothing to revoke.
 */
export function withHookEnvironment(
  credentials: SessionEnvironmentContributor,
  fixed: Record<string, string>,
): SessionEnvironmentContributor {
  return {
    create: (sessionId) => ({ ...credentials.create(sessionId), ...fixed }),
    release: (sessionId) => credentials.release(sessionId),
  };
}
