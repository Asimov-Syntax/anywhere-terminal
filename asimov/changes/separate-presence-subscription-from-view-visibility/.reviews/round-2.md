# Review Round 2 — separate-presence-subscription-from-view-visibility

| Field | Value |
|---|---|
| Date | 2026-08-30 |
| Cycle | 1 |
| Mode | verification |
| Requested mode | fastlane |
| Scope | single fix commit `2307fe1d` over round-1 Head `35c78622e48cdd2f5915e447e2c7e4c707d6b209` |
| Head | `2307fe1de6f688198238dd5ef331f4677744c66b` |
| Tree state | dirty outside the explicit commit (active pointer, analytics, and prior-change review/task bookkeeping); not reviewed |
| Reviewable lines | 1,051 formal reviewable lines; large-change note applies numerically. The cone is 35 production TypeScript lines plus tests; 1,016 lines are generated analytics/build JSON |
| Agents spawned | asm-review-logic (`gpt-5.6-sol[1M]`); asm-review-contracts (`gpt-5.6-terra[1M]`); asm-review-frontend (`sonnet[1M]`) |
| Agents skipped | data-security (no boundary); performance (no production projector/hot-path change); reuse (one state predicate on its existing owner); finder (author impact manifest and direct inventory were sufficient) |
| Verdict | BLOCK |
| Counts | BLOCK 1 · WARN 1 · SUGGEST 0 |

## Scope lock

Passed. Commit `2307fe1d` is remediation for the four accepted round-1 findings plus their tests and review/build/analytics metadata. `needsPresence()` is a query on the existing scope owner, not a new durable-state or lifecycle owner. No new capability, task contract, design delta, or unrelated invariant owner landed.

## Verification evidence

- Recorded verification was cited, not rerun. `bun run asm change verify-status separate-presence-subscription-from-view-visibility` reports task 2_1 at exit 0 with 12 assertions added/changed. The author reports type check, 5,179 unit tests, I10, and Biome `src` at the unchanged 5-error / 14-warning / 3-info baseline.
- No rebuttals. All four round-1 findings remain accepted.
- The author's four discrimination checks are useful evidence for the local mechanisms. Verification still has to trace their consumers: B1 and W1 fail at the cross-component handoff after those locally tested states are reached.
- No changed test contains `.only` or `.skip`.

## Verification flow trace

A hidden surface with workbench already enabled and a raw persisted scope now asks for presence before the scope is confirmed. That closes the original initialization deadlock. A valid tree confirms the scope without filtering early, and the controller remains subscribed. The remaining failure is notification: `needsPresence()` is not a render input, yet the controller is revalidated only through the tab-bar render callback. When workbench off→on makes a retained unresolved scope need presence, or stale resolution makes it stop needing presence without changing the effective visual scope, the render guard can suppress the callback. The subscription therefore stays absent or standing despite the corrected predicate.

On rail reopen, the controller now posts `requestWorktreeTree` after promoting the level to `"rows"`. The normal host state is already built and deliverable, and that request path calls `broadcast()` on the existing published envelope. It does not invoke the projector, so a bare presence-only envelope is sent again and enrichment still waits for the next scan.

The timer tests now drive the actual presence-only scan and its cancellation. The ranking test now proves both the timestamp and revision advance under `enrich:false`.

## Prior findings

### [B1] Restored hidden scope cannot bootstrap and release its presence subscription on every boundary

- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: chair + asm-review-logic + asm-review-contracts
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/tabBarScopeWiring.ts:162-168`
- **Title**: Presence need changes are still gated by the visual render signature
- **Evidence**: `needsPresence()` correctly reads `workbench && scope !== null` (`tabBarScope.ts:139-140`), but `main.ts` calls `WorktreeController.revalidateVisibility()` only inside the wiring's `render` callback (`main.ts:1105-1109`). `applyTree()` and `setWorkbench()` reach it only when `renderIfMoved()` observes a changed signature (`tabBarScopeWiring.ts:162-168,189-220`). That signature is built from `effectiveScope()`, which remains `undefined` for an unresolved scope. Therefore workbench off→on can change `needsPresence` false→true without changing the visual signature, leaving a hidden controller unsubscribed. The inverse edge is also unowned: clearing a stale unresolved raw scope changes `needsPresence` true→false while the effective scope remains absent, so a previously recorded unscoped signature can suppress revalidation and leave the presence subscription standing. The coordinator tests prove predicate values only; they do not prove the controller receives either edge.
- **Impact**: B1 persists in the accepted impact cone. A retained scope can remain unable to resolve after runtime enablement, and a stale scope can keep the 5-second presence scan alive after the persisted scope was cleared. Both violate “subscribe while anything is drawn; stop when nothing is.”
- **SuggestedFix**: Make subscription revalidation a first-class wiring effect whenever `needsPresence()` changes, independent of whether the tab bar needs repainting. Cover the wiring/controller seam for hidden-body unresolved workbench enablement (none→presence) and stale-tree resolution (presence→none), while proving `effectiveScope()` remains absent until confirmation.
- **Status**: persists from round 1
- **Triage**: accepted in round 1; local predicate fixed, lifecycle inventory incomplete
- **Invariant inventory**: Initial workbench-on restored scope, valid confirmation, live selection, and visible scope clear are verified safe. Runtime off→on with an unresolved retained scope and stale unresolved resolution with no visual signature movement are affected.

### [W1] Presence-to-rows promotion still waits for the poll before enriching rows

- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: asm-review-logic + asm-review-contracts (confirmed by chair)
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:537-540`
- **Title**: Promotion request rebroadcasts the bare cached envelope
- **Evidence**: The controller now emits `requestWorktreeTree` on `"presence"`→`"rows"`. In `WorktreeHost`, a non-forced request with an existing deliverable envelope executes `broadcast()` and returns (`WorktreeHost.ts:1653-1666`); `broadcast()` sends `currentMessage()` and does not invoke `requestProjection()`. The existing envelope was produced with `enrich:false`, so the immediate response remains bare. The revised test asserts only that one request was posted, not that an enriching projection or enriched response occurred.
- **Impact**: W1 persists unchanged. Reopened rows can still lack resolved titles and previews until the later external scan, contrary to the accepted reopen scenario.
- **SuggestedFix**: Make the host schedule and publish an immediate enriching projection on the level promotion, or add a request contract that explicitly guarantees that projection without a full git rebuild. Test the host/controller outcome from a bare envelope through an enriched reopen response, not only the outbound message count.
- **Status**: persists from round 1
- **Triage**: accepted in round 1; emitted request does not perform the required work

### [W2] Presence-only scan arming has no discriminating test

- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P3
- **Agent**: chair / asm-review-contracts
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.test.ts:733-770`
- **Title**: Presence-only scan arming has no discriminating test
- **Evidence**: The test now injects the host clock, asserts a presence-only subscription arms a timer, fires the timer, proves the projection receives `enrich:false`, and proves the final unsubscribe clears the timer. The author's discrimination check narrowing `anyShowing()` reports both scan tests fail.
- **Impact**: The retained scan and its stop edge now have a direct regression tripwire.
- **SuggestedFix**: No further fix.
- **Status**: fixed
- **Triage**: accepted in round 1

### [S1] Ranking test passes when ranking is stale

- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P4
- **Agent**: chair
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.test.ts:1945-1966`
- **Title**: Ranking test passes when ranking is stale
- **Evidence**: The revised test records the prior rank/revision, adds a session with a newer timestamp, projects under `enrich:false`, and asserts the exact new rank plus a strictly greater revision. The author's discrimination check suppressing the ranking update reports only this test fails.
- **Impact**: Ranking outside the enrichment branch is now behaviorally protected.
- **SuggestedFix**: No further fix.
- **Status**: fixed
- **Triage**: accepted in round 1

## Adjudication notes

- Logic and contracts independently found both B1 and W1 persisting through cross-component handoffs. Their evidence matches the chair's full-flow trace.
- Frontend reported no isolated DOM-module defect. That does not refute the findings: B1 lives in the subscription notification handoff, and W1 in the host request contract outside a frontend-only view.
- B1 keeps its round-1 severity. The impact did not change; the fix covered the predicate but not every boundary that must notify its consumer.
- W1 keeps its round-1 severity. Posting a message is new evidence, but the host behavior proves the user-visible outcome is unchanged.

## Accepted risk

None.

## Audit backlog

None.
