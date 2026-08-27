// src/providers/WorktreeHost.ts — The window's owner of worktree freshness.
// See: docs/design/worktree-rpc.md § 1, § 2,
//      asimov/changes/cache-and-broadcast-worktree-tree/design.md D1, D6, D7
//
// One host per window, constructed beside the watcher pool. Surfaces attach to
// it; attaching costs no git command and no watcher, so a second panel showing
// the same tree is free.

import type * as vscode from "vscode";
import type {
  ExtensionToWebViewMessage,
  WebViewToExtensionMessage,
  WorktreeActionMessage,
  WorktreeMutationResultMessage,
  WorktreeOpenAfterMode,
} from "../types/messages";
import { sanitizeBranchForPath } from "../worktree/branchSlug";
import { resolveCreateRoot, suggestFreePath } from "../worktree/createPath";
import { hasGitRepo } from "../worktree/hasGitRepo";
import type { PresenceProjector } from "../worktree/presenceProjector";
import type {
  DelegationRoster,
  PresenceDegradation,
  WorktreeAgentRow,
  WorktreePresence,
} from "../worktree/presenceTypes";
import { createRebuildGate, type RebuildGateClock } from "../worktree/rebuildGate";
import type { WorktreeInfo, WorktreeRepo } from "../worktree/types";
import { createWorktreeCache } from "../worktree/WorktreeCache";
import { buildWorktreeTreeDetailed, listRepoWorktrees, type WorktreeTreeDeps } from "../worktree/WorktreeDiscovery";
import {
  type ExternalSessionFact,
  evaluateRemoval,
  type PaneFact,
  type RemovalAssessment,
  type SourceRead,
} from "../worktree/worktreeBlockers";
import { type WorktreeWatch, watchRepoStructure } from "../worktree/worktreeWatchTargets";
import type { WatcherPool } from "./fsWatcherPool";

const LOG_PREFIX = "[worktree-host]";

/**
 * How long presence may lag the evidence behind it.
 *
 * A max-latency cap, NOT a resettable debounce: an agent producing output for a
 * minute would push a debounce out for that whole minute and the row would
 * never move. The first change arms this; later ones ride it (design.md D3.1).
 */
export const PRESENCE_MAX_LATENCY_MS = 150;

/**
 * How often the running-session registry is scanned for agents outside this
 * window. Flat, because the registry emits no events and the scan is a readdir,
 * a JSON parse per entry and a liveness probe — tiered cadences would be more
 * machinery than the thing being paced.
 */
export const EXTERNAL_SCAN_INTERVAL_MS = 5_000;

/** The gate scope that rebuilds every repository; any other scope is a repoId. */
export const WHOLE_TREE_SCOPE = "*";

export interface WorktreeSurface {
  isReady(): boolean;
  post(message: ExtensionToWebViewMessage): void;
  /**
   * Open a terminal in THIS surface's view, at a path the host resolved.
   *
   * Here rather than in {@link WorktreeActions} because creating a pane is
   * `createSession(viewId, webview, {cwd})`, and only the provider that built
   * this surface holds both. The host still resolves which path — this receives
   * the value it looked up, never an id (design.md D2).
   *
   * Optional like every other capability: a surface that does not implement it
   * offers no terminals, exactly as it behaved before actions existed.
   */
  openTerminal?(cwd: string): Promise<void>;
}

export interface WorktreeHostOptions {
  deps: WorktreeTreeDeps;
  /** Read at rebuild time, not captured: folders change while the window lives. */
  workspaceFolders(): readonly string[];
  pool: Pick<WatcherPool, "subscribePattern">;
  /** `vscode.workspace.onDidChangeWorkspaceFolders`, injected for testability. */
  onDidChangeWorkspaceFolders?(listener: () => void): vscode.Disposable;
  clock?: RebuildGateClock;
  /** `anywhereTerminal.worktree.createRoot`, read through `SettingsReader`. */
  createRoot?(): { value: string | undefined; explicitlySet: boolean };
  /**
   * The two evidence sources a removal assessment needs and the tree does not
   * carry. Absent in the tests that only exercise routing; supplied in
   * production from the same store and registry the projector reads, so the
   * blockers a confirmation is bound to come from one set of facts.
   */
  removalFacts?: {
    panes(): readonly PaneFact[];
    externalSessions(): Promise<SourceRead<readonly ExternalSessionFact[]>>;
  };
  /**
   * The window projection. Absent — every surface but the real extension entry
   * point — and the host behaves exactly as it did before presence existed.
   */
  projector?: PresenceProjector;
  /** Pane evidence moved. Injected as a subscription so the host owns no store. */
  onPaneChange?(listener: () => void): vscode.Disposable;
  now?(): number;
  /** Path-existence probe behind `initPayload`, injected in tests. */
  exists?(p: string): boolean;
  /**
   * Read one session's delegation roster. Absent — every surface but the real
   * extension entry point — and an expansion request is ignored, exactly as it
   * was before delegations existed.
   *
   * Returns the outcome rather than a transcript: what a null read means is the
   * reader's to name, and a throw is turned into `failed` here.
   */
  readDelegations?(entryId: string): Promise<DelegationRoster>;
  /**
   * What the host cannot do itself. Absent — every surface but the real
   * extension entry point — and every action request is ignored, exactly as it
   * was before actions existed.
   *
   * The host resolves; these perform. Nothing here takes an id: each receives
   * the value the host looked up, so a capability cannot be handed a target the
   * host never validated (design.md D2).
   */
  actions?: WorktreeActions;
}

/**
 * The panel's read-only capabilities, injected because none of them belong to a
 * component that holds a tree.
 *
 * Opening a terminal is deliberately NOT here — see `WorktreeSurface`.
 * `focusPane` takes the view the pane lives in, not the view that asked — revealing the asking surface would focus a pane the user
 * cannot see whenever the panel is open in two places (D4).
 */
export interface WorktreeActions {
  openFolder(path: string, mode: "newWindow" | "addToWorkspace"): Promise<void>;
  revealInOS(path: string): Promise<void>;
  copyText(text: string): Promise<void>;
  focusPane(paneId: string, viewId: string): Promise<void>;
  copyResumeCommand(entryId: string): Promise<void>;
  revealSessionCwd(entryId: string): Promise<void>;
  copySessionCwd(entryId: string): Promise<void>;

