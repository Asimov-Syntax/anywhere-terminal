# Workflow State: render-the-removal-assessment-as-a-report

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

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

Blueprint: docs/PLAN.md task WT-013.4
Lane: full (standard) — MEDIUM risk: presentation only, but it decides what a user is told before authorizing an irreversible deletion, and retires an existing safety guard | flags: none
Planned at: 6e521950
- Worktree based on huybuidac/create-worktree-harden, not main: WT-013.1 and WT-013.2 are the deps and neither is merged to main yet — main's docs/PLAN.md has no WT-013 tasks at all and src/worktree has no orphan proofs. A first attempt on the default base was discarded before any work landed.
- No new-api-contract flag: WT-013.1 and WT-013.2 already carry `cls`, the four-outcome vocabulary and the three proofs in the same checks array, so this change alters no message shape.
- 1_2 leaves a residual D2/D3 composed: a REFUSAL-class check that is `unproven` no longer withholds anything (`isRefusedByChecks` refuses only on `failed`), so it falls to the confirmable classes — typed if one of those is failing or unproven, ordinary otherwise. Both the spec's "Otherwise ... ordinary" and D2 say this explicitly, so it is built as accepted; flagged here because the retired guard was the only thing covering it and review should see it named rather than infer it.
- Verify Gate: 3 biome errors / 14 warnings / 1 info is the pre-existing baseline on this branch (src/agentHooks, src/cursor, src/vault, CSS files) — none in this change's files, reproduced unchanged before and after.
- 1_3 needed no spec delta: `A removal states what it destroys and what it spares` is already a BASELINE worktree-panel requirement and is written for "a removal confirmation", unqualified. A mid-build handback was raised against the delta alone and withdrawn once the baseline was read.
- Cycle 1 round 1 (discovery) returned BLOCK: B1, B2 accepted as blockers, W1, W2 accepted as warnings — triage in .reviews/round-1.md. No fix loop was opened: B1 and W1 both require artifact handbacks, and B1's is product scope, which fastlane never auto-chooses. B2 and W2 are fixable inside the accepted contract and are held so they are not built on a control B1 may cut. PARKED awaiting the user's scope call.
- W1 supersedes the 1_2 residual noted above: docs/DESIGN.md D43 already decided that a hard refusal unproven still refuses, so this change's D2 contradicts the blueprint rather than merely leaving a gap. D2 must be re-earned, not patched.
- Round-1 B2 and W2 fixed as task 1_4. They were held on the reasoning that B1 might cut the control they sit beside; that was wrong — the refusal path mounts no control at all, and the pane wording is in the presenter table, so neither depends on B1's scope call. B1 and W1 remain the only findings needing the user.
- src/vault/snapshotPool.test.ts failed once under the full concurrent suite ("refuses a snapshot to a caller that was waiting out another production") and passed on the next full run and three standalone runs. Not a file this change touches.
- A second intermittent full-suite failure was seen once after 1_4 and not captured before it cleared; four subsequent full runs are green (6005/6005). Both flakes appeared only under the concurrent full suite, never in a targeted run. Not tracked to this change's files, but recorded rather than dismissed.
- W1 was NOT a user decision after all, and note 40 was wrong to park it: D43 had already settled it, so there was no fork to offer — only conformance. Gate 2 reopened, D2 corrected, the delta given the refusal-unproven clause, and task 1_5 added. B1 alone stays with the user.
- W1's remedy went handback -> plan -> Gate 2 -> task 1_5, so cycle 1 closes as superseded and the next review is cycle 2's DISCOVERY round, not a verification round: the range now carries a materially changed D2, a changed spec delta, and a task that did not exist at round 1's Head.
- Verify Gate re-run after 1_5: 6007/6007, check-types clean, biome 3/14/1 baseline, I10 gate ok.
- Round-2 W3 fixed as task 1_6, and it was fallout from my own 1_5: routing unproven refusals into the refusal branch without widening the copy that explains them, so every one of them hit the local-agent sentence "An agent WAS mid-turn" from a check that read nothing. Baseline requirement "A refusal names the reason it actually has" already forbade it, so no delta was needed. The refusing check is now picked by class and host order and the copy keyed on its id and outcome.
- 1_6 mutation testing found a survivor first: dropping `cls === "refusal"` from the refuser search changed nothing, because every producer today happens to order the refusal checks first. Added a test with a failing confirmable check ahead of the refusing one; the mutation then dies.
- The intermittent suite failure is IDENTIFIED and PRE-EXISTING: src/vault/snapshotPool.test.ts "refuses a snapshot to a caller that was waiting out another production". Reproduced on a clean detached worktree at cf4492aa — the base commit, before any of this change's work — on the second full run. Only under the concurrent full suite, never standalone. Not this change's file and not this change's fault; recorded here rather than tracked, since fixing it is outside this change's scope.
- FOLLOW-UP FOR THE USER, not folded into this change: should removing a CLEAN worktree ask for confirmation at all? Today one menu click deletes it — the host's `atRisk` gate sends no report, so the dialog never opens. Round-2 B1 surfaced this and it is a real product question, but it governs the removal flow rather than the report, and WT-013.4's acceptance contains no clause about which removals are assessed. It needs its own PLAN task; minting one is the user's call and docs/PLAN.md was deliberately not edited.
- The delta requirement on confirmation control was rescoped from "the removal" to the control the DIALOG selects for an assessment it is given. Judged an overclaim correction rather than a scope cut, on the test that the sentence as written was false of the shipped system — a clean removal reaches no confirmation — and that WT-013.4 never promised otherwise. Recorded here because the call is close enough that the review verdict should test it: B1 is rebutted on this basis, and an Overrule sends it back.
- Round-3 W3 fixed as task 1_7, and it was my own defect from 1_6: `refuser` selected the right check but the isMain and containsWorktrees branches still tested `failed(...)`, so two simultaneous failures rendered the later reason. Every branch now dispatches on `refuser`. Mutation testing then exposed a second gap — the isMain branch could revert undetected because every producer lists isMain first — so there is now a report whose host order puts busyAgents ahead of it.
- Round-3 B1: my rebuttal was OVERRULED and I accepted it without further argument, as undertaken when filing it. The chair and the contracts specialist read the delta rescope as cutting scope the blueprint and task Acceptance establish. B1 is neither fixed nor risk-accepted; it is the user's decision and the change is parked on it with everything else complete.
- Verify Gate after 1_7: 6014/6014, check-types clean, biome 3/14/1, I10 ok. The pre-existing src/vault/snapshotPool.test.ts flake appeared once more and cleared on re-run; already proven pre-existing on a clean tree at cf4492aa.

