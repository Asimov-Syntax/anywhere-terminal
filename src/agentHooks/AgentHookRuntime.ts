// src/agentHooks/AgentHookRuntime.ts — Loopback-only agent hook HTTP runtime.
// One runtime serves every hook-capable agent: it owns transport, per-session
// tokens, per-session agent entitlement, slug-namespaced dedup, and failure
// containment. Event vocabulary and state machines belong to the per-agent
// modules in ./agents (generalize-agent-hook-runtime D2, D5).

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { VaultAgentId } from "../vault/types";

export interface AgentActivityUpdate {
  sessionId: string;
  agent: VaultAgentId;
  state: string | null;
}

/** Mirrors `SessionManager`'s per-session environment-contribution seam (design D6). */
export interface SessionEnvironmentContributor {
  create(sessionId: string): Record<string, string>;
  release(sessionId: string): void;
}

export type AgentHookReasonCode =
  | "disabled"
  | "method-not-allowed"
  | "bad-path"
  | "oversized-body"
  | "deadline-exceeded"
  | "malformed-json"
  | "unknown-session"
  | "invalid-token"
  | "not-entitled"
  | "unknown-event"
  | "duplicate-event"
  | "stale-session"
  | "agent-error";

export const AGENT_HOOK_BODY_CAP_BYTES = 1_048_576;
export const AGENT_HOOK_REQUEST_DEADLINE_MS = 5_000;
export const AGENT_HOOK_DEDUP_TTL_MS = 5 * 60 * 1000;
export const AGENT_HOOK_DEDUP_MAX_ENTRIES = 256;

/**
 * What the core lends an agent module for one session. Timer handles are
 * tracked here, not by the agent, so a module that forgets to cancel one
 * cannot leak it past teardown.
 */
export interface AgentHookChannel {
  readonly sessionId: string;
  now(): number;
  /**
   * An agent may hand back a promise; the core observes it, so a rejection is
   * contained exactly like a synchronous throw. Scheduling is refused once the
   * state is revoked.
   */
  setTimer(callback: () => void | Promise<void>, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** Publishes this agent's semantic state; repeats of the current value are dropped. */
  publish(state: string | null): void;
  /** Reason-code-only diagnostics; never receives body content or parser excerpts. */
  reason(code: AgentHookReasonCode): void;
}

/** One agent's per-session reducer. Both methods may throw; the core contains it. */
export interface AgentHookSession {
  /** Bounded raw body — decoding is the agent's own concern. */
  handle(body: Buffer): void;
  dispose(): void;
}

export interface AgentHookRegistration {
  readonly id: VaultAgentId;
  /** Third URL path segment the agent's wrapper appends. */
  readonly slug: string;
  /** Environment variable carrying this agent's coordinates into a spawn. */
  readonly envVar: string;
  createSession(channel: AgentHookChannel): AgentHookSession;
}

export interface AgentHookRuntimeOptions {
  /** 0 (default) lets the OS assign an ephemeral loopback port. */
  port?: number;
  bodyCapBytes?: number;
  requestDeadlineMs?: number;
  dedupTtlMs?: number;
  dedupMaxEntries?: number;
}

export interface AgentHookRuntimeDependencies {
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  randomToken?: () => string;
  onStatus?: (update: AgentActivityUpdate) => void;
  onReasonCode?: (reason: AgentHookReasonCode, sessionSuffix: string) => void;
}

interface AgentSlot {
  registration: AgentHookRegistration;
  enabled: boolean;
}

interface AgentSessionState {
  session: AgentHookSession;
  state: string | null;
  /**
   * Cleared before teardown so a timer callback that was already queued when
   * its entitlement was revoked cannot publish afterwards (D5).
   */
  active: boolean;
  timers: Set<unknown>;
  /** digest -> insertion time (ms); insertion-ordered for cheap TTL pruning + LRU eviction. */
  dedup: Map<string, number>;
}

interface SessionState {
  token: string;
  /** Agents whose coordinates this spawn actually received (D2). */
  entitled: Map<VaultAgentId, AgentSessionState>;
}

/** A stable-identity, loopback-only, fail-open multi-agent hook HTTP server. */
export class AgentHookRuntime implements SessionEnvironmentContributor {
  private readonly server: Server;
  private readonly sessions = new Map<string, SessionState>();
  private readonly agents = new Map<VaultAgentId, AgentSlot>();
  private readonly agentsBySlug = new Map<string, AgentSlot>();
  private port: number;
  private disposed = false;

  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly randomToken: () => string;
  private readonly onStatus: (update: AgentActivityUpdate) => void;
  private readonly onReasonCode: (reason: AgentHookReasonCode, sessionSuffix: string) => void;

