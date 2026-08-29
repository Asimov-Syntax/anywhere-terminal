// src/webview/tabBarScope.ts — the surface's tab-bar scope.
//
// Holds which worktree this surface is filtered to, the pane→worktree attribution
// it filters by, and whether either moved enough to be worth a render. Owned here
// rather than in `main.ts` so it can be tested at all: the render decision used to
// live inside a 1400-line side-effectful bootstrap that no test imports, where a
// render-suppression claim could not be verified (design.md D8).
//
// See: docs/design/worktree-scope.md, design.md D1 / D7 / D8 / D9.

import { attributionKey, type PaneAttribution, type PaneReport } from "./paneAttribution";
import { getAllSessionIds, type SplitNode } from "./SplitModel";
import { inScope, type TabBarScope } from "./TabBarUtils";
import type { WorktreeTree } from "./worktree/worktreeViewTypes";

/** The slice of the surface's persisted state this coordinator owns. */
export interface TabBarScopeStore {
  getState(): { worktreeScope?: unknown };
  updateState(patch: { worktreeScope?: string }): void;
}

export interface TabBarScopeDeps {
  store: TabBarScopeStore;
  /**
   * The scoped worktree left the tree. `label` is what the panel last knew it as,
   * falling back to its id for a scope restored from persistence that no tree ever
   * confirmed — the user is owed a name either way.
   */
  onScopeDropped?: (worktreeId: string, label: string) => void;
}

/** Separators no path, pane id or branch name can contain. */
const UNIT = "\u0000";
const RECORD = "\u0001";
const LEAF = "\u0002";
const FIELD = "\u0003";

/** Every worktree the tree holds, by id, named the way the panel names it. */
function labelsOf(tree: WorktreeTree): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const repo of tree.repos) {
    for (const wt of repo.worktrees) {
      labels.set(wt.id, wt.branch ?? wt.displayPath);
    }
  }
  return labels;
}

export class TabBarScopeCoordinator {
  private readonly deps: TabBarScopeDeps;
  private scope: string | null;
  /**
   * What the tree last called the scoped worktree, kept so the drop notice can
   * still name a worktree that has left. `null` while unscoped.
   */
  private scopeLabel: string | null = null;
  /**
   * Every id the last tree held, by name. NOT the attribution cache D7 rejects —
   * that one is about pane PLACEMENT and would keep hiding tabs; this is a naming
   * table read only for the chip and the drop notice, and it is replaced whole on
   * every push rather than merged.
   */
  private labels: ReadonlyMap<string, string> = new Map();
  /**
   * Whether a tree has actually held the scoped id. A scope restored from
   * persistence has not been resolved against anything yet, and filtering on it
   * is exactly what "a persisted scope naming an absent worktree resolves to
   * unscoped" forbids (round-1 W1).
   */
  private resolved = false;
  private attribution: PaneAttribution = new Map();
  /** Panes the last presence scan called waiting. One half of the badge's union. */
  private waiting: ReadonlySet<string> = new Set();
  /** The last signature `shouldRender` reported on. `null` → nothing drawn yet. */
  private signature: string | null = null;

  constructor(deps: TabBarScopeDeps) {
    this.deps = deps;
    // Fails OPEN. The stored object is cast structurally rather than validated
    // (`WebviewStateStore.getState`), so a non-string here is not a scope — and
    // failing closed would leave a surface filtered by something it could not
    // read (design.md D9).
    const stored = this.readStored();
    this.scope = typeof stored === "string" && stored !== "" ? stored : null;
  }

  private readStored(): unknown {
    try {
      return this.deps.store.getState().worktreeScope;
    } catch {
      return undefined;
    }
  }

  /**
   * The worktree this surface is filtered to, or `null` — `null` until a tree has
   * confirmed the persisted id.
   */
  scopedWorktreeId(): string | null {
    return this.resolved ? this.scope : null;
  }

  /**
   * What to call the scoped worktree, or `null` while unscoped. The branch
   * the tree last showed, never the path — the panel forbids a path on a row and
   * the chip is no different (worktree-panel-ui.md § 3.2). Nothing is scoped until
   * a tree confirms it, so there is no unnamed scope to fall back for.
   */
  scopedLabel(): string | null {
    return this.scopedWorktreeId() === null ? null : this.scopeLabel;
  }

  /**
   * Whether a scope is persisted for this surface, WHETHER OR NOT a tree has
   * confirmed it yet.
   *
   * Deliberately not `isScoped()`. Nothing is scoped until a tree confirms it,
   * but confirming needs a tree, and the host pushes trees only to a surface
   * that subscribed. Gating the subscription on the confirmed answer is a
   * deadlock: a restored scope on a surface whose body starts collapsed could
   * never resolve itself, and its chip, filter and count would stay absent
   * until the user opened the rail by hand (round-1 B1).
   *
   * The stale case needs no branch here: an unconfirmed id resolves to unscoped
   * and `setScope(null)` clears it, so this goes false on its own and the
   * surface unsubscribes.
   */
  needsPresence(): boolean {
    return this.scope !== null;
  }

  /** Whether this surface is filtered — the tab bar's second reason to be visible. */
  isScoped(): boolean {
    return this.scopedWorktreeId() !== null;
  }

  /** What `buildTabBarData` filters by; `undefined` while unscoped. */
  effectiveScope(): TabBarScope | undefined {
    const worktreeId = this.scopedWorktreeId();
    return worktreeId === null ? undefined : { worktreeId, attribution: this.attribution, waiting: this.waiting };
  }

