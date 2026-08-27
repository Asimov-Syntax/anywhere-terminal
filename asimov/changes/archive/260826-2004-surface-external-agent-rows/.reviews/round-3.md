# Review Round 3

- Date: 2026-08-27
- Cycle: 1
- Mode: verification
- Scope: remediation since round 2, prior findings, and declared B1/W1/W2 impact cones
- Scope lock: passed — changes are limited to durable pane-evidence tracking, PID-record validation, rank-delta optimization, and their tests
- Reviewable lines: 62
- Agents spawned:
  - asm-review-logic — B1 pane-evidence lifetime and scheduling/error boundaries — gpt-5.6-sol[1M]
  - asm-review-performance — W2 rank-delta/cache-order correctness — gpt-5.6-terra[1M]
  - asm-review-data-security — W1 PID-record semantic validation — sonnet[1M]
- Agents skipped:
  - asm-review-contracts — contracts unchanged; D8 is verified in the performance impact cone
  - asm-review-frontend — no frontend code in the remediation cone
  - asm-review-reuse — no unresolved reuse finding in the cone
- Verdict: BLOCK
- Open counts: 2 BLOCK, 0 WARN, 1 SUGGEST
- Dispositions: 4 fixed, 2 persist, 1 new, 0 audit-backlog, 0 accepted risk
- Verification observed:
  - Impact-cone suites: 3 files / 145 tests passed
  - `pnpm run check-types`: passed
  - `pnpm run test:unit`: 193 files / 3707 tests passed
  - Biome on six remediation files: clean, no fixes applied
  - `git diff --check`: passed
- Cycle limit: round 3 is the final round of cycle 1

## Findings

### B1

- ID: B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-logic
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:310`
- Title: A completed full pass can clear pane evidence that arrived after it read panes
- Evidence: `onPaneChange()` sets `paneEvidencePending` but does not invalidate an in-flight projection until the 150 ms cap fires. The reachable ordering is: (1) a full projection has already read panes; (2) a pane event sets the flag and arms the cap; (3) the full projection completes before the cap, with `projectionDirty === false`, so line 300 records `consumedPanes` and lines 310-311 clear the flag; (4) the external scan fires before the cap, cancels it at lines 391-393, sees the cleared flag, and requests external-only at line 395. The event neither dirtied the pass that missed it nor survived as pending evidence. The new tests advance the cap before releasing the in-flight projection, so they do not cover this boundary.
- Impact: Pane identity, activity, cwd, closure, claimed-session, or rank changes can remain stale indefinitely while later scans continue external-only replay.
- SuggestedFix: Replace the boolean-consumption inference with a pane-evidence generation. Capture the generation when a full iteration begins and clear only through that captured generation when the iteration completes cleanly and the generation is still current. Alternatively, immediately dirty an in-flight projection from `onPaneChange` while retaining the cap for idle-run debounce. Add the exact regression sequence: full pass parked after pane read -> pane event without firing cap -> release full pass -> scan fires before cap -> verify full mode.
- Status: persists from round 1
- Triage: The round-3 fix closes failure retention, external-only behavior, and tree-version invalidation, but the same invariant remains broken when late pane evidence arrives during a full pass. The boundary inventory has expanded in every verification round, so patch-level coordination fixes have failed.
- Boundary inventory:
  - Affected: pane event after an in-flight full pass read panes, clean completion before cap, then scan before cap
  - Verified safe: cap cancellation while flag remains set; projection rejection; tree-version invalidation; external-only completion; repeated pane events whose cap fires before completion; clean full consumption with no later event

- Status (author, round 3): accepted
- Triage (author, round 3): Sustained and reachable. `paneEvidencePending` records that evidence EXISTS, not that a given pass saw it, so a pane event landing while `projector.project()` is already awaiting its own pane read is indistinguishable from one that arrived before it. `projectionDirty` does not close the gap: the cap has not fired yet, so nothing marks the run. The window is real — a pane event inside the 150 ms before a scan tick, with a full pass resolving in between — and the cap is cancelled by that scan, so the evidence is lost until an unrelated pane event. A boolean cannot express "seen by which pass"; that is what the generation counter fixes.

### B2

- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-logic
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:501`
- Title: Successful external scans cannot clear a prior registry degradation
- Evidence: The current registry result owns its degradation entry; replay excludes `registry`, successful recovery clears it, current failure restores it, and unchecked pane degradation remains retained.
- Impact: The stale-registry recovery defect remains removed.
- SuggestedFix: None.
- Status: fixed in round 2; remains fixed
- Triage: No remediation in round 3 intersects or regresses this behavior.

