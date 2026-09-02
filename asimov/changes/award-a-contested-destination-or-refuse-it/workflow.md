# Workflow State: award-a-contested-destination-or-refuse-it

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

Blueprint: docs/PLAN.md task WT-012.18
Lane: full — HIGH risk: two accepted requirements constrain one order, and the folding key is deliberately over-inclusive so over-refusal loses a declaration | flags: new-api-contract
Planned at: ae9d85befbfbd97b336e8da318dec4f2a4bd6b6a
- Plan attack run before Gate 2. It refuted FOUR ledger rows and the design was rewritten rather than argued: D4's pre-existing check ran only against the loser, so the favoured member merged into a destination that was already there while only the loser was reported; the D3 reading cannot attribute a name another entry's directory walk or another process created, so the "skipped, awarded to f" outcome claimed a causal fact the apply cannot establish and is now a refusal; promoting the favoured member ahead of the copy pass gave an UNCONTESTED `Foo/seed` copy a new refusal, so the loser yields its place instead and nothing is promoted; and D6's folding-key test would have refused an ordinary `Foo -> foo` beside a real `foo` on a case-sensitive volume, destroying material to prevent a loop that volume cannot have.
- Gate 2 taken under fastlane on the standing goal, with the user away. The scope cut it carries: the folded self-loop (a link that loops only because the destination folds) is NOT owned here — it needs the twin-create probe this change refuses to assume, and the filesystem answers ELOOP to a reader meanwhile.
- Round 1 REJECTed with four blockers and every one of them changed an artifact rather than a line, so cycle 1 closed at triage instead of opening a fix loop: D3 now owns two readings and a four-state observation (one reading cannot show that the favoured member own write created its destination, and "not ENOENT" is not "absent"), D4 gained the row those imply, D4a says a refusal names every member including itself, and D5 owns the returned ORDER — the closure answered in execution order and the extraction had quietly changed it to provider order.
- Gate 2 re-earned under fastlane on the standing goal, with the user away. Nothing in the four fixes widens scope; the mechanism, the non-goals and the refused twin-create probe are unchanged.
- 4_1 build evidence corrected D3/D4 before any review saw them: the entry gate itself lstats the destination (`src/utils/resolvedPathBoundary.ts:117-121`), so `inadmissible` cannot be told apart from `unreadable` and refuses a contest like any other unproven destination. Row 1 now reads "anything but `absent`".
- Round-2 handback cut accepted scope: the spec scenario promising BOTH members land on a case-sensitive volume is withdrawn, because an oracle attack established that a held member's post-claim `absent` cannot be told from the favoured member's object being unlinked, and writing it there is exactly how the inherited declaration wins a folded destination. The user was asked which way to settle it and was away for 600s; the alternative was a risk acceptance, which only the user can grant, so the refusing option was the only one available to me. Flag it at the next review.
- Knowledge candidate: a contest's refusal text is O(N²) in members — each of N members carries a reason naming all N — so at the structural row cap ~786 KB of declarations expands to ~150 MiB of reason text before postMessage/JSON/DOM copies | Surprise: the input is capped and the output is not, and the quadratic sits in text nobody sizes | Evidence: src/worktree/provisioning/applyProvisioning.ts#refuseContest | Consumer: plan | Action: if a reason-size or aggregate-byte cap is ever added to the provisioning report, this is the term that dominates it; round-3's performance specialist emitted no finding because the row and file caps bound it
- Round 3 hit the thrash stop AND the cycle cap: trajectory r1=4 | r2=3 | r3=3, two consecutive rounds with no net reduction, third cycle. Option 1 taken under the standing grant to split a change or replan; options 2 and 3 both need a user decision I do not have. F008 and F007's live half each mint an invariant owner outside this change, so they become their own changes rather than tasks here.
- Round-3 split: `offer-a-yielding-declaration-as-yielding` owns F007's live half (the dialog checks every contender and counts it into "N copied" before the apply refuses it) and `carry-a-contest-membership-once` owns F008's wire contract. This change keeps F006 and F007's artifact half. Both are scaffolded and this change depends on them.
- Follow-up for the blueprint owner, NOT taken here: docs/PLAN.md needs rows for those two changes. PLAN.md is not edited beyond a Status row without the user.
- Round-4 contracts specialist reached this session directly after its hand-back to the chair failed to route: the F006 fix preserves a contested entry's own rule but drops contest membership from it, so the favoured member's ordinary refusal names nobody — against D4a and D4b, which require every refusal to name every member. Confirmed against src/worktree/provisioning/applyProvisioning.ts. The F006 witness asserts only the rule substring and does not witness membership. To be fixed whatever the chair returns, since the chair may never have received this finding.

Round-7 handback: F007 reopened — D3b settled how a two-native group is APPLIED and left how it is OFFERED unmoved, so the dialog ticks and counts rows the apply refuses entire. Gates unticked: Gate 2, All tasks done, and the Verify gate. F013 rides the same requirement; F014, F015, F016 and F017 are accepted and become tasks in the replan.

Round-7 replan: D3c makes the offer and the apply decide a contested group by one predicate over which members are the repository's own, read against the selection currently held. The plan attack refuted the first draft — a two-repository-declaration group offered UNSELECTED is not a fixed point of that predicate, so its rows would carry a note the rule contradicts and the inherited member ticked alone would be copied while saying it would not be. The rows are offered selected instead.
- Round 8 (cycle 6 discovery, after the round-7 handback) returned WARN with ZERO blockers. F007 adjudicated FIXED: the dialog and the apply now decide from the same count of selected repository declarations, and the summary and submitted ids follow the same live selection. F013-F017 all confirmed fixed.
- All three new findings were accepted and fixed in ONE task (11_1), because all three were in the note representation task 10_6 introduced and share one lease. None needed a `D#` change, so the remediation boundary was not crossed and no handback was owed: D3c owns the predicate, and every finding was about how the predicate is REPRESENTED. No re-review round was opened — no BLOCK was fixed or rebutted, so the cycle ends at Re-Verify.
- F019 was a regression 10_6 introduced and worth remembering as a shape: rendering one note per candidate turned a group into `(M-K)*K` DOM nodes each carrying a copy of the group's ids. `MAX_MODEL_ROWS` is 200 and a contender group is every entry sharing one fold key, so the worst case is reachable from a checked-in file rather than only in theory. The fix is the same one `contestedBy` already implied: point at the group, read it once per group, never copy it into the thing that explains it.
- Re-Verify after 11_1: check-types clean, biome check-mode at the 3/14/1 baseline with all three errors in `agentHooks`/`cursor` test files this branch never touches, I10 gate ok, shipped-bundle gate ok, 6,833 unit tests pass, `verify-status` exit 0.

