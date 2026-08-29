// src/webview/tabBarScopeWiring.ts — the panel, the coordinator and the bar, joined.
//
// The join used to be six call sites scattered through a 1400-line side-effectful
// bootstrap no test imports, and round-1 found three blockers living in exactly
// the gaps between them: a chip naming the wrong worktree, a chip whose clear left
// the panel still marking a row, and an ordering only a comment held. Owning the
// join here is what makes those provable. `main.ts` keeps the surface objects and
// hands them over — this is the wiring, not a second controller (design.md D8).

import type { PaneAttribution } from "./paneAttribution";
import type { SplitNode } from "./SplitModel";
import type { TabBarScope } from "./TabBarUtils";
import { TabBarScopeCoordinator, type TabBarScopeStore } from "./tabBarScope";
import type { WorktreeTree } from "./worktree/worktreeViewTypes";

/**
 * The worktree panel, as this seam needs it. Two methods, both of them things the
 * TAB BAR asks of the panel — the traffic in the other direction is the callbacks
 * below, and keeping them apart is what stops the two from calling each other.
 */
export interface TabBarScopePanel {
  /** Say that the scope went because the worktree left. */
  reportScopeCleared(worktreeId: string, label: string): void;
  /** Stop marking a row as selected, and say so the way a click would. */
  clearSelection(): void;
}

export interface TabBarScopeWiringDeps {
  store: TabBarScopeStore;
  /** The rollout flag as `init` carried it. */
  workbench: boolean;
  /**
   * The panel, once it exists. A getter because the coordinator is constructed
   * FIRST — the panel's first push already carries a tree, and the coordinator has
   * to be holding the persisted scope by then.
   */
  panel: () => TabBarScopePanel | null;
  /** What the bar is currently drawing from. */
  tabLayouts: () => ReadonlyMap<string, SplitNode>;
  /** Redraw the tab bar. */
  render: () => void;
}

export interface TabBarScopeWiring {
  /** For `WorktreeController`'s `onSelectWorktree`. */
  onSelectWorktree(worktreeId: string | null): void;
  /** For `WorktreeController`'s `onAttribution`. */
  onAttribution(attribution: PaneAttribution): void;
  /**
   * A tree arrived. `deliver` hands the same tree to the panel, and it runs in the
   * middle on purpose: the coordinator has to re-resolve BEFORE the panel prunes,
   * because the panel's pruning clears the selection when a worktree leaves and
   * reaches the coordinator as a plain clear — a scope already cleared has nothing
   * left to report. The order was a comment in `main.ts`; here it is the code.
   */
  applyTree(tree: WorktreeTree | null, deliver: () => void): void;
  /** The rollout flag moved. */
  setWorkbench(enabled: boolean): void;
  /** What `buildTabBarData` filters by, or `undefined`. */
  effectiveScope(): TabBarScope | undefined;
  /**
   * The chip the bar carries while this surface is filtered, or `undefined`. One
   * value for both the chip and the bar's second reason to be visible, so a filter
   * without its own escape hatch is not expressible.
   */
  chip(): { label: string; onClear: () => void } | undefined;
}

export function wireTabBarScope(deps: TabBarScopeWiringDeps): TabBarScopeWiring {
  // Deferred, because the drop lands during `applyTree` — before `deliver` — and
  // the panel it is reported to is the same one the getter resolves.
  const dropped: [string, string][] = [];
  const coordinator = new TabBarScopeCoordinator({
    store: deps.store,
    workbench: deps.workbench,
    onScopeDropped: (worktreeId, label) => dropped.push([worktreeId, label]),
  });

  const renderIfMoved = (): void => {
    if (coordinator.shouldRender(deps.tabLayouts())) {
      deps.render();
    }
  };

  return {
    onSelectWorktree(worktreeId) {
      coordinator.select(worktreeId);
      renderIfMoved();
    },

    onAttribution(attribution) {
      coordinator.setAttribution(attribution);
    },

    applyTree(tree, deliver) {
      coordinator.applyTree(tree);
      deliver();
      // Said AFTER the panel holds the tree that dropped it, so the notice does
      // not land on a panel still drawing the worktree it is about (round-1 W2).
      // Drained rather than read: a second tree must not re-announce the first.
      for (const [worktreeId, label] of dropped.splice(0)) {
        deps.panel()?.reportScopeCleared(worktreeId, label);
      }
      renderIfMoved();
    },

    setWorkbench(enabled) {
      coordinator.setWorkbench(enabled);
      renderIfMoved();
    },

    effectiveScope: () => coordinator.effectiveScope(),

    chip() {
      const label = coordinator.scopedLabel();
      if (label === null) {
        return undefined;
      }
      return {
        label,
        onClear: () => {
          // Through the PANEL, so the row stops being marked as well. Its own
          // callback comes back through `onSelectWorktree`; the direct clear
          // after it is what covers a surface with no panel mounted, and is
          // inert once the callback already did it (round-1 B2).
          deps.panel()?.clearSelection();
          coordinator.clear();
          deps.render();
        },
      };
    },
  };
}
