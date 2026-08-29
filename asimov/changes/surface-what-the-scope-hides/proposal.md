# Proposal: surface-what-the-scope-hides

## Why

WT-010.1 shipped a tab bar that hides panes belonging to other worktrees. It says *that* it is
filtering — the chip — but not *what* it is holding back. A hidden pane can go `waiting` where
nobody sees it, and selecting a worktree currently leaves the user looking at another worktree's
terminal, or at a blank region with no explanation and no way out but the chip. This change is what
makes that filter safe to leave on, and it is deliberately separated from the filter so its
correctness is reviewed on its own.

## Appetite

M (≤3d)

## Scope

### In scope

- A count of hidden `waiting` panes on the scope-clearing control, read from both evidence sources
- What a selection does to the active pane
- The region a surface shows when its scope holds no pane
- The no-invisible-filter invariant into `docs/DESIGN.md` § 8.4, its registry row, and a test that
  goes red when it is violated

### Out of scope

- Any change to which panes the scope hides — the attribution rule (I18) is WT-010.1's and is
  untouched here
- The rail, the segment toggle, and the inspector (WT-010.3 … WT-010.5)
- Flipping the workbench default (WT-010.6)
- Notifying outside this surface — no window-wide badge, no VS Code notification, no sound

### Must not

- Auto-clear a scope the user chose, on any condition, including an empty one
- Count, or offer to reveal, a pane the evidence does not place — it was never hidden
- Let either evidence source alone suppress a count the other would have raised
- Start, stop, close, or detach any pane as a consequence of a selection

## Risk Level

MEDIUM — the failure mode is silence: a `waiting` pane hidden with nothing said. It is invisible by
construction, so it cannot be caught by looking, only by a test that asserts the count against a
known hidden set. The union of two sources with different coverage is where an under-report hides.
