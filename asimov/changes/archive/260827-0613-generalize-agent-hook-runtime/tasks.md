## 1. Generalize the runtime

- [x] 1_1 Extract the generalized runtime core with cursor as its first agent registration — verified: bun test 'src/agentHooks/AgentHookRuntime.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md#d2-one-session-token-plus-a-per-session-entitlement-set-that-disable-removes-from, design.md#d3-target-layout-new-srcagenthooks-cursor-becomes-a-registration, design.md#d4-agent-facing-contract-frozen-http-response-follows-the-authority, design.md#d5-core-owns-transport-and-containment-the-agent-module-owns-decode-and-semantics
  - **Acceptance**:
    - Outcome: One runtime routes registered slugs under per-agent enablement and per-session entitlement
    - Verify: unit src/agentHooks/AgentHookRuntime.test.ts
  - **Plan**:
    1. Create src/agentHooks/AgentHookRuntime.ts: move the transport, auth, dedup, and session-token registry from src/cursor/CursorHookRuntime.ts; add registerAgent, setAgentEnabled, the per-session entitlement set, slug-namespaced dedup, decoder exception containment, and the 204 response per D2, D4, and D5
    2. Create src/agentHooks/agents/cursor.ts: cursor decoder plus normalizer (EVENT_EFFECTS, quiet and freshness timers, working|idle), slug `cursor`, env var per D4
    3. Migrate src/cursor/CursorHookRuntime.test.ts to src/agentHooks/AgentHookRuntime.test.ts with assertions intact; add fake-second-agent cases for entitlement after disable and re-enable, throwing decode and normalizer, identical bodies to two slugs, and unregistered slug reason-code parity

## 2. Widen the seam and migrate the consumers

- [x] 2_1 Rename SessionManager's contributor seam to agent-neutral and mint merged per-agent env — verified: pnpm vitest run 'src/session/SessionManager.agentHooks.test.ts' && pnpm run check-types exit 0
  - **Deps**: 1_1
  - **Refs**: design.md#d1-one-multi-agent-contributor-not-a-contributor-collection
  - **Acceptance**:
    - Outcome: Spawns receive every enabled agent's coordinates whole; release-on-swap semantics unchanged
    - Verify: unit src/session/SessionManager.agentHooks.test.ts
  - **Plan**:
    1. In src/session/SessionManager.ts rename the cursorHookContributor option, field, setter, and releaseCursorHookAuthority to agent-neutral names; behaviour untouched
    2. Move the SessionEnvironmentContributor interface to src/agentHooks/AgentHookRuntime.ts; update importers, including the setter call site in src/extension.ts
    3. Migrate src/session/SessionManager.cursorHooks.test.ts to src/session/SessionManager.agentHooks.test.ts with assertions intact

- [x] 2_2 Generalize the controller to per-agent slots and rewire activation — verified: pnpm vitest run 'src/agentHooks/AgentHookController.test.ts' && pnpm run check-types exit 0
  - **Deps**: 1_1, 2_1
  - **Refs**: design.md#d3-target-layout-new-srcagenthooks-cursor-becomes-a-registration, design.md#d4-agent-facing-contract-frozen-http-response-follows-the-authority, design.md#d6-aggregate-contributor-lifecycle
  - **Acceptance**:
    - Outcome: Cursor runs on the generalized controller from activation; old runtime and controller modules gone
    - Verify: unit src/agentHooks/AgentHookController.test.ts
  - **Plan**:
    1. Create src/agentHooks/AgentHookController.ts from src/cursor/CursorHookController.ts: per-agent slots, per-agent reconcile revisions, per-agent setAgentEnabled, and the aggregate attach and detach rules of D6
    2. Rewire src/extension.ts: one controller with the cursor slot on the existing settings key; onStatus, onReasonCode, and onWarning behaviour unchanged
    3. Delete src/cursor/CursorHookRuntime.ts and src/cursor/CursorHookController.ts; migrate src/cursor/CursorHookController.test.ts to src/agentHooks/AgentHookController.test.ts; add cases for runtime-creation rejection leaving panes on inference, dispose before creation resolves, dispose during a pending reconcile, disabling one of two agents, disabling the last agent, and per-agent revision races

