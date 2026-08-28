// src/agentHooks/agents/opencode.ts — OpenCode's terminal-bound session
// identity report, reduced behind the shared AgentHookRuntime boundary.

import type { AgentHookRegistration, AgentHookSession } from "../AgentHookRuntime";
import { parseAgentSessionReport } from "../reportTypes";

export const OPENCODE_HOOK_SLUG = "opencode";
export const OPENCODE_HOOK_ENV_VAR = "ANYWHERE_TERMINAL_AGENT_HOOK_URL";

export function opencodeAgentRegistration(): AgentHookRegistration {
  return {
    id: "opencode",
    slug: OPENCODE_HOOK_SLUG,
    envVar: OPENCODE_HOOK_ENV_VAR,
    createSession: (channel): AgentHookSession => ({
      handle(body) {
        let decoded: unknown;
        try {
          decoded = JSON.parse(body.toString("utf8"));
        } catch {
          channel.reason("malformed-json");
          return;
        }
        const report = parseAgentSessionReport(channel.sessionId, "opencode", decoded);
        if (report === null) {
          channel.reason("malformed-json");
          return;
        }
        // The update already carries the agent and terminal ids. Publishing the
        // validated session id keeps the generic runtime's state vocabulary
        // small and lets its ordinary teardown publish null on revoke.
        channel.publish(report.sessionId);
      },
      dispose() {},
    }),
  };
}