HANDBACK (round-3 B1, 2026-08-31). Gate 2, All tasks done and Verify gate unticked per the handback
rule; Review done and Gate: implementation approved were already unticked. Tasks 1_1 to 1_7 stay
`[x]` — they are built, verified and untouched by this. Section 2 adds the B1 remedy: five tasks,
waves `2_1 | 2_2, 2_3 | 2_4 | 2_5`.

The remedy was planned separately, as change `report-what-was-checked-before-confirming`, before
either session knew the other existed. That change is DELETED here rather than built: its part 2 was
this change's 1_1 and 1_2 already shipped, and building it would have put two divergent
`WorktreeRemoveDialog.ts` implementations on one branch. Its parts 1 and 3 are section 2 above, and
its oracle dispositions are in design.md's ledger. Nothing else of it is kept.

Rejected the SuggestedFix, deliberately: round-3 B1 proposes "a fingerprint-bound assessment for
clean and proof-only removals". D7 does not, and the user approved that call. A fingerprint IS
force-removal authority, so issuing one for a worktree with nothing wrong opens a deletion-authority
door — the defect this project shipped twice, at round-1 B2 and round-3 B2 of WT-012.16, both walked
back through by a replayed message. The FINDING binds; the suggested remedy does not. A clean confirm
goes down the existing unforced path carrying no fingerprint, which re-checks at execution time
anyway. Review should test this disagreement rather than assume it settled.

