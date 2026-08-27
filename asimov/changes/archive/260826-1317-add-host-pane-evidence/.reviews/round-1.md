# Review Round 1

- Date: 2026-08-26
- Scope: working tree
- Reviewable lines: 645
- Agents spawned: 6 (`asm-review-logic`, `asm-review-data-security`, `asm-review-contracts`, `asm-review-frontend`, `asm-review-performance`, `asm-review-reuse`)
- Agents skipped: 0
- Verdict: BLOCK
- Triage (author, round 1): B1 accepted, B2 rebutted, W1 accepted in part, W2 accepted
- Counts: 2 BLOCK, 2 WARN, 0 SUGGEST
- Verification: focused Vitest suite passed (7 files, 124 tests); `pnpm run check-types` passed

## Findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-performance
- file: src/session/SessionManager.ts:1146
- title: Bulk view destruction bypasses pane-evidence deletion
- evidence: The new deletion exists only in `destroySession()`. Editor-panel disposal schedules `destroyAllForView()`, which transitions live sessions and calls `performDestroy()` directly without deleting their evidence. Naturally exited panes are already absent from both `sessions` and `viewSessions`, so this bulk close path cannot even enumerate their ids. Closing a panel therefore leaves evidence for both live and exited panes after the pane lifetime has ended.
- impact: The store grows across editor-panel lifecycles and WT-004.1 can project ghost running, waiting, or exited rows until the entire VS Code window is disposed. This violates D2 and the structural bound of one entry per open pane.
- suggestedFix: Track pane-to-view lifetime independently of `SessionManager.sessions`, and make full-view closure synchronously delete every pane id for that view, including naturally exited panes. Route both single-pane and full-view closure through that shared lifetime deletion and add live/exited scheduled-disposal tests.
- status: accepted
- triage: ACCEPT. Verified: `scheduleDestroyForView` -> `destroyAllForView` -> `performDestroy` -> `cleanupSession`, never `destroySession`, so `TerminalEditorProvider.onDidDispose` closes a panel without deleting evidence. design.md D2's Risk Map claim that `destroySession` is the single close path is simply wrong about this one. The spec's `Evidence lasts as long as the pane, not as long as its process` scenario `The pane is closed -> no evidence is held for it` is violated for every pane in a closed editor panel, and the naturally-exited half is worse: it has already left `viewSessions`, so no session-map walk can reach it. Fix keeps D2's principle intact by moving the pane->view mapping into the store itself, which is the only structure whose lifetime is the pane's: `create(paneId, {viewId})` plus `deleteForView(viewId)` called synchronously at the top of `destroyAllForView`, beside the existing synchronous `transitionState` intent record.

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-contracts, asm-review-frontend
- file: src/webview/terminal/paneEvidenceReporter.ts:45
- title: Empty title transitions are never reported
- evidence: `reportTitle()` returns when `rawTitle === ""`, even though the accepted spec requires reported empty title to remain distinct from never-reported title and the store correctly accepts `{ title: "", decorated: false }`. If a pane clears a previously non-empty OSC title, the only producer sends nothing and the prior title/decorated evidence remains held.
- impact: The seam cannot faithfully represent a valid title transition; WT-004.1 can attribute a pane using stale title evidence indefinitely.
- suggestedFix: Remove the falsy-title early return, allow the existing normalization/dedup path to report `{ title: "", decorated: false }`, and add a non-empty-to-empty integration test.
- status: rejected
- triage: REBUT. The producer contract is `title -> the title's decorative signature, normalized as process-title-tracking defines it` (spec.md `Report pane title and waiting evidence to the host`). That module's normalization treats an empty OSC title as a non-event: `applyTitleChange` (titleSignature.ts:75) returns on `!newTitle`, leaving `instance.name` and the rendered tab label at the previous title. Removing only the reporter's matching guard would make the host hold an empty title for a pane whose tab still displays the old one -- this change would introduce the host/tab divergence, not remove it. Whether an empty OSC title should CLEAR a tab's name is a real question, but it is `process-title-tracking`'s to answer: it changes accepted webview behavior and both sides must move together. WT-004.0 is the transport seam and deliberately carries no title-derived rules (design.md D9). Recorded as follow-up in workflow.md Notes; no evidence is lost meanwhile, since the last non-empty title remains the last title the pane actually displayed.

### W1

- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-logic
- file: src/session/OutputBuffer.ts:340
- title: Failed posts are recorded as delivered output
- evidence: `_onFlush` runs unconditionally after `postMessage()`, including a synchronous throw, promise rejection, or a resolved `false`. VS Code's contract says `false` means the message was dropped because it was not deliverable. The new tests cover successful and paused flushes only.
- impact: During a disposed/reviving webview gap, host evidence can report `running` for output the pane surface was never posted, breaking the D6 alignment between host and tab evidence.
- suggestedFix: Invoke the flush observer only when `postMessage()` resolves `true`, while guarding a delayed success from mutating a deleted or replacement pane lifetime; add throw, rejection, and `false` tests.
- status: accepted-in-part
- triage: ACCEPT IN PART. Accepted: a synchronous `postMessage` throw is definitive non-delivery, so the observer is now skipped there -- one branch, no async cost. Rebutted: gating on the promise resolving `true`. The stored fact is `this pane produced output at T`, which is the pane's, not the surface's; making it conditional on webview liveness is precisely the surface-coupling design.md D1 and D8 rule out (`keyed by pane, never by surface`, reporting `ungated by ... window display`). The suggested fix also concedes its own hazard -- a late resolution stamping a deleted or replacement pane -- which would trade a bounded <=1500 ms staleness during webview disposal for an unbounded correctness hole on the hot output path. Sync-throw test added; `false`/rejection deliberately still notify.

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-frontend, asm-review-performance
- file: src/webview/terminal/paneEvidenceReporter.ts:48
- title: Reported-title cap does not bound title-processing work
- evidence: The reporter runs `titleSignature(rawTitle)` and `hasDecorativeFrame(rawTitle)` across the full OSC payload before slicing the normalized title to 1024 characters. xterm permits titles up to 10 MB, so each title event performs multiple O(rawTitle length) scans and creates large intermediate strings before the cap applies.
- impact: A pane emitting large or repeatedly changing OSC titles can stall the webview UI and create large transient allocations despite the advertised bound.
- suggestedFix: Use a bounded normalization/decorative scan that stops after the evidence limit, or otherwise bound raw input before multi-pass processing, and cover oversized repeated titles.
- status: accepted
- triage: ACCEPT. Verified: `titleSignature(rawTitle)` runs two full-string regex passes and `hasDecorativeFrame(rawTitle)` scans to the first match or the end, all before the 1024-char slice, so the advertised cap bounds only the payload, never the work. This is the same hazard `titleSignature.ts` already documents for the render gate (`MAX_GATED_TITLE_CHARS`, and process-title-tracking's `Oversized title` requirement) and the reporter simply failed to inherit it. Fix bounds the raw input first, then normalizes -- evidence is capped at 1024 chars by contract either way, so slicing before rather than after loses nothing that the cap was not already discarding.
