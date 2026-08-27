# Review Round 1

- Date: 2026-08-27
- Cycle: 1
- Mode: discovery
- Scope: working tree
- Reviewable lines: 2915
- Large change: yes — accuracy may decrease
- Agents spawned: asm-review-data-security ×1; asm-review-logic ×2; asm-review-contracts ×1; asm-review-performance ×1; asm-review-reuse ×1
- Agents skipped: asm-review-frontend — no frontend or webview behavior changed
- Verdict: REJECT
- Counts: 4 BLOCK, 1 WARN, 2 SUGGEST
- Verification observed: `pnpm vitest run src/agentHooks/AgentHookRuntime.test.ts src/agentHooks/AgentHookController.test.ts src/session/SessionManager.agentHooks.test.ts` passed 73 tests; `pnpm run check-types` passed. A temporary controller-order probe reproduced B4 and was deleted in the same command.

## B1

- ID: B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-logic; asm-review-data-security
- File: `src/agentHooks/AgentHookRuntime.ts:297`
- Title: Agent-session construction escapes containment and leaves partial authority
- Evidence: `create()` inserts the new session into `sessions` at line 229, then line 237 enters `createAgentState()` for each enabled registration. Line 297 invokes arbitrary `registration.createSession(channel)` without a containment or rollback boundary. A constructor can publish status or arm a core-tracked timer and then throw; the failed local state is never added to `session.entitled`, so its timers/status are unreachable for cleanup, while earlier agents remain partially entitled and the exception escapes the contributor call.
- Impact: One faulty agent module can abort terminal coordinate creation before the PTY spawn, prevent every later enabled agent from receiving coordinates, and leave leaked timers, phantom status, or partial token authority. This violates approved D5's fail-open containment rule.
- SuggestedFix: Contain each registration's session construction inside the runtime. On failure, mark the local state inactive, clear any timers and published status created during construction, emit `agent-error` through a safe diagnostic path, omit that agent's entitlement/env variable, and continue constructing the remaining agents.
- Status: accepted
- Triage: Verified at `AgentHookRuntime.ts:229`/`:237`/`:297` — `create()` inserts the session into `this.sessions` before the loop, and `createSession()` is invoked with no boundary, so a throwing constructor aborts the loop, denies coordinates to every later enabled agent, and escapes into SessionManager. Contradicts D5. Fixing per SuggestedFix.
- Invariant: Agent-module failures never escape the core or block pane creation.
- Boundary inventory: affected — per-session agent construction and partial-create rollback; verified safe in the normal path — synchronous `handle()` and `dispose()` exceptions are caught; separately affected — timer callbacks (B2) and contributor fallback (B3).

## B2

- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-logic; asm-review-data-security
- File: `src/agentHooks/AgentHookRuntime.ts:279`
- Title: Agent timer callbacks run outside the failure-containment boundary
- Evidence: `AgentHookChannel.setTimer()` wraps the scheduler only to remove the handle from `state.timers`, then invokes the agent-owned `callback()` directly at line 279. Unlike synchronous `AgentHookSession.handle()` and `dispose()`, this asynchronous normalizer boundary has no `try/catch` and no active/current-entitlement check.
- Impact: A decoder/normalizer that throws from a quiet-window, freshness, or future agent timer produces an uncaught extension-host exception after the request has already returned. A queued callback can also publish after its state has been revoked unless current-state liveness is enforced. This contradicts D5's requirement that agent exceptions never escape.
- SuggestedFix: Give each agent state an active/current marker, clear it before teardown, and wrap timer execution in `try/catch/finally`. Before invoking the callback, verify the state is still the session's current entitlement; convert failures to `agent-error` without allowing diagnostics to interrupt cleanup.
- Status: accepted
- Triage: Verified at `AgentHookRuntime.ts:276-283` — the `setTimer` wrapper deletes the handle then calls `callback()` bare, so a throwing agent timer becomes an uncaught extension-host error after the response has already returned. Contradicts D5. Adding `try/catch` plus a per-state active marker checked before invocation.
- Invariant: Every agent-owned execution boundary is fail-open and cannot publish after revocation.
- Boundary inventory: affected — scheduled timer callbacks; verified safe — synchronous request delivery and direct session disposal; related construction boundary — B1.

