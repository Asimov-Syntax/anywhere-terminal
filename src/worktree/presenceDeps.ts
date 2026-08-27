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
import { claudeSessionMtime } from "../vault/readers/claudePaths";
import {
  indexRunningSessionsOrEmpty,
  listRunningClaudeSessions,
  type RunningSessionsOutcome,
} from "../vault/readers/runningSessions";
import type { VaultAgentId } from "../vault/types";
import type { SessionLookup } from "./agentIdentity";
import type { PresenceProjectorDeps, ResolutionSnapshot } from "./presenceProjector";

export interface PresenceDepsOptions {
  /** The window's pane registry — the pane set AND the pane facts (design.md D2). */
  store: PaneEvidenceStore;
  /** Shared process table. One per window, so an external scan can join its read. */
  table?: ProcessTableSnapshot;
  listRunning?(): Promise<RunningSessionsOutcome>;
  sessionMtime?(sessionId: string): Promise<number | undefined>;
  /** Vault title for a resolved session; see `PresenceProjectorDeps`. */
  sessionTitle?(entryId: string): Promise<string | undefined>;
  /** Newest vault session for an agent under a directory; see `PresenceProjectorDeps`. */
  sessionUnderCwd?(agent: VaultAgentId, cwd: string): Promise<string | undefined>;
  /** What the agent in a pane reported about itself; see `PresenceProjectorDeps`. */
  reportedSession?(paneId: string, agent: VaultAgentId): string | undefined;
  now?(): number;
}

export function createPresenceProjectorDeps(options: PresenceDepsOptions): PresenceProjectorDeps {
  const store = options.store;
  const table = options.table ?? createProcessTableSnapshot();
  const listRunning = options.listRunning ?? (() => listRunningClaudeSessions());
  const sessionMtime = options.sessionMtime ?? claudeSessionMtime;

  return {
    panes: () => store.panes(),
    activityFor: (paneId, now) => store.explainActivityFor(paneId, now),

    // `path.resolve` only: `isPathInside` owns separator drift and drive-letter
    // casing, and a realpath here would have to be async. A pane whose shell
    // reports a symlinked cwd where git reported the physical path is the one
    // case this misses.
    normalize: (p) => path.resolve(p),

    ...(options.sessionTitle ? { sessionTitle: options.sessionTitle } : {}),
    ...(options.sessionUnderCwd ? { sessionUnderCwd: options.sessionUnderCwd } : {}),
    ...(options.reportedSession ? { reportedSession: options.reportedSession } : {}),

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
