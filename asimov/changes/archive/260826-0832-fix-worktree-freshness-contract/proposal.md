# Proposal: fix-worktree-freshness-contract

## Why

`cache-and-broadcast-worktree-tree` shipped without review. Its headline invariant — a failed
rebuild retains the worktrees rather than reading as a deletion — holds for one of three failure
modes; the other two empty the tree, and one cannot be recovered by a forced refresh for thirty
minutes. Separately, a structural signal arriving mid-rebuild is dropped with nothing scheduling a
follow-up. Findings A1–A3 and B2 of [docs/audit/2026-08-26-worktree-tree-review.md](../../../docs/audit/2026-08-26-worktree-tree-review.md);
WT-004.0 builds directly on this cache, so the contract has to be right before presence lands on it.

## Appetite

M (≤3d)

## Scope

### In scope

- Retention across every way a listing can fail to be produced — failed rebuild, unresolvable
  repository, unavailable git — under one definition of degraded.
- Rebuild scheduling: no structural signal is lost, and a forced refresh is never answered by a
  rebuild that already read git.
- Watch cost: no recursive watcher over a repository's git directory.
- The view change that makes retention observable rather than hidden behind the git-unavailable
  empty state.
- Single owner for the four presence types now declared on both sides of the wire.
- The four tests that pin the above defects as contracts, and the watcher-pool test double that
  cannot express a partial watch failure.

### Out of scope

- The visibility falling edge (audit B1) — goes to WT-003.2 with the rest of the re-render work.
- Everything else in the audit's § C for `5fd32ec`: the collapsed Refresh, the missing
  `worktreeTreeError`, the `refreshing` request id.
- `404d4c1` (`add-worktree-panel-shell`) — separately reviewed, untouched here.
- Presence projection content: WT-004.0 still owns it; B2 only moves where its types live.

## Risk Level

MEDIUM — touches the cache, the gate, and the watch set that every later worktree task builds on,
and two of the four fixes require rewriting tests that currently assert the defective behaviour, so
a mistake is not caught by the suite staying green.
