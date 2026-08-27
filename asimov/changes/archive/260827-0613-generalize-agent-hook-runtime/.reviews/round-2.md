# Review Round 2

- Date: 2026-08-27
- Cycle: 1
- Mode: verification
- Scope: task 3_1 remediation diff (`95f518e3f3601879b13f93a4609e11c49e697137..36f01424d369edaf8a8a1616f510687ade4cc2a3`)
- Scope lock: passed — source changes are remediation for round-1 findings; other changes are task/review metadata and import ordering, not new capability
- Reviewable lines: 188
- Agents spawned: asm-review-logic ×1; asm-review-data-security ×1; asm-review-contracts ×1
- Agents skipped: asm-review-frontend — no UI changes; asm-review-performance — S1 verified inline; asm-review-reuse — S2 verified by contracts and chair
- Verdict: BLOCK
- Counts: 1 BLOCK, 1 WARN, 0 SUGGEST
- Verification observed: focused impact-cone suite passed 104 tests; full suite passed 156 files / 2953 tests with `--maxWorkers=4`; `pnpm run check-types` passed; Biome check mode passed on all eight remediation files; exact-tree `git diff --check` passed. Temporary probes reproduced B1's deferred republish and were deleted in the same command.

## B1

- ID: B1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair; asm-review-logic; asm-review-data-security
- File: `src/agentHooks/AgentHookRuntime.ts:322`
- Title: Failed or revoked agent channels can republish status asynchronously
- Evidence: Constructor rollback and teardown set `state.active = false`, but `channel.publish()` at lines 322–327 never checks that flag. A constructor can retain the channel, queue a microtask, then throw; the catch rolls back synchronously, but the microtask later publishes `working`. The same retained channel can publish after release, renewal, disable, or dispose. A temporary probe reproduced a throwing constructor publishing `working` after rollback.
- Impact: Terminal creation, env omission, token revocation, and tracked-timer cleanup are now safe, but failed/revoked modules can restore a stale activity status after their entitlement is gone. This no longer restores HTTP authority or blocks a PTY.
- SuggestedFix: Make every state-mutating channel entry fail closed when inactive: at minimum return immediately from `publish()` when `!state.active`, and refuse to schedule new `setTimer()` work after deactivation. Add tests for deferred publish after a throwing constructor and after release/disable.
- Status: accepted — persists from round 1
- Triage: Round-1 B1 is partially fixed. Evidence delta supports downgrade from BLOCK to WARN: constructor exceptions no longer escape, healthy agents continue, partial tracked state is cleaned, and the remaining impact is stale status reachable only through deferred work retaining the channel.
- Author triage: accepted, no rebuttal. Confirmed: `publish()` closes over `state` but never reads `state.active`, so any work retaining the channel outlives the rollback that `createAgentState` performs. Fixing at the invariant level rather than the quoted line — `publish()` and `setTimer()` scheduling both fail closed when inactive. Fixed in task 3_2.
- Invariant: Failed or revoked agent state cannot publish after rollback or teardown.
- Boundary inventory: fixed — synchronous constructor rollback, env omission, tracked timers armed before throw, healthy later-agent construction; affected — deferred/unmanaged work calling `publish()` or scheduling channel timers after `active` becomes false.

## B2

- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-logic
- File: `src/agentHooks/AgentHookRuntime.ts:302`
- Title: Async timer callback rejections still escape containment
- Evidence: The new wrapper catches only synchronous throws around `callback()`. TypeScript permits an `async () => ...` function where `() => void` is expected; its returned promise is discarded, so a rejection after an `await` becomes unhandled. The pre-invocation active check cannot contain that rejection, and without B1's publish gate the resumed callback can also publish after revocation.
- Impact: A generalized agent normalizer can still surface an unhandled rejection from core-managed timer work, violating D5's requirement that agent exceptions never escape and risking extension-host instability. B2 therefore persists at its original severity.
- SuggestedFix: Define timer callbacks as `() => void | Promise<void>` and contain both synchronous throws and returned-promise rejections, for example by observing `Promise.resolve(callback())` with a rejection handler that emits `agent-error`. Keep the active check and add an async callback test that rejects after an `await`.
- Status: accepted — persists from round 1
- Triage: The fix closes synchronous timer throws and queued callbacks invoked after revocation, but not asynchronous rejections. No severity change: the same uncaught-exception containment invariant and host-stability impact remain.
- Author triage: accepted, no rebuttal. My round-1 fix contained only the synchronous throw; `callback()`'s return value was discarded, and `() => void` accepts an async function, so a post-await rejection was never observed. Widening the channel contract to `() => void | Promise<void>` and observing the returned promise. Fixed in task 3_2.
- Invariant: Every core-managed agent callback, synchronous or asynchronous, is observed and contained.
- Boundary inventory: fixed — synchronous timer throws and inactive callbacks before invocation; affected — promise rejection returned by an async timer callback; coupled status boundary — B1.

## B3

- ID: B3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-data-security
- File: `src/session/SessionManager.ts:1438`
- Title: Contributor failures block PTY creation instead of degrading to inference
- Evidence: `mintAgentHookEnv()` now catches contributor creation failure, best-effort releases the session authority, and returns an empty env. Both initial spawn and fallback-shell replacement use the helper, while their post-mint spawn catches remain intact.
- Impact: Contributor faults no longer block either PTY path or leave half-minted authority without a release attempt.
- SuggestedFix: Implemented.
- Status: fixed
- Triage: Verified across initial spawn, fallback respawn, failed spawn, release, and teardown impact paths; focused regression test passes.

## B4

- ID: B4
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-logic
- File: `src/agentHooks/AgentHookController.ts:144`
- Title: A pending agent reconcile can withhold another agent's completed authority
- Evidence: After assigning the runtime and revoking old authority, `initialize()` now performs a grant-only replay before awaiting peer reconciliation. The replay considers only revision-current, enabled, successful states; mid-reconcile agents remain revoked and grant independently when they settle.
- Impact: A pending peer no longer withholds an already-reconciled agent's authority, and the single-agent event ordering remains unchanged.
- SuggestedFix: Implemented.
- Status: fixed
- Triage: The reproduced runtime-late/peer-pending ordering now passes, along with stale revision, disable, and disposal cases.

## W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair; asm-review-data-security; asm-review-contracts
- File: `src/agentHooks/AgentHookController.ts:243`
- Title: Controller can attach a contributor for an agent the runtime never registered
- Evidence: Duplicate controller slots now throw during construction. Granting checks `runtime.isAgentRegistered(agent)` first, warns once for an unregistered ID, and revokes instead of enabling or attaching.
- Impact: Controller/runtime membership mismatches no longer create false authority or disturb healthy agents.
- SuggestedFix: Implemented.
- Status: fixed
- Triage: Duplicate and unregistered-agent tests pass; repeated grant evaluation does not repeat the warning.

## S1

- ID: S1
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair
- File: `src/agentHooks/AgentHookRuntime.ts:209`
- Title: Avoid the redundant second full-session scan when disabling the last agent
- Evidence: Last-agent disable now calls `clearAllSessions()` directly and returns before the per-agent sweep.
- Impact: The redundant second pass over live sessions is removed without changing multi-agent entitlement behavior.
- SuggestedFix: Implemented.
- Status: fixed
- Triage: Verified inline and by the existing disable/entitlement tests.

## S2

- ID: S2
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair; asm-review-contracts
- File: `src/agentHooks/agents/cursor.ts:22`
- Title: Share the frozen Cursor hook contract with the installer
- Evidence: The ordered event tuple, env variable, and slug are canonical in the Cursor agent module. The installer imports/re-exports those values and composes both wrappers from them; the decoder map is exhaustive over the event tuple.
- Impact: The prior drift risk is removed while preserving the frozen Cursor contract.
- SuggestedFix: Implemented.
- Status: fixed
- Triage: Source comparison and installer tests confirm the POSIX/Windows wrapper behavior remains unchanged.
