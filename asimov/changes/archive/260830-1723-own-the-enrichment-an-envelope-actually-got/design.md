# Design: own-the-enrichment-an-envelope-actually-got

## Decisions

### D1: The obligation is recorded at the edge, not derived from the envelope

Two routes were named at review: propagate "did preview enrichment complete" out of `project`, or
hold an explicit outstanding-enrichment obligation in the host. The second is smaller and does not
widen a shared type.

`WorktreePresence` is what the projector returns and what the host publishes; adding a
"how complete is this" field to it puts a fact about the PRODUCTION of an envelope inside the envelope
itself, where every consumer sees it and none but one needs it. The host, by contrast, already owns
both halves of the question — it knows a projection is in flight (`projectionRun`,
`WorktreeHost.ts:458`) and it is the thing that calls `forgetDrawOrder()`.

So the host keeps one more boolean: when the row-drawing falling edge fires WHILE a projection is in
flight, that projection is exactly the one whose preview half the projector's fence will skip, and the
host records that enrichment is still owed. `enrichmentOwed()` becomes
`anyDrawingRows() && (!projectedEnriched || enrichmentPending)`.

### D1a: The obligation is discharged by the PASS that satisfies it, not by the run that contains it

Two placements were tried and both are wrong. Clearing where the envelope's enrichment is RECORDED is
wrong because the projection this flag exists for is the one cut short mid-flight: it publishes AFTER
the edge and wipes the obligation the edge had just recorded. Clearing where a RUN starts is what
shipped and it hangs. `requestProjection` is single-flight, so a surface reopening mid-run joins the
run in flight (`WorktreeHost.ts:1259`) and never reaches the run-start clear; the joined run's pass
then completes clean, `enrichmentOwed()` is still true, and the pass loop dirties itself. Nothing
inside that loop clears the flag, so every following pass enriches, finds the flag still set, and
dirties itself again — the loop never exits and the envelope is never published. A run is the wrong
unit because a run can contain any number of passes and a joiner can enter it after it started.

The pass is the right unit. Each iteration of the pass loop clears the obligation at its own start,
and only when it is going to enrich (`anyDrawingRows()`); an iteration that is not enriching cannot
satisfy an enrichment obligation and must leave it standing for the next rise — defence in depth,
since a non-enriching pass that completes records `projectedEnriched = false` and the owed predicate's
other disjunct already catches it; the guard is what holds for a pass that clears and never records.
This is exactly the
"began after the recorded edge and was not crossed by a newer one" rule, without a counter: an edge
landing before the iteration starts is what that iteration's enrichment answers, and an edge landing
during it re-sets the flag, which the loop then reads as owed and spends on one more pass.

Load-bearing and easy to break silently: the clear and `projectOnce`'s own `anyDrawingRows()` read are
in ONE synchronous span — the iteration clears, calls `projectOnce`, and `projectOnce` runs to its
`await projector.project(...)` without yielding. Insert an await between them and the two can disagree,
clearing an obligation the pass then declines to satisfy. `enrich` stays read inside `projectOnce`
(`:1233`) rather than threaded in, because the NEXT pass is what should react to a rail that opened or
collapsed mid-flight; the coupling is the tick, not a parameter.

A pass that does not deliver restores what it cleared. A projection that REJECTS leaves
`projectedEnriched` holding `true` from the cut-short pass, so an un-restored obligation reads as
satisfied and no retry follows until some unrelated caller dirties a run — the missing second line
waits for the next external scan. The run therefore remembers whether any of its passes cleared the
obligation and re-records it in the `catch`. Over-restoring is the safe direction and is already
bounded at one redundant enriched pass by the inventory below. An INVALIDATED pass needs nothing:
it sets `projectionDirty` itself, so the loop runs another pass that re-clears and completes. That
distinction is not folded into this rule — invalidated means "this pass was overtaken", which the
existing forced full rerun already answers (`:1310-1318`).

### D2: In-flight is the condition, because reconcile is not an edge check

The naive fix — clearing `projectedEnriched` whenever nothing is drawing — moved 19 existing cases,
and the reason is in `reconcileRowDrawing`'s own comment: it is "deliberately NOT an edge check", so it
runs on EVERY mutation of `visible`, `level` or `displayed` while nothing draws rows. Clearing there
fires on all of them, and each later rise then pays for a replacement pass nobody needed.

Gating on `projectionRun !== undefined` narrows it to the only case that can produce the defect. A
falling edge with no projection in flight skips nothing, because there is no pass to skip: the envelope
already standing was either fully enriched or already recorded as un-enriched, and both are answered
correctly today. This keeps the proposal's "must not fire on a mutation that changed nothing" true by
construction rather than by a second guard.

It also keeps the edge passive. The falling edge records; it never requests. The rise spends the
obligation through the path that already exists, so there is one place that asks for a projection.

## Failure-surface inventory

| Resource | Answer |
|---|---|
| `enrichmentPending` | A single boolean on the host's closure, single-owner, single-threaded in the extension host. Set on the falling edge while a projection is in flight, and re-set by a run whose projection rejected after one of its passes cleared it; cleared at the start of each pass that is going to enrich. A stuck-true costs one redundant enriched projection on the next rise; a stuck-false costs the five-second wait this change removes. Neither authorises anything, and nothing is persisted. Reads never fail — it is a field, not a resource. n/a for crash and for two hosts |

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `reconcileRowDrawing` | The obligation is recorded on mutations that changed nothing, so every rise pays for a pass | D2 — gated on a projection being in flight; unit test drives repeated no-op mutations while not drawing and asserts no extra enriched projection follows the rise |
| `enrichmentOwed` | The flag never clears, so every rise re-enriches forever | Cleared at the start of every enriching pass (D1a); unit test asserts a second rise after a completed enriched pass asks for nothing |
| Pass loop | A joined reopening leaves the flag set, so each pass dirties itself and the run never publishes | D1a — the unit of discharge is the pass, not the run; unit test reopens a surface BEFORE releasing the parked projection and asserts exactly one replacement pass publishes |
| Rejected projection | A pass that cleared the obligation and then threw leaves it reading as satisfied | D1a — the run re-records in the `catch`; unit test rejects `project()` and asserts the next rise is still owed a pass |
| Falling edge | Recording turns into requesting, so a hiding window starts work | The edge only assigns; unit test asserts no projection is requested by the falling edge itself |
| Interaction with WT-011.7 | The obligation is recorded for a projection the fence did NOT skip, costing a redundant pass | Accepted and bounded at one pass: the host cannot see the projector's fence without the field D1 rejects, and an edge landing mid-projection is the same condition the fence tests. Unit test pins that the redundant case is at most one pass |
