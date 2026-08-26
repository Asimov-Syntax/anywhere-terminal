// src/worktree/presenceProjector.ts — This window's panes, as agent rows under
// the worktree each one is inside.
//
// The pane set comes from `PaneEvidenceStore`, never from `SessionManager`: a
// naturally exited pty is deleted from the session map while its tab is still
// on screen reading "[Process exited]", so enumerating sessions would drop
// exactly the `exited` row this projection has to keep (design.md D2).
//
// Every shared read is hoisted into one snapshot taken at `project()` entry, so
// a rebuild costs one process-table read and one registry read no matter how
// many panes the window holds (D9). Everything a rebuild is allowed to remember
// between calls lives in `PaneState` below.
//
// See: docs/design/worktree-agent-presence.md § 2, § 3.1–3.4;
//      asimov/changes/project-worktree-agent-presence/design.md D8, D10–D13.

import type { PaneEvidence } from "../session/PaneEvidenceStore";
import type { ActivityRule, PaneActivity } from "../shared/paneEvidence";
import { isPathInside } from "../utils/pathBoundary";
import type { VaultAgentId } from "../vault/types";
import { resolveAgentIdentity, type SessionLookup } from "./agentIdentity";
import type { PresenceDegradation, WorktreeAgentRow, WorktreePresence } from "./presenceTypes";

/** One pane as the store hands it over. */
export type Pane = PaneEvidence & { paneId: string };

/**
 * This rebuild's shared reads, already taken.
 *
 * One object per `project()` call: the process table and the running-session
 * registry are read through it, so a pane resolving late in the sweep joins the
 * same read the first pane issued rather than starting its own (D9).
 */
export interface ResolutionSnapshot {
  resolve(pane: { paneId: string; ptyPid?: number; cwd?: string }): Promise<SessionLookup>;
}

/** A pane's activity together with the rule that produced it. */
export interface PaneActivityReading {
  activity: PaneActivity;
  rule: ActivityRule;
}

export interface PresenceProjectorDeps {
  /** The evidence store's pane set — the pane LIFETIME, not the session map's. */
  panes(): readonly Pane[];
  /** The rule travels with the activity; `activitySource` is derived from it. */
  activityFor(paneId: string, now?: number): PaneActivityReading | undefined;
  openSnapshot(): Promise<ResolutionSnapshot>;
  /** Fold a pane cwd into the same form `WorktreeInfo.id` is in. */
  normalize(p: string): string;
  now?(): number;
}

export interface PresenceProjector {
  project(worktreeIds: readonly string[]): Promise<WorktreePresence>;
  /** Newest `lastActivityAt` under this worktree; absent before any projection. */
  rank(worktreeId: string): number | undefined;
}

/** A proven identity, kept so a failed re-read cannot demote the row (D10). */
interface ProvenIdentity {
  agent: VaultAgentId;
  source: WorktreeAgentRow["agentSource"];
  entryId?: string;
}

/**
 * Everything one pane carries between rebuilds — the resolution slot and the
 * row's timestamps, in a single entry evicted against the live pane set.
 *
 * Keying the slot by the `{ptyPid, cwd}` triple instead would leak an entry per
 * directory a pane ever visited, and per-pane eviction would never reach the
 * old ones (D8).
 */
interface PaneState {
  /** The pane facts `proven` was read at. A move here forces a re-read. */
  provenPtyPid?: number;
  provenCwd?: string;
  proven?: ProvenIdentity;
  /** Identity this row's timestamps describe; a change starts a new epoch (D11). */
  identity?: ProvenIdentity;
  /** Set once the row has been stamped, so `identity: undefined` is not "unseen". */
  seen?: boolean;
  startedAt?: number;
  activity?: PaneActivity;
  stateStartedAt?: number;
  finishedAt?: number;
  lastActivityAt?: number;
}

/** The webview re-renders on any change to this field, so it moves once a second (D11). */
function quantizeToSecond(at: number): number {
  return Math.floor(at / 1000) * 1000;
}

