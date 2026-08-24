// src/cursor/CursorHookRuntime.ts — Loopback-only Cursor hook HTTP runtime:
// per-session renewable tokens, the exact D7 event → semantic-state table,
// per-session dedup, freshness expiry, and reason-code-only diagnostics
// (integrate-cursor-agent 2_2).

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export type CursorSemanticState = "working" | "idle";

export interface CursorActivityUpdate {
  sessionId: string;
  agent: "cursor";
  state: CursorSemanticState | null;
}

/** Mirrors `SessionManager`'s per-session environment-contribution seam (design D6). */
export interface SessionEnvironmentContributor {
  create(sessionId: string): Record<string, string>;
  release(sessionId: string): void;
}

export type CursorHookReasonCode =
  | "disabled"
  | "method-not-allowed"
  | "bad-path"
  | "oversized-body"
  | "deadline-exceeded"
  | "malformed-json"
  | "unknown-session"
  | "invalid-token"
  | "unknown-event"
  | "duplicate-event"
  | "stale-session";

export const CURSOR_HOOK_BODY_CAP_BYTES = 1_048_576;
export const CURSOR_HOOK_REQUEST_DEADLINE_MS = 5_000;
export const CURSOR_HOOK_QUIET_WINDOW_MS = 1_500;
export const CURSOR_HOOK_FRESHNESS_MS = 30 * 60 * 1000;
export const CURSOR_HOOK_DEDUP_TTL_MS = 5 * 60 * 1000;
export const CURSOR_HOOK_DEDUP_MAX_ENTRIES = 256;

/** Exact D7 event → effect table. No hook produces "waiting"; unknown events are ignored. */
type CursorHookEventEffect = "clear" | "working" | "quiet";

