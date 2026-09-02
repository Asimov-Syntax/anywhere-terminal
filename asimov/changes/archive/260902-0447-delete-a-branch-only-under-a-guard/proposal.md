# Proposal: delete-a-branch-only-under-a-guard

Blueprint: docs/PLAN.md task WT-013.3.

## Why

Removing a worktree leaves its branch behind. When that branch is provably merged, the user is left
to go and delete it by hand, in a second tool, having just been shown the proof that it is safe.

## Scope

An opt-in control in the pre-removal report offering to delete the branch, executed after the
removal succeeds, guarded by the two OIDs the merge proof was taken against.

## Non-goals / must-not

- **`git worktree remove` never touches the branch.** Deletion is a separate command, after.
- **Never on by default, never implied by removal**, and never unlocked by the typed confirmation
  that the removal itself may require — that confirmation is about the directory.
- **Never the default branch**, and never a branch checked out in another worktree.
- Not offered at all when the merge proof is `failed`, `unproven`, or `notApplicable` — absent
  rather than present-and-disabled.
- No force delete. There is no `-D` equivalent anywhere in this change.

## Appetite

M. One new evidence field on an existing proof, one wire field each way, one guarded command.

## Risk

This **reverses a recorded rule** that branch deletion is never part of removal. The reasoning that
produced that rule is preserved intact — it turned on the word *silently*, and this is off by
default, proof-gated and guarded. The residual is stated in design.md D5 rather than argued away.
