# Review Round 3

- Date: 2026-08-27
- Cycle: 1
- Mode: verification
- Scope: working tree remediation since round 2
- Scope lock: passed — task 4_2 and its tests are remediation only; no new capability, contract, or design scope was added
- Reviewable lines: 156
- Agents spawned:
  - asm-review-logic — B1/W3 committed-envelope and publication impact cone — gpt-5.6-sol[1M]
  - asm-review-performance — W1 indexed-registry impact cone — gpt-5.6-terra[1M]
- Agents skipped:
  - asm-review-data-security — no data/auth/security boundary in the remediation cone
  - asm-review-contracts — accepted envelope and resolution contracts are covered by the two specialist cones
  - asm-review-frontend — no frontend implementation changed
  - asm-review-reuse — no new duplication/split question remains in the remediation cone
- Verdict: BLOCK
- Counts: 1 BLOCK, 2 WARN, 0 SUGGEST open; 6 prior findings fixed
- Cycle limit: round 3 of 3 reached; any further user-initiated review starts cycle 2, round 4, in discovery mode
- Verification:
  - Focused final-remediation suite: 4 files / 69 tests passed
  - `pnpm run check-types`: passed
  - `pnpm run test:unit`: 193 files / 3633 tests passed
  - Scratch first-envelope delivery: failed as expected — cached request published live tree plus synthetic empty presence before first projection committed
  - Scratch duplicate-PID index: failed as expected — two distinct session candidates sharing one PID collapsed to one

## Findings

### B1

- ID: B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-logic
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:281`
- Title: First-build delivery still bypasses the committed envelope
- Evidence: The committed `published = {tree, presence}` envelope fixes every delivery after the first successful projection. Before that first commit, however, `rebuild()` has already applied the tree and set `built = true`, while `published` remains undefined until the parked projector returns. A cached `requestWorktreeTree` therefore reaches `broadcast()`, and a newly showing surface reaches `postTo()`, while `currentMessage()` falls back to `{tree: cache.read(), presence: presence()}`. With no prior projection, `presence()` is synthetic empty presence rather than presence projected against that tree. A scratch test parked the initial projection and issued a cached request; one message was delivered before any committed pair existed.
- Impact: A projector-backed host can temporarily publish a worktree tree with all agent rows missing, violating the accepted requirement that every delivery use one committed tree/presence envelope.
- SuggestedFix: When a projector exists and `published` is undefined, do not fall back to the live cache. Cached requests and showing edges must defer delivery or join/request the pending projection. Keep the live-cache/empty-presence fallback only for a host without a projector.
- Status: accepted
- Triage: persists from rounds 1-2 after partial remediation
- Author-Status: accepted
- Author-Triage: Confirmed. `built` is set before the first projection commits, so between them `currentMessage()` falls back to the live cache plus a synthetic empty presence — the one delivery the envelope was supposed to make impossible. Fixing by refusing delivery on a projector-backed host until it has committed once, and having a cached request in that window request the projection instead of publishing nothing.
- Invariant: Every delivery from a projector-backed host carries a tree and the presence projected against that same tree version.
- Boundary inventory:
  - Fixed: stale completion, concurrent projector entry, cached/showing/watch-failure delivery after the first commit, concurrent rebuild scopes, version-guarded commit, disposal, and successful-cycle single publication.
  - Still affected: cached request or showing-edge delivery after the first cache write but before the first projection commits.

### B2

- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/pty/processTableSnapshot.ts:148`
- Title: The process-table TTL still defines the rebuild boundary
- Evidence: The pinned reading remains in use once per projection and all TTL/failure/unsupported/invalid-pid tests remain green.
- Impact: None remaining.
- SuggestedFix: None.
- Status: fixed
- Triage: fixed in round 2 and unchanged in the round-3 cone

### W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair; asm-review-performance
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/runningSessions.ts:186`
- Title: Per-pane session resolution repeatedly scans shared registry data
- Evidence: `indexRunningSessions` now filters and indexes the user-wide registry once per snapshot. Presence shares one index promise across every pane; PID lookup is driven by the descendant set and cwd lookup is indexed. Transcript mtimes remain promise-memoized per session per snapshot, and negative outcomes still retry next projection.
- Impact: The O(P×S) global-registry rescan is removed. Remaining work is O(S) index construction plus O(P×(D+C)) pane lookup, where D is descendant PIDs and C is same-cwd candidates.
- SuggestedFix: None.
- Status: fixed
- Triage: verified across presence and both provider callers; round-1 rebuttal withdrawal accepted

### W2

- ID: W2
- Severity: WARN
- Confidence: MEDIUM
- Priority: P3
- Agent: chair
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/shared/paneEvidence.ts:113`
- Title: Shell titles are credited for idle even when they changed no outcome
- Evidence: Causal activity rules remain threaded through the store and projector with exhaustive parity tests.
- Impact: None remaining.
- SuggestedFix: None.
- Status: fixed
- Triage: fixed in round 2 and unchanged in the round-3 cone

### S1