/**
 * The worktree containing `cwd`, longest root first.
 *
 * Longest-match mirrors `matchRepository` (repoRoots.ts): a worktree nested
 * inside another repository's tree is inside both, and the pane belongs to the
 * innermost one. `isPathInside` owns the comparison — a hand-rolled
 * `startsWith(id + sep)` gets filesystem roots, Windows separator drift and
 * drive-letter casing wrong (D13).
 */
function attribute(cwd: string, worktreeIds: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const id of worktreeIds) {
    if (isPathInside(cwd, id) && (best === undefined || id.length > best.length)) {
      best = id;
    }
  }
  return best;
}

/**
 * Does this row now describe a different agent?
 *
 * A source upgrade is not a new epoch — a title proving what the launch record
 * already claimed is the same agent — and neither is a session id becoming
 * known, or ceasing to be. Only a different agent, or a different session in
 * the same pane, hands the row over (D11).
 */
function startsNewEpoch(previous: ProvenIdentity | undefined, next: ProvenIdentity | undefined): boolean {
  if (previous?.agent !== next?.agent) {
    return true;
  }
  if (previous?.entryId !== undefined && next?.entryId !== undefined) {
    return previous.entryId !== next.entryId;
  }
  return false;
}

/**
 * The window's panes, as agent rows.
 *
 * `deps.now` is the single clock: activity, timestamps and degradation epochs
 * all read it, so a test that freezes it freezes the whole projection.
 */
