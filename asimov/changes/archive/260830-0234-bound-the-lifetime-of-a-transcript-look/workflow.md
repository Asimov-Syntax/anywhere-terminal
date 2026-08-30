# Workflow State: bound-the-lifetime-of-a-transcript-look

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
- [x] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-011.3`)_

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-011.3
Lane: full — new failure-surface decision (a timeout has to fail in a direction) + escalation flag `re-review`; Mode: fastlane
Planned at: 04f78aa4

Auto-decision (fastlane): the admission screen ran twice — the deadline and the per-tick work bound look like two invariant owners, but LRU eviction defeats the deadline's fence (an evicted entry re-asks and launches a second operation against the same hung path), so they are one owner: the lifetime and slot of an outstanding look. Not split; WT-011.3 stays whole.
Oracle round: 3 BLOCK / 3 WARN / 1 SUGGEST. F1 and F2 accepted and redesigned (draft-and-commit; the attempt registry owns the Held across eviction). F3 accepted as a finding, fix relocated to blueprint WT-011.7 — bounding looks per projection is the projector's fan-out decision, not this service's. F4 dissolved by F1's fix, task order kept. F5/F6/F7 accepted.
1_2: the attempt registry holds the owning `Held` alone, not design.md D4's `{ owner, shared }` record — `Held.inflight` already holds the raced promise and is cleared at exactly the moment a caller should stop sharing it, so the second field would have been a duplicate that could disagree.
Handback (round 1 B1-R1): design.md D5 claimed the losing race side was bounded per attempt; the deadline timer outlives the `outstanding` slot it was supposed to be bounded by. Gate 2 and the verify gate untick — the accepted `wait` interface changes, so both were earned against a design that no longer holds. Tasks stay ticked: their code is sound and the fix is additive.
3_1: a same-tick tie between the read and the deadline resolves as an expiry, not as the look. `look` is an async function, so its own resumption costs microtask hops the deadline side does not have, and no arrangement of `.then`s changes that. Left as found rather than engineered around: at 5 s the distinction is beneath anything a row can perceive, and the invariant that mattered — the loser writes nothing — is now structural.
Review closed at the standing 3-round cap with B1-R3 fixed and no gating blockers; the fix is confirmed by a mutation-checked regression rather than a fourth round.