  /** The panel selected a worktree, or cleared its selection. */
  select(worktreeId: string | null): void {
    this.setScope(worktreeId);
  }

  /** The user asked for every tab back. */
  clear(): void {
    this.setScope(null);
  }

  /** A fresh report from the presence projection — both halves, one call (D1). */
  setAttribution(report: PaneReport): void {
    this.attribution = report.placement;
    this.waiting = report.waiting;
  }

  /**
   * Panes presence says are waiting. The badge unions this with the surface's own
   * tracked status, which has different coverage (design.md D2) — exposed rather
   * than counted here, so there is exactly one definition of the count.
   */
  waitingPanes(): ReadonlySet<string> {
    return this.waiting;
  }

  /**
   * Whether this scope can prove the pane belongs elsewhere. THE predicate — the
   * bar filters by it and the selection navigates by it, and two copies is how
   * they come to disagree about which panes a scope holds.
   */
  presents(paneId: string): boolean {
    return inScope(this.effectiveScope(), paneId);
  }

  /**
   * Re-resolve the scope against the tree, and against nothing else (design.md D7).
   *
   * A worktree reported `missing` is KEPT: the registration exists and panes may
   * still be attributed to it. Only leaving the tree — removed, pruned, or never
   * there, a persisted id included — drops the scope, and the drop is said.
   *
   * Must run BEFORE the controller sees the same tree: the panel's own pruning
   * clears the SELECTION when a worktree leaves, and a scope already cleared has
   * nothing left to report.
   */
  applyTree(tree: WorktreeTree | null): void {
    if (!tree) {
      return;
    }
    // Read whatever the flag says: a name recorded while off is what lets the
    // flag be turned on without a reload, and it hides nothing on its own.
    this.labels = labelsOf(tree);
    const scoped = this.scope;
    if (scoped === null) {
      return;
    }
    const label = this.labels.get(scoped);
    if (label !== undefined) {
      this.scopeLabel = label;
      this.resolved = true;
      return;
    }
    this.resolved = false;
    const said = this.scopeLabel ?? scoped;
    this.setScope(null);
    this.deps.onScopeDropped?.(scoped, said);
  }

  /**
   * Whether the tab bar has to be redrawn, and record that it was. A query with a
   * side effect on purpose: asking twice about the same state answers `false` the
   * second time, which is what "exactly one render per move" means.
   *
   * The signature covers the scope, the attribution, and the tab layouts' pane
   * membership — nothing else the presence envelope carries. A scan timestamp, an
   * activity change or a retitled agent move none of them, so none of them is a
   * reason to re-enter `renderTabBar`.
   */
  shouldRender(tabLayouts: ReadonlyMap<string, SplitNode>, hiddenWaiting: number): boolean {
    const next = this.signatureOf(tabLayouts, hiddenWaiting);
    if (next === this.signature) {
      return false;
    }
    this.signature = next;
    return true;
  }

  private signatureOf(tabLayouts: ReadonlyMap<string, SplitNode>, hiddenWaiting: number): string {
    // Membership, not identity: a split gaining or losing a leaf changes which
    // panes a tab is judged by, and the join would otherwise keep the old answer.
    const membership = [...tabLayouts]
      .map(([tabId, layout]) => `${tabId}${UNIT}${getAllSessionIds(layout).join(LEAF)}`)
      .join(RECORD);
    // The LABEL is in here too. It moves only when the tree renames the scoped
    // worktree, so it can never cause a spurious render — and leaving it out left
    // the chip naming a branch that no longer exists (round-1, accepted suggestion).
    return [
      this.scopedWorktreeId() ?? "",
      this.scopedLabel() ?? "",
      attributionKey(this.attribution),
      membership,
      // The count the badge would draw, NOT the raw waiting set: a waiting change
      // on a presented pane, or any at all while unscoped, moves nothing the bar
      // shows, and keying the set would redraw for both (spec: a push that moves
      // no attribution redraws no tab bar, as narrowed by this change).
      //
      // Handed in rather than derived here. Deriving it took the coordinator's own
      // view of "hidden and waiting", which had no way to see an exited pane and
      // so counted one the badge does not — a disagreement that suppressed the
      // very redraw the count exists to trigger (round-1 B2).
      String(hiddenWaiting),
    ].join(FIELD);
  }

  private setScope(worktreeId: string | null): void {
    if (this.scope === worktreeId) {
      return;
    }
    // Written BEFORE the field moves, and the throw is not caught. A write that
    // fails leaves the previous scope standing, which is a legal state; recording
    // one the surface could not persist is not (design.md D9). The merge is what
    // preserves every unrelated key, and it is asserted rather than assumed.
    this.deps.store.updateState({ worktreeScope: worktreeId ?? undefined });
    this.scope = worktreeId;
    // The name moves WITH the scope. `applyTree` was the only writer, so a second
    // selection kept announcing the first worktree's branch and a first selection
    // — before any tree had been seen — announced an absolute path (round-1 B1).
    this.scopeLabel = worktreeId === null ? null : (this.labels.get(worktreeId) ?? worktreeId);
    // A selection comes off a row the tree drew, so the tree holds it; a clear
    // resolves nothing. Anything else waits for a tree to confirm it.
    this.resolved = worktreeId !== null && this.labels.has(worktreeId);
  }
}
