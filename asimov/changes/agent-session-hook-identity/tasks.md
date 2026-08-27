## 1. Contracts

- [x] 1_1 Rank the evidence a session claim rests on — verified: bun test 'src/worktree/presenceProjector.test.ts' && bun run check-types && bun run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-agent-presence/spec.md#{claim-agent-identity-only-from-evidence-that-proves-it, one-session-belongs-to-one-pane}, design.md#d4-a-report-is-a-fourth-kind-of-evidence-ranked-above-the-rest
  - **Acceptance**:
    - Outcome: a contested session goes only to its strictly highest-ranked claimant
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Plan**:
    1. `src/session/resolveClaudeSession.ts` — add `reported` to `ClaudeSessionEvidence` and export the rank order
    2. `src/worktree/presenceProjector.ts` — `settleContestedSessions` compares rank instead of testing `evidence === "process"`

- [x] 1_2 Declare the report a producer sends — verified: bun run check-types && bun run check-types && bun run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/agent-hook-identity/spec.md#{an-agent-reports-the-session-it-is-running, a-session-report-carries-no-conversation-content}, design.md#interfaces
  - **Acceptance**:
    - Outcome: the report shape type-checks across receiver, producers and presence
    - Verify: command bun run check-types
  - **Plan**:
    1. `src/agentHooks/reportTypes.ts` — `AgentSessionReport`, the reporting agent union, and the parse of an untrusted body into it

## 2. Receiver

- [x] 2_1 Serve more than one agent from the one loopback receiver — verified: bun test 'src/cursor/CursorHookRuntime.test.ts' && bun run check-types && bun run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/agent-hook-identity/spec.md#{a-session-report-is-accepted-only-for-the-terminal-it-was-issued-to, identity-observers-fail-open}, design.md#d1-the-terminals-identity-is-the-url-not-an-environment-key
  - **Acceptance**:
    - Outcome: a report is accepted only under the token issued to that terminal for this run
    - Verify: unit src/cursor/CursorHookRuntime.test.ts
  - **Plan**:
    1. `src/cursor/CursorHookRuntime.ts` — accept an agent segment on the request path, keeping the terminal + token pair and the existing body cap, deadline, dedup and reason codes
    2. `src/cursor/CursorHookRuntime.ts` — widen the per-session env contribution so a producer is told its own URL

- [x] 2_2 Publish the session a terminal reported — verified: bun test 'src/agentHooks/reportedSessions.test.ts' && bun run check-types && bun run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: specs/agent-hook-identity/spec.md#an-agent-reports-the-session-it-is-running, design.md#d5-prefer-codexs-transcript-path-over-its-session-id
  - **Acceptance**:
    - Outcome: a reported session is readable per terminal and cleared when that terminal exits
    - Verify: unit src/agentHooks/reportedSessions.test.ts
  - **Plan**:
    1. `src/agentHooks/reportedSessions.ts` — the per-terminal map, resolving a Codex report from `transcript_path` before `session_id`
    2. `src/cursor/CursorHookRuntime.ts` — feed accepted reports into it and clear on `release`

## 3. Producers

- [x] 3_1 Report OpenCode's session from a plugin in a directory we own — verified: bun test 'src/agentHooks/opencodePlugin.test.ts' && bun run check-types && bun run test:unit exit 0
  - **Deps**: 2_2
  - **Refs**: specs/agent-hook-identity/spec.md#{reporting-preserves-the-user-s-own-opencode-configuration, a-session-report-carries-no-conversation-content}, design.md#d2-opencode-needs-no-configuration-overlay
  - **Acceptance**:
    - Outcome: an OpenCode pane's row carries the session id OpenCode itself reports
    - Verify: unit src/agentHooks/opencodePlugin.test.ts
  - **Plan**:
    1. `src/agentHooks/opencodePlugin.ts` — the plugin source and its one-POST-per-session filter, reading its URL from the environment
    2. `src/agentHooks/opencodeConfigDir.ts` — write the plugin into the extension-owned directory and produce the `OPENCODE_CONFIG_DIR` contribution, yielding to a value the environment already carries

- [x] 3_2 Leave no seam claiming an agent that does not report — verified: bun test 'src/agentHooks/reportedSessions.test.ts' && bun run check-types && bun run test:unit exit 0
  - **Deps**: 2_2
  - **Refs**: specs/agent-hook-identity/spec.md#an-agent-reports-the-session-it-is-running, design.md#{d3-withdrawn-codex-is-not-a-reporting-agent-in-this-change, d5-withdrawn-the-only-reporter-names-an-id-so-there-is-no-path-to-prefer}
  - **Acceptance**:
    - Outcome: the receiver admits exactly the one agent that reports, and stores exactly what it sends
    - Verify: unit src/agentHooks/reportedSessions.test.ts
  - **Plan**:
    1. `src/agentHooks/reportTypes.ts` — narrow `ReportingAgent` to OpenCode and drop the two optional fields no producer sends
    2. `src/agentHooks/reportedSessions.ts` — drop `sessionLocator`'s unreachable path branch
    3. `src/cursor/CursorHookRuntime.ts` — the path's agent segment admits only what `ReportingAgent` names