## B3

- ID: B3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-data-security
- File: `src/session/SessionManager.ts:480`
- Title: Contributor failures block PTY creation instead of degrading to inference
- Evidence: Initial spawn calls `this.agentHooks.create(id)` at lines 479–480 before the `pty.spawn()` `try/catch` starts at line 482. Fallback-shell respawn repeats the pattern at lines 683–684 before its try at line 689. Any contributor exception therefore bypasses `releaseAgentHookAuthority`; the initial path also leaves the allocated `PtySession`, terminal-number reservation, and any shell-integration injection outside the normal failure cleanup.
- Impact: Optional hook observability can prevent ordinary terminal tabs from opening, break fallback-shell replacement after an agent exits, and retain partially minted authority. The generalized contributor now invokes per-agent module construction, making this an active cross-file failure path rather than a theoretical core primitive failure.
- SuggestedFix: Add one fail-open helper for contributor env creation. Catch failures, best-effort `release(id)`, clean any injection/PTY resources owned by the current path, report a reason-only warning, and continue spawning with the original environment and inference behavior.
- Status: accepted
- Triage: Verified at `SessionManager.ts:479-487` — `create()` runs before the spawn `try/catch`, so its exception aborts pane creation and skips `releaseAgentHookAuthority`. Not pre-existing in substance: this diff introduced the throw path, because `create()` now runs agent-module code (see B1). Wrapping in a fail-open contributor helper.
- Invariant: Hook observability failure never prevents or delays PTY availability.
- Boundary inventory: affected — initial spawn and fallback-shell respawn before their spawn catches; verified safe — failures thrown by `pty.spawn()` after contributor creation already release authority.

## B4

- ID: B4
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- File: `src/agentHooks/AgentHookController.ts:134`
- Title: A pending agent reconcile can withhold another agent's completed authority
- Evidence: `initialize()` starts all reconciliations at line 116 and awaits runtime creation at line 117. If agent A's install succeeds while the runtime is still pending, `applyReconciledAuthority()` records success but cannot grant because `this.runtime` is null. When the runtime later resolves, lines 132–134 assign it, revoke all slots, and await the original `Promise.all`; `applyAllReconciledAuthority()` is not called until line 135, after every other agent's reconcile settles. A temporary two-agent probe with delayed runtime, completed Cursor install, and pending Claude install failed because Cursor remained disabled after runtime arrival.
- Impact: One slow or stuck installer delays every already-reconciled agent, contradicting D6's requirement to attach on the first authoritative agent and the per-agent independence promised by the generalized controller. Activation also remains blocked on the unrelated pending reconcile.
- SuggestedFix: Immediately replay completed per-agent states after assigning the runtime, before awaiting the aggregate reconciliation, and let each reconcile grant authority independently as it settles. Add the reproduced ordering test: agent A install completes, agent B remains pending, runtime arrives, and A enables/attaches immediately.
- Status: accepted
- Triage: Verified at `AgentHookController.ts:132-135` — an agent whose install resolves before `createRuntime()` sees `this.runtime === null` in `applyReconciledAuthority` (`:206`) and is revoked; the replay then waits on `Promise.all`, so one slow installer withholds an already-reconciled agent's authority. Contradicts D6. The existing test at `AgentHookController.test.ts:268` missed it because `createRuntime` resolves synchronously there. Replaying completed states immediately after runtime assignment, plus the ordering test.
- Invariant: Each agent's reconciliation grants or revokes authority independently of other agents' settlement order.
- Boundary inventory: affected — install-before-runtime with another pending agent; verified safe — runtime-first reconciliation, stale revision rejection, one-of-two disable, last-agent disable, and disposal paths covered by existing tests.

