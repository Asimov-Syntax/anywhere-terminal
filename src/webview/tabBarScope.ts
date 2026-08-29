// src/webview/tabBarScope.ts — the surface's tab-bar scope.
//
// Holds which worktree this surface is filtered to, the pane→worktree attribution
// it filters by, and whether either moved enough to be worth a render. Owned here
// rather than in `main.ts` so it can be tested at all: the render decision used to
// live inside a 1400-line side-effectful bootstrap that no test imports, where a
// render-suppression claim could not be verified (design.md D8).
//
// See: docs/design/worktree-scope.md, design.md D1 / D7 / D8 / D9.

import { getAllSessionIds, type SplitNode } from "./SplitModel";
import type { TabBarScope } from "./TabBarUtils";
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

export class TabBarScopeCoordinator {
  private readonly deps: TabBarScopeDeps;
  private scope: string | null;
  /** What the tree last called the scoped worktree; `null` until one confirmed it. */
  private scopeLabel: string | null = null;
  private attribution: ReadonlyMap<string, string> = new Map();
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

  /** The worktree this surface is filtered to, or `null`. */
  scopedWorktreeId(): string | null {
    return this.scope;
  }

  /** Whether this surface is filtered — the tab bar's second reason to be visible. */
  isScoped(): boolean {
    return this.scope !== null;
  }

  /** What `buildTabBarData` filters by; `undefined` while unscoped. */
  effectiveScope(): TabBarScope | undefined {
    return this.scope === null ? undefined : { worktreeId: this.scope, attribution: this.attribution };
  }

  /** The panel selected a worktree, or cleared its selection. */
  select(worktreeId: string | null): void {
    this.setScope(worktreeId);
  }

  /** The user asked for every tab back. */
  clear(): void {
    this.setScope(null);
  }

  /** A fresh pane→worktree attribution from the presence projection. */
  setAttribution(attribution: ReadonlyMap<string, string>): void {
    this.attribution = attribution;
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
    const scoped = this.scope;
    if (scoped === null || !tree) {
      return;
    }
    for (const repo of tree.repos) {
      for (const wt of repo.worktrees) {
        if (wt.id === scoped) {
          this.scopeLabel = wt.branch ?? wt.displayPath;
          return;
        }
      }
    }
    const label = this.scopeLabel ?? scoped;
    this.setScope(null);
    this.deps.onScopeDropped?.(scoped, label);
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
  shouldRender(tabLayouts: ReadonlyMap<string, SplitNode>): boolean {
    const next = this.signatureOf(tabLayouts);
    if (next === this.signature) {
      return false;
    }
    this.signature = next;
    return true;
  }

  private signatureOf(tabLayouts: ReadonlyMap<string, SplitNode>): string {
    const attribution = [...this.attribution]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([paneId, worktreeId]) => `${paneId}${UNIT}${worktreeId}`)
      .join(RECORD);
    // Membership, not identity: a split gaining or losing a leaf changes which
    // panes a tab is judged by, and the join would otherwise keep the old answer.
    const membership = [...tabLayouts]
      .map(([tabId, layout]) => `${tabId}${UNIT}${getAllSessionIds(layout).join(LEAF)}`)
      .join(RECORD);
    return [this.scope ?? "", attribution, membership].join(FIELD);
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
    if (worktreeId === null) {
      this.scopeLabel = null;
    }
  }
}