  // ── Mutating (design.md D1, D12, D13) ────────────────────────────────
  // Optional, so a surface or a host wired without them offers nothing rather
  // than offering a control that resolves to no capability.
  /**
   * Remove a worktree. The capability owns the journal, the git invocation and
   * the indeterminate classification; the host's job is resolving WHICH
   * worktree and refusing to pass a force that carries no fingerprint.
   */
  /**
   * Create a worktree. The capability re-validates the path immediately before
   * spawning — after the coordinator's queue wait — because the host's check
   * here is only a shape check, not a filesystem one.
   */
  createWorktree?(request: {
    repoId: string;
    path: string;
    branch?: string;
    baseRef?: string;
    detach?: boolean;
    openAfter: WorktreeOpenAfterMode;
    origin?: WorktreeSurface;
  }): Promise<void>;
  removeWorktree?(target: WorktreeMutationTarget, force: boolean, fingerprint: string | undefined): Promise<void>;
  lockWorktree?(target: WorktreeMutationTarget, reason: string | undefined): Promise<void>;
  unlockWorktree?(target: WorktreeMutationTarget): Promise<void>;
  /**
   * `confirmedCount` is what the confirmation named. The capability re-counts
   * before running and abandons the prune when the answer moved, so the user
   * never authorizes one number and gets another.
   */
  pruneRepo?(repoId: string, confirmedCount: number, origin?: WorktreeSurface): Promise<void>;
  /**
   * Drop confirmations for worktrees that are no longer in the tree.
   *
   * Called after EVERY authoritative rebuild, not only after a removal: the
   * disappearance a confirmation dies on can be observed by any of them (D15).
   */
  reconcileFingerprints?(presentWorktreeIds: readonly string[]): void;
}

/**
 * Init-message fields the worktree host contributes. Providers spread this into
 * their `init` payload so the panel can pick its opening view before it paints —
 * the host pushes nothing to a surface that has not declared the view visible,
 * so a webview that opened on the wrong body could never learn it had.
 */
export interface WorktreeInitPayload {
  /** At least one workspace folder is inside a git repository. */
  worktreeHasRepo: boolean;
}

/**
 * What `attach` hands back. Carrying the display-state setter here rather than
 * exposing it on the host keyed by surface is what stops a provider reporting
 * for a surface it never attached, or one whose attachment it already disposed.
 */
export interface WorktreeAttachment extends vscode.Disposable {
  /** Report whether the window is displaying this surface (design.md D1). */
  setDisplayed(displayed: boolean): void;
}

/**
 * WHICH worktree, unresolved.
 *
 * The read-only capabilities take a path the host looked up, because a reveal
 * or a copy acts immediately. A mutation does not: it waits for the queue and a
 * forced rebuild first, and a path resolved before that wait can name a
 * registration that no longer exists — or a different one that took its place.
 * Mutations therefore carry the id and resolve on the far side (round-1 B2).
 */
export interface WorktreeMutationTarget {
  repoId: string;
  worktreeId: string;
  /**
   * The surface that raised this action, so its outcome can go back there.
   * Not part of any message — the host supplies it from the routing it already
   * does in `handleMessage(surface, msg)` (D17).
   */
  origin?: WorktreeSurface;
}

/** The mutating half of `WorktreeActions`, as one suppliable unit. */
export type WorktreeMutationCapabilities = Required<
  Pick<
    WorktreeActions,
    "createWorktree" | "removeWorktree" | "lockWorktree" | "unlockWorktree" | "pruneRepo" | "reconcileFingerprints"
  >
>;

/**
 * The reads a mutation service needs from the host, and nothing else.
 *
 * Handed out rather than injected because the host is what OWNS the cache, the
 * rebuild gate and the projection, and the service is constructed alongside it
 * at the extension seam. One narrow interface keeps that seam from becoming a
 * back door onto the whole host.
 */
export interface WorktreeMutationBindings {
  /** Rebuild `repoId` and wait for it. */
  forceRebuild(repoId: string): Promise<void>;
  /** What `worktreeId` names in the CURRENT tree, or null once it is gone. */
  resolve(target: WorktreeMutationTarget): ResolvedMutationTarget | null;
  /** The repository's main worktree path, for the repo-scoped verbs. */
  repoPath(repoId: string): string | null;
  /** The listing behind the current tree is stale, failed, or absent. */
  isDegraded(repoId: string): boolean;
  /** Where a create may go in this repo, and what already occupies it. */
  createContext(repoId: string): { mainWorktree: string; linkedWorktrees: readonly string[] } | null;
  /**
   * The full blocker assessment for a removal target, from real state.
   *
   * On the host because the host is what holds all six inputs — the listing,
   * the projection, the pane store, the registry, and the git runner that reads
   * `--porcelain`. `null` when the id names nothing or the facts are unavailable.
   */
  assessRemoval(target: WorktreeMutationTarget): Promise<RemovalAssessment | null>;
}

/** What an id names once the tree has been rebuilt. */
/** What the service hands back, plus where it came from. */
export interface WorktreeMutationReport {
  origin: WorktreeSurface | null;
  message: WorktreeMutationResultMessage;
  /** Set only on a successful create that asked for a terminal. */
  openTerminalAt?: string;
}

export interface ResolvedMutationTarget {
  repoPath: string;
  worktreePath: string;
  /** Does NOT survive a remove-and-recreate at the same path (round-1 B5). */
  incarnation: string;
  locked: boolean;
  wasRegistered: boolean;
  existedOnDisk: boolean;
}

export interface WorktreeHost extends vscode.Disposable {
  /** Fields this host contributes to a surface's `init` message. */
  initPayload(): WorktreeInitPayload;
  /** The narrow read surface a mutation service is built on (round-1 B1). */
  mutationBindings(): WorktreeMutationBindings;
  /**
   * Deliver a mutation outcome to the surface that started it, and open a
   * terminal there when the create asked for one.
   *
   * The service used to post straight at two providers, which missed every
   * attached editor surface and could not open a terminal at all — that needs a
   * view id and a webview, which only a surface holds (D17, D2).
   */
  reportMutation(outcome: WorktreeMutationReport): void;
  /** Register one surface. Disposing detaches only that surface. */
  attach(surface: WorktreeSurface): WorktreeAttachment;
  /** Route an inbound worktree message from `surface`. Unknown types ignored. */
  handleMessage(surface: WorktreeSurface, msg: WebViewToExtensionMessage): void;
}

/** What one projection request wants. */
interface ProjectionRequest {
  /** Skip the pane pass — the poll's mode (design.md D6). */
  external?: boolean;
  /**
   * Join a run already in flight rather than marking it dirty. A caller with no
   * new pane evidence wants an envelope, not a second projection.
   */
  join?: boolean;
}

interface SurfaceState {
  /**
   * False until the surface says otherwise. All three surfaces retain their DOM
   * while hidden, so a default of true would post into panels that have never
   * shown the view — the cost this gate exists to avoid.
   */
  visible: boolean;
  /**
   * The window is displaying this surface. Independent of `visible`, and false
   * for the same reason: `retainContextWhenHidden` means a surface that stopped
   * being displayed still holds — and still means — its last declaration.
   */
  displayed: boolean;
  /** Last computed `visible && displayed`, so the transition is edge-triggered. */
  showing: boolean;
}

