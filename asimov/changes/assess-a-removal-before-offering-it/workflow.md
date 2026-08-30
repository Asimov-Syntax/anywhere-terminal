# Workflow State: assess-a-removal-before-offering-it

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork; worktree-removal.md § 2.2/§ 2.3/§ 3 settle every question this change asks
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

Blueprint: docs/PLAN.md task WT-013.1
Lane: full (standard) — L, and one decision breaks a structural assumption the current code documents as deliberate | flags: security-privacy
Direction (fastlane, no fork): worktree-removal.md § 2.2, § 2.3 and § 3 settle the taxonomy, the bounded walk and the re-evaluation rule. Nothing was left open for the plan to choose.
Scope: the orphan proofs (lock age, owning process, merged branch) are WT-013.2 and are excluded, `branchMerged` included. Rendering is WT-013.4. This task adds no UI.
Dependency risk: the provisioning manifest worktree-apply.md § 2.6 designs does NOT exist — nothing in src/ writes or reads one, and the apply path that would is unbuilt Phase 12 work. The differentiated branch is unit-verified against a fixture; the undifferentiated fallback is what actually runs until Phase 12 lands, so it is the branch the tests weight. Verified by grep, not assumed.
Knowledge candidate: `removalChecks.ts` documents its own gap — its header says `notApplicable` is never produced because the sources that answer it are WT-013.1's | Surprise: the task's hardest requirement was already scoped by the module that would implement it, which made discovery cheap | Evidence: src/worktree/removalChecks.ts#1-13 | Consumer: plan | Action: when a module names a future task in its header, read it before scoping that task
Planned at: 644dccae

Resolved (1_1, was parked): the park was mine to lift, not the user's to answer. `worktree-removal.md` § 3 says in as many words that "an external session we cannot ask about is not evidence of idleness", so the design was written KNOWING external activity is normally undeterminable and chose refusal deliberately; `worktree-actions.md:116` delegates the check set to it, so the confirmable rule the code comment cited is superseded rather than in conflict. The severity was also overstated: the registry lists only sessions whose pid is alive, so the worktree is unremovable while another Claude runs inside it and removable the moment that process exits — not permanently. Production supplies `activity: undefined` from `src/extension.ts` because the registry records none, which refuses honestly rather than on `presenceProjector`'s hardcoded "running".

Verify gate: biome reports 3 errors / 14 warnings, all reproduced on a clean tree at `c732ed7f` (before this change's first code commit) and confined to files this change does not touch — `src/webview/worktree/worktreeFormat.ts` (noUselessEscapeInRegex), `src/vault/VaultService.customName.test.ts` (noCommaOperator), and CSS noDescendingSpecificity.

Deviation (3_1): the task's `Verify` named `src/providers/WorktreeHost.actions.test.ts`; the re-evaluation it verifies shipped in `src/worktree/worktreeMutationService.ts`, and the host test drives removal through a stub, so that suite cannot observe the Outcome. Corrected to `src/worktree/worktreeMutationService.test.ts`. The Outcome is unchanged — only the suite named to check it. Flagged for the user rather than handed back, so the change did not stall on a path the plan mislocated.

Deviation (2_3): the task's Plan stopped at the assessment model. An `ignored` check whose one production producer supplied nothing would be permanently unproven — the benign-fallback failure D16 forbids — so the walk was wired end to end through the `removalFacts` seam the other two unheld evidence sources already use, with a `diskIgnoredDeps` adapter in `ignoredMaterial.ts`.

Knowledge candidate: `git status --ignored` defaults to `traditional`, which collapses an ignored directory to ONE entry — and stat-ing that entry sizes the directory inode, so a gigabyte `node_modules` reports a few hundred bytes | Surprise: the obvious call produces a plausible number that is wrong by six orders of magnitude, and no test that fakes the listing can catch it | Evidence: src/worktree/ignoredMaterial.ts#diskIgnoredDeps | Consumer: plan | Action: when a design says "count and size what is there", check whether the enumeration names files or directories before budgeting the stat
