# Review Round 1 — separate-presence-subscription-from-view-visibility

| Field | Value |
|---|---|
| Date | 2026-08-30 |
| Cycle | 1 |
| Mode | discovery |
| Requested mode | fastlane |
| Scope | range `8d1d7d72..HEAD` |
| Head | `35c78622e48cdd2f5915e447e2c7e4c707d6b209` |
| Tree state | dirty outside the explicit range (`asimov/changes/active` and prior-change analytics/review bookkeeping); not reviewed |
| Reviewable lines | 191 (180 production TypeScript + 11 build-state JSON; tests reviewed inline, change markdown used as context) |
| Agents spawned | asm-finder (`gpt-5.6-luna[1M]`); asm-review-logic (`gpt-5.6-sol[1M]`); asm-review-contracts (`gpt-5.6-terra[1M]`); asm-review-performance (`sonnet[1M]`); asm-review-frontend (`gpt-5.6-terra[1M]`) |
| Agents skipped | data-security (no auth, persistence, secret, path-input, or destructive boundary); reuse (no duplicated capability, parser, mapper, or split) |
| Verdict | BLOCK |
| Counts | BLOCK 1 · WARN 2 · SUGGEST 1 |
| Split | 1 gating blocker — 1 feature / 0 machinery |

## Context and verification evidence

- Gate 2 is approved. D1–D4, task Acceptance fields, the spec delta, and the relevant project scope/presence anchors are accepted obligations.
- The explicit range contains three commits: `8a0285e6`, `e6bf490a`, and `35c78622`.
- Recorded verification was cited, not rerun. `bun run asm change verify-status separate-presence-subscription-from-view-visibility` reports all three tasks at exit 0. The caller reports type check, 5172 unit tests, the I10 gate, and Biome `src` at its recorded 5-error / 14-warning / 3-info baseline, all baseline findings outside touched files.
- The prior rejected seam's two named defects are closed in the live path: a presence-only projection skips title and preview reads, while `pendingCreate` cleanup and refresh admission key on `bodyShown`. The rewritten late-create test uses the real `#wt-branch` marker and the real response shape and is non-vacuous.

## Full-flow trace

A live worktree selection resolves scope, redraws the tab bar, revalidates while the body still draws rows, then auto-collapses. Collapse moves `bodyShown` false, clears pending create, derives `"presence"`, and posts the level. The host keeps delivery and the 5-second scan active, but `anyDrawingRows()` is false when no other displayed surface draws rows; the projector preserves registry rows, waiting state, attribution, degradation, and ranking while skipping title/preview reads. The resulting push updates attribution and the hidden-waiting count. Clearing scope redraws and revalidates to no subscription, stopping delivery and the scan when it is the last subscriber. Multi-surface OR and rollout-off paths remain coherent.

The bootstrap mode is not coherent: a restored scope starts unresolved until a tree confirms it, but the new `presenceNeeded` callback asks only for an already-effective scope. If the worktree body starts hidden, the controller therefore sends no subscription and no tree request; the host consequently has no route to deliver the tree that would resolve the stored scope. This circular dependency is B1.

## Findings

### [B1] Restored hidden scope cannot bootstrap its own presence subscription

- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: chair
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/main.ts:1143`
- **Title**: Restored hidden scope cannot bootstrap its own presence subscription
- **Evidence**: `TabBarScopeCoordinator` reads a persisted `worktreeScope` but leaves `resolved` false until `applyTree()` confirms that id (`src/webview/tabBarScope.ts:85-94,110-112`). The changed production callback defines presence need as `tabBarScope?.effectiveScope() !== undefined`, so that restored-but-unresolved scope answers false. When the persisted body is Sessions or the vault starts manually collapsed, `VaultPanel.syncWorktreeVisibility()` reports false (`VaultPanel.ts:653-658`); `WorktreeController.applySubscription()` then derives `null` and sends neither visibility nor `requestWorktreeTree` (`WorktreeController.ts:518-536`). The host sends tree/presence only to subscribed surfaces, so no tree can arrive to resolve the scope. Invariant inventory: live selection, scope clear, body-open bootstrap, rollout-off, and tree-driven drops after subscription are safe; restored valid scope before the first tree is affected.
- **Impact**: After reload, a valid persisted scope can disappear whenever the Worktree body is not initially shown. Its chip, All escape control, filtering, and hidden-waiting count remain absent/frozen until the user manually opens the Worktree body, contradicting scope persistence and the collapsed-rail contract this change exists to restore.
- **SuggestedFix**: Let subscription need include a valid raw/pending stored scope before tree resolution, or explicitly bootstrap one tree request when such a scope exists. After the first tree, let the existing resolution path keep a valid scope or clear an invalid one and revalidate to unsubscribe. Add an integration-level seam test for persisted scope + hidden body before any tree, covering both valid and stale ids.
- **Status**: accepted
- **Triage**: Confirmed against source. `scopedWorktreeId()` returns null unless `resolved`
  (tabBarScope.ts:111), and `resolved` only becomes true when a tree confirms the id
  (tabBarScope.ts:203). So a persisted scope + a body that starts collapsed or on Sessions is a
  deadlock: `presenceNeeded()` is false, the controller never subscribes, the host pushes trees
  only to subscribed surfaces, and the scope can never resolve itself. A real defect and mine —
  I read `effectiveScope()` as "is there a scope" when it means "is there a CONFIRMED scope".
  Fixable in contract: the unresolved state is already observable, since `this.scope` holds the
  persisted id from the constructor. The coordinator gets a predicate for "a scope is persisted,
  resolved or not", and the stale path already calls `setScope(null)` (tabBarScope.ts:215), so
  the unsubscribe after a stale resolution falls out rather than needing its own branch.

### [W1] Presence-to-rows promotion waits for the poll before enriching reopened rows

- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: asm-review-contracts + asm-review-frontend (confirmed by chair)
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:531`
- **Title**: Presence-to-rows promotion waits for the poll before enriching reopened rows
- **Evidence**: A standing `"presence"` → `"rows"` transition posts the level and returns without requesting work (`WorktreeController.ts:526-536`). The host updates the level but schedules no immediate projection (`WorktreeHost.ts:1623-1630`); `anyDrawingRows()` is read only when a projection starts, and the next ordinary external projection is timer-driven (`WorktreeHost.ts:1211-1219,1389-1402`). Presence-only envelopes omit title/preview enrichment (`presenceProjector.ts:1003-1009`). The approved design says reopening already requests a fresh tree (`design.md:91-94`), and the spec requires reopened rows with titles and previews without another user request (`specs/worktree-panel/spec.md:25-28`).
- **Impact**: Reopening after a presence-only push can display bare or fallback-titled rows with no previews until the next successful scan, up to the 5-second cadence; the hidden body also processes the bare envelope in the meantime.
- **SuggestedFix**: On `"presence"` → `"rows"`, schedule an immediate enriching projection without forcing a git rebuild, or request the current tree through a host path that guarantees that projection. Replace the no-request assertion with an end-to-end promotion test that starts from a bare envelope and proves an enriched response on reopen.
- **Status**: accepted
- **Triage**: Correct, and it contradicts this change's own spec scenario "The rail comes back —
  THEN the rows are drawn with their titles and previews, without the user asking again". My
  early return for a standing subscription was written for the demotion direction and I applied
  it to both. Promotion is not symmetric: demoting only stops future work, while promoting has to
  replace an envelope that was deliberately built bare. Fixed by requesting on promotion only.