export function createWorktreeHost(options: WorktreeHostOptions): WorktreeHost {
  const now = options.now ?? Date.now;
  const cache = createWorktreeCache();
  const surfaces = new Map<WorktreeSurface, SurfaceState>();
  const watches = new Map<string, WorktreeWatch>();
  const projector = options.projector;
  let built = false;
  let disposed = false;
  /** Last projection produced, and the tree version it describes. */
  let projected: WorktreePresence | undefined;
  let projectedVersion = -1;
  /**
   * The only thing any surface is ever shown.
   *
   * Committing the two halves together is what makes the envelope contract
   * true: `rebuild()` mutates the cache before it can project, and a cached
   * tree request, a surface becoming displayed, or a watch-failure write inside
   * that window would otherwise deliver the new tree beside the previous
   * presence (.reviews/round-2.md B1).
   */
  let published: { tree: ReturnType<typeof cache.read>; presence: WorktreePresence } | undefined;
  /**
   * Bumped by every write to the cached tree — never by a delivery attempt.
   *
   * A projection describes the tree it read, so what invalidates it is that
   * tree moving. Versioning delivery instead made a broadcast that posted to
   * nobody supersede real work, and made two broadcasts of the same tree look
   * like two different trees (.reviews/round-1.md B1).
   */
  let treeVersion = 0;
  /** The projection currently in flight. One at a time: the projector is stateful. */
  let projectionRun: Promise<void> | undefined;
  let projectionDirty = false;
  let capHandle: unknown;
  /** The external-scan timer, armed only while some surface is showing the view. */
  let scanHandle: unknown;
  /** Whether the next projection iteration may skip the pane pass. */
  let nextExternalOnly = false;
  /**
   * Pane events counted, and the count the last full projection actually
   * applied. Work is outstanding while they differ (design.md D11).
   *
   * Not a boolean, and not "is a cap armed". A boolean answers "is there
   * evidence" where the question is "has THIS pass seen it", so a pane event
   * landing while a projection is already reading panes is indistinguishable
   * from one that landed before it, and the pass clears a flag it never
   * honoured (.reviews/round-3.md B1). The cap is a latency device only: the
   * scan cancels it, which must not destroy evidence (.reviews/round-2.md B1).
   */
  let paneEvidence = 0;
  let paneEvidenceApplied = 0;
  /**
   * The rank revision the cached ORDER was built from.
   *
   * Advanced at exactly one site — after `cache.reorder`, the only cache-wide
   * ordering operation. A rebuild's write must not acknowledge it: `applyRepo`
   * orders one repository and rebuilds are serialized per scope, and `merge`
   * retains the stored worktree array for a degraded listing, so neither write
   * establishes the ranking it captured (design.md D12).
   */
  let appliedRankRevision = projector?.rankRevision() ?? 0;
  /**
   * Rosters read, and the reads still in flight, both under `(rowId, entryId)`.
   *
   * Composite, not `rowId` alone: a slow read for session A completing after a
   * fast read for session B would evict B's result under the shared key, and a
   * pane that ended one session and started another would keep the first
   * session's delegations under the second (design.md D3).
   */
  const rosters = new Map<string, DelegationRoster>();
  const rosterReads = new Map<string, Promise<void>>();

  function armCap(fn: () => void): unknown {
    return arm(fn, PRESENCE_MAX_LATENCY_MS);
  }

  function arm(fn: () => void, ms: number): unknown {
    return options.clock ? options.clock.setTimeout(fn, ms) : setTimeout(fn, ms);
  }

  function cancelCap(handle: unknown): void {
    if (options.clock) {
      options.clock.clearTimeout(handle);
    } else {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    }
  }

  /**
   * The ordering key the listing sorts by. Read through the projector on every
   * assembly rather than snapshotted, so a rebuild orders by the presence that
   * is current when it runs (design.md D12).
   */
  const discoveryDeps: WorktreeTreeDeps = projector
    ? { ...options.deps, rank: (id: string) => projector.rank(id) }
    : options.deps;

  /** Presence with no projector is the empty envelope this host always sent. */
  function presence(): WorktreePresence {
    return projected ?? { rowsByWorktreeId: {}, scannedAt: now(), degradedSources: [] };
  }

  /** `\0` cannot occur in a row id or an entry id, so the join is unambiguous. */
  function rosterKey(rowId: string, entryId: string): string {
    return `${rowId}\u0000${entryId}`;
  }

  /**
   * Which failed source would undermine this row's own activity claim.
   *
   * Per-row rather than "is anything degraded": a failed registry scan says
   * nothing about a pane whose activity came from its hook, and decaying on it
   * would throw away the one case D11 exists to preserve.
   */
  const ACTIVITY_EVIDENCE = {
    hook: "hook",
    output: "panes",
    title: "panes",
    registry: "registry",
    none: undefined,
  } as const satisfies Record<WorktreeAgentRow["activitySource"], PresenceDegradation["source"] | undefined>;

  function parentIsLive(row: WorktreeAgentRow, degraded: ReadonlySet<PresenceDegradation["source"]>): boolean {
    if (row.activity !== "running" && row.activity !== "waiting") {
      return false;
    }
    const evidence = ACTIVITY_EVIDENCE[row.activitySource];
    // `none` proves nothing, so the parent's own liveness is unevidenced too.
    return evidence !== undefined && !degraded.has(evidence);
  }

  /**
   * A child's `running` does not outlive its parent's freshness (design.md D11).
   *
   * The transcript's recorded status is what the mapper hands over; whether it
   * may still be PUBLISHED is decided here, in the same pass that publishes the
   * parent — which is what makes the two incapable of disagreeing.
   */
  function decay(
    roster: DelegationRoster,
    parent: WorktreeAgentRow,
    degraded: ReadonlySet<PresenceDegradation["source"]>,
  ): DelegationRoster {
    if (roster.kind !== "ok" || parentIsLive(parent, degraded)) {
      return roster;
    }
    if (!roster.rows.some((child) => child.status === "running")) {
      return roster;
    }
    return {
      ...roster,
      rows: roster.rows.map((child) => (child.status === "running" ? { ...child, status: "unknown" as const } : child)),
    };
  }

  /**
   * Attach every roster to the row it was read for, and drop the rest.
   *
   * The rows here are the projector's own retained objects — a replay hands
   * them straight back — so each is COPIED rather than written through, or the
   * roster would end up inside the projector's replay state (design.md D3).
   * Eviction runs against the rows actually published, so a closed pane, or a
   * pane that started a new session, takes its roster with it.
   */
  function withDelegations(source: WorktreePresence): WorktreePresence {
    if (rosters.size === 0) {
      return source;
    }
    const degraded = new Set(source.degradedSources.map((entry) => entry.source));
    const kept = new Set<string>();
    const rowsByWorktreeId: Record<string, WorktreeAgentRow[]> = {};
    for (const [worktreeId, rows] of Object.entries(source.rowsByWorktreeId)) {
      rowsByWorktreeId[worktreeId] = rows.map((row) => {
        const key = row.entryId === undefined ? undefined : rosterKey(row.rowId, row.entryId);
        const roster = key === undefined ? undefined : rosters.get(key);
        if (key === undefined || roster === undefined) {
          return row;
        }
        kept.add(key);
        return { ...row, delegations: decay(roster, row, degraded) };
      });
    }
    for (const key of rosters.keys()) {
      if (!kept.has(key)) {
        rosters.delete(key);
      }
    }
    return { ...source, rowsByWorktreeId };
  }

  /** The row `rowId` names in the envelope this host last published, if any. */
  function publishedRow(rowId: string): WorktreeAgentRow | undefined {
    if (!published) {
      return undefined;
    }
    for (const rows of Object.values(published.presence.rowsByWorktreeId)) {
      const found = rows.find((row) => row.rowId === rowId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  /** The worktree `worktreeId` names in the tree this host currently holds. */
  function cachedWorktree(worktreeId: string): WorktreeInfo | undefined {
    for (const repo of cache.read().repos) {
      const found = repo.worktrees.find((wt) => wt.id === worktreeId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  /**
   * Which repository holds this worktree, derived rather than accepted.
   *
   * The inbound messages carry only a `worktreeId`, and that is the right
   * shape: a webview-supplied `repoId` would let one repo's panel name
   * another's queue, and the id it names is the only thing a mutation is
   * entitled to act on. Resolved here for the queue key only — the TARGET is
   * re-resolved from the id on the far side of the rebuild (round-1 B2).
   */
  function repoIdOf(worktreeId: string): string | undefined {
    for (const repo of cache.read().repos) {
      if (repo.worktrees.some((wt) => wt.id === worktreeId)) {
        return repo.repoId;
      }
    }
    return undefined;
  }

  /**
   * The path to act on for a worktree request, or undefined to do nothing.
   *
   * A `missing` worktree resolves for a copy and for nothing else: copying the
   * path is how a user goes and looks at what happened to a directory that is
   * gone, but opening, revealing or spawning a terminal in one would act on a
   * path that is not there (design.md D3).
   */
  function actionPath(worktreeId: string, allowMissing: boolean): string | undefined {
    const wt = cachedWorktree(worktreeId);
    if (!wt || (wt.missing && !allowMissing)) {
      return undefined;
    }
    return wt.displayPath;
  }

  /**
   * The published row this request names, only if the value it carried still
   * matches the host's own.
   *
   * The carried id is an expected-version token, never an argument: a surface
   * whose last envelope was skipped still shows the previous session under a
   * stable row id, and acting on the id it sent would act on the wrong session
   * (D3). Returning the row rather than a boolean is what makes it impossible to
   * check one value and then act on another.
   */
  function matchedRow(rowId: string, field: "paneId" | "entryId", carried: string): WorktreeAgentRow | undefined {
    const row = publishedRow(rowId);
    const own = row?.[field];
    return own !== undefined && own === carried ? row : undefined;
  }

  /** Run one capability, keeping a rejection out of the message loop. */
  function perform(run: () => Promise<void>): void {
    void run().catch((err) => {
      console.warn(`${LOG_PREFIX} worktree action failed`, err);
    });
  }

  /**
   * Perform one read-only action, or nothing at all.
   *
   * Every branch resolves against what the host currently holds and hands the
   * capability the host's OWN value. A request naming something the host does
   * not hold falls through to nothing — never to a nearest match, a first
   * repository, or the workspace root: an action that did something against an
   * unintended target is worse than one that did nothing (D3).
   */
  function handleAction(surface: WorktreeSurface, msg: WorktreeActionMessage): void {
    const actions = options.actions;
    if (!actions || disposed) {
      return;
    }
    switch (msg.type) {
      case "worktreeOpenFolder": {
        // Validated, not trusted: the capability treats anything that is not
        // `newWindow` as `addToWorkspace`, so a malformed payload would mutate
        // the workspace instead of failing closed (round-1 W1).
        if (msg.mode !== "newWindow" && msg.mode !== "addToWorkspace") {
          return;
        }
        const path = actionPath(msg.worktreeId, false);
        if (path !== undefined) {
          perform(() => actions.openFolder(path, msg.mode));
        }
        return;
      }
      case "worktreeCreate": {
        const create = actions.createWorktree;
        // Validated, not trusted. `agent` is rejected until WT-005.3 supplies
        // the launch it names — defence in depth behind the form, which does
        // not offer the option at all (design.md D9).
        const modes: readonly WorktreeOpenAfterMode[] = ["none", "terminal", "newWindow", "addToWorkspace"];
        if (!modes.includes(msg.openAfter)) {
          return;
        }
        if (create && typeof msg.path === "string" && msg.path.length > 0 && msg.repoId.length > 0) {
          perform(() =>
            create({
              repoId: msg.repoId,
              path: msg.path,
              branch: msg.branch,
              baseRef: msg.baseRef,
              detach: msg.detach,
              openAfter: msg.openAfter,
              origin: surface,
            }),
          );
        }
        return;
      }
      case "worktreeRemove": {
        // A `missing` worktree still resolves: `git worktree remove` is how its
        // stale registration gets pruned (worktree-rpc.md:241).
        const remove = actions.removeWorktree;
        // Gated on resolvability HERE and resolved for real later. The gate is
        // a fail-fast so an id the host never published spawns nothing at all;
        // it is not the resolution the action acts on (B2).
        const gate = actionPath(msg.worktreeId, true);
        // A force with no fingerprint authorizes nothing, and an unforced call
        // carrying one is a payload we did not issue — both refused here rather
        // than deeper, where a partial check could act on the wrong half.
        if (msg.force !== (msg.fingerprint !== undefined)) {
          return;
        }
        // Deliberately NOT pre-resolved: the capability re-resolves this id
        // after its own forced rebuild (B2). A `missing` worktree still
        // resolves there — `git worktree remove` is how its stale registration
        // gets pruned (worktree-rpc.md:241).
        const repoId = repoIdOf(msg.worktreeId);
        if (remove && repoId !== undefined && gate !== undefined) {
          perform(() => remove({ repoId, worktreeId: msg.worktreeId, origin: surface }, msg.force, msg.fingerprint));
        }
        return;
      }
      case "worktreeLock": {
        const lock = actions.lockWorktree;
        const repoId = repoIdOf(msg.worktreeId);
        // A worktree whose directory is gone resolves for a copy and nothing
        // else (design.md D3) — locking one would act on a path that is not
        // there.
        if (lock && repoId !== undefined && actionPath(msg.worktreeId, false) !== undefined) {
          perform(() => lock({ repoId, worktreeId: msg.worktreeId, origin: surface }, msg.reason));
        }
        return;
      }
      case "worktreeUnlock": {
        const unlock = actions.unlockWorktree;
        const repoId = repoIdOf(msg.worktreeId);
        if (unlock && repoId !== undefined && actionPath(msg.worktreeId, false) !== undefined) {
          perform(() => unlock({ repoId, worktreeId: msg.worktreeId, origin: surface }));
        }
        return;
      }
      case "requestWorktreeCreateDefaults": {
        // Answered by the HOST because only it knows the configured root, the
        // repo's own layout, and which candidates are free. A panel-computed
        // path would state a destination the create might refuse.
        const repo = cache.read().repos.find((r) => r.repoId === msg.repoId);
        if (repo === undefined) {
          return;
        }
        const linked = repo.worktrees.filter((w) => w.id !== repo.mainPath).map((w) => w.id);
        const root = resolveCreateRoot({
          configured: options.createRoot?.() ?? { value: undefined, explicitlySet: false },
          linkedWorktrees: linked,
          mainWorktree: repo.mainPath,
        });
        const registered = new Set(repo.worktrees.map((w) => w.id));
        // Registrations AND the filesystem: a directory nobody registered still
        // makes `git worktree add` fail, so proving a path free against the
        // listing alone proves the wrong thing (round-3 B12).
        const taken = (candidate: string): boolean =>
          registered.has(candidate) || (options.exists?.(candidate) ?? false);
        // The repo's own name is the base a branch is appended to, so the form's
        // placeholder and the destination it opens on describe one scheme. With
        // a branch, the base is what the form would have shown for it — the
        // host resolves the collision on THAT, not on the bare default.
        const slug = sanitizeBranchForPath(msg.branch ?? "");
        const base = slug.length > 0 ? `${repo.label}-${slug}` : repo.label;
        const bare = suggestFreePath(root, base, () => false);
        const path = suggestFreePath(root, base, taken);
        surface.post({
          type: "worktreeCreateDefaults",
          repoId: msg.repoId,
          root,
          prefix: repo.label,
          path,
          // The branch this answer is FOR. Replies race the typing that caused
          // them, and a form cannot tell a current answer from a stale one
          // without it (round-4 B12).
          ...(msg.branch === undefined ? {} : { branch: msg.branch }),
          ...(path === bare ? {} : { collidedWith: bare }),
        });
        return;
      }
      case "worktreePrune": {
        // Repo-scoped, so it resolves against the repo id rather than a
        // worktree — there is no single worktree a prune acts on.
        const prune = actions.pruneRepo;
        if (prune && typeof msg.repoId === "string" && msg.repoId.length > 0) {
          perform(() => prune(msg.repoId, msg.confirmedCount, surface));
        }
        return;
      }
      case "worktreeRevealInOS": {
        const path = actionPath(msg.worktreeId, false);
        if (path !== undefined) {
          perform(() => actions.revealInOS(path));
        }
        return;
      }
      case "worktreeCopyPath": {
        const path = actionPath(msg.worktreeId, true);
        if (path !== undefined) {
          perform(() => actions.copyText(path));
        }
        return;
      }
      case "worktreeOpenTerminal": {
        // Asked of the surface that raised it: a new tab belongs where the user
        // was, and only a surface can create one at all.
        const path = actionPath(msg.worktreeId, false);
        const open = surface.openTerminal;
        if (path !== undefined && open) {
          perform(() => open.call(surface, path));
        }
        return;
      }
      case "worktreeFocusPane": {
        // An external row carries no `paneId` at all, so this cannot resolve for
        // one however it is asked — the innermost of three barriers (D4).
        const row = matchedRow(msg.rowId, "paneId", msg.paneId);
        if (row?.paneId !== undefined && row.viewId !== undefined) {
          perform(() => actions.focusPane(row.paneId as string, row.viewId as string));
        }
        return;
      }
      case "worktreeOpenPreview": {
        const row = matchedRow(msg.rowId, "entryId", msg.entryId);
        if (row?.entryId !== undefined) {
          // Answered back to the asking surface: the overlay is webview-owned,
          // and the entry id it gets is the host's, not the one it asked with.
          surface.post({ type: "worktreeShowPreview", entryId: row.entryId });
        }
        return;
      }
      case "worktreeCopyResumeCommand": {
        const row = matchedRow(msg.rowId, "entryId", msg.entryId);
        if (row?.entryId !== undefined) {
          const entryId = row.entryId;
          perform(() => actions.copyResumeCommand(entryId));
        }
        return;
      }
      case "worktreeRevealAgentCwd": {
        const row = matchedRow(msg.rowId, "entryId", msg.entryId);
        if (row?.entryId !== undefined) {
          const entryId = row.entryId;
          perform(() => actions.revealSessionCwd(entryId));
        }
        return;
      }
      case "worktreeCopyAgentPath": {
        const row = matchedRow(msg.rowId, "entryId", msg.entryId);
        if (row?.entryId !== undefined) {
          const entryId = row.entryId;
          perform(() => actions.copySessionCwd(entryId));
        }
        return;
      }
    }
  }

  /**
   * Read what one row's session delegated — at most once per row per session.
   *
   * The request's entry id is an expected-version token, never an argument: the
   * read uses the published row's OWN id, so a stale or forged one reads
   * nothing rather than the wrong transcript (design.md D1). A second request
   * while the first is in flight joins it; one already answered re-reads
   * nothing (D8).
   */
  function requestDelegations(rowId: string, entryId: string): void {
    const reader = options.readDelegations;
    if (!reader || disposed) {
      return;
    }
    const row = publishedRow(rowId);
    const session = row?.entryId;
    if (session === undefined || session !== entryId) {
      return;
    }
    const key = rosterKey(rowId, session);
    if (rosters.has(key) || rosterReads.has(key)) {
      return;
    }
    const read = (async () => {
      let roster: DelegationRoster;
      try {
        roster = await reader(session);
      } catch (err) {
        roster = { kind: "failed", reason: err instanceof Error ? err.message : String(err) };
      }
      if (disposed) {
        return;
      }
      rosterReads.delete(key);
      rosters.set(key, roster);
      commitAndBroadcast();
    })();
    rosterReads.set(key, read);
  }

  /**
   * Freeze the current tree beside the presence that describes it.
   *
   * Refuses when the projection is behind the cache: half an envelope is worse
   * than a late one, and the coordinator is about to produce the other half.
   */
  function commit(): boolean {
    if (projector && projectedVersion !== treeVersion) {
      return false;
    }
    // Ordering is baked into the cache at `assembleRepo` time, from the rank the
    // projector held then. A presence-only projection never re-reads git, so
    // re-applying the rank here is the only thing that moves a worktree which
    // just gained — or just lost — an agent (design.md D8). Asked of the
    // projector rather than assumed: the 5-second poll is the caller, and the
    // poll that moved nothing is the common case (.reviews/round-2.md W2).
    const revision = projector?.rankRevision();
    if (revision !== undefined && revision !== appliedRankRevision) {
      cache.reorder(discoveryDeps.rank);
      appliedRankRevision = revision;
    }
    published = { tree: cache.read(), presence: withDelegations(presence()) };
    return true;
  }

  function worktreeIds(): string[] {
    return cache.read().repos.flatMap((repo) => repo.worktrees.map((worktree) => worktree.id));
  }

  /**
   * Project once, committing only if the tree it read is still the tree we hold.
   *
   * A projection that raced a rebuild is not discarded — it is marked for a
   * re-run. Dropping it is how a pane transition disappears until some later,
   * unrelated evidence event happens to trigger another projection.
   */
  async function projectOnce(externalOnly: boolean): Promise<void> {
    if (!projector || disposed) {
      return;
    }
    const at = treeVersion;
    const next = await projector.project(worktreeIds(), externalOnly ? { external: true } : undefined);
    if (disposed) {
      return;
    }
    if (treeVersion !== at) {
      projectionDirty = true;
      return;
    }
    projected = next;
    projectedVersion = at;
  }

  /**
   * The single entry into the projector, for the pane path and the rebuild path
   * alike.
   *
   * The projector holds per-pane resolution slots and per-row timestamps, so
   * two concurrent `project()` calls interleave writes to the same maps and the
   * older result can commit last. Everything funnels through here, and a caller
   * arriving mid-flight joins the run in progress rather than starting a second
   * (.reviews/round-1.md B1).
   */
  function requestProjection(request: ProjectionRequest = {}): Promise<void> {
    if (disposed) {
      return Promise.resolve();
    }
    if (!projector) {
      // No projection to wait for; the tree is the whole envelope.
      commitAndBroadcast();
      return Promise.resolve();
    }
    if (projectionRun) {
      if (request.join === true) {
        // The poll wants an envelope, not fresh pane work. Dirtying the run in
        // flight would buy a second projection to answer a scan the first one
        // is already performing.
        return projectionRun;
      }
      // Everything else carries pane evidence, and the run in flight may be an
      // external-only pass that is skipping exactly those panes.
      projectionDirty = true;
      // New pane evidence: the re-run has to look at the panes.
      nextExternalOnly = false;
      return projectionRun;
    }
    nextExternalOnly = request.external === true;
    const run = (async () => {
      let clean = true;
      let applied = paneEvidenceApplied;
      try {
        do {
          projectionDirty = false;
          const externalOnly = nextExternalOnly;
          nextExternalOnly = false;
          // Captured BEFORE the pass reads the panes, so an event arriving
          // during it stays outstanding. The failure this chooses is one
          // redundant full pass; the other choice loses the transition (D11).
          const evidenceAt = paneEvidence;
          await projectOnce(externalOnly);
          // Dirty means this pass was invalidated — by a tree that moved under
          // it, or by pane evidence that arrived after it read the panes. Either
          // way it applied nothing. Defence in depth today: a dirty iteration
          // always forces a FULL rerun, whose own capture is at least this one,
          // so no test can reach it. It is what keeps D11 true if that ever
          // stops holding.
          if (!externalOnly && !projectionDirty) {
            applied = Math.max(applied, evidenceAt);
          }
        } while (projectionDirty && !disposed);
      } catch (err) {
        clean = false;
        console.warn(`${LOG_PREFIX} presence projection threw — nothing published`, err);
      }
      // Cleared and published with no await between, so a caller arriving now
      // either joined this cycle already or starts the next one — it cannot
      // mark a cycle dirty that has stopped looking.
      projectionRun = undefined;
      if (clean) {
        paneEvidenceApplied = Math.max(paneEvidenceApplied, applied);
      }
      if (disposed) {
        return;
      }
      if (clean) {
        commitAndBroadcast();
      } else if (projectionDirty) {
        // Someone joined the run that failed. Their work is not done just
        // because this promise resolved, so it is re-run rather than dropped
        // (.reviews/round-3.md W5).
        void requestProjection();
      }
    })();
    projectionRun = run;
    return run;
  }

  /**
   * The one publication point.
   *
   * Callers request work; they never attach a broadcast to it. Two of them
   * joining one cycle used to publish its single result twice — single-flight
   * projection is not single-flight publication (.reviews/round-2.md W3).
   */
  /**
   * Make sure an envelope will exist, without asking for fresh work.
   *
   * A caller that only wants to be served is not a caller with new evidence:
   * routing it through `requestProjection` would dirty the run already in
   * flight and buy a second projection to answer a cached request.
   */
  function ensureProjection(): void {
    if (!projectionRun) {
      void requestProjection();
    }
  }

  function commitAndBroadcast(): void {
    if (commit()) {
      broadcast();
    }
  }

  /**
   * Arm or clear the scan against one window-level fact: is any attached surface
   * showing the view right now?
   *
   * Read live rather than from `state.showing`, which stays false after a post
   * that was skipped or threw and so is not a safe predicate for this.
   */
  function reconcileScan(): void {
    const wanted = !disposed && projector !== undefined && anyShowing();
    if (wanted === (scanHandle !== undefined)) {
      return;
    }
    if (!wanted) {
      cancelCap(scanHandle);
      scanHandle = undefined;
      return;
    }
    armScan();
  }

  function anyShowing(): boolean {
    for (const state of surfaces.values()) {
      if (state.visible && state.displayed) {
        return true;
      }
    }
    return false;
  }

  function armScan(): void {
    scanHandle = arm(() => {
      scanHandle = undefined;
      // A pending cap means pane evidence is waiting to be projected. Absorbing
      // it is only honest if this projection actually looks at the panes — the
      // external-only pass is precisely the one that does not, so absorbing into
      // it would drop that evidence for good (.reviews/round-1.md B1).
      if (capHandle !== undefined) {
        cancelCap(capHandle);
        capHandle = undefined;
      }
      void requestProjection(paneEvidence !== paneEvidenceApplied ? {} : { external: true, join: true });
      reconcileScan();
    }, EXTERNAL_SCAN_INTERVAL_MS);
  }

  function onPaneChange(): void {
    // Nothing to attribute a pane to yet; the first build projects for itself.
    if (disposed || !projector || !built) {
      return;
    }
    paneEvidence += 1;
    if (capHandle !== undefined) {
      return;
    }
    capHandle = armCap(() => {
      capHandle = undefined;
      void requestProjection();
    });
  }

  /**
   * Is there anything honest to send?
   *
   * `built` turns true when the first rebuild writes the cache, which is before
   * its projection can have committed. Delivering in that window paired the
   * live tree with a synthetic empty presence — every agent row missing, then
   * appearing a moment later (.reviews/round-3.md B1). A host with no projector
   * has no second half to wait for, so it is deliverable from its first build.
   */
  function deliverable(): boolean {
    return published !== undefined || !projector;
  }

  function currentMessage(): ExtensionToWebViewMessage {
    // Never the live cache: an uncommitted tree has no presence to pair with.
    const envelope = published ?? { tree: cache.read(), presence: presence() };
    return { type: "worktreeTreeResponse", tree: envelope.tree, presence: envelope.presence };
  }

  /**
   * Deliver to one surface, or skip it. The gate lives here alone so a broadcast
   * and a single-surface delivery cannot come to different answers about who may
   * receive a push.
   */
  function postTo(surface: WorktreeSurface, state: SurfaceState, message: ExtensionToWebViewMessage): boolean {
    if (!state.visible || !state.displayed || !surface.isReady()) {
      return false;
    }
    try {
      surface.post(message);
      return true;
    } catch (err) {
      console.warn(`${LOG_PREFIX} surface post threw — continuing broadcast`, err);
      return false;
    }
  }

  function broadcast(): void {
    if (disposed || !deliverable()) {
      return;
    }
    const message = currentMessage();
    for (const [surface, state] of surfaces) {
      postTo(surface, state, message);
    }
  }

  /**
   * Serve a surface that has just begun showing the view. Edge-triggered on both
   * facts together, so a repeated report from either one is a no-op, and served
   * from the cache: the watches ran while the surface was away, so a rebuild
   * would re-read git for what is already held — and would push it to everyone.
   *
   * `serveOnRise` is false for the webview's own declaration, which arrives with
   * a tree request behind it — serving that edge as well would post twice. The
   * window displaying a surface again is the edge with no requester, which is
   * the gap this exists to close.
   */
  function reconcileShowing(surface: WorktreeSurface, state: SurfaceState, serveOnRise: boolean): void {
    const showing = state.visible && state.displayed;
    if (showing === state.showing) {
      return;
    }
    if (!showing) {
      state.showing = false;
      return;
    }
    if (disposed || !serveOnRise) {
      state.showing = true;
      return;
    }
    if (!built) {
      // Nothing to serve yet; the build's own broadcast reaches this surface.
      state.showing = true;
      void gate.request(WHOLE_TREE_SCOPE, {});
      return;
    }
    if (!deliverable()) {
      // Built, but the first projection has not committed. The commit
      // broadcasts to every showing surface, and this one now is.
      state.showing = true;
      return;
    }
    // Recorded only once it actually reached the surface. A post that was
    // skipped as not-ready, or that threw, must not consume the edge — the next
    // report would find nothing to do and the surface would stay stale.
    state.showing = postTo(surface, state, currentMessage());
  }

  /**
   * One rebuild, then one push. Broadcasting from inside the gate's run — not
   * from each caller after awaiting — is what makes two concurrent requests
   * produce a single push rather than one each.
   */
  async function rebuild(scope: string): Promise<void> {
    if (disposed) {
      return;
    }
    if (scope === WHOLE_TREE_SCOPE) {
      cache.applyBuild(await buildWorktreeTreeDetailed(options.workspaceFolders(), discoveryDeps));
      built = true;
      treeVersion += 1;
      reconcileWatches();
    } else {
      const root = cache.rootFor(scope);
      if (root) {
        cache.applyRepo(scope, await listRepoWorktrees(root.rootPath, discoveryDeps), discoveryDeps.rank);
        treeVersion += 1;
      }
    }
    // Every authoritative rebuild is an observation of what still exists, and
    // D15 turns a confirmation off on exactly that observation. Doing it only
    // in the removal path left a token alive for a worktree deleted any other
    // way — by another window, or by hand (round-3 B5).
    options.actions?.reconcileFingerprints?.(worktreeIds());
    // The coordinator commits the envelope and publishes it — once.
    await requestProjection();
  }

  const gate = createRebuildGate(rebuild, options.clock);

  /**
   * Bring the watch set in line with the repositories the cache now holds. An
   * already-watched repository keeps its subscriptions, so neither a rebuild
   * nor a second surface creates another watcher.
   */
  function reconcileWatches(): void {
    const wanted = new Set(cache.roots().map((root) => root.repoId));
    for (const [repoId, watch] of watches) {
      if (!wanted.has(repoId)) {
        watch.dispose();
        watches.delete(repoId);
      }
    }
    for (const repoId of wanted) {
      if (!watches.has(repoId)) {
        watches.set(
          repoId,
          watchRepoStructure(repoId, options.pool, () => {
            // `signal`: git state moved, so a rebuild already running cannot
            // answer this one — it may have read git before the move.
            void gate.request(repoId, { signal: true });
          }),
        );
      }
    }
    for (const [repoId, watch] of watches) {
      // A rebuild just cleared this repo's `degraded`, and an unestablished
      // watch means the listing it produced can go stale unnoticed. Saying so
      // is the difference between a stale tree and a tree known to be stale.
      if (watch.failureReason !== undefined) {
        cache.applyRepo(repoId, {
          worktrees: [],
          reasons: [],
          skipped: 0,
          degraded: `This repository is not being watched, so its worktrees may be out of date: ${watch.failureReason}`,
        });
        // A cache write is a tree move, wherever it comes from. Delivery waits
        // for the projection that describes it.
        treeVersion += 1;
      }
    }
  }

  const paneSub = options.onPaneChange?.(onPaneChange);

  const folderSub = options.onDidChangeWorkspaceFolders?.(() => {
    // Forced: the folder set moved, so the cached tree is known wrong. The
    // floor bounds signal noise, not a change the user just made.
    void gate.request(WHOLE_TREE_SCOPE, { force: true });
  });

  function attach(surface: WorktreeSurface): WorktreeAttachment {
    surfaces.set(surface, { visible: false, displayed: false, showing: false });
    return {
      dispose: () => {
        surfaces.delete(surface);
        // Detaching is a falling edge too: the last showing surface going away
        // this way would otherwise leave the scan armed for the window's life.
        reconcileScan();
      },
      setDisplayed: (displayed: boolean) => {
        const state = surfaces.get(surface);
        if (state) {
          state.displayed = displayed;
          reconcileShowing(surface, state, true);
          reconcileScan();
        }
      },
    };
  }

  function handleMessage(surface: WorktreeSurface, msg: WebViewToExtensionMessage): void {
    const state = surfaces.get(surface);
    if (disposed || !state) {
      return;
    }
    switch (msg.type) {
      case "worktreeViewVisibility":
        state.visible = msg.visible;
        reconcileShowing(surface, state, false);
        reconcileScan();
        return;
      case "requestWorktreeSubagents":
        requestDelegations(msg.rowId, msg.entryId);
        return;
      case "worktreeOpenFolder":
      case "worktreeRevealInOS":
      case "worktreeCopyPath":
      case "worktreeOpenTerminal":
      case "worktreeFocusPane":
      case "worktreeOpenPreview":
      case "worktreeCopyResumeCommand":
      case "worktreeRevealAgentCwd":
      case "worktreeCopyAgentPath":
      case "worktreeCreate":
      case "worktreeRemove":
      case "worktreeLock":
      case "worktreeUnlock":
      case "worktreePrune":
      case "requestWorktreeCreateDefaults":
        handleAction(surface, msg);
        return;
      case "requestWorktreeTree":
        // Nothing to serve before the first build, whatever the caller asked for.
        if (msg.force === true || !built) {
          void gate.request(WHOLE_TREE_SCOPE, { force: msg.force === true });
          return;
        }
        if (!deliverable()) {
          // Built but never committed — wait for the missing half rather than
          // answering with a tree whose presence does not exist yet.
          ensureProjection();
          return;
        }
        broadcast();
        return;
      default:
        return;
    }
  }

  /** The repo record holding `worktreeId`, paired with the worktree itself. */
  function locate(worktreeId: string): { repo: WorktreeRepo; wt: WorktreeInfo } | null {
    for (const repo of cache.read().repos) {
      const wt = repo.worktrees.find((w) => w.id === worktreeId);
      if (wt) {
        return { repo, wt };
      }
    }
    return null;
  }

  return {
    // Folders are read here, not captured: a window that gained one since the
    // last init answers for the folder set the surface is booting against.
    initPayload: () => ({ worktreeHasRepo: hasGitRepo(options.workspaceFolders(), options.exists) }),
    attach,
    handleMessage,

    reportMutation: (report) => {
      if (disposed) {
        return;
      }
      // The OUTCOME goes back where it came from — the surface that raised the
      // dialog is the one holding the state that dialog left behind. The tree
      // itself still broadcasts to everyone, through the ordinary rebuild path,
      // because a worktree that vanished must vanish everywhere (D17).
      report.origin?.post(report.message);
      if (report.openTerminalAt !== undefined) {
        void report.origin?.openTerminal?.(report.openTerminalAt);
      }
    },

    mutationBindings: () => ({
      forceRebuild: async (repoId) => {
        await gate.request(repoId, { force: true });
      },
      resolve: (target) => {
        const found = locate(target.worktreeId);
        if (found === null || found.repo.repoId !== target.repoId) {
          return null;
        }
        return {
          repoPath: found.repo.mainPath,
          // git's own string, never the normalized id.
          worktreePath: found.wt.displayPath,
          // The head this registration is on. It is not a perfect incarnation
          // marker — a recreate onto the same commit repeats it — but it is the
          // strongest one a listing carries, and it is strictly better than the
          // path alone that B5 found (worktree-model.md).
          incarnation: `${found.wt.head ?? ""}:${found.wt.branch ?? ""}`,
          locked: found.wt.locked === true,
          wasRegistered: true,
          existedOnDisk: found.wt.missing !== true,
        };
      },
      repoPath: (repoId) => cache.read().repos.find((r) => r.repoId === repoId)?.mainPath ?? null,
      // Whether the listing behind the current tree can be relied on. The cache
      // retains the last-good repos when a rebuild fails, which is right for
      // rendering and wrong for judging what a removal did (round-2 B7).
      isDegraded: (repoId) => {
        const repo = cache.read().repos.find((r) => r.repoId === repoId);
        return repo === undefined || repo.degraded !== undefined;
      },
      createContext: (repoId) => {
        const repo = cache.read().repos.find((r) => r.repoId === repoId);
        if (repo === undefined) {
          return null;
        }
        return {
          mainWorktree: repo.mainPath,
          // LINKED only — a path inside main is where the default root lives.
          linkedWorktrees: repo.worktrees.filter((w) => w.id !== repo.mainPath).map((w) => w.id),
        };
      },
      assessRemoval: async (target) => {
        const found = locate(target.worktreeId);
        const facts = options.removalFacts;
        if (found === null || found.repo.repoId !== target.repoId || facts === undefined) {
          return null;
        }
        // Run in the worktree itself, not the repo: `--porcelain` is what names
        // the files a force would destroy, and that is per worktree.
        //
        // Not run at all when the directory is gone. Asking an absent cwd for
        // its status fails every time, which D16 correctly reported as
        // `unavailable` — permanently, on the one worktree state whose ONLY
        // remedy is the removal that prunes its registration (round-3 B8).
        const status = found.wt.missing
          ? null
          : await options.deps.runner.run(["status", "--porcelain"], found.wt.displayPath);
        const sessions = await facts.externalSessions();
        return evaluateRemoval({
          target: found.wt,
          siblings: found.repo.worktrees,
          panes: facts.panes(),
          rows: presence().rowsByWorktreeId[target.worktreeId] ?? [],
          // Every read that can fail is carried as a read, not as its benign
          // fallback. A failed status is not a clean worktree (round-2 B6).
          externalSessions: sessions,
          porcelain:
            status === null
              ? { ok: "notApplicable" }
              : status.code === 0 && !status.timedOut
                ? { ok: true, value: status.stdout.toString("utf8") }
                : { ok: false },
          // The cache keeps the last-good listing when a rebuild fails, which is
          // right for rendering and wrong for authorizing a delete.
          listingDegraded: found.repo.degraded !== undefined,
        });
      },
    }),
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      if (capHandle !== undefined) {
        cancelCap(capHandle);
        capHandle = undefined;
      }
      if (scanHandle !== undefined) {
        cancelCap(scanHandle);
        scanHandle = undefined;
      }
      gate.dispose();
      paneSub?.dispose();
      folderSub?.dispose();
      for (const watch of watches.values()) {
        watch.dispose();
      }
      watches.clear();
      surfaces.clear();
      // A read still in flight resolves into a disposed host; clearing here is
      // what makes that completion a no-op rather than a late publication.
      rosters.clear();
      rosterReads.clear();
    },
  };
}
