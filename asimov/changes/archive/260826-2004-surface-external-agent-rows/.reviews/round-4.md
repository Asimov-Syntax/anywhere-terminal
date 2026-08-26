# Review Round 4

- Date: 2026-08-27
- Cycle: 2
- Mode: discovery
- Scope: working tree
- Reviewable lines: 596
- Large change: no
- Agents spawned:
  - asm-review-logic — D11 generation coordination and full-flow races — gpt-5.6-sol[1M]
  - asm-review-contracts — D11/D12 contracts and prior D1-D8 obligations — gpt-5.6-terra[1M]
  - asm-review-performance — rank revisions, hot path, and growth axes — sonnet[1M]
  - asm-review-data-security — registry trust and semantic validation — gpt-5.6-terra[1M]
  - asm-review-reuse — acknowledgment model and conversion reuse — gpt-5.6-luna[1M]
- Agents skipped:
  - asm-review-frontend — no frontend/rendering code changed
- Verdict: WARN
- Open counts: 0 BLOCK, 4 WARN, 1 SUGGEST
- Dispositions: cycle-1 B1/B3 fixed by D11/D12; all other prior fixed findings remain fixed; S1 carried; 4 new WARN
- Verification observed:
  - Focused changed suites: 6 files / 211 tests passed
  - `pnpm run check-types`: passed
  - `pnpm run test:unit`: 193 files / 3710 tests passed
  - Biome on 12 changed source/test files: clean, no fixes applied
  - `git diff --check`: passed

## Findings

### W3

- ID: W3
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair; asm-review-contracts
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:474`
- Title: A cache reorder turns the next external-only poll into a full pane projection
- Evidence: D6 permits full fallback when worktree membership changes. `sameTree()` instead requires equal ids in equal order. `lastWindowPass.worktreeIds` is captured before `WorktreeHost.commit()` can reorder the cache by a new rank revision; the next poll receives the same ids in presentation order and fails the positional comparison, falling through to `projectPanes()` at line 514. Existing tests cover membership gain but not a pure permutation.
- Impact: Every presence rank change causes the following five-second poll to resolve panes and potentially invoke the process table, violating the external-only hot-path contract D6 was introduced to preserve.
- SuggestedFix: Compare membership independently of presentation order using equal-size set membership, or store/compare a canonical sorted membership key. Add a test where the same worktree ids are permuted and assert that external mode resolves no pane.
- Status: open
- Triage: untriaged

- Status (author, round 4): accepted
- Triage (author, round 4): Correct and self-inflicted by D12. The host feeds `project()` the ids in CACHE order, and `reorder` is precisely what changes that order without changing membership, so the first poll after every ranking change rejects its own replay and does the pane work D6 exists to avoid. Membership is what the replay guard actually cares about.

### W4

- ID: W4
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair; asm-review-data-security
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/runningSessions.ts:171`
- Title: Unsafe session IDs are admitted from the external registry
- Evidence: The reader accepts any non-empty string, while the repository's canonical `isSafeSessionId()` at `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/claudePaths.ts:51` rejects traversal, separators, control characters, and other non-filename-safe ids before transcript resolution. The new external-row path uses the unchecked value in `entryId` and `rowId`, presenting a live-PID record as a Claude session even though the same id cannot safely name a Claude transcript.
- Impact: A malformed registry record can fabricate a trustworthy-looking external row and an entry handle that downstream Claude session readers must reject.
- SuggestedFix: Require `isSafeSessionId(sessionId)` during registry validation and add traversal, separator, and control-character negative tests.
- Status: open
- Triage: untriaged

- Status (author, round 4): accepted
- Triage (author, round 4): `isSafeSessionId` is the canonical guard and this reader ignores it. "Non-empty" was the wrong bar: this id becomes an `entryId` and a row identity, and every downstream Claude reader resolves transcripts by it.

### W5

- ID: W5
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-data-security; chair
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/runningSessions.ts:186`
- Title: Registry timestamps can be non-finite or negative
- Evidence: `typeof parsed.startedAt === "number"` accepts JSON overflow such as `1e999`, which `JSON.parse` materializes as `Infinity`, and accepts negative values. The external projector copies this value into row timestamps and its worktree rank.
- Impact: One malformed live-PID record can pin a worktree ahead of legitimate activity, produce invalid UI time data, and keep that ordering for the life of the process.
- SuggestedFix: Carry `startedAt` only when `Number.isFinite(value)` and `value >= 0`; otherwise omit it and use the existing first-seen fallback. Add overflow and negative-value tests.
- Status: open
- Triage: untriaged

- Status (author, round 4): accepted
- Triage (author, round 4): `typeof x === "number"` admits `Infinity` and negatives, and `startedAt` feeds both ordering and published timestamps. The first-seen fallback already exists for records with no launch time, so a rejected value has somewhere honest to land.

### W6

- ID: W6
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-reuse
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/TerminalEditorProvider.ts:775`
- Title: Registry outcome-to-index fallback is duplicated across three adapters
- Evidence: `TerminalEditorProvider` lines 775-778 and `TerminalViewProvider` lines 804-807 contain identical read/ok/empty-index conversion. `presenceDeps` repeats the same outcome-to-index rule at `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceDeps.ts:68-69` while retaining the outcome for richer presence failure handling.
- Impact: A future registry outcome or fallback change can make editor, view, and worktree-presence identity resolution disagree. The conversion belongs with the outcome/index definitions, not three callers.
- SuggestedFix: Add a clearly named shared helper such as `indexRunningOutcomeOrEmpty(outcome)` in `runningSessions.ts`; use it in both providers and in `presenceDeps` while continuing to retain `registryRead` for typed failure propagation.
- Status: open
- Triage: untriaged

