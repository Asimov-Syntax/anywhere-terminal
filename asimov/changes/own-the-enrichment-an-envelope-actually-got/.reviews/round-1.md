# Review Round 1: own-the-enrichment-an-envelope-actually-got

**Date**: 2026-08-30
**Cycle**: 1
**Mode**: discovery
**Requested execution mode**: fastlane
**Scope**: commit `1b94dbd3` only
**Head**: `1b94dbd3e14ba3488d6b9a4fecfbd2b01445e064` (explicit commit; later commits and the dirty working tree were excluded)
**Reviewable lines**: 267
**Agents spawned**: `asm-review-logic`, `asm-review-contracts`
**Agents skipped**: `asm-review-data-security` (no authority, persistence, input, secret, or external API boundary), `asm-review-frontend` (no React, rendering, accessibility, or client-state change), `asm-review-performance` (no collection growth or scale-sensitive data path; the unbounded loop is an async correctness defect covered by logic), `asm-review-reuse` (no helper, parser, validator, duplicated capability, or cohesion split)
**Verdict**: **BLOCK**
**Counts**: 1 BLOCK, 1 WARN, 0 SUGGEST
**Blocker split**: 1 feature / 0 machinery

## Scope and accepted obligations

Gate 2 is approved. D1 keeps the outstanding enrichment obligation in `WorktreeHost`; D2 limits recording to a row-drawing settle while a projection is in flight. Task 1_1 requires a surface reopening after a cut-short projection to receive a replacement enriched pass, without creating work for idle no-op mutations, and keeps the falling edge passive.

The explicit commit also updates change analytics and adds the change artifacts. Those files were inspected for scope divergence; they do not alter runtime behavior. Tests were reviewed inline. Later commits and current working-tree changes were not reviewed.

## Risk map

- **Async obligation lifecycle**: one host-local boolean crosses a projection pass, the outer single-flight cycle, internal `projectionDirty` reruns, a joined reopening, publication, and failure.
- **Projector/host seam**: the projector fences preview enrichment with `drawGeneration`, while the host can observe only projection flight and row-drawing edges.
- **Cycle versus pass distinction**: an outer `requestProjection()` may execute multiple `projectOnce()` iterations; clearing once per outer cycle is not the same as consuming an obligation in the replacement pass.
- **Edge timing**: `projectionRun` is assigned after the async IIFE reaches its first suspension, so the synchronous prefix and event-loop interleaving needed explicit verification.
- **Test discrimination**: the positive case parks a projection, lands the falling edge, and reopens only after the original run settles; joined reopening and failure remain separate boundaries.

## Full-flow trace

- Rebuilds, pane evidence, and external scans enter the serialized `requestProjection()` cycle. Each `projectOnce()` samples `enrich = anyDrawingRows()` and awaits the projector.
- The projector samples `drawGeneration` at `project()` entry. From its first suspension onward, `projectionRun` is defined. A supported visibility/display/disposal event cannot interleave before assignment because the JavaScript stack has not yielded; no concrete synchronous reentrant surface path was found.
- When the last row-drawing surface falls during a pass, `reconcileRowDrawing()` calls `forgetDrawOrder()` and sets `enrichmentPending`. The projector later skips preview enrichment, while `projectOnce()` still records the requested `enrich` value.
- If the original run finishes while no rows draw, the happy path keeps `enrichmentPending` set. A later reopening starts a new outer cycle, clears it, and runs enriched. This is the path the new test covers.
- If rows reopen before the original run finishes, the rise joins that same cycle. The pending flag is not cleared, the completed pass sees enrichment owed, and every internal rerun sees it owed again. The cycle never reaches publication while rows remain visible (B1-R1).
- If a later replacement outer cycle starts and its projector rejects, the cycle has already cleared the pending flag but has not updated `projectedEnriched`. The catch path neither restores the obligation nor retries unless some other caller dirtied the run (W1-R1).
- Multi-surface behavior remains correctly scoped to the last row-drawing surface. A hidden successful un-enriched pass publishes `projectedEnriched = false`, so a later rise remains owed even if the explicit pending flag was cleared.

## Findings

### B1-R1

