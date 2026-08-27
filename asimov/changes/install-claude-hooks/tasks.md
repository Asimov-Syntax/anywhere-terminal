## 1. Extract the shared installer

- [x] 1_1 Extract the managed-config installer with cursor as its first adapter — verified: pnpm vitest run 'src/agentHooks/install/ManagedConfigInstaller.test.ts' && pnpm run check-types && pnpm vitest run --maxWorkers=4 exit 0
  - **Deps**: none
  - **Refs**: specs/agent-hook-installation/spec.md#{user-authored-configuration-is-preserved, an-unrecognised-or-malformed-configuration-is-refused, configuration-destination-is-not-followed-through-a-symlink, a-moved-managed-script-is-reconciled-not-duplicated}, design.md#d1-one-managed-config-reconciler-agents-supply-a-document-adapter, design.md#d3-a-managed-entry-is-identified-by-its-extension-owned-directory-suffix-not-a-bare-filename, design.md#d5-symlink-refusal-lives-in-the-shared-layer-ahead-of-the-lock, design.md#d10-a-read-is-classified-and-only-a-missing-file-may-be-created, design.md#d11-the-wrapper-becomes-executable-before-it-is-reachable
  - **Acceptance**:
    - Outcome: Cursor installs through the shared reconciler with malformed and symlinked configs refused
    - Verify: unit src/agentHooks/install/ManagedConfigInstaller.test.ts
  - **Plan**:
    1. Create src/agentHooks/install/types.ts with the AgentConfigAdapter and ConfigRead contracts from design.md Interfaces
    2. Create src/agentHooks/install/ManagedConfigInstaller.ts holding the lock, classified read, compare-and-retry reconcile, atomic rename, wrapper creation, and typed outcomes moved from src/cursor/CursorHookInstaller.ts
    3. Add the lstat symlink refusal ahead of lock acquisition, the D10 read classification with an adapter-seeded initial document, and the D11 write-chmod-rename wrapper ordering
    4. Create src/agentHooks/install/cursorConfigAdapter.ts carrying cursor's document shape, entry form, wrapper scripts, event registration, and D3 ownership matching
    5. Delete src/cursor/CursorHookInstaller.ts and migrate src/cursor/CursorHookInstaller.test.ts to src/agentHooks/install/ManagedConfigInstaller.test.ts with assertions intact, pinning the emitted wrapper bytes
    6. Cover in tests: invalid JSON, an array root, a null root and a scalar root each refused byte-for-byte; symlink refusal on install and uninstall leaving no lock file; a stale entry under the owned directory swept and rewritten; a same-named script elsewhere preserved; wrapper executable before it is reachable
    7. Update the importer in src/extension.ts

- [x] 1_2 Register claude on the runtime as a transport-only agent — verified: pnpm vitest run 'src/agentHooks/agents/claude.test.ts' && pnpm run check-types && pnpm vitest run --maxWorkers=4 exit 0
  - **Deps**: none
  - **Refs**: design.md#d6-claude-is-transport-only-in-this-task-the-reducer-is-wt-006-3, design.md#d7-registered-event-set
  - **Acceptance**:
    - Outcome: Claude posts authenticate but publish no state
    - Verify: unit src/agentHooks/agents/claude.test.ts
  - **Plan**:
    1. Create src/agentHooks/agents/claude.ts exporting CLAUDE_HOOK_SLUG, CLAUDE_HOOK_ENV_VAR, the ordered event list of design.md D7, and claudeAgentRegistration whose session accepts and drops every payload
    2. Create src/agentHooks/agents/claude.test.ts covering entitlement, dedup, and that no status is ever published

## 2. Install into claude's configuration

