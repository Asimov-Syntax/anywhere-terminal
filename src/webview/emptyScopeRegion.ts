// src/webview/emptyScopeRegion.ts — what a surface shows when its scope holds no pane.
//
// A worktree with nothing running in it is a normal selection, not a failure — it
// is the state a freshly created worktree is in — so no error treatment
// (worktree-scope.md § 4.3). WHEN it shows is the seam's, decided together with
// which pane to activate: the two are one calculation's outcomes (design.md D4).

import { ICON_TERMINAL } from "./vault/icons";
import { type EmptyStateAction, emptyState } from "./vault/renderAtoms";

export interface EmptyScopeRegionDeps {
  /** The scoped worktree's branch, as the chip names it. Never a path. */
  label: string;
  onOpenTerminal: () => void;
  /** Absent when no agent can start a session — an inert button would claim one could. */
  onLaunchAgent?: () => void;
  onClear: () => void;
}

export function renderEmptyScopeRegion(deps: EmptyScopeRegionDeps): HTMLElement {
  const actions: EmptyStateAction[] = [{ label: "Open a terminal", onClick: deps.onOpenTerminal }];
  if (deps.onLaunchAgent) {
    actions.push({ label: "Launch an agent", onClick: deps.onLaunchAgent });
  }
  // Last, because it undoes the state rather than acting inside it.
  actions.push({ label: "Show all tabs", onClick: deps.onClear });

  const region = emptyState(
    ICON_TERMINAL,
    `Nothing running in ${deps.label}`,
    "Terminals in other worktrees are hidden while this one is selected.",
    actions,
  );
  region.classList.add("empty-scope");
  // A region, not a status: `role="status"` would interrupt on every selection.
  region.setAttribute("role", "region");
  region.setAttribute("aria-label", `Nothing running in ${deps.label}`);
  return region;
}
