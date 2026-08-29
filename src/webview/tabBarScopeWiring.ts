// src/webview/tabBarScopeWiring.ts — the panel, the coordinator and the bar, joined.
//
// The join used to be six call sites scattered through a 1400-line side-effectful
// bootstrap no test imports, and round-1 found three blockers living in exactly
// the gaps between them: a chip naming the wrong worktree, a chip whose clear left
// the panel still marking a row, and an ordering only a comment held. Owning the
// join here is what makes those provable. `main.ts` keeps the surface objects and
// hands them over — this is the wiring, not a second controller (design.md D8).

import type { PaneReport } from "./paneAttribution";
import type { SplitNode } from "./SplitModel";
import type { TabBarScope } from "./TabBarUtils";
import { TabBarScopeCoordinator, type TabBarScopeStore } from "./tabBarScope";
import type { WorktreeTree } from "./worktree/worktreeViewTypes";

/**
 * The worktree panel, as this seam needs it — only what the seam ASKS OF the
 * panel. The traffic in the other direction is the callbacks below, and keeping
 * the two apart is what stops them from calling each other.
 */
export interface TabBarScopePanel {
  /**
   * Record that the scope went because the worktree left, WITHOUT repainting —
   * the tree that caused it is handed over immediately after, and one push then
   * carries both.
   */
  stageScopeCleared(worktreeId: string, label: string): void;
  /** Stop marking a row as selected, and say so the way a click would. */
  clearSelection(): void;
  /** The rollout flag moved. */
  setWorkbench(enabled: boolean): void;
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
  onAttribution(report: PaneReport): void;
  /**
   * A tree arrived. `deliver` hands the same tree to the panel, and it runs in the
   * middle on purpose: the coordinator has to re-resolve BEFORE the panel prunes,
   * because the panel's pruning clears the selection when a worktree leaves and
   * reaches the coordinator as a plain clear — a scope already cleared has nothing
   * left to report. The order was a comment in `main.ts`; here it is the code.
   */
  applyTree(tree: WorktreeTree | null, deliver: () => void): void;
  /** The rollout flag moved. Reaches the panel and the coordinator, in that order. */
  setWorkbench(enabled: boolean): void;
  /** What `buildTabBarData` filters by, or `undefined`. */
  effectiveScope(): TabBarScope | undefined;
  /**
   * The chip the bar carries while this surface is filtered, or `undefined`. One
   * value for both the chip and the bar's second reason to be visible, so a filter
   * without its own escape hatch is not expressible.
   */
  chip(hiddenWaiting?: number): { label: string; onClear: () => void; hiddenWaiting?: number } | undefined;
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

    onAttribution(report) {
      coordinator.setAttribution(report);
      // Gated like every other mutator. Today the only caller is followed by the
      // tree push that would have caught it anyway, so this is a no-op — and not
      // relying on that is the point (round-2 V7).
      renderIfMoved();
    },

    applyTree(tree, deliver) {
      coordinator.applyTree(tree);
      // Staged BEFORE the tree is handed over, so the push that draws the new tree
      // is the same one that draws the notice: it is never painted beside the row
      // it says is gone (round-1 W2), and the panel is built once (round-2 V5).
      // Drained rather than read — a second tree must not re-announce the first.
      const panel = deps.panel();
      for (const [worktreeId, label] of dropped.splice(0)) {
        panel?.stageScopeCleared(worktreeId, label);
      }
      // `finally`, because a throwing deliver would otherwise leave the queue to
      // fire against the NEXT tree — W2's own failure, through the error path
      // (round-2 V3) — and leave the bar drawing a scope that is gone.
      try {
        deliver();
      } finally {
        renderIfMoved();
      }
    },

    setWorkbench(enabled) {
      // Through here rather than fanned out at the call site: the flip is the one
      // join `main.ts` still owned, and the panel and the coordinator disagreeing
      // about it is exactly what the single gate exists to prevent (round-2 V2).
      deps.panel()?.setWorkbench(enabled);
      coordinator.setWorkbench(enabled);
      renderIfMoved();
    },

    effectiveScope: () => coordinator.effectiveScope(),

    // The count is passed IN rather than computed here: `buildTabBarData` derives
    // it from the same pass that drops the tab, and a second derivation is a
    // second definition of "hidden" (design.md D2).
    chip(hiddenWaiting) {
      const label = coordinator.scopedLabel();
      if (label === null) {
        return undefined;
      }
      return {
        label,
        ...(hiddenWaiting === undefined || hiddenWaiting === 0 ? {} : { hiddenWaiting }),
        onClear: () => {
          // Through the PANEL, so the row stops being marked as well. Its own
          // callback comes back through `onSelectWorktree`; the direct clear
          // after it is what covers a surface with no panel mounted, and is
          // inert once the callback already did it (round-1 B2).
          deps.panel()?.clearSelection();
          coordinator.clear();
          // Gated, so the signature records the cleared state. Rendering
          // unconditionally left it unrecorded on a surface with no panel, and
          // drew the bar twice on one with a panel (round-2 V4).
          renderIfMoved();
        },
      };
    },
  };
}
