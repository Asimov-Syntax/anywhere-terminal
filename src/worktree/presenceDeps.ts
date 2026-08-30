// src/worktree/presenceDeps.ts — The production wiring for the presence
// projection, the way `worktreeDeps.ts` is the wiring for discovery.
//
// The projector injects every source it reads, which keeps its rules testable
// without a process table or a session store. This is the one place those
// sources are bound to the real ones — and the one place D9's per-rebuild bound
// is actually enforced: `openSnapshot` takes the process-table read and the
// running-session read ONCE and hands the same two promises to every pane.
//
// See: asimov/changes/project-worktree-agent-presence/design.md D1, D8, D9.

import * as path from "node:path";
import {
  createProcessTableSnapshot,
  type ProcessTableReading,
  type ProcessTableSnapshot,
} from "../pty/processTableSnapshot";
import type { PaneEvidenceStore } from "../session/PaneEvidenceStore";
import { resolveClaudeSession } from "../session/resolveClaudeSession";
import { createTrackedPathResolver, ResolvedPathMemo } from "../utils/resolvedPathMemo";
import { claudeSessionMtime, resolveClaudeSessionPath } from "../vault/readers/claudePaths";
import {
  indexRunningSessionsOrEmpty,
  listRunningClaudeSessions,
  type RunningSessionsOutcome,
} from "../vault/readers/runningSessions";
import { formatEntryId, type VaultAgentId, type VaultSessionEntry } from "../vault/types";
import type { SessionLookup } from "./agentIdentity";
import type { PresenceProjectorDeps, ReportedSessionEntry, ResolutionSnapshot } from "./presenceProjector";

export interface PresenceDepsOptions {
  /** The window's pane registry — the pane set AND the pane facts (design.md D2). */
  store: PaneEvidenceStore;
  /** Shared process table. One per window, so an external scan can join its read. */
  table?: ProcessTableSnapshot;
  listRunning?(): Promise<RunningSessionsOutcome>;
  sessionMtime?(sessionId: string): Promise<number | undefined>;
  /** Vault title for a session the registry did not name; see `PresenceProjectorDeps`. */
  sessionTitle?(entryId: string): Promise<string | undefined>;
  /** That session's last activity; see `PresenceProjectorDeps`. */
  sessionPreview?(entryId: string): Promise<string | undefined>;
  sessionPreviewLine?(entryId: string): string | undefined;
  retainSessionPreviews?(entryIds: Iterable<string>): void;
  /** Where the vault keeps a Claude session, by id. */
  sessionPath?(sessionId: string): Promise<string | null>;
  /** Every vault session, indexed once per rebuild for cwd fallbacks. */
  listSessions?(): Promise<readonly VaultSessionEntry[]>;
  /** A standing terminal-bound report, such as OpenCode's session id. */
  reportedSession?(paneId: string): { agent: VaultAgentId; entryId: string } | undefined;
  /**
   * Where the window's cwds resolve. Supplied so the removal-blocker filters —
   * which compare the SAME pane cwds against the same worktree ids — share one
   * set of resolutions with the projection, rather than keeping a second memo
   * that could answer differently for the same path.
   */
  cwdMemo?: ResolvedPathMemo;
  now?(): number;
}

/** Most resolved sessions remembered at once; the oldest is dropped past it. */
export const REPORTED_SESSION_CACHE_CAP = 128;

