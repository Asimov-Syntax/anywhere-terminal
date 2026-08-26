# Proposal: project-worktree-agent-presence

## Why

The Worktree view renders agent rows today, but the host pushes an empty presence envelope, so
every worktree reads as "nobody is working here". `docs/PLAN.md` WT-004.1 turns that envelope into a
projection of this window's real panes — which agent is in which worktree, what it is doing, and how
strongly each of those two claims is proven.

## Appetite

M (≤3d)

## Scope

### In scope

- Attributing this window's terminal panes to worktrees by normalized longest-prefix match.
- Resolving each pane's agent identity by the documented precedence, with the evidence source
  carried intact rather than collapsed into a confidence score.
- Projecting each pane's activity from the host's own pane evidence, through the rules the terminal
  tab already uses, so the row and the tab cannot disagree.
- The two title rules the shared projection was built to receive: a shell title reclaims the pane,
  a decorative title proves nothing.
- Publishing presence with the tree on the existing push, and supplying the ranking key the
  repository listing already asks for.
- Bounding a rebuild: one process-table read, and session resolution memoized per pane.

### Out of scope

- External agent rows — agents running outside this window (WT-004.2, design § 3.5), including the
  typed registry outcome that task must add.
- Subagent rows and their lazy read on expansion (WT-004.3, design § 3.6).
- Any action a row can perform: focus, preview, resume (WT-005.1).
- Process-tree recognition of agents (identity rank 3), which needs a recognition table the repo
  does not have; deferred in `docs/PLAN.md`.
- Hook-published turn state (`activitySource: "hook"`), which Phase 6 owns.

## Risk Level

MEDIUM — no destructive operation and no new external surface, but this is the projection the whole
feature's credibility rests on: a row that overstates what it knows is the failure mode four later
tasks inherit.
