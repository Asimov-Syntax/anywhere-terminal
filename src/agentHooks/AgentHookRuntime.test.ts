// src/agentHooks/AgentHookRuntime.test.ts — Unit tests for the multi-agent hook
// state machine: fail-open bounds, per-session renewable tokens, per-session
// agent entitlement, slug-namespaced dedup, agent-module containment, the exact
// D7 Cursor event table, quiet window, freshness expiry, and payload privacy.

import { type ClientRequest, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultAgentId } from "../vault/types";
import {
  AGENT_HOOK_BODY_CAP_BYTES,
  AGENT_HOOK_DEDUP_MAX_ENTRIES,
  AGENT_HOOK_DEDUP_TTL_MS,
  AGENT_HOOK_REQUEST_DEADLINE_MS,
  type AgentActivityUpdate,
  type AgentHookChannel,
  type AgentHookReasonCode,
  type AgentHookRegistration,
  type AgentHookRuntimeDependencies,
  type AgentHookRuntimeOptions,
  createAgentHookRuntime,
} from "./AgentHookRuntime";
import {
  CURSOR_HOOK_ENV_VAR,
  CURSOR_HOOK_FRESHNESS_MS,
  CURSOR_HOOK_QUIET_WINDOW_MS,
  cursorAgentRegistration,
} from "./agents/cursor";

const runtimes: Array<{ dispose(): void }> = [];

afterEach(() => {
  runtimes.splice(0).forEach((runtime) => {
    runtime.dispose();
  });
});

type FixtureOptions = AgentHookRuntimeOptions & {
  quietWindowMs?: number;
  freshnessMs?: number;
  enabled?: boolean;
  extraAgents?: AgentHookRegistration[];
  now?: AgentHookRuntimeDependencies["now"];
  clearTimer?: AgentHookRuntimeDependencies["clearTimer"];
};

async function fixture(options: FixtureOptions = {}) {
  const { quietWindowMs, freshnessMs, enabled = true, extraAgents = [], now, clearTimer, ...runtimeOptions } = options;
  const status: AgentActivityUpdate[] = [];
  const reasons: Array<{ reason: AgentHookReasonCode; sessionSuffix: string }> = [];
  const runtime = await createAgentHookRuntime(
    [cursorAgentRegistration({ quietWindowMs, freshnessMs }), ...extraAgents],
    runtimeOptions,
    {
      ...(now ? { now } : {}),
      ...(clearTimer ? { clearTimer } : {}),
      onStatus: (update) => status.push(update),
      onReasonCode: (reason, sessionSuffix) => reasons.push({ reason, sessionSuffix }),
    },
  );
  runtimes.push(runtime);
  if (enabled) {
    runtime.setAgentEnabled("cursor", true);
  }
  return { runtime, status, reasons };
}

/** A second registration used only to prove multi-agent isolation. */
function fakeAgent(
  id: VaultAgentId,
  hooks: {
    onCreate?: (channel: AgentHookChannel) => void;
    onHandle?: (body: Buffer, channel: AgentHookChannel) => void;
    onDispose?: () => void;
  } = {},
): AgentHookRegistration {
  return {
    id,
    slug: id,
    envVar: `ANYWHERE_TERMINAL_${id.toUpperCase()}_URL`,
    createSession: (channel) => {
      hooks.onCreate?.(channel);
      return {
        handle: (body) => {
          if (hooks.onHandle) {
            hooks.onHandle(body, channel);
            return;
          }
          channel.publish("working");
        },
        dispose: () => hooks.onDispose?.(),
      };
    },
  };
}

function eventBody(hook_event_name: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ hook_event_name, conversation_id: "conv-1", ...extra });
}

async function postRaw(url: string, body: string, init: { method?: string } = {}): Promise<{ status: number }> {
  const method = init.method ?? "POST";
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(method === "GET" || method === "HEAD" ? {} : { body }),
  });
  return { status: response.status };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends headers + a body prefix over a real HTTP client connection and leaves
 * the rest of the body pending until `finish()` is called. Uses `node:http`'s
 * client (not a raw socket) because a body split across two separate socket
 * writes is unreliable under Bun's `node:http` server compatibility layer.
 */
async function openPartialRequest(url: string, body: string, splitAt: number) {
  const target = new URL(url);
  let req!: ClientRequest;
  const responsePromise = new Promise<string>((resolve, reject) => {
    req = httpRequest(
      {
        host: target.hostname,
        port: Number(target.port),
        path: target.pathname,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk.toString();
        });
        res.on("end", () => resolve(`${res.statusCode ?? 0} ${data}`));
      },
    );
    req.on("error", reject);
    req.flushHeaders();
    req.write(body.slice(0, splitAt));
  });
  const remainder = body.slice(splitAt);
  return {
    finish: () => req.end(remainder),
    responsePromise,
  };
}

