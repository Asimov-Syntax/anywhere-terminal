## 1. Shared rules and contract

- [x] 1_1 Extract the pane activity rules and their constants into a shared, dependency-free module — verified: pnpm exec vitest run 'src/shared/paneEvidence.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/pane-evidence-transport/spec.md#{pane-activity-states, a-worktree-row-and-a-terminal-tab-never-disagree-about-a-pane} <!-- design.md D5, D9 -->
  - **Acceptance**:
    - Outcome: one rule set maps pane evidence to `exited` / `waiting` / `running` / `idle`
    - Verify: unit src/shared/paneEvidence.test.ts
  - **Plan**:
    1. Add `src/shared/paneEvidence.ts` exporting `OUTPUT_IDLE_WINDOW_MS`, `MAX_REPORTED_TITLE_CHARS`, `LiveActivity`, `PaneActivity`, `LiveActivityEvidence`, `projectLiveActivity`, `projectPaneActivity` — signatures in design.md § Interfaces / D5.
    2. No title-derived rule, and no import of any webview or host module — both sides consume it (D9).

- [x] 1_2 Move the webview tracker onto the shared rules and have it announce waiting flips — verified: pnpm exec vitest run 'src/webview/terminal/TerminalActivityTracker.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/pane-evidence-transport/spec.md#a-worktree-row-and-a-terminal-tab-never-disagree-about-a-pane <!-- design.md D5, D7 -->
  - **Acceptance**:
    - Outcome: the tab's activity indicator behaves identically, and waiting flips fire a callback
    - Verify: unit src/webview/terminal/TerminalActivityTracker.test.ts
  - **Plan**:
    1. In `src/webview/terminal/TerminalActivityTracker.ts`, replace the inline status ternary in `project()` with `projectLiveActivity`, and default `idleDelayMs` to `OUTPUT_IDLE_WINDOW_MS` instead of the literal `1500`.
    2. Add an optional `onWaitingChange(sessionId, waiting)` dep, fired from `setWaiting` only when the stored `waiting` evidence flips — never for the initial `false` — and from `delete`/`dispose` when it was true.
    3. Keep every existing expectation in the suite unedited as the regression gate; add cases for the new callback, including that a never-waiting pane fires nothing.

- [x] 1_3 Add the `paneEvidence` message to the webview to extension protocol — verified: pnpm run check-types && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/pane-evidence-transport/spec.md#report-pane-title-and-waiting-evidence-to-the-host <!-- design.md D3, § Interfaces -->
  - **Acceptance**:
    - Outcome: `paneEvidence` is a member of the webview to extension union, carrying partial evidence
    - Verify: command pnpm run check-types
  - **Plan**:
    1. Add `PaneEvidenceMessage` to `src/types/messages.ts` with `title` / `decorated` / `waiting` optional, a doc comment stating that an absent field means unchanged rather than false, and the type added to the `WebViewToExtensionMessage` union.

- [x] 1_4 Notify on output flush so the host observes output when the surface does — verified: pnpm exec vitest run 'src/session/OutputBuffer.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/pane-evidence-transport/spec.md#hold-output-exit-and-semantic-evidence-independently-of-any-report <!-- design.md D6 -->
  - **Acceptance**:
    - Outcome: each flush that posts output invokes an optional callback with the pane id
    - Verify: unit src/session/OutputBuffer.test.ts
  - **Plan**:
    1. Add an optional fourth constructor argument `onFlush(tabId, at)` to `src/session/OutputBuffer.ts`, invoked in `_flush()` where the `output` message is posted, and never for an empty flush.

## 2. Host store

