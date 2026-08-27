# Review Round 2

- Date: 2026-08-27
- Cycle: 1
- Mode: verification
- Scope: remediation since round 1, prior findings, rebuttals, and declared impact cone
- Scope lock: passed — source changes are limited to B1/B2/W1/S2 remediation plus tests and rebuttal instrumentation; no new capability or contract change
- Reviewable lines: 25
- Agents spawned:
  - asm-review-logic — B1 scheduling/failure cone and B2 degradation recovery — gpt-5.6-sol[1M]
  - asm-review-data-security — W1 semantic validation and filename/payload rebuttal — sonnet[1M]
  - asm-review-performance — W2/S1 polling-cost rebuttals — gpt-5.6-terra[1M]
- Agents skipped:
  - asm-review-contracts — approved contracts unchanged; logic verification covers the B1/B2 behavioral boundaries
  - asm-review-frontend — no frontend/rendering code in the remediation cone
  - asm-review-reuse — S2 is a local helper extraction verified directly by the chair
- Verdict: BLOCK
- Open counts: 1 BLOCK, 2 WARN, 1 SUGGEST
- Dispositions: 2 fixed, 4 persist, 0 audit-backlog, 0 accepted risk
- Verification observed:
  - Impact-cone suites: 3 files / 136 tests passed
  - `pnpm run check-types`: passed
  - `pnpm run test:unit`: 193 files / 3698 tests passed
  - Biome on six remediation files: clean, no fixes applied
  - Comparator trace: the author's ordered three-worktree fixture performs 3 rank lookups; differently ordered and larger groups perform more, so that one measurement is not a general bound

## Findings

### B1

- ID: B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-logic
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:372`
- Title: Failed absorbed projection still permanently loses its pane evidence
- Evidence: The successful-path fix is correct: a scan with `capHandle` set requests a full projection, and non-join callers arriving during a run set `projectionDirty` and clear `nextExternalOnly`. The failure boundary still violates the same invariant. `armScan` cancels and clears the only cap marker at lines 372-377 before the full projection succeeds. `requestProjection` clears the transient dirty/mode state before awaiting at lines 281-284; if that projection throws, lines 286-304 only retry when a different caller happened to set `projectionDirty`. With no concurrent caller, no state records that the absorbed pane evidence remains unprojected, and the next poll requests external-only replay.
- Impact: A pane identity, activity, cwd, closure, claimed session, or rank update can remain stale indefinitely after one projection exception; subsequent successful polls can publish that stale pane pass with fresh external data.
- SuggestedFix: Keep a durable pending-full/pane-evidence flag from the pane event until a full projection succeeds against the current tree. A failed absorbed projection must leave the flag set so the next scheduled opportunity runs full mode, without requiring an immediate retry loop. Add a test: cap pending -> scan absorbs it -> full projection rejects -> next scan is full, not external-only.
- Status: persists from round 1
- Triage: The accepted fix closes successful cap absorption and in-flight dirty reruns, but B1's invariant remains broken on the projection-failure boundary. Same causal mechanism and impact; severity remains BLOCK.
- Boundary inventory:
  - Affected: absorbed cap followed by rejection of its full projection
  - Verified safe: absorbed cap with successful projection; pane evidence arriving during external-only; no-cap poll joining an in-flight run; poll lifecycle and disposal; tree-version commit guard
- Status (author, round 2): accepted
- Triage (author, round 2): Sustained and correct. Cancelling the cap is an irreversible commitment made before the work it commits to has succeeded; the `catch` path re-runs only when someone else set `projectionDirty`, so a rejection strands the evidence and the next poll goes back to external-only. Fixing with a durable flag set at the pane event and cleared only when a FULL projection completes cleanly, so a rejection leaves the next scan in full mode.

### B2

- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-logic
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:489`
- Title: Successful external scans cannot clear a prior registry degradation
- Evidence: External replay now copies only failures whose source is not `registry`. The current `snapshot.sessions()` result therefore exclusively owns the registry entry: failure adds it at lines 499-505, while success leaves it absent. Tests couple failed registry lookup and failed session enumeration, then verify external-only recovery; they also verify current registry failure and retained unchecked pane degradation.
- Impact: The stale-registry recovery defect is removed without falsely healing the process-table source.
- SuggestedFix: None.
- Status: fixed
- Triage: Verified across registry hot/recovered/failed paths and the pane-degradation replay boundary.

