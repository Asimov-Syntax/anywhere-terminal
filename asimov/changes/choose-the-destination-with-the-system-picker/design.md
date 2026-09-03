# Design: choose-the-destination-with-the-system-picker

## Decisions

### D1: The chosen folder is a ROOT to derive under, not a destination to take

A picked folder becomes the folder the worktree is created IN. The worktree keeps the name the host
derives from the branch, and collision suffixing happens inside the chosen folder.

This is what makes the feature composable with everything already here. `resolveDestination`
(`WorktreeHost.ts:2007-2048`) already derives `base` from the repository label and the branch slug and
hands it to `suggestFreePath(root, base, taken)` (`createPath.ts:419-437`). A chosen folder is a
different `root` for that one call and nothing else: the same base, the same suffixing, the same
`occupiedCandidate` the form already renders as "*x* already exists, so this is created as *y*".

The rejected alternative was the original D1 — the picked folder IS the destination. It fails on its
own terms: `showOpenDialog` can only return a folder that EXISTS, and an existing directory is
`taken`, so `resolveDestination` would have discarded the pick and suffixed under the configured root
anyway. The user would have chosen a folder and been given a different one every time.

**The webview composes no path.** It states that it is using the folder; the host states the
destination. The form displays `targetOf(effective)` — the host's own `freePath` — which becomes
`draft.path` (`WorktreeCreateDialog.ts:2223-2237`, `:2740`), is submitted at `:1989-2000` and posted
unchanged by `WorktreeController.ts:729-737`. A destination derived under a chosen folder therefore
travels to `git worktree add` through the path that is already there, with no new field on the create.

### D2: The host owns the dialog, and answers only the opening that asked

Unchanged, and already built (tasks 1_1, 1_2). The webview posts a request naming the repository and
the `opening` that composed it; the host opens
`vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false })`
and replies with the chosen `fsPath`, echoing the same `opening` back.

Echoing the opening is what makes a late reply harmless. A dialog is modal to the user but async to
the extension: a user can cancel the create form, open a second one, and only then confirm the first
picker. Without the identity, that stale answer would land in a form that never asked.

**The identity must be a snapshot, not a reading.** The controller advances `refsToken` before each
opening (`WorktreeController.ts:972-985`) and predecessors can outlive that advance (`:677-682`), so a
dialog that asked its controller "what is the opening?" at reply time would read the SUCCESSOR's
number and accept an answer meant for a form that no longer exists. The opening is therefore taken
once, into the dialog's own dependencies at construction — the way `WorktreeView` already snapshots it
for retirement (`WorktreeView.ts:600-615`).

### D3: Cancel and failure are the same answer — no reply

Unchanged, and already built. A cancelled picker, a picker that throws, and a confirmed choice whose
form has since been dismissed all produce no reply at all rather than a reply carrying an empty path.
There is no state to restore because none was taken: the form is not disabled while the dialog is
open, since the dialog is already modal to the user, and a form disabled behind an OS dialog that
never returns would be a form the user cannot escape.

The third case is a separate obligation from the first two and has its own check: the host re-reads
the live opening AFTER the await and drops an answer that no longer names it
(`WorktreeHost.ts:2074-2095`).

### D4: The host records the folder it RESOLVED, and records it as a prepared root

The probe refuses a destination outside the configured create root because its answer authorizes
`options.exists`, which follows symlinks — an arbitrary candidate turns the probe into an existence
oracle for the filesystem (round-3 B8). That refusal is correct and is not relaxed.

What changes is that the host now knows one folder without being told: it opened the dialog itself,
so the user selected that folder in an OS dialog, saw its contents there, and the host watched it
happen. The `Opening` gains one field:

```ts
/**
 * The folder THIS host handed THIS form from its own dialog, already resolved.
 *
 * A `PreparedRoot`, not a spelling. The plan attack showed why: a recorded
 * string is re-resolved when it is next used, so retargeting a link between the
 * dialog and the probe would move consent onto a directory the user never saw.
 * `prepareResolvedRoot` runs ONCE, here, on the answer the dialog returned — the
 * same "root resolved once by the caller" contract every other holder of a
 * PreparedRoot follows (`resolvedPathBoundary.ts:59-68`).
 *
 * Singular: the LAST folder handed out. Same shape and same lifetime as
 * `debrisCandidate` and `publishedRepair` beside it, and the smallest area that
 * covers what one form can actually be using.
 */
chosenRoot: PreparedRoot | null;
```

Scope follows the map that holds it. `openingKey` is `(surface, repository)`
(`WorktreeHost.ts:1274`), so a chosen folder belongs to one form's view of one repository — which is
right, since the pick request names a repository and a different repository has a different configured
root and a different derived name.

Lifetime is free and is not a new rule: `retireOpening` deletes every `openings` entry for the surface
(`WorktreeHost.ts:972-976`), reached by close (`:3069`), supersede (`:3128`) and detach through
`forgetSurfaceOpenings` (`:4190-4205`). The record lives on the `Opening` object those entries hold, so
it goes when the object goes. Nothing sweeps it separately, because nothing needs to.

