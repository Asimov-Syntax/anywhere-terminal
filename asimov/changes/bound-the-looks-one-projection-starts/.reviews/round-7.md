# Review Round 7: bound-the-looks-one-projection-starts

**Date**: 2026-08-30
**Cycle**: 4
**Mode**: verification
**Requested execution mode**: fastlane
**Scope**: commit `fafa10f7` only
**Head**: `fafa10f7ae502ef9161118503cfba8827e93378e` (working tree dirty outside the reviewed commit: untracked review material for another change)
**Reviewable lines**: 16
**Agents spawned**: `asm-review-logic`
**Agents skipped**: `asm-review-data-security` (no authority, storage, input, or external boundary in the impact cone), `asm-review-contracts` (no interface or contract change), `asm-review-frontend` (no rendering/client-state change), `asm-review-performance` (bounds and growth axes are unchanged), `asm-review-reuse` (no new capability or duplicated helper)
**Verdict**: **WARN**
**Counts**: 0 BLOCK, 1 WARN, 0 SUGGEST

## Scope-lock decision

The corrected scope passes the verification lock. Commit `fafa10f7` moves the existing D10 generation sample and adds its regression case; it changes no `D#`, task, interface, accepted contract, or invariant owner. Review artifacts, analytics, and the workflow build note are support context. The unrelated WT-011.9 commit from the originally supplied range is not part of this commit review.

## Verification scope

Round 6 froze two relevant findings:

- **B1-R4**, accepted: every falling edge after `project()` begins must invalidate that pass before any later `previewOrder` write.
- **W1-R6**, author-accepted but not fixed: a pass whose preview enrichment is fenced off is still recorded by the host as enriched from the requested flag.

The reviewed cone is the generation sample, every suspension and queue write it fences, the new regression hook/case, and the unchanged host handoff reached when the preview pass is skipped. The author impact manifest is accurate for changed code: title behavior, line/LRU/outstanding behavior, ranking, bounds, interfaces, and host lifecycle paths do not move.

## Finding

### W1

- **ID**: W1-R6
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-logic`, corroborated by `chair`
- **Class**: feature
- **File:line**: `src/worktree/presenceProjector.ts:1087,1182-1188`; `src/providers/WorktreeHost.ts:1226-1239,1426-1458`
- **Title**: The earlier fence broadens the false-enriched host handoff
- **Evidence**: Sampling `drawGeneration` at project entry correctly makes a reset during `clock()`, `openSnapshot`, pane-cwd holding, pane projection, session reading, session-cwd holding, or title enrichment skip `previewFromVault`. The unchanged host still sets `projectedEnriched = enrich`, recording the request rather than whether preview enrichment ran. A surface reopening after such a pass therefore sees `projectedEnriched === true` and does not request immediate enrichment.
- **Impact**: W1-R6 persists with the same mechanism and bounded user-visible outcome: the queue remains correctly empty, but preview lines can remain absent or stale until the next five-second external scan. This commit broadens the trigger from the title wait to every pre-preview suspension or reentrant dependency call. The wider reach does not change severity because recovery remains guaranteed and no fairness, work-bound, or retained-state invariant is corrupted.
- **SuggestedFix**: In a separately planned change, propagate whether preview enrichment actually completed, or hold an explicit outstanding-enrichment obligation, and derive `projectedEnriched` from that outcome rather than the requested `enrich` flag. Cover fall during an in-flight pass -> completion -> reopen at the host/projector boundary.
- **Status**: open
- **Triage**: author accepted and deliberately not fixed; awaiting user scheduling. This is not user-granted risk acceptance.

## Cross-round disposition

- **B1-R4**: fixed. `drawGeneration` is now sampled at line 1087 as the first statement of `project()`, before `clock()`, the first dependency call, and every await. Every reset through title enrichment therefore changes the sampled token before the comparison at line 1186. Once `previewFromVault()` begins, all queue writes are synchronous before its first await; an edge during the awaited preview reads clears the queue and no later queue write restores it.
- **W1-R6**: persists. Its trigger inventory expands as described above; severity remains WARN and priority remains P2.
- **S1-R3**: remains fixed and outside this commit's behavioral cone.
- No `audit-backlog` or `risk-accepted` entries exist.

## Invariant verification

- **Current-drawn queue membership**: verified project entry, synchronous clock/dependency reentrancy, snapshot wait, pane-cwd wait, pane identity and nested reads, registry wait, session-cwd wait, title wait, synchronous preview-order reconciliation, and awaited preview reads. No pass older than a falling edge can repopulate the queue. B1 is closed.
- **One-projection work bound and fairness**: the queue algorithm, `mayLook` cap, unique-id grants, served-row rotation, and returning-row arrival behavior are unchanged. Skipped passes start zero preview looks.
- **Enrichment handoff**: the projector now skips from more valid fence points, while the host continues recording requested enrichment. W1 is the only affected boundary.
- **Fallback/error paths**: title enrichment still runs; preview errors and held-line behavior are untouched; `enrich:false` continues to skip the whole enrichment block and is unaffected by the sampled token.

## Inline support review

The changed test has no `.only` or `.skip`, and async work is awaited. `setBeforeSnapshot` lands the reset inside the first dependency call that `project()` awaits, and the assertion distinguishes the faulty late sample by observing a preview call where none is permitted. Together with the sample's position before the call, it covers the B1 mechanism. Moving the sample back to the enrichment block is recorded as reproducing the finding and failing this case. No existing assertion was weakened.

## Recorded verification evidence

`bun run asm change verify-status bound-the-looks-one-projection-starts` records task 4_1 verified with exit 0 and the source/test scope change. The caller reports type check, 5,544 unit tests, I10, both esbuild bundles, and `biome check src` at the 0-error/14-warning baseline, plus the late-sample mutation killed by the new regression. The chair did not rerun the project gates; adjudication uses the commit, the accepted obligations, and the recorded evidence.

## Specialist result

- `asm-review-logic` — B1 invariant, async impact cone, regression, and W1 intersection — `gpt-5.6-sol[1M]` — confirmed B1 fixed and W1 persisting with broader reach but unchanged WARN severity.
