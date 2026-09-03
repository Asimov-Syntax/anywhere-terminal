# Workflow State: choose-the-destination-with-the-system-picker

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

Blueprint: none
Lane: full
Planned at: 7abcebf7

Blueprint: none
Lane: full — escalation flags: new-api-contract (a new request and a new reply on the worktree wire)
Planned at: 71b53ca1
Plan attack: the oracle refuted row 1 and left row 2 unresolved, and both were repaired in design rather than accepted. Writing `pathInput.value` is not the transition a typed override performs — `selection()` reads `pathIsDerived`/`supplied` and `syncDerived` overwrites an unfocused input — so the transition gained one owner both callers use. The opening must be snapshotted at construction, because a predecessor dialog reading the controller's token at reply time would read its successor's. It also named five wire surfaces the first plan omitted: the inbound allowlist, the exhaustive inbound sample, the router, the worktree handler map, and the destination row's stylesheet.

Handback (2026-09-04): the user chose parent-folder semantics for the picker and a spoken refusal for
a rejected destination, refuting D1 and the spec's "the form's destination becomes that folder".
Gate 2 unticked and re-earned. Tasks 1_1 and 1_2 stay `[x]` — the wire request, the reply, the host
dialog and the router route are all unchanged by the new semantics; only what the answer MEANS moved.
Auto-decision (fastlane): the picked parent travels as its own probe field rather than replacing
`candidatePath`'s meaning, so one field never carries two kinds of path.
Auto-decision (fastlane): the consent record is singular per opening — the LAST folder this host
handed this form — matching `debrisCandidate`/`publishedRepair` in shape and lifetime, and keeping
the honoured area as small as the form can actually be using.
Follow-up (split out, not planned here): `say-why-a-destination-was-refused` — the destination field
states that a TYPED override resolving outside the create root was refused and names the path used
instead. Today `vettedOverride` (src/providers/WorktreeHost.ts:1989-1997) drops it in silence. That
is a separately testable owner covering overrides that exist with no picker involved; this change
only makes a PICKED folder honourable, it does not make a refusal speak.
Knowledge candidate: the create path does not re-resolve the destination it is handed — `worktreeCreate` passes `msg.path` straight into `create(request)`; only the PROBE vets containment, and the form submits the probe's own answer, so the probe's refusal is what silently substitutes a derived path | Surprise: D1 of this change asserted "the host re-resolves it on every create" and used that to argue the picker added no authority boundary; the assertion is false and the plan attack did not catch it | Evidence: src/providers/WorktreeHost.ts:2583 (`path: msg.path` into `create(request)`) vs :2112 (`vettedOverride` on the probe only) | Consumer: plan | Action: any future change reasoning about destination authority must locate the check on the probe, not the create, and must not claim the create re-resolves

Planned at: 2d547f39
Plan attack (replan): the oracle REFUTED the containment approach outright, and the repair made the
design smaller rather than larger. `authorizedPathInsideRoot` refuses a candidate EQUAL to its root
and admits the root's unselected descendants (`resolvedPathBoundary.ts:84-86`, `:141`) — the wrong
predicate in both directions — and a recorded spelling is re-resolved on use, so a link retargeted
between the dialog and the probe would move consent onto a directory nobody selected. So the probe
carries no path at all now: one flag, and the host reads the `PreparedRoot` its own dialog produced.
That deleted the two extra awaits across which `stillOurs()` proves neither object nor record
identity — a same-token `requestWorktreeRefs` replay replaces the whole `Opening` and resets
`latestSeq` to -Infinity (`WorktreeHost.ts:3411`). It also named three states the plan had missed:
the per-repository key vs the form-wide picker, the pending state between a pick and its answer, and
`detach` as a third retirement path. Five citation defects fixed. The spec's "nothing SHALL be read"
was unachievable — vetting must stat — and is now the checkable claim: no occupancy read outside the
configured root.

Verify gate: 7690/7690, type check clean, bundle and I10 gates green. Biome reports 18 diagnostics,
identical file-for-file to the change's base 7abcebf7 measured in a detached worktree; two format
findings this change did introduce were fixed with `biome format --write` scoped to the two files,
never the `--write --unsafe` form the lint script runs.
