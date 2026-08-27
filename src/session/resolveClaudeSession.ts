// src/session/resolveClaudeSession.ts — Map a terminal pane to the Claude
// `sessionId` it is showing. Resolution order (design.md D4 / spec "Map a
// terminal to its Claude session"):
//   1. process subtree of the pane's pty ∩ running PID registry (exact pid;
//      tie-break newest <sessionId>.jsonl mtime when >1);
//   2. running registry entries whose cwd equals the pane's live cwd (newest mtime);
//   3. newest Claude session recorded under that cwd (even if already exited).
//
// SessionManager + reader access is injected via `deps` so the algorithm is
// unit-tested without the host. The host (TerminalViewProvider) wires the real
// implementations; on Windows `descendantPids` is `[]` so only the cwd fallbacks run.

import type { RunningClaudeSession, RunningSessionIndex } from "../vault/readers/runningSessions";

/**
 * Which step matched, and so how much the match is worth.
 *
 * `reported` is the agent's own word, carried back over the credential issued
 * to one terminal. `process` is this window's reading of the machine — the
 * claude pid inside this pane's pty subtree, and no other pane's. `directory`
 * and `recent` are guesses that any pane sitting in the same directory would
 * have made, so a caller with more than one pane can only settle a contested
 * session by knowing which kind it holds.
 */
export type ClaudeSessionEvidence = "reported" | "process" | "directory" | "recent";

/** Strongest first. A contested session goes to a strictly higher rank, never to a tie. */
export const EVIDENCE_RANK: Record<ClaudeSessionEvidence, number> = {
  reported: 3,
  process: 2,
  directory: 1,
  recent: 0,
};

export interface ResolvedClaudeSession {
  sessionId: string;
  cwd: string;
  evidence: ClaudeSessionEvidence;
}

export interface ResolveClaudeSessionDeps {
  /** The pane's pty pid (subtree root), or undefined when the session is unknown. */
  getPtyPid(terminalId: string): number | undefined;
  /** The pane's best-available cwd (live → tracked → initial), or undefined. */
  getCwd(terminalId: string): Promise<string | undefined>;
  /**
   * Live, liveness-probed PID registry, keyed for lookup (runningSessions.ts).
   *
   * An index rather than a list because the registry is user-wide: scanning it
   * per pane made a presence rebuild grow with every Claude session on the
   * machine (.reviews/round-2.md W1).
   */
  runningIndex(): Promise<RunningSessionIndex>;
  /** Descendant pids of a root pid (processTree.ts); [] on Windows / error. */
  descendantPids(rootPid: number): Promise<number[]>;
  /** mtime (epoch ms) of `<sessionId>.jsonl`, or undefined when unresolved. */
  sessionMtime(sessionId: string): Promise<number | undefined>;
  /** Newest Claude session (running or exited) recorded under `cwd`, or null. */
  newestSessionUnderCwd(cwd: string): Promise<{ sessionId: string; cwd: string } | null>;
}

/** Among candidates, the one with the newest `<sessionId>.jsonl` mtime (current
 *  activity beats launch order); first candidate wins when all mtimes are equal. */
async function pickNewest(
  candidates: readonly RunningClaudeSession[],
  sessionMtime: ResolveClaudeSessionDeps["sessionMtime"],
): Promise<RunningClaudeSession> {
  let best = candidates[0];
  let bestMtime = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const mtime = (await sessionMtime(candidate.sessionId)) ?? 0;
    // Stable secondary key (lexical sessionId) so equal mtimes resolve the same
    // way regardless of readdir/scan order.
    if (mtime > bestMtime || (mtime === bestMtime && candidate.sessionId < best.sessionId)) {
      best = candidate;
      bestMtime = mtime;
    }
  }
  return best;
}

export async function resolveClaudeSession(
  terminalId: string,
  deps: ResolveClaudeSessionDeps,
): Promise<ResolvedClaudeSession | null> {
  // Headless runs are filtered at index build, not per step: a hook-spawned
  // `claude -p` is a descendant of this pty AND shares its cwd, so it can
  // hijack steps 1 and 2 alike, and its just-written transcript wins the mtime
  // tie-break. Step 3 reads from disk where no entrypoint exists — design.md D3.
  const running = await deps.runningIndex();

  // Step 1 — exact: the claude node pid is a descendant of the pane's pty shell.
  const ptyPid = deps.getPtyPid(terminalId);
  if (ptyPid !== undefined) {
    const subtree = new Set(await deps.descendantPids(ptyPid));
    const inTree = running.byPid(subtree);
    if (inTree.length === 1) {
      return { sessionId: inTree[0].sessionId, cwd: inTree[0].cwd, evidence: "process" };
    }
    if (inTree.length > 1) {
      const best = await pickNewest(inTree, deps.sessionMtime);
      return { sessionId: best.sessionId, cwd: best.cwd, evidence: "process" };
    }
  }

  // Steps 2 & 3 — cwd fallbacks. The pane's live cwd is the SHELL's cwd and may
  // differ from a registry launch cwd if the shell cd'd; a miss degrades to step 3.
  const cwd = await deps.getCwd(terminalId);
  if (cwd === undefined) {
    return null;
  }
  const byCwd = running.byCwd(cwd);
  if (byCwd.length > 0) {
    const best = await pickNewest(byCwd, deps.sessionMtime);
    return { sessionId: best.sessionId, cwd: best.cwd, evidence: "directory" };
  }
  const recent = await deps.newestSessionUnderCwd(cwd);
  return recent === null ? null : { ...recent, evidence: "recent" };
}
