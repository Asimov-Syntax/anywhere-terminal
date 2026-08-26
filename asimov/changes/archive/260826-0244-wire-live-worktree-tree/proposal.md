# Proposal: wire-live-worktree-tree

## Why

The Worktree panel renders from static fixtures while the extension host already builds, caches, watches, and broadcasts the real tree. Nothing connects them, so the segment shows another workspace's sample repository — and the panel cannot open on the Worktree body by default, because choosing that default needs repository knowledge the webview does not have.

## Appetite

S (≤1d)

## Scope

### In scope

- The Worktree view is driven by the host's tree instead of fixtures, including its loading, refreshing, and empty states.
- Each surface declares whether it is showing the view, and asks for the tree when it starts to.
- The opening view is derived from whether the workspace holds a git repository, with a recorded choice always winning.
- Withdrawing every control whose effect the view cannot yet produce, now that the data under it is real.

### Out of scope

- Agent presence — the host ships an empty envelope until WT-004.0.
- Every worktree action (open, reveal, copy, terminal, lock, prune, create, remove) — WT-005 / WT-006.
- Re-render discipline against live inputs — WT-003.2 owns proving the signature covers them.
- VS Code hiding a whole webview: the host has no signal for it, and the existing visibility gate is not extended to cover it.

## Risk Level

LOW — the host contract is already built and specified; this change is the webview half of a seam that exists, plus one new boolean on the init payload.