const EVENT_EFFECTS: Record<string, CursorHookEventEffect> = {
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

export interface CursorHookRuntimeOptions {
  enabled?: boolean;
  /** 0 (default) lets the OS assign an ephemeral loopback port. */
  port?: number;
  bodyCapBytes?: number;
  requestDeadlineMs?: number;
  quietWindowMs?: number;
  freshnessMs?: number;
  dedupTtlMs?: number;
  dedupMaxEntries?: number;
}

export interface CursorHookRuntimeDependencies {
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  randomToken?: () => string;
  onStatus?: (update: CursorActivityUpdate) => void;
  /** Reason-code-only diagnostics; never receives body content, digests, or parser excerpts. */
  onReasonCode?: (reason: CursorHookReasonCode, sessionSuffix: string) => void;
}

interface SessionState {
  token: string;
  state: CursorSemanticState | null;
  quietTimer: unknown;
  freshnessTimer: unknown;
  /** digest -> insertion time (ms); insertion-ordered for cheap TTL pruning + LRU eviction. */
  dedup: Map<string, number>;
}

/** A stable-identity, loopback-only, fail-open Cursor hook HTTP server. */
export class CursorHookRuntime implements SessionEnvironmentContributor {
  private readonly server: Server;
  private readonly sessions = new Map<string, SessionState>();
  private enabled: boolean;
  private port: number;

  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly randomToken: () => string;
  private readonly onStatus: (update: CursorActivityUpdate) => void;
  private readonly onReasonCode: (reason: CursorHookReasonCode, sessionSuffix: string) => void;

  private readonly bodyCapBytes: number;
  private readonly requestDeadlineMs: number;
  private readonly quietWindowMs: number;
  private readonly freshnessMs: number;
  private readonly dedupTtlMs: number;
  private readonly dedupMaxEntries: number;

  public constructor(options: CursorHookRuntimeOptions = {}, dependencies: CursorHookRuntimeDependencies = {}) {
    this.enabled = options.enabled ?? false;
    this.port = options.port ?? 0;
    this.bodyCapBytes = options.bodyCapBytes ?? CURSOR_HOOK_BODY_CAP_BYTES;
    this.requestDeadlineMs = options.requestDeadlineMs ?? CURSOR_HOOK_REQUEST_DEADLINE_MS;
    this.quietWindowMs = options.quietWindowMs ?? CURSOR_HOOK_QUIET_WINDOW_MS;
    this.freshnessMs = options.freshnessMs ?? CURSOR_HOOK_FRESHNESS_MS;
    this.dedupTtlMs = options.dedupTtlMs ?? CURSOR_HOOK_DEDUP_TTL_MS;
    this.dedupMaxEntries = options.dedupMaxEntries ?? CURSOR_HOOK_DEDUP_MAX_ENTRIES;

    this.now = dependencies.now ?? Date.now;
    this.setTimer = dependencies.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = dependencies.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
    this.randomToken = dependencies.randomToken ?? (() => randomBytes(32).toString("hex"));
    this.onStatus = dependencies.onStatus ?? (() => undefined);
    this.onReasonCode = dependencies.onReasonCode ?? (() => undefined);

    this.server = createServer((req, res) => this.handleRequest(req, res));
  }

  /** Binds the loopback listener; must resolve before `create()` is called. */
  public async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.server.once("error", onError);
      this.server.listen(this.port, "127.0.0.1", () => {
        this.server.removeListener("error", onError);
        const address = this.server.address();
        if (address && typeof address === "object") {
          this.port = address.port;
        }
        resolve();
      });
    });
  }

  public get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /**
   * Enable/disable gates event acceptance. Disabling releases authority (D6):
   * every registered session's semantic state is cleared and its token is
   * discarded, so a stale pre-disable token is never accepted again — even
   * after re-enabling. A fresh `create()` is required per session.
   *
   * Clearing runs every time `enabled` is `false` — not only on a true→false
   * transition — because `create()` can register a session while already
   * disabled (SessionManager wiring races); a repeated `setEnabled(false)`
   * must still revoke it, idempotently.
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      for (const [sessionId, session] of this.sessions) {
        this.clearSessionState(sessionId, session);
      }
      this.sessions.clear();
    }
  }

  /** Issues a fresh renewable token for `sessionId`, invalidating any prior token/state. */
  public create(sessionId: string): Record<string, string> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      this.clearSessionState(sessionId, existing);
    }
    const token = this.randomToken();
    this.sessions.set(sessionId, {
      token,
      state: null,
      quietTimer: undefined,
      freshnessTimer: undefined,
      dedup: new Map(),
    });
    const url = `${this.url}/${encodeURIComponent(sessionId)}/${encodeURIComponent(token)}`;
    return { ANYWHERE_TERMINAL_CURSOR_URL: url };
  }

  /** Revokes authority for `sessionId` and clears any live status for it. */
  public release(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    this.clearSessionState(sessionId, session);
    this.sessions.delete(sessionId);
  }

  public dispose(): void {
    // Set first so any in-flight/re-entrant `resolveLiveSession` check never
    // observes `enabled` after disposal has begun.
    this.enabled = false;
    for (const [sessionId, session] of this.sessions) {
      this.clearSessionState(sessionId, session);
    }
    this.sessions.clear();
    this.server.close();
  }

  /** Re-checks enabled + live registration + token at the moment of use, not at auth time. */
  private resolveLiveSession(sessionId: string, token: string): SessionState | undefined {
    if (!this.enabled) {
      return undefined;
    }
    const session = this.sessions.get(sessionId);
    if (!session || !constantTimeEquals(session.token, token)) {
      return undefined;
    }
    return session;
  }

  // -- request handling -----------------------------------------------------

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const finish = (): void => {
      if (!res.headersSent) {
        res.writeHead(200, { "content-type": "application/json" });
      }
      if (!res.writableEnded) {
        res.end("{}");
      }
    };

    if (req.method !== "POST") {
      this.onReasonCode("method-not-allowed", "");
      req.resume();
      finish();
      return;
    }

    const parsed = parseHookPath(req.url ?? "");
    if (!parsed) {
      this.onReasonCode("bad-path", "");
      req.resume();
      finish();
      return;
    }
    const { sessionId, token } = parsed;

    if (!this.enabled) {
      this.onReasonCode("disabled", sessionSuffix(sessionId));
      req.resume();
      finish();
      return;
    }

    const initialSession = this.sessions.get(sessionId);
    if (!initialSession) {
      this.onReasonCode("unknown-session", sessionSuffix(sessionId));
      req.resume();
      finish();
      return;
    }
    if (!constantTimeEquals(initialSession.token, token)) {
      this.onReasonCode("invalid-token", sessionSuffix(sessionId));
      req.resume();
      finish();
      return;
    }

    let settled = false;
    let total = 0;
    let oversized = false;
    const chunks: Buffer[] = [];

    const deadline = this.setTimer(() => {
      if (settled) {
        return;
      }
      settled = true;
      this.onReasonCode("deadline-exceeded", sessionSuffix(sessionId));
      // Actively drain/terminate so an incomplete client cannot retain
      // request resources: keep pulling bytes off the socket immediately,
      // then close it once the fail-open response has been flushed.
      req.resume();
      res.once("finish", () => req.destroy());
      finish();
    }, this.requestDeadlineMs);

    req.on("data", (chunk: Buffer) => {
      if (settled || oversized) {
        return;
      }
      total += chunk.length;
      if (total > this.bodyCapBytes) {
        oversized = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (settled) {
        return;
      }
      settled = true;
      this.clearTimer(deadline);
      if (oversized) {
        this.onReasonCode("oversized-body", sessionSuffix(sessionId));
        finish();
        return;
      }
      // Revalidate immediately before processing the completed body: release,
      // token renewal, disable, or dispose may have happened while the body
      // was still streaming. A stale captured session must never emit status.
      const liveSession = this.resolveLiveSession(sessionId, token);
      if (!liveSession) {
        this.onReasonCode("stale-session", sessionSuffix(sessionId));
        finish();
        return;
      }
      this.processEvent(liveSession, sessionId, Buffer.concat(chunks));
      finish();
    });

    req.on("error", () => {
      if (settled) {
        return;
      }
      settled = true;
      this.clearTimer(deadline);
      finish();
    });
  }

  private processEvent(session: SessionState, sessionId: string, body: Buffer): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf8"));
    } catch {
      this.onReasonCode("malformed-json", sessionSuffix(sessionId));
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      this.onReasonCode("malformed-json", sessionSuffix(sessionId));
      return;
    }
    // D10: parse only the event name / minimum identity — never retain the body.
    const eventName = (parsed as Record<string, unknown>).hook_event_name;
    if (typeof eventName !== "string" || eventName.length === 0) {
      this.onReasonCode("malformed-json", sessionSuffix(sessionId));
      return;
    }

    const digest = createHash("sha256").update(body).digest("hex");
    const now = this.now();
    this.pruneDedup(session, now);
    if (session.dedup.has(digest)) {
      this.onReasonCode("duplicate-event", sessionSuffix(sessionId));
      return;
    }
    this.insertDedup(session, digest, now);

    const effect = EVENT_EFFECTS[eventName];
    if (!effect) {
      this.onReasonCode("unknown-event", sessionSuffix(sessionId));
      return;
    }
    this.applyEffect(session, sessionId, effect);
  }

  private applyEffect(session: SessionState, sessionId: string, effect: CursorHookEventEffect): void {
    if (effect === "clear") {
      this.cancelTimers(session);
      this.setState(session, sessionId, null);
      return;
    }
    if (effect === "working") {
      if (session.quietTimer !== undefined) {
        this.clearTimer(session.quietTimer);
        session.quietTimer = undefined;
      }
      this.setState(session, sessionId, "working");
      this.armFreshness(session, sessionId);
      return;
    }
    // "quiet": (re)arm a single cancelable 1.5s candidate-idle window.
    if (session.quietTimer !== undefined) {
      this.clearTimer(session.quietTimer);
    }
    session.quietTimer = this.setTimer(() => {
      session.quietTimer = undefined;
      this.setState(session, sessionId, "idle");
      this.armFreshness(session, sessionId);
    }, this.quietWindowMs);
  }

  private armFreshness(session: SessionState, sessionId: string): void {
    if (session.freshnessTimer !== undefined) {
      this.clearTimer(session.freshnessTimer);
    }
    session.freshnessTimer = this.setTimer(() => {
      session.freshnessTimer = undefined;
      this.setState(session, sessionId, null);
    }, this.freshnessMs);
  }

  private setState(session: SessionState, sessionId: string, state: CursorSemanticState | null): void {
    if (session.state === state) {
      return;
    }
    session.state = state;
    this.onStatus({ sessionId, agent: "cursor", state });
  }

  private clearSessionState(sessionId: string, session: SessionState): void {
    this.cancelTimers(session);
    this.setState(session, sessionId, null);
  }

  private cancelTimers(session: SessionState): void {
    if (session.quietTimer !== undefined) {
      this.clearTimer(session.quietTimer);
      session.quietTimer = undefined;
    }
    if (session.freshnessTimer !== undefined) {
      this.clearTimer(session.freshnessTimer);
      session.freshnessTimer = undefined;
    }
  }

  private pruneDedup(session: SessionState, now: number): void {
    for (const [digest, insertedAt] of session.dedup) {
      if (now - insertedAt > this.dedupTtlMs) {
        session.dedup.delete(digest);
      } else {
        break; // Map preserves insertion order, which is chronological here.
      }
    }
  }

  private insertDedup(session: SessionState, digest: string, now: number): void {
    if (session.dedup.size >= this.dedupMaxEntries) {
      const oldest = session.dedup.keys().next().value;
      if (oldest !== undefined) {
        session.dedup.delete(oldest);
      }
    }
    session.dedup.set(digest, now);
  }
}

