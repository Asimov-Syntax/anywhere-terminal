# Workflow State: cap-inferred-running

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
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Lane: light
Planned at: 21bd8d4a

Blueprint: docs/PLAN.md task WT-008.2
Lane: light — one concern (the confirmation ceiling), no contract change; flags: user-visible-ui, re-review
Planned at: 21bd8d4a

- Fastlane: no fork. docs/design/worktree-activity-ceiling.md settles the rule, the clock, the exemptions and the rejected alternative; nothing was left open for planning to choose.
- The clock is `stateStartedAt` — unchanged-activity age, not confirmation age. `lastActivityAt` is explicitly the wrong clock: it advances on the very bytes the ceiling exists to see through.
- D27 NARROWS WT-004.0 rather than satisfying it; PLAN.v4.md already carries the amendment. The review round is asked to agree with the narrowing, not just the code.
- 1_4 exists because DESIGN.md § 8.4 is a build-time gate: `src/test/invariants/registry.ts` forbids `uncovered` and `deferred`, so an invariant may only enter the table together with its covering test.
- Oracle round 1: seven findings, all verified against the code, all accepted. Two changed the contract rather than the plan — `unknown` outranks `running (unconfirmed)`, because a failed source cannot support a claim of running at all; and the collapsed pill groups exact presented states, so excluding the unconfirmed member would have dropped those rows from the pill entirely.
- The hint is written to an attribute at render and read at hover, so an exact elapsed figure decays between the two. Resolved by phrasing it as a lower bound rather than by adding a hover-time recompute path — a bound that is true when written stays true however long it sits unread.
- Out of scope, from oracle finding 5: suspending the deadline timer while the surface is hidden. Visibility lives in `WorktreeController`, not the view, so honouring it needs controller integration; a timer that fires unseen wastes a repaint but tells no lie, which puts it outside a truthfulness change. Recorded for a later one.
- Rejected, 6 validator warnings of one class: `running (unconfirmed)` is not embedded implementation. It is a user-visible state name, and the accepted requirement it joins already enumerates `waiting` / `running` / `unknown` / `idle` / `exited` the same way.
- Verify gate: lint's one finding inside this change's files — `noDescendingSpecificity` in `src/webview/worktree/worktreePanel.css` — reproduces at the change's base and only shifted line (514 → 522) as the new state rules pushed it down; the other 19 are pre-existing and outside these files.
- Round 2, B3: the W2 fix reintroduced the change's own failure. `renderedWorktreeIds` mirrored a `gitAvailable` early return that `render` does not have, so a retained listing during a git outage drew rows no crossing could ever repaint. Any helper claiming to mirror what the render draws needs a test that pins the two together, not a reading of both.
- Round 2, deferred: S6 (`border: double` renders as solid below 3px). Accepted as a real hole in the shape guard, not gating, and not taken in task 2_2 — a targeted threshold assertion, not a wider shape key, is the fix.
- Round 2, review integrity: the chair reported findings attributed to logic and frontend specialists it could not substantiate, and retracted them. Only the contracts lens delivered. All four findings were re-verified against source here before being accepted; none was taken on the chair's word. The two undelivered lenses are outstanding for round 3.
- Round 3: WARN, 0 gating blockers — cycle closed at the cap. Every non-gating finding was taken rather than deferred, including S6's follow-up territory, so nothing carries forward.
- Round 3, W9: the `[I17]` guard was REBUILT, not patched a seventh time. Its defect was one assumption — `.exec` returns the first match — not six missing cases: it read one rule per state and one reduced-motion block while the file holds two of the latter and already uses contextual selectors on this element. Anchoring the class name also exposed a latent merge: `running` is a prefix of `running-unconfirmed`, so those two states had been compared as a single shape the whole time.
- Round 3, S11: the scheduler now reads drawn worktree ids out of the DOM instead of restating the render's predicate. That predicate had drifted twice (`gitAvailable`, then `noFolder`); there is now none to drift.