## 4. Wiring

- [x] 4_1 Turn OpenCode reporting on and off from its own setting — verified: bun test 'src/agentHooks/hookEnvironment.test.ts' && bun run check-types && bun run test:unit exit 0
  - **Deps**: 3_1, 3_2
  - **Refs**: specs/agent-hook-identity/spec.md#identity-reporting-is-opt-in-per-agent
  - **Acceptance**:
    - Outcome: OpenCode reporting follows its own setting and defaults off
    - Verify: unit src/agentHooks/hookEnvironment.test.ts
  - **Plan**:
    1. `src/agentHooks/hookEnvironment.ts` — compose a terminal's credential env with the OpenCode configuration dir, and contribute neither while reporting is off
    2. `src/cursor/CursorHookController.ts` — the receiver may be wanted by an agent whose install is not Cursor's hook file
    3. `package.json` — contribute `anywhereTerminal.opencode.hooks.enabled`
    4. `src/extension.ts` — read it, reconcile on change alongside the existing Cursor controller, and hand the composed contribution to `SessionManager`

- [x] 4_2 Let a report outrank the directory guess — verified: bun test 'src/worktree/presenceProjector.test.ts' && bun run check-types && bun run test:unit exit 0
  - **Deps**: 1_1, 4_1
  - **Refs**: specs/worktree-agent-presence/spec.md#{claim-agent-identity-only-from-evidence-that-proves-it, one-session-belongs-to-one-pane}, design.md#d4-a-report-is-a-fourth-kind-of-evidence-ranked-above-the-rest
  - **Acceptance**:
    - Outcome: a reported pane keeps its session; the pane that only shared its directory loses it
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Plan**:
    1. `src/worktree/presenceDeps.ts` — read the reported session for a pane before resolving, tagging it `reported`
    2. `src/worktree/presenceProjector.ts` — consult `sessionUnderCwd` only when no report named that pane
    3. `src/extension.ts` — hand the projector what the receiver holds, as a vault entry id

## 5. Proof against the real agents

- [ ] 5_1 Confirm the reported id is the id the vault reads
  - **Deps**: 4_2
  - **Refs**: specs/agent-hook-identity/spec.md#an-agent-reports-the-session-it-is-running, design.md#d2-opencode-needs-no-configuration-overlay
  - **Acceptance**:
    - Outcome: a live OpenCode run reports an id the vault reader resolves to that same session
    - Verify: manual open a terminal with OpenCode reporting enabled, run OpenCode once, then confirm the id its row carries is the `session.id` row `sqlite3 ~/.local/share/opencode/opencode.db` holds for that directory

## 6. Review round 1

- [x] 6_1 Make the report reach the row, and only ever a real session id — verified: bun test 'src/worktree/presenceProjector.test.ts' && bun run check-types && bun run test:unit exit 0
  - **Deps**: 4_2
  - **Refs**: specs/agent-hook-identity/spec.md#{an-agent-reports-the-session-it-is-running, reporting-preserves-the-user-s-own-opencode-configuration, identity-observers-fail-open}, design.md#{d4-a-report-is-a-fourth-kind-of-evidence-ranked-above-the-rest, d6-the-plugin-reports-identity-only}, .reviews/round-1.md#{b1, b2, b3, b4, b5, b6, b7, w2}
  - **Acceptance**:
    - Outcome: a report that arrives after a pane is already proven still becomes that row's session, and only a root session's id can ever be reported
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Plan**:
    1. `src/worktree/presenceProjector.ts` — read the report before the proven cache short-circuits, and upgrade a cached identity the report disagrees with (B1)
    2. `src/agentHooks/opencodePlugin.ts` — report only a parentless session from a `session.*` event, under a client timeout (B2, B4, W2)
    3. `src/cursor/CursorHookRuntime.ts` — the contributor sees the environment a terminal is being spawned with (B3)
    4. `src/session/SessionManager.ts` — hand that environment to the contributor (B3)
    5. `src/agentHooks/hookEnvironment.ts` — resolve the fixed environment per terminal, and yield a variable the terminal already carries (B3, B5)
    6. `src/extension.ts` — serialize reconciliation, project when a report arrives, and bound the vault read to one per projection (B5, B6, B7)
    7. `src/agentHooks/opencodePlugin.test.ts`, `src/agentHooks/hookEnvironment.test.ts`, `src/worktree/presenceProjector.test.ts`, `src/session/SessionManager.cursorHooks.test.ts` — the cases above
