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
import { type ClaudeReaderOptions, claudeRoots, isSafeSessionId } from "./claudePaths";

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
  /**
   * The session's own name (`name` in the registry file), bounded and trimmed.
   *
   * The one name Claude itself publishes for a live session — derived from the
   * directory (`docs-54`) or set by the user (`WORKTREE-PHASE6`) — and the only
   * identity a presence row can show without opening a transcript. Absent when
   * the field is missing, not a string, or empty after trimming: a registry
   * written by a Claude old enough not to carry it must stay distinguishable
   * from one that named the session the empty string.
   */
  name?: string;
}

/**
 * Upper bound on a session name.
 *
 * The registry file is another product's format on a shared filesystem, and
 * this value is rendered into a row and folded into the tree's render
 * signature — neither has a length it stops being a name at, so the bound is
 * imposed here rather than by whichever consumer notices first.
 */
export const MAX_SESSION_NAME_CHARS = 200;

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

/**
 * What one enumeration of the registry concluded.
 *
 * A read that could not happen is not a read that found nothing: mapping both to
 * `[]` is what let a permissions error silently clear every row derived from it.
 * The shape mirrors `DescendantsOutcome` rather than inventing a second
 * vocabulary for the same idea (design.md D1).
 */
export type RunningSessionsOutcome =
  | { kind: "ok"; sessions: RunningClaudeSession[] }
  | { kind: "failed"; reason: string };

/**
 * A registry record as read, whether or not its process still exists.
 *
 * The removal assessment asks a different question of this directory than the
 * presence panel does: not "who is running" but "is anything recorded here at
 * all". `listRunningClaudeSessions` drops a dead record, so its empty result
 * cannot tell "no record" from "a dead record was filtered out" — and that
 * distinction is the ownership proof (worktree-removal.md § 4.1).
 */
export interface ClaudeSessionRecord extends RunningClaudeSession {
  /** `process.kill(pid, 0)` semantics at the moment of the read. */
  alive: boolean;
}

export type SessionRecordsOutcome = { kind: "ok"; records: ClaudeSessionRecord[] } | { kind: "failed"; reason: string };

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
 * Enumerate the LIVE Claude sessions, reporting whether the registry could be
 * read at all. Files are matched strictly by
 * `<pid>.json` (Claude's own guard), parsed defensively (malformed skipped), and
 * kept only when the pid passes the liveness probe. Deduped by sessionId (a
 * resumed session rewrites its pid file in place): on a collision an interactive
 * entry beats a headless one outright, and only then does the newer `startedAt`
 * win, with `pid` as a stable tie-break — see `winsDedupe`. Never throws.
 *
 * A registry directory that does not exist reports `ok` with no sessions: a
 * machine where Claude has never run genuinely has none, and calling that a
 * degradation would mark every such window stale forever. Any other `readdir`
 * failure reports `failed`, which is the case the caller must not confuse with
 * an empty machine.
 */
/**
 * One registry file, validated — or `undefined` when it is not a record.
 *
 * Every guard lives here rather than in a caller, because two callers now ask
 * different questions of the same directory and a guard enforced on only one of
 * them is a guard that does not exist.
 */
function parseRecord(fileName: string, text: string): RunningClaudeSession | undefined {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined; // unreadable / malformed → skip, don't fail the scan
  }
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const pid = typeof parsed.pid === "number" ? parsed.pid : Number(parsed.pid);
  // The filename is not decoration: Claude writes `${process.pid}.json`
  // carrying `pid: process.pid`, so a stem that disagrees with its payload is
  // malformed by construction — and trusting the payload would let such a file
  // impersonate whatever live process it names (.reviews/round-2.md B2).
  // `indexRunningSessions` keeps `byPid` list-valued regardless, as defence in
  // depth for records this guard never sees.
  if (pid !== Number(fileName.slice(0, -".json".length))) {
    return undefined;
  }
  const { sessionId, cwd } = parsed;
  if (!Number.isInteger(pid) || pid <= 0 || typeof sessionId !== "string" || typeof cwd !== "string") {
    return undefined;
  }
  // A record that cannot name a session, or name where it is running, is not
  // one. This id is published as a vault entry id and as an `external:` row
  // identity, and every downstream Claude reader resolves a transcript by it,
  // so it faces the same canonical guard those readers use rather than a
  // non-empty check that admits separators and traversal
  // (.reviews/round-1.md W1, .reviews/round-4.md W4). A relative cwd would be
  // resolved against THIS process's directory before being containment-tested
  // against a worktree.
  if (!isSafeSessionId(sessionId) || !path.isAbsolute(cwd)) {
    return undefined;
  }
  // Finite and non-negative, not merely `typeof "number"`: `1e999` parses as
  // Infinity and would pin its worktree above every real activity, and this
  // value is published as a time as well as ordered on. A rejected one falls
  // back to first-seen, exactly as a record carrying no launch time does
  // (.reviews/round-4.md W5).
  const startedAt =
    typeof parsed.startedAt === "number" && Number.isFinite(parsed.startedAt) && parsed.startedAt >= 0
      ? parsed.startedAt
      : undefined;
  const entrypoint = typeof parsed.entrypoint === "string" ? parsed.entrypoint : undefined;
  // Trimmed before the emptiness test, so a name of nothing but whitespace is
  // absent rather than a title that renders as a blank row.
  const trimmedName = typeof parsed.name === "string" ? parsed.name.trim() : "";
  const sessionName = trimmedName === "" ? undefined : trimmedName.slice(0, MAX_SESSION_NAME_CHARS);
  return {
    sessionId,
    cwd,
    pid,
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(entrypoint !== undefined ? { entrypoint } : {}),
    ...(sessionName !== undefined ? { name: sessionName } : {}),
  };
}

