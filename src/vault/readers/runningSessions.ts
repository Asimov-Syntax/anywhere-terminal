// src/vault/readers/runningSessions.ts — Enumerate LIVE Claude CLI sessions from
// the PID registry (`~/.claude/sessions/<pid>.json`), liveness-probed.
// See: specs/claude-running-session-map/spec.md "Detect running Claude sessions";
//      design.md D4; docs/research/20260601-claude-cli-running-detection-and-subagent-linkage.md §1a.
//
// Each registry file carries `{ pid, sessionId, cwd, startedAt, kind }`; only the
// base fields are relied on (the activity heartbeat is build-gated). A file whose
// pid is dead (ESRCH) is stale and skipped, exactly as Claude's own
// `isProcessRunning` decides liveness.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type ClaudeReaderOptions, claudeRoots } from "./claudePaths";

export interface RunningClaudeSession {
  sessionId: string;
  cwd: string;
  pid: number;
  /** Launch time (epoch ms, `Date.now()` on disk); secondary tie-break only. */
  startedAt?: number;
  /**
   * Raw `entrypoint` from the registry file, or `undefined` when the field is
   * absent or not a string. Deliberately NOT defaulted: "absent" and "a value
   * we don't recognise" must both stay distinguishable from a known headless
   * value. See `isHeadlessSession`.
   */
  entrypoint?: string;
}

/**
 * `entrypoint` values that mark a one-shot, non-interactive run.
 *
 * Measured against claude 2.1.239: `claude -p "…"` writes a normal live PID
 * file carrying `{"kind":"interactive","entrypoint":"sdk-cli"}` and removes it
 * on exit, while an interactive session writes `"entrypoint":"cli"`. `kind` is
 * useless here — the headless run reports `"interactive"` too.
 * See asimov/changes/fix-false-agent-signals/discovery.md §9.2.
 */
const HEADLESS_ENTRYPOINTS: ReadonlySet<string> = new Set(["sdk-cli"]);

/**
 * True when this registry entry is a headless one-shot run rather than a
 * session a terminal could be showing.
 *
 * An ALLOW-LIST of known headless values, never `entrypoint !== "cli"`. The
 * inverted form looks equivalent but breaks silently: `entrypoint` belongs to
 * another product's on-disk format, so a release that adds a value (an IDE
 * launcher, a new integration) would see every such session misclassified as
 * headless and the user's real session stop resolving. Under the allow-list the
 * same drift degrades to the previous behaviour.
 * See asimov/changes/fix-false-agent-signals/design.md D2.
 */
export function isHeadlessSession(session: RunningClaudeSession): boolean {
  return session.entrypoint !== undefined && HEADLESS_ENTRYPOINTS.has(session.entrypoint);
}

/** Injectable liveness probe — kept separate from fs so tests stay process-free. */
export interface RunningSessionsDeps {
  /** `process.kill(pid, 0)` semantics: true when the process exists. */
  isAlive(pid: number): boolean;
}

const defaultDeps: RunningSessionsDeps = {
  isAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      // ESRCH → no such process (stale). EPERM → exists but owned by another
      // user — still "alive" for our purposes (the local claude is same-user).
      return (err as NodeJS.ErrnoException).code === "EPERM";
    }
  },
};

/**
 * Which of two live entries claiming the same `sessionId` survives.
 *
 * Interactive beats headless before `startedAt` is consulted: a one-shot
 * `claude -p --resume <id>` writes a newer pid file for a session a terminal is
 * still showing, and letting it win would drop the interactive entry — whose
 * pid is the one actually in the pane's subtree — before the caller can filter.
 * See .reviews/round-1.md [W2].
 */
function winsDedupe(candidate: RunningClaudeSession, existing: RunningClaudeSession): boolean {
  const candidateHeadless = isHeadlessSession(candidate);
  if (candidateHeadless !== isHeadlessSession(existing)) {
    return !candidateHeadless;
  }
  const candidateStarted = candidate.startedAt ?? 0;
  const existingStarted = existing.startedAt ?? 0;
  if (candidateStarted !== existingStarted) {
    return candidateStarted > existingStarted;
  }
  // Stable secondary key so an exact tie doesn't resolve by readdir order —
  // same reasoning as `pickNewest` in resolveClaudeSession.ts.
  return candidate.pid > existing.pid;
}

/** `~/.claude/sessions` — sibling of the projects root (same config-dir logic). */
function sessionsDir(options: ClaudeReaderOptions): string {
  const { projectsDir } = claudeRoots(options);
  return path.join(path.dirname(projectsDir), "sessions");
}

/**
 * Return one entry per LIVE Claude session. Files are matched strictly by
 * `<pid>.json` (Claude's own guard), parsed defensively (malformed skipped), and
 * kept only when the pid passes the liveness probe. Deduped by sessionId (a
 * resumed session rewrites its pid file in place): on a collision an interactive
 * entry beats a headless one outright, and only then does the newer `startedAt`
 * win, with `pid` as a stable tie-break — see `winsDedupe`. Never throws — a
 * missing dir yields `[]`.
 */
export async function listRunningClaudeSessions(
  options: ClaudeReaderOptions = {},
  deps: RunningSessionsDeps = defaultDeps,
): Promise<RunningClaudeSession[]> {
  const dir = sessionsDir(options);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return []; // no registry dir → no running sessions
  }
  const bySession = new Map<string, RunningClaudeSession>();
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) {
      continue; // strict guard (claude-code concurrentSessions.ts, #34210)
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(await fs.readFile(path.join(dir, name), "utf8")) as Record<string, unknown>;
    } catch {
      continue; // unreadable / malformed → skip, don't fail the scan
    }
    if (!parsed || typeof parsed !== "object") {
      continue;
    }
    const pid = typeof parsed.pid === "number" ? parsed.pid : Number(parsed.pid);
    const { sessionId, cwd } = parsed;
    if (!Number.isInteger(pid) || pid <= 0 || typeof sessionId !== "string" || typeof cwd !== "string") {
      continue;
    }
    if (!deps.isAlive(pid)) {
      continue; // stale (crashed/exited, ESRCH) → ignore
    }
    const startedAt = typeof parsed.startedAt === "number" ? parsed.startedAt : undefined;
    const entrypoint = typeof parsed.entrypoint === "string" ? parsed.entrypoint : undefined;
    const entry: RunningClaudeSession = {
      sessionId,
      cwd,
      pid,
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...(entrypoint !== undefined ? { entrypoint } : {}),
    };
    const existing = bySession.get(sessionId);
    if (!existing || winsDedupe(entry, existing)) {
      bySession.set(sessionId, entry);
    }
  }
  return [...bySession.values()];
}
