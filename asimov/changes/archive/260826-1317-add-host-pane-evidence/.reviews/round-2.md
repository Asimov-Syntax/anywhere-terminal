# Review Round 2

- Date: 2026-08-26
- Scope: working-tree changes since round 1 plus rebutted files
- Reviewable lines: 451
- Agents spawned: 4 (`asm-review-contracts`, `asm-review-logic`, `asm-review-frontend`, `asm-review-performance`)
- Agents skipped: 2 (`asm-review-data-security`, `asm-review-reuse` — no new relevant surface)
- Verdict: BLOCK
- Author triage (round 2): all four accepted. B2 was escalated to the user first (its fix changes `process-title-tracking` behavior and would blank the tab label); the user directed the fix, delivered in task 6_1 with a `Terminal N` fallback and a spec delta
- Counts: 2 BLOCK, 2 WARN, 0 SUGGEST
- Verification: focused Vitest suite passed (6 files, 129 tests); `pnpm run check-types` passed; `git diff --check` passed

## Cross-round adjudication

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-contracts, asm-review-performance
- file: src/session/SessionManager.ts:1206
- title: Bulk view destruction bypasses pane-evidence deletion
- evidence: Round 2 adds a store-owned pane-to-view index, records `viewId` at pane creation, removes the mapping on individual deletion/clear, and calls `deleteForView(viewId)` synchronously at the top of `destroyAllForView`. Tests cover both live and naturally exited panes.
- impact: The round-1 leak and ghost-row path are closed.
- suggestedFix: None; verified fixed.
- status: fixed
- triage: ACCEPTED FIX VERIFIED. The new index uses pane lifetime rather than `sessions`/`viewSessions`, so naturally exited panes remain reachable until pane/view closure.

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-contracts
- file: src/webview/terminal/paneEvidenceReporter.ts:45
- title: Empty title changes remain unreportable
- evidence: `reportTitle()` still discards an empty raw title. The rebuttal treats the existing `applyTitleChange()` guard as authority, but `asimov/specs/process-title-tracking/spec.md` requires every xterm title event to update `TerminalInstance.name` and states that the raw title is always assigned. The approved pane-evidence spec also explicitly distinguishes unknown title from reported empty title. The unchanged tab guard is an existing contract defect, not an exemption for the new producer.
- impact: A non-empty-to-empty transition leaves stale title evidence and the seam cannot represent one of its required states; WT-004.1 can attribute a pane using a title it no longer owns.
- suggestedFix: Remove the reporter guard and align `applyTitleChange()` with the authoritative process-title contract so both tab state and host evidence move to the empty title together. Add a non-empty-to-empty integration test covering both.
- status: open
- triage: SUSTAINED — rebuttal overruled by the authoritative process-title and pane-evidence specifications. D9 excludes title-derived activity rules, not transport of a valid title state.
- authorStatus: accepted
- authorTriage: ACCEPT the diagnosis, ESCALATE the fix. The chair is right that `applyTitleChange`'s guard has no authority behind it -- `process-title-tracking` says the webview updates `TerminalInstance.name` with the new title and carves out no empty case. But the suggested fix (`align applyTitleChange` so tab and host move together) has a consequence neither round has weighed: `TabBarUtils.ts:177` resolves the label as `customName ?? instance.name`, and `??` does not fall back on `""`. Honouring an empty OSC title therefore renders a BLANK tab -- or the bare string ` (exited)` on an exited pane. That is a visible regression, and `process-title-tracking` has no requirement saying what a cleared title should display. There are several valid answers (blank; fall back to the terminal number; keep the last non-empty title and report the clear as evidence only; treat empty as a non-event and write that down), they differ in externally verifiable behavior, and each needs a delta on a capability this change does not own. Per asimov-build's artifact-handback and `multiple valid fixes -> STOP, ask user` rules this is not mine to settle inside WT-004.0. Escalated to the user, who directed the fix rather than a follow-up change. FIXED in task 6_1 with `Terminal N` as the fallback -- what VS Code's own terminal does when a process clears its title, and already this pane's original label. `applyTitleChange` now assigns an empty title like any other, `TerminalInstance` keeps the host-assigned `defaultName` because `name` is the field xterm rewrites, `buildTabBarData` resolves the fallback in one place for root and split tabs alike, and the reporter guard is gone so the host learns of the clear. The changed tab-label behavior is carried by a new `process-title-tracking` MODIFIED delta in this change.

### W1

- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-logic, asm-review-contracts
- file: src/session/OutputBuffer.ts:341
- title: Dropped asynchronous posts are still counted as delivered output
- evidence: The synchronous-throw branch is fixed, but `_onFlush` still runs before the returned `Thenable<boolean>` resolves, so rejection and resolved `false` stamp `lastOutputAt`. VS Code defines `false` as dropped/not deliverable, while D6 and the approved spec require output to be counted when delivered to the rendering surface so host and tab use the same evidence. D1/D8 govern pane keying and visibility, not whether a definitively dropped post was delivered.
- impact: During an undeliverable webview interval, the host can report `running` for output the live terminal surface never received.
- suggestedFix: Notify only after resolution `true`, carrying the original flush timestamp and a pane-lifetime generation/token so late success cannot update a deleted or replacement pane. Add rejection, resolved-false, deletion-before-resolution, and recreation-before-resolution tests.
- status: open
- triage: SUSTAINED — partial fix verified; rebuttal overruled for rejection/resolved-false behavior.
- authorStatus: accepted
- authorTriage: ACCEPT -- reversing the round-1 partial rebuttal, which over-read D8. D8 governs VISIBILITY gating (`ungated by ... window display`), not whether a definitively dropped post counts as delivered, and D6's own stated goal is that host evidence tracks what the surface received. Gating on resolution `true` serves that goal rather than fighting it. On the generation token: not added, because the hazard it guards is already closed by construction -- `report`/`markOutput` mutate existing entries only and never create, so a late resolution for a deleted pane is a no-op, and `create` replaces the entry wholesale, so a same-id recreation cannot inherit a stale stamp beyond the microtask in which it resolves. Adding a second bookkeeping mechanism for a hazard the store's no-create-on-write rule (D2) already eliminates would be the duplication that rule exists to avoid. The flush timestamp IS captured at flush time and carried through resolution, as suggested. Deletion-before-resolution covered by test; rejection and resolved-`false` covered.

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-frontend, asm-review-performance
- file: src/webview/terminal/paneEvidenceReporter.ts:55
- title: Reported-title cap does not bound title-processing work
- evidence: Round 2 slices raw title input to 1024 characters before regex normalization and decoration detection, structurally bounding the work.
- impact: The original multi-megabyte scan and transient-allocation path is closed.
- suggestedFix: None for the original performance finding; the resulting contract mismatch is tracked separately as B3.
- status: fixed
- triage: ACCEPTED FIX VERIFIED for bounded work.

## New findings

### B3

- ID: B3
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-contracts
- file: src/webview/terminal/paneEvidenceReporter.ts:55
- title: Raw-prefix slicing changes the contracted title evidence
- evidence: The reporter now slices the raw OSC title before normalization. Its new test deliberately shows a title whose full decorative signature is `X` being reported as an empty title, and reports `decorated: false` when a decorative frame exists beyond the prefix. The production message contract says `title` is the pane title's decorative signature and `decorated` says whether the raw title carried a frame; the accepted spec truncates an oversized reported title, not the raw input before deriving those facts.
- impact: Oversized titles produce evidence with different semantics from the declared protocol, including false empty titles and false decoration absence. Consumers have no truncation marker and will treat these values as complete facts.
- suggestedFix: Either compute the contracted full signature/decoration and then bound the payload with an implementation that controls allocations, or explicitly amend and approve the protocol to define prefix evidence (ideally with a truncation marker) before consumers are built. Code, tests, and contract must describe the same transformation.
- status: open
- triage: pending
- authorStatus: accepted
- authorTriage: ACCEPT -- and the round-1 W2 fix was the cause, so this is my regression, not a pre-existing one. Verified: the spec defines `title` as `the title's decorative signature` and `decorated` as `whether the raw title carried a decorative frame`, both facts about the pane's title, with `MAX_REPORTED_TITLE_CHARS` a transport cap on the value rather than a redefinition of it. Slicing the raw string first silently redefined both: a spinner run longer than the cap reported `decorated: false`, and content past the prefix vanished from the signature. Fix restores the contracted meaning without restoring the cost -- one bounded single pass that emits the first `MAX_REPORTED_TITLE_CHARS` characters of the FULL signature (bounded allocation, no multi-megabyte intermediates), plus full-raw decoration detection, which is scan-only, allocates nothing, and short-circuits at the first decorative glyph -- the common case, since a spinner leads the title. Contract preserved, W2's allocation blow-up still closed.

### W3

- ID: W3
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: asm-review-performance
- file: src/session/PaneEvidenceStore.ts:224
- title: Full-view deletion scans every open pane
- evidence: `deleteForView()` walks the entire pane-to-view map for every closing view. With P open panes distributed across V views, sequential view closures perform O(P×V) aggregate work even when each view owns only one pane; neither axis has a structural cap.
- impact: Repeated editor-panel closures increasingly spend synchronous cleanup work on unrelated panes in other views.
- suggestedFix: Maintain a reverse `viewId -> Set<paneId>` index and delete only the closing view's set, updating both directions on create, individual delete, replacement, and clear.
- status: open
- triage: pending
- authorStatus: accepted
- authorTriage: ACCEPT. Trivial and strictly better, so auto-fixed: a reverse `viewId -> Set<paneId>` index replaces the full-map walk, making a view close O(panes in that view). The `quadratic` framing overstates it -- the map is bounded by the window's open pane count, which is small -- but the index costs five lines, removes the scan of unrelated panes, and keeps the forward map for `delete`'s own bookkeeping, so there is no reason to argue the bound instead.
