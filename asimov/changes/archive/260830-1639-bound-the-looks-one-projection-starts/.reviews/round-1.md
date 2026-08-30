# Review Round 1: bound-the-looks-one-projection-starts

**Date**: 2026-08-30
**Cycle**: 1
**Mode**: discovery
**Requested execution mode**: fastlane
**Scope**: range `f07afcb1..317c54e7`
**Head**: `317c54e7cf3a547bd092b214416a216a64a709eb` (working tree dirty outside the reviewed range: untracked change analytics)
**Reviewable lines**: 117
**Agents spawned**: `asm-review-performance`, `asm-review-logic`, `asm-review-contracts`; support trace by `asm-finder`
**Agents skipped**: `asm-review-data-security` (no new authority, input, persistence, or path-resolution boundary), `asm-review-frontend` (no webview/UI code), `asm-review-reuse` (no added helper or duplicated repository capability)
**Verdict**: **BLOCK**
**Counts**: 2 BLOCK, 1 WARN, 1 SUGGEST
**Blocker split**: 2 feature / 0 machinery

## Scope and accepted obligations

Gate 2 is approved. The review applied D1-D4 and tasks 1_1/1_2: the projector owns a default budget of 16 independent of the preview cache cap; all rows with an `entryId` are asked in one projection-wide pass; excluded rows receive a cache-only answer without advancing lookup, retry, `gone`, or `confirmedAt` state; and grants rotate so no drawn row is excluded forever. The explicit range contains the two implementation commits only.

## Risk map

- Hot path: the growth axis is distinct pane and external-registry rows drawn by one window; it has no structural cap.
- Stateful fairness: one closure-level cursor must remain fair as rows appear, disappear, reorder, and return.
- Cache hot/cold paths: a cache-only ask must preserve held text, start no lookup/resolve/stat/read, and coexist with the service's independently capped LRU and outstanding maps.
- Async fan-out: the projector now starts one promise continuation per resolved row in one wave, while only a bounded subset may look.
- Internal contract seam: `SessionPreviewService`, `PresenceProjectorDeps`, `PresenceDepsOptions`, and production wiring must agree on `mayLook` and preserve old direct callers through the service default.

## Full-flow trace

- Entry: `WorktreeHost` serializes projection runs through its rebuild gate; callers join an active run or schedule one dirty rerun, so wired `project()` calls do not overlap.
- Identity and rows: pane rows are produced in pane order; contested duplicate entry ids are disowned; external rows are deduplicated by registry session id, suppressed when claimed by a pane, and sorted by row id.
- Contract translation: `presenceProjector.ts` supplies `(entryId, mayLook)` through `presenceDeps.ts` and `extension.ts` into `SessionPreviewService.preview`; direct service callers retain `mayLook = true`.
- Cache-only path: held/outstanding entries are touched and return their current line; never-held or evicted entries return `undefined`; no lookup, resolve, stat, read, retry-ladder, `gone`, or `confirmedAt` mutation occurs.
- Permitted path: a due row can perform entry lookup, path resolution, stat, and read behind the service's per-entry and total-outstanding bounds; cadence hits return held text; deadlines fail soft and preserve the held line.
- Output: each settled preview writes back to its projection-local worktree/index tuple; rejected preview promises are contained and leave the row without a new preview. `enrich:false` projections skip the title and preview passes; ordinary and external-replay enriched projections share the cursor.

## Findings

### B1

