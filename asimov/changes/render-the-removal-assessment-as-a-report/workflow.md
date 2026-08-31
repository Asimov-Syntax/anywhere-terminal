# Workflow State: render-the-removal-assessment-as-a-report

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [ ] `asm change validate` passes
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

Blueprint: docs/PLAN.md task WT-013.4
Lane: full (standard) — MEDIUM risk: presentation only, but it decides what a user is told before authorizing an irreversible deletion, and retires an existing safety guard | flags: none
Planned at: 7480a232
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