- [x] 2_3 Update the current-state design docs to the generalized modules — verified: manual — Rewrote the module names, seam description, and line citations in docs/DESIGN.md (reuse table + registry rows), docs/design/agent-cli-integration.md (spawn/runtime diagrams, controller sequence, error table), and docs/design/session-manager.md (shutdown order); verified no CursorHookRuntime or CursorHookController reference survives in docs/
  - **Deps**: 2_2
  - **Refs**: design.md#d3-target-layout-new-srcagenthooks-cursor-becomes-a-registration
  - **Acceptance**:
    - Outcome: The three design docs name the generalized modules instead of the deleted ones
    - Verify: none — docs-only
  - **Plan**:
    1. Rewrite the module names and seam description in docs/DESIGN.md, docs/design/agent-cli-integration.md, and docs/design/session-manager.md to the generalized runtime, controller, and contributor

## 3. Round 1 review fixes

- [x] 3_1 Close the round 1 blockers on containment, fail-open spawn, and per-agent reconcile — verified: pnpm vitest run 'src/agentHooks/AgentHookRuntime.test.ts' && pnpm run check-types && pnpm vitest run --maxWorkers=4 exit 0
  - **Deps**: 2_2
  - **Refs**: design.md#d5-core-owns-transport-and-containment-the-agent-module-owns-decode-and-semantics, design.md#d6-aggregate-contributor-lifecycle, .reviews/round-1.md
  - **Acceptance**:
    - Outcome: A throwing agent module never blocks pane creation and never withholds another agent's authority
    - Verify: unit src/agentHooks/AgentHookRuntime.test.ts
  - **Plan**:
    1. B1 and B2 in src/agentHooks/AgentHookRuntime.ts: contain createSession behind a boundary that clears the partial state, emits agent-error, omits that agent's env var, and keeps constructing the rest; add an active marker cleared before teardown and wrap timer callbacks in try and catch
    2. S1 in src/agentHooks/AgentHookRuntime.ts: when the disabled agent is the last enabled one, go straight to clearAllSessions instead of scanning the session map twice
    3. B3 in src/session/SessionManager.ts: call the contributor through a fail-open helper that releases authority best-effort, warns with a reason only, and spawns without hook env on failure
    4. B4 and W1 in src/agentHooks/AgentHookController.ts: replay reconciled authority immediately after assigning the runtime, reject a duplicate agent slot, and refuse to grant authority for an agent the runtime never registered
    5. S2: make src/agentHooks/agents/cursor.ts canonical for the slug, env var, and ordered event list, then have src/cursor/CursorHookInstaller.ts import and re-export them with the emitted wrapper unchanged
    6. RED first in src/agentHooks/AgentHookRuntime.test.ts, src/agentHooks/AgentHookController.test.ts, and src/session/SessionManager.agentHooks.test.ts: throwing constructor, throwing timer, throwing contributor at spawn, and a runtime that resolves after one install completes while another is pending

- [x] 3_2 Close the channel over asynchronous rejections and post-revocation publishes — verified: pnpm vitest run 'src/agentHooks/AgentHookRuntime.test.ts' && pnpm run check-types && pnpm vitest run --maxWorkers=4 exit 0
  - **Deps**: 3_1
  - **Refs**: design.md#d5-core-owns-transport-and-containment-the-agent-module-owns-decode-and-semantics, .reviews/round-2.md
  - **Acceptance**:
    - Outcome: No agent callback outcome escapes the core and no inactive state publishes
    - Verify: unit src/agentHooks/AgentHookRuntime.test.ts
  - **Plan**:
    1. B2 in src/agentHooks/AgentHookRuntime.ts: widen the channel timer callback to return void or a promise, observe the returned promise, and report a rejection as agent-error exactly like a synchronous throw
    2. B1 in src/agentHooks/AgentHookRuntime.ts: make publish return early when the state is inactive, and refuse to schedule new timers once it is inactive
    3. RED first in src/agentHooks/AgentHookRuntime.test.ts: a timer callback rejecting after an await, a constructor queueing a microtask that publishes then throwing, and a retained channel publishing after release
