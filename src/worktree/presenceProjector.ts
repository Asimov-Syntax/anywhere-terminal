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

import path from "node:path";
import type { AgentTurnReport, AgentTurnSubagent } from "../agentHooks/AgentHookRuntime";
import { type PaneEvidence, TURN_FRESHNESS_MS } from "../session/PaneEvidenceStore";
import { type ClaudeSessionEvidence, EVIDENCE_RANK } from "../session/resolveClaudeSession";
import type { ActivityRule, PaneActivity } from "../shared/paneEvidence";
import { isPathInside, normalizePathForCompare } from "../utils/pathBoundary";
import type { RunningClaudeSession, RunningSessionsOutcome } from "../vault/readers/runningSessions";
import { formatEntryId, type VaultAgentId } from "../vault/types";
import { resolveAgentIdentity, type SessionLookup } from "./agentIdentity";
import type {
  DelegationRoster,
  PresenceDegradation,
  WorktreeAgentRow,
  WorktreePresence,
  WorktreeSubagentRow,
} from "./presenceTypes";

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
  /** Newest vault entry for a proven agent under this cwd, once per rebuild. */
  sessionUnderCwd?(agent: VaultAgentId, cwd: string): Promise<string | undefined>;
}

/**
 * Do two paths name the same transcript?
 *
 * Resolved before comparison so a report is not rejected over a `.` segment or
 * a separator, and case-folded only where the filesystem folds case.
 */
function sameTranscript(reported: string, stored: string): boolean {
  return normalizePathForCompare(path.resolve(reported)) === normalizePathForCompare(path.resolve(stored));
}

/** A pane's activity together with the rule that produced it. */
export interface PaneActivityReading {
  activity: PaneActivity;
  rule: ActivityRule;
}

/**
 * A turn describes a conversation and activity describes a terminal, so every
 * turn state needs an explicit landing place (§ 4.5). `exited` is not among
 * them: a finished turn does not close a pane.
 */
/**
 * Exported so I13's two halves can be checked against ONE universe (round-1 B3): the
 * reducer test asserted the three state names as a literal and this table listed the same
 * three, so a mapped-but-unreachable state updated neither.
 */
export const TURN_ACTIVITY: Readonly<Record<AgentTurnReport["state"], PaneActivity>> = Object.freeze({
  working: "running",
  waiting: "waiting",
  done: "idle",
  // Frozen and readonly (round-2 W3): exporting it for I13's universe must not hand an
  // importer a way to rewrite the mapping production projection reads.
});

/** What the row shows and which evidence chose it. */
interface Reported {
  activitySource: WorktreeAgentRow["activitySource"];
  interactivePrompt?: string;
  delegations?: DelegationRoster;
  /**
   * This activity came from a session starting rather than a turn ending, so
   * the `idle` it lands on completed nothing (§ 4.5).
   */
  sessionBoundary?: true;
}

/** A reported child's own state, in the vocabulary a delegation row speaks. */
const SUBAGENT_STATUS: Record<AgentTurnSubagent["state"], WorktreeSubagentRow["status"]> = {
  working: "running",
  done: "completed",
  idle: "unknown",
};

/**
 * A fresh report's roster as delegation rows.
 *
 * An empty roster is reported as an empty roster rather than as absence. They
 * are not the same claim: absence lets the host fall back to the transcript's
 * history, so a live agent saying "nothing is delegated right now" would put
 * last hour's delegations back on the row (.reviews/round-1.md W1).
 */
