# Workflow State: render-the-removal-assessment-as-a-report

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-013.4
Lane: full (standard) — HIGH risk: the report UI and host authorization seam govern irreversible deletion | flags: new-api-contract, security-privacy, cross-boundary
Planned at: 1f4819b7 (re-earned after the every-removal-confirms decision; originally 6e521950)
- Worktree based on huybuidac/create-worktree-harden, not main: WT-013.1 and WT-013.2 are the deps and neither is merged to main yet — main's docs/PLAN.md has no WT-013 tasks at all and src/worktree has no orphan proofs. A first attempt on the default base was discarded before any work landed.
- Superseded lane note: the first plan needed no `new-api-contract` flag because it only consumed the existing assessment shape. The user's every-removal-confirms decision now removes the client `force` field, so section 4 carries `new-api-contract`, `security-privacy`, and `cross-boundary`.
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

- Section 3 built as four serial tasks. Two deviations from the plan, both recorded rather than
  improvised around: 3_3 took `src/providers/WorktreeHost.actions.test.ts` into its Plan paths, and
  the host's PRE-FLIGHT gate now answers `unavailable` rather than returning silently. D12 says one
  live request gets one reply with no exception, and that silence is precisely what D10's
  duplicate-request drop would have dead-ended on: an unanswered request leaves the live-token slot
  held and the menu item dead for that row.
- `bun test` is asm's default verify runner and it cannot run this project's jsdom suites — 3_1 and
  3_2 happened to pass under it, 3_3 reported 153/153 failures on a file vitest passes. Tasks 3_3 and
  3_4 were verified with `--runner 'pnpm exec vitest run'`, as sections 1 and 2 were.
- Every new guard was mutation-checked rather than assumed: reverting D11's token to the id-only
  draft kills exactly the two falsifiers the plan attack said it would, restoring the ungated Retry
  kills the third, and bypassing D10's barrier fails the assembly walk.
- Verify Gate: check-types clean, 6254/6254, `gate:fs-deletion` ok, biome check-mode at the
  3 errors / 14 warnings / 1 info baseline. Four format errors were hand-applied exactly as the
  formatter printed them; write mode was never run.

HANDBACK (round-6 B5 + S1, cycle 4, 2026-09-01). Gate 2, All tasks done and Verify gate unticked;
Review done and Gate: implementation approved were already unticked. Tasks 1_1 to 1_7, 2_1 to 2_5 and
3_1 to 3_4 stay `[x]` — built, verified and untouched by this.

Round 5 was SPENT ON MY ERROR and the round file records it: I requested a verification round after a
handback, which supersedes by construction, because the range necessarily adds the `D#`s and task
entries the handback created. My own cycle-1 note already said the review after a handback is the
next cycle's DISCOVERY round; I did not apply it. Round 6 then ran as cycle 4 discovery and cost a
second user grant. Both grants are recorded on the review state.

Round 6 returned BLOCK: B5 accepted as gating, S1 accepted as non-gating. Adjudicated as FIXED at
their witnesses by section 3: round-4 B3, W4 and W5. The chair also ruled explicitly that 3_3's
pre-flight `unavailable` answer — a deviation I took on my own authority and flagged for attack — is
valid D12 conformance rather than overreach, and that without it the same-row duplicate guard could
retain a request that will never answer. D10's parity-not-closure claim, the absence of a
queue-to-gate lock cycle, and the non-vacuity of the new tests were all upheld.

No fix loop was opened, for two independent reasons either of which alone is sufficient:
- The remediation boundary. B5 falsifies an accepted D10 ledger claim outright — "a burst cannot back
  up the mutation queue" is false — so the fix needs a changed `D#`, and the finding's invariant, a
  structural pending-work bound on read traffic sharing a mutation queue, is an owner this change
  does not have.
- The cycle cap. This is cycle 4.

What the redesign must carry, beyond B5 itself:
- S1: the `.catch()` sits after `.then()`, so a delivery throw on a SUCCESSFUL result is reported as
  a failed assessment, and a second throw escapes the voided chain.
