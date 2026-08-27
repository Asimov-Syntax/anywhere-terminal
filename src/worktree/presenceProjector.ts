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
import { type ClaudeSessionEvidence, EVIDENCE_RANK } from "../session/resolveClaudeSession";
import type { ActivityRule, PaneActivity } from "../shared/paneEvidence";
import { isPathInside } from "../utils/pathBoundary";
import type { RunningClaudeSession, RunningSessionsOutcome } from "../vault/readers/runningSessions";
import { formatEntryId, type VaultAgentId } from "../vault/types";
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
  /**
   * This rebuild's registry read, outcome intact and headless already dropped.
   *
   * The external pass consumes the same read pane resolution took, so external
   * rows cost no additional scan (design.md D2).
   */
  sessions(): Promise<RunningSessionsOutcome>;
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
  /**
   * What the vault calls a resolved session — the PREFERRED title.
   *
   * Claude's own display precedence (`claudeReader.ts`): the name the user gave
   * the session, then the title Claude generated for it, then its last prompt.
   * The pid registry's `name` loses to all three because it is usually
   * `nameSource: "derived"` — a slug off the directory, identical for every
   * session in one repo.
   *
   * Separate from `openSnapshot` because it is not a per-rebuild read: it opens a
   * transcript, so it is cached per session and re-read no more often than
   * `TITLE_REFRESH_MS`. Optional, so the projector's own tests need no vault.
   */
  sessionTitle?(entryId: string): Promise<string | undefined>;
  /**
   * The newest vault session this agent recorded under `cwd`, as an entry id.
   *
   * Only claude publishes a pid registry, so rank 2 answers claude alone and
   * every other agent's pane reaches the row with no session to be named by.
   * This is the fallback for exactly those panes — asked ONLY once the launch
   * record has already proved which agent is running, so unlike a bare
   * newest-transcript-here lookup it cannot paint a plain shell as the agent
   * that used to occupy the directory (presenceDeps.ts).
   *
   * The answer is a guess of the same strength as a shared-directory match, and
   * is settled the same way when two panes want one session.
   */
  sessionUnderCwd?(agent: VaultAgentId, cwd: string): Promise<string | undefined>;
  /**
   * The entry id the agent in this pane reported for itself, if any.
   *
   * Synchronous because it is a read of what already arrived — a report is
   * pushed by the agent, never fetched, so a rebuild never waits on one.
   */
  reportedSession?(paneId: string, agent: VaultAgentId): string | undefined;
  now?(): number;
}

/** How much of the projection to run. */
export interface ProjectOptions {
  /**
   * Skip the pane pass and replay what the last full pass produced, running only
   * the registry read and the external pass.
   *
   * This is what the 5-second poll uses. A full pass re-resolves every pane with
   * no proven identity — negatives are deliberately not cached — so polling one
   * would shell out to `ps` every five seconds for the life of the window (D6).
   */
  external?: boolean;
}

export interface PresenceProjector {
  project(worktreeIds: readonly string[], options?: ProjectOptions): Promise<WorktreePresence>;
  /** Newest `lastActivityAt` under this worktree; absent before any projection. */
  rank(worktreeId: string): number | undefined;
  /**
   * A monotonic count of how many times the ranking published through `rank`
   * has changed.
   *
   * The 5-second poll makes re-sorting every group a standing cost, and the
   * poll that changes nothing is the common case. The projector already builds
   * the new ranking beside the retained one, so it can price this for free
   * where the caller could only guess (.reviews/round-2.md W2).
   *
   * A revision rather than a "did it move" flag, because the consumer is not
   * the only thing that consumes projections: a pass the host DISCARDS still
   * advances the projector, and a flag read after the identical rerun would say
   * the ranking never moved while the cache still holds the older order
   * (.reviews/round-3.md B3, design.md D12).
   */
  rankRevision(): number;
}