- Status (author, round 4): accepted
- Triage (author, round 4): Three copies of the same outcome-to-index conversion, and the two providers are exactly the surfaces that must agree about identity. `presenceDeps` keeps the whole outcome — D7 needs the failure — and uses the helper only where it builds the index.

### S1

- ID: S1
- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P4
- Agent: chair; asm-review-performance
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:353`
- Title: External attribution scans every worktree root for each unclaimed registry session
- Evidence: Every external poll iterates unclaimed indexed sessions and linearly scans all current worktree roots through `attribute`, for S x W prefix checks. The mechanism and evidence are unchanged from cycle 1.
- Impact: Poll cost grows multiplicatively with unclaimed live sessions and worktree roots.
- SuggestedFix: Keep as a measured follow-up; introduce a segment-aware longest-prefix index or enforced bound only when observed counts justify it.
- Status: persists from round 1; non-gating
- Triage: carried forward, never re-reported as new

## Prior finding dispositions

- Status (author, round 4): rejected — sustained across four rounds
- Triage (author, round 4): Unchanged and non-gating. No measurement supports escalation; the growth axis stays recorded rather than silently dropped.

### B1
- ID: B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-logic
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:315`
- Title: Pane evidence can be retired by a pass that did not read it
- Evidence: D11 now uses producer generation `paneEvidence` and consumer marker `paneEvidenceApplied`. Every full iteration captures the generation before `projectOnce`; only a clean, uninvalidated full pass raises the applied marker to the captured value. Evidence arriving during the pass remains greater than the capture, and the exact round-3 interleaving test keeps the next scan in full mode.
- Impact: The lost-pane-evidence invariant is repaired across failure, invalidation, late-event, cap, and external-only boundaries.
- SuggestedFix: None.
- Status: fixed in cycle 2
- Triage: verified by chair and logic specialist

### B2
- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-logic
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:507`
- Title: Registry recovery remained degraded
- Evidence: Registry replay exclusion and current-read ownership remain intact.
- Impact: Recovery remains truthful.
- SuggestedFix: None.
- Status: fixed in round 2; remains fixed
- Triage: no regression

### B3
- ID: B3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-performance; asm-review-contracts
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:233`
- Title: Discarded projections consumed rank movement before cache application
- Evidence: D12 replaces per-projection movement with monotonic `rankRevision()` and cache-owned `appliedRankRevision`. The marker advances only after cache-wide `reorder`; partial, whole, and degraded cache writes acknowledge nothing. A discarded projection therefore leaves a revision mismatch until the cache applies it.
- Impact: Presence rank and cached ordering remain consistent through invalidated projections and partial/degraded rebuilds.
- SuggestedFix: None.
- Status: fixed in cycle 2
- Triage: verified by chair, contracts, and performance specialists

### W1
- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair; asm-review-data-security
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/runningSessions.ts:168`
- Title: Filename/payload pid mismatch fabricated external ownership
- Evidence: Numeric filename stem equality, absolute cwd, and non-empty id guards remain.
- Impact: Prior malformed-PID path remains closed.
- SuggestedFix: None.
- Status: fixed; W4/W5 are distinct remaining semantic-validation boundaries
- Triage: no regression

### W2
- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair; asm-review-performance
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:233`
- Title: Unchanged polls reordered every cached worktree
- Evidence: `commit()` reorders only when projector revision differs from cache-applied revision.
- Impact: No-change polls avoid cache copies and sorting.
- SuggestedFix: None.
- Status: fixed; remains fixed under D12
- Triage: no regression

### S2
- ID: S2
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair; asm-review-reuse
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:136`
- Title: External row identity was constructed in two places
- Evidence: `externalRowId(sessionId)` remains the sole key owner.
- Impact: Key drift remains prevented.
- SuggestedFix: None.
- Status: fixed; remains fixed
- Triage: no regression

## Full-flow trace

- Pane flow: pane event increments producer generation -> cap/rebuild/scan requests a full pass while generation differs -> iteration captures generation before reading panes -> resolves every pane, including unattributable panes -> appends unclaimed external rows -> clean uninvalidated completion raises only the captured applied generation -> later events stay outstanding.
- External flow: visible surface timer -> external-only request when pane generations match -> replay last full window rows/claims/pane degradation -> current indexed registry read -> retained sessions on failure or current sessions on success -> rank revision changes only when the rank map changes.
- Ordering flow: projector revision is producer-owned -> cache-wide applied marker remains behind through discarded projections and all cache writes -> successful version-matched commit globally reorders on mismatch -> only then acknowledges the revision -> publishes tree and presence together.
- Failure flow: projection rejection advances no pane applied marker; registry failure retains proven pane identity and last indexed external sessions while naming the source; tree-version invalidation forces a full rerun and acknowledges neither pane evidence nor cache ordering.
- Remaining cross-flow defect: W3 uses presentation order as replay identity, so the ordering flow can unnecessarily force the next external flow through the pane path.

## Adjudication notes

- Cycle-1 B1 and B3 were independently re-proven against D11/D12 and are fixed; planning prose was not treated as evidence by itself.
- S1 is carried exactly once as prior non-gating context.
- The data-security findings are distinct from fixed W1: W1 proved filename/PID/cwd/non-empty identity; W4 addresses canonical session identity and W5 addresses timestamp-domain validity.
- The reuse finding is retained as WARN because the same compatibility conversion now has three independently maintained call sites.
- The logic specialist recommended escalating carried S1 to BLOCK from the same nested-loop evidence. The chair retains SUGGEST: severity stability forbids escalation without a changed impact, likelihood, reachability, or contract, and cycle 2 adds none for this unchanged mechanism.
