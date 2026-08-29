// src/webview/emptyScopeRegion.ts — what a surface shows when its scope holds no pane.
//
// A worktree with nothing running in it is a normal selection, not a failure — it
// is the state a freshly created worktree is in — so no error treatment
// (worktree-scope.md § 4.3). WHEN it shows is the seam's, decided together with
// which pane to activate: the two are one calculation's outcomes (design.md D4).

import { ICON_TERMINAL } from "./vault/icons";
import { type EmptyStateAction, emptyState } from "./vault/renderAtoms";

export interface EmptyScopeRegionDeps {
  /**
   * The scoped worktree. What the offers below ACT on, and therefore what the
   * region's identity is — the label is not it: two repos in a multi-root
   * workspace can each hold a `main` worktree, and a selection carries no
   * teardown between them (round-3 B3).
   */
  id: string;
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

const REGION_ID = "empty-scope-region";

/**
 * Put the region up beside a container, or take it down with `null`.
 *
 * The container is hidden while the region stands, and left MOUNTED: unmounting
 * would discard xterm's viewport state and make clearing the scope a rebuild,
 * which is "scope changes rendering, never process state" violated one layer
 * down. Nothing else on the selection path hides it, so without this the region
 * would appear beside the still-visible terminal the scope is hiding (D4).
 */
export function mountEmptyScopeRegion(container: HTMLElement, deps: EmptyScopeRegionDeps | null): void {
  const standing = container.ownerDocument.getElementById(REGION_ID);
  if (deps === null) {
    standing?.remove();
    container.style.removeProperty("display");
    return;
  }
  // Resolved BEFORE anything is removed: hiding or unmounting first would leave a
  // detached container with no region in its place (round-1 suggestion).
  const parent = container.parentElement;
  if (parent === null) {
    return;
  }
  // Keyed on what the closures capture, id first — see `id` above.
  const identity = [deps.id, deps.label, deps.onLaunchAgent === undefined ? "" : "launch"].join("\u0002");
  // Idempotent on purpose. This runs from the render path, which fires on every
  // activity transition of any pane in the window — and while the scope is empty
  // every running pane is out of scope, so that is the NORMAL case. Rebuilding
  // unconditionally destroyed the button focus was on about once a second, which
  // put the region's own offers out of reach of a keyboard (round-2 W6).
  if (standing?.dataset.identity === identity) {
    return;
  }
  standing?.remove();
  const region = renderEmptyScopeRegion(deps);
  region.id = REGION_ID;
  region.dataset.identity = identity;
  parent.insertBefore(region, container);
  container.style.display = "none";
}
