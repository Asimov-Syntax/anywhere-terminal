# Review Round 3 — collapse-the-rail-after-a-sidebar-selection

| Field | Value |
|---|---|
| Date | 2026-08-30 |
| Cycle | 2 |
| Mode | discovery |
| Requested mode | fastlane |
| Scope | committed range `ea9220b8..8d1d7d72`, with the integration seam evaluated against dependency `01b1227b` and bookkeeping commit `c154a69a` |
| Head | `c154a69a7c0046cae96a03b76a068099add12211` |
| Tree state | clean before review persistence |
| Reviewable lines | 94 production TypeScript lines in the explicit range; changed tests reviewed inline |
| Agents spawned | asm-finder; asm-review-logic (`gpt-5.6-sol[1M]`); asm-review-frontend (`gpt-5.6-terra[1M]`); asm-review-contracts (`sonnet[1M]`); asm-review-performance (`gpt-5.6-terra[1M]`) |
| Agents skipped | data-security (no auth, persistence, secret, input, or external-data boundary); reuse (the original helper consolidates an existing layout predicate and the dependency adds no duplicate capability in this seam) |
| Verdict | APPROVE |
| Counts | BLOCK 0 · WARN 0 · SUGGEST 1 |
| Split | 0 gating blockers — 0 feature / 0 machinery |

## Cycle boundary and context

Cycle 1 ended when the accepted B4 remedy introduced a new protocol/invariant owner and was extracted into `separate-presence-subscription-from-view-visibility`. That dependency was independently reviewed through three rounds and archived at `01b1227b`; this round begins cycle 2 and reviews only its integration with the parent's auto-collapse path, not the whole parent or dependency diff.

Gate 2 is approved. No `proposal.md` exists; intent comes from the approved task/spec delta, WT-010.4, the prior B4 triage, the dependency's approved design, and the caller's integration brief.

Recorded verification was cited, not rerun. `bun run asm change verify-status collapse-the-rail-after-a-sidebar-selection` reports the parent task records at exit 0. The author reports the current tree clean under type check, 5,184 unit tests, I10, and the unchanged Biome `src` baseline of 5 errors / 14 warnings / 3 infos.

## Risk map

- **Top risk:** ordering across selection, scope mutation, rail visibility, controller subscription derivation, host scan/push admission, and tab-bar redraw.
- **Contract risk:** whether the dependency's `rows | presence` protocol actually realizes the parent's same-count obligation, and whether task 1_2 truthfully records delivery by another change.
- **Growth axis:** `E`, live registry/projected session entries. A presence-only scope retains the accepted O(E) registry/external-row scan every five seconds, while the dependency removes title/preview enrichment from that path.
- **UI risk:** the scope chip and its clear control live outside the collapsed rail body; the count must update both visible badge text and the accessible name.

## Full-flow trace

1. A worktree row selection reaches `main.ts:1143-1159`. `tabBarScope.onSelectWorktree(worktreeId)` runs before the collapse.
2. `tabBarScopeWiring.ts:205-210` stores the scope, settles navigation, and compares the raw presence need. On a none-to-scope edge it invokes the independent `revalidatePresence` callback before the visual render gate.
3. While the rail is still open, the controller remains at `rows`. `VaultPanel.collapseAfterSelection()` then calls `setCollapsed(true, { persist: false, animate: true })`; `syncWorktreeVisibility()` reports the body hidden through `main.ts:1174`.
4. `WorktreeController.setVisible(false)` records `bodyShown = false`, performs body cleanup, and derives `presence` because `presenceNeeded()` now reads the scope set in step 2. It posts `{ visible: true, level: "presence" }`, not an unsubscribe.
5. `WorktreeHost` keeps `anyShowing()` true for the displayed surface, so the five-second scan and pushes remain active. `anyDrawingRows()` becomes false, so the projection uses `enrich: false`.
6. `presenceProjector` still reads the registry, rebuilds external rows, waiting state, attribution inputs, ranking, and degradation. It skips only title and preview enrichment.
7. The host broadcasts the paired tree/presence envelope to the presence-only surface. `WorktreeController.handleTreeResponse()` updates presence and emits attribution when placement or waiting changes.
8. `tabBarScopeWiring.onAttribution()` recomputes the hidden-waiting count and redraws when its visual signature changes. `TabBarUtils` unions presence waiting with local activity, counts hidden tabs, and updates the badge and accessible label on the tab-bar clear control, which is outside the collapsed rail body.