- ID: S1
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/shared/paneEvidence.ts:63`
- Title: Share the duplicated title-classification ladder
- Evidence: Both production callers continue to use the one shared classifier.
- Impact: None remaining.
- SuggestedFix: None.
- Status: fixed
- Triage: fixed in round 2 and unchanged in the round-3 cone

### S2

- ID: S2
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/claudePaths.ts:175`
- Title: Reuse the existing transcript mtime reader
- Evidence: All three production callers continue to share `claudeSessionMtime`.
- Impact: None remaining.
- SuggestedFix: None.
- Status: fixed
- Triage: fixed in round 2 and unchanged in the round-3 cone

### W3

- ID: W3
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair; asm-review-logic
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:262`
- Title: Joined projection callers each publish the same completed result
- Evidence: `commitAndBroadcast()` is now the single successful-cycle publication point. Pane and rebuild callers no longer attach broadcasts, and joined-caller tests observe one push.
- Impact: The duplicate publication defect is removed for successful projection cycles.
- SuggestedFix: None.
- Status: fixed
- Triage: verified in the joined-caller, burst, continuous-stream, and stale-rerun boundaries

### W4

- ID: W4
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair; asm-review-performance
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/runningSessions.ts:196`
- Title: PID indexing can silently discard a live session candidate
- Evidence: `listRunningClaudeSessions()` deduplicates only by `sessionId` and accepts any positive parsed `pid`; it does not verify that the numeric filename stem equals the payload PID or enforce PID uniqueness across distinct session IDs. `indexRunningSessions()` then stores a single value in `Map<number, RunningClaudeSession>`, so a later entry with the same payload PID overwrites the earlier candidate. The prior raw-list resolver would have retained both step-1 candidates and chosen by transcript mtime. A scratch index with two session IDs sharing PID 42 returned one candidate instead of two.
- Impact: A malformed or stale registry pair can change pane identity and entryId according to enumeration order instead of the existing deterministic mtime tie-break.
- SuggestedFix: Preserve arrays per PID and let `pickNewest` retain the old candidate semantics, or enforce filename/payload PID agreement and deterministically reject/dedupe duplicate PIDs before indexing.
- Status: open
- Triage: untriaged
- Author-Status: accepted — regression I introduced
- Author-Triage: Confirmed, and it is mine: round 2's `Map<number, RunningClaudeSession>` silently drops a candidate where the previous `filter` handed both to the mtime tie-break. The registry dedupes by sessionId, not by pid, so two records can claim one pid and the survivor was decided by enumeration order. Fixing by keying pid to an array, which restores the tie-break exactly.

### W5

- ID: W5
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-logic
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:240`
- Title: A rejected projection can publish stale state or swallow joined work
- Evidence: `requestProjection()` catches a projector rejection, exits the dirty loop, clears `projectionRun`, and unconditionally calls `commitAndBroadcast()`. On a pane-only projection failure, `projectedVersion` still equals `treeVersion`, so the previous envelope is republished despite the log saying nothing was published. If a rebuild joined the failed run and set `projectionDirty`, the catch abandons that rerun and resolves the rebuild request; the new tree remains uncommitted until a later trigger.
- Impact: Projection failure can emit a misleading stale push or silently satisfy a tree rebuild without publishing its result.
- SuggestedFix: Commit only after a successful clean final iteration. Preserve/retry dirty work after a failed iteration, or reject rebuild callers and explicitly handle rejection on background pane requests.
- Status: open
- Triage: untriaged
- Author-Status: accepted
- Author-Triage: Confirmed, both halves. The catch path calls `commitAndBroadcast()` unconditionally, so a pane-only failure republishes the previous envelope purely because its tree version still matches; and a rebuild that joined the failed run has its dirty re-run abandoned while its promise resolves as if published. Fixing by committing only after a clean successful iteration and re-running when a joiner is waiting.

## Adjudication notes

- B1 retains its original BLOCK severity and ID. The round-3 envelope is correct after its first commit, but the first-build fallback remains the same envelope invariant through the same publication mechanism.
- W4 is a new correctness finding inside W1's index impact cone, not a performance persistence of W1.
- W5 is distinct from W3: joined-caller duplication is fixed on successful cycles; the new finding concerns failure-path loop termination and stale publication.
- Cycle 1 has reached its three-round maximum with B1 still open. Further review must begin cycle 2 rather than creating round 4 in this cycle.


## Author triage — round 3

Three findings, all accepted. Cycle 1 has used its three rounds and still ends with a blocker, so this is the thrash stop.

Taking the bounded extension round rather than a handback or a risk-accept. A handback is for a contradiction in accepted behaviour or design, and there is none — every finding is the implementation failing to do what design.md D3 already says. A risk-accept is not available for B1 either: it is a correctness bug with a three-line fix.

Fix hypotheses, stated in advance, no scope growth:
- B1: a projector-backed host delivers nothing until it has committed one envelope; the fallback survives only for projector-less hosts.
- W4: pid keys map to an array, restoring the mtime tie-break round 2 removed.
- W5: commit only after a clean successful iteration; a joiner waiting on a failed run gets a re-run.

Round cap: the user set a maximum of three review rounds, so these fixes are verified by the gate and by per-fix mutation tests rather than by a fourth chair round. That is recorded here so the absence of independent review on this last change is visible rather than assumed.