export function createPresenceProjector(deps: PresenceProjectorDeps): PresenceProjector {
  const states = new Map<string, PaneState>();
  const failingSince = new Map<PresenceDegradation["source"], number>();
  const ranks = new Map<string, number>();

  function clock(): number {
    return deps.now?.() ?? Date.now();
  }

  /**
   * This pane's identity, reusing a proven read while the pane's process and
   * directory both hold.
   *
   * Negatives are deliberately NOT cached. A shell pane resolves to "no
   * session", the user starts an agent in it without the pty pid or the cwd
   * moving, and a cached negative would never be retried for the life of that
   * pane — a correctness bug, not a cost one. Retrying is affordable because
   * D9 already made the shared work per-rebuild (D8).
   */
  async function identify(
    pane: Pane,
    state: PaneState,
    snapshot: ResolutionSnapshot,
    failures: Map<PresenceDegradation["source"], string>,
  ): Promise<ProvenIdentity | undefined> {
    if (state.proven && state.provenPtyPid === pane.ptyPid && state.provenCwd === pane.cwd) {
      return state.proven;
    }

    const lookup = await snapshot.resolve({ paneId: pane.paneId, ptyPid: pane.ptyPid, cwd: pane.cwd });
    const outcome = resolveAgentIdentity({
      isAgentLaunch: pane.isAgentLaunch,
      shell: pane.shell,
      title: pane.title,
      session: lookup,
    });

    if (outcome.kind === "proven") {
      state.proven = { agent: outcome.agent, source: outcome.source, entryId: outcome.entryId };
      state.provenPtyPid = pane.ptyPid;
      state.provenCwd = pane.cwd;
      return state.proven;
    }

    if (outcome.kind === "failed") {
      // The read did not conclude, so it says nothing about this pane. The
      // proven tuple is left where it was, which is what makes the next
      // rebuild retry rather than reuse (D10).
      if (!failures.has(outcome.source)) {
        failures.set(outcome.source, outcome.reason);
      }
      return state.proven;
    }

    // Conclusively nothing: the agent really did exit, so the row clears.
    state.proven = undefined;
    state.provenPtyPid = pane.ptyPid;
    state.provenCwd = pane.cwd;
    return undefined;
  }

  /**
   * Which evidence produced this activity.
   *
   * Read from the rule the projection reports, not inferred from the state it
   * landed in: `idle` is reached three different ways, and crediting every idle
   * pane that happens to carry a shell title to its title names a cause that
   * was not one (.reviews/round-1.md W2).
   *
   * Everything else a window pane reports is output-derived — the blueprint's
   * § 3.3 vocabulary — with the shell-title rule as D6's single exception.
   */
  function activitySourceFor(rule: ActivityRule): WorktreeAgentRow["activitySource"] {
    return rule === "shell-title" ? "title" : "output";
  }

  function stamp(
    state: PaneState,
    identity: ProvenIdentity | undefined,
    activity: PaneActivity,
    pane: Pane,
    now: number,
  ): void {
    if (state.seen && startsNewEpoch(state.identity, identity)) {
      // A pane outlives the agents inside it. Without this reset a fresh agent
      // inherits the age and finish time of the one that ran here an hour ago.
      state.startedAt = now;
      state.activity = undefined;
      state.stateStartedAt = undefined;
      state.finishedAt = undefined;
    }
    state.identity = identity;
    state.seen = true;
    state.startedAt ??= now;

    if (state.activity !== activity) {
      const settled = activity === "idle" && (state.activity === "running" || state.activity === "waiting");
      state.finishedAt = settled ? now : undefined;
      state.activity = activity;
      state.stateStartedAt = now;
    }

    const evidenceAt = Math.max(pane.lastOutputAt ?? 0, state.stateStartedAt ?? now);
    state.lastActivityAt = Math.max(state.lastActivityAt ?? 0, quantizeToSecond(evidenceAt));
  }

  return {
    async project(worktreeIds) {
      const now = clock();
      const snapshot = await deps.openSnapshot();
      const panes = deps.panes();

      const live = new Set(panes.map((pane) => pane.paneId));
      for (const paneId of states.keys()) {
        if (!live.has(paneId)) {
          states.delete(paneId);
        }
      }

      const failures = new Map<PresenceDegradation["source"], string>();
      const rowsByWorktreeId: Record<string, WorktreeAgentRow[]> = {};
      const nextRanks = new Map<string, number>();

      for (const pane of panes) {
        // A pane whose directory is unknown cannot be attributed to anything;
        // guessing a worktree for it would put a row under a tree the pane may
        // not be in at all.
        if (pane.cwd === undefined) {
          continue;
        }
        const worktreeId = attribute(deps.normalize(pane.cwd), worktreeIds);
        if (worktreeId === undefined) {
          continue;
        }

        let state = states.get(pane.paneId);
        if (!state) {
          state = {};
          states.set(pane.paneId, state);
        }

        const identity = await identify(pane, state, snapshot, failures);
        const reading = deps.activityFor(pane.paneId, now) ?? { activity: "idle" as const, rule: "quiet" as const };
        const activity = reading.activity;
        stamp(state, identity, activity, pane, now);

        const row: WorktreeAgentRow = {
          rowId: `window:${pane.paneId}`,
          scope: "window",
          paneId: pane.paneId,
          viewId: pane.viewId,
          title: pane.title,
          agent: identity?.agent,
          agentSource: identity?.source ?? "none",
          activity,
          activitySource: activitySourceFor(reading.rule),
          entryId: identity?.entryId,
          startedAt: state.startedAt,
          stateStartedAt: state.stateStartedAt,
          finishedAt: state.finishedAt,
          lastActivityAt: state.lastActivityAt,
        };

        (rowsByWorktreeId[worktreeId] ??= []).push(row);
        const at = state.lastActivityAt;
        if (at !== undefined) {
          nextRanks.set(worktreeId, Math.max(nextRanks.get(worktreeId) ?? 0, at));
        }
      }

      // A source that answered this rebuild clears its entry; one still failing
      // keeps the epoch of the FIRST failure in the run, so the affordance can
      // say how long it has been out rather than restating "just now".
      for (const source of failingSince.keys()) {
        if (!failures.has(source)) {
          failingSince.delete(source);
        }
      }
      const degradedSources: PresenceDegradation[] = [];
      for (const [source, reason] of failures) {
        const since = failingSince.get(source) ?? now;
        failingSince.set(source, since);
        degradedSources.push({ source, reason, since });
      }

      ranks.clear();
      for (const [worktreeId, at] of nextRanks) {
        ranks.set(worktreeId, at);
      }

      return { rowsByWorktreeId, scannedAt: now, degradedSources };
    },

    rank(worktreeId) {
      return ranks.get(worktreeId);
    },
  };
}
