# Proposal: open-an-inspector-drawer-on-selection

## Why

Selecting a worktree scopes the tab bar and marks the row, and that is all it does. Everything a
worktree actually *is* — where it lives on disk, what can be done to it, which agents are in it and
on what models, what they delegated — is reachable today only through a right-click menu, a hover
hint, and two disclosure levels. The drawer is the one surface where those answers sit together,
and it is what makes the no-path-on-a-row rule affordable: the path has to live somewhere.

## Appetite

M (≤3d)

## Scope

### In scope

- A bounded detail region under the tree, opened by selecting a worktree and dismissed explicitly.
- The selected worktree's branch, full path, and the actions that act on that worktree.
- Its agent rows, each carrying the model identifier the list row withholds, and each agent's
  delegation history.
- Re-keying the model into the re-render guard, which stopped covering it when the model left the
  row.

### Out of scope

- Any new host message or protocol. Every action the drawer offers already has a handler and an
  id-resolving path.
- Repo-scoped actions — create and prune act on the repository and stay where they are.
- Persisting the drawer or the selection across a reload. Selection is an explicit act on every
  open, and the drawer follows it.
- Retiring the rollout setting (WT-010.6) or changing the tree's own row rendering.

### Must not

- Replace the panel body. Selection stays non-destructive: the list the user was comparing against
  stays on screen, so no back control is needed.
- Put a path on any list row, or a model identifier on one.
- Offer an action the surface cannot perform, or offer focus for an agent running outside this
  window.
- Take focus on opening, or change the tab-bar scope on closing.
- Grow a second set of action handlers, a second row renderer, or a second signature vocabulary
  beside the ones the tree already has.

## Risk Level

MEDIUM — no new protocol and no persisted state, but the drawer adds a second focusable region
inside a panel whose focus, re-render, and dismissal rules were each paid for over several review
rounds, and it re-enters the action surface that owns the destructive operations.
