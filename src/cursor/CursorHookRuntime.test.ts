// src/cursor/CursorHookRuntime.test.ts — Unit tests for the authenticated
// Cursor hook state machine: fail-open bounds, per-session renewable tokens,
// the exact D7 event table, dedup, quiet window, freshness expiry, and
// payload privacy (integrate-cursor-agent 2_2).

import { type ClientRequest, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionReport } from "../agentHooks/reportTypes";
import {
  CURSOR_HOOK_BODY_CAP_BYTES,
  CURSOR_HOOK_DEDUP_MAX_ENTRIES,
  CURSOR_HOOK_DEDUP_TTL_MS,
  CURSOR_HOOK_FRESHNESS_MS,
  CURSOR_HOOK_QUIET_WINDOW_MS,
  CURSOR_HOOK_REQUEST_DEADLINE_MS,
  type CursorActivityUpdate,
  type CursorHookReasonCode,
  createCursorHookRuntime,
} from "./CursorHookRuntime";

const runtimes: Array<{ dispose(): void }> = [];

afterEach(() => {
  runtimes.splice(0).forEach((runtime) => {
    runtime.dispose();
  });
});

async function fixture(options: Parameters<typeof createCursorHookRuntime>[0] = {}) {
  const status: CursorActivityUpdate[] = [];
  const reasons: Array<{ reason: CursorHookReasonCode; sessionSuffix: string }> = [];
  const reports: AgentSessionReport[] = [];
  const runtime = await createCursorHookRuntime(
    { enabled: true, ...options },
    {
      onStatus: (update) => status.push(update),
      onReasonCode: (reason, sessionSuffix) => reasons.push({ reason, sessionSuffix }),
      onReport: (report) => reports.push(report),
    },
  );
  runtimes.push(runtime);
  return { runtime, status, reasons, reports };
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

describe("CursorHookRuntime", () => {
  it("binds loopback-only and exports spec-default bounds", async () => {
    const { runtime } = await fixture();
    expect(runtime.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(CURSOR_HOOK_BODY_CAP_BYTES).toBe(1_048_576);
    expect(CURSOR_HOOK_REQUEST_DEADLINE_MS).toBe(5_000);
    expect(CURSOR_HOOK_QUIET_WINDOW_MS).toBe(1_500);
    expect(CURSOR_HOOK_FRESHNESS_MS).toBe(30 * 60 * 1000);
    expect(CURSOR_HOOK_DEDUP_TTL_MS).toBe(5 * 60 * 1000);
    expect(CURSOR_HOOK_DEDUP_MAX_ENTRIES).toBe(256);
  });

  it("wraps ANYWHERE_TERMINAL_CURSOR_URL so the wrapper's appended /cursor authenticates", async () => {
    const { runtime } = await fixture();
    const env = runtime.create("session-1");
    const base = env.ANYWHERE_TERMINAL_CURSOR_URL;
    expect(base).toBeDefined();
    expect(base as string).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/session-1\/[0-9a-f]+$/);
    const response = await postRaw(`${base}/cursor`, eventBody("beforeSubmitPrompt"));
    expect(response.status).toBe(200);
  });

  describe("one receiver, several reporting agents", () => {
    it("hands an OpenCode report the terminal its credential names", async () => {
      const { runtime, reports } = await fixture();
      const base = runtime.create("session-1").ANYWHERE_TERMINAL_AGENT_HOOK_URL;

      const response = await postRaw(`${base}/opencode`, JSON.stringify({ sessionID: "ses_abc123" }));

      expect(response.status).toBe(200);
      expect(reports).toEqual([{ terminalId: "session-1", agent: "opencode", sessionId: "ses_abc123" }]);
    });

    it("keeps a report naming no session out of the map", async () => {
      const { runtime, reports, reasons } = await fixture();
      const base = runtime.create("session-1").ANYWHERE_TERMINAL_AGENT_HOOK_URL;

      await postRaw(`${base}/opencode`, JSON.stringify({ part: { text: "a message part, not an id" } }));

      expect(reports).toEqual([]);
      expect(reasons.map((entry) => entry.reason)).toContain("malformed-json");
    });

    it("refuses a report presenting another terminal's token", async () => {
      const { runtime, reports, reasons } = await fixture();
      const base = runtime.create("session-1").ANYWHERE_TERMINAL_AGENT_HOOK_URL as string;
      const forged = base.replace(/\/[0-9a-f]+$/, "/deadbeef");

      await postRaw(`${forged}/opencode`, JSON.stringify({ sessionID: "ses_abc123" }));

      expect(reports).toEqual([]);
      expect(reasons.map((entry) => entry.reason)).toContain("invalid-token");
    });

    it("refuses a report once the terminal has been released", async () => {
      const { runtime, reports, reasons } = await fixture();
      const base = runtime.create("session-1").ANYWHERE_TERMINAL_AGENT_HOOK_URL;
      runtime.release("session-1");

      await postRaw(`${base}/opencode`, JSON.stringify({ sessionID: "ses_abc123" }));

      expect(reports).toEqual([]);
      expect(reasons.map((entry) => entry.reason)).toContain("unknown-session");
    });

    it("leaves Cursor's status untouched — a report is identity, not activity", async () => {
      const { runtime, status } = await fixture();
      const base = runtime.create("session-1").ANYWHERE_TERMINAL_AGENT_HOOK_URL;

      await postRaw(`${base}/opencode`, JSON.stringify({ sessionID: "ses_abc123" }));

      expect(status).toEqual([]);
    });

    it("refuses a path naming an agent that does not report", async () => {
      const { runtime, reports, reasons } = await fixture();
      const base = runtime.create("session-1").ANYWHERE_TERMINAL_AGENT_HOOK_URL;

      await postRaw(`${base}/codex`, JSON.stringify({ sessionID: "ses_abc123" }));

      expect(reports).toEqual([]);
      expect(reasons.map((entry) => entry.reason)).toContain("bad-path");
    });
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
      await postRaw(`${env.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`, eventBody(event));
      expect(status).toEqual([{ sessionId: "s", agent: "cursor", state: "working" }]);
    });

    const quietEvents = ["afterAgentResponse", "stop", "sessionEnd"];

    it.each(quietEvents)("%s becomes a candidate idle after the cancelable quiet window", async (event) => {
      const { runtime, status } = await fixture({ quietWindowMs: 20 });
      const env = runtime.create("s");
      await postRaw(`${env.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`, eventBody(event));
      expect(status).toEqual([]); // not immediate
      await sleep(60);
      expect(status).toEqual([{ sessionId: "s", agent: "cursor", state: "idle" }]);
    });

    it("sessionStart clears prior semantic state and never itself completes", async () => {
      const { runtime, status } = await fixture();
      const env = runtime.create("s");
      const url = `${env.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`;
      await postRaw(url, eventBody("preToolUse"));
      expect(status.at(-1)).toEqual({ sessionId: "s", agent: "cursor", state: "working" });
      await postRaw(url, eventBody("sessionStart"));
      expect(status.at(-1)).toEqual({ sessionId: "s", agent: "cursor", state: null });
    });

    it("unknown events are ignored and still respond fail-open", async () => {
      const { runtime, status, reasons } = await fixture();
      const env = runtime.create("s");
      const response = await postRaw(`${env.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`, eventBody("subagentStart"));
      expect(response.status).toBe(200);
      expect(status).toEqual([]);
      expect(reasons).toContainEqual({ reason: "unknown-event", sessionSuffix: "s" });
    });

    it("a renewed working event cancels a pending quiet-idle candidate", async () => {
      const { runtime, status } = await fixture({ quietWindowMs: 20 });
      const env = runtime.create("s");
      const url = `${env.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`;
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
      const response = await postRaw(`${env.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`, "", { method: "GET" });
      expect(response.status).toBe(200);
      expect(status).toEqual([]);
      expect(reasons).toContainEqual({ reason: "method-not-allowed", sessionSuffix: "" });
    });

    it("rejects bodies larger than 1 MiB", async () => {
      const { runtime, status, reasons } = await fixture({ bodyCapBytes: 16 });
      const env = runtime.create("s");
      const response = await postRaw(`${env.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`, eventBody("preToolUse"));
      expect(response.status).toBe(200);
      expect(status).toEqual([]);
      expect(reasons).toContainEqual({ reason: "oversized-body", sessionSuffix: "s" });
    });

    it("responds fail-open when the body never completes within the request deadline", async () => {
      const { runtime, status, reasons } = await fixture({ requestDeadlineMs: 30 });
      const env = runtime.create("s");
      const target = new URL(`${env.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`);
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
      expect(raw).toContain("200");
      expect(status).toEqual([]);
      expect(reasons).toContainEqual({ reason: "deadline-exceeded", sessionSuffix: "s" });
    });

    it("rejects malformed JSON bodies", async () => {
      const { runtime, status, reasons } = await fixture();
      const env = runtime.create("s");
      const response = await postRaw(`${env.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`, "not json {{{");
      expect(response.status).toBe(200);
      expect(status).toEqual([]);
      expect(reasons).toContainEqual({ reason: "malformed-json", sessionSuffix: "s" });
    });

    it("rejects an unrecognized URL shape", async () => {
      const { runtime, status, reasons } = await fixture();
      runtime.create("s");
      const response = await postRaw(`${runtime.url}/only-one-segment`, eventBody("preToolUse"));
      expect(response.status).toBe(200);
      expect(status).toEqual([]);
      expect(reasons).toContainEqual({ reason: "bad-path", sessionSuffix: "" });
    });
  });

  describe("session isolation (hook-session-isolation)", () => {
    it("rejects a stale token after renewal and accepts the renewed token", async () => {
      const { runtime, status, reasons } = await fixture();
      const first = runtime.create("s");
      const staleUrl = `${first.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`;
      const renewed = runtime.create("s"); // fallback-shell style renewal
      const renewedUrl = `${renewed.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`;
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
      await postRaw(`${first.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`, eventBody("preToolUse"));
      expect(status.at(-1)?.state).toBe("working");
      runtime.create("session-a"); // renewal must clear stale working state
      expect(status.at(-1)).toEqual({ sessionId: "session-a", agent: "cursor", state: null });
    });

    it("rejects a cross-pane token used against a different session id", async () => {
      const { runtime, status, reasons } = await fixture();
      const envA = runtime.create("pane-a");
      const envB = runtime.create("pane-b");
      const tokenA = new URL(envA.ANYWHERE_TERMINAL_CURSOR_URL as string).pathname.split("/")[2];
      const crossUrl = `${runtime.url}/pane-b/${tokenA}/cursor`;

      await postRaw(crossUrl, eventBody("preToolUse"));
      expect(reasons).toContainEqual({ reason: "invalid-token", sessionSuffix: "pane-b" });
      expect(status).toEqual([]);

      await postRaw(`${envB.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`, eventBody("preToolUse"));
      expect(status).toEqual([{ sessionId: "pane-b", agent: "cursor", state: "working" }]);
    });

    it("rejects requests for an unknown/released session", async () => {
      const { runtime, status, reasons } = await fixture();
      const env = runtime.create("s");
      const url = `${env.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`;
      runtime.release("s");
      await postRaw(url, eventBody("preToolUse"));
      expect(reasons).toContainEqual({ reason: "unknown-session", sessionSuffix: "s" });
      expect(status).toEqual([]);
    });

    it("release clears live status for the matching session only", async () => {
      const { runtime, status } = await fixture();
      const envA = runtime.create("pane-a");
      const envB = runtime.create("pane-b");
      await postRaw(`${envA.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`, eventBody("preToolUse"));
      await postRaw(`${envB.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`, eventBody("preToolUse"));
      status.length = 0;

      runtime.release("pane-a");
      expect(status).toEqual([{ sessionId: "pane-a", agent: "cursor", state: null }]);
    });
  });

  describe("per-session dedup LRU", () => {
    it("suppresses an exact duplicate delivery and processes it again once TTL elapses", async () => {
      let now = 1_000;
      const { runtime, status, reasons } = await fixture({ dedupTtlMs: 50 });
      // reconstruct with injected clock for deterministic TTL control
      runtime.dispose();
      const status2: CursorActivityUpdate[] = [];
      const reasons2: Array<{ reason: CursorHookReasonCode; sessionSuffix: string }> = [];
      const clocked = await createCursorHookRuntime(
        { enabled: true, dedupTtlMs: 50 },
        {
          now: () => now,
          onStatus: (update) => status2.push(update),
          onReasonCode: (reason, sessionSuffix) => reasons2.push({ reason, sessionSuffix }),
        },
      );
      runtimes.push(clocked);
      const env = clocked.create("s");
      const url = `${env.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`;
      const body = eventBody("preToolUse", { fixed: true });

      await postRaw(url, body);
      await postRaw(url, body); // exact duplicate within TTL
      expect(status2).toEqual([{ sessionId: "s", agent: "cursor", state: "working" }]);
      expect(reasons2).toContainEqual({ reason: "duplicate-event", sessionSuffix: "s" });

      now += 1_000; // advance past dedupTtlMs
      status2.length = 0;
      const reasonCountBefore = reasons2.length;
      await postRaw(url, body); // now treated as fresh again, not a duplicate
      expect(reasons2.filter((r) => r.reason === "duplicate-event")).toHaveLength(1);
      expect(reasons2).toHaveLength(reasonCountBefore); // no new duplicate-event recorded
      void status; // unused fixture output from the disposed runtime
      void reasons;
    });

    it("evicts the oldest digest once the per-session cap is exceeded", async () => {
      const { runtime, reasons } = await fixture({ dedupMaxEntries: 2 });
      const env = runtime.create("s");
      const url = `${env.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`;
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
      await postRaw(`${env.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`, eventBody("preToolUse"));
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
      await postRaw(`${envA.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`, eventBody("preToolUse"));
      await postRaw(`${envB.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`, eventBody("preToolUse"));

      runtime.setEnabled(false);
      expect(status.slice(-2)).toEqual(
        expect.arrayContaining([
          { sessionId: "pane-a", agent: "cursor", state: null },
          { sessionId: "pane-b", agent: "cursor", state: null },
        ]),
      );

      await postRaw(`${envA.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`, eventBody("preToolUse"));
      expect(reasons).toContainEqual({ reason: "disabled", sessionSuffix: "pane-a" });
      expect(status.slice(-2)).not.toContainEqual({ sessionId: "pane-a", agent: "cursor", state: "working" });
    });

    it("D6: disable releases authority — the old token stays unauthorized after re-enable and a fresh create() is required", async () => {
      const { runtime, status, reasons } = await fixture();
      const env = runtime.create("s");
      runtime.setEnabled(false);
      runtime.setEnabled(true);

      await postRaw(`${env.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`, eventBody("preToolUse"));
      expect(reasons).toContainEqual({ reason: "unknown-session", sessionSuffix: "s" });
      expect(status).toEqual([]);

      const renewed = runtime.create("s");
      await postRaw(`${renewed.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`, eventBody("preToolUse"));
      expect(status).toEqual([{ sessionId: "s", agent: "cursor", state: "working" }]);
    });

    it("D6: setEnabled(false) idempotently revokes a session created while already disabled", async () => {
      const { runtime, status, reasons } = await fixture({ enabled: false });
      const env = runtime.create("s"); // create() registers a session regardless of enabled state
      runtime.setEnabled(false); // already disabled — must not early-return without clearing
      runtime.setEnabled(true);

      await postRaw(`${env.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`, eventBody("preToolUse"));
      expect(reasons).toContainEqual({ reason: "unknown-session", sessionSuffix: "s" });
      expect(status).toEqual([]);

      const renewed = runtime.create("s");
      await postRaw(`${renewed.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`, eventBody("preToolUse"));
      expect(status).toEqual([{ sessionId: "s", agent: "cursor", state: "working" }]);
    });
  });

  describe("in-flight lifecycle races (session revalidated before processing)", () => {
    it("release between auth and body completion suppresses the event", async () => {
      const { runtime, status, reasons } = await fixture({ requestDeadlineMs: 3_000 });
      const env = runtime.create("s");
      const body = eventBody("preToolUse");
      const { finish, responsePromise } = await openPartialRequest(
        `${env.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`,
        body,
        body.length - 5,
      );
      await sleep(40);
      runtime.release("s");
      finish();

      expect(await responsePromise).toContain("200");
      expect(status.some((update) => update.state === "working")).toBe(false);
      expect(reasons).toContainEqual({ reason: "stale-session", sessionSuffix: "s" });
    });

    it("token renewal between auth and body completion invalidates the in-flight token", async () => {
      const { runtime, status, reasons } = await fixture({ requestDeadlineMs: 3_000 });
      const env = runtime.create("s");
      const body = eventBody("preToolUse");
      const { finish, responsePromise } = await openPartialRequest(
        `${env.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`,
        body,
        body.length - 5,
      );
      await sleep(40);
      runtime.create("s"); // fallback-shell style renewal issues a fresh token
      finish();

      expect(await responsePromise).toContain("200");
      expect(status.some((update) => update.state === "working")).toBe(false);
      expect(reasons).toContainEqual({ reason: "stale-session", sessionSuffix: "s" });
    });

    it("disable between auth and body completion suppresses the in-flight event", async () => {
      const { runtime, status, reasons } = await fixture({ requestDeadlineMs: 3_000 });
      const env = runtime.create("s");
      const body = eventBody("preToolUse");
      const { finish, responsePromise } = await openPartialRequest(
        `${env.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`,
        body,
        body.length - 5,
      );
      await sleep(40);
      runtime.setEnabled(false);
      finish();

      expect(await responsePromise).toContain("200");
      expect(status.some((update) => update.state === "working")).toBe(false);
      expect(reasons).toContainEqual({ reason: "stale-session", sessionSuffix: "s" });
    });

    it("dispose between auth and body completion suppresses the in-flight event", async () => {
      const { runtime, status, reasons } = await fixture({ requestDeadlineMs: 3_000 });
      const env = runtime.create("s");
      const body = eventBody("preToolUse");
      const { finish, responsePromise } = await openPartialRequest(
        `${env.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`,
        body,
        body.length - 5,
      );
      await sleep(40);
      runtime.dispose();
      finish();

      expect(await responsePromise).toContain("200");
      expect(status.some((update) => update.state === "working")).toBe(false);
      expect(reasons).toContainEqual({ reason: "stale-session", sessionSuffix: "s" });
    });
  });

  describe("diagnostic sanitization", () => {
    it("sanitizes an unsafe/control-character session id path segment out of diagnostics", async () => {
      const { runtime, reasons } = await fixture();
      runtime.create("s");
      const unsafeSessionId = "bad\nid ctrl";
      const response = await postRaw(
        `${runtime.url}/${encodeURIComponent(unsafeSessionId)}/token/cursor`,
        eventBody("preToolUse"),
      );
      expect(response.status).toBe(200);
      expect(reasons).toContainEqual({ reason: "unknown-session", sessionSuffix: "" });
      expect(JSON.stringify(reasons)).not.toContain("\\n");
    });
  });

  describe("payload privacy (cursor-hook-payload-privacy)", () => {
    it("never surfaces prompt/output/email/transcript content through status or diagnostics", async () => {
      const onStatus = vi.fn();
      const onReasonCode = vi.fn();
      const runtime = await createCursorHookRuntime({ enabled: true }, { onStatus, onReasonCode });
      runtimes.push(runtime);
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

      await postRaw(`${env.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`, body);
      // also exercise a malformed/duplicate/unknown-session path with the same sensitive body
      await postRaw(`${env.ANYWHERE_TERMINAL_CURSOR_URL}/cursor`, body); // duplicate
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