- **ID**: B1-R1
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic`, corroborated by `chair`
- **Class**: feature
- **File:line**: `src/providers/WorktreeHost.ts:1319-1323,1347-1354,1474-1480`
- **Title**: A reopening that joins the cut-short run loops projections without publishing
- **Evidence**: The falling edge sets `enrichmentPending = true` while the original `projectionRun` is active. If rows reopen before that run finishes, `reconcileRowDrawing()` calls `requestProjection({ external: true, join: true })`; the join branch returns the existing promise and never executes the sole clear at line 1353. When the current pass completes, `enrichmentOwed()` is true, so lines 1319-1322 set `projectionDirty` and start another `projectOnce()` iteration inside the same async IIFE. Internal iterations do not cross line 1353. Each successful enriched iteration therefore finishes with `enrichmentPending === true`, dirties itself again, and repeats while rows remain visible. `commitAndBroadcast()` is reached only after the loop exits.
- **Impact**: The supported fall-then-quick-rise flow can continuously rerun the projector, repeatedly performing snapshot, pane, registry, title, and preview work while withholding the replacement envelope from the reopened surface. This violates task 1_1's accepted outcome and can continue until rows stop drawing or the host is disposed.
- **SuggestedFix**: Model discharge at the projection-iteration level rather than once per outer request cycle. A replacement enriched iteration should claim the obligation it started after, clear it only when that iteration completes successfully and was not crossed by a newer falling edge, and leave a newer or failed obligation outstanding. Add a regression that reopens before releasing the parked cut-short pass and proves exactly one replacement enriched iteration completes and publishes.
- **Status**: accepted
- **Triage**: Accepted, and NOT remediation. Re-traced against `WorktreeHost.ts:1259-1355` and confirmed worse than reported: it is a non-terminating loop, not merely a delayed publish. The falling edge sets `enrichmentPending` while `projectionRun` is defined; a reopening arrives through `reconcileRowDrawing` with `join: true`, which returns the existing run at line 1259 without reaching the clear at line 1353; the in-flight iteration then finishes clean, `enrichmentOwed()` is true, and the `do` loop dirties itself. Every subsequent iteration enriches, sets `projectedEnriched = true`, and still finds `enrichmentPending` true — nothing inside the loop clears it — so `do { ... } while (projectionDirty && !disposed)` never exits and `commitAndBroadcast()` is never reached. The fix is to clear the obligation per enriching PASS rather than per outer run, which contradicts design.md D1's final paragraph in terms ("The flag clears where a run STARTS") and its own risk-map row ("Cleared where `projectedEnriched` is set", which is not what shipped either). Changing where the obligation is discharged is a change to D1, so by the remediation boundary this is parked and handed back to planning rather than patched.
- **Invariant inventory**: The obligation may be discharged only by a successful enriched pass newer than the edge. Searched outer-cycle start, ordinary pass completion, joined rise, internal dirty rerun, tree invalidation, hidden pass, failure, publication, and multi-surface fall. Ordinary post-completion reopening, hidden successful publication, idle no-op mutation, and multi-surface fall are safe. Joined rise plus internal rerun is affected.

### W1-R1

- **ID**: W1-R1
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-contracts` and `asm-review-logic`, corroborated by `chair`
- **Class**: feature
- **File:line**: `src/providers/WorktreeHost.ts:1324-1344,1347-1354`
- **Title**: A failed replacement clears the obligation before delivering enrichment
- **Evidence**: A new outer replacement cycle clears `enrichmentPending` immediately after its first suspension, before `projector.project()` has succeeded. If that call rejects, `projectOnce()` never updates `projectedEnriched`; the catch path sets `clean = false`, publishes nothing, and retries only when `projectionDirty` was independently set. After the earlier cut-short pass, `projectedEnriched` can still be `true`, so both inputs to `enrichmentOwed()` are then false despite no completed replacement enrichment.
- **Impact**: A projector failure can leave stale or absent second lines treated as satisfied until another event, normally the external scan, starts new work. This reintroduces the delayed recovery the change exists to remove on its error path, but the armed scan bounds the ordinary visible-surface delay.
- **SuggestedFix**: Preserve or transactionally restore the obligation when the candidate replacement iteration throws or is invalidated. Prefer the same host-local generation/pass-success transition used to fix B1-R1, so ownership need not move to `WorktreePresence`. Add a rejection case proving a later settle or retry still requests enrichment.
- **Status**: accepted
- **Triage**: Accepted, and bundled into the same handback. Confirmed: the `catch` at line 1323 sets `clean = false` and never restores `enrichmentPending`, while `projectedEnriched` still holds `true` from the cut-short pass, so `enrichmentOwed()` reports satisfied after a replacement that delivered nothing. The re-run at line 1341 only fires when someone independently dirtied the run. Agreed that this stays host-owned — no field moves into `WorktreePresence`. It is deferred to the same replan because the restore point and the clear point are one decision: D1 has to say which pass discharges the obligation and what an unsuccessful pass owes, and settling them separately would move D1 twice.
- **Invariant inventory**: The obligation must survive attempts that do not successfully deliver enriched output. Searched synchronous start, projector rejection, invalidation, clean publication, dirty failure retry, external-scan recovery, and disposal. Clean successful publication and dirty failure retry are safe; a clean-cycle rejection with no independent dirty signal is affected.

## Inline support review

The changed tests contain no `.only` or `.skip`, and their asynchronous transitions are settled. The positive case genuinely parks the initial build projection, lands the falling edge while `projectionRun` is active, releases it, and then proves a later request carries `enrich: true`; the killed “never recorded” mutation corroborates that discrimination. It deliberately waits for the cut-short cycle to settle before reopening, so it cannot detect B1-R1. The fake projector also does not reject, so it cannot detect W1-R1. The idle-edge case covers the stated 19-case blast-radius guard.

## Recorded verification evidence

`bun run asm change verify-status own-the-enrichment-an-envelope-actually-got` records task 1_1 verified with exit 0 and scope unchanged, with two cases and a projection-hold control added and no weakened assertions. The caller reports type check, 5,548 unit tests, I10, both esbuild bundles, and `biome check src` at the 0-error/14-warning baseline, plus three killed mutations. The mutations cover never recording, unconditional recording, and never clearing; none reopens before the held run finishes or makes the replacement reject, so they do not refute B1-R1 or W1-R1. Per review policy, no project typecheck, lint, bundle, or test command was rerun.

## Specialist results

- `asm-review-logic` — projection obligation state machine, joined rise, rerun loop, failure, and test boundaries — `gpt-5.6-sol[1M]` — B1-R1 and W1-R1.
- `asm-review-contracts` — host ownership, cycle/pass contract, publication/failure boundary, and test acceptance — `gpt-5.6-terra[1M]` — confirmed host ownership remains sound in principle; found the failed-replacement discharge defect.

No accepted-risk or audit-backlog entries exist.
