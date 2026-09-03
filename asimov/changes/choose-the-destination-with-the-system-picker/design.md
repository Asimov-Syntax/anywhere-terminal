# Design: choose-the-destination-with-the-system-picker

## Decisions

### D1: The picked folder is a suggestion into an existing field, not a new authority

`WorktreeCreateRequestMessage.path` is already documented as untrusted — "the one action with no
host-issued id to re-resolve from" — and the host re-resolves it on every create. The picker writes
into `#wt-path`, the same override input a user can type into today, and the create carries it in the
same field.

So this change adds no authority boundary. A picked folder is worth exactly what a typed one is
worth, which is the property that keeps every existing destination rule — collision, occupancy,
holds, repair targets — in force unchanged. An alternative that sent the picked path as a separate
"already validated" field was rejected for the opposite reason: it would have created a second door
into the destination with none of the first door's checks behind it.

### D2: The host owns the dialog, and answers only the opening that asked

The webview posts a request naming the repository and the `opening` that composed it; the host opens
`vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false })`
and replies with the chosen `fsPath`, echoing the same `opening` back.

Echoing the opening is what makes a late reply harmless. A dialog is modal to the user but async to
the extension: a user can cancel the create form, open a second one, and only then confirm the first
picker. Without the identity, that stale answer would land in a form that never asked. The create
request already carries `opening` for exactly this reason, so the picker follows the door that is
already there rather than inventing an idiom.

### D3: Cancel and failure are the same answer — no reply

A cancelled picker, a picker that throws, and a webview that has gone away all produce no reply at
all rather than a reply carrying an empty path. There is no state to restore because none was taken:
the form is not disabled while the dialog is open, since the dialog is already modal to the user, and
a form disabled behind an OS dialog that never returns would be a form the user cannot escape.

## Obligation Ledger

| Claim | Semantics | Defeater | Witness/check | Disposition |
|---|---|---|---|---|
| A picked folder is validated exactly as a typed one is | The picked `fsPath` reaches the host only in `WorktreeCreateRequestMessage.path`, and no other field of the create differs between a typed and a picked destination | A create composed by the picker takes a path the host does not re-resolve, or skips a collision, occupancy, or hold check a typed path faces | A test composing the same destination both ways and asserting the two outbound create messages are identical | pending |
| A stale picker answer cannot steer a form that did not ask | A reply is applied only when its `opening` equals the form's own | A reply from a dismissed form's picker changes the live form's destination | A test replying with a foreign `opening` and asserting the destination is unchanged | pending |
| Cancelling changes nothing | No reply is posted for a cancelled or failed dialog, and the form's destination and armed state are what they were | Cancelling clears the destination, disarms Create, or leaves the form waiting | Tests over cancel and over a throwing dialog, asserting the destination and the Create button before and after | pending |

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| Wire | A second, unchecked destination door | One existing untrusted field, no new one (D1) |
| Async dialog | A stale answer steers a live form | `opening` echoed and matched (D2) |
| Cancel path | The form is left waiting or cleared | No reply at all; the form is never disabled (D3) |
