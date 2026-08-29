// src/webview/worktree/WorktreeView.ts — The Worktree body: repo → worktree →
// agent → subagent, plus its states, notices, dialogs, and keyboard model.
// See: docs/design/worktree-panel-ui.md.
//
// This is the fourth segment's BODY, not a fourth grouping mode: a worktree with
// zero agents exists and is worth acting on, so it cannot be produced by bucketing
// already-loaded sessions (§ 2). The view therefore owns its own element and is
// swapped in beside the vault list rather than replacing it.
//
// Composition mirrors VaultPanel: pure builders live in worktreeTreeView.ts, the
// derivations in worktreeFormat.ts, and this class holds only the state the DOM
// cannot — collapse sets, the focused row, the query, and the render guard.

import { attachTooltipDelegate } from "../ui/Tooltip";
import { WorktreeContextMenu, type WorktreeMenuActions } from "./WorktreeContextMenu";
import { openWorktreeCreateDialog, type WorktreeCreateDialogDeps } from "./WorktreeCreateDialog";
import { openWorktreeLaunchDialog, type WorktreeLaunchRequest } from "./WorktreeLaunchDialog";
import { openWorktreePruneDialog, type PruneDialogDeps } from "./WorktreePruneDialog";
import { openWorktreeRemoveDialog, type WorktreeRemoveDialogDeps } from "./WorktreeRemoveDialog";
import {
  agentCountLabel,
  agentRowTitle,
  branchLabel,
  CONFIRMATION_CEILING_MS,
  groupPresenceByActivity,
  presentedActivity,
  strongestActivity,
} from "./worktreeFormat";
import { worktreeSignature } from "./worktreeRenderSignature";
import {
  confidenceHint,
  type NoticeSpec,
  renderAgentRow,
  renderAgentsHeader,
  renderIdleDisclosure,
  renderNotice,
  renderPresencePill,
  renderRefreshingMarker,
  renderRepoHeader,
  renderShowAll,
  renderSkeleton,
  renderSubagentSection,
  renderWorktreeRow,
  worktreeEmptyState,
} from "./worktreeTreeView";
import type {
  PresenceDegradation,
  WorktreeActionResult,
  WorktreeAgentRow,
  WorktreeInfo,
  WorktreeLaunchAgent,
  WorktreePresence,
  WorktreeRepo,
  WorktreeRowActivation,
  WorktreeSubagentRow,
  WorktreeTree,
} from "./worktreeViewTypes";

/** Worktrees rendered per repo before the cap offers "Show all" (§ 8). The cap
 *  exists so a repo with hundreds of worktrees does not stall the render; it is a
 *  visible affordance, never a silent truncation. */
export const MAX_WORKTREES_PER_REPO = 20;

/** Below this many agentless worktrees, a disclosure hides less than it costs (§ 3.6). */
export const IDLE_FOLD_THRESHOLD = 4;

/**
 * Namespaced so it can never collide with a repoId or a worktree id, both of which
 * share the same collapse set and are matched against the live tree.
 */
function idleTailKey(repoId: string): string {
  return `\u0000idle-tail:${repoId}`;
}

/** Every row kind that takes part in traversal. One string, because the roving tab
 *  stop, the level stamp and the focus delegate must agree on what a row IS. */
const NAV_ROWS = ".wt-repo, .wt-idle, .wt-row, .wt-arow, .wt-srow";

/**
 * One tab stop for the tree, and one more inside the row that owns it: a row's
 * own action control joins the tab order only while that row is the stop, so
 * tabbing from a focused row reaches its actions and tabbing again leaves.
 */
/** A repository that has been cloned but never branched out — one worktree, the main one. */
function isUnbranched(repo: WorktreeRepo): boolean {
  return repo.degraded === undefined && repo.worktrees.length === 1 && repo.worktrees[0]?.kind === "main";
}

function setRowTabStop(row: HTMLElement, isStop: boolean): void {
  row.tabIndex = isStop ? 0 : -1;
  for (const action of row.querySelectorAll<HTMLElement>(".wt-rowaction")) {
    action.tabIndex = isStop ? 0 : -1;
  }
}

/** setTimeout's delay is a signed 32-bit int; anything larger wraps and fires now. */
const MAX_TIMEOUT_MS = 2_147_483_647;

export interface WorktreeViewData {
  tree: WorktreeTree | null;
  presence: WorktreePresence | null;
  /** No tree has ever arrived — the skeleton state, not a spinner in a void. */
  loading?: boolean;
  /** A rebuild is in flight while a tree is already held — keep the tree. */
  refreshing?: boolean;
  /** True when the workspace has no folders at all. */
  noFolder?: boolean;
  /** Outcomes of mutating actions, attached to the row or repo they concern. */
  actionResults?: WorktreeActionResult[];
}

export interface WorktreeViewDeps {
  /** Panel element the dialogs and context menu are positioned within. */
  host: HTMLElement;
  /**
   * The row context menu. Absent → no menu is built and no row listens for one:
   * an action the view cannot perform is absent rather than present and inert.
   */
  actions?: WorktreeMenuActions;
  /**
   * What activating a window-scope row should do. A getter, because the setting
   * is live; absent → `focus`, the manifest default.
   */
  rowActivation?: () => WorktreeRowActivation;
  /** Activating an agent row — focus its pane, or open its preview (§ 6). */
  onActivateAgent?: (row: WorktreeAgentRow, activation: WorktreeRowActivation) => void;
  /** Activating a subagent row targets the PARENT's pane; it has none of its own. */
  onActivateSubagent?: (subagent: WorktreeSubagentRow, parent: WorktreeAgentRow) => void;
  /** Rebuild this repo's listing after a degraded result. */
  onRetryRepo?: (repoId: string) => void;
  /**
   * Open the create form on one repository. Absent → no header offers create:
   * an action the view cannot perform is absent rather than present and inert.
   */
  onCreateForRepo?: (repoId: string) => void;
  /** Drop an action notice the user dismissed. */
  onDismissActionResult?: (result: WorktreeActionResult) => void;
  /** Prune the repo after an indeterminate remove. */
  onPrune?: (repoId: string) => void;
  /** Re-send a remove with `force` and the fingerprint the user was shown. */
  onForceRemove?: (info: WorktreeInfo, fingerprint: string) => void;
  /**
   * Ask again for an action whose risk could not be READ. Offered only there:
   * a failure already has its answer, and an unclear outcome has state to
   * resolve first — re-running either would be guessing.
   */
  onRetryAction?: (result: WorktreeActionResult) => void;
  /** Seeds the create form; absent → the create affordance does nothing. */
  createDialogDeps?: () => Omit<WorktreeCreateDialogDeps, "onSubmit" | "onCancel">;
  onCreateSubmit?: WorktreeCreateDialogDeps["onSubmit"];
  /** What the launch dialog collected, for the worktree it was opened on. */
  onLaunchSubmit?: (request: WorktreeLaunchRequest) => void;
  /**
   * Collapsed repoIds + worktreeIds, restored on open (§ 2.1). `undefined` means
   * nothing was ever persisted, and is NOT the same as `[]` — an empty array is a
   * user who expanded everything, and seeding defaults over it would undo that.
   */
  getInitialCollapsed?: () => string[] | undefined;
  persistCollapsed?: (ids: string[]) => void;
  /**
   * Ask the host what this row's session delegated. Called on the first
   * expansion of each row+session and never again — the roster arrives on the
   * row itself, through the envelope that already carries presence.
   */
  onRequestSubagents?: (row: WorktreeAgentRow) => void;
  /** Expanded agent rowIds — the SECOND disclosure level, persisted separately. */
  getInitialExpandedRows?: () => string[];
  persistExpandedRows?: (ids: string[]) => void;
  getInitialIdleSeeded?: () => string[];
  persistIdleSeeded?: (ids: string[]) => void;
  /** Injected in tests so ages are deterministic. */
  now?: () => number;
}

