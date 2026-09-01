# Workflow State: coalesce-assessment-requests-at-the-host

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(no real fork — see Notes)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(cycle 1 round 1, discovery — APPROVE, 0 findings)_
- [x] Gate: implementation approved
- [-] Blueprint sync complete — `Blueprint: none`; WT-013.4 is the parent change's task and it syncs it

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full (standard) — MEDIUM risk | flags: security-privacy (the assessment is the read that mints
force authority for an irrevocable deletion). `new-api-contract` was recorded at scaffold time for a
`postCritical` member on `WorktreeSurface`; the plan attack cut that decision, no wire message or
shared interface changed, and the flag is withdrawn rather than left standing over nothing.
Planned at: a72bc499
- No PLAN task, and that is deliberate: this change was minted by the remediation boundary rather
  than by the blueprint. It is the child of `render-the-removal-assessment-as-a-report`
  (docs/PLAN.md WT-013.4), which is PARKED complete-but-unapproved and DEPENDS on this one — its
  round-6 B5 and W6 are this change's whole subject, and WT-013.4's own Status stays with the parent,
  which syncs it on its own approval. docs/PLAN.md was deliberately not edited: minting a task there
  needs the user.
- Owner test run at Stage 1 and it lands on `own change`, both signals of the remediation boundary:
  the remedy needs a semantically changed `D#` (the parent's accepted D10 claim "a burst cannot back
  up the mutation queue" is false), and it mints an admission/serialization discipline for queued
  read work that no accepted plan owns. Contrast the round-4 handback, which correctly stayed an
  amendment because `mutationCoordinator.run` already existed and was merely adopted.
- No Gate 1: the four constructions were weighed and three rejected on stated grounds in design.md
  § Rejected. None of them differs in contract, cost or risk in a way the user would decide
  differently on, so it was a call to make rather than a fork to offer.
- No discovery.md: the evidence is the parent's `.reviews/round-6.md` and the shipped create-form
  identity flow, both of which already own it. Duplicating either here would give one fact two owners.
- The create form solved this problem first and its solution is the reuse: opening identity per
  surface, retire on close, an explicit repeat policy (`asimov/specs/worktree-panel/spec.md:1595-1641`,
  `WorktreeHost.ts:605-680,1940-1975`). This change follows it and deliberately DIFFERS on one point —
  a repeat supersedes rather than joins — which is stated in the spec delta so a reviewer reads it as
  a decision rather than a violation of the sibling rule.

Knowledge candidate: the panel cannot bound host work, and a guard that tries becomes a liveness bug |
Surprise: one webview guard produced both round-6 findings — B5 because it could not see the other
surface or the other row, and W6 because the same refusal blocked the re-ask that would have
recovered a dropped reply | Evidence: `WorktreeController.ts:1359-1366` vs
`.reviews/round-6.md` B5 and W6 | Consumer: plan | Action: when a bound is proposed on the webview
side of a host boundary, put it on the host and leave the panel only what it can observe for itself.

PLAN ATTACK (asm-oracle, 2026-09-01). Ran before Gate 2 as the goal directs. It REFUTED four of the
eight ledger rows and the artifacts were rewritten before the gate rather than after it. All four
refutations were accepted; nothing was rebutted.
- The bound itself was wrong, not just its wording. A pending slot keyed by `(surface, repository)`
  falls to attach-ask-detach repeated N times: detach deletes the record but cannot retract a queue
  job already appended, so N jobs sit ahead of a mutation with no surfaces attached. Replaced by ONE
  ASSESSMENT LANE PER REPOSITORY, which puts the bound on the queue's own key and makes R1 the
  constant 1 instead of a function of |S|. Round-robin over surfaces because two panels asking
  continuously must both be served.
- "The user always receives the answer to the question they are currently asking" is unachievable —
  a finite retry can fail — and it was also what made the first spec delta inadmissible. Both were
  rewritten to the property the mechanism actually has: a request is never left in a state where
  asking again does nothing. The residual is now an honest `n/a` row rather than a supported claim.
- Two rows were simply written wider than the mechanism: supersession does not always REDUCE
  fingerprint issuance (a successor arriving after its predecessor started yields two runs), and a
  replayed token is not necessarily stale (after a lost reply it is still live, so its reply opens a
  report). Neither is a defect; both are restated at their true strength, and the high-water mark
  stays rejected on the corrected ground.
- D3's justification was false and is replaced. Supersession does NOT mean the user moved on — the
  case that matters is the opposite, where they re-ask BECAUSE they are still waiting. The surviving
  ground is that the successor asks the same question, so serving it answers the user.
- D5 CUT, with task 2_1 and 2_2. A retrying `postCritical` on `WorktreeSurface` was justified by the
  row the attack refuted independently of retries, and charged real hazards for that non-benefit: a
  reply reordered behind traffic sent during its 50 ms sleeps, and a lengthened issue-to-redemption
  window the parent's ledger claims is unchanged. D4 already gives a lost answer its recovery. This
  also retires round-6 S1, which the chair had REJECTED as unreachable in production — `postCritical`
  was the only thing that would have made it reachable. My handback prompt called S1 accepted; the
  round file says rejected and the round file is right.
- Task acceptance was tightened where the attack showed a revert would pass: 1_3's ordering assertion
  was vacuous because the queue is already FIFO, so its Outcome is now the per-repository job COUNT;
  and 2_1's barrier-bypass step is declared as mutation evidence the task owes rather than something
  its Verify can observe, because the suite passes either way.
- Confirmed rather than changed: the re-enqueue lands at the tail because `mutationCoordinator.run`
  awaits `settle()` in its own `finally` before the host can re-enter `queue.run`; D4 preserves D11's
  single live token; `isBusy` has no production consumer; and the delta does not contradict the
  shipped create-form repeat rule, because join-for-create and supersede-for-assess are different
  message discriminants with different authority lifecycles.

- Built as four tasks, waves `1_1, 2_1 | 1_2 | 1_3`. No filler subagents: both waves were solo-sized.
- Verify Gate: check-types clean, `pnpm run test:unit` 6262/6262 across 269 files, `gate:fs-deletion`
  ok (46 modules, 1 declared carve-out), biome CHECK mode at the 3 errors / 14 warnings / 1 info
  baseline with none of them in this change's files. Write mode was never run.
- Every load-bearing line was mutation-checked rather than assumed. Dropping the lane's outstanding
  guard fails all four host witnesses and both scale witnesses (80 assessments in flight where 2 are
  allowed, 11 ahead of a removal where 1 is); dropping the rotation cycle fails the fairness witness;
  reusing the live token for a same-worktree repeat fails both D4 witnesses; and reverting
  `assessRemovalReport` to read the cache fails the strengthened assembly walk, so the barrier
  falsifier round 6 adjudicated still bites.
- The detach sweep SURVIVES its mutation and is kept anyway, with its comment corrected to say so.
  `pending` is non-empty only while a job is outstanding and `takeNextAssess` already drops a departed
  surface's entry, so the sweep buys retention promptness rather than an outcome. Recorded rather than
  dressed as covered — a reviewer should see the gap named.
- Two defects the tests caught that I would otherwise have shipped: the admission guard tested
  `pending`, which service had already cleared, so the rotation grew an entry on every re-ask — an
  unbounded list inside the change that exists to bound one; and the first fairness test could not
  tell round-robin from newest-first, because both surfaces' asks arrived in an order where the two
  agree. Reordering them so the newest belongs to the other surface kills newest-first.

Knowledge candidate: a rotation guard must be tested against the rotation, not against the queue it
serves | Surprise: `!lane.pending.has(key)` reads as the obvious "is this surface already waiting?"
and is wrong precisely for the surface being served, whose entry was just taken — so every re-ask
appended a duplicate and the fairness list grew without bound | Evidence:
`src/providers/WorktreeHost.ts` assess admission, caught by the fairness witness rather than by
review | Consumer: build | Action: when a structure is both a membership set and an order, assert the
membership against the ORDER, and write one test whose expected sequence differs under the
alternative policy.

- Review cycle 1 round 1 (discovery) returned APPROVE with 0 BLOCK, 0 WARN, 0 SUGGEST across six
  specialists. It adjudicated independently the two things I flagged for attack rather than hid: R1
  survives the `finally` schedule with no lost wakeup or second job, and the detach sweep is prompt
  retention cleanup rather than correctness machinery — the reasoning I recorded, confirmed rather
  than taken on trust. A specialist's constant-time rotation-membership proposal was rejected by the
  chair, since the scan is bounded by attached surfaces rather than by request history.
- `asm-review-reuse` reported to me directly as well as through the chair. Both say no findings, and
  the round file records the agent and its scope — checked, because a specialist result has gone
  missing from a chair report in this project before.
