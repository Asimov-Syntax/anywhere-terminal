// src/providers/WorktreeHost.ts — The window's owner of worktree freshness.
// See: docs/design/worktree-rpc.md § 1, § 2,
//      asimov/changes/cache-and-broadcast-worktree-tree/design.md D1, D6, D7
//
// One host per window, constructed beside the watcher pool. Surfaces attach to
// it; attaching costs no git command and no watcher, so a second panel showing
// the same tree is free.

import type * as vscode from "vscode";
import type { ExtensionToWebViewMessage, WebViewToExtensionMessage } from "../types/messages";
import { hasGitRepo } from "../worktree/hasGitRepo";
import type { PresenceProjector } from "../worktree/presenceProjector";
import type { WorktreePresence } from "../worktree/presenceTypes";
import { createRebuildGate, type RebuildGateClock } from "../worktree/rebuildGate";
import { createWorktreeCache } from "../worktree/WorktreeCache";
import { buildWorktreeTreeDetailed, listRepoWorktrees, type WorktreeTreeDeps } from "../worktree/WorktreeDiscovery";
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
}

export interface WorktreeHostOptions {
  deps: WorktreeTreeDeps;
  /** Read at rebuild time, not captured: folders change while the window lives. */
  workspaceFolders(): readonly string[];
  pool: Pick<WatcherPool, "subscribePattern">;
  /** `vscode.workspace.onDidChangeWorkspaceFolders`, injected for testability. */
  onDidChangeWorkspaceFolders?(listener: () => void): vscode.Disposable;
  clock?: RebuildGateClock;
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

export interface WorktreeHost extends vscode.Disposable {
  /** Fields this host contributes to a surface's `init` message. */
  initPayload(): WorktreeInitPayload;
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
    published = { tree: cache.read(), presence: presence() };
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

  return {
    // Folders are read here, not captured: a window that gained one since the
    // last init answers for the folder set the surface is booting against.
    initPayload: () => ({ worktreeHasRepo: hasGitRepo(options.workspaceFolders(), options.exists) }),
    attach,
    handleMessage,
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
    },
  };
}