  private readonly bodyCapBytes: number;
  private readonly requestDeadlineMs: number;
  private readonly dedupTtlMs: number;
  private readonly dedupMaxEntries: number;

  public constructor(options: AgentHookRuntimeOptions = {}, dependencies: AgentHookRuntimeDependencies = {}) {
    this.port = options.port ?? 0;
    this.bodyCapBytes = options.bodyCapBytes ?? AGENT_HOOK_BODY_CAP_BYTES;
    this.requestDeadlineMs = options.requestDeadlineMs ?? AGENT_HOOK_REQUEST_DEADLINE_MS;
    this.dedupTtlMs = options.dedupTtlMs ?? AGENT_HOOK_DEDUP_TTL_MS;
    this.dedupMaxEntries = options.dedupMaxEntries ?? AGENT_HOOK_DEDUP_MAX_ENTRIES;

    this.now = dependencies.now ?? Date.now;
    this.setTimer = dependencies.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = dependencies.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
    this.randomToken = dependencies.randomToken ?? (() => randomBytes(32).toString("hex"));
    this.onStatus = dependencies.onStatus ?? (() => undefined);
    this.onReasonCode = dependencies.onReasonCode ?? (() => undefined);

    this.server = createServer((req, res) => this.handleRequest(req, res));
  }

  /** Registers an agent. Registration alone grants nothing — enablement is separate. */
  public registerAgent(registration: AgentHookRegistration): void {
    if (this.agents.has(registration.id) || this.agentsBySlug.has(registration.slug)) {
      throw new Error(`agent hook registration conflict: ${registration.id}/${registration.slug}`);
    }
    const slot: AgentSlot = { registration, enabled: false };
    this.agents.set(registration.id, slot);
    this.agentsBySlug.set(registration.slug, slot);
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
   * Enable/disable one agent. Disabling releases that agent's authority (D2):
   * it is struck from EVERY live session's entitlement set and its per-session
   * state, timers, and dedup are cleared, so coordinates already sitting in a
   * pane's environment stay unusable even after re-enabling — a fresh
   * `create()` is the only way back. Disabling the last enabled agent clears
   * the session registry outright, which for a single-agent window reproduces
   * the pre-generalization all-or-nothing behaviour exactly.
   *
   * Clearing runs every time `enabled` is `false` — not only on a true→false
   * transition — because `create()` can register a session while an agent is
   * already disabled (wiring races); a repeated disable must still revoke it.
   */
  public setAgentEnabled(agent: VaultAgentId, enabled: boolean): void {
    const slot = this.agents.get(agent);
    if (!slot) {
      return;
    }
    slot.enabled = enabled;
    if (enabled) {
      return;
    }
    // Last one out clears the whole registry, so skip the per-agent sweep that
    // `clearAllSessions()` would immediately repeat.
    if (!this.hasEnabledAgent()) {
      this.clearAllSessions();
      return;
    }
    for (const [sessionId, session] of this.sessions) {
      const agentState = session.entitled.get(agent);
      if (agentState) {
        this.clearAgentState(sessionId, agent, agentState);
        session.entitled.delete(agent);
      }
    }
  }

  public isAgentEnabled(agent: VaultAgentId): boolean {
    return this.agents.get(agent)?.enabled ?? false;
  }

  /** Enablement silently ignores unknown ids, so callers granting authority must ask first. */
  public isAgentRegistered(agent: VaultAgentId): boolean {
    return this.agents.has(agent);
  }

  /**
   * Issues a fresh renewable token for `sessionId`, invalidating any prior
   * token and state, and entitles exactly the agents enabled right now.
   */
  public create(sessionId: string): Record<string, string> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      this.clearSessionState(sessionId, existing);
    }
    const token = this.randomToken();
    const session: SessionState = { token, entitled: new Map() };
    this.sessions.set(sessionId, session);

