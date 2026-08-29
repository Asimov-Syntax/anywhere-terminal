// src/webview/vault/collapseAfterSelection.ts — when a worktree selection hands
// the room back (round-1 B3).
//
// The gate lives here rather than inline in the bootstrap because `main.ts`
// exports nothing and runs the whole webview on import, so an invariant written
// there cannot be tested at all. Three conditions have to hold at once, and one
// of them is a rollout flag that moves at runtime.

/**
 * Whether the aux region is stacked above/below the terminal rather than docked
 * beside it. One definition serves the collapse animator (which axis to measure)
 * and the after-selection collapse (whether the rail is taking the room the
 * terminal needs). A user who docked it to a side keeps it open.
 */
export function isStackedLayout(layout: HTMLElement): boolean {
  return layout.classList.contains("file-tree--top") || layout.classList.contains("file-tree--bottom");
}

/**
 * Whether this selection should collapse the rail.
 *
 * `workbench` MUST be read live at selection time. The init-time snapshot cannot
 * see `onWorktreeWorkbench`, so an off→on flip would never start collapsing and,
 * worse, an on→off flip would keep collapsing after the rollout was switched
 * off — breaking the requirement that shipped behaviour is unchanged while the
 * flag is off.
 *
 * `worktreeId` of `null` is a scope being CLEARED, not a selection: escaping a
 * scope must not collapse the thing you escaped to.
 */
export function shouldCollapseAfterSelection(args: {
  workbench: boolean;
  worktreeId: string | null;
  layout: HTMLElement | null;
}): boolean {
  const { workbench, worktreeId, layout } = args;
  return workbench && worktreeId !== null && layout !== null && isStackedLayout(layout);
}
