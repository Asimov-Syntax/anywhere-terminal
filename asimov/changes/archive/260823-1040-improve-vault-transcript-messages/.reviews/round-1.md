# Review round 1 — partial

The chair (`asm-review-master`) was STOPPED mid-run to avoid it reporting on a tree
that was about to change under it (user feedback on Continue). Two specialists had
already returned; their findings are recorded below un-adjudicated. There is no
chair verdict for this round, and the other specialists never reported — so this
round is NOT a complete review. A full round must be re-run before approval.

## asm-review-frontend

### F1 — Action bar unreachable by keyboard (WARN, P1, HIGH)
`.vault-preview-message` carries no `tabindex`, so a plain message has no focusable
descendant, `focusin` never fires, and Tab skips it. Contradicts the accepted spec
("revealed on hover or keyboard focus"). The 4_1 test dispatched a synthetic
bubbling `focusin`, which passes regardless of focusability — false confidence.
Status: accepted. Triage: correct on both counts; the test proved nothing about real
focus. Fixed in 6_3.

### F2 — `pendingRecords` never cleared (WARN, P3, MEDIUM)
`closePreview` resets every other per-preview map but not `pendingRecords`, so a Raw
request that never gets a reply leaks an unresolved promise and leaves the button in
limbo.
Status: accepted. Triage: correct. Fixed in 6_3.

## asm-review-logic

### L1 — Flag-only records still title sessions (BLOCK, P1, HIGH)
`extractUserText` takes only `message`, so `classifyUserText` cannot see
record-level `isCompactSummary`; the timeline drops such a record while the title
path keeps its prose.
Status: accepted. Triage: correct — 1_2 fixed the text level and left the flag level
open, which defeats the "titles use the same classification" requirement. Fixed in 6_4.

### L2 — OpenCode record truncated at 1000 parts, reported complete (BLOCK, P1, HIGH)
The resolver reuses `DETAIL_PART_HEAD` — a preview cap — on a path contracted to
return the whole record, then returns `ok`.
Status: accepted. Triage: correct; a preview bound has no business on a
resolve-the-record path. Fixed in 6_5.

### L3 — Failed part read becomes a successful empty record (BLOCK, P1, HIGH)
`partRes.status !== "ok"` silently substitutes `parts: []`.
Status: accepted. Triage: correct — silent success on a read failure. Fixed in 6_5.

### L4 — Malformed OpenCode part silently skipped (WARN, P2, HIGH)
A partial human message can seed a continuation.
Status: accepted. Triage: correct; folded into the same fix. Fixed in 6_5.

### L5 — Codex accepts any parseable line as a locator (WARN, P2, HIGH)
The predicate checks only `lineNo === target`, so `#2` can resolve a tool call.
Status: accepted. Triage: correct, and notable — tasks.md 3_2 originally specified
"Codex counts to the ordinal and rejects a non-user record"; that clause was dropped
during build as unnecessary. The reviewer rediscovered it independently. Fixed in 6_6.

### L6 — Claude uuid resolution does not verify the record is a message (WARN, P2, HIGH)
Same class as L5, on the Claude side. Status: accepted. Fixed in 6_6.