/**
 * Every well-formed record in the registry, each carrying whether its process
 * still exists. NOT deduped: dedupe is the live reader's rule, and it exists to
 * pick the row a pane should show. The question here is whether ANY live
 * process holds a directory, so collapsing two records could hide the live one.
 */
export async function listClaudeSessionRecords(
  options: ClaudeReaderOptions = {},
  deps: RunningSessionsDeps = defaultDeps,
): Promise<SessionRecordsOutcome> {
  const dir = sessionsDir(options);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "ok", records: [] }; // never run here → genuinely none
    }
    return { kind: "failed", reason: describeReadFailure(err) };
  }
  const records: ClaudeSessionRecord[] = [];
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) {
      continue; // strict guard (claude-code concurrentSessions.ts, #34210)
    }
    let text: string;
    try {
      text = await fs.readFile(path.join(dir, name), "utf8");
    } catch {
      continue;
    }
    const record = parseRecord(name, text);
    if (record !== undefined) {
      records.push({ ...record, alive: deps.isAlive(record.pid) });
    }
  }
  return { kind: "ok", records };
}

/**
 * The LIVE sessions, deduped — unchanged in what it reports.
 *
 * Built on the same scan the record reader uses, so a guard can never be
 * enforced on one question and not the other.
 */
export async function listRunningClaudeSessions(
  options: ClaudeReaderOptions = {},
  deps: RunningSessionsDeps = defaultDeps,
): Promise<RunningSessionsOutcome> {
  const outcome = await listClaudeSessionRecords(options, deps);
  if (outcome.kind !== "ok") {
    return outcome;
  }
  const bySession = new Map<string, RunningClaudeSession>();
  for (const record of outcome.records) {
    if (!record.alive) {
      continue; // stale (crashed/exited, ESRCH) → ignore
    }
    const { alive: _alive, ...entry } = record;
    const existing = bySession.get(entry.sessionId);
    if (!existing || winsDedupe(entry, existing)) {
      bySession.set(entry.sessionId, entry);
    }
  }
  return { kind: "ok", sessions: [...bySession.values()] };
}

/** The reason shown verbatim in the stale affordance, so it names the real cause. */
function describeReadFailure(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code;
  const detail = err instanceof Error ? err.message : String(err);
  return code ? `the running-session registry could not be read (${code}): ${detail}` : detail;
}