Escalation flags for the next round, beyond the original `none`: `new-api-contract` (two wire
messages) and `security-privacy` (the path is irrevocable deletion). The original Lane line predates
section 2 and its `flags: none` no longer describes this change.

Blueprint edit pending approval: worktree-rpc.md § 2.2 line 114 declares
`worktreeRemoveAssessment { worktreeId, checks, fingerprint, branchDelete? }`. Three corrections at
Blueprint Sync, per design.md D8 — `fingerprint` nullable, `contained` named (the shipped payload has
carried it since WT-013.1 and the doc never caught up), and the reply discriminated so an
`unavailable` assessment is not readable as a refusal. `branchDelete` stays documented and
unimplemented as WT-013.3's obligation.

FOLLOW-UP, needs its own PLAN task from the user — NOT in this change's scope and not closed by it:
fingerprint redemption can be satisfied by evidence the user never saw. `isIdentityPreservingSubset`
(worktreeBlockers.ts:35-36) compares the lock as a BOOLEAN and the digest
(worktreeFingerprint.ts:179-189) omits `lockReason`, so lock-A → unlock → lock-B between report and
confirm still redeems. Separately, the 150 ms presence projection cap can leave pane rows stale while
an agent has begun running, and redemption compares pane IDENTITY, not activity. Both are reachable
today through blocked→force; this change neither introduces nor widens them, which is why they are a
ledger `n/a` here rather than a blocker.

Knowledge candidate: a wire message documented in worktree-rpc.md is not necessarily implemented |
Surprise: `worktreeRemoveAssess` and `worktreeRemoveAssessment` have been in § 2.1 line 97 and § 2.2
line 114 through two prior tasks that read that section as authority, and neither exists in
src/types/messages.ts | Evidence: docs/design/worktree-rpc.md:97,114 vs src/types/messages.ts |
Consumer: plan | Action: when a task's Design Ref names a wire message, grep src/types/messages.ts
for the type before planning on it.

Knowledge candidate: `asm change list` is branch-local and cannot see a change built on another
branch | Surprise: WT-013.4 was planned twice, in two sessions, because each ran `change list` in its
own worktree and saw nothing | Evidence: this change vs report-what-was-checked-before-confirming,
both on huybuidac/create-worktree-harden only after a merge | Consumer: plan | Action: run
`git worktree list` and read the branch names in Stage 1 before scaffolding a PLAN task.

- Section 2 built as five tasks. Two task boundaries moved at build time rather than being improvised
  around: 2_3 absorbed `WorktreeView`/`WorktreeController` because a nullable fingerprint that stops
  at the dialog leaves a tree that does not compile, and 2_4 absorbed the four existing
  menu-to-git walks in `src/extension.worktreeAssembly.test.ts` because they encoded the very
  deletion B1 removes — a task that leaves the suite red is not done. 2_5 still owns the new proofs.
