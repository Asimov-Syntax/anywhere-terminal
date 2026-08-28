# Code Review — Round 2

**Date**: 2026-08-28
**Cycle**: 1
**Mode**: verification
**Scope**: range `2674b9e5..HEAD`
**Head**: `8650ef13287c56f04b5e5d824edb1c8d80d44c6c` (explicit committed range reviewed; working tree had analytics-only modifications outside the review cone)
**Scope lock**: passed — production changes are limited to B1 remediation and its tests; review/task/analytics files are completion metadata, with no new capability, contract, or invariant owner
**Reviewable lines**: 1302 by Phase-0 classification, dominated by generated analytics/change-state metadata; 12 changed production lines in the verification cone
**Large change note**: explicit range exceeds 800 classified lines because of analytics metadata; the behavioral verification cone is the two projector hunks and corresponding tests
**Agents spawned**: `asm-review-logic` (`gpt-5.6-terra[1M]`), `asm-review-contracts` (`sonnet[1M]`)
**Agents skipped**: `asm-review-data-security` (no data/auth boundary), `asm-review-frontend` (no production frontend change), `asm-review-performance` (memo ownership/growth logic unchanged), `asm-review-reuse` (no new helper or duplicated capability)
**Verification evidence**: `bun run asm change verify-status keep-contested-session-title` reports task `2_1` exit 0 and scope unchanged. The recorded task command is `pnpm run check-types && pnpm run test:unit`, with focused `presenceProjector.test.ts` evidence and assertion delta +3. No project verify command was run during review.
**Verdict**: APPROVE
**Counts**: 0 BLOCK / 0 WARN / 0 SUGGEST; 1 prior BLOCK fixed

## Cross-round adjudication

### [B1] A reported empty pane title still suppresses the recovered session title
- **ID**: B1
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: chair; verified independently by `asm-review-logic` and `asm-review-contracts`
- **Class**: feature
- **File**: `src/worktree/presenceProjector.ts:314`
- **Title**: A reported empty pane title still suppresses the recovered session title
- **Evidence**: Fixed. Settlement now sets `titleSourceId` only when the disowned row has no meaningful trimmed pane title. A pane-owned title therefore has neither `entryId` nor `titleSourceId`, while empty/whitespace and registry-fallback rows retain the lost session as `titleSourceId`. `titleFromVault` now consults `row.entryId ?? row.titleSourceId` without the value-presence guard, so a vault hit upgrades empty/registry fallback values and a vault miss leaves the existing fallback intact. New tests cover reported empty, whitespace-only, registry-to-vault upgrade, and registry fallback on a vault miss; the existing `npm run watch`, contest ownership, and agent-clearing tests remain.
- **Invariant**: With ownership withdrawn, only a meaningful pane-owned title suppresses `titleSourceId`; empty/whitespace pane evidence and session-derived fallback names remain eligible for vault resolution.
- **Boundary inventory**: Verified never-reported title, reported empty/whitespace title, meaningful pane title, registry-derived fallback, vault hit/miss, uncontested/owned rows, contest withdrawal and agent clearing, memo source/eviction, full projection, external-only replay, render transport, and `entryId`-only host/UI ownership actions. Affected boundaries from round 1 are fixed; all previously safe boundaries remain safe.
- **Impact**: Resolved. Cleared shell panes receive the session title, registry slugs upgrade to the vault title, and meaningful pane titles remain untouched without restoring ownership.
- **SuggestedFix**: none — implemented and verified
- **Status**: fixed
- **Triage**: accepted in round 1; verified fixed at `8650ef13287c56f04b5e5d824edb1c8d80d44c6c`

## External-only replay adjudication

No additional test is required to close B1. `lastWindowPass` stores rows after `settleContestedSessions`, so the provenance-bearing `titleSourceId` is already present before replay. The external-only branch copies those settled rows verbatim, and every projection then calls `titleFromVault`; no replay route bypasses settlement or the vault-title pass. This boundary is verified safe by control-flow inspection and was independently confirmed by both specialists.

## New findings

None.

## Audit backlog

None.
