# Review Round 6

- Date: 2026-08-27
- Cycle: 2
- Round: 6
- Mode: superseded
- Scope: commit `d9f389798f63ad1448067d223e469556ceb38b70` only
- Head: `d9f389798f63ad1448067d223e469556ceb38b70`
- Parent / prior reviewed Head: `b9633b1cd803bdb773819e53e5f857f5a1d7cc5c`
- Change context: `launch-agent-in-worktree` — Gate 2 approved
- Scope lock: failed
- Verdict: SUPERSEDED — no finding adjudication performed
- Counts: not adjudicated; round-5 gate set remains open
- Agents started before the semantic design change was isolated:
  - asm-review-logic — B5/B7 identity remediation — `gpt-5.6-sol[1M]`
  - asm-review-contracts — D10 and launch contract — `gpt-5.6-terra[1M]`
  - asm-review-frontend — Resume Here and create freeze — `sonnet[1M]`
- Specialist reports were not used or adjudicated after the scope lock failed.
- Verification evidence: `bun run asm change verify-status launch-agent-in-worktree` was readable and records task 8_1 at exit 0. No project verify command was run during review.

## Supersession reason

This commit is not only remediation against the cycle-2 gate set. It semantically changes approved
D10 and adds a new task contract for an authority boundary that round 5 did not approve:

- Round-5 B7 and its accepted triage required launch admission to fail closed while a containing
  repository was degraded.
- `d9f3897` instead divides degradation into two authority classes. A retained failed listing
  publishes no generation, while `markDegraded()` preserves the generation for an unwatched
  repository and D10 now explicitly says an unwatched listing may go stale unnoticed but keeps
  launch authority.
- Task 8_1 formalizes that new exception: a repository merely unwatched keeps its token.

Whether an explicitly unwatched repository may continue authorizing worktree launches is a new
semantic design decision, not verification of the gate set frozen by round 5. Under the verification
scope lock, this cycle cannot adjudicate that decision. The next user-initiated review starts cycle 3,
round 7, in discovery mode and reviews the new boundary end to end.

## Gate set carried forward without adjudication

- B5 — Resume Here carries registration identity across the webview-to-host boundary — accepted in round 5; not verified here.
- B7 — a failed observation cannot mint registration authority — accepted in round 5; not verified here because its boundary changed.
- W6 — exact identity-boundary regression coverage — accepted in round 5; not verified here.
- W7 — one admitted intent and bounded cache traversal — accepted in round 5; not verified here.

## Audit backlog carried forward

- S1 — Continue and worktree dialogs maintain parallel modal lifecycles.
- AB1 — the prune dialog remains outside `closeDialog` ownership.
- AB2 — entry-backed Continue ignores an explicit posture for a zero-choice agent.
