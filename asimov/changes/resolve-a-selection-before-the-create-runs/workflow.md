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
- 2_1: the probe rides the enumeration the dialog's OPENING already took, held per repository as the in-flight promise, rather than calling `readRefs` itself. D2's headline says classification takes no new git invocation, and `src/extension.worktreeAssembly.test.ts` already asserted exactly one `for-each-ref` per opening — a probe that re-read broke that invariant on its first run. A settle landing inside the read window joins it; a settle before any opening asked resolves `fresh`, which is D2's documented fail-open.
- 2_1: `worktreeCreateProbe`'s `candidatePath` is honoured only inside the configured create root (`isPathInside`). The resolution states whether a path is occupied, and an unbounded override would turn a message the form sends per settled edit into an existence oracle for the whole filesystem. Not a D#-level change — D1 already calls the field an override, and this is the containment every host-side path already carries.
- 2_1: `occupiedCandidate.disposition` is built directly as `ResolvedDisposition`, never through `reportableDisposition`. Nothing in `src/` produces a wire `DestinationDisposition` yet (WT-012.12 owns debris authorization), so routing through the wire type would have meant minting the authorization D4 exists to withhold. A registered worktree reports `free`; a directory nobody registered reports `debris`.
- One unexplained flake, on the first full-suite run of 2_1 and not on the second: `src/vault/snapshotPool.test.ts > refuses a snapshot to a caller that was waiting out another production` failed with `expected 'resolved' to match /disposed/`. In no file this change touches, and the same assertion flaked once before during WT-013.2. Recorded rather than ticked around.
- 2_2: `WorktreeBranchMode` gained `reattach`, and `WorktreeController` builds the wire `reattach` mode from the resolution it holds. Not scope growth — 3_1 executes a repair and 2_1 offers one, and with no seam between the form and the wire the spec requirement "the create SHALL repair the registration in place" would have shipped unreachable. No D# changed: D5's rule is that the base control derives from `draft.branchMode` alone, which a fourth member preserves.
- 2_2: `heldBranch()` returns undefined under `reattach`. `heldBy` comes from `readRepoRefs`, whose `RepoRefsWorktree` has no `prunable` field, so a stale holder is reported exactly like a live one and the guard that stops a branch being checked out twice would also have stopped the one action that repairs it. The resolution is what tells the two apart — `blockedBy` for a live holder, `reattach` for a stale one.
- 2_2: the disabled base ref carries `wt-fhint`, the class the partial-list note already uses. `docs/ui/worktree-create-dialog.css` is owned by the external design pass and was not edited, and no new class was invented that would need it.
- Knowledge candidate: `src/extension.worktreeAssembly.test.ts` hand-mirrors `src/webview/main.ts`'s router handler map instead of using it | Surprise: the test written to catch "declared, posted, handled, never routed" reproduced that exact gap in its own harness — the resolution was posted and dropped, and the failure looked like a classification bug for three debug cycles | Evidence: src/extension.worktreeAssembly.test.ts#worktreeHandlers vs src/webview/main.ts | Consumer: plan | Action: a task adding an Extension→WebView message must add the handler in BOTH places, or the assembly test proves less than it claims; a future change could have the harness import main.ts's map instead.