- [x] 2_1 Add the claude config adapter over its settings file — verified: pnpm vitest run 'src/agentHooks/install/claudeConfigAdapter.test.ts' && pnpm run check-types && pnpm vitest run --maxWorkers=4 exit 0
  - **Deps**: 1_1, 1_2
  - **Refs**: specs/agent-hook-installation/spec.md#{user-authored-configuration-is-preserved, an-unrecognised-or-malformed-configuration-is-refused, claude-configuration-location-is-overridable, an-unreachable-hook-costs-the-agent-nothing}, design.md#d2-the-adapter-validates-every-structural-container-and-nothing-below-it, design.md#d4-claudes-config-directory-resolves-setting-environment-default, design.md#d7-registered-event-set, docs/research/20260827-claude-code-hooks-settings-schema.md
  - **Acceptance**:
    - Outcome: Enabling claude hooks registers every event and preserves the rest of the file
    - Verify: unit src/agentHooks/install/claudeConfigAdapter.test.ts
  - **Plan**:
    1. Create src/agentHooks/install/claudeConfigAdapter.ts: the D2 container-level shape gate, matcher-group entry nesting, the config directory resolution order, and the initial document for a file that does not exist
    2. Add the posix and windows wrapper scripts of agent-hook-server.md § 4.3 — leading neutral output, background-job guard, silent exit without coordinates, bounded post
    3. Cover in tests: unknown-key and sibling-setting round trip, a user hook on the same event kept, three installs converging to one entry per event, path drift rewritten, resolution order across setting and environment and default
    4. Cover the D2 rejection levels in tests: a non-array event value, a non-object matcher group, a non-array matcher hooks value, a non-object handler, a non-string matcher — each byte-for-byte refused
    5. Pin both emitted wrapper scripts byte-for-byte, including the no-coordinate exit path

- [x] 2_2 Wire the claude slot, its settings, and the uninstall command — verified: pnpm vitest run 'src/agentHooks/install/agentHookWiring.test.ts' && pnpm run check-types && pnpm vitest run --maxWorkers=4 exit 0
  - **Deps**: 2_1
  - **Refs**: specs/agent-hook-installation/spec.md#{per-agent-opt-in-hook-installation, uninstall-command-clears-every-managed-entry}, design.md#d8-both-new-keys-are-machine-scoped-matching-the-shipped-key, design.md#d9-uninstall-is-a-command-over-every-agent-independent-of-settings
  - **Acceptance**:
    - Outcome: Each agent reconciles from its own setting and one command clears everything
    - Verify: unit src/agentHooks/install/agentHookWiring.test.ts
  - **Plan**:
    0. Paths: package.json, src/agentHooks/install/uninstallAllAgents.ts, src/agentHooks/install/agentHookRegistry.ts, src/extension.ts, src/agentHooks/install/agentHookWiring.test.ts, src/agentHooks/install/ManagedConfigInstaller.ts, src/agentHooks/install/ManagedConfigInstaller.test.ts
    1. Declare anywhereTerminal.agentHooks.claude.enabled and anywhereTerminal.agentHooks.claudeConfigDir plus the anywhereTerminal.agentHooks.uninstall command in package.json
    2. Create src/agentHooks/install/uninstallAllAgents.ts removing every agent's managed entries independently of settings, reporting per-agent outcomes and continuing past one agent's failure
    3. Create src/agentHooks/install/agentHookRegistry.ts naming, for each agent, its settings key and adapter factory, so activation and the uninstall command read one list
    4. Add the claude slot, its settings listener, and the command registration to src/extension.ts from that registry
    5. Create src/agentHooks/install/agentHookWiring.test.ts asserting every registry settings key and the command id exist in package.json, both registrations reach the runtime, each setting drives only its own slot, and the command removes both agents' entries whatever the settings say
    6. In src/agentHooks/install/ManagedConfigInstaller.ts create the config directory before taking the lock, and answer uninstall on an absent config file without taking one — an agent whose config directory does not exist yet reported lock-unavailable, since the lock file cannot be created inside a missing directory. Cover both in src/agentHooks/install/ManagedConfigInstaller.test.ts

- [x] 2_3 Qualify the Windows stdin reader in the cursor wrapper — verified: pnpm vitest run 'src/agentHooks/install/ManagedConfigInstaller.test.ts' && pnpm run check-types && pnpm vitest run --maxWorkers=4 exit 0
  - **Deps**: 1_1
  - **Refs**: specs/agent-hook-installation/spec.md#an-unreachable-hook-costs-the-agent-nothing
  - **Acceptance**:
    - Outcome: The cursor Windows wrapper reads stdin through an absolute system path
    - Verify: unit src/agentHooks/install/ManagedConfigInstaller.test.ts
  - **Plan**:
    1. Replace the bare `more` in src/agentHooks/install/cursorConfigAdapter.ts with `"%SystemRoot%\System32\more.com"`, since Windows resolves an unqualified name against the working directory before PATH and a repo-local `more.*` would receive the hook payload
    2. Update the wrapper byte pin in src/agentHooks/install/ManagedConfigInstaller.test.ts and assert the qualified path
