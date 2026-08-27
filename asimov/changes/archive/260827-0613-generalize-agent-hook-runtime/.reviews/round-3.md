# Review Round 3

- Date: 2026-08-27
- Cycle: 1
- Mode: verification
- Scope: task 3_2 remediation diff (`36f01424d369edaf8a8a1616f510687ade4cc2a3..16a9026d525bea20af9d1115cde1bcc5bce1968e`)
- Scope lock: passed — source changes are limited to AgentHookRuntime and its tests; other changes are task/review metadata
- Reviewable lines: 26
- Agents spawned: asm-review-logic ×1
- Agents skipped: asm-review-data-security, asm-review-contracts, asm-review-frontend, asm-review-performance, asm-review-reuse — the cone is limited to runtime callback/liveness logic
- Verdict: APPROVE
- Counts: 0 BLOCK, 0 WARN, 0 SUGGEST
- Verification observed: focused AgentHookRuntime suite passed 54 tests; full suite passed 156 files / 2957 tests with `--maxWorkers=4`; `pnpm run check-types` passed; Biome check mode passed on both remediation files; exact-tree `git diff --check` passed.

## B1

- ID: B1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair; asm-review-logic
- File: `src/agentHooks/AgentHookRuntime.ts:338`
- Title: Failed or revoked agent channels can republish status asynchronously
- Evidence: `publish()` now returns before the repeat-value check when `state.active` is false. `setTimer()` also returns without scheduling once inactive. Constructor rollback and every teardown path clear `active` before deferred work can re-enter; direct authoritative null emissions remain outside the guarded channel.
- Impact: Retained channels can no longer restore status or create tracked timer work after constructor rollback, release, renewal, disable, or disposal. Active-state behavior remains unchanged.
- SuggestedFix: Implemented.
- Status: fixed
- Triage: Verified by tests for a constructor-queued microtask publish, retained publish after release, and timer scheduling after teardown. `clearAgentState` and constructor rollback still emit the required direct null update.
- Invariant: Failed or revoked agent state cannot publish or schedule work after rollback or teardown.
- Boundary inventory: fixed — constructor rollback, release, renewal, per-agent disable, last-agent disable, disposal, retained publish, and post-teardown timer scheduling.

## B2

- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-logic
- File: `src/agentHooks/AgentHookRuntime.ts:320`
- Title: Async timer callback rejections still escape containment
- Evidence: The channel contract now accepts `() => void | Promise<void>`. The wrapper retains synchronous `try/catch` and observes a returned promise with a rejection handler that emits the same reason-only `agent-error`. A callback resumed after revocation cannot publish because B1's active guard is enforced at the channel boundary.
- Impact: Both synchronous exceptions and post-await rejections from core-managed timers are contained without unhandled rejection or stale status.
- SuggestedFix: Implemented.
- Status: fixed
- Triage: The RED async-rejection test now passes without Vitest reporting an unhandled rejection. Synchronous timer, queued inactive callback, teardown, and status paths remain green.
- Invariant: Every core-managed agent callback outcome, synchronous or asynchronous, is observed and contained.
- Boundary inventory: fixed — synchronous throw, returned-promise rejection, callback invoked after revocation, and async continuation attempting to publish after revocation.

## B3

- ID: B3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- File: `src/session/SessionManager.ts:1438`
- Title: Contributor failures block PTY creation instead of degrading to inference
- Evidence: Unchanged from round 2; fail-open minting remains in both PTY paths.
- Impact: Contributor faults do not block PTY availability.
- SuggestedFix: Implemented in task 3_1.
- Status: fixed
- Triage: Carried forward; task 3_2 does not intersect this boundary.

## B4

- ID: B4
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- File: `src/agentHooks/AgentHookController.ts:144`
- Title: A pending agent reconcile can withhold another agent's completed authority
- Evidence: Unchanged from round 2; grant-only replay remains before peer reconciliation await.
- Impact: Per-agent authority remains independent.
- SuggestedFix: Implemented in task 3_1.
- Status: fixed
- Triage: Carried forward; task 3_2 does not intersect this boundary.

## W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair
- File: `src/agentHooks/AgentHookController.ts:243`
- Title: Controller can attach a contributor for an agent the runtime never registered
- Evidence: Unchanged from round 2; duplicate and registration checks remain enforced.
- Impact: Membership mismatches cannot create false authority.
- SuggestedFix: Implemented in task 3_1.
- Status: fixed
- Triage: Carried forward; task 3_2 does not intersect this boundary.

## S1

- ID: S1
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair
- File: `src/agentHooks/AgentHookRuntime.ts:209`
- Title: Avoid the redundant second full-session scan when disabling the last agent
- Evidence: The last-agent direct clear remains intact.
- Impact: No redundant second session traversal.
- SuggestedFix: Implemented in task 3_1.
- Status: fixed
- Triage: Carried forward and covered by the full regression suite.

## S2

- ID: S2
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair
- File: `src/agentHooks/agents/cursor.ts:22`
- Title: Share the frozen Cursor hook contract with the installer
- Evidence: The canonical Cursor contract remains unchanged.
- Impact: No event/env/slug drift reintroduced.
- SuggestedFix: Implemented in task 3_1.
- Status: fixed
- Triage: Carried forward; task 3_2 does not intersect this boundary.
