# Design: choose-the-destination-with-the-system-picker

## Decisions

### D1: The picked folder is a suggestion into an existing field, not a new authority

`WorktreeCreateRequestMessage.path` is already documented as untrusted — "the one action with no
host-issued id to re-resolve from" — and the host re-resolves it on every create. The picked folder
becomes the same override a user can type today, and the create carries it in the same field.

So this change adds no authority boundary. A picked folder is worth exactly what a typed one is
worth, which is the property that keeps every existing destination rule — collision, occupancy,
holds, repair targets — in force unchanged. An alternative that sent the picked path as a separate
"already validated" field was rejected for the opposite reason: it would have created a second door
into the destination with none of the first door's checks behind it.

**Writing `pathInput.value` is not that transition, and assuming it was is what the plan attack
refuted.** What the form submits is not read from the input: `selection()` reads `pathIsDerived` and
`supplied` (`WorktreeCreateDialog.ts:2136-2143`), and only the `input` listener updates those
(`:2841-2848`). Worse, `syncDerived` re-derives over the input whenever the caret is elsewhere
(`:2645-2653`) — and after a picker the caret is on the picker's button, never the input. A reply
that assigned the value would therefore be silently overwritten, and a create composed anyway would
omit `candidatePath` entirely.

So the transition gets one owner. The state change the `input` listener performs — set
`pathIsDerived` from emptiness, set `supplied`, re-sync — is extracted into a single named function,
and the picker's answer calls exactly that function. Neither caller may set the input's value
directly. This is also what makes row 1's witness meaningful: two paths through one function compose
identical creates because they are one transition, not because two implementations were compared and
found to agree.

The picker action also shares the override's own availability. `reattach` and `adopt` disable the
override (`:2293-2301`, `:2548-2562`) because those modes do not let the user choose a target; an
action that stayed live there would offer a destination the form withdraws.

### D2: The host owns the dialog, and answers only the opening that asked

The webview posts a request naming the repository and the `opening` that composed it; the host opens
`vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false })`
and replies with the chosen `fsPath`, echoing the same `opening` back.

Echoing the opening is what makes a late reply harmless. A dialog is modal to the user but async to
the extension: a user can cancel the create form, open a second one, and only then confirm the first
picker. Without the identity, that stale answer would land in a form that never asked. The create
request already carries `opening` for exactly this reason, so the picker follows the door that is
already there rather than inventing an idiom.

**The identity must be a snapshot, not a reading.** The controller advances `refsToken` before each
opening (`WorktreeController.ts:972-985`) and predecessors can outlive that advance
(`:677-682`), so a dialog that asked its controller "what is the opening?" at reply time would read
the SUCCESSOR's number and accept an answer meant for a form that no longer exists. The opening is
therefore taken once, into the dialog's own dependencies at construction — the way `WorktreeView`
already snapshots it for retirement (`WorktreeView.ts:600-615`) — and both the request it sends and
the comparison it makes against a reply use that one captured value.

### D3: Cancel and failure are the same answer — no reply

A cancelled picker, a picker that throws, and a confirmed choice whose form has since been dismissed
all produce no reply at all rather than a reply carrying an empty path. There is no state to restore
because none was taken: the form is not disabled while the dialog is open, since the dialog is
already modal to the user, and a form disabled behind an OS dialog that never returns would be a form
the user cannot escape.

The third case is a separate obligation from the first two and needs its own check. Dismissing the
create form does not detach the surface, so a confirmed selection can still be posted after the form
is gone; the host re-reads the live opening AFTER the await and drops an answer that no longer names
it, the way its other post-await ownership checks already do (`WorktreeHost.ts:2142-2158`). The
webview's own opening comparison is the second half of the same rule, not a substitute for it.

## Obligation Ledger

| Claim | Semantics | Defeater | Witness/check | Disposition |
|---|---|---|---|---|
| A picked folder is validated exactly as a typed one is | The picked `fsPath` reaches the host only in `WorktreeCreateRequestMessage.path`, and no other field of the create differs between a typed and a picked destination | A create composed by the picker takes a path the host does not re-resolve, or skips a collision, occupancy, or hold check a typed path faces | A test composing the same destination both ways and asserting the two outbound create messages are identical, plus a test that the picker action is unavailable wherever the override is | supported — D1 rewritten after the attack showed `selection()` reads `pathIsDerived`/`supplied`, never the input, and `syncDerived` overwrites an unfocused input |
| A stale picker answer cannot steer a form that did not ask | A reply is applied only when its `opening` equals the form's own | A reply from a dismissed form's picker changes the live form's destination | A test replying with a foreign `opening` and asserting the destination is unchanged, over a form whose successor has already advanced the controller's token | supported — D2 amended: the opening is snapshotted into the dialog's deps at construction, never read from the controller at reply time |
| Cancelling changes nothing | No reply is posted for a cancelled or failed dialog, and the form's destination and armed state are what they were | Cancelling clears the destination, disarms Create, or leaves the form waiting | Tests over cancel, over a throwing dialog, and over a confirmed choice whose form was dismissed before the dialog returned | supported — the first two follow the shipped `fileTreeHost` shape; the third gained the post-await liveness check the attack found missing |

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| Wire | A second, unchecked destination door | One existing untrusted field, no new one (D1) |
| Async dialog | A stale answer steers a live form | `opening` echoed and matched (D2) |
| Cancel path | The form is left waiting or cleared | No reply at all; the form is never disabled (D3) |
| Late confirm | An answer outlives the form that asked | Host re-reads the live opening after the await (D3) |
| Routing | A reply is declared but production-dark | The reply is added to the router and the worktree handler map, and witnessed through the assembly test (D2) |