- [x] 2_1 Build the window-scoped pane evidence store — verified: pnpm exec vitest run 'src/session/PaneEvidenceStore.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1, 1_3
  - **Refs**: specs/pane-evidence-transport/spec.md#{evidence-is-keyed-by-pane-never-by-surface, evidence-lasts-as-long-as-the-pane-not-as-long-as-its-process, unreported-evidence-is-distinguishable-from-reported-absence, reject-evidence-a-report-cannot-justify, hold-output-exit-and-semantic-evidence-independently-of-any-report, pane-activity-states} <!-- design.md D1, D2, D3, D10 -->
  - **Acceptance**:
    - Outcome: the host holds per-pane title, waiting, output, exit, and semantic evidence keyed by pane
    - Verify: unit src/session/PaneEvidenceStore.test.ts
  - **Plan**:
    1. Add `src/session/PaneEvidenceStore.ts` exporting `PaneEvidence`, `PaneEvidenceStore`, and `createPaneEvidenceStore({ now?, onChange? })` — surface in design.md § Interfaces.
    2. `create` is the only entry-creating call; `report` assigns only the fields the message carries and no-ops for an unknown pane, so nothing else can bring an entry into existence (D2).
    3. Validate before assigning: non-empty `paneId`, `title` and `decorated` present together, correct primitive types, at least one of `title` / `waiting`; truncate `title` to `MAX_REPORTED_TITLE_CHARS`.
    4. Leave `title` / `decorated` / `waiting` / `semantic` optional so never-reported stays distinct from reported-absent (D3).
    5. `activityFor` computes `outputActive` from `OUTPUT_IDLE_WINDOW_MS` and delegates to `projectPaneActivity`; unknown pane returns `undefined`. Fire `onChange` on every mutation, never on the clock (D10).

## 3. Wiring

- [x] 3_1 Report title and waiting evidence from every webview surface, on change — verified: pnpm exec vitest run 'src/webview/integration/paneEvidenceReporting.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2, 1_3
  - **Refs**: specs/pane-evidence-transport/spec.md#{report-pane-title-and-waiting-evidence-to-the-host, title-evidence-and-waiting-evidence-travel-independently, report-on-change-never-on-a-timer} <!-- design.md D4, D7, D8 -->
  - **Acceptance**:
    - Outcome: every real change to a pane's reported evidence sends exactly one `paneEvidence`
    - Verify: integration src/webview/integration/paneEvidenceReporting.test.ts
  - **Plan**:
    1. Export `hasDecorativeFrame` from `src/webview/terminal/titleSignature.ts`, derived from the regex already there.
    2. Add `src/webview/terminal/paneEvidenceReporter.ts`: holds the last sent evidence per pane, posts only the fields that changed, truncates the signature, and drops a pane on `forget`.
    3. Add an optional `onTitleEvidence(id, rawTitle)` dep to `src/webview/terminal/TerminalFactory.ts`, called from the existing `terminal.onTitleChange` handler at line 451 — the one site covering root tabs, split children, restored sessions, and editor panels.
    4. In `src/webview/main.ts`, construct the reporter, wire it to the factory dep and to the tracker's `onWaitingChange`, and call `forget` at all five sites where `activityTracker.delete` already runs (lines 446, 455, 523, 593, 602).
    5. The integration test drives a factory-created terminal and a tracker, and asserts on the posted messages — a reporter unit test alone would not prove the wiring.

- [x] 3_2 Route inbound reports to the store from every surface, including revived editors — verified: pnpm exec vitest run 'src/providers/paneEvidenceRouting.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_3, 2_1
  - **Refs**: specs/pane-evidence-transport/spec.md#{evidence-is-keyed-by-pane-never-by-surface, reject-evidence-a-report-cannot-justify} <!-- design.md D1, D8 -->
  - **Acceptance**:
    - Outcome: a `paneEvidence` from any of the three surfaces reaches the store unchanged
    - Verify: unit src/providers/paneEvidenceRouting.test.ts
  - **Plan**:
    1. Add an optional `paneEvidence` store parameter to `src/providers/TerminalViewProvider.ts` and `src/providers/TerminalEditorProvider.ts`, and a `paneEvidence` case in each message switch that forwards to it — ungated by worktree view visibility or window display (D8).
    2. Thread the same optional parameter through `src/providers/TerminalPanelSerializer.ts` into its `TerminalEditorProvider.revive()` call, or a revived editor's reports reach nothing.
    3. Cover sidebar, panel, direct editor, and revived editor in the test, plus a malformed payload being dropped.