describe("AgentHookRuntime", () => {
  it("binds loopback-only and exports spec-default bounds", async () => {
    const { runtime } = await fixture();
    expect(runtime.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(AGENT_HOOK_BODY_CAP_BYTES).toBe(1_048_576);
    expect(AGENT_HOOK_REQUEST_DEADLINE_MS).toBe(5_000);
    expect(CURSOR_HOOK_QUIET_WINDOW_MS).toBe(1_500);
    expect(CURSOR_HOOK_FRESHNESS_MS).toBe(30 * 60 * 1000);
    expect(AGENT_HOOK_DEDUP_TTL_MS).toBe(5 * 60 * 1000);
    expect(AGENT_HOOK_DEDUP_MAX_ENTRIES).toBe(256);
  });

  it("wraps ANYWHERE_TERMINAL_CURSOR_URL so the wrapper's appended /cursor authenticates", async () => {
    const { runtime } = await fixture();
    const env = runtime.create("session-1");
    const base = env[CURSOR_HOOK_ENV_VAR];
    expect(base).toBeDefined();
    expect(base as string).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/session-1\/[0-9a-f]+$/);
    const response = await postRaw(`${base}/cursor`, eventBody("beforeSubmitPrompt"));
    expect(response.status).toBe(204);
  });

  it("mints no coordinates for a registered but disabled agent", async () => {
    const { runtime } = await fixture({ extraAgents: [fakeAgent("claude")] });
    const env = runtime.create("s");
    expect(env[CURSOR_HOOK_ENV_VAR]).toBeDefined();
    expect(env.ANYWHERE_TERMINAL_CLAUDE_URL).toBeUndefined();
  });

  describe("D7 event table", () => {
    const workingEvents = [
      "beforeSubmitPrompt",
      "preToolUse",
      "postToolUse",
      "postToolUseFailure",
      "beforeShellExecution",
      "afterShellExecution",
      "beforeMCPExecution",
      "afterMCPExecution",
    ];

    it.each(workingEvents)("%s transitions to working", async (event) => {
      const { runtime, status } = await fixture();
      const env = runtime.create("s");
      await postRaw(`${env[CURSOR_HOOK_ENV_VAR]}/cursor`, eventBody(event));
      expect(status).toEqual([{ sessionId: "s", agent: "cursor", state: "working" }]);
    });

    const quietEvents = ["afterAgentResponse", "stop", "sessionEnd"];

    it.each(quietEvents)("%s becomes a candidate idle after the cancelable quiet window", async (event) => {
      const { runtime, status } = await fixture({ quietWindowMs: 20 });
      const env = runtime.create("s");
      await postRaw(`${env[CURSOR_HOOK_ENV_VAR]}/cursor`, eventBody(event));
      expect(status).toEqual([]); // not immediate
      await sleep(60);
      expect(status).toEqual([{ sessionId: "s", agent: "cursor", state: "idle" }]);
    });

    it("sessionStart clears prior semantic state and never itself completes", async () => {
      const { runtime, status } = await fixture();
      const env = runtime.create("s");
      const url = `${env[CURSOR_HOOK_ENV_VAR]}/cursor`;
      await postRaw(url, eventBody("preToolUse"));
      expect(status.at(-1)).toEqual({ sessionId: "s", agent: "cursor", state: "working" });
      await postRaw(url, eventBody("sessionStart"));
      expect(status.at(-1)).toEqual({ sessionId: "s", agent: "cursor", state: null });
    });

    it("unknown events are ignored and still respond fail-open", async () => {
      const { runtime, status, reasons } = await fixture();
      const env = runtime.create("s");
      const response = await postRaw(`${env[CURSOR_HOOK_ENV_VAR]}/cursor`, eventBody("subagentStart"));
      expect(response.status).toBe(204);
      expect(status).toEqual([]);
      expect(reasons).toContainEqual({ reason: "unknown-event", sessionSuffix: "s" });
    });

    it("a renewed working event cancels a pending quiet-idle candidate", async () => {
      const { runtime, status } = await fixture({ quietWindowMs: 20 });
      const env = runtime.create("s");
      const url = `${env[CURSOR_HOOK_ENV_VAR]}/cursor`;
      await postRaw(url, eventBody("stop"));
      await postRaw(url, eventBody("preToolUse", { generation_id: "g2" }));
      await sleep(60);
      expect(status).toEqual([{ sessionId: "s", agent: "cursor", state: "working" }]);
    });
  });

  describe("fail-open bounds", () => {
    it("rejects non-POST methods", async () => {
      const { runtime, status, reasons } = await fixture();
      const env = runtime.create("s");
      const response = await postRaw(`${env[CURSOR_HOOK_ENV_VAR]}/cursor`, "", { method: "GET" });
      expect(response.status).toBe(204);
      expect(status).toEqual([]);
      expect(reasons).toContainEqual({ reason: "method-not-allowed", sessionSuffix: "" });
    });

    it("rejects bodies larger than 1 MiB", async () => {
      const { runtime, status, reasons } = await fixture({ bodyCapBytes: 16 });
      const env = runtime.create("s");
      const response = await postRaw(`${env[CURSOR_HOOK_ENV_VAR]}/cursor`, eventBody("preToolUse"));
      expect(response.status).toBe(204);
      expect(status).toEqual([]);
      expect(reasons).toContainEqual({ reason: "oversized-body", sessionSuffix: "s" });
    });

    it("responds fail-open when the body never completes within the request deadline", async () => {
      const { runtime, status, reasons } = await fixture({ requestDeadlineMs: 30 });
      const env = runtime.create("s");
      const target = new URL(`${env[CURSOR_HOOK_ENV_VAR]}/cursor`);
      const socket = connect({ host: target.hostname, port: Number(target.port) });
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", () => {
          socket.write(
            `POST ${target.pathname} HTTP/1.1\r\nHost: 127.0.0.1\r\ncontent-type: application/json\r\ncontent-length: 100\r\nConnection: close\r\n\r\n{"hook_event_name":`,
          );
          resolve();
        });
        socket.once("error", reject);
      });
      const raw = await new Promise<string>((resolve, reject) => {
        let data = "";
        const timer = setTimeout(() => reject(new Error("no response before test timeout")), 2_000);
        socket.on("data", (chunk) => {
          data += chunk.toString();
          if (data.includes("\r\n\r\n")) {
            clearTimeout(timer);
            resolve(data);
          }
        });
        socket.once("error", reject);
      });
      socket.destroy();
      expect(raw).toContain("204");
      expect(status).toEqual([]);
      expect(reasons).toContainEqual({ reason: "deadline-exceeded", sessionSuffix: "s" });
    });

    it("rejects malformed JSON bodies", async () => {
      const { runtime, status, reasons } = await fixture();
      const env = runtime.create("s");
      const response = await postRaw(`${env[CURSOR_HOOK_ENV_VAR]}/cursor`, "not json {{{");
      expect(response.status).toBe(204);
      expect(status).toEqual([]);
      expect(reasons).toContainEqual({ reason: "malformed-json", sessionSuffix: "s" });
    });

    it("rejects an unrecognized URL shape", async () => {
      const { runtime, status, reasons } = await fixture();
      runtime.create("s");
      const response = await postRaw(`${runtime.url}/only-one-segment`, eventBody("preToolUse"));
      expect(response.status).toBe(204);
      expect(status).toEqual([]);
      expect(reasons).toContainEqual({ reason: "bad-path", sessionSuffix: "" });
    });

    it("an unregistered slug stays bad-path, exactly as a non-cursor third segment did", async () => {
      const { runtime, status, reasons } = await fixture();
      const env = runtime.create("s");
      const response = await postRaw(`${env[CURSOR_HOOK_ENV_VAR]}/not-an-agent`, eventBody("preToolUse"));
      expect(response.status).toBe(204);
      expect(status).toEqual([]);
      expect(reasons).toContainEqual({ reason: "bad-path", sessionSuffix: "" });
    });
  });

  describe("agent module containment", () => {
    it("contains a throwing agent module and keeps answering fail-open", async () => {
      const thrower = fakeAgent("claude", {
        onHandle: () => {
          throw new Error("reducer exploded");
        },
      });
      const { runtime, status, reasons } = await fixture({ extraAgents: [thrower] });
      runtime.setAgentEnabled("claude", true);
      const env = runtime.create("s");

      const response = await postRaw(`${env.ANYWHERE_TERMINAL_CLAUDE_URL}/claude`, eventBody("anything"));
      expect(response.status).toBe(204);
      expect(reasons).toContainEqual({ reason: "agent-error", sessionSuffix: "s" });
      expect(status).toEqual([]);

      // The runtime stays healthy for the other agent.
      await postRaw(`${env[CURSOR_HOOK_ENV_VAR]}/cursor`, eventBody("preToolUse"));
      expect(status).toEqual([{ sessionId: "s", agent: "cursor", state: "working" }]);
    });

    it("contains a throwing session constructor, omits its env var, and still entitles the others (B1)", async () => {
      const thrower = fakeAgent("claude", {
        onCreate: () => {
          throw new Error("constructor exploded");
        },
      });
      const { runtime, status, reasons } = await fixture({ extraAgents: [thrower] });
      runtime.setAgentEnabled("claude", true);

      let env: Record<string, string> = {};
      expect(() => {
        env = runtime.create("s");
      }).not.toThrow();

      expect(env.ANYWHERE_TERMINAL_CLAUDE_URL).toBeUndefined();
      expect(env[CURSOR_HOOK_ENV_VAR]).toBeDefined();
      expect(reasons).toContainEqual({ reason: "agent-error", sessionSuffix: "s" });

      // The surviving agent is fully usable, and the failed one holds no authority.
      await postRaw(`${env[CURSOR_HOOK_ENV_VAR]}/cursor`, eventBody("preToolUse"));
      expect(status).toEqual([{ sessionId: "s", agent: "cursor", state: "working" }]);
      const response = await postRaw(`${env[CURSOR_HOOK_ENV_VAR]}/claude`, eventBody("anything"));
      expect(response.status).toBe(204);
      expect(reasons).toContainEqual({ reason: "not-entitled", sessionSuffix: "s" });
    });

    it("clears state a throwing constructor published or armed before it threw (B1)", async () => {
      const cleared: unknown[] = [];
      const thrower = fakeAgent("claude", {
        onCreate: (channel) => {
          channel.publish("working");
          channel.setTimer(() => undefined, 60_000);
          throw new Error("constructor exploded late");
        },
      });
      const { runtime, status } = await fixture({
        extraAgents: [thrower],
        clearTimer: (handle) => {
          cleared.push(handle);
          clearTimeout(handle as NodeJS.Timeout);
        },
      } as FixtureOptions & { clearTimer: (handle: unknown) => void });
      runtime.setAgentEnabled("claude", true);

      runtime.create("s");

      expect(cleared.length).toBeGreaterThan(0);
      expect(status.at(-1)).toEqual({ sessionId: "s", agent: "claude", state: null });
    });

    it("contains a throwing timer callback instead of raising it uncaught (B2)", async () => {
      const thrower = fakeAgent("claude", {
        onHandle: (_body, channel) => {
          channel.setTimer(() => {
            throw new Error("timer exploded");
          }, 10);
        },
      });
      const { runtime, reasons } = await fixture({ extraAgents: [thrower] });
      runtime.setAgentEnabled("claude", true);
      const env = runtime.create("s");
      await postRaw(`${env.ANYWHERE_TERMINAL_CLAUDE_URL}/claude`, eventBody("anything"));

      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(reasons).toContainEqual({ reason: "agent-error", sessionSuffix: "s" });
    });

    it("drops a timer callback whose entitlement was revoked before it fired (B2)", async () => {
      let fire: (() => void) | undefined;
      const late = fakeAgent("claude", {
        onHandle: (_body, channel) => {
          channel.setTimer(() => channel.publish("idle"), 60_000);
        },
      });
      const { runtime, status } = await fixture({
        extraAgents: [late],
        clearTimer: () => undefined, // never actually cancels — forces the callback to survive
      } as FixtureOptions & { clearTimer: (handle: unknown) => void });
      const original = globalThis.setTimeout;
      vi.stubGlobal("setTimeout", ((callback: () => void, ms: number) => {
        if (ms === 60_000) {
          fire = callback;
          return 0 as unknown as NodeJS.Timeout;
        }
        return original(callback, ms);
      }) as typeof setTimeout);
      try {
        runtime.setAgentEnabled("claude", true);
        const env = runtime.create("s");
        await postRaw(`${env.ANYWHERE_TERMINAL_CLAUDE_URL}/claude`, eventBody("anything"));
        runtime.setAgentEnabled("claude", false);
        status.splice(0);

        expect(() => fire?.()).not.toThrow();
        expect(status).toEqual([]);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("contains an async timer callback that rejects after an await (B2 round 2)", async () => {
      const rejecter = fakeAgent("claude", {
        onHandle: (_body, channel) => {
          channel.setTimer(async () => {
            await Promise.resolve();
            throw new Error("async timer exploded");
          }, 10);
        },
      });
      const { runtime, reasons } = await fixture({ extraAgents: [rejecter] });
      runtime.setAgentEnabled("claude", true);
      const env = runtime.create("s");
      await postRaw(`${env.ANYWHERE_TERMINAL_CLAUDE_URL}/claude`, eventBody("anything"));

      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(reasons).toContainEqual({ reason: "agent-error", sessionSuffix: "s" });
    });

    it("drops a publish queued by a constructor that then threw (B1 round 2)", async () => {
      const deferredPublisher = fakeAgent("claude", {
        onCreate: (channel) => {
          queueMicrotask(() => channel.publish("working"));
          throw new Error("constructor exploded after queueing");
        },
      });
      const { runtime, status } = await fixture({ extraAgents: [deferredPublisher] });
      runtime.setAgentEnabled("claude", true);

      runtime.create("s");
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 5));

      expect(status.some((update) => update.agent === "claude" && update.state === "working")).toBe(false);
    });

    it("drops a publish from a channel retained past release (B1 round 2)", async () => {
      let retained: AgentHookChannel | undefined;
      const keeper = fakeAgent("claude", {
        onCreate: (channel) => {
          retained = channel;
        },
      });
      const { runtime, status } = await fixture({ extraAgents: [keeper] });
      runtime.setAgentEnabled("claude", true);
      runtime.create("s");
      runtime.release("s");
      status.splice(0);

      retained?.publish("working");

      expect(status).toEqual([]);
    });

    it("refuses to arm a new timer once the state is inactive (B1 round 2)", async () => {
      let retained: AgentHookChannel | undefined;
      const armed: unknown[] = [];
      const keeper = fakeAgent("claude", {
        onCreate: (channel) => {
          retained = channel;
        },
      });
      const { runtime } = await fixture({ extraAgents: [keeper] });
      runtime.setAgentEnabled("claude", true);
      runtime.create("s");
      runtime.release("s");

      let fired = false;
      retained?.setTimer(() => {
        fired = true;
        armed.push(1);
      }, 1);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(fired).toBe(false);
    });

    it("contains a throwing dispose and still clears the session", async () => {
      const thrower = fakeAgent("claude", {
        onDispose: () => {
          throw new Error("dispose exploded");
        },
      });
      const { runtime, reasons } = await fixture({ extraAgents: [thrower] });
      runtime.setAgentEnabled("claude", true);
      runtime.create("s");

      expect(() => runtime.release("s")).not.toThrow();
      expect(reasons).toContainEqual({ reason: "agent-error", sessionSuffix: "s" });
    });

    it("cancels a timer the agent module left armed at teardown", async () => {
      const cleared: unknown[] = [];
      const lingering = fakeAgent("claude", {
        onHandle: (_body, channel) => {
          channel.setTimer(() => undefined, 60_000);
        },
      });
      const { runtime } = await fixture({
        extraAgents: [lingering],
        clearTimer: (handle) => {
          cleared.push(handle);
          clearTimeout(handle as NodeJS.Timeout);
        },
      } as FixtureOptions & { clearTimer: (handle: unknown) => void });
      runtime.setAgentEnabled("claude", true);
      const env = runtime.create("s");
      await postRaw(`${env.ANYWHERE_TERMINAL_CLAUDE_URL}/claude`, eventBody("anything"));

      runtime.release("s");
      expect(cleared.length).toBeGreaterThan(0);
    });

    it("does not dedup identical bodies across two agents", async () => {
      const { runtime, status, reasons } = await fixture({ extraAgents: [fakeAgent("claude")] });
      runtime.setAgentEnabled("claude", true);
      const env = runtime.create("s");
      const body = eventBody("preToolUse", { fixed: true });

      await postRaw(`${env[CURSOR_HOOK_ENV_VAR]}/cursor`, body);
      await postRaw(`${env.ANYWHERE_TERMINAL_CLAUDE_URL}/claude`, body);

      expect(reasons.some((r) => r.reason === "duplicate-event")).toBe(false);
      expect(status).toEqual([
        { sessionId: "s", agent: "cursor", state: "working" },
        { sessionId: "s", agent: "claude", state: "working" },
      ]);
    });
  });

  describe("session isolation (hook-session-isolation)", () => {
    it("rejects a stale token after renewal and accepts the renewed token", async () => {
      const { runtime, status, reasons } = await fixture();
      const first = runtime.create("s");
      const staleUrl = `${first[CURSOR_HOOK_ENV_VAR]}/cursor`;
      const renewed = runtime.create("s"); // fallback-shell style renewal
      const renewedUrl = `${renewed[CURSOR_HOOK_ENV_VAR]}/cursor`;
      expect(staleUrl).not.toBe(renewedUrl);

      await postRaw(staleUrl, eventBody("preToolUse"));
      expect(reasons).toContainEqual({ reason: "invalid-token", sessionSuffix: "s" });
      expect(status).toEqual([]);

      await postRaw(renewedUrl, eventBody("preToolUse"));
      expect(status).toEqual([{ sessionId: "s", agent: "cursor", state: "working" }]);
    });

    it("clears prior semantic state immediately on renewal", async () => {
      const { runtime, status } = await fixture();
      const first = runtime.create("session-a");
      await postRaw(`${first[CURSOR_HOOK_ENV_VAR]}/cursor`, eventBody("preToolUse"));
      expect(status.at(-1)?.state).toBe("working");
      runtime.create("session-a"); // renewal must clear stale working state
      expect(status.at(-1)).toEqual({ sessionId: "session-a", agent: "cursor", state: null });
    });

    it("rejects a cross-pane token used against a different session id", async () => {
      const { runtime, status, reasons } = await fixture();
      const envA = runtime.create("pane-a");
      const envB = runtime.create("pane-b");
      const tokenA = new URL(envA[CURSOR_HOOK_ENV_VAR] as string).pathname.split("/")[2];
      const crossUrl = `${runtime.url}/pane-b/${tokenA}/cursor`;

      await postRaw(crossUrl, eventBody("preToolUse"));
      expect(reasons).toContainEqual({ reason: "invalid-token", sessionSuffix: "pane-b" });
      expect(status).toEqual([]);

      await postRaw(`${envB[CURSOR_HOOK_ENV_VAR]}/cursor`, eventBody("preToolUse"));
      expect(status).toEqual([{ sessionId: "pane-b", agent: "cursor", state: "working" }]);
    });

    it("rejects requests for an unknown/released session", async () => {
      const { runtime, status, reasons } = await fixture();
      const env = runtime.create("s");
      const url = `${env[CURSOR_HOOK_ENV_VAR]}/cursor`;
      runtime.release("s");
      await postRaw(url, eventBody("preToolUse"));
      expect(reasons).toContainEqual({ reason: "unknown-session", sessionSuffix: "s" });
      expect(status).toEqual([]);
    });

    it("release clears live status for the matching session only", async () => {
      const { runtime, status } = await fixture();
      const envA = runtime.create("pane-a");
      const envB = runtime.create("pane-b");
      await postRaw(`${envA[CURSOR_HOOK_ENV_VAR]}/cursor`, eventBody("preToolUse"));
      await postRaw(`${envB[CURSOR_HOOK_ENV_VAR]}/cursor`, eventBody("preToolUse"));
      status.length = 0;

      runtime.release("pane-a");
      expect(status).toEqual([{ sessionId: "pane-a", agent: "cursor", state: null }]);
    });
  });

  describe("per-session dedup LRU", () => {
    it("suppresses an exact duplicate delivery and processes it again once TTL elapses", async () => {
      let now = 1_000;
      const { runtime, status, reasons } = await fixture({ dedupTtlMs: 50, now: () => now });
      const env = runtime.create("s");
      const url = `${env[CURSOR_HOOK_ENV_VAR]}/cursor`;
      const body = eventBody("preToolUse", { fixed: true });

      await postRaw(url, body);
      await postRaw(url, body); // exact duplicate within TTL
      expect(status).toEqual([{ sessionId: "s", agent: "cursor", state: "working" }]);
      expect(reasons).toContainEqual({ reason: "duplicate-event", sessionSuffix: "s" });

      now += 1_000; // advance past dedupTtlMs
      status.length = 0;
      const reasonCountBefore = reasons.length;
      await postRaw(url, body); // now treated as fresh again, not a duplicate
      expect(reasons.filter((r) => r.reason === "duplicate-event")).toHaveLength(1);
      expect(reasons).toHaveLength(reasonCountBefore); // no new duplicate-event recorded
    });

    it("evicts the oldest digest once the per-session cap is exceeded", async () => {
      const { runtime, reasons } = await fixture({ dedupMaxEntries: 2 });
      const env = runtime.create("s");
      const url = `${env[CURSOR_HOOK_ENV_VAR]}/cursor`;
      const bodyA = eventBody("preToolUse", { id: "a" });
      const bodyB = eventBody("preToolUse", { id: "b" });
      const bodyC = eventBody("preToolUse", { id: "c" });

      await postRaw(url, bodyA);
      await postRaw(url, bodyB);
      await postRaw(url, bodyC); // evicts bodyA's digest
      reasons.length = 0;
      await postRaw(url, bodyA); // no longer recognized as a duplicate
      expect(reasons.some((r) => r.reason === "duplicate-event")).toBe(false);
    });
  });

  describe("freshness expiry", () => {
    it("clears orphaned working state after the freshness lease elapses", async () => {
      const { runtime, status } = await fixture({ freshnessMs: 30 });
      const env = runtime.create("s");
      await postRaw(`${env[CURSOR_HOOK_ENV_VAR]}/cursor`, eventBody("preToolUse"));
      expect(status.at(-1)?.state).toBe("working");
      await sleep(80);
      expect(status.at(-1)).toEqual({ sessionId: "s", agent: "cursor", state: null });
    });
  });

  describe("disable", () => {
    it("clears all live semantic state immediately and rejects further events", async () => {
      const { runtime, status, reasons } = await fixture();
      const envA = runtime.create("pane-a");
      const envB = runtime.create("pane-b");
      await postRaw(`${envA[CURSOR_HOOK_ENV_VAR]}/cursor`, eventBody("preToolUse"));
      await postRaw(`${envB[CURSOR_HOOK_ENV_VAR]}/cursor`, eventBody("preToolUse"));

      runtime.setAgentEnabled("cursor", false);
      expect(status.slice(-2)).toEqual(
        expect.arrayContaining([
          { sessionId: "pane-a", agent: "cursor", state: null },
          { sessionId: "pane-b", agent: "cursor", state: null },
        ]),
      );

      await postRaw(`${envA[CURSOR_HOOK_ENV_VAR]}/cursor`, eventBody("preToolUse"));
      expect(reasons).toContainEqual({ reason: "disabled", sessionSuffix: "pane-a" });
      expect(status.slice(-2)).not.toContainEqual({ sessionId: "pane-a", agent: "cursor", state: "working" });
    });

    it("D6: disable releases authority — the old token stays unauthorized after re-enable and a fresh create() is required", async () => {
      const { runtime, status, reasons } = await fixture();
      const env = runtime.create("s");
      runtime.setAgentEnabled("cursor", false);
      runtime.setAgentEnabled("cursor", true);

      await postRaw(`${env[CURSOR_HOOK_ENV_VAR]}/cursor`, eventBody("preToolUse"));
      expect(reasons).toContainEqual({ reason: "unknown-session", sessionSuffix: "s" });
      expect(status).toEqual([]);

      const renewed = runtime.create("s");
      await postRaw(`${renewed[CURSOR_HOOK_ENV_VAR]}/cursor`, eventBody("preToolUse"));
      expect(status).toEqual([{ sessionId: "s", agent: "cursor", state: "working" }]);
    });

    it("D2: a spawn made while the agent is disabled gets no coordinates, and enabling never entitles it", async () => {
      const { runtime, status } = await fixture({ enabled: false, extraAgents: [fakeAgent("claude")] });
      runtime.setAgentEnabled("claude", true);
      const env = runtime.create("s");
      expect(env[CURSOR_HOOK_ENV_VAR]).toBeUndefined();

      runtime.setAgentEnabled("cursor", true); // enabling must not reach the live session
      const claudeUrl = `${env.ANYWHERE_TERMINAL_CLAUDE_URL}/claude`;
      const token = new URL(claudeUrl).pathname.split("/")[2];
      await postRaw(`${runtime.url}/s/${token}/cursor`, eventBody("preToolUse"));
      expect(status).toEqual([]);

      const renewed = runtime.create("s");
      await postRaw(`${renewed[CURSOR_HOOK_ENV_VAR]}/cursor`, eventBody("preToolUse"));
      expect(status.at(-1)).toEqual({ sessionId: "s", agent: "cursor", state: "working" });
    });

    it("D2: disabling one of two agents leaves the other's live session working", async () => {
      const { runtime, status, reasons } = await fixture({ extraAgents: [fakeAgent("claude")] });
      runtime.setAgentEnabled("claude", true);
      const env = runtime.create("s");
      const cursorUrl = `${env[CURSOR_HOOK_ENV_VAR]}/cursor`;
      const claudeUrl = `${env.ANYWHERE_TERMINAL_CLAUDE_URL}/claude`;

      runtime.setAgentEnabled("cursor", false);
      await postRaw(cursorUrl, eventBody("preToolUse"));
      expect(reasons).toContainEqual({ reason: "disabled", sessionSuffix: "s" });

      await postRaw(claudeUrl, eventBody("preToolUse"));
      expect(status).toEqual([{ sessionId: "s", agent: "claude", state: "working" }]);
    });

    it("D2: re-enabling an agent does not re-entitle coordinates minted before the disable", async () => {
      const { runtime, status, reasons } = await fixture({ extraAgents: [fakeAgent("claude")] });
      runtime.setAgentEnabled("claude", true);
      const env = runtime.create("s");
      const cursorUrl = `${env[CURSOR_HOOK_ENV_VAR]}/cursor`;

      runtime.setAgentEnabled("cursor", false);
      runtime.setAgentEnabled("cursor", true);

      await postRaw(cursorUrl, eventBody("preToolUse"));
      expect(reasons).toContainEqual({ reason: "not-entitled", sessionSuffix: "s" });
      expect(status).toEqual([]);

      const renewed = runtime.create("s");
      await postRaw(`${renewed[CURSOR_HOOK_ENV_VAR]}/cursor`, eventBody("preToolUse"));
      expect(status.at(-1)).toEqual({ sessionId: "s", agent: "cursor", state: "working" });
    });
  });

  describe("in-flight lifecycle races (session revalidated before processing)", () => {
    it("release between auth and body completion suppresses the event", async () => {
      const { runtime, status, reasons } = await fixture({ requestDeadlineMs: 3_000 });
      const env = runtime.create("s");
      const body = eventBody("preToolUse");
      const { finish, responsePromise } = await openPartialRequest(
        `${env[CURSOR_HOOK_ENV_VAR]}/cursor`,
        body,
        body.length - 5,
      );
      await sleep(40);
      runtime.release("s");
      finish();

      expect(await responsePromise).toContain("204");
      expect(status.some((update) => update.state === "working")).toBe(false);
      expect(reasons).toContainEqual({ reason: "stale-session", sessionSuffix: "s" });
    });

    it("token renewal between auth and body completion invalidates the in-flight token", async () => {
      const { runtime, status, reasons } = await fixture({ requestDeadlineMs: 3_000 });
      const env = runtime.create("s");
      const body = eventBody("preToolUse");
      const { finish, responsePromise } = await openPartialRequest(
        `${env[CURSOR_HOOK_ENV_VAR]}/cursor`,
        body,
        body.length - 5,
      );
      await sleep(40);
      runtime.create("s"); // fallback-shell style renewal issues a fresh token
      finish();

      expect(await responsePromise).toContain("204");
      expect(status.some((update) => update.state === "working")).toBe(false);
      expect(reasons).toContainEqual({ reason: "stale-session", sessionSuffix: "s" });
    });

    it("disable between auth and body completion suppresses the in-flight event", async () => {
      const { runtime, status, reasons } = await fixture({ requestDeadlineMs: 3_000 });
      const env = runtime.create("s");
      const body = eventBody("preToolUse");
      const { finish, responsePromise } = await openPartialRequest(
        `${env[CURSOR_HOOK_ENV_VAR]}/cursor`,
        body,
        body.length - 5,
      );
      await sleep(40);
      runtime.setAgentEnabled("cursor", false);
      finish();

      expect(await responsePromise).toContain("204");
      expect(status.some((update) => update.state === "working")).toBe(false);
      expect(reasons).toContainEqual({ reason: "stale-session", sessionSuffix: "s" });
    });

    it("dispose between auth and body completion suppresses the in-flight event", async () => {
      const { runtime, status, reasons } = await fixture({ requestDeadlineMs: 3_000 });
      const env = runtime.create("s");
      const body = eventBody("preToolUse");
      const { finish, responsePromise } = await openPartialRequest(
        `${env[CURSOR_HOOK_ENV_VAR]}/cursor`,
        body,
        body.length - 5,
      );
      await sleep(40);
      runtime.dispose();
      finish();

      expect(await responsePromise).toContain("204");
      expect(status.some((update) => update.state === "working")).toBe(false);
      expect(reasons).toContainEqual({ reason: "stale-session", sessionSuffix: "s" });
    });
  });

  describe("diagnostic sanitization", () => {
    it("sanitizes an unsafe/control-character session id path segment out of diagnostics", async () => {
      const { runtime, reasons } = await fixture();
      runtime.create("s");
      const unsafeSessionId = "bad\nid ctrl";
      const response = await postRaw(
        `${runtime.url}/${encodeURIComponent(unsafeSessionId)}/token/cursor`,
        eventBody("preToolUse"),
      );
      expect(response.status).toBe(204);
      expect(reasons).toContainEqual({ reason: "unknown-session", sessionSuffix: "" });
      expect(JSON.stringify(reasons)).not.toContain("\\n");
    });
  });

  describe("payload privacy (cursor-hook-payload-privacy)", () => {
    it("never surfaces prompt/output/email/transcript content through status or diagnostics", async () => {
      const onStatus = vi.fn();
      const onReasonCode = vi.fn();
      const runtime = await createAgentHookRuntime([cursorAgentRegistration()], {}, { onStatus, onReasonCode });
      runtimes.push(runtime);
      runtime.setAgentEnabled("cursor", true);
      const env = runtime.create("s");
      const secret = "SECRET_PROMPT_do-not-leak";
      const body = JSON.stringify({
        hook_event_name: "beforeSubmitPrompt",
        conversation_id: "conv-priv",
        prompt: secret,
        attachments: [{ type: "file", file_path: "/etc/passwd" }],
        user_email: "user@example.com",
        transcript_path: "/tmp/transcript.json",
        command: "rm -rf /",
        output: "leaked shell output",
      });

      await postRaw(`${env[CURSOR_HOOK_ENV_VAR]}/cursor`, body);
      // also exercise a malformed/duplicate/unknown-session path with the same sensitive body
      await postRaw(`${env[CURSOR_HOOK_ENV_VAR]}/cursor`, body); // duplicate
      await postRaw(`${runtime.url}/unknown-session/deadbeef/cursor`, body); // unauthorized

      const allArgs = JSON.stringify([...onStatus.mock.calls, ...onReasonCode.mock.calls]);
      expect(allArgs).not.toContain(secret);
      expect(allArgs).not.toContain("rm -rf");
      expect(allArgs).not.toContain("user@example.com");
      expect(allArgs).not.toContain("transcript.json");
      expect(allArgs).not.toContain("leaked shell output");
      expect(allArgs).not.toContain("/etc/passwd");

      expect(onStatus).toHaveBeenCalledWith({ sessionId: "s", agent: "cursor", state: "working" });
      const reasonCalls = onReasonCode.mock.calls.map(([reason, suffix]) => ({ reason, sessionSuffix: suffix }));
      expect(reasonCalls).toContainEqual({ reason: "duplicate-event", sessionSuffix: "s" });
    });
  });
});
