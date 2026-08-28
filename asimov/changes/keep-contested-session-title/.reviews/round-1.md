# Code Review — Round 1

**Date**: 2026-08-28
**Cycle**: 1
**Mode**: discovery
**Scope**: range `main..HEAD`
**Head**: `2674b9e5b919d32dd41975a70b457468a1bc2033` (explicit range reviewed; working tree also had unrelated untracked analytics files)
**Reviewable lines**: 44
**Intent context**: caller brief plus `tasks.md`; `proposal.md` absent and Gate 2 not approved
**Agents spawned**: `asm-review-logic` (`gpt-5.6-terra[1M]`), `asm-review-contracts` (`sonnet[1M]`), `asm-review-performance` (`gpt-5.6-luna[1M]`)
**Agents skipped**: `asm-review-data-security` (no data/auth boundary), `asm-review-frontend` (no production frontend behavior changed), `asm-review-reuse` (no added helper or duplicated capability)
**Support**: `asm-finder` traced ownership, transport, replay, render, and action consumers
**Verification evidence**: `bun run asm change verify-status keep-contested-session-title` reports task `1_1` exit 0; the post-verification scope delta is formatting-only in `presenceProjector.test.ts`. No project verify command was run during review.
**Verdict**: BLOCK
**Counts**: 1 BLOCK / 0 WARN / 0 SUGGEST
**Split**: 1 feature / 0 machinery

## Findings

### [B1] A reported empty pane title still suppresses the recovered session title
- **ID**: B1
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: chair (empty-title defect corroborated by `asm-review-logic`)
- **Class**: feature
- **File**: `src/worktree/presenceProjector.ts:472`
- **Title**: A reported empty pane title still suppresses the recovered session title
- **Evidence**: `PaneEvidence` deliberately distinguishes `undefined` (never reported) from an empty reported title (`src/session/PaneEvidenceStore.ts:35-44`), and the reporter's cleared-title contract sends `title: ""` (`src/webview/terminal/paneEvidenceReporter.test.ts:130-139`). Settlement trims `item.paneTitle` but spreads the original row unchanged first (`presenceProjector.ts:301-310`), so an empty/whitespace title remains present. `titleFromVault` then skips every disowned row whose `row.title !== undefined` (`presenceProjector.ts:466-475`), and the renderer normalizes that value to `(untitled)`. The new regression test uses `title: undefined`, which is the distinct never-reported state and does not exercise the live cleared-title path. The same value-presence guard also treats a carried registry/session name as pane-owned provenance, preventing the documented vault-title precedence/refresh for that boundary.
- **Invariant**: With ownership withdrawn, only a meaningful pane-owned title may suppress `titleSourceId`; empty/whitespace pane evidence and session-derived fallback names must not be mistaken for pane ownership.
- **Boundary inventory**: Searched never-reported title, reported empty/whitespace title, meaningful pane title, registry-derived name, full projection, external-only replay, memo hot/cold paths, transport/render signature, and host/webview ownership actions. Affected: reported empty/whitespace title; registry-derived name for vault precedence/refresh. Verified safe: `undefined` title, meaningful pane title, `entryId`-only ownership gates, memo growth/eviction/dedup, and render-signature routing.
- **Impact**: The change can leave the exact class of shell/cleared-title pane it is meant to repair rendered as `(untitled)` even though `titleSourceId` exists and the session title is available. Registry-named disowned rows can also stay on the lower-priority name instead of refreshing from the vault.
- **SuggestedFix**: Preserve title provenance instead of using `row.title !== undefined` as a proxy. For example, make `titleSourceId` denote the no-meaningful-pane-title branch and always consult it there while retaining any registry title only as a fallback when the vault returns no title. Add empty-string, whitespace-only, registry-name, and external-only replay regressions.
- **Status**: open
- **Triage**: pending author remediation; must fix before approval

## Triage — author, round 1

| ID | Status | Rationale |
|---|---|---|
| B1 | accepted | Correct on both halves, and the second is the one that matters more. (a) `paneEvidence.ts:31-37` states the distinction explicitly — `unknown` is a pane nobody reported, `neutral` is a title that named nothing — so `""` is a real reported state, and my guard `row.title !== undefined` reads it as "has a title" and skips the vault. That is the exact shell-pane case this change exists to fix. (b) Worse, the guard also treats a registry name like `cyberk-skills-04` as pane-owned, so a row never upgrades to the vault's real title — the first-message title I told the user they would get. The defect is that I tested "is there a value" when the question was "who owns this value". Fix: set `titleSourceId` ONLY where the title is not pane-owned; the vault guard then reduces to "is there a source", with the registry name surviving as fallback when the vault has none. |