function reportedDelegations(report: AgentTurnReport): DelegationRoster {
  return {
    kind: "ok",
    reported: true,
    rows: report.subagents.map((child) => ({
      name: child.name ?? "subagent",
      status: SUBAGENT_STATUS[child.state],
      live: true,
    })),
  };
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
   * The vault's name for a resolved session — the FALLBACK title, consulted only
   * for a row the registry did not name.
   *
   * Separate from `openSnapshot` because it is not a per-rebuild read: it opens a
   * transcript, so it is memoized per session for the life of the window and a
   * pass that resolves nothing new costs nothing. Optional, so the projector's
   * own tests need no vault.
   */
  sessionTitle?(entryId: string): Promise<string | undefined>;
  /**
   * That session's last activity, for the row's second line. Same optional shape
   * as `sessionTitle` and for the same reason — it opens a transcript.
   *
   * The projector holds NO stamp and NO cache for this: freshness, rate and
   * eviction belong to the service behind the call, which is the only thing that
   * can see the file (source-the-agent-row-preview D2). Absence is not
   * degradation — a row with no answer simply carries no preview (D3).
   */
  sessionPreview?(entryId: string): Promise<string | undefined>;
  /**
   * Point-resolve a session id an agent reported, against the store that
   * already holds it (§ 4.6).
   *
   * Takes an id and nothing else, deliberately. A reported value must never be
   * able to steer a read, so the reported transcript path is not an argument
   * here — the entry's own recorded path comes back instead, and comparing the
   * two is all the reported one is ever used for. Resolving to `null` is
   * conclusive: nothing is created for a session the store does not know.
   */
  resolveReportedSession?(sessionId: string): Promise<ReportedSessionEntry | null>;
  /** A standing terminal-bound identity report, such as OpenCode's. */
  reportedSession?(paneId: string): { agent: VaultAgentId; entryId: string } | undefined;
  now?(): number;
}

/**
 * A reported session that turned out to exist, and where the store keeps it.
 *
 * The agent comes from the store rather than from the report: which agent owns
 * a session is a fact about the entry, not a claim the reporter gets to make.
 */
