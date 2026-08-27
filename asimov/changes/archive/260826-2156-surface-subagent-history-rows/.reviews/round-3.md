# Review Round 3

- Date: 2026-08-27
- Cycle: 1
- Round: 3
- Mode: verification
- Scope: working tree — accepted round-2 fixes plus behavioral impact cone
- Reviewable lines: 74
- Scope lock: passed — tasks 5_1 and 5_2 are remediation only; earlier feature tasks are unchanged
- Agents spawned:
  - asm-review-contracts — reader correlation, bounded-read contract, and detail consumers — gpt-5.6-sol[1M]
  - asm-review-logic — two-pass matching, probe state machine, and null fallbacks — gpt-5.6-terra[1M]
  - asm-review-frontend — revived-editor route and preview/live-follow null behavior — sonnet[1M]
- Agents skipped:
  - asm-review-data-security — no changed identity, input-validation, authorization, or storage-security boundary
  - asm-review-performance — the child collection remains structurally capped and no new hot-path or growth-axis issue was introduced
  - asm-review-reuse — no new reimplementation or split-cohesion concern in the remediation cone
- Verdict: WARN
- Counts: BLOCK 0 | WARN 1 | SUGGEST 0
- Verification: chair-observed `pnpm run check-types` passed and 61 focused tests passed. Author-reported full suite: 3796 tests; Biome: 13 unchanged baseline warnings; `asm change verify-status`: exit 0.
- Cycle note: this is cycle 1's third and final verification round; another user-initiated review after remediation starts a new cycle in discovery mode.

## Prior finding verification

### B6

- ID: B6
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts, asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/opencodeReader.ts:590
- title: Greedy agent fallback steals a later delegation's exact child
- evidence: Correlation now reserves exact title matches across every subtask before agent fallback sees any remaining stub. The targeted earlier-unmatched/later-exact same-agent case leaves the earlier delegation as the plain step and keeps the later child's openable session identity. Existing repeated-identical, surplus-subtask, child-only, and renamed-child fallback cases remain covered.
- impact: Exact evidence can no longer be stolen by an earlier guess; the shared vault timeline and worktree roster preserve the two logical delegations.
- suggestedFix: None.
- status: fixed
- triage: Accepted in round 2; verified fixed at mixed exact/fallback, repeated, missing-child, and renamed-child boundaries.

### B7

- ID: B7
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/opencodeReader.ts:807
- title: A failed child probe falsely reports confirmed source omission
- evidence: `childrenSaturated` limits the probe's verdict reach to a successful child query that returned at least `CHILD_LIMIT` rows. Below the bound, probe status is ignored and the complete detail remains non-partial. At the bound, a successful empty probe stays complete, a successful probe row reports omission, and a failed probe returns null rather than inventing either verdict. Boundary inventory: child-query failure still reports actual omission; unsaturated probe failure is safe; exact-bound success is safe; confirmed overflow is partial; saturated unproven reads fail.
- impact: False partial details no longer discard complete nested transcripts or show false data-loss notices.
- suggestedFix: None for the partial contract. W3 records the user-facing error semantics of the accepted new null path.
- status: fixed
- triage: Accepted in round 2; verified fixed across every child query/probe state.

### B8

- ID: B8
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-contracts, asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/opencodeReader.ts:824
- title: Child overflow still declares the retained count as the source count
- evidence: On confirmed overflow, the reader now raises the correlation-derived count to `Math.max(currentCount, CHILD_LIMIT + 1)` after mapping and before finalization. The test uses a genuinely saturated 100-row child result, proves one row beyond it, and asserts the declared count exceeds both handed-over child items and the bound. Non-overflow paths retain the correlation-derived count.
- impact: The shared stats contract now states the source-supported lower bound, and the worktree count signal composes with the partial signal.
- suggestedFix: None.
- status: fixed
- triage: Accepted in round 2; verified fixed at confirmed overflow and exact-bound controls.

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: asm-review-frontend
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/TerminalViewProvider.worktree.test.ts:362
- title: Revived editor routing has no expansion-request regression test
- evidence: The fourth routing case constructs a real `TerminalPanelSerializer`, calls `deserializeWebviewPanel`, enters `TerminalEditorProvider.revive`, and sends through the production provider switch. It does not pass through `createPanel`. Each case owns its panel seam, handlers, and `SessionManager`.
- impact: Serializer dependency injection and the restored-editor expansion route are now pinned independently from direct editor creation.
- suggestedFix: None.
- status: fixed
- triage: Accepted in round 2; verified fixed at the distinct serializer construction boundary.

## Current findings

### W3

- ID: W3
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-contracts, asm-review-frontend
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/TerminalViewProvider.ts:580
- title: Saturated probe failure is presented as “Session not found”
- evidence: The accepted B7 fix returns null when an existing session's messages and children were read but its saturated child-bound probe failed (`opencodeReader.ts:809-813`). `VaultService.getDetail` forwards null unchanged, and the provider translates every null detail into `Session not found.` The new branch has already disproved absence; only a retryable proof query failed. Root preview renders that error directly. Nested preview renders it when no invocation fallback exists. Worktree delegation reading correctly maps null to a read failure, and live-follow safely retains the prior detail.
- impact: A transient SQLite probe failure on an existing large session is reported as permanent absence, obscuring the retryable failure and violating the preview's error semantics.
- suggestedFix: Keep the accepted null outcome but make the provider's null copy non-assertive for both missing and unreadable details, such as `Session not found or could not be read.` A typed not-found/read-failed result would be more precise but requires a separately funded contract change.
- status: accepted
- triage: Accepted and fixed as task 6_1 rather than listed — one string and one branch. Verified the site is single (`TerminalViewProvider.ts:580`); the `getEntry` miss at :517 IS a real not-found and keeps its wording. Took the chair's non-assertive copy rather than a typed outcome: a typed not-found/read-failed result is the better contract but is a separate change, and shipping misleading copy while it waits is the worse trade.

## Adjudication notes

- All reviewers agreed B6, B7, B8, and W2 are fixed.
- The probe-test rewrite is stronger, not weaker: the old fixture returned one child while claiming to test a 100-row bound; the new tests restore the real saturated boundary and separately cover under-bound failure, saturated failure, exact-bound completeness, and confirmed overflow.
- Production SQL contains `LIMIT 100`, so `childRes.rows.length` cannot exceed the bound through the real query. `>=` is equivalent to `===` in production and safer for injected or malformed oversized results.
- W3 is corroborated by chair, contracts, and frontend reviews. The pattern predates this fix, but the changed saturated-probe branch makes the misleading message newly reachable and the author explicitly placed every null consumer in the impact cone.
- No audit-backlog or accepted-risk entries apply.
