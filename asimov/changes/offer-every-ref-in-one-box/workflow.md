# Workflow State: offer-every-ref-in-one-box

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no real fork; § 4.1 settles the one-list shape and the rejected tabs are on the record
- [x] `asm change validate` passes
- [x] Gate 2: plan approved _(re-earned after the round-2 W2 handback amended D1)_

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done — cycle 1, rounds 1-3; round 3 returned WARN with 0 gating blockers
- [x] Gate: implementation approved (fastlane)
- [x] Blueprint sync complete

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-012.7
Lane: full — user-visible-ui; new wire pair; the lead input every other control is positioned against
Planned at: 2e03cdd2
Fastlane note: Gate 2 auto-approved; validate ended 0 errors / 0 warnings.
Fastlane note: no peer review at Gate 2 — the risk is in the webview keyboard contract, which build's own tests and the review round cover better than an artifact read.
Fastlane note: WT-013.1 round-5's abandoned-read finding is untouched — this change adds no filesystem read, only a bounded git invocation on the create path.
Verify Gate: lint exits 1 on 3 pre-existing errors — `src/agentHooks/AgentHookController.test.ts`, `src/agentHooks/install/ClaudeHookInstaller.test.ts`, `src/cursor/CursorHookInstaller.test.ts` format, plus 14 warnings — all baseline, none in a file this change touches. Every diff on this change's own files was hand-applied in check mode.
Task 2_3 added mid-build: 1_2 named `WorktreeHost` as the answerer and nothing named the entry point that supplies the reader. 3_1's Boundary is coverage-only, so the producer could not go there.

- Round-2 W2 handback: D1's pair named a repository but not an OPENING, so an answer outliving its dialog could not be told from its successor's. Amended to carry a token the answer echoes. Auto-chosen under fastlane — an internal wire between the host and its own webview, no spec delta, no user-visible fork. Deliberately scoped to the refs pair: giving defaults and provisioning one lifecycle owner is a question about the create wire as a whole, not a repair to the message this change added.
- Round-2 B4 disproves the equivalence claim recorded in round 1 against W1's mutant. `deriveChoice()` makes `choice` and the typed name agree on the TYPING route only; committing create-new sets `choice` to `new` and leaves the typed name alone, so a guard reading `choice` submits a held branch. The mutation was killable and the test simply did not walk that route.

- 4_2 verify gate: check-types 0, 5859 tests pass, biome check back at the recorded baseline (3 pre-existing format errors in agentHooks/cursor files this change does not touch, plus the standing warning set).
- W2's `closed`-on-dismissal half stays declared-defensive and has no test: after Escape the form's DOM is gone, so a write into it is unobservable — the exact reason round 2 was right that my previous test passed for the wrong reason. What IS observable is supersession, and the token guard is covered and mutation-proven. Writing another test around `closed` would repeat the mistake rather than fix it.

- Round 3 closed the cycle at its cap with 0 blockers. Both WARNs accepted and fixed in 4_2 rather than carried: W4 (two cleanup regressions made vacuous by the token gate) and S3 (a CSS `calc` that read as a measurement without being one). Neither was rebutted, so no further re-review round is owed — the cycle ends at Re-Verify.

- The spec delta's two MODIFIED requirements did not exist in the target spec and `apply` refused them. "Escape closes the branch list before it dismisses the dialog" is new behaviour and is now ADDED; the keyboard/dismissal constraints belong to the shipped requirement actually named "The create form leads with the branch name", which is what the MODIFIED block now replaces — carrying its three existing scenarios through unchanged.