export interface ReportedSessionEntry {
  entryId: string;
  agent: VaultAgentId;
  transcriptPath: string;
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
  /** Strength of the session-to-pane match, used only to settle contention. */
  evidence?: ClaudeSessionEvidence;
  /** Standing reports disappear on revoke; turn reports retain validated identity. */
  reportLifetime?: "standing" | "retained";
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

interface ProducedRow {
  worktreeId: string;
  row: WorktreeAgentRow;
  evidence?: ClaudeSessionEvidence;
  paneTitle?: string;
}

function rankOf(evidence: ClaudeSessionEvidence | undefined): number {
  return evidence === undefined ? -1 : EVIDENCE_RANK[evidence];
}

/** Give a contested session to one strictly strongest claimant, never a tie. */
function settleContestedSessions(produced: readonly ProducedRow[]): readonly ProducedRow[] {
  const byEntryId = new Map<string, ProducedRow[]>();
  for (const item of produced) {
    const entryId = item.row.entryId;
    if (entryId !== undefined) {
      const sharing = byEntryId.get(entryId);
      if (sharing) {
        sharing.push(item);
      } else {
        byEntryId.set(entryId, [item]);
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
    const { entryId: _entryId, ...rest } = item.row;
    const sessionWasIdentity = item.row.agentSource === "registry";
    // The pane's own title outranks the session it just lost, but a shell pane has none — and
    // blanking the row there is what rendered `(untitled)` for a session already resolved.
    // Set only where the pane does NOT name itself: `titleSourceId` is the row's provenance, so a
    // pane-owned title carries none and is never second-guessed. Asking merely whether a title
    // exists conflates a reported-empty title with a registry slug, and froze both (round-1 B1).
    const paneTitle = item.paneTitle?.trim();
    return {
      worktreeId: item.worktreeId,
      row: {
        ...rest,
        ...(paneTitle ? { title: paneTitle } : {}),
        ...(paneTitle || item.row.entryId === undefined ? {} : { titleSourceId: item.row.entryId }),
        ...(sessionWasIdentity ? { agentSource: "none" as const, agent: undefined } : {}),
      },
    };
  });
}

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
    // A first report correcting a directory guess describes the same pane
    // epoch. Two reports naming different sessions are a genuine handover.
    if (next.evidence === "reported" && previous.evidence !== "reported") {
      return false;
    }
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

  /** One vault title read per session, per refresh window. */
  const vaultTitles = new Map<string, { at: number; title: Promise<string | undefined> }>();

  function clock(): number {
    return deps.now?.() ?? Date.now();
  }

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
   * The row's second line: what its session last did. Mirrors the pass above in
   * shape only — this one owns nothing, asking once per resolved row and writing
   * back whatever comes.
   *
   * A row with no answer gets no `preview` key rather than an empty string: the
   * layout draws no second line only when nothing is there, and a placeholder is
   * exactly what a row that cannot prove something must not show.
   */
  async function previewFromVault(rowsByWorktreeId: Record<string, WorktreeAgentRow[]>): Promise<void> {
    const read = deps.sessionPreview;
    if (!read) {
      return;
    }
    for (const [worktreeId, rows] of Object.entries(rowsByWorktreeId)) {
      rowsByWorktreeId[worktreeId] = await Promise.all(
        rows.map(async (row) => {
          if (row.entryId === undefined) {
            return row;
          }
          const preview = await read(row.entryId).catch(() => undefined);
          return preview ? { ...row, preview } : row;
        }),
      );
    }
  }

  /** Prefer the vault's session title; registry and pane titles are fallbacks. */
  async function titleFromVault(rowsByWorktreeId: Record<string, WorktreeAgentRow[]>, now: number): Promise<void> {
    const read = deps.sessionTitle;
    if (!read) {
      return;
    }

    const alive = new Set<string>();
    for (const rows of Object.values(rowsByWorktreeId)) {
      for (const row of rows) {
        // A disowned row still reads this memo through `titleSourceId`; evicting on `entryId`
        // alone would drop the entry out from under it on every rebuild.
        const source = row.entryId ?? row.titleSourceId;
        if (source !== undefined) {
          alive.add(source);
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
          // `titleSourceId` is present only where nothing else names the row, so its mere presence
          // is the permission — a registry slug stays as the fallback the vault outranks.
          const source = row.entryId ?? row.titleSourceId;
          if (source === undefined) {
            return row;
          }
          const title = await vaultTitle(source, read, now);
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
    // Standing reports are checked before the cache: they can arrive or change
    // while the pane's pid and cwd remain fixed.
    const claim = deps.reportedSession?.(pane.paneId);
    if (claim !== undefined) {
      if (
        state.proven?.reportLifetime === "standing" &&
        state.proven.agent === claim.agent &&
        state.proven.entryId === claim.entryId
      ) {
        return state.proven;
      }
      state.proven = {
        agent: claim.agent,
        source: "report",
        entryId: claim.entryId,
        evidence: "reported",
        reportLifetime: "standing",
      };
      state.provenPtyPid = pane.ptyPid;
      state.provenCwd = pane.cwd;
      return state.proven;
    }
    if (state.proven?.reportLifetime === "standing") {
      state.proven = undefined;
    }

    // Claude's turn report has a different lifetime: after its activity ages
    // out, the validated ID/path pair remains identity evidence.
    const retainedReport = await reportedIdentity(pane);
    if (retainedReport !== undefined) {
      return retainedReport;
    }

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
      const guessed =
        outcome.entryId !== undefined || pane.cwd === undefined || outcome.agent === REGISTRY_AGENT
          ? undefined
          : await snapshot.sessionUnderCwd?.(outcome.agent, deps.normalize(pane.cwd));
      const entryId = outcome.entryId ?? guessed;
      state.proven = {
        agent: outcome.agent,
        source: outcome.source,
        entryId,
        name: outcome.name,
        evidence: guessed !== undefined ? "directory" : outcome.evidence,
      };
      state.provenPtyPid = pane.ptyPid;
      state.provenCwd = pane.cwd;
      return state.proven;
    }

    if (outcome.kind === "failed") {
      if (!failures.has(outcome.source)) {
        failures.set(outcome.source, outcome.reason);
      }
      return state.proven;
    }

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

  /**
   * What the pane's own agent said about its turn, while that still counts.
   *
   * Measured from when the window received the report, which is the only clock
   * available: hook payloads carry none of their own.
   */
  /**
   * The identity a pane's own agent reported, if the store already holds it.
   *
   * Read at any age: § 4.5 keeps a stale report's identity and drops only its
   * claim about activity — the pane is still that session, whatever it was last
   * seen doing. A session the store cannot resolve produces nothing at all;
   * nothing here creates an entry, and no reported path is ever opened.
   */
  async function reportedIdentity(pane: Pane): Promise<ProvenIdentity | undefined> {
    const report = pane.turn?.report;
    const sessionId = report?.agentSessionId;
    if (sessionId === undefined || deps.resolveReportedSession === undefined) {
      return undefined;
    }
    const entry = await deps.resolveReportedSession(sessionId);
    if (entry === null) {
      return undefined;
    }
    // § 4.6: the reported path is compared against the one the store already
    // holds, and a mismatch is dropped. The reported path is never opened — the
    // comparison is the only thing it is ever used for — so a report naming a
    // session it does not live in fails to agree with itself and identifies
    // nothing (.reviews/round-1.md B2).
    if (report?.transcriptPath !== undefined && !sameTranscript(report.transcriptPath, entry.transcriptPath)) {
      return undefined;
    }
    return {
      agent: entry.agent,
      source: "report",
      entryId: entry.entryId,
      evidence: "reported",
      reportLifetime: "retained",
    };
  }

  function freshTurn(pane: Pane, now: number): AgentTurnReport | undefined {
    const turn = pane.turn;
    if (turn === undefined || now - turn.receivedAt >= TURN_FRESHNESS_MS) {
      return undefined;
    }
    return turn.report;
  }

  /**
   * The § 4.5 precedence: a fresh report beats inference, and process reality
   * beats the report.
   *
   * The two exceptions are the whole point. A pane whose pty is gone is not
   * `working` whatever it last published, and a shell prompt sitting in the pane
   * means the agent is no longer there to correct itself — in both cases the
   * report describes a process that has stopped reporting.
   */
  function readActivity(pane: Pane, reading: PaneActivityReading, now: number): PaneActivityReading & Reported {
    const inferred = {
      activity: reading.activity,
      activitySource: activitySourceFor(reading.rule),
      rule: reading.rule,
    };
    // An exited pty reports rule `quiet`, so the exit has to be read from the
    // process itself rather than from the rule that described it.
    if (pane.exited || reading.rule === "shell-title") {
      return inferred;
    }
    const report = freshTurn(pane, now);
    if (report === undefined) {
      return inferred;
    }
    return {
      activity: TURN_ACTIVITY[report.state],
      activitySource: "hook",
      rule: reading.rule,
      delegations: reportedDelegations(report),
      ...(report.interactivePrompt === undefined ? {} : { interactivePrompt: report.interactivePrompt }),
      ...(report.sessionBoundary === true ? { sessionBoundary: true as const } : {}),
    };
  }

  function stamp(
    state: PaneState,
    identity: ProvenIdentity | undefined,
    activity: PaneActivity,
    pane: Pane,
    now: number,
    sessionBoundary = false,
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
      // A session that resumed, cleared, or came back from compaction lands
      // idle without having finished anything, so it earns no finish time —
      // the boundary flag is the only thing that separates it from a turn that
      // really did end (§ 4.5, .reviews/round-1.md B5).
      const settled =
        !sessionBoundary && activity === "idle" && (state.activity === "running" || state.activity === "waiting");
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
          // The registry's own name for the session. An external row has no pane
          // and therefore no terminal title, so without this it had no title
          // source at all and rendered the placeholder unconditionally.
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
      // A pane that reports its own session does not need to be guessed at;
      // the heuristics stay as the fallback for panes that do not (§ 4.6).
      // Inference runs only where the report did not settle it: resolving both
      // would spend a process-table read on a row the report already decided,
      // and would record that read's degradation against a row it did not
      // choose (.reviews/round-1.md W5).
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
      const reported = readActivity(pane, reading, now);
      const activity = reported.activity;
      stamp(state, identity, activity, pane, now, reported.sessionBoundary === true);

      const row: WorktreeAgentRow = {
        rowId: `window:${pane.paneId}`,
        scope: "window",
        paneId: pane.paneId,
        viewId: pane.viewId,
        // The session's own name outranks the pane's terminal title: claude sets
        // no OSC title at all, so a shell-set one is what would show otherwise.
        title: identity?.name ?? pane.title,
        agent: identity?.agent,
        agentSource: identity?.source ?? "none",
        activity,
        activitySource: reported.activitySource,
        ...(reported.interactivePrompt === undefined ? {} : { interactivePrompt: reported.interactivePrompt }),
        ...(reported.delegations === undefined ? {} : { delegations: reported.delegations }),
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
      await previewFromVault(rowsByWorktreeId);

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
