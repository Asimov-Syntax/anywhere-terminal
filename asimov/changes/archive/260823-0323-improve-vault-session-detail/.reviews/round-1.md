# Review round 1

- Date: 2026-08-23
- Scope: working tree (`git diff HEAD`)
- Reviewable lines: 498
- Agents spawned: 6 (`asm-review-logic`, `asm-review-data-security`, `asm-review-frontend`, `asm-review-performance`, `asm-review-contracts`, `asm-review-reuse`)
- Agents skipped: 0
- Verdict: BLOCK
- Counts: BLOCK 2 | WARN 3 | SUGGEST 1
- Verification: focused changed tests passed (234/234); `pnpm run check-types` passed; two chair lifecycle probes reproduced B1 and W1.

## B1

- ID: B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair, asm-review-logic, asm-review-data-security
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/PreviewController.ts:430`
- Title: Closing during rename can reopen a header bound to the previous session
- Evidence: `buildPreviewHeader()` returns `headerEl` whenever `titleEditing` remains true. `closePreview()` calls `shell.hide()`, which removes the focused editor, but clears neither `titleEditing` nor `headerEl`; DOM removal is not a reliable blur/`onDone` path. The next `open()` therefore remounts the detached old header. Its rename, Resume, and copy callbacks all close over the prior `entry`. A chair jsdom probe reproduced the stale editor/header on the next session open.
- Impact: After closing a preview with an edit open, a later preview can show the previous session's editor and metadata; committing can rename the wrong session, Resume can launch the wrong session, and copy actions can place the prior session's values on the clipboard.
- SuggestedFix: Make the inline editor expose an explicit cancel/finish handle; invoke it before hiding or switching. Defensively clear `titleEditing` and `headerEl` on close, open/switch, and disposal, and set `titleEditing` only after the editor actually starts. Add outside-close and next-entry regression tests.
- Status: accepted
- Triage: Confirmed by reading `closePreview()` (PreviewController.ts:214), which resets eleven fields and neither of these two. The severity is right and possibly understated: the stale header's closures carry the prior `entry` into Resume, which LAUNCHES a session — a wrong-session resume is worse than a wrong-session copy. Taking the full suggested fix, including the explicit cancel handle: relying on `blur` to fire on DOM removal is exactly the assumption that produced the bug, so the fix must not depend on it either.

## B2

- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair, asm-review-logic, asm-review-contracts
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/PreviewController.ts:516`
- Title: Clipboard writes are not serialized in activation order
- Evidence: Every click independently invokes `navigator.clipboard.writeText(value)` and awaits only that call. There is no controller-level queue or ordering guard. The Clipboard API runs each call's permission work in parallel and does not specify cross-call serialization, so a later activation may complete first and an older write may update the clipboard afterward. The current test records invocation order with immediately-resolved promises; it does not control completion order or assert final clipboard state under overlap.
- Impact: Rapid folder/session/path activations can leave an earlier value on the clipboard, violating the explicit requirement that the most recently activated affordance wins and recreating the ordering defect D4 was intended to remove.
- SuggestedFix: Coordinate all preview copy writes through one rejection-safe promise chain in activation order, then add a controlled deferred-promise test that resolves underlying operations in reverse order and asserts the final clipboard value.
- Status: accepted
- Triage: Accepted, and the test criticism is the sharper half — my ordering test used immediately-resolved stubs, so it asserted invocation order and then claimed completion order. That is a test that cannot fail for the reason it exists. The ordering requirement is one I wrote into the spec myself ("concurrent copies SHALL resolve in the order they were activated"), so the implementation owes it a guarantee rather than an assumption about how a UA happens to schedule concurrent `writeText` calls.

