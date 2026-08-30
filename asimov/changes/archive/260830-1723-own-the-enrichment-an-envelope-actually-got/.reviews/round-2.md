# Review Round 2: own-the-enrichment-an-envelope-actually-got

**Date**: 2026-08-31
**Cycle**: 2
**Mode**: discovery
**Scope**: exact commits `1b94dbd3` and `c4666fb9` only; no range
**Head**: `c4666fb96f0e34fba09b4d533ae0276be651b135` (latest explicit commit; the pre-existing dirty `analytics.json` working-tree change was excluded)
**Excluded ancestry**: `a3c68513`, `d1e1c303`, and `46d0ca2f` belong to `prove-the-store-is-readable-not-merely-there` and were not reviewed
**Reviewable lines**: 296
**Agents spawned**: `asm-finder`, `asm-review-logic`, `asm-review-contracts`, `asm-review-performance`
**Agents skipped**: `asm-review-data-security` (no authority, persistence, input-validation, secret, or external API boundary), `asm-review-frontend` (no React, webview rendering, accessibility, or client-state change), `asm-review-reuse` (no new helper, parser, validator, duplicated capability, or cohesion split)
**Verdict**: **WARN**
**Counts**: 0 BLOCK, 1 WARN, 0 SUGGEST
**Blocker split**: 0 feature / 0 machinery

## Scope and accepted obligations

Cycle 1 closed as superseded after B1-R1 was accepted as a design delta and returned to planning. Gate 2 was re-earned. This is cycle 2's discovery round against the union of the two exact patches, with the three unrelated commits between them excluded.

Approved D1 keeps the outstanding-enrichment obligation in `WorktreeHost`. D1a requires the enriching pass, not the outer run, to discharge it; an edge landing during that pass re-records it, invalidation forces another pass, and a rejecting run restores what its passes cleared. D2 keeps the falling edge passive and gates recording on a projection being in flight because `reconcileRowDrawing` is a state settle rather than an edge detector. Task 1_1 requires a reopened surface to receive a published enriched replacement pass without making idle no-op mutations create work.

The explicit scope also adds or updates change analytics. Those JSON changes are accounting only and do not alter runtime behavior. Change artifacts and `docs/PLAN.md` were read as context but are skipped review categories. Tests were reviewed inline.

## Risk map

- **Async obligation lifecycle**: one host-local boolean crosses a falling edge, a joined single-flight run, per-pass discharge, invalidation, rejection, disposal, and final publication.
- **Pass/run distinction**: one `requestProjection` run may contain several `projectOnce` passes; a joined reopening must be spent inside the existing run without self-dirtying forever.
- **Synchronous coupling**: the conditional clear and `projectOnce`'s `anyDrawingRows()` sample must remain in one synchronous span.
- **Hot/cold projector modes**: the replacement may be external-only and replay pane rows, or fall back to a full pane projection; enrichment must cover the resulting rows in either mode.
- **Growth axis**: projection passes per single-flight run. The two booleans coalesce edges and add O(1) state; after input quiesces, one outstanding obligation adds at most one successful replacement pass. Surface scans remain over the structurally small attached-webview set.
- **Test discrimination**: joined-run termination and rejection restoration are covered, but the accepted publication side effect is not observed by the new joined-reopening test.

## Full-flow trace

- Tree requests, rebuilds, pane evidence, external scans, and row-drawing promotion all enter `requestProjection`. A row promotion uses `join: true`, so it joins an active run instead of dirtying it.
- The last row-drawing surface falling calls `forgetDrawOrder()` and records `enrichmentPending` while `projectionRun` exists. The edge never requests work.
- At each loop iteration, an enriching pass clears `enrichmentPending`, then calls `projectOnce`. Only plain synchronous reads occur before `projectOnce` samples `anyDrawingRows()` and calls the projector; no yield exists between the clear and that sample.
- The projector samples its draw generation before its first await. An edge during its later title/preview work advances that generation and can cut preview enrichment short. The host-side edge simultaneously re-sets `enrichmentPending`, so the completed pass observes enrichment still owed and schedules one replacement pass.
- An external-only replacement replays the last pane rows when valid, appends external rows, and runs title/preview enrichment over the combined rows; if replay is unavailable it falls back to the full pane path. The replacement therefore satisfies the same envelope, not only registry rows.
- Tree or pane invalidation sets `projectionDirty`; the next pass re-clears and re-samples. A rejection enters the run catch, restores `enrichmentPending` when any pass discharged it, and publishes nothing. A dirty failed run starts another run; a clean failed run leaves the obligation for the next settle/scan. Disposal terminates the host and creates no future consumer to serve.
- A clean, non-disposed run exits the loop, clears `projectionRun`, commits the tree/presence envelope, and broadcasts it once. The production path is sound; the finding below is that the new regression test does not observe this last step.