### [W2] Presence-only scan arming has no discriminating test

- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P3
- **Agent**: chair (corroborated by asm-review-contracts)
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.test.ts:684`
- **Title**: Presence-only scan arming has no discriminating test
- **Evidence**: Task 1_1 explicitly requires a test that a presence-only surface arms the scan (`tasks.md:11-15`). Both relevant new tests post `requestWorktreeTree` directly (`WorktreeHost.test.ts:691-705`), so they prove explicit request delivery and the projection option, not timer admission. They would remain green if scan reconciliation stopped arming for `level: "presence"`.
- **Impact**: The central deliberate trade — retaining the scan because the hidden-waiting count depends on it — has no regression tripwire, so the feature can silently return to the frozen-count defect while the claimed task verification remains green.
- **SuggestedFix**: Use the host's injected arm/timer seam to assert that a displayed presence-only subscriber schedules the external scan, that the callback runs with `enrich:false`, and that clearing the last scope cancels/stops rearming it.
- **Status**: accepted
- **Triage**: Valid, and the more useful of the two test findings because it names what task 1_1
  actually claimed. My tests drove the projection with a direct `requestWorktreeTree`, which
  proves the enrich plumbing and nothing about the timer — they would stay green if
  `anyShowing()` started excluding `"presence"`, which is precisely the freeze this change exists
  to prevent. The host already takes an injectable `clock` (`RebuildGateClock`), so arming,
  execution with `enrich:false`, and cancellation after the last presence subscription ends are
  all observable without waiting on a real timer.

### [S1] Ranking test passes when ranking is stale

- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P4
- **Agent**: chair
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.test.ts:1945`
- **Title**: Ranking test passes when ranking is stale
- **Evidence**: The test records only `rankRevision()`, adds a newer session, then asserts the rank remains defined and the revision is `>=` its old value (`presenceProjector.test.ts:1945-1957`). If rank updates were moved behind the enrichment branch, the previous rank would still be defined and an unchanged revision would satisfy both assertions.
- **Impact**: The deliberate decision to keep ranking current while enrichment is disabled is not protected; a regression could make every group reorder on reopen while this test stays green.
- **SuggestedFix**: Capture the old rank and assert the new rank and revision both advance after the newer session is projected with `enrich:false`.
- **Status**: accepted
- **Triage**: Valid. `toBeGreaterThanOrEqual` and `toBeDefined` both hold when nothing advanced,
  so the assertion passes on the stale-ranking behaviour it was written to forbid. This is the
  same weakness as W2 and as the vacuous create test I caught myself earlier in this change: an
  assertion that describes the intended state rather than the difference the mechanism makes.
  Fixed by asserting the rank VALUE advances to the newer session's timestamp under
  `enrich:false`, and discrimination-checked by moving ranking inside the branch.

## Adjudication notes

- The performance specialist found no remaining data-scale defect: with growth axis E = live external sessions, `enrich:false` removes the per-row vault title/preview I/O while the accepted O(E) registry and ranking pass remains.
- The logic specialist found the prior B2 body-lifecycle defect closed and confirmed the late-create test is non-vacuous.
- The logic specialist treated delayed reopen enrichment as the caller's intended “next push” behavior. The chair retained W1 because the approved design states that reopening requests fresh work and the executable spec requires enriched reopened rows; contracts and frontend independently reached the same evidence-backed result.
- The frontend specialist reported no bootstrap omission, but that conclusion assumed a persisted scope is already effective during construction. `TabBarScopeCoordinator.resolved` proves the opposite until the first tree, and the host's subscription gate prevents that first tree in the hidden-body mode; B1 therefore survives as chair-only full-flow evidence.

## Accepted risk

None.

## Audit backlog

None.
