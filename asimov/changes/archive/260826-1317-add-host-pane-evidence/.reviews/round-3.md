# Review Round 3

- Date: 2026-08-26
- Scope: working-tree changes since round 2 plus round-2 finding files
- Reviewable lines: 519
- Agents spawned: 4 (`asm-review-contracts`, `asm-review-logic`, `asm-review-frontend`, `asm-review-performance`)
- Agents skipped: 2 (`asm-review-data-security`, `asm-review-reuse` — no new relevant surface)
- Verdict: WARN
- Counts: 0 BLOCK, 2 WARN, 0 SUGGEST
- Verification: focused Vitest suite passed (8 files, 182 tests); `pnpm run check-types` passed; `git diff --check` passed; 100,000 randomized bounded-signature equivalence cases passed

## Cross-round adjudication

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-contracts, asm-review-frontend
- file: src/webview/terminal/paneEvidenceReporter.ts:44
- title: Empty title changes remain unreportable
- evidence: The empty-title guards are removed from both `applyTitleChange` and the reporter. `TerminalInstance.name` now stores the empty raw title, pane evidence reports `{ title: "", decorated: false }`, and `buildTabBarData` resolves the user-approved `defaultName` fallback for root and active split panes while preserving custom-name precedence. A process-title delta specifies the cleared-title behavior.
- impact: The stale-title transport defect is closed without rendering blank tabs.
- suggestedFix: None; verified fixed.
- status: fixed
- triage: ACCEPTED FIX VERIFIED. Tests cover assignment, reporting, custom-name precedence, root fallback, and split-pane fallback.

### B3

- ID: B3
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-contracts, asm-review-frontend
- file: src/webview/terminal/titleSignature.ts:64
- title: Raw-prefix slicing changes the contracted title evidence
- evidence: `boundedTitleSignature` now emits the capped prefix of the full normalized signature rather than normalizing a raw prefix, and decoration is again derived from the complete raw title. Unit tests and a 100,000-case randomized check agree with `titleSignature(raw).slice(0, max)`.
- impact: Oversized evidence again has the protocol's declared meaning with bounded output allocation.
- suggestedFix: None for correctness; remaining CPU scaling is tracked as W2.
- status: fixed
- triage: ACCEPTED FIX VERIFIED.

### W1

- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-logic, asm-review-contracts
- file: src/session/OutputBuffer.ts:361
- title: Dropped asynchronous posts are counted as delivered output
- evidence: The observer now runs only when `postMessage` resolves `true`; synchronous throw, rejection, and resolved `false` record nothing. The timestamp is captured at flush time and carried through resolution. Production restore/revival paths do not recreate a same-id pane against the same store while an old buffer remains pending: phase-A revival reuses the existing session, while phase-B same-id restoration occurs in a fresh activation/store.
- impact: The round-2 delivery-condition defect is closed.
- suggestedFix: None for W1; out-of-order successful resolutions are tracked separately as W4.
- status: fixed
- triage: ACCEPTED FIX VERIFIED. The proposed generation-token issue was not retained because no production same-store same-id recreation path exists.

### W3

- ID: W3
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-logic, asm-review-performance
- file: src/session/PaneEvidenceStore.ts:244
- title: Full-view deletion scans every open pane
- evidence: A reverse `viewId -> Set<paneId>` index now lets `deleteForView` touch only panes owned by the closing view. `unindex` maintains the forward and reverse indexes across create replacement, individual deletion, view deletion, and clear.
- impact: Full-view cleanup is proportional to that view's panes and no longer scans unrelated panes.
- suggestedFix: None; verified fixed.
- status: fixed
- triage: ACCEPTED FIX VERIFIED.

## Current findings

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-performance
- file: src/webview/terminal/titleSignature.ts:64
- title: Full-size OSC titles still require unbounded synchronous scans
- evidence: `boundedTitleSignature` bounds allocation but can scan the full 10 MB xterm title when the input is all decorative glyphs or whitespace because it never emits 1,024 signature characters. `paneEvidenceReporter` then separately scans the full raw title for decoration when no frame exists. Whitespace-only input therefore causes up to two complete synchronous scans per title event, and repeated title events multiply the work.
- impact: A process repeatedly emitting oversized stripped or undecorated OSC titles can keep the webview main thread busy despite the reported-title cap.
- suggestedFix: Fuse signature-prefix extraction and decoration detection into one pass to remove duplicate scans. To cap CPU structurally, define a protocol-level saturated/unknown result after a fixed raw inspection window; exact full-title semantics and a finite scan bound cannot both be guaranteed.
- status: open
- triage: REOPENED — round 3 preserves contracted semantics and bounds allocation, but reintroduces the CPU-scan portion of round-1 W2.
- authorStatus: rejected
- authorTriage: REBUT, on measurement. I implemented the fusion first and benchmarked it against the split form, 20 title events each: 8 MB undecorated text 1.6 ms split vs 326 ms fused; 8 MB all-spinner 390 ms split vs 425 ms fused; ordinary spinner title, both ~0 ms. The fused form is worse in every case, and 200x worse in the realistic one. The premise that two scans cost twice one does not hold here because the scans are not alike: `hasDecorativeFrame` is a native regex running at memory bandwidth, while the signature loop is interpreted. Fusing replaces the cheap scan with the expensive one over the same range AND forfeits the loop's early exit at the cap, which is what makes an ordinary oversized title free. Reverted; the split form and its numbers are now recorded at the function. The chair's own note concedes the rest -- `exact full-title semantics and a finite scan bound cannot both be guaranteed` -- On the protocol half, between those two semantics wins: a saturated/unknown result after a fixed inspection window is exactly what round-2 B3 rejected, and re-adopting it would need a protocol delta to define what the marker means and a WT-004.1 consumer able to act on it. Neither exists. The residual cost is one pass over a payload only a hostile or broken program emits, on the surface that program already owns, with allocation capped -- worth a written bound rather than a contract change.

### W4

- ID: W4
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-logic
- file: src/session/PaneEvidenceStore.ts:210
- title: Out-of-order delivery confirmations can move activity time backward
- evidence: Each flush captures `producedAt` and updates evidence when its independent `postMessage` promise resolves `true`. The API and local `MessageSender` contract provide no promise-resolution ordering guarantee. If a newer flush resolves before an older one, `markOutput` first stores the newer timestamp and then unconditionally replaces it with the older timestamp.
- impact: `activityFor` can mark a pane idle earlier than the terminal's most recently delivered output warrants, reintroducing host/tab disagreement under reordered confirmations.
- suggestedFix: Make `lastOutputAt` monotonic, updating only when `at` is newer than the held timestamp, and add a test resolving two successful flushes in reverse order.
- status: open
- triage: pending
- authorStatus: accepted
- authorTriage: ACCEPT -- and this one is mine: making the flush observer asynchronous (round-2 W1) is what created the reordering window, so the fix and its consequence belong together. Verified the mechanism: each flush captures its own `producedAt` and notifies from its own `postMessage` resolution, and nothing sequences those resolutions, so an older flush confirming after a newer one previously overwrote the newer stamp and could read `idle` while the pane had just delivered output. `markOutput` now refuses a timestamp no newer than the one held, which also makes the store correct under any future out-of-order producer rather than only this one. Covered by a store-level reverse-order case and an OutputBuffer case that resolves two real flushes out of order.