/** The rows a roster actually delivered — nothing for unread, empty or failed. */
function delegatedRows(row: WorktreeAgentRow): readonly WorktreeSubagentRow[] {
  return row.delegations?.kind === "ok" ? row.delegations.rows : [];
}

/** One row's session, as the host keys its roster. Absent → nothing to ask for. */
function rosterKey(row: WorktreeAgentRow): string | undefined {
  return row.entryId === undefined ? undefined : `${row.rowId}\u0000${row.entryId}`;
}

export class WorktreeView {
  /** The scrollable tree. Appended into the panel body by the owner. */
  readonly element: HTMLElement;

  private readonly deps: WorktreeViewDeps;
  private readonly menu: WorktreeContextMenu | null;

  private data: WorktreeViewData = { tree: null, presence: null, loading: true };
  /** Armed only while some row can still cross the ceiling; cleared on disposal. */
  private ceilingTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private idleSeeded: Set<string>;
  private query = "";
  private signature: string | null = null;
  /** Repo/worktree ids whose children are hidden. */
  private collapsed: Set<string>;
  /** Agent rowIds whose subagents are shown. */
  private expandedRows: Set<string>;
  /** Worktree ids whose default collapse has already been decided once. */
  private readonly seeded: Set<string>;
  /** A persisted set was restored, so the first tree carries no defaults to seed. */
  private restored: boolean;
  /** Repos the user asked to see past the render cap. */
  private readonly uncapped = new Set<string>();
  private closeDialog: (() => void) | null = null;
  private readonly disposeTooltips: () => void;
  /** Roving tabindex target — the row keyboard navigation last landed on. */
  private focusedKey: string | null = null;
  /** repoId → the last node of that repository's section, so a result with no
   *  drawn row still lands with its repository. */
  private readonly repoAnchors = new Map<string, HTMLElement>();
  /**
   * Row+session pairs already asked for. Keyed by both, so re-expanding asks
   * nothing while a pane that started a NEW session asks again.
   */
  private readonly requestedRosters = new Set<string>();

