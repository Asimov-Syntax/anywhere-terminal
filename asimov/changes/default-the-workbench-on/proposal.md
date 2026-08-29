# Proposal: default-the-workbench-on

## Why

`anywhereTerminal.worktree.workbench` was a rollout gate, and the rollout is finished. WT-010.1
through WT-010.5 are all archived, so every piece the gate was protecting — the scoped tab bar, the
two-level toggle, the rail composition, the after-selection collapse, and the inspector drawer — is
built and reviewed. The gate now buys nothing and costs a second supported layout: every one of
those surfaces carries an OFF arm that renders the pre-workbench UI, and every one of them is a
second path to test, review and keep working forever.

It is also why nobody sees the redesign. The setting defaults to `false`, so a default install still
gets the shipped four-segment control, an unselectable tree, no scope, and no drawer.

## Scope

- Retire the setting: remove the manifest declaration, its reader, its change matcher, the init
  field and the live-change message that carry it, and the router hop that dispatches it.
- Delete the OFF arm everywhere it branches: the flat four-segment control and the CSS hook that
  styles it, the selection gate, the inspector gate, the scope coordinator's inert mode, and the
  rail-collapse predicate's flag.
- Delete the deps that carried it — `VaultPanelDeps.workbench`, `TabBarScopeDeps.workbench`,
  `WorktreeViewDeps.workbench`, the controller's `init.workbench`, `setWorkbench` and
  `isWorkbenchEnabled` — rather than leaving them accepted and ignored.
- Update the specs and the design docs that describe the setting as live.

## Non-goals and must-nots

- **Must not** leave the retired path merely unreachable. A branch nothing can enter, a CSS rule
  nothing can match, or a dep nobody passes is the outcome this task exists to prevent.
- **Must not** silently change what a user who set the flag to `false` gets *besides* the
  workbench. Their scope, grouping, collapse set and expansion state are all persisted under keys
  this change does not touch, and they keep them.
- **Must not** widen scope into the surfaces themselves. Every behaviour the ON arm has today is
  already reviewed and ships unchanged; this change only removes the choice of not having it.
- Not in scope: the `worktreeScope` persisted key, which belongs to the scoped tab bar and
  survives; the deferred filter popover; the WT-009.5 audit backlog.

## Appetite

Small. The change is mechanical deletion across roughly forty call sites and about fifty OFF-arm
test cases, with no new behaviour to design. The size is in the breadth, not the difficulty, and
the risk is entirely in what gets missed.

## Risk

The failure mode is a partial retirement: a branch removed but its dep left accepted, a test still
mounting with the flag off and passing for the wrong reason, or a CSS class no longer emitted but
still styled. `re-review` is on the task for exactly this — the reviewer reads the diff for what is
left behind rather than for what was added.

The second risk is the test suites. Several controller and state suites default their `mount`
helper to the flag off; flipping those fixtures changes what those tests see — a selectable tree,
a marked card, `aria-selected` on rows — in suites that are not about the workbench at all. Those
have to be read case by case, not batch-edited.
