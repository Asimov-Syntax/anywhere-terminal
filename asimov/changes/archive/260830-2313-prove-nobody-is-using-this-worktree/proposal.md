# Proposal — prove nobody is using this worktree

## Why

`worktree-removal.md` § 4 names three proofs that together identify a worktree nobody is using any
more: its lock is stale, no process is recorded as owning it, and its branch is merged. WT-013.1
built the assessment those proofs belong to and left the `proof` class in the check vocabulary with
nothing in it. Until they exist, a user deciding whether to remove a worktree is reading only what
would be DESTROYED and nothing about whether the worktree is still wanted.

The proofs are also the only reason WT-013.3 can exist: branch deletion is offered exclusively
against a proven merge, so nothing downstream can be built until the proof is.

## Scope

- Three checks in the existing catalogue, class `proof`, each reading the source § 4.1 names.
- One registry read answering two questions — the live external sessions the assessment already
  uses, and the dead-or-absent distinction the ownership proof needs.
- Default-branch resolution from local refs, used only by the merge proof.

## Non-goals

- **No UI.** WT-013.4 renders the report; this task adds no webview code.
- **No branch deletion, and no `BranchDeleteOffer`.** The type exists and stays unproduced; WT-013.3
  owns the opt-in and its OID guard.
- **No automatic reaping.** § 4 is explicit that the proofs inform a human decision rather than
  replace it, and nothing here removes anything.
- **No fetch, ever.** A stale local default branch reports unproven; it never reports a wrong answer.

## Must not

- A proof must never refuse a removal, require a typed confirmation, or re-prompt a granted one.
  `atRisk` and `isIdentityPreservingSubset` are risk questions and a proof is not a risk.
- No second scan of the session registry directory. One read, two questions.
- No path containment written by hand — `src/utils/pathBoundary.ts` is the only definition.

## Appetite

M. Three checks and one reader change, in a subsystem whose shape WT-013.1 just settled.

## Risk

MEDIUM, and concentrated in one place: the ownership proof changes a reader four other call sites
share, and getting its default wrong would change what the presence panel shows. The mitigation is
that `listRunningClaudeSessions` keeps its exact current behaviour and a second export answers the
new question from the same parse.

The merge proof's risk is a wrong answer rather than a crash — reporting "merged" about a branch
that is not would, through WT-013.3, offer to delete it. That is why every non-zero, non-one exit
from `merge-base` is unproven rather than interpreted.

Carried in from WT-013.1's round 5 and **not** addressed here: a filesystem read that outlives its
deadline is abandoned rather than cancelled, and nothing dedupes abandoned reads across assessments.
The lock proof adds one `stat` of one small file, and only when the worktree is locked — a bounded
read, not a walk — so it does not change that finding's shape, but it is one more read that a
stalled mount could strand. It stays open and unwaived; folding it in here would mint the invariant
owner that finding needs, which is a change of its own.
