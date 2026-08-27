# Review Round 5

- Date: 2026-08-27
- Cycle: 2
- Mode: verification
- Scope: remediation since round 4, W3-W6 invariants, and their behavioral impact cones
- Scope lock: passed — changes are limited to replay membership, registry semantic validation, shared outcome indexing, and tests
- Reviewable lines: 31
- Agents spawned:
  - asm-review-contracts — W3 replay membership and W6 D1/D7 contracts — gpt-5.6-terra[1M]
  - asm-review-data-security — W4/W5 validation and W6 failure semantics — sonnet[1M]
  - asm-review-reuse — W6 ownership and caller cohesion — gpt-5.6-terra[1M]
- Agents skipped:
  - asm-review-logic — D11/D12 coordination unchanged and outside this remediation cone
  - asm-review-performance — S1 is unchanged carried context; W3 hot-path contract is covered by contracts
  - asm-review-frontend — no frontend code in the cone
- Verdict: APPROVE
- Open counts: 0 BLOCK, 0 WARN, 1 SUGGEST
- Dispositions: W3-W6 fixed; all prior fixed findings remain fixed; S1 carried; no new findings; no audit backlog; no accepted risk
- Verification observed:
  - Impact-cone suites: 4 files / 174 tests passed
  - `pnpm run check-types`: passed
  - `pnpm run test:unit`: 193 files / 3716 tests passed
  - Biome on 8 remediation files: clean, no fixes applied
  - `git diff --check`: passed

## Findings

### W3

- ID: W3
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair; asm-review-contracts
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:482`
- Title: Cache order permutation forced a full pane projection
- Evidence: `sameTree` now requires equal length and membership containment rather than positional equality. Tests prove same-order and permuted membership replay without pane resolution, while equal-count replacement and membership shrink fall back to a full pass. Production worktree ids are normalized absolute-path identities, so duplicate presentation entries do not create a distinct membership contract.
- Impact: D12 cache reorder no longer forces the following external poll through the pane/process-table path.
- SuggestedFix: None.
- Status: fixed
- Triage: verified across same order, permutation, equal-count replacement, shrink, and first-poll-after-reorder behavior

### W4

- ID: W4
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair; asm-review-data-security
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/runningSessions.ts:183`
- Title: Unsafe registry session ids were admitted
- Evidence: Registry admission now uses the canonical `isSafeSessionId` guard before liveness and indexing. Tests reject traversal, path separators, control characters, and empty ids while existing valid session-id cases continue to pass.
- Impact: Every published external entry id can name a downstream-safe Claude transcript identity.
- SuggestedFix: None.
- Status: fixed
- Triage: verified at traversal, separator, control, empty, and valid-id boundaries

### W5

- ID: W5
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair; asm-review-data-security
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/runningSessions.ts:194`
- Title: Invalid registry launch times could poison ordering
- Evidence: `startedAt` is carried only when it is a finite, non-negative number. Missing, overflow (`1e999` to Infinity), negative, and non-number values fall through to `undefined`, which uses the existing first-seen timestamp path. Existing finite non-negative dedupe/timestamp tests remain green.
- Impact: Malformed launch times no longer pin worktree ranking or publish invalid time data.
- SuggestedFix: None.
- Status: fixed
- Triage: verified across missing, overflow, negative, non-number, zero/positive, and first-seen fallback boundaries

### W6

- ID: W6
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair; asm-review-reuse; asm-review-contracts; asm-review-data-security
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/runningSessions.ts:231`
- Title: Registry outcome-to-index fallback was duplicated across three adapters
- Evidence: `indexRunningSessionsOrEmpty` is now the sole conversion owner. Both terminal providers call it directly. `presenceDeps` retains the original `registryRead` promise while deriving the index through the helper, so `sessions()` and `resolve()` still observe and propagate the typed registry failure. Search finds no remaining equivalent copies.
- Impact: All three identity-resolution surfaces share one compatibility rule without flattening D7's presence failure semantics or adding a second registry read.
- SuggestedFix: None.
- Status: fixed
- Triage: verified across both providers, one-read snapshot construction, successful/failed outcomes, `sessions()`, and pane `resolve()`

### S1

- ID: S1
- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P4
- Agent: chair; asm-review-performance
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:353`
- Title: External attribution scans every worktree root for each unclaimed registry session
- Evidence: The S x W prefix-scan mechanism is unchanged from cycle 1; no new impact, likelihood, reachability, contract, or measurement was introduced in this round.
- Impact: Poll cost remains multiplicative with unclaimed live sessions and worktree roots.
- SuggestedFix: Retain as a measured follow-up; optimize only when observed counts justify it.
- Status: persists from round 1; non-gating
- Triage: carried forward, never re-reported as new

## Prior finding disposition

- B1, B2, and B3 remain fixed under D11/D12 and registry recovery ownership.
- W1 and W2 remain fixed under PID semantic validation and rank-revision acknowledgment.
- S2 remains fixed through the shared `externalRowId` owner.
- No prior fixed finding intersects the round-5 remediation cone in a way that regresses it.

## Impact-cone trace

- Replay: full pass records worktree membership -> D12 may reorder cache presentation -> external poll compares membership independent of order -> pure permutation replays; replacement/gain/loss runs full.
- Registry: file/payload pid and field types -> canonical session id and absolute cwd -> liveness -> finite non-negative timestamp or first-seen fallback -> session dedupe/index.
- Shared index: each provider performs one registry read through the shared compatibility helper; presence holds the same raw promise, builds one index, and independently propagates failure through `sessions()` and pane `resolve()`.

## Cycle disposition

Cycle 2 is clean after verification. No BLOCK, WARN, audit-backlog, or accepted-risk entry remains. S1 is a non-gating measured follow-up. The review gate may close; blueprint synchronization and archive can proceed through their normal user-approved lifecycle.