**Every way this record can be lost is fail-safe, and that is load-bearing.** `requestWorktreeRefs`
REPLACES the `Opening` even for a token it already holds (`WorktreeHost.ts:3411`), which drops
`chosenRoot` exactly as it already drops `debrisCandidate` and `publishedRepair`. The shipped
controller cannot do this — `refsToken` is advanced immediately before the only ask
(`WorktreeController.ts:985-1006`) — but the webview is untrusted and a replay must be assumed. Losing
the record narrows the honoured area to the configured root; it can never widen it. So this stays a
missing-consent path, not a hole, and the user-visible cost is a silent fallback the follow-up change
`say-why-a-destination-was-refused` owns.

### D5: The probe carries no path — one flag, and the host reads its own record

`WorktreeCreateProbeMessage` gains one optional field beside `candidatePath`:

```ts
/**
 * Derive the destination inside the folder this form chose, if the host still
 * holds one for it.
 *
 * A FLAG, not a path. The form has no folder to send that the host did not give
 * it, so sending one back would create a webview-supplied path to resolve —
 * and the plan attack showed that door does not close cleanly: the containment
 * primitive refuses a candidate equal to the root and admits its unselected
 * descendants (`resolvedPathBoundary.ts:84-86`, `:141`), which is the wrong
 * predicate in both directions. Nothing the webview says is resolved here, so
 * there is no predicate to get wrong.
 *
 * The flag exists rather than the host simply always using its record because
 * the user needs a way back: absent means the configured root, which is how a
 * form that cleared its destination says so.
 */
useChosenFolder?: true;
```

The host resolves the root once, synchronously, with no await of its own:

```
root = candidatePath vetted inside create root   → resolveDestination(override)      (unchanged)
     : useChosenFolder && opening.chosenRoot     → resolveDestination under it
     : configured create root                                                        (unchanged)
```

`candidatePath` keeps its existing rule verbatim, vetted by `vettedOverride`
(`WorktreeHost.ts:1981-1997`) against the configured root exactly as today. It is branched on by
FIELD PRESENCE, not on whether `vettedOverride` returned a value — otherwise a typed path refused for
being out of root would fall through to the chosen folder, which is a widening this change does not
claim. The form never sends both.

**No new await, and that is the point.** `answerCreateProbe` already suspends twice (`vettedOverride`,
then `opening.read`) and re-checks `stillOurs()` after each (`WorktreeHost.ts:2107-2110`). Vetting a
webview-named parent would have added two more — `prepareResolvedRoot` then
`authorizedPathInsideRoot` — across which `stillOurs()` proves neither that the same `Opening` object
survives nor that the record still says what it said, since a same-token refs replay resets
`latestSeq` to `-Infinity` (`:3411`). Reading the record needs no await, so it is read from the
opening `stillOurs()` just returned and used in the same synchronous step as `resolveDestination`.

### D6: The form holds "using the chosen folder" as a third destination state

The form's destination is derived, typed, or derived-inside-the-chosen-folder. `pathIsDerived` stays
true in the third state — the destination IS derived, just from a different root — so `syncDerived`
keeps writing the host's answer into the field and the user keeps seeing the full path they will get.

```
                     ┌──────────────── typed ────────────────┐
                     ↓                                       │
[derived]  ──pick──> [derived in chosen folder] ──type────>  [typed]
    ↑                        │                                 │
    └──── clear / switch ────┴───────── clear ─────────────────┘

state              pathIsDerived   supplied   usingChosen   probe carries
derived            true            ""         false         —
in chosen folder   true            ""         true          useChosenFolder
typed              false           <path>     false         candidatePath
```

Typing clears `usingChosen` because a typed path names a destination outright; the two are never both
live. Clearing the field returns to the configured root.

**Switching repository clears it too**, and this is not cosmetic. The form is form-wide across
repositories (`WorktreeCreateDialog.ts:1250-1269`) while the record is per repository (D4), so a flag
carried across a switch would ask repository B to use a folder only A was given — and B would fall
back to its configured root in silence, which is the failure this whole handback came from.

**Between a transition and its answer the form shows the previous resolution.** `syncDerived` computes
`stated`/`draft.path` from `effective` before `askForDestination()` invalidates it later in the same
pass (`:2717-2740`, `:2818-2832`), so after a pick the field still holds the predecessor's path until
the new answer lands. That is a pending state, not a fourth destination state: field and `draft.path`
stay mutually consistent and Create is disabled while `outstanding` is true, so nothing can be
submitted against a destination the form has moved past.

`askKey` (`WorktreeCreateDialog.ts:2073-2074`) gains the flag, or picking would be a selection the
form considers already asked and never probes.

The transition has ONE owner. What the form submits is not read from the input: `selection()` reads
`pathIsDerived` and `supplied` (`:2201-2214`), and `syncDerived` re-derives over the input whenever
the caret is elsewhere (`:2721-2731`) — which after a picker it always is. A caller that assigned
`pathInput.value` would be silently overwritten. So the `input` listener, the picker's answer, and the
repository switch all call one named transition, and the picker action shares the override's own
availability: `reattach` and `adopt` disable the override (`:2621-2639`) because those modes do not let
the user choose a target.