### W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair; asm-review-data-security
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/runningSessions.ts:171`
- Title: Filename/payload pid mismatch still lets a malformed record fabricate a live external row
- Evidence: The new guard correctly rejects an empty `sessionId` and a non-absolute `cwd` before liveness and indexing, with direct negative tests. The reader still accepts any numeric filename and never compares its stem with the parsed payload pid. It liveness-probes only that payload pid, so `<other>.json` can claim an unrelated live pid, non-empty session id, and absolute cwd, then reach the external-row path. The rebuttal does not establish a legitimate conflicting record: the measured writer contract names the file `${process.pid}.json` and writes `pid: process.pid`. Archived W4's duplicate-pid case exists only because mismatched records were admitted; rejecting the malformed candidate removes the collision rather than choosing one by enumeration order. Keeping `byPid` as a list remains compatible as defense in depth.
- Impact: Registry corruption, legacy drift, or hand-edited local state can still publish a fabricated running row, win session-id deduplication, and raise a real worktree's activity rank.
- SuggestedFix: Parse the numeric filename stem and require it to equal the payload pid before liveness/indexing. Add a test where `77777.json` carries another live test pid and verify it is rejected. Keep the list-valued `byPid` index.
- Status: persists from round 1; partially fixed
- Triage: Empty-id and relative-cwd boundaries are fixed. The filename-stem rebuttal is rejected by the writer contract and the absence of any current invariant preventing mismatched live-pid impersonation.
- Boundary inventory:
  - Affected: filename stem differs from payload pid while payload pid is alive
  - Verified safe: empty session id; relative cwd; dead payload pid; malformed JSON; nonnumeric filename; duplicate-pid index remains deterministic
- Status (author, round 2): accepted — see B2 note (the chair numbers this finding B2 in the round-2 file and W1 in its report).

### W2

- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair; asm-review-performance
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:209`
- Title: Every unchanged external poll still copies and re-sorts all cached worktrees
- Evidence: Every successful projection still calls `cache.reorder`, whose implementation copies and sorts each cached repository's full worktree array. Three rank lookups are correct for the author's particular already-ordered three-worktree fixture, but do not price array allocation, comparator work, active-rank rereads, differently ordered groups, or larger groups. The retained `rankLookups` counter is not asserted by any test. A lower-cost guard need not allocate rank keys or call `rank` once per worktree: the projector already owns both `nextRanks` and the retained `ranks` map and can compare their entries before replacement.
- Impact: A no-change five-second scan repeatedly performs full cache array copies and ordering work for total cached worktrees W while the view remains shown.
- SuggestedFix: Have the projector expose whether its already-built rank map changed, then call `cache.reorder` only on rank deltas. Preserve D8 by reranking whenever the rank set or values change.
- Status: persists from round 1
- Triage: Author rebuttal rejected. The three-lookup measurement is valid for one fixture but does not refute the full recompute or general growth axis; the proposed cache-side allocation is also not the only possible guard.

- Status (author, round 2): accepted — rebuttal withdrawn
- Triage (author, round 2): OVERRULED on the measurement, and the chair's alternative is better than the one I priced. I measured rank lookups on a single already-ordered three-worktree fixture and generalised from it; that bounds neither the array copy, the comparator work, nor a group that is out of order. More to the point, the guard I costed (a rank-key string per commit) is not the only one available: the projector already holds both `nextRanks` and the retained `ranks`, so it can report whether the ranking moved for free, and the host reranks only on a delta. Implementing that.

### S1

- ID: S1
- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P4
- Agent: chair; asm-review-performance
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:335`
- Title: External attribution scans every worktree root for each unclaimed registry session
- Evidence: Every external poll iterates unclaimed indexed sessions and linearly scans all current worktree ids through `attribute`, for S × W prefix checks. The design's expectation that both axes are in the tens is not an enforced structural cap. No measurement currently demonstrates user-visible cost, so the original SUGGEST severity remains stable despite the performance specialist recommending escalation.
- Impact: Poll cost grows multiplicatively with live unclaimed sessions and current worktrees.
- SuggestedFix: Keep the simple scan until measurement warrants change; if counts become material, use a segment-aware longest-prefix index or introduce an enforced bound.
- Status: persists from round 1
- Triage: Author rebuttal rejected as a proof of boundedness, but the finding remains non-gating and conditional because no measured impact was supplied.

- Status (author, round 2): rejected — sustained by the chair
- Triage (author, round 2): The chair agrees no measured impact supports escalating this beyond SUGGEST. Left unfixed, with the growth axis recorded here rather than silently dropped: unclaimed live sessions x this window's worktree roots, per poll.

### S2

- ID: S2
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair; asm-review-reuse
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:120`
- Title: External row identity is constructed in two places
- Evidence: `externalRowId(sessionId)` is now the single owner and is used by both row creation and successful-read eviction.
- Impact: The key-drift risk is removed.
- SuggestedFix: None.
- Status: fixed
- Triage: Verified directly in both prior construction sites.

## Rebuttal rulings

- B1 accepted fix: partially effective; blocker persists on rejection/fallback, which the impact cone required verification of.
- B2 accepted fix: upheld and verified fixed.
- W1 partial acceptance: empty-id and relative-cwd fixes upheld; filename-stem rebuttal rejected.
- W2 rebuttal: rejected; the measurement is one input instance and the retained counter has no assertion.
- S1 rebuttal: rejected as a structural-bound argument; finding remains SUGGEST because no measured impact supports escalation.
- S2 accepted fix: upheld and verified fixed.

- Status (author, round 2): fixed and confirmed by the chair.
