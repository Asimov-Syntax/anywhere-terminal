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
Planned at: 335a04a8
- Plan attack run before Gate 2. It refuted FOUR ledger rows and the design was rewritten rather than argued: D4's pre-existing check ran only against the loser, so the favoured member merged into a destination that was already there while only the loser was reported; the D3 reading cannot attribute a name another entry's directory walk or another process created, so the "skipped, awarded to f" outcome claimed a causal fact the apply cannot establish and is now a refusal; promoting the favoured member ahead of the copy pass gave an UNCONTESTED `Foo/seed` copy a new refusal, so the loser yields its place instead and nothing is promoted; and D6's folding-key test would have refused an ordinary `Foo -> foo` beside a real `foo` on a case-sensitive volume, destroying material to prevent a loop that volume cannot have.
- Gate 2 taken under fastlane on the standing goal, with the user away. The scope cut it carries: the folded self-loop (a link that loops only because the destination folds) is NOT owned here — it needs the twin-create probe this change refuses to assume, and the filesystem answers ELOOP to a reader meanwhile.
