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

Review round 1 (cycle 1, discovery, `7abcebf7..dc96853c`): REJECT — 3 BLOCK, 1 WARN, all four
accepted, none rebutted. F001 and F003 fixed as task 3_1, F002 and F004 as task 3_2.
F002 was already written down: the plan attack above says "the opening must be snapshotted at
construction, because a predecessor dialog reading the controller's token at reply time would read
its successor's", and 2_2 built the callback reading `this.refsToken` anyway. The design was right and
the build did not carry it; the panel had already retired the same hazard once for `onCreateClosed`
(round-1 B3).
F001 is unreachable from the shipped panel — `openCreateForRepo` advances `refsToken` before the only
`requestWorktreeRefs` post, `onCreateClosed` only advances it, and openings are keyed per surface, so
no same-token replacement can arise. Fixed anyway rather than rebutted: this change carries the
`security-privacy` flag on a consent record, and 2_1's own witness already states the posture that
"the webview is untrusted and a replay must be assumed".
Impact manifest for the re-review: F002's fix moves the picker answer's identity source from the
controller's live opening to the opening snapshotted in `createDialogDeps()`. Reachable call sites
are `onPickDestination`, `bindDestinationPicked` and `handleDestinationPicked` (routed only from
`worktreeMessageHandlers`); entry modes are a fresh dialog, a superseded dialog still on screen, and
no dialog at all, which now falls to the `bound === null` arm. The token check is KEPT beside the new
one — a pick for a retired opening is still dropped on the token — so `[2_2] drops a folder picked
for a PREVIOUS opening` keeps its first claim and only its second half was rewritten, to bind the
successor its own deps the way the panel does. F001/F003's fix narrows only: a pick or probe whose
opening object was replaced now drops instead of writing, and an older pick's resolution loses to a
newer confirmation.
Verify gate (re-run after 3_1 and 3_2): 7696/7696, type check clean, bundle and I10 gates green,
`verify-status` exits 0 with all seven tasks stamped. Biome reports 17 diagnostics (1 error), and the
set is identical file-for-file to base 7abcebf7 linted with this tree's own Biome binary — none is in
a file this change touches; `worktreePanel.css:635` is `.wt-hist-label`, from `add-worktree-panel-shell`.

Round 2 superseded (mode `superseded`, REJECT, 3 accepted blockers left unverified): my fault, not a
finding. I scoped the verification round `dc96853c..HEAD`, and that range carries `d3c50c64` and
`7f684acd` — the F009 fix and the archive commit of the independent, already-archived
`find-env-files-the-workspace-declares`, including its semantic edit to `asimov/specs/worktree-panel/spec.md`.
The chair refused to silently filter a range the caller stated, which is right. The change's own
commits are not contiguous — four other changes landed between `71b53ca1` and HEAD — so round 3 is
dispatched with the explicit picker-commit list rather than a range. F001–F004 stay accepted and
unverified.

Round 3 (cycle 2, discovery, explicit picker-commit list): BLOCK, 2 blockers. F002, F003 and F004
confirmed fixed; F001 survives in a narrower window and F005 is new. Both accepted, neither rebutted.
Taken as option 1 of the remediation boundary — a designed fix, handed back to plan — because F005's
second half cannot be built inside the accepted design. "Mark pending at click" needs a terminal
outcome for the pick, and D3 says cancel, failure and a dismissed form all produce no post at all, so
a cancelled dialog would leave the form pending forever — the exact trap D3 exists to prevent. The
fix D3 forbids is the fix this needs, so D3 has to move: only a form that is GONE may be answered
with nothing. F001's remaining window is mechanical (the probe anchors after `vettedOverride`'s await
instead of taking the opening the dispatch already admitted) and rides along rather than landing
alone, which would have closed the cycle as superseded and burnt a round for a three-line change.

Replan (round-3 handback, 2026-09-04): D3 amended and D7 added; Gate 2 and the Implement gates the
redesign invalidates unticked. Three ledger rows added, one of them `unresolved` by construction and
named as such — a `showOpenDialog` that never settles has no reply that could release the form, and
the shipped API always settles.
Auto-decision (fastlane): the pick channel mirrors the debris authorization beside it — `ask` on the
request, echoed on the answer — rather than inventing an identity, because that channel already
solved this exact problem for this exact reason and already answers a refusal instead of going quiet.
Auto-decision (fastlane): the form arms the destination gate it already has (`outstanding`) rather
than adding a fourth destination state, so the pending state costs no new blocked-reason prose. The
user has separately said the create form explains too much, so 4_3's Boundary forbids adding any.
Auto-decision (fastlane): the sibling create callbacks still reading `this.refsToken` at event time
(`onSelectionChange`, `onProvisionSwitch`, `onProvisionSave`, `onAuthorizeDebris`) stay out of scope —
the round-3 chair explicitly accepted leaving them, and successor openings start with `chosenRoot: null`.

Plan attack (replan): the oracle refuted two of the three new ledger rows and the reasoning under a
third; all six findings accepted, none rejected, and the design got smaller in one place and stricter
in two. Reusing the form's existing `outstanding` flag was unsafe — nothing disables Choose while a
probe is in flight, and that probe's answer clears the flag and re-arms Create at the pre-pick
destination — so the pick holds its own gate. D3's "gone" was too wide: two arms of `pickDestination`
drop an answer while the surface and token still live, and both are now answered. D7's claim that
`stateDestination` is the only writer of destination state was simply false — `syncDerived`'s
`destRefused` arm writes it directly, which is where round-1 F004 was fixed — so the claim is narrowed
to the three replacements the spec names. The spec demanded the form say it is "waiting on the folder"
while task 4_3 forbids new prose; the spec yielded, because the user has said this form explains too
much and the reason it gives is the same kind of reason as any other unresolved destination.
The "a pick that never settles" row stays `unresolved` on the oracle's advice: the premise that
`showOpenDialog` always settles was an assertion, not evidence, and a timeout is the wrong remedy —
the host cannot tell a hung picker from a dialog the user still has open.
