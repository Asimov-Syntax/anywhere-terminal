// src/webview/worktree/worktreeActivation.ts — What activating an agent row does.
//
// One decision, two surfaces. The tree and the inspector both draw agent rows,
// and the version that lived in the tree alone had two clauses the drawer's copy
// did not: an external row has no pane in THIS window to focus, and a row with no
// session has no transcript to preview. Missing either one turns a working row on
// one surface into a dead click on the other (.reviews/round-1.md B4).

import type { WorktreeAgentRow, WorktreeRowActivation } from "./worktreeViewTypes";

/**
 * `setting` is the user's `rowActivation` preference. It is consulted last and
 * only where both outcomes are actually reachable — the two clauses above are not
 * the setting being overridden, they are cases where it is never read (D5).
 */
export function activationFor(row: WorktreeAgentRow, setting: WorktreeRowActivation): WorktreeRowActivation {
  if (row.scope === "external") {
    return "preview";
  }
  if (row.entryId === undefined) {
    return "focus";
  }
  return setting;
}
