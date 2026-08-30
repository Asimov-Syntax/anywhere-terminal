# Workflow State: resolve-a-selection-before-the-create-runs

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork; worktree-create.md § 2, § 2.1, § 2.3 and § 6 name a command and a condition set for every mode, and worktree-rpc.md § 2.2 already specifies the message pair _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved (fastlane)

## Implement

- [ ] All tasks done (`tasks.md`)
- [ ] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-012.8
Lane: full (standard) — a new wire pair and a git mutation on the administrative directory, on the create path | flags: new-api-contract
Planned at: 16f3a192

- Admission screen: reattach's `git worktree repair` is arguably a second new invariant owner beside the resolver. NOT split — the blueprint packaged them, and splitting would ship a resolution that names a mode nothing can act on, which changes delivery semantics and is never auto-chosen under fastlane.
- D1 departs from worktree-rpc.md § 2.2 by adding the per-opening `token` to a pair the blueprint records without one. `query` echoes for staleness within an opening and cannot separate two openings of the same dialog on the same repository. Shipping a NEW message with a gap in order to match two pre-existing messages that have it would be choosing the defect; retrofitting those two stays out of scope.
- The resolution reads do not worsen WT-013.1 round-5 W3: they are bounded git invocations through the existing runner plus at most two small filesystem reads, on the create path rather than inside the removal assessment. It stays open and unwaived.
- 3_1 suite change, in full: both test files gained this task's reattach cases and nothing existing was weakened. The one non-additive edit is `harness()` in `worktreeMutationService.test.ts`, which returned its own shadowed `runner` const rather than `deps.runner` — so every assertion made against a test-supplied runner override was reading an object nothing had called. It now returns `deps.runner`; those assertions got stricter and all still pass.
- 3_1: `reattach` leaves `createWorktree` BEFORE the two-phase `validateCreatePath`, not inside it as the Plan's step 1 wording suggested. `intentFor` already maps reattach to `mustBeExistingDirectory`, but `validateCreatePath`'s later rule refuses a destination that is another worktree of this repository — and a stale registration still is one (`createContext.linkedWorktrees` includes prunable entries), so every reattach would have been refused by a check that exists to protect creates. A repair creates nothing; its guard is D3's conditions, re-established at the mutation. No D# changed.
