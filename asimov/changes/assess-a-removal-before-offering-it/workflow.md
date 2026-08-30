# Workflow State: assess-a-removal-before-offering-it

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork; worktree-removal.md § 2.2/§ 2.3/§ 3 settle every question this change asks
- [x] `asm change validate` passes
- [x] Gate 2: plan approved (re-earned twice: after round-1 B2 → D6 + task 4_2; after cycle-2 B4/B5 → D3 and D6 revised, tasks 5_1/5_2 scaffolded. fastlane)

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

Review round 1 (cycle 1, discovery): REJECT — 4 BLOCK, 1 WARN, 1 SUGGEST, all accepted after verification, triaged in `.reviews/round-1.md`. B1/B3/B4/W1/S1 fixed in task 4_1 (`6bef3219`); the Verify Gate was re-run and passes.

B2 is NOT fixed and is handed back to `asimov-plan`. An idle Claude pane in THIS window writes its own user-wide registry entry, and `removalFacts.externalSessions` maps every registry session to `activity: undefined`, which refuses — so a worktree with an idle local Claude pane is unremovable until that process exits, against the accepted rule that idle panes are confirmable. This change introduced it: before 1_1 every external session was confirmable. The fix needs a producer for "which registry sessions does this window already hold"; that set exists only as a local inside `presenceProjector`'s window pass, built by `identify()` (process-table reads and heuristics), and task 1_1's Boundary forbids the removal path depending on the presence projection. Per the remediation boundary that is a designed fix, not remediation — and a safety decision about what refuses an irreversible removal is never fastlane-auto-chosen.

Round-1 note: `asm-review-reuse` messaged this session directly with a duplication finding (two copies of a `git status --porcelain` line parser) that did not reach `.reviews/round-1.md`; only its C-quoting half survived, as W1. Its stated failure scenario did not hold — the two quote strips were character-identical, so the copies could not disagree — but the duplication was real, and the B3 fix removed it: the adapter no longer parses porcelain status lines at all.

Knowledge candidate: `git status --ignored` reports an ignored DIRECTORY as one record in BOTH `matching` and `traditional` modes (git 2.50.1) — `git ls-files --others --ignored --exclude-standard -z` is the one that names the files | Surprise: I wrote a code comment, a commit message and a passing unit test all asserting the opposite, because the test faked the output instead of probing git | Evidence: src/worktree/ignoredMaterial.ts#diskIgnoredDeps, .reviews/round-1.md B3 | Consumer: plan, debug | Action: when a task's correctness rests on an external tool's output shape, probe the tool once before designing around it — a hand-written fixture proves only that the code matches the fixture

B2 resolved in task 4_2, not left handed back. `PresenceProjector` publishes the claimed-session set its window pass already builds, and the removal producer drops registry sessions this window holds — so a Claude in a local pane is counted once, as the idle pane it is. Two things fell out of it: the assembly test's projector fake was STUBBING that member, which would have made the assembly agree with the bug rather than catch it, so it delegates to the real projector; and the ignored walk added a fourth serial await to the window round-9 B8 closed, so the four independent reads in `assessRemoval` are now taken together — one suspension point, narrower than before this change. No test caught that second one.

Review round 2 (verification): SUPERSEDED, and the chair was right. Fixing round-1 B4 I gave git its own full `MAX_IGNORED_MS` and then wrote design.md and the module doc to say the walk's bound was one budget PER PHASE. That is a change to what D3 decided, not the enforcement of it that accepting B4 authorised — and it left three artifacts disagreeing, since D3's own opening and tasks.md 2_3 step 2 both still said ONE budget across both phases. Task 4_3 restores the approved contract rather than seeking approval for the new one: `measureIgnoredMaterial` owns the deadline and hands `ignoredEntries` the time still LEFT in it, so time spent listing is time the sizing no longer has and the total is bounded by `MAX_IGNORED_MS` rather than twice it. Verified by mutation — restoring the full cap in either place fails three cases.

