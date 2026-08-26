# Proposal: add-host-pane-evidence

## Why

Two of the six signals the worktree view needs to say who is working where — pane title and
waiting evidence — exist only inside individual webviews, and each webview sees only its own
surface's panes. The view's scope is the window, so a per-surface source under-reports by
construction. Every later presence task consumes this seam, so an incomplete one blocks all of
Phase 4.

## Appetite

M (≤3d)

## Scope

### In scope

- A webview→host direction for reporting a pane's normalized title and waiting evidence.
- A window-scoped, host-side store of per-pane evidence: title, waiting, last output, exit,
  agent semantic status — keyed by pane, surviving surface disposal.
- One shared rule set that turns pane evidence into an activity, used by both the webview's tab
  tracker and the host.

### Out of scope

- Projecting agent rows, attributing panes to worktrees, or resolving agent identity (WT-004.1).
- External rows, subagent rows, hook-sourced status (WT-004.2, WT-004.3, P6).
- Any change to what a surface currently renders.

## Risk Level

MEDIUM — a new cross-boundary message and a new host-side registry touched from the PTY data
path; the blast radius is the terminal tab's activity indicator if the shared-rule extraction
changes behavior.