The exact auto-collapse sequence therefore preserves a live count. Clearing the scope while collapsed takes the inverse path and unsubscribes. Runtime rollout changes also remain live: `tabBarScope.setWorkbench()` forwards the flag to the controller through its `panel()` dependency before the next selection reads `isWorkbenchEnabled()`.

## Prior finding resolution

### [B4] Presence rollback contradicts WT-010.4's collapsed-scope contract

- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: asm-review-contracts / chair
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/main.ts:1109-1142`
- **Title**: Presence rollback contradicts remaining accepted obligations
- **Evidence**: The integrated code supplies both independent edges: `revalidatePresence` reaches `WorktreeController.revalidateVisibility()`, and `presenceNeeded` reads `tabBarScope.needsPresence()`. The selection-first ordering makes the raw need true before collapse reports body visibility false. The controller posts `level: "presence"`; the host retains scan and delivery; the projector retains all count inputs under `enrich:false`; attribution changes redraw the escape-control badge.
- **Impact**: The same hidden-waiting count and reachable escape control now survive the routine selection-driven collapse, satisfying the parent spec and WT-010.4.
- **SuggestedFix**: No further behavioral fix.
- **Status**: fixed
- **Triage**: accepted in round 2; resolved by dependency `01b1227b`
- **Invariant inventory**: Verified safe — none-to-scope before collapse; rows-to-presence demotion; presence-only scan arming; presence-only envelope delivery; attribution/waiting redraw; scope clear to unsubscribe; runtime rollout fan-out. The known row-enrichment promotion boundaries do not feed the count.

## Findings

### [S1] Skipped task 1_2 retains stale traceability and implementation steps

- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P3
- **Agent**: asm-review-contracts (merged and downgraded by chair)
- **Class**: machinery
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/changes/collapse-the-rail-after-a-sidebar-selection/tasks.md:17-28`
- **Title**: Skipped task retains a dead spec ref and the rejected boolean-widening plan
- **Evidence**: The `[-]` status line truthfully says the dependency delivered the behavior, but `Refs` still names the removed `a-surface-holding-a-scope-keeps-receiving-presence` anchor and the Plan still describes the reverted effective-boolean implementation from round-1 B1/B2/S2. The surviving `scope-does-not-depend-on-the-layout` anchor and the status explanation are correct.
- **Impact**: No behavioral gap is hidden and archive truth is intact, but a reader reopening the skipped task can follow a dangling link or mistake the rejected recipe for the shipped level-based protocol.
- **SuggestedFix**: Remove the dead anchor and mark the old Plan as superseded, or replace it with a pointer to the archived dependency's level-based implementation. Keep the current `[-]` status and delivery explanation.
- **Status**: open
- **Triage**: pending; non-gating traceability cleanup

## Adjudication notes

- The frontend rollout finding was rejected with specific code evidence: `main.ts:859-861` calls `tabBarScope.setWorkbench()`, and `tabBarScopeWiring.ts:242-247` forwards that transition to `deps.panel()?.setWorkbench(enabled)`; `panel()` is the controller supplied at `main.ts:1103`. The controller state read at selection is live.
- The performance BLOCK was rejected. It identified the deliberately retained O(E) registry/external-row pass, then confirmed that the dependency adds no further unbounded work and that `enrich:false` preserves every count input. The parent and dependency designs explicitly retain this scan to satisfy the live-count contract; the rejected round-1 cost was the additional per-row title/preview I/O, which is now absent. No new defect in the explicit range was evidenced.
- The dependency's round-3 WARN remains non-gating for this parent: `setDisplayed(true)` and promotion joining an in-flight bare pass can delay row titles/previews after reopening, but neither route suppresses registry rows, waiting state, attribution, host delivery, or the collapsed escape-control count.
- The task `[-]` bookkeeping is substantively honest. The structured `Deps: 1_1` is an intra-change task dependency; the cross-change dependency is already recorded in `workflow.md` and the task status prose, so no separate dependency finding survives.
- No production behavior in `ea9220b8..8d1d7d72` is invalidated. The dependency adds two wiring inputs in `main.ts`; it leaves the selection order, layout predicate, non-persisted collapse, focus handoff, animation, reversibility, and live rollout read intact.
- Changed tests correspond to the original production changes; no changed test contains `.only` or `.skip`.

## Accepted risk

None.

## Audit backlog

None.