Cycle 1 closed as superseded. The next review is cycle 2's discovery round and the round cap restarts with it.

Review cycle 2, round 3 (discovery): BLOCK — 2 findings, both accepted, both verified against the code rather than taken on report.

B4 partly fixed in task 4_4. Two boundaries were plain wiring defects: `src/extension.ts` injected `run: (args, cwd) => runner.run(args, cwd)`, a two-parameter wrapper that silently dropped the third, so every deadline tasks 4_1 and 4_3 computed was discarded at the production boundary — while the module's unit test, asserting against its own injected fake, stayed green throughout. And `execFile` reads a timeout of `0` as NO timeout, so flooring a spent budget at zero disabled the bound it expressed. Both closed, the first mutation-checked at the assembly boundary. The remaining two boundaries — streaming and cancelling git at the entry cap, and a deadline around each `lstat` — need a `GitCommandRunner` that can stream (it returns a fully buffered result) and a cancellable stat. Those are new capabilities and a changed D3, which is exactly what round 2 established I may not land as a fix.

B5 accepted and NOT fixed. `claimedSessionIds()` is the last COMPLETED window pass; an identity is claimed before the pane is attributed to a worktree, and `PaneFact` carries no session identity for the assessment to join on — so a live Claude rooted in the target can vanish from BOTH evidence sources when its claiming pane has no attributable cwd, or when pane evidence moves before the debounced projection catches up. **design.md D6 is wrong as written**: I claimed the degradation is toward refusing, which holds only before the first pass; a stale or unattributed claim degrades toward PROCEEDING, on the one action that cannot be undone.

THRASH STOP. B4's invariant has now survived two fix attempts, which is a stop trigger on its own; B5 needs a new invariant owner. Both go to the user as options rather than to a third attempt. Tasks are un-ticked and the change does not proceed to approval, blueprint sync, or archive until that decision lands.

Task 5_1's recorded `--test-change` rationale reads `x`. That is a placeholder I passed while isolating which half of `--cmd` was failing, and the run it landed on is the one that passed and ticked; the CLI refuses a second write, and hand-editing its evidence would forge a record the tool exists to produce. The real rationale, for the reviewer: additions only, +7 assertions, no existing assertion weakened — two cases for the per-call output ceiling `GitRunOptions` did not carry before, two for what the caps bound at the adapter and inside the walk. One pre-existing case shifted meaning without changing what it asserts: "a stat that takes longer than the whole budget" still exercises a stat that returns LATE, which is why the post-await deadline check stayed alongside the new race — its fake resolves instantly while advancing a fake clock, so it cannot express a read that never returns at all.

B5 fixed in task 5_2. The suppression moved out of the producer, which held neither the target nor the pane snapshot, and into `evaluateRemoval`, which holds both. `PresenceProjector` publishes the claim as `entryId → paneId` — the same fact its pass already built, keyed usefully — and a registry session is dropped only where the claiming pane is in the snapshot this assessment was handed, resolves inside the target, and has not exited. Every other shape refuses: no claim, a claim naming a pane the snapshot no longer has, a pane with no cwd, one outside the target, one that exited. Mutation-checked at both boundaries — a host that always answers with an empty map fails the actions suite, and a blocker that trusts any claim without corroborating it fails four cases.

Verify Gate re-run after the cycle-2 fixes (5_1, 5_2): type check clean, `pnpm run test:unit` 258 files / 5711 tests passing, `pnpm run gate:fs-deletion` ok. `pnpm exec biome check src` reports 3 format errors in `src/agentHooks/AgentHookController.test.ts`, `src/agentHooks/install/ClaudeHookInstaller.test.ts` and `src/cursor/CursorHookInstaller.test.ts` — none touched by this change, and all three reproduce on a detached worktree at this change's base commit. Warnings are at the 14 baseline.