/**
 * The live registry as an index, for a caller with no failure to propagate.
 *
 * A failed read indexes an empty set, so resolution degrades to its cwd
 * fallback rather than erroring — what the reader's original `catch { return
 * [] }` did. Presence does NOT use this: D7 needs the failure itself, and an
 * empty index would read to it as a conclusive absence. One helper because the
 * two terminal providers are exactly the surfaces that must agree about
 * identity (.reviews/round-4.md W6).
 */
export async function indexRunningSessionsOrEmpty(
  read: Promise<RunningSessionsOutcome> | RunningSessionsOutcome,
): Promise<RunningSessionIndex> {
  const outcome = await read;
  return indexRunningSessions(outcome.kind === "ok" ? outcome.sessions : []);
}

/**
 * The live registry, keyed for the two questions resolution actually asks.
 *
 * `~/.claude/sessions` is user-wide: every live Claude session on the machine,
 * unrelated to this window or this workspace. Filtering that array per pane
 * makes a presence rebuild O(panes x sessions) with no bound on either side —
 * "there are only a few" is a habit, not a limit (.reviews/round-2.md W1).
 *
 * Headless runs are dropped once, at build time, rather than re-filtered by
 * every caller: a hook-spawned `claude -p` is a descendant of the pane's pty
 * AND shares its cwd, so it can hijack both lookups alike.
 */
export interface RunningSessionIndex {
  /** Live sessions whose pid is in `pids`. */
  byPid(pids: ReadonlySet<number>): readonly RunningClaudeSession[];
  /** Live sessions launched in exactly `cwd`. */
  byCwd(cwd: string): readonly RunningClaudeSession[];
  /**
   * The live record for one session id, or `undefined`.
   *
   * Singular where the other two are lists because the reader deduped on this
   * key before the index was built. Exists so a caller holding the id a
   * resolution returned can read the rest of that record — the session's own
   * `name` — without re-scanning the registry it just consulted.
   */
  bySessionId(sessionId: string): RunningClaudeSession | undefined;
  /**
   * Every live, non-headless session — the set both lookups are built from.
   *
   * The external-row pass reads this rather than the reader's array, so the
   * headless drop keeps one site. Handed the raw array it would render every
   * hook-spawned `claude -p` as an agent (design.md D2).
   */
  all(): readonly RunningClaudeSession[];
}

const NONE: readonly RunningClaudeSession[] = [];

export function indexRunningSessions(sessions: readonly RunningClaudeSession[]): RunningSessionIndex {
  const byPid = new Map<number, RunningClaudeSession[]>();
  const byCwd = new Map<string, RunningClaudeSession[]>();
  const bySessionId = new Map<string, RunningClaudeSession>();
  const live: RunningClaudeSession[] = [];

  function push(
    index: Map<string | number, RunningClaudeSession[]>,
    key: string | number,
    session: RunningClaudeSession,
  ) {
    const sharing = index.get(key);
    if (sharing) {
      sharing.push(session);
    } else {
      index.set(key, [session]);
    }
  }

  for (const session of sessions) {
    if (isHeadlessSession(session)) {
      continue;
    }
    // A pid maps to a LIST, not to one session. The registry dedupes by
    // sessionId and never checks that a `<pid>.json` payload agrees with its
    // own filename, so two records can claim one pid — and a map that keeps the
    // last writer decides pane identity by enumeration order, where the filter
    // this replaced handed both to the mtime tie-break (.reviews/round-3.md W4).
    live.push(session);
    bySessionId.set(session.sessionId, session);
    push(byPid as Map<string | number, RunningClaudeSession[]>, session.pid, session);
    push(byCwd as Map<string | number, RunningClaudeSession[]>, session.cwd, session);
  }

  return {
    byPid(pids) {
      // Driven by the (small) descendant set, never by the registry: this is
      // the lookup that would otherwise scan every session on the machine.
      const found: RunningClaudeSession[] = [];
      for (const pid of pids) {
        const sharing = byPid.get(pid);
        if (sharing) {
          found.push(...sharing);
        }
      }
      return found;
    },
    byCwd: (cwd) => byCwd.get(cwd) ?? NONE,
    bySessionId: (sessionId) => bySessionId.get(sessionId),
    all: () => live,
  };
}
