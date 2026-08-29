# Review Round 2 — collapse-the-rail-after-a-sidebar-selection

| Field | Value |
|---|---|
| Date | 2026-08-30 |
| Cycle | 1 |
| Mode | verification |
| Scope | single fix commit `8d1d7d72` over round-1 Head `a89b0288bbb10fbc80fc6a13bf886cd40b58a08b` |
| Head | `8d1d7d72668677d8530b140b7e00120539e91b42` |
| Tree state | dirty outside the explicit commit (`asimov/changes/active`, `.analytics-cursor.json`, `analytics.json`); not reviewed |
| Reviewable lines | ~235; generated review/analytics metadata excluded from behavioral conclusions |
| Agents spawned | asm-review-contracts (`gpt-5.6-sol[1M]`), asm-review-logic (`gpt-5.6-terra[1M]`), asm-review-frontend (`sonnet[1M]`) |
| Agents skipped | data-security (no boundary), performance (the widening that created its hot path is removed; its causal edge was verified by chair/logic), reuse (one cohesive extraction), finder (impact manifest and direct inventory were sufficient) |
| Verdict | BLOCK |
| Counts | BLOCK 1 · WARN 0 · SUGGEST 0 |

## Scope lock

Passed. Commit `8d1d7d72` is remediation inside round 1's accepted findings: it removes the widening that caused B1/B2/S2 and fixes B3/W1/S1. It does not introduce a new invariant owner. The removal does, however, leave the accepted WT-010.4 contract internally unsatisfied; that is B4 below rather than a scope-lock supersession because no replacement capability or approved plan delta landed in this commit.

## Verification evidence

- Recorded verification was cited, not rerun: task 2_1 exit 0, type check green, 5157 unit tests green, I10 green, and Biome `src` at baseline.
- Production source has no `presenceNeeded`, `visibleRequested`, `revalidateVisibility`, or the widened `applyVisibility` path. The only matching `applyVisibility` is unrelated vendored scrollbar code; historical review/task/build records retain the old words as evidence.
- `WorktreeController.ts` is byte-for-byte unchanged from `95545535` after task 1_2's add-and-revert. `setVisible(false)` again always clears `pendingCreate`, posts false, and leaves `requestRefresh()` gated by the same single `visible` state.
- With the widening removed, scope alone cannot arm `WorktreeHost.anyShowing()`: B1's 5 s enrichment path and S2's widened protocol meaning no longer exist.
- The rollout predicate reads `worktreeController.isWorkbenchEnabled()` at the click. Existing controller and scope-wiring tests cover runtime flag mutation; the extracted predicate covers true, false, null selection, missing layout, and all dock axes. The single bootstrap call line remains unimportable but is a direct getter-to-predicate handoff; no additional harness is required for this round.
- Focus moves to the surviving header only when the active element is inside the body being hidden. Focus outside the vault is left alone.
- `animate` defaults to `persist !== false`, preserving constructor seed, manual toggle, expand, and search behavior. Automatic collapse is the only caller selecting `{ persist: false, animate: true }`; the unchanged shared animator still owns reduced motion.

## Verification flow trace

A worktree selection updates scope, reads the live controller rollout state, evaluates the extracted layout predicate, then focuses the surviving header when needed and runs the shared collapse animator without persisting. `VaultPanel.syncWorktreeVisibility()` reports false after collapse. The restored single-valued `WorktreeController.setVisible(false)` clears pending create, posts host visibility false, and disables body-only refresh. The host consequently stops projections and the external scan for this surface. This closes round-1 B1/B2/S2 exactly by removing their causal widening, but it also means a presence-only waiting transition can no longer update the collapsed scope count — the remaining accepted-contract failure in B4.

## Prior findings

### [B1] Scope-only subscription runs uncapped per-session preview I/O

- **Severity**: BLOCK · **Confidence**: HIGH · **Priority**: P1
- **Agent**: asm-review-performance / chair
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/main.ts` (removed widening)
- **Title**: Scope-only subscription runs uncapped per-session preview I/O
- **Evidence**: The `presenceNeeded` edge that kept host visibility true is absent; collapse now posts false and cannot arm `anyShowing()` through scope alone.
- **Impact**: The round-1 hot path is unreachable.
- **Suggested fix**: Cause removal accepted; the separate presence design must not recreate the same unbounded enrichment edge.
- **Status**: fixed
- **Triage**: accepted in round 1; resolved by scope cut

### [B2] Effective subscription visibility bypasses hidden-body cleanup

- **Severity**: BLOCK · **Confidence**: HIGH · **Priority**: P1
- **Agent**: asm-review-logic / chair
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:468-505`
- **Title**: Effective subscription visibility bypasses hidden-body cleanup
- **Evidence**: Requested/effective state no longer exists. Every true→false hide reaches `pendingCreate = null`; refresh is gated by the restored single `visible` field.
- **Impact**: Late create defaults cannot reopen UI over a hidden body through the removed mechanism.
- **Suggested fix**: No further fix in this change.
- **Status**: fixed
- **Triage**: accepted in round 1; resolved by scope cut

### [B3] Auto-collapse uses the initialization-time rollout value