### W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair; asm-review-data-security
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/runningSessions.ts:168`
- Title: Filename/payload pid mismatch lets a malformed record fabricate a live external row
- Evidence: The per-file loop now requires the numeric filename stem to equal the parsed payload pid before field validation, liveness, or indexing. Numeric filenames are pre-guarded; nonnumeric/NaN payloads cannot pass equality. Tests cover mismatching and agreeing stems, empty ids, relative cwd, dead pid, malformed JSON, nonnumeric names, and list-valued duplicate-pid indexing.
- Impact: The fabricated-live-record path is removed without weakening deterministic byPid candidate handling.
- SuggestedFix: None.
- Status: fixed
- Triage: Verified at every W1 boundary; the list-valued index remains defense in depth.

### W2

- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair; asm-review-performance
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:219`
- Title: Every unchanged external poll copies and re-sorts all cached worktrees
- Evidence: The projector now compares its freshly built and retained rank maps, and unchanged successful polls report `ranksMoved() === false`. The host skips `cache.reorder` in that case. Direct tests cover rank gain, loss, advancing timestamp, unchanged reproduction, and no rank lookups on an unchanged host poll.
- Impact: The repeated no-change cache copy/sort cost is removed.
- SuggestedFix: None for the original performance finding; B3 records the correctness regression introduced by this optimization.
- Status: fixed
- Triage: Original W2 mechanism is fixed. Do not merge B3 into W2 because B3 has a different causal mechanism and materially different correctness impact.

### B3

- ID: B3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-performance
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:554`
- Title: An invalidated projection can consume the rank delta before the cache receives it
- Evidence: `ranksMoved()` compares `nextRanks` with the projector's immediately previous internal `ranks`, not with the ranking used to assemble the current cache. Reachable sequence: (1) external projection starts on tree v1 with rank A; (2) rebuild assembles cache v2 using A; (3) the v1 projection produces rank B and updates the projector, but `WorktreeHost.projectOnce` rejects it because `treeVersion` moved; (4) the dirty full rerun on v2 reproduces B, so `sameRanking(B, B)` sets `ranksChanged` false; (5) `commit()` skips `cache.reorder`, leaving cache v2 ordered by A while publishing presence ranked by B. Later unchanged polls also report false, so the mismatch can persist indefinitely. Tests cover direct deltas but not an invalidated rank-changing pass followed by a same-rank accepted rerun.
- Impact: A successful envelope can publish presence and worktree order that disagree, directly violating D8. A worktree that gained or lost live activity may remain in the wrong position until another rank change or rebuild.
- SuggestedFix: Track a monotonic ranking revision or sticky pending-rank delta that is acknowledged only when cache assembly/reorder has applied it. Do not consume movement merely because an uncommitted projection updated the projector baseline. Add the v1 projection -> v2 rebuild with old rank -> invalidation -> same-rank full rerun interleaving test.
- Status: new in round 3
- Triage: Admissible inside W2's behavioral impact cone. It is a different mechanism and correctness impact, so it receives a new ID and BLOCK severity.
- Boundary inventory:
  - Affected: rank-changing projection invalidated after a cache rebuild assembled with the prior rank, followed by an accepted same-rank rerun
  - Verified safe: direct rank gain; direct rank loss; timestamp advance; unchanged poll; rebuild with no concurrent rank-changing projection

- Status (author, round 3): accepted
- Triage (author, round 3): Correct, and the mechanism is mine. `ranksMoved()` answers "did this projection differ from the projector's previous projection", which is not the question `commit()` asks — that one is "does the cache's ordering still match the ranking we are about to publish". A projection whose result the host discarded on the tree-version guard still advances the projector's retained `ranks`, so the delta is consumed by a pass that never reached the cache, and the identical rerun then reports no movement against a cache assembled from the older rank. Same class as B1: a producer retiring state without an acknowledgement from the consumer that actually applies it.

### S1

- ID: S1
- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P4
- Agent: chair; asm-review-performance
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:347`
- Title: External attribution scans every worktree root for each unclaimed registry session
- Evidence: The S x W prefix-scan mechanism is unchanged in round 3. No measurement demonstrates user-visible cost and no structural cap was added.
- Impact: Poll cost remains multiplicative in unclaimed live sessions and current worktree roots.
- SuggestedFix: Keep as recorded follow-up until measurement warrants a segment-aware longest-prefix index or enforced bound.
- Status: persists from round 1; non-gating
- Triage: Severity remains stable and the finding stays visible rather than being re-reported as new.

- Status (author, round 3): rejected — sustained by the chair across all three rounds
- Triage (author, round 3): Unchanged and non-gating; carried into cycle 2 as a measured-follow-up candidate, with the growth axis recorded in round 2.

### S2

- ID: S2
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair; asm-review-reuse
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:120`
- Title: External row identity is constructed in two places
- Evidence: `externalRowId(sessionId)` remains the sole row/eviction key owner.
- Impact: The key-drift risk remains removed.
- SuggestedFix: None.
- Status: fixed in round 2; remains fixed
- Triage: No round-3 change regresses it.

## Cycle disposition

Cycle 1 has reached its three-round maximum with B1 still open and B3 newly exposed inside W2's fix cone. B1's invariant inventory expanded in both verification rounds, which is evidence that patch-level coordination changes are not converging. Hand the scheduling/rank-publication model back to planning before further implementation. The next user-initiated review must start cycle 2 in discovery mode (global round 4) and carry B1, B3, and non-gating S1 forward.