    const env: Record<string, string> = {};
    const coordinates = `${this.url}/${encodeURIComponent(sessionId)}/${encodeURIComponent(token)}`;
    for (const slot of this.agents.values()) {
      if (!slot.enabled) {
        continue;
      }
      const agentState = this.createAgentState(sessionId, slot.registration);
      if (!agentState) {
        continue;
      }
      session.entitled.set(slot.registration.id, agentState);
      env[slot.registration.envVar] = coordinates;
    }
    return env;
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
    // Set first so any in-flight/re-entrant `resolveLiveAgent` check never
    // observes a usable runtime after disposal has begun.
    this.disposed = true;
    for (const slot of this.agents.values()) {
      slot.enabled = false;
    }
    this.clearAllSessions();
    this.server.close();
  }

  // -- session/agent state --------------------------------------------------

  /**
   * Constructs one agent's per-session state behind a containment boundary
   * (D5). A registration whose constructor throws yields `null`: whatever it
   * published or armed before throwing is rolled back, `agent-error` is
   * emitted, and the caller omits that agent entirely rather than handing out
   * coordinates nothing is listening on.
   */
  private createAgentState(sessionId: string, registration: AgentHookRegistration): AgentSessionState | null {
    const state: AgentSessionState = {
      session: undefined as unknown as AgentHookSession,
      state: null,
      active: true,
      timers: new Set(),
      dedup: new Map(),
    };
    const channel: AgentHookChannel = {
      sessionId,
      now: () => this.now(),
      setTimer: (callback, ms) => {
        // Revoked state schedules nothing, so work queued after teardown can
        // never re-enter the agent.
        if (!state.active) {
          return undefined;
        }
        const handle = this.setTimer(() => {
          state.timers.delete(handle);
          // A revoked entitlement must not publish, and an agent-owned
          // callback must never surface as an uncaught host exception —
          // whether it throws or returns a rejecting promise.
          if (!state.active) {
            return;
          }
          try {
            const result = callback();
            if (result && typeof (result as Promise<void>).then === "function") {
              void (result as Promise<void>).catch(() => {
                this.onReasonCode("agent-error", sessionSuffix(sessionId));
              });
            }
          } catch {
            this.onReasonCode("agent-error", sessionSuffix(sessionId));
          }
        }, ms);
        state.timers.add(handle);
        return handle;
      },
      clearTimer: (handle) => {
        state.timers.delete(handle);
        this.clearTimer(handle);
      },
      publish: (published) => {
        // Fails closed after rollback or teardown: a module that retained the
        // channel cannot restore status its entitlement no longer covers.
        if (!state.active || state.state === published) {
          return;
        }
        state.state = published;
        this.onStatus({ sessionId, agent: registration.id, state: published });
      },
      reason: (code) => this.onReasonCode(code, sessionSuffix(sessionId)),
    };
    try {
      state.session = registration.createSession(channel);
    } catch {
      state.active = false;
      for (const handle of state.timers) {
        this.clearTimer(handle);
      }
      state.timers.clear();
      if (state.state !== null) {
        state.state = null;
        this.onStatus({ sessionId, agent: registration.id, state: null });
      }
      this.onReasonCode("agent-error", sessionSuffix(sessionId));
      return null;
    }
    return state;
  }

  private clearAgentState(sessionId: string, agent: VaultAgentId, state: AgentSessionState): void {
    state.active = false;
    try {
      state.session.dispose();
    } catch {
      this.onReasonCode("agent-error", sessionSuffix(sessionId));
    }
    for (const handle of state.timers) {
      this.clearTimer(handle);
    }
    state.timers.clear();
    if (state.state !== null) {
      state.state = null;
      this.onStatus({ sessionId, agent, state: null });
    }
  }

  private clearSessionState(sessionId: string, session: SessionState): void {
    for (const [agent, state] of session.entitled) {
      this.clearAgentState(sessionId, agent, state);
    }
    session.entitled.clear();
  }

  private clearAllSessions(): void {
    for (const [sessionId, session] of this.sessions) {
      this.clearSessionState(sessionId, session);
    }
    this.sessions.clear();
  }

