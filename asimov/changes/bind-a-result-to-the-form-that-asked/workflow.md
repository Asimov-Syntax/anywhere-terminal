# Workflow State: bind-a-result-to-the-form-that-asked

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [x] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-012.16
Lane: full (M) — new-api-contract, cross-boundary | flags: new-api-contract, cross-boundary

Auto-decision (fastlane): no real fork. The panel already mints a per-opening token and three
messages already echo it, so extending that identity is reuse rather than a choice between designs
(D1). The alternative — a second id owned by the create form — was rejected without asking, because
two staleness rules on one form is the defect this change removes.

Planned at: 7067bd9a

2_2: D5's eviction (`offers.forgetSurface` on close) has no behavioural witness in the host suite —
`offers.lookup` still has no caller in `src/`, so nothing redeems an offer id yet (WT-012.2 owns the
first redeemer). The retirement's two other effects are witnessed and mutation-verified; the eviction
rests on `offerStore.test.ts`'s own `forgetSurface` coverage until a redeemer exists.

Verify gate: `src/vault/snapshotPool.test.ts` and `src/extension.worktreeAssembly.test.ts` each
flake intermittently under the full suite and pass on re-run — pre-existing, in files this change
does not touch. Observed pass is a clean 269/269.

Round 1 (REJECT, 6 BLOCK): B1, B3, B5 and B6's identity half fixed and mutation-verified in
ec53cc98. B2, B4 and B6's liveness half PARKED — each needs a changed D5 or an unanswered D4
question, and B2 hands retirement the debris authorization boundary, which is this project's named
carve-out of "never delete files directly". Fastlane does not auto-choose an artifact handback, so
the cycle stops here for the user. Triage for all six: .reviews/round-1.md.
Review chair master id for resume: aac873a6ab140b708.

Handback (round 1, B2/B4/B6b): Gate 2 reopened. NOT a new change — B2 does not mint a new invariant
owner, it corrects D5's scope to match a spec requirement that was already accepted ("The extension
SHALL treat a retired opening as holding nothing: a result arriving for one SHALL mint no authority,
publish nothing, and leave no state behind"). D5 under-scoped that to the provisioning offer. D4 is
likewise corrected on a question it simply never answered. Both are mechanism decisions inside
accepted external behaviour, so fastlane takes them; neither is a product-scope fork.

Auto-decision (fastlane, D4): a FAILED provisioning read may be retried within its opening. The
alternative — one attempt per opening, ever — makes a transient filesystem error cost the user the
whole provisioning section until they close and reopen the form, and the spec bounds reads to one
per opening for duplicate DELIVERY, not one attempt per opening.

Round 1 closed: all six BLOCKs fixed (B1/B3/B5/B6a in ec53cc98; B2 in 8b06a240; B4 in 7ed9cd15;
B6b in 9442228d), plus the cross-repository late publish asm-review-logic reported directly and the
chair's report does not carry. Verify gate re-run green: 269 files / 6167 tests, check-types clean,
biome 3/14/1 baseline.

Thrash-stop option 3 elected (bounded extension), fastlane. The guard fired on trajectory
"r1 REJECT 6 -> r2 superseded REJECT 6", but r2 adjudicated nothing: it was superseded because I
dispatched it as a VERIFICATION round when the range carried rewritten D4/D5 and tasks 4_1-4_3. The
6->6 is that accounting, not a fix that failed — every round-1 blocker is fixed, mutation-verified,
and the gate is green. Options 1 and 2 are the two fastlane excludes and both misdescribe the state:
nothing needs designing and no blocker is unresolved.
Bounded: ONE round, no scope growth. Hypothesis to test — the six accepted blockers plus the
cross-repository late publish are closed by ec53cc98 / 8b06a240 / 7ed9cd15 / 9442228d, and the
wire-contract lens that never returned in round 1 has still not seen this change.

Round 3 closed: B2 fixed in 7067bd9a (task 4_4). `requestWorktreeRefs` was the writer that CREATES
the `openings` record retirement sweeps, and it validated nothing — so replaying a retired token
rebuilt the record and restored deletion authority. A hole in round-1 B2's own fix. Guard is
equality with the surface's live opening, plus a liveness recheck in each continuation; three
witnesses, three of four mutants killed (the fourth, `namedOpening` at that door, is redundant
behind the equality by construction and is documented as defence in depth rather than given a test
that cannot fail).

Round 4 superseded (0 adjudicated). Trigger is NEW to this project's record: not a `D#` or spec
change — `design.md` and `spec.md` are byte-identical across the range — but the new TASK 4_4
carrying its own Acceptance outcome, Plan and Boundary. The chair's verification scope lock treats
any new or semantically changed task contract as a new discovery cycle. The pre-flight diff must
therefore cover `tasks.md`, not just `design.md` and `spec.md`, and a fix task has to be committed
outside the range handed to the reviewer.

Handback (round 4): Gate 2 reopened for the task 4_4 delta, fastlane. NOT a new change and not a
product-scope fork — the round-4 chair certifies it itself: "No new invariant owner is claimed: task
4_4 remains inside D5's existing opening-retirement owner. Extraction is not required." 4_4's
Outcome restates an already-accepted spec requirement (a retired opening mints no authority,
publishes nothing, leaves no state behind) at the one door that still violated it, so it is a
mechanism obligation inside accepted external behaviour.

Premise audit (mandatory at the cycle cap): passed, nothing to cut. Both adjudicated rounds split
100% feature — round 1 "6 feature / 0 machinery", round 3 "1 feature / 0 machinery". No machinery
was admitted for an unevidenced state, so the scope-cut handback does not apply.

Thrash stop at round 5 resolved by option 1, which the cycle cap makes MANDATORY at a third cycle
rather than a choice: hand back to plan. Options 2 and 3 are unavailable anyway — no user has
risk-accepted anything, and the bounded extension was spent on round 3. The 1->1 trajectory that
fired the guard is again supersession accounting: round 4 spawned no specialist and adjudicated
nothing, so B2's fix has never been looked at. Adjudicated-round trajectory is 6 -> 1.

Round 5 (discovery, cycle 3): WARN — 0 BLOCK, 1 WARN. Every prior blocker adjudicated fixed,
including round-3 B2. Five lenses ran; four returned nil. Three of them reported out of band to the
coordinator rather than the chair, and data-security's first report was a bare nil that the chair
resumed for explicit coverage before accepting — worth remembering, since round 1 lost a finding
exactly this way.

W1 accepted and fixed in 50f90b8d (task 5_1) rather than deferred as an ordinary WARN. Reason is
timing, not severity: `asm change apply` writes this spec delta into the durable specs at archive,
so leaving it open would have committed "sent on every request that belongs to that opening" while
`worktreeCreate` demonstrably carried none. Equality, not consumption — consumption would be a new
decision needing its own `D#`.

Auto-decision (fastlane, W1 fixture strategy): fixtures were given a real opening rather than having
assertions relaxed. This mattered most for the refusal cases, which without a live opening would
have passed by hitting the new guard instead of the shape checks they exist to exercise. Four panel
cases now open a real form so the asserted opening is 1 rather than 0 — a value `openCreateForRepo`
can never post, since it advances the counter before it asks.

The `[4_1]` assembly walk caught a real regression this introduced: it hand-sent a create with no
form open, and its `git worktree repair` assertion failed until the walk opened one. It failed in
isolation, not only under the full suite, which is what distinguished it from the known flakes.
