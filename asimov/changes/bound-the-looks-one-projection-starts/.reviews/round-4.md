# Review Round 4: bound-the-looks-one-projection-starts

**Date**: 2026-08-30
**Cycle**: 3
**Mode**: discovery
**Requested execution mode**: fastlane
**Scope**: range `f07afcb1..e3ca7673`
**Head**: `e3ca76738ad08f7886006013e6a6281d93bc6378` (tree clean before this review artifact)
**Reviewable lines**: 142
**Agents spawned**: two `asm-review-logic`, `asm-review-contracts`, `asm-review-performance`; caller/lifecycle trace by `asm-finder`
**Agents skipped**: `asm-review-data-security` (no changed authority, input-validation, persistence, path-resolution, or external API boundary), `asm-review-frontend` (no webview/React change), `asm-review-reuse` (no new helper family, duplicated capability, or cohesion split)
**Verdict**: **BLOCK**
**Counts**: 1 BLOCK, 0 WARN, 1 SUGGEST
**Blocker split**: 1 feature / 0 machinery

## Scope and accepted obligations

Gate 2 is approved and was re-earned for the narrowing. This is a new cycle's discovery round, not verification: D8 and D9 supersede D5 and D7 rather than remediate them. The accepted obligations are D1, D2, D8, D9 and task 3_1: at most 16 transcript-look permissions by default across the whole projection; excluded rows synchronously receive only a line still held by the capped preview service; exact retention past `cap` and fairness across absence are withdrawn; the turn queue contains exactly the ids drawn now; and only a row drawn on every projection receives the structural fairness guarantee.

Change artifacts, prior review files, `docs/**`, and tests are support context rather than specialist-reviewed production files. The explicit range contains all implementation commits through the accepted narrowing.

## Risk map

- **Turn-queue invariant**: `previewOrder` is a closure-level state owner whose growth axis is distinct currently drawn entry ids. D9 requires membership to track the actual row-drawing mode, including rows/presence transitions, hide, detach, and an enriched projection crossing a falling edge.
- **Preview state machine**: `held`, `outstanding`, deadlines, finalization, and generation mismatch must preserve the narrowed held-line contract without starting work from `line()` or evicting an unread same-projection line.
- **Hot path**: the drawn-row axis is unbounded; permitted preview promises must remain bounded by `previewBudget`, while held and outstanding state remain bounded by service `cap`.
- **Contract seam**: the production wiring must supply both asynchronous preview and synchronous held-line read whenever bounded preview enrichment is enabled.

## Full-flow trace

- `extension.ts` constructs one `SessionPreviewService` and wires its `preview` and `line` operations through `createPresenceProjectorDeps` into the sole production projector.
- `WorktreeHost` is the sole production caller of `project(..., { enrich })`; it serializes projections, computes `enrich` from whether any visible/displayed surface draws rows, and runs presence-only scans with `enrich:false`.
- The projector resolves pane and registry identities, settles contested pane session claims, excludes claimed sessions from external rows, attributes rows to worktrees, and then performs title/preview enrichment only when `enrich !== false`.
- On an enriched pass, the projector reconciles `previewOrder`, grants at most `previewBudget` unique entry ids, synchronously reads excluded lines first, then awaits only permitted previews and writes each answer to its projection-local worktree/index.
- The preview service answers `line()` from `held` only and touches synchronously. `preview()` owns cadence, lookup/resolve/stat/read, timeout, outstanding fencing, and final re-seating. Synchronous excluded-row reads complete before permitted preview calls can insert or evict, so `line()` does not erase a line the same projection has yet to consume.
- On a rows-to-presence, hide, or detach falling edge, the host does not clear projector state. `enrich:false` projections skip the only function that reconciles `previewOrder`; a falling edge during an enriched projection also does not invalidate that in-flight pass.

## Findings

### B1

