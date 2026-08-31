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
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

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

Planned at: 9f261154

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
