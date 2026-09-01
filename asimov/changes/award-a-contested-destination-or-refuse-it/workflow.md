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
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-012.18
Lane: full — HIGH risk: two accepted requirements constrain one order, and the folding key is deliberately over-inclusive so over-refusal loses a declaration | flags: new-api-contract
Planned at: 8a48e52c
- Plan attack run before Gate 2. It refuted FOUR ledger rows and the design was rewritten rather than argued: D4's pre-existing check ran only against the loser, so the favoured member merged into a destination that was already there while only the loser was reported; the D3 reading cannot attribute a name another entry's directory walk or another process created, so the "skipped, awarded to f" outcome claimed a causal fact the apply cannot establish and is now a refusal; promoting the favoured member ahead of the copy pass gave an UNCONTESTED `Foo/seed` copy a new refusal, so the loser yields its place instead and nothing is promoted; and D6's folding-key test would have refused an ordinary `Foo -> foo` beside a real `foo` on a case-sensitive volume, destroying material to prevent a loop that volume cannot have.
- Gate 2 taken under fastlane on the standing goal, with the user away. The scope cut it carries: the folded self-loop (a link that loops only because the destination folds) is NOT owned here — it needs the twin-create probe this change refuses to assume, and the filesystem answers ELOOP to a reader meanwhile.
- Round 1 REJECTed with four blockers and every one of them changed an artifact rather than a line, so cycle 1 closed at triage instead of opening a fix loop: D3 now owns two readings and a four-state observation (one reading cannot show that the favoured member own write created its destination, and "not ENOENT" is not "absent"), D4 gained the row those imply, D4a says a refusal names every member including itself, and D5 owns the returned ORDER — the closure answered in execution order and the extraction had quietly changed it to provider order.
- Gate 2 re-earned under fastlane on the standing goal, with the user away. Nothing in the four fixes widens scope; the mechanism, the non-goals and the refused twin-create probe are unchanged.
- 4_1 build evidence corrected D3/D4 before any review saw them: the entry gate itself lstats the destination (`src/utils/resolvedPathBoundary.ts:117-121`), so `inadmissible` cannot be told apart from `unreadable` and refuses a contest like any other unproven destination. Row 1 now reads "anything but `absent`".
- Round-2 handback cut accepted scope: the spec scenario promising BOTH members land on a case-sensitive volume is withdrawn, because an oracle attack established that a held member's post-claim `absent` cannot be told from the favoured member's object being unlinked, and writing it there is exactly how the inherited declaration wins a folded destination. The user was asked which way to settle it and was away for 600s; the alternative was a risk acceptance, which only the user can grant, so the refusing option was the only one available to me. Flag it at the next review.