- **ID**: B1-R4
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic`, corroborated by `chair` and the `asm-finder` flow trace
- **Class**: feature
- **File:line**: `src/worktree/presenceProjector.ts:539-565,1145-1148`
- **Title**: Rows-mode falling edges leave departed identities in D9's current-drawn queue
- **Evidence**: `previewOrder` is cleared/reconciled only inside `previewFromVault`, but `project()` skips that function for `enrich:false`. `WorktreeHost` removes a detached surface or changes its level/visibility without requesting a clearing projection; `reconcileRowDrawing()` acts only on a rise where enrichment is owed. Therefore `[A,B,C]` with budget 1 can grant A and leave order `[B,C,A]`, enter presence-only/hidden/detached mode with no rows drawn, then reopen and grant B from the stale order instead of treating every returned id as a fresh arrival. A falling edge while an enriched projection is in flight is also not marked dirty, so that pass can populate the queue after the UI stopped drawing rows.
- **Impact**: D9 says the queue holds exactly what is drawn now and a row that stops being drawn re-enters as an arrival. The shipped queue instead retains pre-hide membership and priority across supported lifecycle paths, so next-turn selection depends on stale state from before the absence. The continuous-row fairness proof is valid inside consecutive enriched projections, but the accepted returning-row contract is not closed across the production lifecycle.
- **SuggestedFix**: Give the existing row-drawing lifecycle owner an explicit way to clear the projector's preview-turn state on every true-to-false `anyDrawingRows()` edge, including detach/dispose, and fence an enriched projection started before that edge so it cannot restore stale membership after completion. Alternatively, make a guaranteed `enrich:false` transition reconcile the queue to empty and ensure every falling edge requests it. Add a host/projector integration regression covering rows → presence/hide/detach → rows and a falling edge during an in-flight enriched projection.
- **Status**: open
- **Triage**: pending

### S1

- **ID**: S1-R3
- **Severity**: SUGGEST
- **Confidence**: MEDIUM
- **Priority**: P4
- **Agent**: `chair` (persists from round 3)
- **Class**: feature
- **File:line**: `src/worktree/presenceProjector.ts:176-179`; `src/worktree/presenceDeps.ts:39-42,98-100`
- **Title**: The two preview operations remain independently optional despite forming one capability
- **Evidence**: `previewFromVault` enables bounded preview enrichment when `sessionPreview` exists, while excluded rows independently call optional `sessionPreviewLine`. A caller supplying only the async operation type-checks but silently drops excluded rows' held lines. The sole production caller wires both operations correctly, so no current runtime path is broken.
- **Impact**: A future internal caller can violate the narrowed held-line contract without a compile-time failure.
- **SuggestedFix**: Represent preview enrichment as one optional capability object or a discriminated all-or-none type containing both `preview` and `line`.
- **Status**: open
- **Triage**: accepted in round 3; persists after `retain` removal

## Cross-round disposition

- **B1-R1**: fixed in its original form; the index cursor is gone.
- **B2-R1**: closed by the accepted D8 narrowing; exact retention beyond `cap` is no longer promised.
- **W1-R1**: fixed; excluded rows are synchronous and the permitted async array is bounded after production identity deduplication.
- **S1-R1**: fixed; tests pin the shipped default budget above and below 16.
- **B1-R3**: closed by the accepted D9 narrowing; fairness across absence is withdrawn.
- **B2-R3**: closed by the accepted D8 narrowing; exact declared-set retention is withdrawn.
- **W1-R3**: its service-retention half is retired by D8. Its queue-lifecycle half becomes B1-R4 because D9 newly makes current-drawn membership and fresh return explicit hard obligations; that contract delta is the evidence for the severity change.
- **S1-R3**: persists in reduced form: `retain` is gone, but `preview` and `line` are still one capability expressed as two independent optionals.

## Invariant inventory

- **Continuous-row fairness**: searched stable membership, arbitrary arrivals, arbitrary departures, shrinking sets, returning rows, duplicate pane claims, external claimed-session exclusion, and grant movement. For consecutive enriched projections, an always-drawn id's count ahead cannot grow and decreases by up to the budget until service; this portion of D9 is safe. Lifecycle absence is affected by B1-R4.
- **Current-drawn queue membership**: searched empty enriched projections, `enrich:false`, presence-only polling, hide, detach, reopen, host disposal, and a falling edge during an in-flight enriched projection. Empty enriched projections are safe; all host falling-edge paths are affected by B1-R4.
- **Held-line semantics**: searched held hits, never-held ids, cap overflow, outstanding looks, timeout, finalizer re-seat, generation mismatch, same-projection read order, and permitted-preview insertion. `line()` starts no work and synchronous excluded reads happen before permitted inserts; no defect found under the narrowed D8 contract.
- **One-projection work bound**: searched one/many worktrees, cadence hits, timeout, rejected reads, pane/external identity contention, and registry uniqueness. Production pane claims are settled to at most one entry id and the running-session reader deduplicates by session id, so at most `previewBudget` async preview invocations are started. The performance specialist's duplicate-row blocker was refuted by these upstream uniqueness boundaries.

## Inline support review

Changed tests contain no `.only` or `.skip`, and changed async calls are awaited. They cover concentrated/distributed rows, exact grant counts, the default 16, stable and changing enriched membership, fresh return after an enriched absence, synchronous no-work line reads, LRU touch, cap overflow, and outstanding-only exclusion. They do not cover `enrich:false`, rows/presence hide/detach transitions, or an in-flight enriched projection crossing a row-mode falling edge; that missing lifecycle coverage corresponds to B1-R4.

The narrowed delta spec, D8/D9, and task 3_1 honestly state that lines may be lost past `cap` and that fairness does not cross an absence. The stronger initial proposal wording is superseded explicitly by the approved decisions and delta spec rather than implemented accidentally.

## Recorded verification evidence

`bun run asm change verify-status bound-the-looks-one-projection-starts` records tasks 1_1, 1_2, 2_1, and 3_1 verified with exit 0 and records the two withdrawn tests as intentional task 3_1 test changes. The caller reports type check, 5,537 unit tests, the I10 gate, both esbuild bundles, and `biome check src` at the 0-error/14-warning baseline green. Per review policy, no typecheck, lint, bundle, or test command was rerun.

## Specialist results

- `asm-review-logic` — queue fairness, membership sequences, and host lifecycle — `gpt-5.6-sol[1M]` — B1-R4; confirmed the structural proof inside consecutive enriched projections.
- `asm-review-logic` — held/outstanding/deadline/finalizer state and same-projection eviction — `gpt-5.6-terra[1M]` — no finding.
- `asm-review-contracts` — D8/D9, seams, production wiring, artifacts, and tests — `sonnet[1M]` — no gating finding; confirmed production wires both preview operations.
- `asm-review-performance` — row/identity growth, fan-out, and bounds — `gpt-5.6-luna[1M]` — proposed a duplicate-row blocker, refuted because contested pane claims and the production running-session reader deduplicate entry ids before enrichment.
- `asm-finder` — full caller and rows/presence lifecycle trace — support only; confirmed `WorktreeHost` is the sole production caller and no hide/detach path resets projector state.

---

## Author triage — round 4

**[B1] Rows-mode falling edges leave departed identities in D9's current-drawn queue**
- **Status**: accepted
- **Triage**: Confirmed independently before triaging. `previewOrder` is reconciled only inside
  `previewFromVault`, which `project()` skips whenever `options.enrich === false`
  (`presenceProjector.ts:1145`). On the host side `reconcileRowDrawing`
  (`src/providers/WorktreeHost.ts:1442`) fires only on the RISING edge — `enrichmentOwed()` is
  `anyDrawingRows() && !projectedEnriched` — so nothing at all runs when the last row-drawing surface
  goes away. The queue therefore survives hide, detach and the drop to presence-only, and D9's rule
  that it holds exactly the ids drawn now is false across those edges.
- **NOT remediation, and I had this wrong.** I told the user round-3 W1 "disappears with the
  declaration it was about". It did not — removing `retain` moved the unowned lifecycle from the
  preview service's retained set to the projector's turn queue, and the falling edge still has no
  owner. This is the same gap the blueprint already carries as a deferred follow-up: "a single owned
  definition of 'the window gained its first row-drawing surface'"
  (260829-2117-separate-presence-subscription-from-view-visibility round-3 W1). Closing it needs a new
  seam on the projector and a falling-edge branch in the host, which is a `D#`, not a patch — so it
  goes back to plan rather than into a fix commit.
- Cycle 3's cap points the same way independently: option 1 is mandatory, and this is option 1.

**[S1] Preview operations remain independently optional despite forming one capability**
- **Status**: accepted
- **Triage**: Correct, and it is the round-1 S1 finding surviving a second restructuring —
  `sessionPreview` without `sessionPreviewLine` type-checks, enables bounded enrichment, and silently
  drops every excluded row's line. The pair is one capability. Folded into the same task as B1: they
  touch the same dep surface, so splitting them would put two leases on one file for one decision.

**[refuted, for the record]** The performance specialist messaged this session directly with a
BLOCK/HIGH claim of unbounded promise fan-out from duplicate `entryId` rows. I traced it independently
and rebutted it on the same grounds the chair reached: `settleContestedSessions`
(`presenceProjector.ts:319-352`) strips `entryId` from every sharing row but at most one strictly
strongest claimant — and from ALL of them when no claimant is strictly strongest — before
`rowsByWorktreeId` is built at `:1018`, which `previewFromVault` consumes at `:1147`. `asked` carries
unique ids by construction. Recorded here because the finding arrived outside the round file and would
otherwise leave no trace.

