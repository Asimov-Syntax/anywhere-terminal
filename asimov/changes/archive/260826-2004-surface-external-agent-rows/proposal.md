# Proposal: surface-external-agent-rows

## Why

A worktree with a live agent started from another VS Code window or a bare terminal currently
renders as "nobody is working here". A worktree view that under-reports is worse than one that
says "external" — the user reaches for a tree someone else is already mid-edit in.

## Appetite

M (≤3d)

## Scope

### In scope

- Rows for live agent sessions running in a worktree from outside this window, labelled as such
- Distinguishing a registry that could not be read from a registry that is genuinely empty, at
  the reader and in what the user is shown
- Pacing the registry scan against whether any surface is showing the worktree view

### Out of scope

- Any action on an external row (open folder, resume here, copy resume command) — WT-005.1/WT-005.2
- Subagent rows under an external row — WT-004.3
- Turn-level state for external rows; without hooks there is no `waiting` to report — WT-006.3
- Agents other than Claude: the PID registry is Claude's, and no other agent publishes one
- The external row's label, chip and missing focus affordance, already drawn from fixtures in
  WT-002.1

## Risk Level

MEDIUM — the reader contract change reaches both terminal providers' session resolution, which
is the path that decides which vault session a pane is showing.
