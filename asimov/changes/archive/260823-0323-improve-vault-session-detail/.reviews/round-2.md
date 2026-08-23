# Review round 2

- Date: 2026-08-23
- Scope: changes since round 1 (`git diff`, plus accepted round-1 findings)
- Reviewable lines: 83
- Agents spawned: 5 (`asm-review-logic`, `asm-review-data-security`, `asm-review-frontend`, `asm-review-performance`, `asm-review-contracts`)
- Agents skipped: 1 (`asm-review-reuse` — no new reuse or duplication surface)
- Verdict: WARN
- Counts: BLOCK 0 | WARN 1 | SUGGEST 1
- Verification: `src/webview/vault/VaultPanel.test.ts` passed (121/121); `pnpm run check-types` passed; `git diff --check` passed. A chair-controlled overlapping-copy probe reproduced W2.

## Cross-round disposition

### B1

- ID: B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair, asm-review-logic, asm-review-data-security
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/PreviewController.ts:234`
- Title: Closing during rename can reopen a header bound to the previous session
- Evidence: `beginInlineRename` now returns an idempotent `end()` handle. `PreviewController.endTitleEdit()` invokes it and clears `titleEdit`, `titleEditing`, and `headerEl`; both `open()` and `closePreview()` call it before replacing or hiding the card. `dispose()` routes through `closePreview()`. Error/detail repaints retain the current header only while the live editor remains owned; maximize does not rebuild it.
- Impact: The prior wrong-session Resume/rename/copy path is removed.
- SuggestedFix: None.
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### B2

- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair, asm-review-logic, asm-review-contracts
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/PreviewController.ts:562`
- Title: Clipboard writes are not serialized in activation order
- Evidence: Each write is now chained from `clipboardChain`, and the stored chain catches rejection before later activations attach. A controlled test verifies that the second `writeText` call is not issued until the first settles.
- Impact: Clipboard mutation order now follows activation order, and one rejected write does not poison subsequent copies.
- SuggestedFix: None.
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair, asm-review-frontend, asm-review-contracts
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/PreviewController.ts:162`
- Title: A committed preview rename leaves the mounted title stale
- Evidence: `refreshActiveEntry()` now patches the mounted `.vault-preview-title` from the authoritative returned entry when no editor is open, using the same `previewTitleOf()` helper as header construction.
- Impact: A committed rename appears in the open preview without optimistic normalization duplication.
- SuggestedFix: None.
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### W2

- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair, asm-review-logic, asm-review-frontend, asm-review-performance, asm-review-contracts
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/renderAtoms.ts:77`
- Title: Copy confirmation is still not scoped to the latest overlapping activation
- Evidence: A click clears the existing class/timer before awaiting `opts.onCopy()`, but the post-await success path has no activation identity. If activation A is pending when B starts, A can later add `is-copied` and schedule a timer while B is pending. If B rejects, its catch leaves A's tick visible; with multiple successes, older completions can also create concurrent timers and clear a newer confirmation early. The added test waits for the first success before starting the refused retry, so it does not cover this overlap. A chair test with two rapid activations, delayed first success, and second rejection failed with the stale tick still present.
- Impact: The latest refused or pending copy can still appear successful, so the accepted round-1 W2 behavior remains observable. Rapid overlap can also create multiple short-lived timers per button.
- SuggestedFix: Add a monotonically increasing per-button activation generation. Capture it before `await`; only the current generation may add the class or schedule/remove its timer. Keep timer cancellation, and add deferred overlap tests for first-success/second-failure and two overlapping successes.
- Status: accepted; persists from round 1
- Triage: round-1 fix is incomplete — accepted in full, and my round-1 triage was the cause. I wrote "no generation counter needed once the timeout is cancelled on re-activation"; that reasoning covers the TIMER but not the completion path, which resumes after `await` with no activation identity. The test I wrote inherited the same blind spot: it sequenced success-then-failure instead of overlapping them, so it could not fail for the reason it existed — the identical criticism made of the B2 test in round 1, repeated one finding later. Taking the generation counter and both deferred overlap tests as specified.

### W3

- ID: W3
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair, asm-review-logic
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/PreviewController.ts:519`
- Title: The context-menu guard lets handled Alt+Arrow keys reach the terminal
- Evidence: Text-entry focus still returns untouched. For other matching Alt+Arrow events, `preventDefault()` and `stopPropagation()` now run before the context-menu check; the menu suppresses navigation but cannot leak the key to xterm.
- Impact: The terminal no longer receives the shortcut while the context menu is open, without stealing it from rename inputs.
- SuggestedFix: None.
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### S1

- ID: S1
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-frontend
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/previewHeader.ts:67`
- Title: Preview-title rename has no keyboard trigger
- Evidence: Rename remains attached only through `dblclick` on a non-focusable `h3`; no F2/Enter or accessible action opens the shared editor from this surface.
- Impact: Keyboard users must use the existing list context menu rather than the preview header. The capability remains available elsewhere, so this is non-blocking.
- SuggestedFix: Pending an explicit interaction choice, add a keyboard trigger that reuses `renameTitle` without creating a second commit path.
- Status: accepted; open and deferred
- Triage: persists from round 1; no rebuttal, awaiting an explicit interaction decision. The chair's round-2 position — real but neither untenable nor blocking, since rename stays keyboard-reachable via the list context menu — matches the round-1 deferral, so the deferral stands rather than being overruled. Remains the user's call because every remedy changes the header's tab order.