  constructor(deps: WorktreeViewDeps) {
    this.deps = deps;
    const persisted = deps.getInitialCollapsed?.();
    this.collapsed = new Set(persisted ?? []);
    // A restored set already carries the user's own decisions — including the
    // expansions it records by omission — so nothing in the first tree is reseeded.
    // Presence of the array is the signal; its length says nothing.
    this.restored = persisted !== undefined;
    this.seeded = new Set(this.collapsed);
    this.expandedRows = new Set(deps.getInitialExpandedRows?.() ?? []);
    this.idleSeeded = new Set(deps.getInitialIdleSeeded?.() ?? []);
    this.element = document.createElement("div");
    this.element.className = "wt-tree";
    this.element.setAttribute("role", "tree");
    this.element.setAttribute("aria-label", "Worktrees");
    this.element.addEventListener("keydown", (ev) => this.onKeyDown(ev));
    // Focus retention was written only where the KEYBOARD moves focus, so a pointer
    // press — which focuses the row it lands on without `onKeyDown` running — left the
    // roving key naming some other row, and the re-render a click causes restored focus
    // there. Written here instead, where focus actually arrives, so every row kind is
    // covered at once rather than each toggle path remembering to update the key.
    this.element.addEventListener("focusin", (ev) => {
      const row = (ev.target as HTMLElement | null)?.closest<HTMLElement>(NAV_ROWS);
      if (row) {
        this.focusedKey = this.keyOf(row);
        // The stop moves with the focus, whatever brought it here. A row's action
        // control is only tabbable while its row holds the stop, so a pointer press
        // that skipped `focusRow` would otherwise leave the action unreachable by
        // the Tab that follows it.
        for (const other of this.navRows()) {
          setRowTabStop(other, other === row);
        }
      }
    });
    // Delegated, because render() replaces every row: rows carry `data-tip` and
    // nothing is attached or disposed per render.
    this.disposeTooltips = attachTooltipDelegate(this.element);
    this.menu = deps.actions
      ? new WorktreeContextMenu({
          host: deps.host,
          actions: deps.actions,
          // Supplied, not defaulted: the menu gates its Prune item on this, and
          // the default of `() => 0` meant the item could never render at all.
          // Only a walk from the rendered menu could see it (round-4 W11).
          prunableCount: (info) => this.repoOf(info)?.worktrees.filter((w) => w.prunable).length ?? 0,
        })
      : null;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** The repo holding `info`, from the tree this view last rendered. */
  private repoOf(info: WorktreeInfo): WorktreeRepo | undefined {
    return this.data.tree?.repos.find((r) => r.worktrees.some((w) => w.id === info.id));
  }

  /**
   * Push new data. Re-renders only when the signature moved (§ 6.1) — a spinner
   * frame alone must not repaint the tree and destroy scroll and expansion state.
   * `refreshing` and `loading` are render inputs, so they join the key.
   */
  setData(data: WorktreeViewData): void {
    // A discarded view accepts no further work. Before the ceiling timer this was
    // harmless — a push wrote into a detached element and stopped there — but a
    // push now PLANTS a timer, which would keep repainting a view nobody holds.
    if (this.disposed) {
      return;
    }
    this.data = data;
    this.applyAt(this.now());
  }

  /**
   * Render if anything moved, then schedule the next moment something can move
   * on its own.
   *
   * ONE reading of the clock serves all three of the signature, what it renders,
   * and the next deadline. Reading it again between them would let a row be drawn
   * against one moment and scheduled against another, which is how a crossing
   * gets skipped by a millisecond.
   */
  private applyAt(now: number): void {
    const { tree, presence, loading, refreshing, noFolder, actionResults } = this.data;
    const stateKey = [
      worktreeSignature(tree, presence, now),
      loading ? "1" : "0",
      refreshing ? "1" : "0",
      noFolder ? "1" : "0",
      (actionResults ?? [])
        .map(
          (r) =>
            // The blocker fingerprint is part of the key: it decides whether the
            // notice offers Force remove at all, and WHICH blocker set that
            // confirmation would authorize.
            `${r.action}:${r.worktreeId ?? r.repoId ?? ""}:${r.orphanedLabel ?? ""}:${r.outcome}:${r.openFailed ?? ""}:${r.error ?? ""}${r.observed ?? ""}:${r.needsConfirm?.fingerprint ?? ""}`,
        )
        .join("|"),
    ].join(String.fromCharCode(4));
    if (stateKey !== this.signature) {
      this.signature = stateKey;
      // Expansion state for a worktree that disappeared is dropped, not resurrected.
      this.pruneStaleState(this.data);
      this.render(now);
    }
    this.armCeiling(now);
  }

  /**
   * A repaint forced by an interaction rather than by data — collapsing a repo,
   * lifting the display cap, expanding a row. `applyAt` cannot serve these: the
   * signature covers the DATA, and none of this moves it, so the render would be
   * skipped. Still one reading of the clock, and still re-armed, because what is
   * drawn is what can cross.
   */
  private repaint(): void {
    // `dispose()` tears down the tooltip delegates, so a rebuild after it produces
    // a tree whose hints are permanently dead — a half-live view is worse than a
    // stale one. Guarding only the arming left the DOM work happening anyway.
    if (this.disposed) {
      return;
    }
    const now = this.now();
    this.render(now);
    this.armCeiling(now);
  }

  /**
   * One deadline timer at the earliest crossing — never an interval, and no timer
   * at all when no row can cross. Re-armed after it fires as well as on every
   * push, or a second crossing behind the first would never be drawn.
   */
  private armCeiling(now: number): void {
    if (this.ceilingTimer !== undefined) {
      clearTimeout(this.ceilingTimer);
      this.ceilingTimer = undefined;
    }
    // Guarding `setData` alone left `repaint()` — every interaction handler still
    // bound to live DOM — free to plant one after disposal. This is the single
    // place a timer is created, so it is the only place the check holds.
    if (this.disposed) {
      return;
    }
    const at = this.nextCeilingCrossing(now);
    if (at === undefined) {
      return;
    }
    this.ceilingTimer = setTimeout(
      () => {
        this.ceilingTimer = undefined;
        this.applyAt(this.now());
      },
      // Clamped, because a `stateStartedAt` in the future is CONFIRMED — an
      // impossible clock must not manufacture staleness — which is exactly what
      // makes such a row an accepted crossing candidate. Unbounded, `at - now`
      // overflows setTimeout's 32-bit delay past ~24.8 days and fires at once,
      // re-deriving the same crossing and re-arming: a tight loop. Clamping ends
      // it — the wake-up re-derives and arms the remainder, which terminates.
      Math.min(Math.max(0, at - now), MAX_TIMEOUT_MS),
    );
  }

  /**
   * When the earliest still-confirmed claim will outlive its evidence, or
   * undefined if none can. A row already presented as something else — crossed,
   * or `unknown` because its source failed — has nothing left to cross.
   */
  private nextCeilingCrossing(now: number): number | undefined {
    const degraded = this.degradedSources();
    // Scoped to what is drawn. `render` opens with `replaceChildren()`, so waking
    // for a row behind a collapsed repo, a filtered-out worktree, or one past the
    // display cap would tear the whole list down to change nothing a user can see.
    const drawn = this.renderedWorktreeIds();
    let soonest: number | undefined;
    for (const [worktreeId, rows] of Object.entries(this.data.presence?.rowsByWorktreeId ?? {})) {
      if (!drawn.has(worktreeId)) {
        continue;
      }
      for (const row of rows) {
        if (row.stateStartedAt === undefined || presentedActivity(row, degraded, now) !== "running") {
          continue;
        }
        if (row.activitySource !== "output") {
          continue;
        }
        const at = row.stateStartedAt + CONFIRMATION_CEILING_MS;
        if (at > now && (soonest === undefined || at < soonest)) {
          soonest = at;
        }
      }
    }
    return soonest;
  }

  /** Filter the tree by branch, path, and agent title. Ancestors of a match stay. */
  setQuery(query: string): void {
    const next = query.trim().toLowerCase();
    if (next === this.query) {
      return;
    }
    this.query = next;
    this.repaint();
  }

  /** Open the create form over the panel. No-op without `createDialogDeps`. */
  openCreateDialog(initialRepoId?: string): void {
    const seed = this.deps.createDialogDeps?.();
    if (!seed || seed.repos.length === 0) {
      return;
    }
    this.closeDialog?.();
    this.closeDialog = openWorktreeCreateDialog(this.deps.host, {
      ...seed,
      initialRepoId: initialRepoId ?? seed.initialRepoId,
      onSubmit: (draft) => {
        this.closeDialog = null;
        this.deps.onCreateSubmit?.(draft);
      },
      onCancel: () => {
        this.closeDialog = null;
      },
    });
  }

  /**
   * Open the launch dialog over the panel. No-op without agents to offer — the
   * menu item is absent in that case too; this is the same rule at the second
   * door.
   */
  openLaunchDialog(worktreeLabel: string, agents: readonly WorktreeLaunchAgent[]): void {
    if (agents.length === 0) {
      return;
    }
    this.closeDialog?.();
    // Tracked like every other modal here: an untracked one stays mounted under
    // the next dialog, holding a focus trap and a document listener nothing
    // will ever release.
    this.closeDialog = openWorktreeLaunchDialog(this.deps.host, {
      worktreeLabel,
      agents,
      onConfirm: (request) => {
        this.closeDialog = null;
        this.deps.onLaunchSubmit?.(request);
      },
      onCancel: () => {
        this.closeDialog = null;
      },
    });
  }

  /** Open the prune confirmation. The count is the host's; the panel never guesses it. */
  openPruneDialog(args: Omit<PruneDialogDeps, "onConfirm" | "onCancel">, onConfirm: (count: number) => void): void {
    this.closeDialog?.();
    openWorktreePruneDialog(this.deps.host, {
      ...args,
      onConfirm: (count) => {
        this.closeDialog = null;
        onConfirm(count);
      },
      onCancel: () => {
        this.closeDialog = null;
      },
    });
  }

  /** Open the remove confirmation — or its refusal, when nothing can authorize it. */
  openRemoveDialog(args: Omit<WorktreeRemoveDialogDeps, "onConfirm" | "onCancel" | "now">): void {
    this.closeDialog?.();
    this.closeDialog = openWorktreeRemoveDialog(this.deps.host, {
      ...args,
      now: this.now(),
      onConfirm: (fingerprint) => {
        this.closeDialog = null;
        this.deps.onForceRemove?.(args.info, fingerprint);
      },
      onCancel: () => {
        this.closeDialog = null;
      },
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.ceilingTimer !== undefined) {
      clearTimeout(this.ceilingTimer);
      this.ceilingTimer = undefined;
    }
    this.closeDialog?.();
    this.closeDialog = null;
    this.menu?.close();
    this.disposeTooltips();
  }

  // -- State ---------------------------------------------------------------

  private rowsFor(worktreeId: string): WorktreeAgentRow[] {
    return this.data.presence?.rowsByWorktreeId[worktreeId] ?? [];
  }

  /**
   * The presence sources currently failing, which is what turns a row's state
   * into `unknown` (§ 7.2). A repo's own `degraded` flag is deliberately not
   * here: it says the worktree listing failed, not that any agent is unreadable.
   */
  private degradedSources(): readonly PresenceDegradation[] {
    return this.data.presence?.degradedSources ?? [];
  }

  /**
   * The two disclosure levels are independent (§ 3.5): collapsing a worktree does
   * not clear any agent row's own expansion, and each persists separately.
   */
  private toggleCollapsed(id: string): void {
    this.toggleKey(id);
  }

  /** The one place a collapse key flips, so persistence and repaint cannot diverge
   *  between the row kinds that share the set. */
  private toggleKey(key: string): void {
    if (this.collapsed.has(key)) {
      this.collapsed.delete(key);
    } else {
      this.collapsed.add(key);
    }
    this.deps.persistCollapsed?.([...this.collapsed]);
    this.repaint();
  }

  /**
   * What this row's activation does. The setting is consulted for window rows
   * only: an external row has no pane in this window to focus, so `preview` is
   * not the setting being overridden — the setting is never read (design.md D5).
   */
  private activationFor(row: WorktreeAgentRow): WorktreeRowActivation {
    if (row.scope === "external") {
      return "preview";
    }
    // A window row with no vault entry has no preview to open, so `preview`
    // would be a dead click; its pane is the one thing it always has (B3).
    if (row.entryId === undefined) {
      return "focus";
    }
    return this.deps.rowActivation?.() ?? "focus";
  }

  /** At most one request per row per session, whoever expanded it. */
  private requestSubagents(row: WorktreeAgentRow): void {
    const key = rosterKey(row);
    if (key === undefined || this.requestedRosters.has(key)) {
      return;
    }
    this.requestedRosters.add(key);
    this.deps.onRequestSubagents?.(row);
  }

  private toggleRow(rowId: string): void {
    if (this.expandedRows.has(rowId)) {
      this.expandedRows.delete(rowId);
    } else {
      this.expandedRows.add(rowId);
    }
    this.deps.persistExpandedRows?.([...this.expandedRows]);
    this.repaint();
  }

  /** The set is a real collapsed set, so this is the whole rule. */
  private isExpanded(info: WorktreeInfo): boolean {
    return !this.collapsed.has(info.id);
  }

  /**
   * Reconcile persisted state with the tree that just arrived:
   *
   *  - ids that no longer exist are dropped, so a removed worktree's expansion is
   *    not resurrected if its path is ever reused;
   *  - a worktree seen for the FIRST time is collapsed unless it is a workspace
   *    folder. Scanning many worktrees is the default posture; the one you are
   *    working inside is the exception. Seeding once (rather than deriving the
   *    default on every render) is what keeps `collapsed` a set the user's own
   *    toggles can move in both directions.
   */
  private pruneStaleState(data: WorktreeViewData): void {
    if (!data.tree) {
      return;
    }
    const liveIds = new Set<string>();
    const liveRowIds = new Set<string>();
    const liveRosterKeys = new Set<string>();
    const sessionRowIds = new Set<string>();
    const collapsed = new Set<string>();
    const before = [...this.collapsed].join("\0");
    const seededBefore = [...this.idleSeeded].join("\0");
    for (const repo of data.tree.repos) {
      liveIds.add(repo.repoId);
      if (this.collapsed.has(repo.repoId)) {
        collapsed.add(repo.repoId);
      }
      // The fold key is namespaced, so it survives a rebuild that only recognises
      // live repo and worktree ids — without this the tail would silently unfold
      // on every push.
      const tailKey = idleTailKey(repo.repoId);
      const idleCount = repo.worktrees.filter((w) => this.isIdleIn(data, w)).length;
      if (this.idleSeeded.has(repo.repoId)) {
        if (this.collapsed.has(tailKey)) {
          collapsed.add(tailKey);
        }
      } else if (idleCount >= IDLE_FOLD_THRESHOLD) {
        // First time this repo has had a tail to present: default it folded, and
        // record that it HAS been presented. Seeding on the repo rather than on
        // the first push matters — a repo that gains its fourth idle worktree
        // later must still meet the tail folded.
        this.idleSeeded.add(repo.repoId);
        collapsed.add(tailKey);
      }
      for (const wt of repo.worktrees) {
        liveIds.add(wt.id);
        const seen = this.seeded.has(wt.id) || this.restored;
        this.seeded.add(wt.id);
        if (seen ? this.collapsed.has(wt.id) : !wt.inWorkspace) {
          collapsed.add(wt.id);
        }
        for (const row of data.presence?.rowsByWorktreeId[wt.id] ?? []) {
          liveRowIds.add(row.rowId);
          const key = rosterKey(row);
          if (key !== undefined) {
            liveRosterKeys.add(key);
            sessionRowIds.add(row.rowId);
          }
        }
      }
    }
    this.restored = false;
    for (const id of this.seeded) {
      if (!liveIds.has(id)) {
        this.seeded.delete(id);
      }
    }
    this.collapsed = collapsed;
    if ([...collapsed].join("\0") !== before) {
      this.deps.persistCollapsed?.([...collapsed]);
    }
    for (const id of this.idleSeeded) {
      if (!liveIds.has(id)) {
        this.idleSeeded.delete(id);
      }
    }
    if ([...this.idleSeeded].join("\0") !== seededBefore) {
      this.deps.persistIdleSeeded?.([...this.idleSeeded]);
    }
    // Reconciled against the identities presence actually carries, never
    // accumulated — the same rule the host applies at the other end (D3, D14).
    // A row that lost its session keeps no expansion: the disclosure that would
    // collapse it is offered by the session, so the state would be unreachable.
    const expanded = [...this.expandedRows].filter((id) => liveRowIds.has(id) && sessionRowIds.has(id));
    if (expanded.length !== this.expandedRows.size) {
      this.expandedRows = new Set(expanded);
      this.deps.persistExpandedRows?.(expanded);
    }
    // Dropping the asked-key is what lets a row that left and returned under the
    // same identity ask again — the host evicted its roster, so a view that
    // remembers asking leaves the row on "Reading…" with nothing coming.
    for (const key of this.requestedRosters) {
      if (!liveRosterKeys.has(key)) {
        this.requestedRosters.delete(key);
      }
    }
  }

  // -- Search --------------------------------------------------------------

  /** A worktree survives the filter on its own text, or because a descendant matched. */
  private matches(info: WorktreeInfo): boolean {
    if (!this.query) {
      return true;
    }
    const q = this.query;
    if (branchLabel(info).text.toLowerCase().includes(q) || info.displayPath.toLowerCase().includes(q)) {
      return true;
    }
    return this.rowsFor(info.id).some(
      (row) =>
        agentRowTitle(row).toLowerCase().includes(q) ||
        (row.preview ?? "").toLowerCase().includes(q) ||
        delegatedRows(row).some((s) => `${s.name} ${s.title ?? ""}`.toLowerCase().includes(q)),
    );
  }

  // -- Render --------------------------------------------------------------

  private render(now: number): void {
    const scrollTop = this.element.scrollTop;
    // `renderListing` keeps its early exits — a skeleton and an empty state have
    // no tree to lay out — but placement must not sit behind any of them, so it
    // runs here, once, on every path.
    const restoreFocusTo = this.renderListing(now);
    this.placeResults();
    if (restoreFocusTo === undefined) {
      return;
    }
    this.element.scrollTop = scrollTop;
    this.syncRovingTabindex();
    if (restoreFocusTo !== null) {
      this.navRows()
        .find((r) => this.keyOf(r) === restoreFocusTo)
        ?.focus();
    }
  }

  /**
   * Draws the tree. Returns the focus key to restore, or `undefined` when there was
   * no tree to lay out. Returned rather than parked on the instance so the key
   * belongs to the render that computed it.
   *
   * This does NOT make the render re-entrant. `renderWorktree` asks for subagent
   * rosters from inside the repo loop, and a dep that answered synchronously would
   * re-enter here, replace the half-built DOM and place every notice twice —
   * `repoAnchors` and `placeResults` are both unguarded against that. The shipped
   * host answers over `postMessage`, so nothing reaches it today; a synchronous
   * answer would need a guard, not just this return value.
   */
  private renderListing(now: number): string | null | undefined {
    // `replaceChildren` detaches the focused row, and focus falls to <body> — a
    // keyboard user loses their place on every disclosure toggle. Restored below
    // by key, which is why subagent rows had to gain one.
    const restoreFocusTo = this.element.contains(document.activeElement) ? this.focusedKey : null;
    // Cleared with the DOM it describes, never later: every anchor in it points at
    // a node this call is about to detach, and `placeResults` runs on paths that
    // never reach the repo loop. An anchor map outliving its nodes is a drawing
    // artifact deciding what gets reported — the exact coupling this change removes.
    this.repoAnchors.clear();
    this.element.replaceChildren();
    const { tree, presence, loading, refreshing, noFolder } = this.data;

    if (loading && !tree) {
      this.element.setAttribute("aria-busy", "true");
      this.element.appendChild(renderSkeleton());
      return undefined;
    }
    this.element.removeAttribute("aria-busy");

    if (noFolder) {
      this.element.appendChild(worktreeEmptyState("noFolder"));
      return undefined;
    }
    // Only when nothing was retained: an unusable git with a last good listing
    // is a stale tree, not an empty one, and hiding it behind this state was
    // what made the cache's retention invisible.
    if (tree && !tree.gitAvailable && tree.repos.length === 0) {
      this.element.appendChild(worktreeEmptyState("gitMissing"));
      return undefined;
    }
    if (!tree || tree.repos.length === 0) {
      this.element.appendChild(worktreeEmptyState("noRepo"));
      return undefined;
    }

    // A refresh that already holds a tree keeps it and marks itself quietly (§ 5).
    if (refreshing) {
      this.element.appendChild(renderRefreshingMarker());
    }

    // Staleness the user did not cause is a status, not an alert: nothing here
    // needs acting on, and the tree below it is still worth reading.
    if (!tree.gitAvailable) {
      this.element.appendChild(
        renderNotice({
          tone: "warn",
          live: "status",
          title: "Git is unavailable.",
          body: "Showing the last known worktrees.",
          reason: tree.unreadable.reasons.join("\n"),
        }),
      );
    }

    // Presence sources that failed are named on the whole tree — they are not
    // scoped to one repo. An EMPTY result that is genuinely empty is not degraded
    // and gets no affordance at all (§ 4.5).
    for (const degradation of presence?.degradedSources ?? []) {
      this.element.appendChild(
        renderNotice({
          tone: "warn",
          title: "Agent list may be stale.",
          reason: `${degradation.source}: ${degradation.reason}`,
        }),
      );
    }
    // Suppressed while git is unavailable: the notice above already carries
    // every reason, and saying it twice reads as two separate problems.
    if (tree.gitAvailable && tree.unreadable.count > 0) {
      this.element.appendChild(
        renderNotice({
          tone: "warn",
          // `count` is occurrences and `reasons` is deduplicated for display, so
          // the two numbers deliberately differ and each is shown as what it is.
          title: `${tree.unreadable.count} path${tree.unreadable.count === 1 ? "" : "s"} could not be read.`,
          reason: tree.unreadable.reasons.join("\n"),
        }),
      );
    }

    // A group header per repo, but ONLY when the tree holds more than one (§ 3.1).
    const multiRepo = tree.repos.length > 1;
    let rendered = 0;
    for (const repo of tree.repos) {
      // Where this repo's section ends, so a repo-scoped result still lands with
      // its repository. Recorded here rather than inside `renderRepo` because that
      // method has an early return of its own, and an anchor missing for exactly
      // the collapsed case is how the collapsed hole opened.
      const before = this.element.childElementCount;
      rendered += this.renderRepo(repo, multiRepo, now);
      const last = this.element.lastElementChild;
      // ONLY when this repository actually drew something. A filter can empty one
      // entirely, and then the last element belongs to the repository before it —
      // a repo-scoped notice carries no name, so nothing on screen would contradict
      // the wrong attribution.
      if (this.element.childElementCount > before && last instanceof HTMLElement) {
        this.repoAnchors.set(repo.repoId, last);
      }
    }
    if (rendered === 0 && this.query) {
      this.element.appendChild(worktreeEmptyState("noMatch"));
    }
    this.stampLevels(multiRepo);
    return restoreFocusTo;
  }

  /**
   * The worktrees this repo draws: none when it is collapsed, otherwise the
   * matching ones up to the display cap.
   */
  private shownWorktrees(repo: WorktreeRepo, multiRepo: boolean): WorktreeInfo[] {
    if (multiRepo && this.collapsed.has(repo.repoId)) {
      return [];
    }
    // Filter, then partition, then cap — in that order, so the cap's affordance
    // keeps reporting only what the CAP excluded and the fold only ever counts
    // rows the cap admitted. Neither ends up describing the other's rows.
    const visible = repo.worktrees.filter((w) => this.matches(w));
    const ordered = [...visible.filter((w) => !this.isIdle(w)), ...visible.filter((w) => this.isIdle(w))];
    return this.uncapped.has(repo.repoId) ? ordered : ordered.slice(0, MAX_WORKTREES_PER_REPO);
  }

  /**
   * A POSITIVE determination that a worktree holds no agents — never a bare
   * `rows.length === 0`. There are three states, not two: has agents, has none,
   * and cannot be read. Collapsing the third into the second folds away exactly
   * the worktrees the degradation marker exists to surface.
   *
   * `PresenceDegradation` carries no repository or worktree attribution, so one
   * failed source suppresses folding everywhere. That is the honest reading of
   * the data rather than a shortcut.
   */
  private isIdle(info: WorktreeInfo): boolean {
    return this.isIdleIn(this.data, info);
  }

  /** Against a supplied envelope, because `pruneStaleState` runs on the incoming one. */
  private isIdleIn(data: WorktreeViewData, info: WorktreeInfo): boolean {
    const presence = data.presence;
    if (!presence || presence.degradedSources.length > 0) {
      return false;
    }
    return (presence.rowsByWorktreeId[info.id] ?? []).length === 0;
  }

  private toggleIdleTail(repoId: string): void {
    // A filter REVEALS the tail; it does not re-decide it. `idleTailFolded` already
    // returns false while a query is up, so the rendered state here is the query's
    // and not the user's — flipping against the stored state would spend a choice
    // the user never made on this render.
    //
    // Nothing rendered can reach this any more: since W5 no disclosure is drawn while
    // a query reveals the tail, so no click arrives to guard. Kept because the reveal
    // rule and this one are the same rule, and a later render that puts the disclosure
    // back on screen under a filter would otherwise silently spend the fold — the
    // failure it protects against leaves no trace, only a fold the user did not choose.
    if (this.query) {
      return;
    }
    this.toggleKey(idleTailKey(repoId));
  }

  /** Whether this repo's tail is folded right now — a live filter reveals it. */
  private idleTailFolded(repoId: string): boolean {
    if (this.query) {
      return false;
    }
    return this.collapsed.has(idleTailKey(repoId));
  }

  /**
   * What the worktree row's own glyph is qualified BY: the hint belonging to the
   * first agent row presented as the state the worktree is showing. Undefined when
   * that state needs no qualification.
   */
  private strongestConfidenceTip(rows: readonly WorktreeAgentRow[], now: number): string | undefined {
    const degraded = this.degradedSources();
    const strongest = strongestActivity(rows, degraded, now);
    if (strongest !== "running-unconfirmed" && strongest !== "unknown") {
      return undefined;
    }
    // The LONGEST-standing match, not the first: `rowsByWorktreeId` order is not a
    // contract, and taking whichever came first made the collapsed worktree's
    // elapsed figure depend on it. The oldest claim is also the truthful bound —
    // it is the one that has stood unchanged the longest.
    let source: WorktreeAgentRow | undefined;
    for (const row of rows) {
      if (presentedActivity(row, degraded, now) !== strongest) {
        continue;
      }
      if (
        source === undefined ||
        (row.stateStartedAt ?? Number.POSITIVE_INFINITY) < (source.stateStartedAt ?? Number.POSITIVE_INFINITY)
      ) {
        source = row;
      }
    }
    return source ? confidenceHint(source, strongest, now) : undefined;
  }

  /**
   * Every worktree id currently on screen, read back OUT OF THE DOM rather than
   * re-derived. `armCeiling` always runs after `render`, so the rows are already
   * there to be counted.
   *
   * The previous version restated the render's own predicate, and the restatement
   * drifted twice: once on `gitAvailable`, which drew a retained listing no
   * crossing could repaint, and once on `noFolder`. There is no third term to miss
   * — a row is here because it was drawn, which is the actual question.
   */
  private renderedWorktreeIds(): Set<string> {
    return new Set(this.renderedWorktreeRows().keys());
  }

  /** The drawn rows by worktree id. One implementation behind both the ceiling
   *  scheduler and result placement — two copies of this selector drifted twice
   *  before. They still scan separately, at the different moments each needs. */
  private renderedWorktreeRows(): Map<string, HTMLElement> {
    const rows = new Map<string, HTMLElement>();
    for (const el of this.element.querySelectorAll<HTMLElement>("[data-worktree-id]")) {
      const id = el.dataset.worktreeId;
      if (id !== undefined && !rows.has(id)) {
        rows.set(id, el);
      }
    }
    return rows;
  }

  /** Returns how many worktree rows this repo contributed (0 → filtered away). */
  private renderRepo(repo: WorktreeRepo, multiRepo: boolean, now: number): number {
    const visible = repo.worktrees.filter((w) => this.matches(w));
    if (visible.length === 0 && !repo.degraded) {
      return 0;
    }
    // Only a rendered header can reopen a repo, so a single repo is never honoured
    // as collapsed — a persisted id from a two-repo session would otherwise blank
    // the view with no control to recover it.
    const collapsed = multiRepo && this.collapsed.has(repo.repoId);
    if (multiRepo) {
      this.element.appendChild(
        renderRepoHeader(
          repo,
          visible.length,
          collapsed,
          () => this.toggleCollapsed(repo.repoId),
          this.deps.onCreateForRepo ? () => this.deps.onCreateForRepo?.(repo.repoId) : undefined,
        ),
      );
    }
    if (collapsed) {
      return visible.length;
    }

    // Degraded is scoped to the repo that failed, and names the source and reason.
    if (repo.degraded) {
      this.element.appendChild(
        renderNotice({
          tone: "warn",
          title: "Worktree list may be stale.",
          reason: repo.degraded,
          actions: this.deps.onRetryRepo
            ? [{ label: "Retry", onClick: () => this.deps.onRetryRepo?.(repo.repoId) }]
            : undefined,
        }),
      );
    }

    const shown = this.shownWorktrees(repo, multiRepo);
    const tail = shown.filter((w) => this.isIdle(w));
    // A filter reveals the tail, so there is nothing left for a disclosure to
    // disclose — and one that hides zero rows is not merely useless, it is a trap:
    // `expandOrDescend` treats any row carrying `aria-expanded` as expandable, so
    // Left enters the toggle branch and returns before `parentOf` ever runs. The
    // row cannot be left. Not rendering it is what keeps the tail climbable.
    const folds = tail.length >= IDLE_FOLD_THRESHOLD && !this.query;
    const folded = folds && this.idleTailFolded(repo.repoId);
    for (const info of shown) {
      if (folds && this.isIdle(info)) {
        continue;
      }
      this.renderWorktree(info, now, false);
    }
    if (folds) {
      this.element.appendChild(
        renderIdleDisclosure(repo.repoId, tail.length, folded, () => this.toggleIdleTail(repo.repoId)),
        // levels are stamped after the whole tree is drawn — see `stampLevels`.
      );
      if (!folded) {
        for (const info of tail) {
          // Notices travel with the row they concern wherever it is drawn: a
          // worktree does not stop reporting what an action did to it because
          // it happens to be quiet enough to sit under the disclosure.
          this.renderWorktree(info, now, true);
        }
      }
    }
    // Read off the REPOSITORY, never off what got drawn. A degraded listing
    // carries zero worktrees, and a filter, the cap, and the fold each reduce the
    // rows without saying anything about what the repository holds — deciding
    // from visible rows would call four different things unbranched.
    if (isUnbranched(repo)) {
      this.element.appendChild(
        worktreeEmptyState(
          "unbranched",
          this.deps.onCreateForRepo ? () => this.deps.onCreateForRepo?.(repo.repoId) : undefined,
        ),
      );
    }
    if (shown.length < visible.length) {
      this.element.appendChild(
        renderShowAll(visible.length, () => {
          this.uncapped.add(repo.repoId);
          this.repaint();
        }),
      );
    }
    return visible.length;
  }

  private renderWorktree(info: WorktreeInfo, now: number, inTail = false): void {
    const rows = this.rowsFor(info.id);
    const expanded = rows.length > 0 && this.isExpanded(info);
    // The card wraps the branch row together with its agent rows, so ownership
    // stays legible when several worktrees are expanded at once (§ 7.3).
    const container = expanded ? document.createElement("div") : this.element;
    if (expanded) {
      container.className = "wt-card";
      container.setAttribute("role", "none");
      this.element.appendChild(container);
    }

    container.appendChild(
      renderWorktreeRow(
        info,
        {
          activity: strongestActivity(rows, this.degradedSources(), now),
          // While collapsed this row IS the row: the pill below it is `aria-hidden`
          // with `tabIndex = -1` and is not in the arrow-key set, so a keyboard
          // user meets only this. A qualified glyph here without its qualification
          // is the claim without the caveat.
          confidenceTip: this.strongestConfidenceTip(rows, now),
          hasAgents: rows.length > 0,
          idle: this.isIdle(info),
          inTail,
          expanded,
          agentSummary: rows.length > 0 ? agentCountLabel(rows.length) : undefined,
        },
        {
          onActivate: () => {
            if (rows.length > 0) {
              this.toggleCollapsed(info.id);
            }
          },
          onContextMenu: this.menu ? (i, ev, row) => this.menu?.openForWorktree(i, ev, row) : undefined,
          // Same rule as the menu's: an affordance whose capability was not
          // supplied is absent, not present and inert (design.md D10).
          onOpenFolder: this.deps.actions?.openFolderInNewWindow
            ? (i) => this.deps.actions?.openFolderInNewWindow?.(i)
            : undefined,
        },
      ),
    );

    if (rows.length === 0) {
      return;
    }
    if (!expanded) {
      container.appendChild(
        renderPresencePill(groupPresenceByActivity(rows, this.degradedSources(), now), () =>
          this.toggleCollapsed(info.id),
        ),
      );
      return;
    }

    container.appendChild(renderAgentsHeader(rows.length, () => this.toggleCollapsed(info.id)));
    for (const row of rows) {
      const rowExpanded = this.expandedRows.has(row.rowId);
      if (rowExpanded) {
        // Asked from the render rather than the click, so a row restored into
        // the expanded set on open asks too — otherwise it would sit on
        // "Reading…" forever, having never been toggled.
        this.requestSubagents(row);
      }
      container.appendChild(
        renderAgentRow(
          row,
          {
            activity: presentedActivity(row, this.degradedSources(), now),
            expanded: rowExpanded,
            now,
          },
          {
            onActivate: (r) => this.deps.onActivateAgent?.(r, this.activationFor(r)),
            onContextMenu: this.menu ? (r, ev, el) => this.menu?.openForAgent(r, ev, el) : undefined,
            onToggleSubagents: (r) => this.toggleRow(r.rowId),
          },
        ),
      );
      // Always a section while the row is expanded: rendering nothing until
      // rows exist is the same picture as a session that delegated nothing
      // (design.md D10).
      if (rowExpanded) {
        container.appendChild(
          renderSubagentSection(
            row.delegations,
            row,
            (sub, parent) => this.deps.onActivateSubagent?.(sub, parent),
            now,
          ),
        );
      }
    }
  }

  /**
   * The ONE place a result becomes a notice. Deliberately blind to every display
   * rule: it asks the DOM which rows were actually drawn rather than re-deciding
   * what `shownWorktrees` decided. Three earlier attempts each put this judgement
   * inside a branch that decides what to DRAW — the lead loop, the folded tail,
   * the cap — and each left a different hole. A rule added later cannot open a
   * new one here, because this pass never learns the rules exist.
   */
  private placeResults(): void {
    const results = this.data.actionResults ?? [];
    if (results.length === 0) {
      return;
    }
    const drawn = this.renderedWorktreeRows();
    // Several results can share one anchor, so each insert walks the cursor
    // forward; appending them all `after` the same node would reverse them.
    const cursors = new Map<HTMLElement, HTMLElement>();
    for (const result of results) {
      const row = result.worktreeId === undefined ? undefined : drawn.get(result.worktreeId);
      const info = result.worktreeId === undefined ? undefined : this.infoFor(result.worktreeId);
      // A drawn row already says which worktree this is about, directly above.
      const notice = this.buildActionNotice(result, info, row ? undefined : this.nameFor(result, info));
      const anchor = row ? this.groupEndFor(row) : this.repoAnchorFor(result, info);
      // Unreachable as written — the map is cleared with the DOM, so every anchor in
      // it was recorded after that same `replaceChildren`. Kept because `after()` on
      // a detached node is a SILENT no-op: this turns a future regression into a
      // notice in the wrong place rather than no notice at all, which is the one
      // outcome this pass exists to prevent.
      if (anchor === undefined || !this.element.contains(anchor)) {
        this.element.appendChild(notice);
        continue;
      }
      const at = cursors.get(anchor) ?? anchor;
      at.after(notice);
      cursors.set(anchor, notice);
    }
  }

  /** The last node belonging to a row: its card when expanded, else its pill. */
  private groupEndFor(row: HTMLElement): HTMLElement {
    const card = row.closest<HTMLElement>(".wt-card");
    if (card) {
      return card;
    }
    const next = row.nextElementSibling;
    return next instanceof HTMLElement && next.classList.contains("wt-presence") ? next : row;
  }

  /** Where a result with no drawn row goes: with its repository when we can place
   *  it there, else at the end, which is the only honest place left. */
  private repoAnchorFor(result: WorktreeActionResult, info?: WorktreeInfo): HTMLElement | undefined {
    const repoId = result.repoId ?? (info ? this.repoOf(info)?.repoId : undefined);
    return repoId === undefined ? undefined : this.repoAnchors.get(repoId);
  }

  private infoFor(worktreeId: string): WorktreeInfo | undefined {
    for (const repo of this.data.tree?.repos ?? []) {
      const found = repo.worktrees.find((w) => w.id === worktreeId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  /**
   * What to call a worktree whose row is not on screen. A row label alone does
   * not identify one — `main`, `bare`, `(no branch)` and a short sha all repeat,
   * across repositories especially — so a label shared with another worktree the
   * panel holds is qualified until it separates them.
   */
  private nameFor(result: WorktreeActionResult, info?: WorktreeInfo): string | undefined {
    if (result.worktreeId === undefined) {
      return undefined;
    }
    if (!info) {
      // Left the tree: the last thing the panel knew of it, reconstructed by the
      // controller rather than supplied by the host, so it is a fallback and not
      // an authority.
      return result.orphanedLabel;
    }
    const label = branchLabel(info).text;
    const shared = (this.data.tree?.repos ?? []).some((repo) =>
      repo.worktrees.some((w) => w.id !== info.id && branchLabel(w).text === label),
    );
    return shared ? `${label} — ${info.displayPath}` : label;
  }

  /**
   * An indeterminate result is NOT an error: it says the repository changed and
   * names what was observed, so the user knows there is state to resolve. Rendering
   * it as a failure would tell them nothing happened, which is the false claim.
   */
  private buildActionNotice(result: WorktreeActionResult, info?: WorktreeInfo, name?: string): HTMLElement {
    const dismiss = this.deps.onDismissActionResult ? () => this.deps.onDismissActionResult?.(result) : undefined;
    // A notice re-scoped to its repository has no row above it to say what it
    // is about, so it says so itself.
    const about = name ?? result.orphanedLabel;
    const withAbout = (body?: string): string | undefined =>
      about === undefined ? body : body === undefined ? about : `${about} — ${body}`;
    if (result.outcome === "ok") {
      // Stated, not implied: the tree refreshing underneath is not a report,
      // and a user who started a mutation is owed its result either way.
      // Still a success — the worktree exists — but the notice says plainly
      // what did not happen afterwards, rather than a second notice replacing
      // this one (round-4 W7).
      return renderNotice({
        tone: result.openFailed === undefined ? "neutral" : "warn",
        live: "status",
        title: `${titleForAction(result.action)} done.`,
        body: withAbout(result.openFailed === undefined ? undefined : "It could not be opened afterwards."),
        reason: result.openFailed,
        onDismiss: dismiss,
      });
    }
    if (result.outcome === "unavailable") {
      // NOT a failure and NOT unclear: nothing was attempted, because what the
      // action would affect could not be read. That is the one outcome a retry
      // can actually change, so it is the only one that offers one.
      const retry = this.deps.onRetryAction;
      return renderNotice({
        tone: "warn",
        live: "alert",
        title: `Couldn't check what this would affect.`,
        body: withAbout("Nothing was changed. These reads failed:"),
        reason: (result.unreadable ?? []).join(", "),
        actions: retry ? [{ label: "Retry", onClick: () => retry(result) }] : undefined,
        onDismiss: dismiss,
      });
    }
    if (result.outcome === "indeterminate") {
      const repoId = result.repoId;
      const spec: NoticeSpec = {
        tone: "warn",
        live: "alert",
        title: `${titleForAction(result.action)} partly applied.`,
        body: withAbout("The repository changed. Check what was observed before retrying."),
        reason: result.observed,
        onDismiss: dismiss,
        actions:
          this.deps.onPrune && repoId ? [{ label: "Prune", onClick: () => this.deps.onPrune?.(repoId) }] : undefined,
      };
      return renderNotice(spec);
    }
    const actions: NonNullable<NoticeSpec["actions"]> = [];
    // A blocked destructive action reopens the confirmation rather than reporting
    // a dead end — the blocker set is what the user has to answer.
    if (result.needsConfirm && info) {
      const blocker = result.needsConfirm;
      actions.push({
        label: "Force remove…",
        onClick: () =>
          this.openRemoveDialog({
            info,
            blocker,
            agentRows: this.rowsFor(info.id),
            degradedSources: this.degradedSources(),
          }),
      });
    }
    return renderNotice({
      tone: "error",
      live: "alert",
      title: `Couldn't ${result.action} this worktree.`,
      body: withAbout(),
      reason: result.error,
      actions: actions.length > 0 ? actions : undefined,
      onDismiss: dismiss,
    });
  }

  // -- Keyboard (§ 6) ------------------------------------------------------

  /** Every focusable row, in visual order. The presence pill and the agents header
   *  are excluded: both duplicate the worktree row's own toggle, and both are hidden
   *  from assistive tech because neither is a valid child of `role="tree"`. */
  private navRows(): HTMLElement[] {
    return Array.from(this.element.querySelectorAll<HTMLElement>(NAV_ROWS));
  }

  /** One tab stop for the whole tree; arrows move within it. */
  private syncRovingTabindex(): void {
    const rows = this.navRows();
    let focused = rows.find((r) => this.keyOf(r) === this.focusedKey);
    if (!focused) {
      focused = rows[0];
      this.focusedKey = focused ? this.keyOf(focused) : null;
    }
    for (const row of rows) {
      setRowTabStop(row, row === focused);
    }
  }

  private keyOf(row: HTMLElement): string {
    // The disclosure's `idleKey` IS its repo's id, byte-identical to the header's
    // `repoId` — two row kinds, one string. Namespacing the navigation key the same
    // way the collapse key is namespaced is what keeps them apart; without it the
    // header renders first and wins every lookup, so focus and the tab stop land
    // on the repository instead of the tail.
    const idleKey = row.dataset.idleKey;
    if (idleKey !== undefined) {
      return idleTailKey(idleKey);
    }
    return row.dataset.worktreeId ?? row.dataset.repoId ?? row.dataset.rowId ?? row.dataset.subKey ?? "";
  }

  /**
   * `aria-level` on every navigable row, from the one depth model. A flat
   * `role="tree"` carries no structure of its own, so a level declared on some
   * kinds and left implicit on others is worse than none: the disclosure would
   * announce as a sibling of the header it sits under. `depthOf` is zero-based and
   * the header only exists multi-repo, hence the offset.
   */
  private stampLevels(multiRepo: boolean): void {
    const offset = multiRepo ? 1 : 0;
    for (const row of this.navRows()) {
      row.setAttribute("aria-level", String(this.depthOf(row) + offset));
    }
  }

  /** Depth in the declared tree, from the row's own class. */
  private depthOf(row: HTMLElement): number {
    if (row.classList.contains("wt-repo")) {
      return 0;
    }
    if (row.classList.contains("wt-idle")) {
      return 1;
    }
    if (row.classList.contains("wt-row")) {
      // A row inside the tail sits UNDER the disclosure, so Right can descend into
      // it and Left can climb back out.
      return row.classList.contains("wt-row--in-tail") ? 2 : 1;
    }
    return row.classList.contains("wt-arow") ? 2 : 3;
  }

  /** The nearest preceding row one level up — the parent every tree keyboard
   *  model needs and a flat NodeList does not carry. */
  private parentOf(rows: HTMLElement[], index: number): HTMLElement | undefined {
    const target = rows[index];
    if (!target) {
      return undefined;
    }
    const depth = this.depthOf(target);
    for (let i = index - 1; i >= 0; i--) {
      const candidate = rows[i];
      if (candidate && this.depthOf(candidate) < depth) {
        return candidate;
      }
    }
    return undefined;
  }

  private focusRow(row: HTMLElement | undefined): void {
    if (!row) {
      return;
    }
    for (const other of this.navRows()) {
      setRowTabStop(other, other === row);
    }
    this.focusedKey = this.keyOf(row);
    row.focus();
  }

  private onKeyDown(ev: KeyboardEvent): void {
    const rows = this.navRows();
    if (rows.length === 0) {
      return;
    }
    // A row's action control can hold focus, and it is not a row. Resolving it
    // to its owner first is what keeps every arrow working from there: indexing
    // the control itself yields -1, which sends both vertical arrows to the top
    // of the tree and hands the horizontal pair something that is not a row.
    const target = document.activeElement as HTMLElement | null;
    const active = target?.closest<HTMLElement>(NAV_ROWS) ?? null;
    const index = active ? rows.indexOf(active) : -1;
    switch (ev.key) {
      case "ArrowDown":
        ev.preventDefault();
        this.focusRow(rows[Math.min(rows.length - 1, index + 1)] ?? rows[0]);
        return;
      case "ArrowUp":
        ev.preventDefault();
        this.focusRow(index <= 0 ? rows[0] : rows[index - 1]);
        return;
      case "Home":
        ev.preventDefault();
        this.focusRow(rows[0]);
        return;
      case "End":
        ev.preventDefault();
        this.focusRow(rows[rows.length - 1]);
        return;
      case "ArrowRight":
      case "ArrowLeft": {
        if (!active) {
          return;
        }
        ev.preventDefault();
        this.expandOrDescend(active, ev.key === "ArrowRight", rows, index);
        return;
      }
      default:
    }
  }

  /**
   * Right opens a closed node, then descends into an open one, and does nothing on
   * a leaf. Left closes an open node, then ascends to the PARENT — not the previous
   * visual row, which on a nested row is a sibling and takes the user sideways.
   */
  private expandOrDescend(active: HTMLElement, forward: boolean, rows: HTMLElement[], index: number): void {
    const expandable = active.hasAttribute("aria-expanded");
    const isOpen = expandable && active.getAttribute("aria-expanded") === "true";

    if (expandable && forward !== isOpen) {
      const treeId = active.dataset.worktreeId ?? active.dataset.repoId;
      const idleKey = active.dataset.idleKey;
      const rowId = active.dataset.rowId;
      if (idleKey) {
        this.toggleIdleTail(idleKey);
        const key = idleTailKey(idleKey);
        this.focusRow(this.navRows().find((r) => this.keyOf(r) === key));
        return;
      }
      if (treeId) {
        this.toggleCollapsed(treeId);
      } else if (rowId) {
        this.toggleRow(rowId);
      } else {
        return;
      }
      const key = treeId ?? rowId;
      this.focusRow(this.navRows().find((r) => this.keyOf(r) === key));
      return;
    }

    if (forward) {
      // Descend only into a child. A leaf stays put rather than sliding to the
      // next branch, which would read as navigation the tree did not offer.
      const next = rows[index + 1];
      if (isOpen && next && this.depthOf(next) > this.depthOf(active)) {
        this.focusRow(next);
      }
      return;
    }
    this.focusRow(this.parentOf(rows, index));
  }
}

function titleForAction(action: WorktreeActionResult["action"]): string {
  switch (action) {
    case "remove":
      return "Remove";
    case "create":
      return "Create";
    case "lock":
      return "Lock";
    case "unlock":
      return "Unlock";
    case "prune":
      return "Prune";
    default:
      return "Launch";
  }
}
