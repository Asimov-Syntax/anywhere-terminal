// src/webview/split/tabDisplay.ts — Which pane a tab can be displayed through.
// See: asimov/changes/wire-worktree-navigation-actions/.reviews/round-2.md B2
//
// Tabs are keyed by the session id of the pane they were created from, and the
// display path used to read `terminals[tabId]` directly. That id stops resolving
// the moment the user closes that particular pane: `closeSplitPaneById` removes
// the leaf and deletes its terminal while keeping the tab, its id, and its
// remaining live leaves. The tab is still perfectly displayable — it just can no
// longer be found through the pane it was named after.
//
// Lives outside main.ts so it can be tested: the bundle entry is not importable
// under vitest.

import type { SplitNode } from "../SplitModel";
import { getAllSessionIds } from "../SplitModel";

export interface TabDisplayDeps {
  /** Every tab's split tree, keyed by tab id. */
  tabLayouts: ReadonlyMap<string, SplitNode>;
  /** Whether a live terminal exists for this session id. */
  hasTerminal(sessionId: string): boolean;
}

/**
 * The session id through which `tabId` can be brought on screen, or null when
 * the tab holds no live pane at all.
 *
 * Prefers the tab's own id so the ordinary case is unchanged; falls back to the
 * first live leaf in layout order, which is the same pane `closeSplitPaneById`
 * makes active when it removes a leaf.
 */
export function resolveTabDisplayPane(tabId: string, deps: TabDisplayDeps): string | null {
  if (deps.hasTerminal(tabId)) {
    return tabId;
  }
  const layout = deps.tabLayouts.get(tabId);
  if (!layout) {
    return null;
  }
  return getAllSessionIds(layout).find((id) => deps.hasTerminal(id)) ?? null;
}
