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
  type NoticeSpec,
  renderAgentRow,
  renderAgentsHeader,
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
    this.element = document.createElement("div");
    this.element.className = "wt-tree";
    this.element.setAttribute("role", "tree");
    this.element.setAttribute("aria-label", "Worktrees");
    this.element.addEventListener("keydown", (ev) => this.onKeyDown(ev));
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
      this.render();
    }
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
    const at = this.nextCeilingCrossing(now);
    if (at === undefined) {
      return;
    }
    this.ceilingTimer = setTimeout(
      () => {
        this.ceilingTimer = undefined;
        this.applyAt(this.now());
      },
      Math.max(0, at - now),
    );
  }

  /**
   * When the earliest still-confirmed claim will outlive its evidence, or
   * undefined if none can. A row already presented as something else — crossed,
   * or `unknown` because its source failed — has nothing left to cross.
   */
  private nextCeilingCrossing(now: number): number | undefined {
    const degraded = this.degradedSources();
    let soonest: number | undefined;
    for (const rows of Object.values(this.data.presence?.rowsByWorktreeId ?? {})) {
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
    this.render();
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
    if (this.collapsed.has(id)) {
      this.collapsed.delete(id);
    } else {
      this.collapsed.add(id);
    }
    this.deps.persistCollapsed?.([...this.collapsed]);
    this.render();
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
    this.render();
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
    for (const repo of data.tree.repos) {
      liveIds.add(repo.repoId);
      if (this.collapsed.has(repo.repoId)) {
        collapsed.add(repo.repoId);
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

  private render(): void {
    const scrollTop = this.element.scrollTop;
    // `replaceChildren` detaches the focused row, and focus falls to <body> — a
    // keyboard user loses their place on every disclosure toggle. Restored below
    // by key, which is why subagent rows had to gain one.
    const hadFocus = this.element.contains(document.activeElement);
    this.element.replaceChildren();
    const { tree, presence, loading, refreshing, noFolder } = this.data;

    if (loading && !tree) {
      this.element.setAttribute("aria-busy", "true");
      this.element.appendChild(renderSkeleton());
      return;
    }
    this.element.removeAttribute("aria-busy");

    if (noFolder) {
      this.element.appendChild(worktreeEmptyState("noFolder"));
      return;
    }
    // Only when nothing was retained: an unusable git with a last good listing
    // is a stale tree, not an empty one, and hiding it behind this state was
    // what made the cache's retention invisible.
    if (tree && !tree.gitAvailable && tree.repos.length === 0) {
      this.element.appendChild(worktreeEmptyState("gitMissing"));
      return;
    }
    if (!tree || tree.repos.length === 0) {
      this.element.appendChild(worktreeEmptyState("noRepo"));
      return;
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
      rendered += this.renderRepo(repo, multiRepo);
    }
    if (rendered === 0 && this.query) {
      this.element.appendChild(worktreeEmptyState("noMatch"));
    }
    this.element.scrollTop = scrollTop;
    this.syncRovingTabindex();
    if (hadFocus) {
      this.navRows()
        .find((r) => this.keyOf(r) === this.focusedKey)
        ?.focus();
    }
  }

  /** Returns how many worktree rows this repo contributed (0 → filtered away). */
  private renderRepo(repo: WorktreeRepo, multiRepo: boolean): number {
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
        renderRepoHeader(repo, visible.length, collapsed, () => this.toggleCollapsed(repo.repoId)),
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

    const shown = this.uncapped.has(repo.repoId) ? visible : visible.slice(0, MAX_WORKTREES_PER_REPO);
    for (const info of shown) {
      this.renderWorktree(info);
      for (const result of this.resultsFor(info.id)) {
        this.element.appendChild(this.buildActionNotice(result, info));
      }
    }
    if (shown.length < visible.length) {
      this.element.appendChild(
        renderShowAll(visible.length, () => {
          this.uncapped.add(repo.repoId);
          this.render();
        }),
      );
    }
    for (const result of this.resultsFor(undefined, repo.repoId)) {
      this.element.appendChild(this.buildActionNotice(result));
    }
    return visible.length;
  }

  private renderWorktree(info: WorktreeInfo): void {
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
          activity: strongestActivity(rows, this.degradedSources(), this.now()),
          hasAgents: rows.length > 0,
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
        renderPresencePill(groupPresenceByActivity(rows, this.degradedSources(), this.now()), () =>
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
            activity: presentedActivity(row, this.degradedSources(), this.now()),
            expanded: rowExpanded,
            now: this.now(),
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
            this.now(),
          ),
        );
      }
    }
  }

  private resultsFor(worktreeId?: string, repoId?: string): WorktreeActionResult[] {
    return (this.data.actionResults ?? []).filter((r) =>
      worktreeId !== undefined ? r.worktreeId === worktreeId : !r.worktreeId && r.repoId === repoId,
    );
  }

  /**
   * An indeterminate result is NOT an error: it says the repository changed and
   * names what was observed, so the user knows there is state to resolve. Rendering
   * it as a failure would tell them nothing happened, which is the false claim.
   */
  private buildActionNotice(result: WorktreeActionResult, info?: WorktreeInfo): HTMLElement {
    const dismiss = this.deps.onDismissActionResult ? () => this.deps.onDismissActionResult?.(result) : undefined;
    // A notice re-scoped to its repository has no row above it to say what it
    // is about, so it says so itself.
    const about = result.orphanedLabel;
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
    return Array.from(this.element.querySelectorAll<HTMLElement>(".wt-repo, .wt-row, .wt-arow, .wt-srow"));
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
      row.tabIndex = row === focused ? 0 : -1;
    }
  }

  private keyOf(row: HTMLElement): string {
    return row.dataset.worktreeId ?? row.dataset.repoId ?? row.dataset.rowId ?? row.dataset.subKey ?? "";
  }

  /** Depth in the declared tree, from the row's own class. */
  private depthOf(row: HTMLElement): number {
    if (row.classList.contains("wt-repo")) {
      return 0;
    }
    if (row.classList.contains("wt-row")) {
      return 1;
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
      other.tabIndex = other === row ? 0 : -1;
    }
    this.focusedKey = this.keyOf(row);
    row.focus();
  }

  private onKeyDown(ev: KeyboardEvent): void {
    const rows = this.navRows();
    if (rows.length === 0) {
      return;
    }
    const active = document.activeElement as HTMLElement | null;
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
      const rowId = active.dataset.rowId;
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