- [x] 3_3 Feed the store from the host's own signals — verified: pnpm exec vitest run 'src/session/SessionManager.paneEvidence.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_4, 2_1, 3_2
  - **Refs**: specs/pane-evidence-transport/spec.md#{hold-output-exit-and-semantic-evidence-independently-of-any-report, evidence-lasts-as-long-as-the-pane-not-as-long-as-its-process} <!-- design.md D2, D6 -->
  - **Acceptance**:
    - Outcome: pane evidence tracks creation, output, exit, respawn, closure, and window disposal
    - Verify: unit src/session/SessionManager.paneEvidence.test.ts
  - **Plan**:
    1. Add an optional `paneEvidence` sink to `src/session/SessionManager.ts` options and wire the five lifecycle calls in design.md D2's table: `create` in `createSession` seeded from `restoringExited`, `markExited(id, false)` in `respawnFallbackShell` at the pty swap, `markExited(id, true)` in `pty.onExit`'s natural path, `delete` at the top of `destroySession`, and `clear` in `dispose`.
    2. Do not delete from `cleanupSession` — it runs on natural exit while the tab is still open (D2).
    3. Pass the store's `markOutput` as the `src/session/OutputBuffer.ts` `onFlush` callback at both construction sites in `src/session/SessionManager.ts`.
    4. Clear semantic status from `releaseCursorHookAuthority` beside the existing `agentActivityStatus` post.
    5. In `src/extension.ts`, construct the store, pass it to `SessionManager`, to both providers and the serializer, and call `setSemantic` in the Cursor hook `onStatus` callback.

## 4. Review round 1 fixes

- [x] 4_1 Discard a closed view's pane evidence, including panes whose process already exited — verified: bun test 'src/session/PaneEvidenceStore.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_3
  - **Refs**: specs/pane-evidence-transport/spec.md#evidence-lasts-as-long-as-the-pane-not-as-long-as-its-process <!-- design.md D2; .reviews/round-1.md B1 -->
  - **Acceptance**:
    - Outcome: closing a whole view discards the evidence of every pane it held
    - Verify: unit src/session/PaneEvidenceStore.test.ts
  - **Plan**:
    1. In `src/session/PaneEvidenceStore.ts`, take an optional `viewId` on `create` and add `deleteForView(viewId)`. The store keeps its own pane-to-view index because it is the only structure whose lifetime is the pane's — `viewSessions` drops a pane the moment its process exits, while the tab is still open.
    2. In `src/session/SessionManager.ts`, pass the session's `viewId` at `create`, and call `deleteForView` at the top of `destroyAllForView`, synchronously beside the existing intent record — the queued drain runs too late and cannot see naturally-exited panes.
    3. Correct design.md D2's table and Risk Map row, which name `destroySession` as the single close path.
    4. Cover a live pane and an exited pane in `src/session/SessionManager.paneEvidence.test.ts` through the scheduled-disposal path.

- [x] 4_2 Bound title work to the reported cap and stop counting an undeliverable post as output — verified: bun test 'src/webview/terminal/paneEvidenceReporter.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_3
  - **Refs**: specs/pane-evidence-transport/spec.md#report-pane-title-and-waiting-evidence-to-the-host <!-- design.md D6, D7; .reviews/round-1.md W1, W2 -->
  - **Acceptance**:
    - Outcome: an oversized title is scanned only to the cap, and a post that throws records no output
    - Verify: unit src/webview/terminal/paneEvidenceReporter.test.ts
  - **Plan**:
    1. In `src/webview/terminal/paneEvidenceReporter.ts`, bound the raw title to `MAX_REPORTED_TITLE_CHARS` before normalizing or scanning for decoration, so the advertised cap bounds the work and not only the payload.
    2. In `src/session/OutputBuffer.ts`, skip the flush observer when `postMessage` throws synchronously. An async rejection or a resolved `false` still notifies: the pane produced output either way, and gating that on webview liveness is the surface coupling D1 and D8 rule out.
    3. Add `src/webview/terminal/paneEvidenceReporter.test.ts` for the bounded scan, and a sync-throw case to `src/session/OutputBuffer.test.ts`.

## 5. Review round 2 fixes

- [x] 5_1 Report the contracted title evidence without the unbounded scan that made it expensive — verified: bun test 'src/webview/terminal/paneEvidenceReporter.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_2
  - **Refs**: specs/pane-evidence-transport/spec.md#report-pane-title-and-waiting-evidence-to-the-host <!-- design.md D7; .reviews/round-2.md B3 -->
  - **Acceptance**:
    - Outcome: an oversized title reports the capped prefix of its full signature and whether the full title was decorated
    - Verify: unit src/webview/terminal/paneEvidenceReporter.test.ts
  - **Plan**:
    1. Add a bounded normalizer to `src/webview/terminal/titleSignature.ts` that emits the first `MAX_REPORTED_TITLE_CHARS` characters of the full signature in one pass, so the value keeps its contracted meaning while allocation stays capped.
    2. In `src/webview/terminal/paneEvidenceReporter.ts`, use it and take `decorated` from the full raw title again — that scan allocates nothing and stops at the first decorative glyph.
    3. Replace the round-1 prefix-slicing tests with ones asserting the contracted meaning holds at the cap.