  private hasEnabledAgent(): boolean {
    for (const slot of this.agents.values()) {
      if (slot.enabled) {
        return true;
      }
    }
    return false;
  }

  /** Re-checks disposal, enablement, live registration, token, and entitlement at the moment of use. */
  private resolveLiveAgent(sessionId: string, token: string, slot: AgentSlot): AgentSessionState | undefined {
    if (this.disposed || !slot.enabled) {
      return undefined;
    }
    const session = this.sessions.get(sessionId);
    if (!session || !constantTimeEquals(session.token, token)) {
      return undefined;
    }
    return session.entitled.get(slot.registration.id);
  }

  // -- request handling -----------------------------------------------------

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const finish = (): void => {
      if (!res.headersSent) {
        res.writeHead(204);
      }
      if (!res.writableEnded) {
        res.end();
      }
    };

    if (req.method !== "POST") {
      this.onReasonCode("method-not-allowed", "");
      req.resume();
      finish();
      return;
    }

    const parsed = parseHookPath(req.url ?? "");
    const slot = parsed ? this.agentsBySlug.get(parsed.slug) : undefined;
    if (!parsed || !slot) {
      this.onReasonCode("bad-path", "");
      req.resume();
      finish();
      return;
    }
    const { sessionId, token } = parsed;

    if (this.disposed || !slot.enabled) {
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
    if (!initialSession.entitled.has(slot.registration.id)) {
      this.onReasonCode("not-entitled", sessionSuffix(sessionId));
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
      const agentState = this.resolveLiveAgent(sessionId, token, slot);
      if (!agentState) {
        this.onReasonCode("stale-session", sessionSuffix(sessionId));
        finish();
        return;
      }
      this.deliver(agentState, sessionId, Buffer.concat(chunks));
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

  /**
   * Dedups per agent — identical bytes posted to two slugs are two events —
   * then hands the raw body to the agent module. A module that throws is
   * dropped rather than allowed to reach the socket: fail-open governs, so a
   * buggy reducer must never stall the agent that posted.
   */
  private deliver(agentState: AgentSessionState, sessionId: string, body: Buffer): void {
    const digest = createHash("sha256").update(body).digest("hex");
    const now = this.now();
    this.pruneDedup(agentState, now);
    if (agentState.dedup.has(digest)) {
      this.onReasonCode("duplicate-event", sessionSuffix(sessionId));
      return;
    }
    this.insertDedup(agentState, digest, now);

    try {
      agentState.session.handle(body);
    } catch {
      this.onReasonCode("agent-error", sessionSuffix(sessionId));
    }
  }

  private pruneDedup(agentState: AgentSessionState, now: number): void {
    for (const [digest, insertedAt] of agentState.dedup) {
      if (now - insertedAt > this.dedupTtlMs) {
        agentState.dedup.delete(digest);
      } else {
        break; // Map preserves insertion order, which is chronological here.
      }
    }
  }

  private insertDedup(agentState: AgentSessionState, digest: string, now: number): void {
    if (agentState.dedup.size >= this.dedupMaxEntries) {
      const oldest = agentState.dedup.keys().next().value;
      if (oldest !== undefined) {
        agentState.dedup.delete(oldest);
      }
    }
    agentState.dedup.set(digest, now);
  }
}

export async function createAgentHookRuntime(
  registrations: AgentHookRegistration[],
  options: AgentHookRuntimeOptions = {},
  dependencies: AgentHookRuntimeDependencies = {},
): Promise<AgentHookRuntime> {
  const runtime = new AgentHookRuntime(options, dependencies);
  for (const registration of registrations) {
    runtime.registerAgent(registration);
  }
  await runtime.listen();
  return runtime;
}

function parseHookPath(url: string): { sessionId: string; token: string; slug: string } | undefined {
  const path = url.split("?")[0] ?? "";
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 3) {
    return undefined;
  }
  try {
    const sessionId = decodeURIComponent(segments[0] ?? "");
    const token = decodeURIComponent(segments[1] ?? "");
    const slug = segments[2] ?? "";
    if (!sessionId || !token || !slug) {
      return undefined;
    }
    return { sessionId, token, slug };
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
