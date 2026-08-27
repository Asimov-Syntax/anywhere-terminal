# Proposal: cache-and-broadcast-worktree-tree

## Why

`src/worktree/` can answer "what worktrees exist" but nothing calls it: the tree is rebuilt
from scratch on every hypothetical read, nothing learns when it changed, and no webview can
reach it. The panel phases (WT-002, WT-003) cannot start against a contract that does not
exist, and the naive version of this — a recursive watch on `.git/worktrees` — relists several
times a second while an agent works, which is the difference between a usable panel and one
that fights the user.

## Appetite

M (≤3d)

## Scope

### In scope

- Per-repository caching of the worktree listing, and of the resolved repository set, for the
  life of the window.
- Learning that a listing changed, from narrowly scoped filesystem watches and from workspace /
  git-extension events — never from a timer.
- Rate discipline: collapsing a sustained signal stream into a bounded rebuild rate, while
  leaving a forced refresh immediate.
- Degradation that keeps the last good answer instead of reporting an empty one.
- The host↔webview message family for reading and receiving the tree, and the window-scoped
  ownership that lets several surfaces share one set of git reads and watchers.
- The typed failure outcome the shared watcher pool needs before a failed watch can be reported
  at all.

### Out of scope

- Any webview rendering — no panel, no segment, no row. The webview senders for these messages
  arrive with WT-002.1 / WT-003.1; this change ships the host half and the contract.
- The presence projection itself. Its envelope ships here and travels empty; WT-004 fills it.
- Every mutating action (create, remove, lock, prune, launch) and its confirmation protocol —
  `worktree-actions.md`, later phases.
- Persisting anything to disk. The tree is derived state; a cold window rebuilds it.

## Risk Level

MEDIUM — the watch is narrow by construction rather than by tuning, and getting it wrong
degrades every window with an active agent rather than failing visibly; the message envelope
is consumed by four later tasks, so a shape that changes later is expensive.
