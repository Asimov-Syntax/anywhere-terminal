# Proposal: launch-agent-in-worktree

## Why

The worktree panel draws an agent picker, permission postures and a seed-prompt field, and
none of them do anything: there is no way to start an agent in a worktree, and `openAfter:
"agent"` is a mode the create form hides because the host would reject it. The launch stack
underneath can only *return to* a session that already exists.

## Appetite

M (≤3d)

## Scope

### In scope

- A declared fresh-start capability on the agent registry, and the argv expansion that makes a
  prompt optional.
- An explicit working-directory override on launch, so resume-into-a-worktree is expressible.
- Starting an agent in a worktree from the panel, and resuming an existing session into one.
- The create form's `agent` mode: same launch path, run after the create succeeds, reported as
  a partial success when the launch fails.
- Host validation of the agent, posture and prompt a launch names.

### Out of scope

- Writing a prompt into a pty and submitting it separately — every agent in the registry accepts
  a prompt as argv, so the writer has no consumer yet. This is a deliberate deferral of
  `docs/design/worktree-actions.md` § 4's fallback (design D3) and is recorded in
  `docs/PLAN.md` § Deferred rather than left implicit.
- Filtering the launch environment — deferred in `docs/PLAN.md` and unchanged here.
- Any hook, presence or turn-state work: a launched agent is observed by the presence
  projector exactly as a hand-started one is.

## Risk Level

MEDIUM — it adds a public message contract and a new spawn path, and the spawn takes
user-authored text (the prompt) and a user-chosen permission posture, including a dangerous one.