- The liveness hazard the oracle found and S1 only partly covers: both production surface adapters
  are fire-and-forget (`TerminalViewProvider.ts:1659-1666`, `TerminalEditorProvider.ts:1132-1139`)
  and swallow a fulfilled `false` or a rejection, so a transient delivery failure strands
  `liveAssess` and kills that row's Remove permanently. Closing every HOST exit in 3_3 did not make
  "one live request, one reply" true end to end, as I claimed; the transport can still drop it. A
  pending-work bound and a request lifetime that survives a dropped reply are one question.
- My own overclaim, which the chair did NOT treat as a defect and which is therefore mine to correct
  rather than a finding: task 3_4 is titled "Prove the replacement cannot be deleted under its
  predecessor's report", and the walk does not remove-and-recreate anything, never delivers the
  watcher event it holds, and never confirms. It is non-vacuous and it does prove what 3_4's
  Acceptance Outcome actually states — the assessment reads the barrier's registration, not the
  cache's — but the title and its commit message claim more than the walk earns.

Knowledge candidate: a verification round is impossible after a handback | Surprise: round 5 was
opened, scope-locked and closed without spawning a single specialist, costing one of exactly two
user-granted rounds, because a handback ALWAYS adds the `D#` and task entries that supersede
verification | Evidence: .reviews/round-5.md "Mode: superseded" vs the same conclusion already
recorded in this file after cycle 1 | Consumer: build | Action: after any artifact handback, request
the next review as the new cycle's DISCOVERY round; never as a verification round, whatever the fix
loop's step 7 says about re-review.

DEPENDENCY RECORDED (2026-09-01). The round-6 remedy was scaffolded as its own change,
`coalesce-assessment-requests-at-the-host`, per the remediation boundary — B5 needs a semantically
changed `D#` and mints an admission discipline for queued read work that no accepted plan owns.
Nothing was folded into this change's tasks.md and no ticked task was rewritten. This change stays
PARKED and now depends on that one; when it is approved, this change's next review scopes the
integration seam rather than the subsystem.

Two of the round-6 items travelled with it rather than staying here, because they are the same
question: W6's dropped-reply strand (the panel guard that blocks the re-ask is the guard B5 refutes)
and S2's assembly-walk overclaim, which that change's task 3_1 strengthens rather than correcting
this change's ticked 3_4 title.

DEPENDENCY SETTLED (2026-09-01). `coalesce-assessment-requests-at-the-host` is APPROVED and ARCHIVED
at `asimov/changes/archive/260901-0348-coalesce-assessment-requests-at-the-host/` — cycle 1 round 1,
APPROVE, 0 BLOCK / 0 WARN / 0 SUGGEST across six specialists. It closes round-6 B5 and W6 and
round-6 S2. Round-6 S1 stays REJECTED: the chair's reasons hold, and the retrying `postCritical`
design that would have made it reachable was cut by that change's own plan attack.

Gate 2 is being re-earned on the artifacts, not the code. Nothing in `src/` is re-opened here and no
ticked task is rewritten — the child edited `WorktreeHost.ts` and `WorktreeController.ts` under its
own leases and its own review. Three artifact lines in this change were made false by that and are
corrected in design.md: D10's "One request at a time" paragraph, the backlog-control ledger row, and
D12's "exactly one reply per request" semantics. Each now cites the child as the owner of the bound
rather than restating it.

The spec delta is deliberately NOT edited. "Asking to remove a worktree SHALL NOT leave the user with
no response" sits inside a WHERE clause scoped to an assessment that cannot be completed, and the
child's ADDED requirement "Asking to remove again always asks again" — "exactly one report is shown,
and it is the answer to the later request" — makes it more true rather than less. A superseded
request receiving no reply of its own is not a user left without a response; it is a user who moved
on and is answered on the ask they are still making. Read for a contradiction and none was found;
recorded here so the next round tests the reading rather than assuming it.