- Two doors onto the old behaviour were closed beyond the planned Outcome, both in
  `WorktreeController`: the `unavailable` RETRY now re-asks rather than posting a removal (it was the
  one path where nothing about the worktree's risk is known), and a blocked refusal now carries
  `fingerprint: null` rather than `""` — presence is the force authority, and an empty string is
  present. Neither is reachable as a defect today; both are one edit away from being one.
- `WorktreeView.openRemoveReport` was extracted rather than the two presence lookups copied into the
  controller, so the blocked-result path and the assess path open the same dialog the same way.
- Verify Gate: check-types clean, 6243/6243, `gate:fs-deletion` ok, biome check-mode back to the
  3 errors / 14 warnings / 1 info baseline with a diagnostic set byte-identical to 4e7443c4 (measured
  on a detached probe worktree, not estimated). Three call sites were hand-wrapped exactly as the
  formatter printed them; write mode was never run.
- The `.build/verified.ndjson` records for tasks 1_1 to 1_7 did not travel with the branch merge —
  `.build/` is gitignored — so `verify-status` read seven `[x]` tasks as hand-ticked. Restored from
  the sibling worktree that produced them rather than re-run or waived; the records are the CLI's own
  output from those runs.

HANDBACK (round-4 B3 + W4 + W5, cycle 3, 2026-09-01). Gate 2, All tasks done and Verify gate
unticked; Review done and Gate: implementation approved were already unticked. Tasks 1_1 to 1_7 and
2_1 to 2_5 stay `[x]` — they are built, verified and untouched by this.

Round 4 (cycle 3 discovery) returned BLOCK: B3 accepted, W4 and W5 accepted. Triage is in
`.reviews/round-4.md`. B4 was raised out of band by `asm-review-reuse` and REJECTED by the chair
with reasons; the chair's file carries it, so nothing was dropped, and I agree with the rejection —
both branches call the one shared `atRisk` and the one shared store, which is the construction D7
asks for; an extraction is hygiene, not a gating obligation.

No fix loop was opened, for two independent reasons, either of which alone is sufficient:
- The cycle cap. This is cycle 3 on this change, and a 3rd cycle never opens another fix loop.
- The remediation boundary. All three findings need a new invariant owner rather than a patch:
  a freshness-and-identity discipline for authority-bearing READS. D6 rejected `perform` for real
  reasons — the rebuild gate and the mutation-result publication — but took the coordinator's
  freshness boundary out with it, and D7 then mints force authority on that unbounded read.
  `worktreeMutationService.ts:340` already states the invariant for mutations in its own words.
  W4 is the same defect owned on the webview side; W5 needs a `D#` because `unavailable` promises a
  NAMED list of failed reads and a rejection has no source to name.

The owner is new, so per the remediation boundary it becomes ITS OWN change with this one depending
on it, never folded into these tasks. This change is PARKED complete-but-unapproved: B1 is fixed and
the chair confirms it at its invariant witness, and nothing here is known-broken for a worktree whose
registration is current.

Verify Gate at the moment of parking (evidence retained, gate unticked per the handback rule):
check-types clean, 6243/6243, gate:fs-deletion ok, biome 3/14/1 baseline.

Round-4 remedy planned as section 3 — four tasks, fully serial (3_1 → 3_2 → 3_3 → 3_4); 3_3 was
serialized behind 3_2 because both touch `WorktreeHost.ts`.

The plan attack (`asm-oracle`) refuted three ledger rows and declined to sign off D10, D11 and D12 as
first drafted. All four of its findings were accepted, one was rejected, and the artifacts were
rewritten before Gate 2:
- D10 claimed too much. Taking the barrier fixes the target the assessment STARTS from; it does not
  freeze the worktree while the assessment's own async reads run, and `stillObserved` cannot see a
  replacement that no rebuild has landed for. The claim is now PARITY with the shipped blocked→force
  path — which holds the identical window and is what round-4 B3 measured this path against — and the
  residual is its own ledger row, `n/a`, pre-existing and shared, needing its own PLAN task.
- D11's premise was false and I asserted it without checking: the blocked-notice *Force remove…*
  action opens the report from the VIEW (`WorktreeView.ts:1540-1547`), not the controller, and an
  id-only intent cannot order two requests for the same worktree. The token I had rejected goes on
  the wire after all. It orders answers and authorizes nothing.
- D12 covered only the rejection. The coordinator's `missing` leg is the other silent exit: a rebuild
  whose presence projection rejects publishes nothing, so the row does not depart AND no reply comes.
  Both exits now answer through the `unavailable` arm.
- D10 gained a duplicate-request drop: each assess holds the per-repo mutation queue across two
  forced rebuilds, git status/proof (10 s timeout) and the ignored scan (1.5 s), so an unbounded
  request door made the "one human click" cost model false rather than merely optimistic.
- REJECTED: the oracle marked the vacuous proof-unlock witness `unresolved`. The row already says the
  witness is vacuous until WT-013.3 ships a proof-gated control and names WT-013.3 as its owner. That
  is the disposition, not a gap in it.

Its task-acceptance notes were accepted too: 3_1 must hold `forceRebuild` unresolved to prove
ordering rather than observe it, 3_3 gained the two falsifiers the id-only draft failed, and 3_4 must
first give the assembly a controllable watcher — it has none today, so the walk as first written
would have passed for want of anything happening.