export function createPresenceProjectorDeps(options: PresenceDepsOptions): PresenceProjectorDeps {
  const store = options.store;
  const table = options.table ?? createProcessTableSnapshot();
  const listRunning = options.listRunning ?? (() => listRunningClaudeSessions());
  const sessionMtime = options.sessionMtime ?? claudeSessionMtime;
  const sessionPath = options.sessionPath ?? ((sessionId: string) => resolveClaudeSessionPath(sessionId));
  /**
   * Where a resolved session lives, for as long as it is worth remembering.
   *
   * Bounded because the growth axis is distinct session ids the window has ever
   * seen reported, not panes it currently holds: a long-lived window that
   * resumes sessions all day would otherwise accumulate one entry per session
   * forever (.reviews/round-1.md B6).
   */
  const reportedSessions = new Map<string, Promise<string | null>>();
  /** Where each cwd this window has attributed really is. Keyed by path, so the
   *  bound is directories the window has seen, not pushes it has served. */
  const cwdMemo = options.cwdMemo ?? new ResolvedPathMemo();
  /** Two claims over the one memo, because panes and sessions are two bounded
   *  sets retiring on two triggers. Each releases only its own (D6). */
  const paneCwds = createTrackedPathResolver(cwdMemo);
  const sessionCwds = createTrackedPathResolver(cwdMemo);

  return {
    panes: () => store.panes(),
    activityFor: (paneId, now) => store.explainActivityFor(paneId, now),

    // Resolved, not merely `path.resolve`d: the worktree ids this is compared
    // against are already realpathed by `normalizeWorktreePath`, so a pane whose
    // shell reports a symlinked cwd where git reported the physical path used to
    // be attributed to no worktree at all. The claims below do the resolving in
    // one bounded pass per projection, which is what lets this stay synchronous.
    holdPaneCwds: (paths) => paneCwds.prepare(paths),
    holdSessionCwds: (paths) => sessionCwds.prepare(paths),
    normalize: (p) => cwdMemo.resolvedOr(p),

    ...(options.sessionTitle ? { sessionTitle: options.sessionTitle } : {}),
    ...(options.sessionPreview ? { sessionPreview: options.sessionPreview } : {}),
    ...(options.sessionPreviewLine ? { sessionPreviewLine: options.sessionPreviewLine } : {}),
    ...(options.retainSessionPreviews ? { retainSessionPreviews: options.retainSessionPreviews } : {}),
    ...(options.reportedSession ? { reportedSession: options.reportedSession } : {}),

    /**
     * Resolve by id, and only by id.
     *
     * `resolveClaudeSessionPath` scans project directories for a file NAMED by
     * the id and containment-checks the candidate before returning it, so a
     * reported value can select an entry that exists but can never point the
     * read anywhere — which is the whole of § 4.6's constraint. Memoized per
     * session for the window's life, like `sessionTitle`, because the scan is
     * filesystem work on the 150 ms projection path.
     */
    async resolveReportedSession(sessionId: string): Promise<ReportedSessionEntry | null> {
      let pending = reportedSessions.get(sessionId);
      if (pending === undefined) {
        pending = sessionPath(sessionId);
        if (reportedSessions.size >= REPORTED_SESSION_CACHE_CAP) {
          const oldest = reportedSessions.keys().next().value;
          if (oldest !== undefined) {
            reportedSessions.delete(oldest);
          }
        }
        reportedSessions.set(sessionId, pending);
        // Only a hit is durable. A pane can report its session before the
        // transcript exists on disk, so remembering the miss would answer every
        // later projection with the one moment the file was not there yet.
        //
        // Compared before deleting: this entry may already have been evicted and
        // a newer read installed under the same id, and dropping THAT one would
        // undo the deduplication this cache exists for (round-2.md W7).
        const settled = pending;
        const forget = () => {
          if (reportedSessions.get(sessionId) === settled) {
            reportedSessions.delete(sessionId);
          }
        };
        void settled.then((resolved) => {
          if (resolved === null) {
            forget();
          }
        }, forget);
      }
      const transcriptPath = await pending;
      return transcriptPath === null
        ? null
        : { entryId: formatEntryId("claude", sessionId), agent: "claude", transcriptPath };
    },

    now: options.now,

    async openSnapshot(): Promise<ResolutionSnapshot> {
      // Read AND indexed once. Taken per pane this would be N registry scans —
      // `resolveClaudeSession` reads the registry itself on every invocation —
      // and the registry is `~/.claude/sessions`, every live Claude session on
      // the machine, so the per-pane filter had no bound (.reviews/round-2.md W1).
      // The outcome is kept, not unwrapped: 1_3 hands it to the external pass and
      // types the failure through to pane resolution, and an empty index built
      // from a failed read is exactly the silent clear this change removes.
      // The outcome is kept whole. Unwrapping it here would hand a failed read
      // to resolution as an empty index — the silent clear this change removes —
      // and would leave the external pass unable to tell empty from unreadable.
      const registryRead = listRunning();
      const running = indexRunningSessionsOrEmpty(registryRead);

      // One table for the whole rebuild, taken on first use so a window with no
      // pty-backed pane costs no `ps` at all. Asking the snapshot per pane left
      // the TTL deciding the boundary, which is exactly what D9 forbids
      // (.reviews/round-1.md B2).
      let reading: Promise<ProcessTableReading> | undefined;
      const processTable = () => (reading ??= table.open());

      // The vault is a full multi-agent read, so every pane in this rebuild
      // shares one lazily-built newest-session-per-agent-and-cwd index.
      let sessionsRead: Promise<Map<string, string>> | undefined;
      const newestUnderCwd = (): Promise<Map<string, string>> => {
        sessionsRead ??= (async () => {
          const newest = new Map<string, string>();
          const modified = new Map<string, number>();
          for (const entry of (await options.listSessions?.()) ?? []) {
            const key = `${entry.agent}\u0000${path.resolve(entry.cwd)}`;
            const previous = modified.get(key);
            if (previous === undefined || entry.modified > previous) {
              modified.set(key, entry.modified);
              newest.set(key, entry.id);
            }
          }
          return newest;
        })();
        return sessionsRead;
      };

      // One resolve-and-stat per session id per rebuild, not per pane that
      // tie-breaks on it: `resolveClaudeSessionPath` scans every Claude project
      // directory, so the un-memoized cost is O(panes x sessions x dirs)
      // filesystem probes on the 150 ms projection path (.reviews/round-1.md W1).
      const mtimes = new Map<string, Promise<number | undefined>>();
      const mtimeOf = (sessionId: string): Promise<number | undefined> => {
        const pending = mtimes.get(sessionId) ?? sessionMtime(sessionId);
        mtimes.set(sessionId, pending);
        return pending;
      };

      return {
        ...(options.listSessions
          ? {
              async sessionUnderCwd(agent: VaultAgentId, cwd: string): Promise<string | undefined> {
                return (await newestUnderCwd()).get(`${agent}\u0000${cwd}`);
              },
            }
          : {}),

        async sessions(): Promise<RunningSessionsOutcome> {
          const read = await registryRead;
          // `all()`, never `read.sessions`: the headless drop happens in the
          // index, and the raw array still carries every `claude -p` one-shot.
          return read.kind === "ok" ? { kind: "ok", sessions: [...(await running).all()] } : read;
        },

        async resolve(pane): Promise<SessionLookup> {
          // Checked first: a registry that could not be read says nothing about
          // this pane, and resolving against the empty index it degrades to
          // would read as a conclusive "no agent here" (design.md D7).
          const read = await registryRead;
          if (read.kind === "failed") {
            return { kind: "failed", source: "registry", reason: read.reason };
          }
          // The descendant lookup is checked before resolution rather than
          // inside it: `ResolveClaudeSessionDeps.descendantPids` has no way to
          // carry a failure, so the outcome would be flattened to "no pids".
          let descendants: readonly number[] = [];
          if (pane.ptyPid !== undefined) {
            const outcome = (await processTable()).descendantsOf(pane.ptyPid);
            if (outcome.kind === "failed") {
              return { kind: "failed", source: "panes", reason: outcome.reason };
            }
            descendants = outcome.kind === "ok" ? outcome.pids : [];
          }

          const session = await resolveClaudeSession(pane.paneId, {
            getPtyPid: () => pane.ptyPid,
            getCwd: async () => pane.cwd,
            runningIndex: () => running,
            descendantPids: async () => [...descendants],
            sessionMtime: mtimeOf,
            // Presence claims identity only from evidence that proves an agent
            // is in this pane NOW. The newest transcript recorded under a
            // directory proves an agent ran there once, which would paint a
            // plain shell as the agent that used to occupy it.
            newestSessionUnderCwd: async () => null,
          });

          if (session === null) {
            return { kind: "absent" };
          }
          // The name comes from the index the resolution already consulted, so a
          // titled pane costs no read of its own.
          const named = (await running).bySessionId(session.sessionId)?.name;
          return {
            kind: "resolved",
            agent: "claude",
            sessionId: session.sessionId,
            evidence: session.evidence,
            ...(named !== undefined ? { name: named } : {}),
          };
        },
      };
    },
  };
}
