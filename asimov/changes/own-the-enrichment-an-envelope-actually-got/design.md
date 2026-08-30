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

The flag clears where a run STARTS, not where it publishes. Clearing at publish is the obvious
placement and it is wrong: the projection this flag exists for is the one cut short mid-flight, so it
publishes AFTER the edge and would wipe the obligation the edge had just recorded. A run that begins
after the edge is the one entitled to clear it, and no await separates that assignment from the run's
own synchronous prefix, so no edge can land in between.

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
| `enrichmentPending` | A single boolean on the host's closure, single-owner, single-threaded in the extension host. Set on the falling edge while a projection is in flight; cleared when an enriched projection lands. A stuck-true costs one redundant enriched projection on the next rise; a stuck-false costs the five-second wait this change removes. Neither authorises anything, and nothing is persisted. n/a for crash and for two hosts |

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `reconcileRowDrawing` | The obligation is recorded on mutations that changed nothing, so every rise pays for a pass | D2 — gated on a projection being in flight; unit test drives repeated no-op mutations while not drawing and asserts no extra enriched projection follows the rise |
| `enrichmentOwed` | The flag never clears, so every rise re-enriches forever | Cleared where `projectedEnriched` is set; unit test asserts a second rise after a completed enriched pass asks for nothing |
| Falling edge | Recording turns into requesting, so a hiding window starts work | The edge only assigns; unit test asserts no projection is requested by the falling edge itself |
| Interaction with WT-011.7 | The obligation is recorded for a projection the fence did NOT skip, costing a redundant pass | Accepted and bounded at one pass: the host cannot see the projector's fence without the field D1 rejects, and an edge landing mid-projection is the same condition the fence tests. Unit test pins that the redundant case is at most one pass |
