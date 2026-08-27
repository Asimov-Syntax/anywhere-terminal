# Proposal: enumerate-git-worktrees

## Why

The Worktree view cannot be built until the host can answer "what worktrees exist, in which
repos" correctly. Every later phase — panel rendering, agent presence, actions — keys off a
worktree identity that must survive symlinks and drive-letter spelling, or a worktree the user
is actively working in silently shows zero agents.

## Appetite

M (≤3d)

## Scope

### In scope

- Resolving the workspace's git repositories and deduping them by their shared git common dir
- Enumerating every worktree of each repo, with the state git reports carried through unaltered
- The one path normalizer every later comparison boundary depends on
- Deterministic ordering within a repo group
- Degrading a scope with a reason — unusable git, too-old git, a repo whose listing fails,
  an unparseable record — instead of emptying it or throwing

### Out of scope

- Watchers, invalidation, and the per-repo cache — WT-001.2 (`worktree-model.md` § 3.5, § 3.6)
- Retaining a repo's **last good** listing across a failure: it needs the cache WT-001.2 owns.
  This change reports the failure; it has nothing to fall back to
- Any host↔webview message — WT-001.2 (`worktree-rpc.md` § 2)
- Agent presence, activity, and the live-pane ranking that feeds ordering step 2 — P4
- Any UI, and any worktree mutation (create/remove/lock/prune)

## Risk Level

MEDIUM — path identity is cross-platform and silent when wrong: a normalizer that disagrees
with the process table produces a tree that looks correct and attributes no agent to any row.