- **ID**: B1-R1
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic`, corroborated by `chair`
- **Class**: feature
- **File:line**: `src/worktree/presenceProjector.ts:546-551`
- **Title**: Index-based rotation can starve a persistent row when membership changes
- **Evidence**: `previewCursor` is an array index interpreted modulo the current `asked.length`, not a stable row identity. With budget 1, two stable `[A,B,C]` projections grant A then B. If later projections alternate `[A,C]` and `[A,B,C]`, the cursor repeatedly grants A then B; persistent row C is cache-only forever. Pane and registry rows legitimately appear, disappear, and return. The implementation also advances by `permitted` rather than the accepted budget, so a sub-budget projection can reset progress before a larger set returns.
- **Impact**: Violates the accepted requirement that no drawn row is excluded on every projection while others are looked at repeatedly; C's preview can remain indefinitely stale.
- **SuggestedFix**: Track fair rotation by stable row identity, reconciling arrivals and removals before selecting the next budget slice. Add membership-change regressions, including alternating `[A,B,C]`/`[A,C]` and large/small/large sets.
- **Status**: open
- **Triage**: pending

### B2

- **ID**: B2-R1
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `chair`
- **Class**: feature
- **File:line**: `src/worktree/sessionPreviewService.ts:420-431`
- **Title**: Active rows beyond the cache cap lose their held line while excluded
- **Evidence**: Cache-only asks can return only entries still present in the capped `held`/`outstanding` maps. The drawn-row growth axis is uncapped, while `cap` defaults to 256. A targeted cap-2/budget-1 probe with three continuously drawn sessions produced all three lines on projection 3, then projection 4 permitted `s0`; its insertion evicted held `s1` before `s1`'s cache-only ask, which returned `undefined`. The same behavior begins at 257 production rows. Touching every excluded row cannot retain more active lines than the cap.
- **Impact**: A row excluded by the projection budget can lose the exact line it last presented, contradicting D3 and the accepted scenario. The projector holds no previous rows from which to restore it.
- **SuggestedFix**: Preserve last-preview text for the active projection set independently of the history/look-state LRU, or establish and enforce a structural active-row bound no greater than the cache cap. Add an integrated regression with `cap + 1` continuously drawn rows and verify every excluded row keeps its prior line across a full rotation.
- **Status**: open
- **Triage**: pending

### W1

- **ID**: W1-R1
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-performance`
- **Class**: feature
- **File:line**: `src/worktree/presenceProjector.ts:553-560`
- **Title**: Projection-wide promise fan-out remains unbounded by the look budget
- **Evidence**: `Promise.all(asked.map(...))` allocates and starts one async invocation and continuation per row, including cache-only exclusions. The row axis has no structural cap, so 1,000 rows create 1,000 simultaneous preview promises although only 16 may look. For rows spread across worktrees, this increases peak fan-out from one worktree's wave to the whole projection.
- **Impact**: Large windows can impose unbounded transient allocation and microtask pressure on the extension-host projection hot path; the service's cache/outstanding cap does not bound cache-only calls.
- **SuggestedFix**: Bound asynchronous cache-only processing as well as I/O, for example with a synchronous/bulk cache peek-touch seam or bounded batches, while preserving one projection-wide budget.
- **Status**: open
- **Triage**: pending

### S1

- **ID**: S1-R1
- **Severity**: SUGGEST
- **Confidence**: MEDIUM
- **Priority**: P4
- **Agent**: `asm-review-contracts`
- **Class**: feature
- **File:line**: `src/worktree/presenceProjector.test.ts:2207-2296`
- **Title**: The production default budget path is not pinned by a test
- **Evidence**: Every new projector case injects `previewBudget` as 1, 2, or 3; none omits the override and asserts the production default of 16 or the stated unchanged behavior for an ordinary window.
- **Impact**: A regression in the default constant or defaulting seam could pass while all explicit-budget tests remain green.
- **SuggestedFix**: Add a no-override case proving at most 16 grants and that a projection with 16 or fewer rows grants all of them.
- **Status**: open
- **Triage**: pending; downgraded from WARN because no behavioral defect was found in the current defaulting path

## Invariant inventory

- **Fair grant rotation**: searched stable rows, membership removal/re-entry, wraparound, external replay, and non-enriching projections. Stable membership and wraparound are safe; changing membership is affected by B1; `enrich:false` correctly spends no grants.
- **Excluded rows keep held text without work**: searched cache hot, never-held, outstanding, overdue, `gone`, eviction, and lookup/stat/read boundaries. Hot/outstanding/state-inert paths are safe; never-held is intentionally blank; eviction of still-active rows is affected by B2.
- **One projection bounds transcript work**: searched one/many worktrees, pane/external rows, duplicate entry ids, service cadence, outstanding work, and rejected promises. Duplicate ids are removed before enrichment and actual look permissions remain bounded; asynchronous cache-only fan-out is W1.