## Obligation Ledger

| Claim | Semantics | Defeater | Witness/check | Disposition |
|---|---|---|---|---|
| A folder no dialog offered this form is never derived under | For every probe, the root handed to `resolveDestination` is the configured create root, the vetted `candidatePath`, or a `PreparedRoot` this host built from its own dialog's answer for this opening — never a value any message carried | A webview obtains an occupancy answer for a directory the user never selected in a dialog | A host test probing with `useChosenFolder` on an opening that never picked, asserting `freePath` is under the configured root AND the `exists` spy recorded nothing elsewhere; the probe's own type carries no path field, so the stronger check is that there is nothing to name | supported — the flag replaced the parent field precisely because the plan attack showed the containment predicate is wrong in both directions (`resolvedPathBoundary.ts:84-86`, `:141`); with no webview-supplied path there is no predicate |
| Consent is pinned to the folder the user saw | `chosenRoot` is the `PreparedRoot` resolved once at pick time; no later resolution of the picked spelling can move it | A link retargeted between the dialog and the probe moves the honoured area onto a directory never selected | A host test whose `realpath` answers differently on the second call, asserting the answered `freePath` is under the FIRST resolution | supported — `prepareResolvedRoot` runs in the pick continuation and its result is stored, so the spelling is never re-resolved (D4) |
| Consent does not outlive the form that received it | A `chosenRoot` recorded on one `Opening` is unreachable after `retireOpening` and from any other opening or repository, with no sweep of its own | A picked folder honoured for a later form on the same surface, for another repository, or after close, supersede or detach | Host tests over close (`:3069`), supersede (`:3128`) and detach (`:4190-4205`), each picking then retiring then probing with the flag and asserting the configured-root answer; plus a two-repository test asserting B is unaffected by A's pick | supported — the record lives on the object those paths delete (`:972-976`), and the map key is per repository (`:1274`) |
| Losing the record can only narrow | Every path that drops or replaces an `Opening` yields the configured root, never a wider one | A dropped record leaves a stale wider root in force, or a replay gains one | A host test replaying `requestWorktreeRefs` with the live token and asserting the next flagged probe answers under the configured root | supported — replacement writes a fresh `Opening` whose `chosenRoot` is null (`:3411`), and the fallback is the configured root by construction (D5) |
| The typed override's boundary is exactly what it was | `candidatePath` is honoured iff it resolves inside the configured create root, whether or not a folder was chosen | A pick makes an out-of-root TYPED path honourable | A host test picking a folder, then probing with an out-of-root `candidatePath` AND the flag, asserting the configured-root answer — the case that fails if the implementation branches on `vettedOverride`'s result instead of the field's presence | supported — D5 fixes the branch on field presence, and `vettedOverride` and its call are untouched |
| A create lands where the form said it would | The path in `git worktree add` argv equals the destination the form displayed, for a create composed after a pick | The form shows the chosen folder's path and git receives the configured root's derived path | An assembly test driving the shipped wiring: pick a folder, submit, assert the `worktree add` argv carries the folder-composed path | supported — the form submits `draft.path`, which is the host's own `freePath` (`:2740`, `:1989-2000`, `WorktreeController.ts:729-737`) |
| A chosen folder is not persisted anywhere | No configuration, workspace state or storage write happens on a pick; the record is in-memory on one `Opening` | A picked folder written to settings, making one create's choice the default for every later one | Inspection of the pick path plus the Boundary on task 2_1; the assembly test would show a settings write as a spy call it does not make | supported — `pickDestination` posts and records only, and no settings writer is reachable from it (`WorktreeHost.ts:2074-2095`, `extension.ts:548-562`) |

## Stated non-goal, so it is not mistaken for a gap

Consent governs the PROBE's occupancy read, not creation authority. `worktreeCreate` hands `msg.path`
straight to `create(request)` with no containment check at all (`WorktreeHost.ts:2586-2599`), and this
change does not add one — it neither widens nor narrows what a create may name. That pre-existing
shape is why the probe's silent refusal, not the create, was what substituted a derived path for a
chosen one, and it is recorded as a knowledge candidate in workflow.md.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| Consent record | The webview claims a folder it was never given | Nothing the webview sends is resolved; it sends a flag and the host reads its own record (D5) |
| Consent identity | A link retarget moves the honoured area | A `PreparedRoot` resolved once at pick time, never the spelling (D4) |
| Consent lifetime | A folder outlives its form or reaches another repository | The record lives on the `Opening` object `retireOpening` already deletes, under a per-repository key (D4) |
| Record loss | A dropped record leaves something wider in force | Every loss path falls back to the configured root by construction (D4, D5) |
| Typed override | A pick widens what a typed path may name | The branch is on field presence, not on the vetting's result (D5) |
| Form state | A flag survives a repository switch and silently does nothing | The switch calls the same transition that clears it (D6) |
| Probe caching | A pick is never asked about | The flag enters `askKey` (D6) |
