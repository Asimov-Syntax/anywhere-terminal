// src/agentHooks/hookEnvironment.ts — What a terminal's environment carries so
// the agent inside it can report.
//
// Two things, from two owners: the per-terminal credential the receiver issues,
// and the configuration directory holding OpenCode's plugin. They are composed
// here rather than in the receiver, because the credential is per terminal and
// the directory is per window — and because reporting for one agent must not
// depend on another agent's hooks being switched on.

import type { SessionEnvironmentContributor } from "./AgentHookRuntime";

/**
 * Add a set of variables to whatever the credential issuer contributes.
 *
 * `fixed` is read per terminal, not captured: the setting behind it can flip
 * long after this wrapper was installed, and the controller has no reason to
 * reinstall a contributor Cursor may be holding up on its own
 * (.reviews/round-1.md B5).
 *
 * A variable the terminal is already being spawned with is left alone — the
 * user's own selection is what the spec preserves, and it is per terminal
 * rather than per extension host (.reviews/round-1.md B3).
 *
 * `release` still reaches the issuer: the credential is what expires, and the
 * directory has nothing to revoke.
 */
export function withHookEnvironment(
  credentials: SessionEnvironmentContributor,
  fixed: () => Record<string, string>,
): SessionEnvironmentContributor {
  return {
    create: (sessionId, spawnEnv) => {
      const contributed = { ...credentials.create(sessionId, spawnEnv) };
      for (const [key, value] of Object.entries(fixed())) {
        if (spawnEnv?.[key] === undefined || spawnEnv[key] === "") {
          contributed[key] = value;
        }
      }
      return contributed;
    },
    release: (sessionId) => credentials.release(sessionId),
  };
}