## Inline support review

Changed tests contain no `.only` or `.skip`, and their async calls are awaited. The cache-only tests cover held text, zero store/stat/read work, WT-011.5 re-confirmation inertness, LRU touch, and never-held non-insertion. The projection tests cover concentrated and distributed rows, preview write-back, and stable-set rotation, but not changing membership, `cap + 1` active retention, or the production default.

## Recorded verification evidence

`bun run asm change verify-status bound-the-looks-one-projection-starts` records tasks 1_1 and 1_2 verified with exit 0 and scope-aware focused-test changes. The caller additionally reports type check, `biome check src` at the 0-error/14-warning baseline, 5530 unit tests, the I10 gate, and both esbuild bundles green. Per review policy, no verify command or test suite was rerun; only targeted disposable probes were used to validate B1 and B2.

## Specialist results

- `asm-review-performance` — projection row growth, one-wave fan-out, and work bounds — `gpt-5.6-sol[1M]` — W1.
- `asm-review-logic` — cache state, cursor arithmetic, membership changes, async write-back — `gpt-5.6-terra[1M]` — B1.
- `asm-review-contracts` — widened seams, D1-D4 obligations, and tests — `sonnet[1M]` — S1 after adjudication.

---

## Author triage

### B1 — **AuthorStatus**: accepted (remediation)

**AuthorTriage**: Confirmed by tracing the cursor, not by trusting the report. Budget 1 over
`[A,B,C]` grants A (cursor 0→1) then B (1→2); the next projection drawing `[A,C]` computes
`2 % 2 = 0` and grants A again, leaving the cursor at 1 so the following `[A,B,C]` grants B. C is
never reached, and the pattern repeats. Rows genuinely come and go — a pane closes, a registry
session ends — so this is not a contrived membership sequence.

The second half of the finding is also right and is the root of it: advancing by `permitted` rather
than by the budget means a small projection moves the cursor a small distance, so an index into a
list whose length changes is not a position in any stable order. D4 promised rotation over rows and
I implemented rotation over indices. Fixing it needs rotation by row identity, which is a mechanism
change inside D4 rather than a change to it.

### B2 — **AuthorStatus**: accepted, and NOT remediation — handed back

**AuthorTriage**: Confirmed structurally. `held` is bounded by `cap` (256) and `touch` evicts past
it, while the number of rows a window draws has no bound at all. Past `cap` rows, a permitted look
inserts and evicts a row whose line a cache-only ask was about to return — so the excluded row loses
exactly the line D3 promised it would keep. Before this change that row would have looked and got
its line back, at the cost of the I/O this task exists to remove; so the regression is real and this
diff introduces it.

It fails the obligation test. Every fix moves an accepted artifact:

- Retaining preview text for the drawn set independently of the look-state LRU mints a second store
  with its own lifetime and eviction — a new invariant owner.
- Bounding the drawn row set changes what the presence projection is allowed to present.
- Leaving it and qualifying the promise changes the spec requirement "A row the bound excludes keeps
  its line", which was accepted at Gate 2.

So this is parked rather than patched. Landing a fix for it as a remediation commit would close the
cycle as superseded and burn a round for a decision that belongs to planning.

### W1 — **AuthorStatus**: accepted, folded into the handback

**AuthorTriage**: Correct as stated — `Promise.all` over every row allocates one async invocation
per row whether or not it may look, so the bound covers I/O and not the fan-out itself. It is not
independently gating, and it shares a seam with B2: a synchronous peek-and-touch for excluded rows
would answer both. Planning them together is what keeps them one decision rather than two patches.

### S1 — **AuthorStatus**: accepted, folded into the handback

**AuthorTriage**: True — every case injects a budget of 1, 2 or 3, so `DEFAULT_PROJECTION_LOOK_BUDGET`
is only ever exercised transitively. Cheap to cover and worth covering, since 16 is the value that
actually ships.
