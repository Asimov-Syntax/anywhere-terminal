// src/agentHooks/agents/claude.test.ts — Claude is transport-only in WT-006.2
// (design D6): the runtime must authenticate, entitle, and dedup its posts, and
// the session must never publish a state. The reducer lands in WT-006.3.

import { afterEach, describe, expect, it } from "vitest";
import {
  type AgentActivityUpdate,
  type AgentHookReasonCode,
  type AgentTurnReport,
  createAgentHookRuntime,
} from "../AgentHookRuntime";
import {
  CLAUDE_FIELD_CAP,
  CLAUDE_HOOK_ENV_VAR,
  CLAUDE_HOOK_EVENTS,
  CLAUDE_HOOK_SLUG,
  CLAUDE_ROSTER_CAP,
  claudeAgentRegistration,
  decodeClaudeHookPayload,
} from "./claude";

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

  it("accepts an authenticated post and publishes the turn it describes", async () => {
    const { runtime, status, reasons } = await fixture();
    const env = runtime.create("s");

    const response = await post(`${env[CLAUDE_HOOK_ENV_VAR]}/${CLAUDE_HOOK_SLUG}`, eventBody("UserPromptSubmit"));

    expect(response.status).toBe(204);
    expect(status).toHaveLength(1);
    expect(status[0]).toMatchObject({ sessionId: "s", agent: "claude" });
    expect(reasons.some((r) => r.reason === "agent-error")).toBe(false);
  });

  it("handles every registered event without erroring", async () => {
    const { runtime, reasons } = await fixture();
    const env = runtime.create("s");

    for (const event of CLAUDE_HOOK_EVENTS) {
      await post(`${env[CLAUDE_HOOK_ENV_VAR]}/${CLAUDE_HOOK_SLUG}`, eventBody(event, { nonce: event }));
    }

    expect(reasons.some((r) => r.reason === "agent-error")).toBe(false);
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

  describe("payload decoding", () => {
    const decode = (value: unknown) => decodeClaudeHookPayload(Buffer.from(JSON.stringify(value)));

    it("carries every field the reducer reads off a well-formed payload", () => {
      expect(
        decode({
          hook_event_name: "PreToolUse",
          session_id: "sess-1",
          transcript_path: "/vault/sess-1.jsonl",
          tool_name: "Bash",
          tool_use_id: "tu-1",
        }),
      ).toEqual({
        event: "PreToolUse",
        agentSessionId: "sess-1",
        transcriptPath: "/vault/sess-1.jsonl",
        toolName: "Bash",
      });
    });

    it("reads the cause of a session start, which decides whether a turn completed", () => {
      expect(decode({ hook_event_name: "SessionStart", session_id: "s", source: "compact" })).toMatchObject({
        event: "SessionStart",
        source: "compact",
      });
    });

    it("reads a delegation's identity and name", () => {
      expect(
        decode({ hook_event_name: "SubagentStart", session_id: "s", agent_id: "a1", agent_type: "code-reviewer" }),
      ).toMatchObject({ event: "SubagentStart", subagentId: "a1", subagentName: "code-reviewer" });
    });

    it("decodes an interrupt flag where one is present, and never invents it", () => {
      expect(decode({ hook_event_name: "Stop", session_id: "s", is_interrupt: true })).toMatchObject({
        interrupted: true,
      });
      expect(decode({ hook_event_name: "Stop", session_id: "s" })?.interrupted).toBeUndefined();
    });

    it("bounds every string it keeps", () => {
      const decoded = decode({
        hook_event_name: "PreToolUse",
        session_id: "s",
        tool_name: "x".repeat(10_000),
        transcript_path: "/p".repeat(10_000),
      });
      expect(decoded?.toolName?.length).toBeLessThanOrEqual(CLAUDE_FIELD_CAP);
      expect(decoded?.transcriptPath?.length).toBeLessThanOrEqual(CLAUDE_FIELD_CAP);
    });

    it("drops what does not parse and what it does not recognise", () => {
      expect(decodeClaudeHookPayload(Buffer.from('{"hook_event_name":"PreToo'))).toBeNull();
      expect(decodeClaudeHookPayload(Buffer.from("not json at all"))).toBeNull();
      expect(decode(["PreToolUse"])).toBeNull();
      expect(decode({ hook_event_name: "PostCompact", session_id: "s" })).toBeNull();
      expect(decode({ session_id: "s" })).toBeNull();
      expect(decode({ hook_event_name: "PreToolUse", session_id: 42 })).toBeNull();
    });

    it("keeps a non-string where a string was required out of the decoded turn", () => {
      expect(decode({ hook_event_name: "PreToolUse", session_id: "s", tool_name: { evil: true } })).toEqual({
        event: "PreToolUse",
        agentSessionId: "s",
      });
    });
  });

  describe("event to turn state (design 4.4)", () => {
    async function reducer() {
      const f = await fixture();
      const env = f.runtime.create("s");
      const url = `${env[CLAUDE_HOOK_ENV_VAR]}/${CLAUDE_HOOK_SLUG}`;
      let nonce = 0;
      // Each post carries a fresh nonce so the transport's duplicate
      // correlation never masks what the reducer does with a repeat.
      const send = (event: string, extra: Record<string, unknown> = {}) =>
        post(url, eventBody(event, { ...extra, nonce: ++nonce }));
      const twice = async (event: string, extra: Record<string, unknown> = {}) => {
        await send(event, extra);
        await send(event, extra);
      };
      const latest = () => f.status.at(-1)?.state as AgentTurnReport | undefined;
      return { ...f, send, twice, latest };
    }

    it("maps each event to the state the table names", async () => {
      const { send, latest } = await reducer();

      await send("UserPromptSubmit");
      expect(latest()?.state).toBe("working");
      await send("PreToolUse", { tool_name: "Bash" });
      expect(latest()?.state).toBe("working");
      await send("PreToolUse", { tool_name: "AskUserQuestion" });
      expect(latest()?.state).toBe("waiting");
      await send("PermissionRequest", { tool_name: "Bash" });
      expect(latest()?.state).toBe("waiting");
      await send("Stop");
      expect(latest()?.state).toBe("done");
      await send("StopFailure");
      expect(latest()?.state).toBe("done");
    });

    it("treats a session start as a boundary, not as a completed turn", async () => {
      const { send, latest } = await reducer();

      await send("SubagentStart", { agent_id: "a1", agent_type: "explorer" });
      await send("SessionStart", { source: "resume" });

      expect(latest()).toMatchObject({ state: "done", sessionBoundary: true, subagents: [] });

      await send("UserPromptSubmit");
      expect(latest()?.sessionBoundary).toBeUndefined();
    });

    it("holds a finished turn open while a delegation is still working", async () => {
      const { send, latest } = await reducer();

      await send("UserPromptSubmit");
      await send("SubagentStart", { agent_id: "a1", agent_type: "explorer" });
      await send("Stop");
      expect(latest()?.state).toBe("working");

      await send("SubagentStop", { agent_id: "a1" });
      expect(latest()?.state).toBe("done");
    });

    it("reaches the same state whichever of the lead and its child stops first", async () => {
      const childFirst = await reducer();
      await childFirst.send("UserPromptSubmit");
      await childFirst.send("SubagentStart", { agent_id: "a1", agent_type: "explorer" });
      await childFirst.send("SubagentStop", { agent_id: "a1" });
      await childFirst.send("Stop");

      const leadFirst = await reducer();
      await leadFirst.send("UserPromptSubmit");
      await leadFirst.send("SubagentStart", { agent_id: "a1", agent_type: "explorer" });
      await leadFirst.send("Stop");
      await leadFirst.send("SubagentStop", { agent_id: "a1" });

      expect(childFirst.latest()?.state).toBe("done");
      expect(leadFirst.latest()?.state).toBe(childFirst.latest()?.state);
      expect(leadFirst.latest()?.subagents).toEqual(childFirst.latest()?.subagents);
    });

    it("is unchanged by a duplicate of any event", async () => {
      const script: Array<[string, Record<string, unknown>]> = [
        ["UserPromptSubmit", {}],
        ["SubagentStart", { agent_id: "a1", agent_type: "explorer" }],
        ["PreToolUse", { tool_name: "Bash" }],
        ["SubagentStop", { agent_id: "a1" }],
        ["Stop", {}],
      ];
      const once = await reducer();
      for (const [event, extra] of script) {
        await once.send(event, extra);
      }
      const doubled = await reducer();
      for (const [event, extra] of script) {
        await doubled.twice(event, extra);
      }

      // Every event delivered twice, and the pane cannot tell — same turn, and
      // no extra publication for the copies. `stateStartedAt` is a wall-clock
      // read that differs between the two fixtures; that a repeat does not move
      // it is pinned separately below.
      const withoutClock = (turn: AgentTurnReport | undefined) => ({ ...turn, stateStartedAt: 0 });
      expect(withoutClock(doubled.latest())).toEqual(withoutClock(once.latest()));
      expect(doubled.status.map((u) => (u.state as AgentTurnReport).state)).toEqual(
        once.status.map((u) => (u.state as AgentTurnReport).state),
      );
    });

    it("does not restart the age of a state a repeat re-reports", async () => {
      const { send, latest } = await reducer();

      await send("UserPromptSubmit");
      const startedAt = latest()?.stateStartedAt;
      await send("PreToolUse", { tool_name: "Bash" });

      expect(latest()?.stateStartedAt).toBe(startedAt);
    });

    it("never inherits an interactive prompt across events", async () => {
      const { send, latest } = await reducer();

      await send("PermissionRequest", { tool_name: "Bash" });
      expect(latest()?.interactivePrompt).toContain("approval");

      await send("PreToolUse", { tool_name: "Read" });
      expect(latest()?.interactivePrompt).toBeUndefined();
    });

    it("bounds the roster it will hold", async () => {
      const { send, latest } = await reducer();

      for (let i = 0; i < CLAUDE_ROSTER_CAP + 5; i++) {
        await send("SubagentStart", { agent_id: `a${i}`, agent_type: "explorer" });
      }

      expect(latest()?.subagents.length).toBe(CLAUDE_ROSTER_CAP);
    });

    it("makes no state claim for a delegation it never saw start", async () => {
      const { send, status } = await reducer();

      await send("SubagentStop", { agent_id: "ghost" });

      expect(status).toEqual([]);
    });

    it("carries the reported identity without acting on it", async () => {
      const { send, latest } = await reducer();

      await send("UserPromptSubmit", { transcript_path: "/vault/abc.jsonl" });

      expect(latest()).toMatchObject({ agentSessionId: "abc", transcriptPath: "/vault/abc.jsonl" });
    });
  });

  it("survives a payload that is not an object without reporting an agent error", async () => {
    const { runtime, reasons } = await fixture();
    const env = runtime.create("s");

    const response = await post(`${env[CLAUDE_HOOK_ENV_VAR]}/${CLAUDE_HOOK_SLUG}`, "not json at all");

    expect(response.status).toBe(204);
    expect(reasons.some((r) => r.reason === "agent-error")).toBe(false);
  });
});