/** A proven identity, kept so a failed re-read cannot demote the row (D10). */
interface ProvenIdentity {
  agent: VaultAgentId;
  source: WorktreeAgentRow["agentSource"];
  entryId?: string;
  /** The session's own published name, when the registry carried one. */
  name?: string;
  /** How the session was matched to the pane; absent when none was. */
  evidence?: ClaudeSessionEvidence;
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

/**
 * The only agent the PID registry describes. Presence never invents an agent id,
 * and no other CLI publishes a registry to read.
 */
const REGISTRY_AGENT: VaultAgentId = "claude";

/** One pane's row, with the evidence its session claim rests on. */
interface ProducedRow {
  worktreeId: string;
  row: WorktreeAgentRow;
  evidence?: ClaudeSessionEvidence;
  /** What the pane itself reported, so a disowned row falls back to it rather than to nothing. */
  paneTitle?: string;
}

/**
 * Give a contested session to the one pane that PROVED it, and to no one
 * otherwise.
 *
 * Resolution matches a session to a pane by finding the claude pid inside the
 * pane's pty subtree, and failing that by matching the pane's directory. The
 * directory match is one every pane in that directory makes, so two panes in one
 * repo came away wearing the same session — the same title, the same drill-down
 * and the same delegation list, which is what the report showed.
 *
 * So the claim that wins is the one whose evidence ranks strictly highest, and a
 * tie at the top settles nothing: two panes reported the same session, or two
 * subtree matches disagree about one pid (nested panes), or nothing here is more
 * than a guess — either way the session belongs to no row rather than to an
 * arbitrary one. Presence never invents.
 *
 * A row that loses the session keeps everything the pane itself proved. Only the
 * identity that WAS the session — `agentSource: "registry"` — goes with it,
 * because without the session there is nothing left holding it up.
 */
/** A row that reached its session without saying how ranks below every stated kind. */
function rankOf(evidence: ClaudeSessionEvidence | undefined): number {
  return evidence === undefined ? -1 : EVIDENCE_RANK[evidence];
}

function settleContestedSessions(produced: readonly ProducedRow[]): readonly ProducedRow[] {
  const byEntryId = new Map<string, ProducedRow[]>();
  for (const item of produced) {
    if (item.row.entryId !== undefined) {
      const sharing = byEntryId.get(item.row.entryId);
      if (sharing) {
        sharing.push(item);
      } else {
        byEntryId.set(item.row.entryId, [item]);
      }
    }
  }

  const disowned = new Set<WorktreeAgentRow>();
  for (const sharing of byEntryId.values()) {
    if (sharing.length < 2) {
      continue;
    }
    const best = Math.max(...sharing.map((item) => rankOf(item.evidence)));
    const strongest = sharing.filter((item) => rankOf(item.evidence) === best);
    for (const item of sharing) {
      if (strongest.length !== 1 || item !== strongest[0]) {
        disowned.add(item.row);
      }
    }
  }

  if (disowned.size === 0) {
    return produced;
  }
  return produced.map((item) => {
    if (!disowned.has(item.row)) {
      return item;
    }
    const { entryId: _entryId, title: _title, ...rest } = item.row;
    const fromSessionAlone = item.row.agentSource === "registry";
    return {
      worktreeId: item.worktreeId,
      row: {
        ...rest,
        ...(item.paneTitle !== undefined ? { title: item.paneTitle } : {}),
        ...(fromSessionAlone ? { agentSource: "none" as const, agent: undefined } : {}),
      },
    };
  });
}

/**
 * How long a vault-read title is trusted before it is read again.
 *
 * Longer than the 5-second poll by two orders of magnitude, because the read
 * opens a transcript; short enough that a rename, or the title Claude generates
 * a few turns in, reaches the row while the user is still looking at it.
 */
const TITLE_REFRESH_MS = 60_000;

/** The one owner of an external row's identity: row creation and eviction share it. */
function externalRowId(sessionId: string): string {
  return `external:${REGISTRY_AGENT}:${sessionId}`;
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
  /** Bumped whenever the ranking `ranks` holds differs from the one it replaced. */
  let rankRevision = 0;
  /**
   * When each external row was first seen, for a session whose registry file
   * carries no launch time. Evicted against the sessions of a SUCCESSFUL read
   * only — a failed read's empty set would clear exactly the state the
   * retention rule exists to keep (D4).
   */
  const externalSeen = new Map<string, number>();
  /**
   * The last registry read that concluded, replaced on each success — never
   * accumulated.
   *
   * The INPUTS are retained, not the rows. The worktree set moves independently
   * of the registry, and cached rows would keep naming a worktree the tree no
   * longer holds — the one thing the envelope contract forbids. Replaying the
   * list re-attributes it against the tree the projection is published with (D4).
   */
  let lastSessions: readonly RunningClaudeSession[] = [];
  /**
   * What the last full pass concluded about this window's own panes, kept so an
   * external-only pass can publish a whole envelope without re-running it.
   *
   * `worktreeIds` is part of it: a replay attributed against a different tree
   * could name a worktree the tree no longer holds, so a moved set falls back to
   * a full pass rather than replaying into it.
   */
  let lastWindowPass:
    | {
        worktreeIds: readonly string[];
        rows: ReadonlyArray<{ worktreeId: string; row: WorktreeAgentRow }>;
        ranks: ReadonlyMap<string, number>;
        failures: ReadonlyMap<PresenceDegradation["source"], string>;
        claimed: ReadonlySet<string>;
      }
    | undefined;

  /** One vault title read per session, per `TITLE_REFRESH_MS`. */
  const vaultTitles = new Map<string, { at: number; title: Promise<string | undefined> }>();

  function clock(): number {
    return deps.now?.() ?? Date.now();
  }

  /**
   * This session's vault title, re-read only once the cached one has aged out.
   *
   * A title is not static — Claude generates one a few turns in, and the user can
   * rename a session at any point — so a read cached for the life of the window
   * would pin a row to whatever it was called first. Re-reading every pass is the
   * other extreme: this opens a transcript, and the poll runs every five seconds.
   *
   * A read that fails or answers nothing keeps the previous answer rather than
   * dropping the row back to its fallback: an unreadable transcript is not a
   * session that lost its name.
   */
  function vaultTitle(entryId: string, read: (id: string) => Promise<string | undefined>, now: number) {
    const cached = vaultTitles.get(entryId);
    if (cached && now - cached.at < TITLE_REFRESH_MS) {
      return cached.title;
    }
    const previous = cached?.title;
    const title = read(entryId)
      .catch(() => undefined)
      .then(async (next) => next ?? (previous === undefined ? undefined : await previous));
    vaultTitles.set(entryId, { at: now, title });
    return title;
  }

  /**
   * Retitle every row whose session the vault can name.
   *
   * Rows are REPLACED rather than written through: a replayed window row is the
   * retained pass's own object, and titling it in place would edit what the next
   * replay hands back.
   */
  async function titleFromVault(rowsByWorktreeId: Record<string, WorktreeAgentRow[]>, now: number): Promise<void> {
    const read = deps.sessionTitle;
    if (!read) {
      return;
    }
    const alive = new Set<string>();
    for (const rows of Object.values(rowsByWorktreeId)) {
      for (const row of rows) {
        if (row.entryId !== undefined) {
          alive.add(row.entryId);
        }
      }
    }
    for (const entryId of vaultTitles.keys()) {
      if (!alive.has(entryId)) {
        vaultTitles.delete(entryId);
      }
    }
    for (const [worktreeId, rows] of Object.entries(rowsByWorktreeId)) {
      rowsByWorktreeId[worktreeId] = await Promise.all(
        rows.map(async (row) => {
          const entryId = row.entryId;
          if (entryId === undefined) {
            return row;
          }
          const title = await vaultTitle(entryId, read, now);
          return title === undefined ? row : { ...row, title };
        }),
      );
    }
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
      // The one thing the cache key cannot see. An agent has to start before it
      // can report, so the report always lands on an already-proven pane, and
      // neither the pty nor the directory moves when it does — cached on those
      // two alone, the row would keep the guess for the life of the pane
      // (.reviews/round-1.md B1).
      const reported = deps.reportedSession?.(pane.paneId, state.proven.agent);
      if (reported === undefined || reported === state.proven.entryId) {
        return state.proven;
      }
      state.proven = { ...state.proven, entryId: reported, evidence: "reported" };
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
      // A proven agent with no session is every non-claude pane: no registry
      // names it, so the vault's own record under this directory is the only
      // handle there is.
      // Unless the agent itself said which session it is on. A report names one
      // terminal, so it settles what the directory could only guess at.
      const reported = deps.reportedSession?.(pane.paneId, outcome.agent);
      const guessed =
        reported !== undefined || outcome.entryId !== undefined || pane.cwd === undefined
          ? undefined
          : await deps.sessionUnderCwd?.(outcome.agent, deps.normalize(pane.cwd));
      const entryId = reported ?? outcome.entryId ?? guessed;
      state.proven = {
        agent: outcome.agent,
        source: outcome.source,
        entryId,
        name: outcome.name,
        evidence: reported !== undefined ? "reported" : guessed !== undefined ? "directory" : outcome.evidence,
      };
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

  /**
   * The live registry sessions this window does not already account for, as
   * rows under the worktree holding each session's directory.
   *
   * Sorted by `rowId` before they are grouped: the reader's own order follows
   * `readdir` and `Map` insertion, and the render signature is row-order
   * sensitive, so an unsorted append re-renders on a poll that found nothing
   * new (D5).
   */
  function externalRows(
    sessions: readonly RunningClaudeSession[],
    worktreeIds: readonly string[],
    claimed: ReadonlySet<string>,
    now: number,
  ): Array<{ worktreeId: string; row: WorktreeAgentRow }> {
    const out: Array<{ worktreeId: string; row: WorktreeAgentRow }> = [];
    for (const session of sessions) {
      const entryId = formatEntryId(REGISTRY_AGENT, session.sessionId);
      // A session a pane already proved is that pane's row, never a second one
      // telling the user it is running somewhere else.
      if (claimed.has(entryId)) {
        continue;
      }
      const worktreeId = attribute(deps.normalize(session.cwd), worktreeIds);
      if (worktreeId === undefined) {
        continue;
      }
      const rowId = externalRowId(session.sessionId);
      // The scan time is never the answer: it would move the ordering key every
      // poll and claim activity the registry never gave. A registry file with
      // no launch time gets the moment this projection first saw it instead.
      const startedAt = session.startedAt ?? externalSeen.get(rowId) ?? now;
      externalSeen.set(rowId, startedAt);
      out.push({
        worktreeId,
        row: {
          rowId,
          scope: "external",
          // Last resort, overridden by the vault pass. An external row has no
          // pane and therefore not even a terminal title to fall back to.
          ...(session.name !== undefined ? { title: session.name } : {}),
          agent: REGISTRY_AGENT,
          agentSource: "registry",
          activity: "running",
          activitySource: "registry",
          entryId,
          pid: session.pid,
          startedAt,
          stateStartedAt: startedAt,
          lastActivityAt: startedAt,
        },
      });
    }
    out.sort((a, b) => (a.row.rowId < b.row.rowId ? -1 : a.row.rowId > b.row.rowId ? 1 : 0));
    return out;
  }

  /**
   * This window's panes, as rows — and the sessions they claim.
   *
   * Lifted out of `project` so an external-only pass can skip it whole rather
   * than run it and throw the result away (D6). The returned set is every
   * session this window proved, whatever became of the pane's row.
   */
  async function projectPanes(
    worktreeIds: readonly string[],
    snapshot: ResolutionSnapshot,
    now: number,
    failures: Map<PresenceDegradation["source"], string>,
    rowsByWorktreeId: Record<string, WorktreeAgentRow[]>,
    nextRanks: Map<string, number>,
  ): Promise<ReadonlySet<string>> {
    const panes = deps.panes();

    const live = new Set(panes.map((pane) => pane.paneId));
    for (const paneId of states.keys()) {
      if (!live.has(paneId)) {
        states.delete(paneId);
      }
    }

    // The external pass drops these: a session claimed by a pane is that pane's
    // row, never a second one labelled "other window" (D3).
    //
    // Filled from what each pane MATCHED, not from what its row ends up wearing.
    // A session two panes both guessed at is shown by neither, but it is still
    // running in this window, and an "other window" row for it would be a lie.
    const claimed = new Set<string>();

    const produced: ProducedRow[] = [];

    for (const pane of panes) {
      let state = states.get(pane.paneId);
      if (!state) {
        state = {};
        states.set(pane.paneId, state);
      }

      // Resolved BEFORE attribution decides anything. A pane whose directory
      // is unknown, or which no worktree contains, produces no row — but it is
      // still a pane in this window, and the session it holds must not be free
      // for the external pass to claim.
      const identity = await identify(pane, state, snapshot, failures);
      if (identity?.entryId !== undefined) {
        claimed.add(identity.entryId);
      }

      // Guessing a worktree for an unknown directory would put a row under a
      // tree the pane may not be in at all.
      const worktreeId = pane.cwd === undefined ? undefined : attribute(deps.normalize(pane.cwd), worktreeIds);
      if (worktreeId === undefined) {
        continue;
      }

      const reading = deps.activityFor(pane.paneId, now) ?? { activity: "idle" as const, rule: "quiet" as const };
      const activity = reading.activity;
      stamp(state, identity, activity, pane, now);

      const row: WorktreeAgentRow = {
        rowId: `window:${pane.paneId}`,
        scope: "window",
        paneId: pane.paneId,
        viewId: pane.viewId,
        // Both are fallbacks the vault pass overrides. The registry name leads
        // only because claude sets no OSC title at all, so a pane title here is
        // whatever the shell left behind.
        title: identity?.name ?? pane.title,
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

      produced.push({ worktreeId, row, evidence: identity?.evidence, paneTitle: pane.title });
      const at = state.lastActivityAt;
      if (at !== undefined) {
        nextRanks.set(worktreeId, Math.max(nextRanks.get(worktreeId) ?? 0, at));
      }
    }

    for (const { worktreeId, row } of settleContestedSessions(produced)) {
      (rowsByWorktreeId[worktreeId] ??= []).push(row);
    }

    lastWindowPass = {
      worktreeIds: [...worktreeIds],
      rows: Object.entries(rowsByWorktreeId).flatMap(([worktreeId, rows]) => rows.map((row) => ({ worktreeId, row }))),
      ranks: new Map(nextRanks),
      failures: new Map(failures),
      claimed,
    };
    return claimed;
  }

  /** Same worktree ids, same order — the tree the replay was attributed against. */
  /**
   * Does the replay describe the same worktrees — in any order?
   *
   * Membership, never position. The host supplies these in CACHE order, and D12's
   * reorder changes that order without changing membership, so a positional
   * comparison would make the first poll after every ranking change reject its
   * own replay and resolve panes (.reviews/round-4.md W3).
   */
  function sameTree(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) {
      return false;
    }
    const held = new Set(a);
    return b.every((id) => held.has(id));
  }

  return {
    async project(worktreeIds, options) {
      const now = clock();
      const snapshot = await deps.openSnapshot();

      const failures = new Map<PresenceDegradation["source"], string>();
      const rowsByWorktreeId: Record<string, WorktreeAgentRow[]> = {};
      const nextRanks = new Map<string, number>();
      let claimed: ReadonlySet<string>;

      const replay =
        options?.external === true && lastWindowPass !== undefined && sameTree(lastWindowPass.worktreeIds, worktreeIds)
          ? lastWindowPass
          : undefined;

      if (replay) {
        for (const { worktreeId, row } of replay.rows) {
          (rowsByWorktreeId[worktreeId] ??= []).push(row);
        }
        for (const [worktreeId, at] of replay.ranks) {
          nextRanks.set(worktreeId, at);
        }
        // A source this pass never re-checked has not healed. Dropping it here
        // would report the process table healthy on the strength of not looking.
        //
        // The registry is the one exception, and it is not an exception at all:
        // this pass DOES re-read it, so its own outcome owns that entry. Copying
        // the replayed one forward would leave the registry marked degraded for
        // the life of the window after it recovered (.reviews/round-1.md B2).
        for (const [source, reason] of replay.failures) {
          if (source !== "registry") {
            failures.set(source, reason);
          }
        }
        claimed = replay.claimed;
      } else {
        claimed = await projectPanes(worktreeIds, snapshot, now, failures, rowsByWorktreeId, nextRanks);
      }

      const read = await snapshot.sessions();
      if (read.kind === "failed") {
        // Retention, not staleness by accident: the rows stay and the source is
        // named, so the user sees what was last true AND that it is not fresh.
        if (!failures.has("registry")) {
          failures.set("registry", read.reason);
        }
      }
      const sessions = read.kind === "ok" ? read.sessions : lastSessions;
      if (read.kind === "ok") {
        lastSessions = read.sessions;
        // Eviction rides a successful read, and only a successful read: it is
        // the one answer that proves a session is gone rather than unknown.
        const alive = new Set(sessions.map((s) => externalRowId(s.sessionId)));
        for (const rowId of externalSeen.keys()) {
          if (!alive.has(rowId)) {
            externalSeen.delete(rowId);
          }
        }
      }
      for (const { worktreeId, row } of externalRows(sessions, worktreeIds, claimed, now)) {
        (rowsByWorktreeId[worktreeId] ??= []).push(row);
        const at = row.lastActivityAt;
        if (at !== undefined) {
          nextRanks.set(worktreeId, Math.max(nextRanks.get(worktreeId) ?? 0, at));
        }
      }

      await titleFromVault(rowsByWorktreeId, now);

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

      if (!sameRanking(ranks, nextRanks)) {
        rankRevision += 1;
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

    rankRevision() {
      return rankRevision;
    },
  };
}

/** Do two rankings order every worktree the same way, by the same timestamps? */
function sameRanking(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [worktreeId, at] of a) {
    if (b.get(worktreeId) !== at) {
      return false;
    }
  }
  return true;
}
