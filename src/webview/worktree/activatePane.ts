// src/webview/worktree/activatePane.ts — Bring one pane forward, by session id.
// See: asimov/changes/wire-worktree-navigation-actions/design.md D4,
//      .reviews/round-1.md B2
//
// Lives outside main.ts so it can be tested: the bundle entry is not importable
// under vitest, and the failure this closes is only visible through the return
// value.

import type { SplitNode } from "../SplitModel";
import { getAllSessionIds } from "../SplitModel";

export interface ActivatePaneDeps {
  /** Every tab's split tree, keyed by tab id. */
  tabLayouts: ReadonlyMap<string, SplitNode>;
  /** Whether the tab can be brought on screen at all — see `resolveTabDisplayPane`. */
  canDisplayTab(tabId: string): boolean;
  /** Record which pane is active within a tab. */
  setActivePane(tabId: string, paneId: string): void;
  persist(): void;
  showTab(tabId: string): void;
  updateActivePaneVisual(tabId: string): void;
  focusPane(paneId: string): void;
}

/**
 * Activate the pane `paneId` names, inside whichever tab holds it.
 *
 * Returns whether the pane was actually brought forward. The id may name a root
 * tab or a leaf inside one, so the owning tab is found first and the pane is
 * made that tab's active one before focus — otherwise the tab comes forward
 * showing whichever pane was last active in it (design.md D4).
 *
 * False only when the owning tab holds no live pane to be shown through — a tab
 * that lost the pane it was named after is still displayable through a retained
 * leaf, so it activates normally (round-2 B2). Reporting success for a tab that
 * cannot come forward would focus a pane inside a hidden container while a
 * different tab stayed on screen.
 */
export function activatePane(paneId: string, deps: ActivatePaneDeps): boolean {
  for (const [tabId, layout] of deps.tabLayouts) {
    if (!getAllSessionIds(layout).includes(paneId)) {
      continue;
    }
    if (!deps.canDisplayTab(tabId)) {
      return false;
    }
    deps.setActivePane(tabId, paneId);
    deps.persist();
    deps.showTab(tabId);
    deps.updateActivePaneVisual(tabId);
    deps.focusPane(paneId);
    return true;
  }
  return false;
}