## W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair, asm-review-frontend, asm-review-contracts
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/PreviewController.ts:462`
- Title: A committed preview rename leaves the mounted title stale
- Evidence: `beginInlineRename.finish()` restores the original `titleEl` without changing its text, then fires the commit callback. `renameTitle()` only posts `vaultRenameSession` and clears `titleEditing`. The resulting list response calls `refreshActiveEntry()`, which updates an internal reference but does not rebuild or update the mounted header. A chair probe confirmed that pressing Enter leaves the old title visible.
- Impact: The rename persists, but the open preview continues showing the old name until close/reopen or an unrelated header repaint, making the new action appear not to have worked.
- SuggestedFix: Update the mounted title optimistically using the same normalization/reset semantics, or repaint just the header when the authoritative renamed entry returns. Add an assertion for the visible title after Enter and blur commits.
- Status: accepted
- Triage: Confirmed — `refreshActiveEntry` (PreviewController.ts:156) is a bare assignment with no repaint. Taking the second option, not the first: repaint the header when the authoritative entry returns. Optimistic update would mean reimplementing the host's normalization (empty value resets to the derived title) in the webview, and a second copy of that rule is exactly the drift the shared-editor decision (D7) exists to avoid. Escalates to must-fix in practice — a rename that looks like it failed invites the user to do it again.

## W2

- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-logic
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/renderAtoms.ts:76`
- Title: Copy confirmation state is not scoped to the latest activation
- Evidence: Each activation independently awaits, adds `is-copied`, and schedules an untracked timeout. A failed re-activation of the same affordance does not clear a still-visible tick from its preceding success. Multiple successes can also leave an older timeout that removes the latest confirmation before its own 1.2-second interval has elapsed.
- Impact: The same button can visibly confirm a failed copy, or clear confirmation prematurely, contradicting the requirement that confirmation describe the activation that just completed.
- SuggestedFix: On each activation, increment a per-button generation, clear the prior timeout and success class, and allow only the current generation to add or remove confirmation. Add success-then-failure and overlapping-success tests.
- Status: accepted
- Triage: Confirmed by inspection — the timeout handle is discarded, so nothing scopes a removal to the activation that scheduled it. The success-then-failure case is the one that matters: a stale tick surviving a failed retry re-states the exact defect W2's sibling B2 and the "confirm only what landed" rule were meant to close. A single stored handle plus clearing the class at activation start is enough; no generation counter needed once the timeout is cancelled on re-activation.

## W3

- ID: W3
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-logic, chair
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/PreviewController.ts:487`
- Title: The context-menu guard lets handled Alt+Arrow keys reach the terminal
- Evidence: For a matching Alt+Arrow event, `handleKeyDown()` returns immediately when the row context menu is open, before `preventDefault()` and `stopPropagation()`. `VaultContextMenu` does not move focus or consume Alt+Arrow. If xterm retains focus, the event continues to its handler and can be emitted to the running process.
- Impact: Opening the context menu suppresses preview navigation as intended, but the same key can still alter the terminal or active CLI despite the preview being open.
- SuggestedFix: Keep navigation disabled while the menu is open, but consume matching Alt+Arrow events there. Continue returning untouched only for actual text-entry focus. Add a context-menu-open key-routing test.
- Status: accepted
- Triage: Confirmed — `VaultContextMenu` attaches only a document keydown for dismissal and never touches arrows, so the event does continue to the pty router. Worth noting this is a spec violation, not only a UX wrinkle: vault-session-preview#keyboard-navigation-between-user-messages conditions solely on "no text input has focus", so with the menu open the spec already says the key SHALL NOT reach the terminal. The text-entry branch must keep returning untouched — swallowing Alt+Arrow inside an inline rename would break caret movement.

## S1

- ID: S1
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-frontend
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/previewHeader.ts:67`
- Title: Preview-title rename has no keyboard trigger
- Evidence: The rename affordance is attached only through `dblclick` on a plain non-focusable `h3`; it has no `tabindex`, key handler, button, or preview menu action.
- Impact: Keyboard-only users can invoke rename from the list context menu but cannot invoke the new rename surface from the preview header.
- SuggestedFix: Add a keyboard trigger that opens the same shared editor, such as F2/Enter on a focusable title or a small accessible rename action, without introducing a second commit path.
- Status: accepted
- Triage: Accepted as real — the gap is genuine and is a direct cost of the Gate 1 choice of double-click (workflow.md). Not auto-fixed: every remedy adds the `h3` to the header's tab order ahead of Resume/Expand/Close, which is a visible interaction change the user should choose rather than inherit from a review round. Deferred to the user with a recommendation of `tabindex="0"` + F2, reusing `renameTitle` so no second commit path appears. Not blocking: keyboard users can still rename from the list's context menu, so the capability exists — only this surface lacks it.
