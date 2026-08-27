# Proposal: stop-wasted-worktree-renders

## Why

All three worktree surfaces register `retainContextWhenHidden: true`, so a webview VS Code has
hidden keeps its DOM — and keeps its `worktreeViewVisibility: true` declaration, because nothing
ever falsifies it. Every watcher-driven rebuild for the rest of the session therefore serializes
the whole tree into an invisible webview and posts it. Audit finding B1 of
[docs/audit/2026-08-26-worktree-tree-review.md](../../../docs/audit/2026-08-26-worktree-tree-review.md).

`wire-live-worktree-tree` declared this out of scope because "the host has no signal for it". That
premise is false and is the reason to revisit rather than inherit the decision:
`webviewView.onDidChangeVisibility` is subscribed seven lines below the worktree attach in the same
function, and the editor panel has `onDidChangeViewState` — both already carry the falling edge.

The second half of WT-003.2 is the coverage proof its Notes ask for. The render guard is wired and
its key is complete over today's types, but the test that proves so is six hand-written mutations.
Phase 4 adds fields to the presence rows; a field that lands in the wire type and not in the key
renders stale forever, with no failing test and no compile error. This task is the last cheap
moment to make that impossible.

## Scope

In:

- The falling edge — a surface stops receiving pushes while VS Code is not displaying it, and
  receives current data when it is displayed again.
- A structural coverage proof for the render-guard key, replacing the hand-listed mutations.

Out:

- The re-render guard itself — already implemented at `WorktreeView.ts:155`; this change adds no
  DOM-path work.
- Stopping the rebuild while every surface is hidden. The cache staying warm is what makes serving
  a re-shown surface from cache correct; watching is cheap and dropping it would trade a real
  correctness property for a saving this change does not need.
- The remaining `5fd32ec` warnings — the collapsed Refresh, the missing failure message, and the
  unscoped refresh marker are wiring defects, not render discipline.

## Appetite

S (≤1d)

## Risk

LOW. One new per-surface flag on a gate that already exists, and a test that only tightens. The
one behavioral edge is a surface that is displayed again: serving it a stale cache instead of
current data would be worse than the bug being fixed, so it is the spec delta's own scenario.
