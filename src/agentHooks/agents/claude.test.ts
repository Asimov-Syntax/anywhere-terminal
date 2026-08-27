// src/agentHooks/agents/claude.test.ts — Claude is transport-only in WT-006.2
// (design D6): the runtime must authenticate, entitle, and dedup its posts, and
// the session must never publish a state. The reducer lands in WT-006.3.

import { afterEach, describe, expect, it } from "vitest";
import { type AgentActivityUpdate, type AgentHookReasonCode, createAgentHookRuntime } from "../AgentHookRuntime";
import { CLAUDE_HOOK_ENV_VAR, CLAUDE_HOOK_EVENTS, CLAUDE_HOOK_SLUG, claudeAgentRegistration } from "./claude";

const runtimes: Array<{ dispose(): void }> = [];

afterEach(() => {
  runtimes.splice(0).forEach((runtime) => {
    runtime.dispose();
  });
});

async function fixture() {
  const status: AgentActivityUpdate[] = [];
  const reasons: Array<{ reason: AgentHookReasonCode; sessionSuffix: string }> = [];
  const runtime = await createAgentHookRuntime(
    [claudeAgentRegistration()],
    {},
    {
      onStatus: (update) => status.push(update),
      onReasonCode: (reason, sessionSuffix) => reasons.push({ reason, sessionSuffix }),
    },
  );
  runtimes.push(runtime);
  runtime.setAgentEnabled("claude", true);
  return { runtime, status, reasons };
}

function post(url: string, body: string): Promise<{ status: number }> {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body }).then((r) => ({
    status: r.status,
  }));
}

function eventBody(hook_event_name: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ hook_event_name, session_id: "abc", ...extra });
}

describe("claude agent registration", () => {
  it("freezes the slug and environment variable the wrapper script depends on", () => {
    expect(CLAUDE_HOOK_SLUG).toBe("claude");
    expect(CLAUDE_HOOK_ENV_VAR).toBe("ANYWHERE_TERMINAL_CLAUDE_URL");
  });

  it("registers exactly the design D7 event set, in order", () => {
    expect([...CLAUDE_HOOK_EVENTS]).toEqual([
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PermissionRequest",
      "Stop",
      "StopFailure",
      "SubagentStart",
      "SubagentStop",
    ]);
  });

  it("mints coordinates under its own environment variable", async () => {
    const { runtime } = await fixture();
    const env = runtime.create("s");
    expect(env[CLAUDE_HOOK_ENV_VAR]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/s\/[0-9a-f]+$/);
  });

  it("accepts an authenticated post and publishes no state (D6)", async () => {
    const { runtime, status, reasons } = await fixture();
    const env = runtime.create("s");

    const response = await post(`${env[CLAUDE_HOOK_ENV_VAR]}/${CLAUDE_HOOK_SLUG}`, eventBody("UserPromptSubmit"));

    expect(response.status).toBe(204);
    expect(status).toEqual([]);
    expect(reasons.some((r) => r.reason === "agent-error")).toBe(false);
  });

  it("publishes no state for any registered event", async () => {
    const { runtime, status } = await fixture();
    const env = runtime.create("s");

    for (const event of CLAUDE_HOOK_EVENTS) {
      await post(`${env[CLAUDE_HOOK_ENV_VAR]}/${CLAUDE_HOOK_SLUG}`, eventBody(event, { nonce: event }));
    }

    expect(status).toEqual([]);
  });

  it("still refuses an unentitled post after the agent is disabled", async () => {
    const { runtime, reasons } = await fixture();
    const env = runtime.create("s");
    runtime.setAgentEnabled("claude", false);

    const response = await post(`${env[CLAUDE_HOOK_ENV_VAR]}/${CLAUDE_HOOK_SLUG}`, eventBody("Stop"));

    expect(response.status).toBe(204);
    expect(reasons.some((r) => r.reason === "disabled" || r.reason === "unknown-session")).toBe(true);
  });

  it("dedups an identical body inside the window", async () => {
    const { runtime, reasons } = await fixture();
    const env = runtime.create("s");
    const body = eventBody("PreToolUse", { fixed: true });

    await post(`${env[CLAUDE_HOOK_ENV_VAR]}/${CLAUDE_HOOK_SLUG}`, body);
    await post(`${env[CLAUDE_HOOK_ENV_VAR]}/${CLAUDE_HOOK_SLUG}`, body);

    expect(reasons).toContainEqual({ reason: "duplicate-event", sessionSuffix: "s" });
  });

  it("survives a payload that is not an object without reporting an agent error", async () => {
    const { runtime, reasons } = await fixture();
    const env = runtime.create("s");

    const response = await post(`${env[CLAUDE_HOOK_ENV_VAR]}/${CLAUDE_HOOK_SLUG}`, "not json at all");

    expect(response.status).toBe(204);
    expect(reasons.some((r) => r.reason === "agent-error")).toBe(false);
  });
});