export async function createCursorHookRuntime(
  options: CursorHookRuntimeOptions = {},
  dependencies: CursorHookRuntimeDependencies = {},
): Promise<CursorHookRuntime> {
  const runtime = new CursorHookRuntime(options, dependencies);
  await runtime.listen();
  return runtime;
}

function parseHookPath(url: string): { sessionId: string; token: string } | undefined {
  const path = url.split("?")[0] ?? "";
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 3 || segments[2] !== "cursor") {
    return undefined;
  }
  try {
    const sessionId = decodeURIComponent(segments[0] ?? "");
    const token = decodeURIComponent(segments[1] ?? "");
    if (!sessionId || !token) {
      return undefined;
    }
    return { sessionId, token };
  } catch {
    return undefined;
  }
}

function constantTimeEquals(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actual, "utf8");
  if (expectedBuffer.length !== actualBuffer.length) {
    timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

// The URL path is untrusted input; only printable, non-control ASCII of a
// bounded length is safe to echo into diagnostics.
const SAFE_SUFFIX_PATTERN = /^[\x20-\x7e]+$/;

/** Never logs a full or unsafe session id — only a short, sanitized correlation suffix. */
function sessionSuffix(sessionId: string): string {
  if (sessionId.length === 0 || sessionId.length > 512 || !SAFE_SUFFIX_PATTERN.test(sessionId)) {
    return "";
  }
  return sessionId.slice(-6);
}
