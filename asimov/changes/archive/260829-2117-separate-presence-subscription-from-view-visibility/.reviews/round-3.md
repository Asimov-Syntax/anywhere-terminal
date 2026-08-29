# Review Round 3 — separate-presence-subscription-from-view-visibility

| Field | Value |
|---|---|
| Date | 2026-08-30 |
| Cycle | 1 |
| Mode | verification |
| Requested mode | fastlane |
| Scope | single fix commit `bd30ed3d` over round-2 Head `2307fe1de6f688198238dd5ef331f4677744c66b` |
| Head | `bd30ed3d4b2589cddf3bd8f63dbe6ca9ec752af3` |
| Tree state | dirty outside the explicit commit (active pointer, analytics, and prior-change review/task bookkeeping); not reviewed |
| Reviewable lines | 174 (88 production TypeScript + 86 analytics/build JSON; tests reviewed inline) |
| Agents spawned | asm-review-logic (`gpt-5.6-sol[1M]`); asm-review-frontend (`sonnet[1M]`); asm-review-performance (`gpt-5.6-terra[1M]`) |
| Agents skipped | data-security (no boundary); contracts (accepted contract unchanged and logic traced its host realization); reuse (no duplicated capability); finder (impact manifest and direct inventory sufficient) |
| Verdict | WARN |
| Counts | BLOCK 0 · WARN 1 · SUGGEST 0 |

## Scope lock

Passed. Commit `bd30ed3d` contains only accepted B1/W1 remediation, focused tests, and review/build/analytics metadata. The added callback and projection-state bit remain inside the existing scope-wiring and host owners; no new capability, durable-state owner, process lifecycle, or external contract landed.

## Verification evidence

- Recorded verification was cited, not rerun. `bun run asm change verify-status separate-presence-subscription-from-view-visibility` reports task 2_2 at exit 0 with 11 assertions added/changed. The author reports type check, 5,184 unit tests, I10, and Biome `src` at the unchanged 5-error / 14-warning / 3-info baseline.
- No rebuttals. B1 and W1 remain accepted.
- The author's discrimination checks prove the new direct wiring callback and the completed-pass visibility-promotion case. They do not exercise the two remaining W1 boundaries below.
- No changed test contains `.only` or `.skip`.

## Verification flow trace

Presence need is now a separate wiring effect. Every coordinator mutator settles by comparing the raw need, calling `revalidatePresence` on an edge, and only then consulting the unchanged visual render guard. Runtime workbench enablement with an unresolved retained scope therefore subscribes even when the tab bar does not repaint; valid/stale tree resolution and live select/clear keep their prior render behavior. The test priming step is legitimate: the harness calls its draw function directly without recording the coordinator's signature, while production reaches runtime flips after a gated comparison has established a baseline.

The host now fixes the simplest W1 path: after a completed bare envelope, an already-displayed surface changing from presence to rows triggers an external-only enriching projection, and an already-enriched envelope triggers none. The window-level predicate can become true through another owner, however: `setDisplayed(true)`. That path serves the bare cache but never runs the new transition check. The async path also remains incomplete: a promotion that occurs during a bare projection joins that run, which captured `enrich:false`, and schedules no follow-up. Both defer enrichment to the later scan.

## Prior findings

### [B1] Presence need changes are still gated by the visual render signature

- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: chair + asm-review-logic + asm-review-contracts
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/tabBarScopeWiring.ts:169-192`
- **Title**: Presence need changes are still gated by the visual render signature
- **Evidence**: `neededPresence` is now compared independently in `settle()`, and `deps.revalidatePresence` fires before the visual `renderIfMoved()` gate. Every coordinator mutator that can change raw scope need ends in `settle()`, while `main.ts` supplies the callback directly to `WorktreeController.revalidateVisibility()`. The rollout-flip test primes the coordinator signature, proves the effective scope remains unconfirmed, proves no repaint occurs, and proves the presence notification still fires. Removing the callback fails the seam tests per the author's discrimination check.
- **Impact**: The unresolved-scope subscription no longer depends on a repaint. Initialization and runtime rollout edges can bootstrap the tree, and need removal reaches the controller independently.
- **SuggestedFix**: No further fix.
- **Status**: fixed
- **Triage**: accepted in round 2
- **Evidence correction**: Round 2 overstated the stale-drop boundary as necessarily non-repainting. The current harness's arriving push also moves attribution and repaints. That coincidence did not invalidate the independent-notification requirement; the rollout flip was the discriminating broken edge, and the stale test records that need ownership rather than claiming a missing repaint.

### [W1] Presence-to-rows promotion still misses two first-row-drawing boundaries

- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: asm-review-logic + asm-review-performance (confirmed by chair)
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:1616-1647`
- **Title**: Display rises and in-flight bare passes still defer enrichment
- **Evidence**: First, `anyDrawingRows()` depends on `displayed`, but `attach().setDisplayed()` mutates that input and reconciles showing/scan without the new false→true check (`WorktreeHost.ts:1616-1623`). A retained rows surface becoming displayed can therefore be served the bare published envelope without re-projection. Second, `projectOnce()` captures `enrich` before awaiting the projector (`:1218-1226`). If a rows promotion occurs during that bare pass, the visibility handler calls `requestProjection({ external:true, join:true })`; the single-flight join branch returns the existing promise without dirtying or queuing another pass (`:1260-1265`). The pass then publishes bare. If this is the first bare pass, `projectedEnriched` may still be initialized true and the trigger is skipped altogether. The added host test promotes only after the bare projection has settled and does not cover either boundary.
- **Impact**: W1 persists at the cycle limit. A reopened or newly displayed rail can still render fallback titles and no previews until the next five-second scan. Growth axis E remains the live projected sessions; the intended immediate O(E) enrichment pass is omitted on these edges rather than multiplied.
- **SuggestedFix**: Define one window-level “first row-drawing surface” reconciliation used after every mutation of `visible`, `level`, or `displayed`. Record an outstanding must-enrich requirement separately from ordinary poll joining so a bare in-flight pass is followed by exactly one external-only enriching pass. Add deferred-projector tests for promotion during the initial and later bare pass, plus a rows surface becoming displayed against a bare envelope.
- **Status**: accepted — deferred to its own change, not fixed here
- **Triage**: Both remaining transitions are real and I verified them. `setDisplayed(true)`
  (WorktreeHost.ts attach) changes `anyDrawingRows()` without going through the visibility
  handler, so the false→true check never runs. And `requestProjection({join: true})` against an
  in-flight bare pass joins a run that already captured `enrich: false`, with no follow-up
  scheduled; during that first bare pass `projectedEnriched` is still true, which suppresses the
  request outright.

  Not fixed in this cycle, on the chair's own reading and mine: this is the third consecutive fix
  to the same invariant, and each one closed the case in front of it rather than the invariant.
  What is missing is a single definition of "the window gained its first row-drawing surface",
  owned in one place and reached from `visible`, `level` and `displayed` alike, with an
  outstanding must-enrich flag so a joined bare pass schedules exactly one follow-up. That is a
  new invariant owner, which the remediation boundary puts outside a fix loop — taking a fourth
  swing at it inside this cycle is exactly the thrash the boundary exists to stop.

  Non-gating, and I am not dressing that up: the impact is that reopened or newly displayed rows
  can lack titles and previews for up to one five-second scan. Nothing is wrong on screen, it is
  late. The obligation this change exists to satisfy — a scope's count surviving a collapsed rail
  — does not depend on it, and neither does WT-010.4.

  Carried out as a follow-up change rather than an audit-backlog line, because it has a designed
  shape already and someone should build it.
- **Invariant inventory**: Verified safe — visibility-level promotion after a completed bare pass; already-enriched promotion; controller emits no redundant tree request. Affected — `displayed:false→true` making the predicate true; promotion during an initial or later bare projection.

### [W2] Presence-only scan arming has no discriminating test

- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P3
- **Agent**: chair / asm-review-contracts
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.test.ts:733-770`
- **Title**: Presence-only scan arming has no discriminating test
- **Evidence**: Unchanged from round 2: the injected-clock tests prove timer admission, `enrich:false`, and cancellation after the last unsubscribe.
- **Impact**: The retained scan remains protected.
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
- **Evidence**: Unchanged from round 2: the test proves the exact newer rank and a strictly advanced revision under `enrich:false`.
- **Impact**: Ranking remains protected.
- **SuggestedFix**: No further fix.
- **Status**: fixed
- **Triage**: accepted in round 1

## Adjudication notes

- Logic and performance independently found the same two W1 boundaries. They are persisted under one invariant finding because they affect the same first-row-drawing transition at the same host seam and have the same impact; the detail inventory records both mechanisms.
- Frontend found B1's callback ordering safe and no body lifecycle, focus, render, or client-security regression.
- W1 keeps its prior WARN severity: reachability expanded, but the impact remains a transient delay to enrichment rather than data loss or a broken core path.
- The W1 boundary inventory has expanded in consecutive verification rounds. Patch-level remediation has not established the complete transition invariant. This is cycle 1's third and final round; no blocker remains, so the blocker thrash stop does not fire, but further remediation should hand back to planning and the next user-initiated review begins cycle 2 discovery as global round 4.

## Accepted risk

None.

## Audit backlog

None.