- **Severity**: BLOCK · **Confidence**: HIGH · **Priority**: P1
- **Agent**: chair / asm-review-frontend
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/main.ts:1141-1147`
- **Title**: Auto-collapse uses the initialization-time rollout value
- **Evidence**: The callback now reads `worktreeController?.isWorkbenchEnabled() === true`; predicate tests cover both flag values and existing wiring tests cover runtime state movement.
- **Impact**: Off→on starts collapsing and on→off stops; shipped behavior remains unchanged while off.
- **Suggested fix**: No further fix. A bootstrap harness would require disproportionate extraction for one direct handoff.
- **Status**: fixed
- **Triage**: accepted in round 1

### [W1] Auto-collapse hides the focused row without moving focus

- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P2
- **Agent**: asm-review-frontend / chair
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/VaultPanel.ts:750-768`
- **Title**: Auto-collapse hides the focused row without moving focus
- **Evidence**: If the active element is inside `.vault-body`, focus moves to the surviving header before collapse; outside focus is explicitly preserved.
- **Impact**: The keyboard focus indicator remains visible and reversible.
- **Suggested fix**: No further fix.
- **Status**: fixed
- **Triage**: accepted in round 1

### [S1] Non-persistence suppresses the shared collapse animation

- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P3
- **Agent**: asm-review-frontend
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/VaultPanel.ts:787-805`
- **Title**: Non-persistence suppresses the shared collapse animation
- **Evidence**: Persistence and animation are separate options; automatic collapse animates without writing `vaultCollapsed`, and all old callers retain their previous default.
- **Impact**: Normal and reduced-motion behavior again flow through the shared animator.
- **Suggested fix**: No further fix.
- **Status**: fixed
- **Triage**: accepted in round 1

### [S2] Sender widens the visibility protocol without updating its authority

- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4
- **Agent**: asm-review-contracts
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:463-480`
- **Title**: Sender widens the visibility protocol without updating its authority
- **Evidence**: The widening and its sender comment are gone; controller and message authority again both mean that the Worktree view is shown.
- **Impact**: The protocol has one meaning again.
- **Suggested fix**: No further fix in this change.
- **Status**: fixed
- **Triage**: accepted in round 1; resolved by scope cut

## New finding in the remediation cone

### [B4] Presence rollback contradicts WT-010.4's remaining collapsed-scope contract

- **Severity**: BLOCK · **Confidence**: HIGH · **Priority**: P1
- **Agent**: asm-review-contracts (confirmed by chair)
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/changes/collapse-the-rail-after-a-sidebar-selection/tasks.md:17-41`
- **Title**: Presence rollback contradicts remaining accepted obligations
- **Evidence**: Task 2_1 restores single-valued visibility, so `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/VaultPanel.ts:657-658` reports the Worktree view invisible when collapsed and `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:468-482` stops host delivery. Presence-only waiting transitions therefore freeze. Yet `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/changes/collapse-the-rail-after-a-sidebar-selection/specs/worktree-panel/spec.md:46-50` still requires the same count when collapsed, and `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/docs/PLAN.md:262` requires scope to behave identically in every layout. The task ledger also leaves task 1_2 checked at lines 17-28, references a deleted spec anchor, and claims the reverted presence behavior is verified; task 2_1 simultaneously declares that behavior removed while depending on 1_2.
- **Impact**: WT-010.4 cannot truthfully archive as satisfying its accepted enabled-path contract. Default-off protects the default shipped layout, but does not waive the behavior promised when a user enables the rollout. Deferring the presence change only to WT-010.6 is too late because WT-010.6 already depends on completed WT-010.4.
- **Suggested fix**: Make the separately designed presence/protocol change a dependency of WT-010.4 and complete it before this change archives. Alternatively, re-enter planning for an explicit scope delta that removes the same-count obligation from WT-010.4 and its spec. In either route, restore the original Gate-2 task 1_2 or reopen/remove the rewritten checked task so the ledger no longer records reverted behavior as complete.
- **Status**: accepted
- **Triage**: Correct, and it overturns my round-1 routing. I had checked whether the
  count-when-collapsed obligation belonged to this change and concluded it did not, because the
  two scenarios naming it were added by task 1_2. That was the wrong place to look: the
  obligation is also carried by this change's PRE-EXISTING requirement "Scope does not depend on
  the layout" — "the same count is carried on it, whether the rail is shown beside the terminal,
  stacked above it, or collapsed to its header strip" — and by WT-010.4's own PLAN acceptance,
  "scope behaves identically in every layout; the escape control survives a collapsed rail".
  Reverting 1_2 therefore removed the implementation of an obligation this change still owes,
  and the rollout defaulting off protects the default layout without waiving what was promised
  to users who enable it.

  Taking the first of the two offered fixes: the presence/protocol change becomes a dependency of
  WT-010.4 and lands before this change archives. The second — a scope delta removing the
  same-count obligation — is a cut of accepted scope, which fastlane never auto-chooses, and it
  would also weaken an accepted `tab-bar-component` requirement rather than satisfy it.

  Bookkeeping corrected in the same pass: task 1_2 no longer reads as completed behaviour.

## Accepted risk

None.

## Audit backlog

None.