## Cross-round disposition

- **B1-R1 — fixed**: discharge moved from run start into each enriching pass, so a reopening that joins the run receives one replacement pass and the loop terminates.
- **W1-R1 — fixed**: a run whose projector rejects restores the obligation in its catch; removing that restore kills the new rejection case.

## Findings

### W1-R2

- **ID**: W1-R2
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-contracts`, corroborated by `chair`
- **Class**: feature
- **File:line**: `src/providers/WorktreeHost.test.ts:800-829`
- **Title**: The joined-reopening regression does not assert publication
- **Evidence**: The test named `publishes exactly one replacement pass when a surface reopens mid-projection` clears and inspects only `h.options`, the array populated when `projector.project()` is called. Its two assertions prove that the loop terminates with exactly one enriched replacement invocation, but it never inspects `h.s.posts` or the final worktree-tree envelope. A regression that still performs the enriched pass but omits the final `commitAndBroadcast()` would satisfy both assertions.
- **Impact**: Task 1_1's accepted outcome is that the reopened surface is served a published replacement envelope. The unique joined-run regression proves invocation and termination, but leaves the user-visible delivery half unpinned.
- **SuggestedFix**: Clear or snapshot `h.s.posts` immediately before releasing the parked projection, then assert that exactly one new worktree-tree response is posted after the enriched replacement pass. Keep the existing pass-count and `enrich: true` assertions because they discriminate the original infinite-loop failure.
- **Status**: accepted
- **Triage**: Accepted — the assertion proved the pass ran and the loop terminated, which is the mechanism, not the outcome task 1_1 owns. `h.s.posts` is now cleared alongside `h.options` before the release, and the test asserts exactly one `worktreeTreeResponse` afterwards; the pass-count and `enrich === true` assertions are retained, not replaced. Confirmed load-bearing: suppressing `commitAndBroadcast()` on the clean path fails exactly this case on the new assertion. build triage

## Inline support review

The changed tests contain no `.only` or `.skip`, and their asynchronous transitions are awaited through the existing settle helper. The joined-reopening case kills the run-start-clear regression; the rejection case kills removal of catch restoration. The `anyDrawingRows()` clear gate is explicitly labelled as defence in depth and is not claimed as covered. Its mutation is behaviorally equivalent under the current three exits: a completed non-enriching pass records `projectedEnriched = false`, invalidation forces another pass, rejection restores, and disposal has no future consumer. Keeping the gate is reasonable because it states D1a's local precondition at the discharge site and costs only a scan of the structurally small surface set; its surviving mutation is not a defect or a false coverage claim.

## Recorded verification evidence

The caller reports a clean type check, 5,554 passing unit tests, the I10 gate passing, both esbuild bundles built, and `biome check src` at the 0-error / 14-warning baseline. The run-start-clear and catch-restore mutations are killed; removal of the clear gate survives for the documented reason above. Per review policy, no project typecheck, lint, bundle, or test command was rerun.

## Specialist results

- `asm-review-logic` — edge timing, pass/run state, joins, invalidation, rejection, disposal, and loop termination — `gpt-5.6-sol[1M]` — no findings.
- `asm-review-contracts` — D1/D1a/D2 conformance and Acceptance proof — `gpt-5.6-terra[1M]` — W1-R2.
- `asm-review-performance` — projection-pass growth axis, coalescing, and rejection over-restore bound — `sonnet[1M]` — no findings.
- `asm-finder` — full-flow caller/projector trace, including external-only replay and enrichment coverage — support only.

No accepted-risk or audit-backlog entries exist.