Plan attack on the amendment (`asm-oracle`, scoped to the five questions the amendment raises rather
than to the ledger, which round 6 and the child's round 1 have both already attacked). Two questions
came back `supported` and three `refuted`. All five dispositions are recorded; three findings were
accepted outright and one accepted as fact with its remedy rejected:

- SUPPORTED — the per-repository bound. No request pattern, surface attach/detach interleaving or
  error path puts two assessment jobs in one repository's queue: admission sets `outstanding` before
  the job is enqueued, the queue body releases before its promise settles, and the service step's
  `finally` decides synchronously.
- SUPPORTED — and this is the one worth reading, because it is the round-6 defect: W6's permanent
  same-row wedge is CLOSED, not moved. A lost reply still costs the user a click, but the guard that
  made that click a no-op is gone, so no finite schedule leaves a row unrecoverable.
- ACCEPTED — my `n/a — consumed as a settled dependency` was a disposition wearing a disguise. D10
  depends on that bound for its cost model, and the child ESTABLISHES it rather than making it
  inapplicable. Relocating a witness does not relocate an obligation. The row is now `supported`,
  citing the child's mechanism and its measurement.
- ACCEPTED — the D12 prose still read "one live request, one reply, with no exception" two paragraphs
  above the row I had amended. Corrected to the host-local property it can actually hold, with both
  things it does not own — supersession and unacknowledged delivery — named rather than defended.
- ACCEPTED — my own rewritten cost-model paragraph still asserted the backlog in the present tense.
  It is now written as the counterfactual it is: what makes the bound necessary, not what happens.
- ACCEPTED AS FACT, REMEDY REJECTED — the spec sentence. The oracle is right that a dropped
  `postMessage` leaves the panel silent, and both adapters swallow it. It is wrong that this makes
  the sentence a scope question for this requirement. Every message in this capability rides the same
  unacknowledged transport, so that reading falsifies the whole spec uniformly; qualifying this one
  sentence would put the residual in the wrong place and would cut accepted scope to fix a defect the
  requirement does not own. It is a ledger row instead — `n/a`, pre-existing and shared, naming the
  falsifying state and naming an acknowledged transport as its own change. Review should test this
  disagreement rather than assume it settled; an Overrule makes it a spec question and a user call.

Task 3_3's Plan prose was ANNOTATED, not rewritten. Steps 2, 3 and 5 described the controller-side
duplicate drop the child deleted; each now carries what superseded it. Acceptance, Verify, Boundary
and the `[x]` are untouched, and the oracle confirms no task Acceptance in this change became false —
3_3's Outcome is the live-token guard, which still holds and is still witnessed.

Verify Gate re-run after the amendment (2026-09-01, HEAD 39099132): check-types clean, 6262/6262,
`gate:fs-deletion` ok (46 modules, 1 declared carve-out), biome check-mode at the 3 errors /
14 warnings / 1 info baseline. `verify-status` exit 0, all 16 tasks. No source file was touched by
this Gate 2 pass — the suite grew from 6254 to 6262 because the child change's tests are on this
branch, not because anything here was rebuilt.
- Round-1 B1 RESOLVED by the user on 2026-09-01, verbatim: "Luôn hỏi trước khi xoá" — every removal returns a fingerprint-bound assessment and executes only after the dialog's confirmation callback; a clean worktree gets the ordinary confirmation instead of a one-click delete. This is the first of B1's two remedies, so the change reopens Gate 2: it needs a host-side owner for the new seam and a changed D#. The alternative (cut the ordinary control) was declined. Build does NOT resume until asimov-plan re-earns Gate 2.
- Replan: D7 now separates confirmation authority from Git force, and section 4 adds four serial tasks, `4_1 → 4_2 → 4_3 → 4_4`; the prior 16 tasks stay `[x]` as the record of what was built before the scope decision.
- Reference check: Orca independently confirms first and lets fresh host evidence select ordinary versus forced removal; t3code confirms but always forces, so only Orca's separation is adopted. No syntax is copied.
- Replan baseline in this worktree: Biome check mode remains 3 errors / 14 warnings / 1 info; no fix mode was run.
- FASTLANE Gate 2 blueprint sync: WT-013.4 becomes Size `L`; Labels retain `user-visible-ui` and add `new-api-contract`, `security-privacy`, `cross-boundary`; Acceptance gains “every removal presents this report before deletion, including a clean worktree, and no removal executes until the report's confirmation is answered”. Status stays `in_progress`. `worktree-rpc.md` § 2.1 must also replace the paired `force`/fingerprint request with the optional report fingerprint.
- Plan attack triage approved in FASTLANE: narrow the host claim from “proves a human answered” to issued-report authority plus an assembled callback witness; scope the raw fallback to a published target and keep its existing blocked-notice opener; fix 4_3's typed-call leases and the ticked 2_2–2_4 supersession record. No child change — the existing mutation service and fingerprint store already own the invariant.