- [x] 5_2 Count output when the surface takes delivery of it, and delete a view's panes without scanning the rest — verified: bun test 'src/session/OutputBuffer.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_2
  - **Refs**: specs/pane-evidence-transport/spec.md#hold-output-exit-and-semantic-evidence-independently-of-any-report <!-- design.md D2, D6; .reviews/round-2.md W1, W3 -->
  - **Acceptance**:
    - Outcome: only a post the webview accepted records output, stamped at flush time
    - Verify: unit src/session/OutputBuffer.test.ts
  - **Plan**:
    1. In `src/session/OutputBuffer.ts`, capture the flush timestamp, then invoke the observer from the `postMessage` resolution only when it resolves `true`. A rejection, a resolved `false`, or a synchronous throw record nothing.
    2. No generation token: `markOutput` mutates existing entries only, so a late resolution for a deleted pane is already a no-op (design.md D2).
    3. In `src/session/PaneEvidenceStore.ts`, add a reverse `viewId` to pane-id index so `deleteForView` touches only that view's panes.
    4. Update `design.md` D6 to state the delivery condition, and the existing flush-notification tests for the now-asynchronous callback.

## 6. Cleared titles

- [x] 6_1 Let a cleared title move the tab and the host evidence together — verified: bun test 'src/webview/terminal/titleSignature.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 5_1
  - **Refs**: specs/process-title-tracking/spec.md#osc-title-change-handling, specs/pane-evidence-transport/spec.md#report-pane-title-and-waiting-evidence-to-the-host <!-- .reviews/round-2.md B2 -->
  - **Acceptance**:
    - Outcome: clearing a title returns the tab to its default name and reports the empty title
    - Verify: unit src/webview/terminal/titleSignature.test.ts
  - **Plan**:
    1. Add `defaultName` to `TerminalInstance` in `src/webview/state/WebviewStateStore.ts`, set from the host-assigned name in `src/webview/terminal/TerminalFactory.ts`. `applyTitleChange` is the only writer of `name`, so the original survives a clear only if it is kept.
    2. Drop the empty-title guard in `src/webview/terminal/titleSignature.ts` so the raw title is always assigned, as the spec already required.
    3. In `src/webview/TabBarUtils.ts`, fall back to `defaultName` in `buildTabBarData` when the resolved label is empty — one place, covering root tabs and split tabs, rather than at each render site.
    4. Drop the matching guard in `src/webview/terminal/paneEvidenceReporter.ts` so the host learns of the clear.
    5. Retarget the inherited `ignores an empty title` case, which pins behavior this spec delta changes.

## 7. Review round 3 fixes

- [x] 7_1 Keep the title read as cheap as it measures, and never let a late confirmation age a pane's output — verified: bun test 'src/session/PaneEvidenceStore.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_1
  - **Refs**: specs/pane-evidence-transport/spec.md#{report-pane-title-and-waiting-evidence-to-the-host, hold-output-exit-and-semantic-evidence-independently-of-any-report} <!-- design.md D6, D7; .reviews/round-3.md W2, W4 -->
  - **Acceptance**:
    - Outcome: an older flush cannot lower a pane's output time, and the title read stays on its measured-cheapest path
    - Verify: unit src/session/PaneEvidenceStore.test.ts
  - **Plan**:
    1. Benchmark the proposed fusion in `src/webview/terminal/titleSignature.ts` before adopting it — the two reads are a native regex and an interpreted loop, so they do not cost alike. Measured: fusing is 200x worse on a large undecorated title and loses the loop's early exit, so the split form stays and the numbers are recorded at the function.
    2. Leave `src/webview/terminal/paneEvidenceReporter.ts` reading the two facts separately, with the reason written down where the next reader will look.
    3. In `src/session/PaneEvidenceStore.ts`, make `markOutput` refuse a timestamp no newer than the one held — flush confirmations resolve independently and are not ordered.
    4. Cover reverse-order confirmation in both `src/session/PaneEvidenceStore.test.ts` and `src/session/OutputBuffer.test.ts`, and keep the equivalence tests in `src/webview/terminal/paneEvidenceReporter.test.ts` pointed at the fused function.
