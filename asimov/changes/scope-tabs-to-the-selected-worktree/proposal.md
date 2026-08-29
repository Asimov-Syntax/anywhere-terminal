# Proposal: scope-tabs-to-the-selected-worktree

## Why

A window running agents in four worktrees shows one undifferentiated tab bar, so the user's own
attention has to do the filtering the tool could do. Selecting a worktree should make that
surface about that worktree. This is the thinnest end-to-end slice of the Phase 10 workbench and
lands first, behind a rollout setting, so the rest of the composition builds on a working filter.

## Appetite

L (≤2w)

## Scope

### In scope

- Worktree selection in the panel, and the treatment that marks the selected one
- A per-surface scope over that surface's own tab bar, and the join it rests on
- The scope chip and its clearing control, including while the panel is collapsed
- Per-surface persistence of scope, and its resolution against a tree that moved
- The `anywhereTerminal.worktree.workbench` rollout setting, off by default
- The hides-only-what-is-proven invariant, in the truthfulness table with a test that goes red

### Out of scope

- The attention badge counting hidden waiting panes — WT-010.2
- What a selection does to the *active pane*, and the empty-scope region — WT-010.2
- The two-level Worktrees / Sessions toggle — WT-010.3
- Rail composition and the sidebar auto-collapse — WT-010.4
- The inspector drawer — WT-010.5
- Cross-surface scope sync and editor-tab-per-worktree — rejected for this round in
  [worktree-scope.md](../../../docs/design/worktree-scope.md) § 2.3

### Must not

- Send scope to the host, or read it in any host handler — scope is webview-local state
- Add a second pane→worktree attribution path; the presence projection is the only one
- Start, stop, close, or detach any pane as a consequence of scoping
- Hide a tab the attribution evidence does not place
- Change any wire message shape, or add a field to the tree or presence envelope
- Let anything in this change take effect while the rollout setting is off

## Risk Level

MEDIUM — a filter over the user's own running terminals. The failure mode is not a crash but a
pane the user cannot find and cannot tell is hidden, which is why the invariant and the always-
visible chip are in scope rather than deferred with the badge.