## W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair; asm-review-contracts
- File: `src/agentHooks/AgentHookController.ts:213`
- Title: Controller can attach a contributor for an agent the runtime never registered
- Evidence: The controller constructor silently overwrites duplicate slot IDs in `states` at line 63. After installer success, lines 213–215 call `runtime.setAgentEnabled(agent, true)`, mark `authorityGranted = true`, and attach the contributor. `AgentHookRuntime.setAgentEnabled()` silently returns for an unknown ID at lines 194–196, so controller and runtime membership can diverge without an error.
- Impact: A future multi-agent wiring mismatch can install a global hook and report authority while `runtime.create()` emits no coordinate for that agent. Panes silently remain on inference under a falsely authoritative controller state.
- SuggestedFix: Reject duplicate controller slots and enforce a one-to-one controller-slot/runtime-registration contract. Make enablement return success or throw for unknown registrations, and attach only after that check succeeds; validate slug/env registration invariants at construction.
- Status: accepted
- Triage: Verified — `setAgentEnabled` returns silently for unknown ids (`:194-197`) while the controller still sets `authorityGranted` and attaches (`:212-215`); the constructor also lets a duplicate slot overwrite silently. Harmless today (one agent, wired correctly) but exactly the mistake WT-006.2 can make when it adds Claude. Rejecting duplicate slots and cross-checking registration before granting authority. Should-fix, non-blocking.

## S1

- ID: S1
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-performance; chair adjudication downgraded from WARN
- File: `src/agentHooks/AgentHookRuntime.ts:202`
- Title: Avoid the redundant second full-session scan when disabling the last agent
- Evidence: `setAgentEnabled(false)` first scans every live session to remove one agent at lines 202–208, then, when no enabled agent remains, `clearAllSessions()` scans the same session set again at lines 209–210.
- Impact: The last-agent settings toggle performs roughly two passes over the live-pane growth axis. The path is rare and one O(S) revocation pass is required by D2, so this is not gating.
- SuggestedFix: Determine whether the agent is the last enabled registration before the per-agent scan and go directly to `clearAllSessions()` in that case.
- Status: accepted
- Triage: Verified at `:202-211`. Trivial: detect the last enabled agent first and go straight to `clearAllSessions()` instead of scanning the session map twice.

## S2

- ID: S2
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-reuse; chair adjudication downgraded from BLOCK
- File: `src/agentHooks/agents/cursor.ts:13`
- Title: Share the frozen Cursor hook contract with the installer
- Evidence: The new agent module defines the slug/env constants and its `EVENT_EFFECTS` keys, while unchanged `CursorHookInstaller.ts` independently hard-codes `ANYWHERE_TERMINAL_CURSOR_URL`, `/cursor`, and the same twelve values in `CURSOR_HOOK_EVENTS`.
- Impact: There is no current mismatch, and the values are explicitly frozen, so this is not a functional defect. Future event or wrapper evolution would nevertheless require synchronized edits across two owners.
- SuggestedFix: Make the Cursor agent module's contract/event vocabulary canonical and have the installer import or consume those exported values while retaining ownership of wrapper generation and config reconciliation.
- Status: accepted
- Triage: Verified — the `EVENT_EFFECTS` keys (`agents/cursor.ts:19-32`) equal `CURSOR_HOOK_EVENTS` (`CursorHookInstaller.ts:6-19`) element-for-element, and the wrapper hardcodes both `/cursor` and `ANYWHERE_TERMINAL_CURSOR_URL` (`:339-347`). Trivial and mechanical, so fixed now rather than deferred, since WT-006.2 is the drift opportunity: the agent module becomes canonical and the installer imports/re-exports it. D4 keeps the emitted contract byte-identical.
