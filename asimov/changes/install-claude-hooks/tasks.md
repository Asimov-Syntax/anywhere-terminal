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

## 3. Review round 1 fixes

- [x] 3_1 Fix the round-1 findings — verified: pnpm vitest run 'src/agentHooks/install/ManagedConfigInstaller.test.ts' && pnpm run check-types && pnpm vitest run --maxWorkers=4 exit 0
  - **Deps**: 2_2, 2_3
  - **Refs**: .reviews/round-1.md, specs/agent-hook-installation/spec.md#{user-authored-configuration-is-preserved, a-moved-managed-script-is-reconciled-not-duplicated, claude-configuration-location-is-overridable}, design.md#d3-a-managed-entry-is-identified-by-its-extension-owned-directory-suffix-not-a-bare-filename, design.md#d4-claudes-config-directory-resolves-setting-environment-default
  - **Acceptance**:
    - Outcome: A lookalike hook survives, group metadata survives, and one operation targets one destination
    - Verify: unit src/agentHooks/install/ManagedConfigInstaller.test.ts
  - **Plan**:
    1. B1 — resolve the config path once per install and uninstall in src/agentHooks/install/ManagedConfigInstaller.ts and thread it through the symlink check, directory creation, lock, read, comparison and replacement
    2. B1 — track each agent's installed destination in src/extension.ts and src/agentHooks/install/agentHookRegistry.ts so a changed location removes the previous file instead of stranding it, covered in src/agentHooks/install/agentHookWiring.test.ts
    3. B2 — match ownership on the parsed command token's terminal path components, never a substring, and cover not-<agent>-hooks, a filename suffix and an argument-only occurrence
    4. B3 — in src/agentHooks/install/claudeConfigAdapter.ts drop a swept group only when its shape is one this extension creates, else keep its keys with an empty hooks array, covered in src/agentHooks/install/claudeConfigAdapter.test.ts
    5. W1 — give runCommand its own deadline that kills and reaps the child, restoring what the extraction dropped
    6. W2 — reword the claude setting description in package.json to transport-only
    7. W3 — pin the claude POSIX wrapper to an independent literal with a length assertion in src/agentHooks/install/claudeConfigAdapter.test.ts
    8. S1 — reuse src/utils/posixShellQuote.ts; S2 — ignore a non-absolute claude config directory override

- [x] 3_2 Fix the round-2 findings — verified: pnpm vitest run 'src/agentHooks/install/agentHookWiring.test.ts' && pnpm run check-types && pnpm vitest run --maxWorkers=4 exit 0
  - **Deps**: 3_1
  - **Refs**: .reviews/round-2.md, specs/agent-hook-installation/spec.md#{user-authored-configuration-is-preserved, claude-configuration-location-is-overridable}
  - **Acceptance**:
    - Outcome: A moved destination reconciles at its new file and a concatenated command is read as the shell reads it
    - Verify: unit src/agentHooks/install/agentHookWiring.test.ts
  - **Plan**:
    1. B1 — move the mid-session destination change into one awaited operation in src/agentHooks/install/agentHookRegistry.ts that cleans the old file, advances the record only on success, and reports that the new one must be reconciled; call it from src/extension.ts and force the reconcile rather than assuming the enablement key changed
    2. B2 — replace the single-token unquoter in src/agentHooks/install/ManagedConfigInstaller.ts with a first-word parser per platform so concatenated runs resolve as the shell resolves them and an unterminated quote fails closed
    3. W1 — await the child's close behind a secondary deadline and terminate the process group rather than the leader
    4. W3 — pin both cursor wrappers to independent literals in src/agentHooks/install/ManagedConfigInstaller.test.ts
    5. S3 — let src/agentHooks/install/claudeConfigAdapter.ts take an exact config file so the pinned factory returns what it was given

## 4. Cycle-1 redesign

- [x] 4_1 Replace command parsing with a written-command ledger — verified: bun test 'src/agentHooks/install/managedEntryLedger.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_2
  - **Refs**: design.md#d12-ownership-is-exact-equality-against-a-ledger-of-what-we-wrote-never-a-parse-of-the-users-string, specs/agent-hook-installation/spec.md#{user-authored-configuration-is-preserved, a-moved-managed-script-is-reconciled-not-duplicated}
  - **Acceptance**:
    - Outcome: Only a command this extension recorded writing is ever removed
    - Verify: unit src/agentHooks/install/managedEntryLedger.test.ts
  - **Plan**:
    1. Create src/agentHooks/install/managedEntryLedger.ts holding, per agent, the active destination, the commands written, and destinations pending cleanup, over an injectable key-value store
    2. Replace the ownership predicate in src/agentHooks/install/ManagedConfigInstaller.ts with exact equality against recorded commands, and delete the command parser and separator normalization it depended on
    3. Seed the ledger for an installation that predates it by constructing the command the shipped build emitted for the current storage root
    4. Create src/agentHooks/install/managedEntryLedger.test.ts covering: every lookalike from rounds 1 to 3 refused, a recorded command removed, a hand-edited command left alone and reported, a moved storage root still matched, and the seed matching what the shipped build wrote
    5. Update src/agentHooks/install/cursorConfigAdapter.ts and src/agentHooks/install/claudeConfigAdapter.ts to take ownership from the ledger, and drop the lookalike cases those suites assert through the old predicate
    6. Restate what src/agentHooks/install/types.ts says wrapper location is for, now that it no longer decides ownership

- [x] 4_2 Serialize each agent's hook transitions — verified: bun test 'src/agentHooks/install/agentHookTransitions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: design.md#d13-one-serialized-transition-owner-per-agent, specs/agent-hook-installation/spec.md#{per-agent-opt-in-hook-installation, uninstall-command-clears-every-managed-entry}
  - **Acceptance**:
    - Outcome: Overlapping configuration events settle on the latest setting with nothing orphaned
    - Verify: unit src/agentHooks/install/agentHookTransitions.test.ts
  - **Plan**:
    1. Create src/agentHooks/install/agentHookTransitions.ts running enable, disable and destination-moved as one serial queue per agent over the ledger
    2. Retry every destination left pending cleanup on the next transition and at activation
    3. Reduce the listener in src/extension.ts to submitting a transition, removing the per-event async run and the destination map
    4. Create src/agentHooks/install/agentHookTransitions.test.ts covering: interleaved enable and disable settling on the latest, two rapid destination moves leaving one active destination, a failed cleanup retried rather than forgotten, and cleanup surviving a restart
    5. Have the uninstall command clear every pending destination as well as the active one, moving the summary out of src/agentHooks/install/uninstallAllAgents.ts and deleting what the single owner replaces there and in src/agentHooks/install/agentHookRegistry.ts, with src/agentHooks/install/agentHookWiring.test.ts following

- [x] 4_3 One trusted, cancellable process runner — verified: bun test 'src/agentHooks/install/probeRunner.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: design.md#d14-one-process-runner-contract-absolute-and-cancellable, specs/agent-hook-installation/spec.md#an-unreachable-hook-costs-the-agent-nothing
  - **Acceptance**:
    - Outcome: The probe runs and is terminated through absolute paths with one owned deadline
    - Verify: unit src/agentHooks/install/probeRunner.test.ts
  - **Plan**:
    1. Create src/agentHooks/install/probeRunner.ts taking an absolute executable, containing error and close, owning one deadline, and terminating the process group through an absolute system path on each platform
    2. Move the probe off the runner embedded in src/agentHooks/install/ManagedConfigInstaller.ts and make the injected-runner bound exceed the deadline plus reap grace, relocating its two runner tests out of src/agentHooks/install/ManagedConfigInstaller.test.ts
    3. Create src/agentHooks/install/probeRunner.test.ts covering: a descendant terminated with its leader, a spawn failure contained rather than thrown, the reap awaited before reporting, and the outer bound not preempting it

## 5. Cycle-2 review fixes

- [x] 5_1 Make the ledger durable under concurrent and failed writes — verified: bun test 'src/agentHooks/install/managedEntryLedger.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: .reviews/round-4.md#b5, .reviews/round-4.md#b6, .reviews/round-4.md#b7, design.md#d12-ownership-is-exact-equality-against-a-ledger-of-what-we-wrote-never-a-parse-of-the-users-string
  - **Acceptance**:
    - Outcome: No writer loses another's ownership record, and a recorded command survives a failed persist
    - Verify: unit src/agentHooks/install/managedEntryLedger.test.ts
  - **Plan**:
    1. Give each agent its own key in src/agentHooks/install/managedEntryLedger.ts so no write reads a root another agent also writes, and serialize the module's own writes through one tail
    2. Canonicalize a destination before it is recorded or compared, and bound the pending list by refusing to track past a ceiling rather than dropping what is already tracked
    3. In src/agentHooks/install/ManagedConfigInstaller.ts record the command before the configuration is replaced and the destination after, so a failed persist cannot leave a written command unrecorded
    4. Cover in src/agentHooks/install/managedEntryLedger.test.ts: two agents writing against a store whose reads lag its writes and both records surviving, a command recorded before a replacement that then fails still owned, equivalent destination spellings collapsing to one pending entry, and the ceiling keeping the oldest entries and reporting the refusal

- [x] 5_2 Report uninstall per destination, over the repository's own serial queue — verified: bun test 'src/agentHooks/install/agentHookTransitions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_2
  - **Refs**: .reviews/round-4.md#b8, .reviews/round-4.md#s4, specs/agent-hook-installation/spec.md#uninstall-command-clears-every-managed-entry, design.md#d13-one-serialized-transition-owner-per-agent
  - **Acceptance**:
    - Outcome: Uninstall reports success only when every destination is clean
    - Verify: unit src/agentHooks/install/agentHookTransitions.test.ts
  - **Plan**:
    1. Extract the keyed serial queue of src/worktree/mutationQueue.ts into src/utils/keyedSerialQueue.ts with its settlement chaining, uncalled-body contract and tail cleanup intact, and create src/utils/keyedSerialQueue.test.ts over it
    2. Rebuild src/worktree/mutationQueue.ts on that primitive, keeping its depth and busy behaviour, and adjust src/worktree/mutationQueue.test.ts only where the seam moved
    3. Replace the promise tail in src/agentHooks/install/agentHookTransitions.ts with that primitive
    4. Make uninstall succeed only when every destination came back clean, keep each failed destination pending, and name in the summary what was left behind
    5. Cover in src/agentHooks/install/agentHookTransitions.test.ts: one destination clean and one refused reported as not removed with the refused one still pending, and the summary naming it

- [x] 5_3 Report an unreaped probe rather than implying a clean kill — verified: bun test 'src/agentHooks/install/probeRunner.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_3
  - **Refs**: .reviews/round-4.md#w4, specs/agent-hook-installation/spec.md#an-unreachable-hook-costs-the-agent-nothing
  - **Acceptance**:
    - Outcome: A termination that could not reach the process tree is reported, not assumed complete
    - Verify: unit src/agentHooks/install/probeRunner.test.ts
  - **Plan**:
    1. In src/agentHooks/install/probeRunner.ts surface that the fallback reached only the process leader when the absolute taskkill could not start
    2. Cover that path in src/agentHooks/install/probeRunner.test.ts with a spawn whose taskkill invocation fails, asserting the leader is still killed and the incomplete termination is reported

## 6. Cycle-2 round-5 fixes

- [x] 6_1 Move the ledger behind the same lock the configuration write uses — verified: pnpm exec vitest run 'src/agentHooks/install/managedEntryLedger.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 5_1
  - **Refs**: .reviews/round-5.md#b5, .reviews/round-5.md#w5, design.md#d15-the-ledger-is-a-lock-protected-file-under-global-storage-not-globalstate
  - **Acceptance**:
    - Outcome: A second host cannot replace an entry it never read, and a written destination is never lost
    - Verify: unit src/agentHooks/install/managedEntryLedger.test.ts
  - **Plan**:
    1. Extract the lock acquisition, stale reclaim and atomic replacement of src/agentHooks/install/ManagedConfigInstaller.ts into src/agentHooks/install/lockedJsonFile.ts so both the configuration and the ledger take the same authority, and create src/agentHooks/install/lockedJsonFile.test.ts over it
    2. Back src/agentHooks/install/managedEntryLedger.ts with that file under the storage root, reading each entry inside the lock rather than from a cached snapshot, and keeping the synchronous ownership answer served from a value refreshed on every mutation
    3. Record the written destination as pending when finalization fails after the configuration was replaced, and hold it in memory for the session so this host can still reconcile it
    4. Point src/extension.ts at the storage-root ledger instead of globalState
    5. Cover in src/agentHooks/install/managedEntryLedger.test.ts: two ledgers over one file each seeing the other's pending destination, an entry written by one not erased by the other, a stale lock reclaimed, and a finalization failure leaving the written path pending

- [x] 6_2 Stop a move that would forget a destination it cannot track — verified: pnpm exec vitest run 'src/agentHooks/install/agentHookTransitions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 5_2
  - **Refs**: .reviews/round-5.md#b8, design.md#d13-one-serialized-transition-owner-per-agent
  - **Acceptance**:
    - Outcome: A destination that can neither be cleaned nor tracked keeps the agent where it is
    - Verify: unit src/agentHooks/install/agentHookTransitions.test.ts
  - **Plan**:
    1. In src/agentHooks/install/agentHookTransitions.ts abandon the reconcile when a stale destination could neither be cleaned nor recorded, leaving the recorded destination naming it, and report which path is holding the move
    2. Cover in src/agentHooks/install/agentHookTransitions.test.ts: a full pending list with a refused cleanup leaving the recorded destination unchanged and nothing installed at the new one, that uninstall still finds it, and that the move proceeds once a slot frees

## 7. Cycle-3 round-7 fixes

- [ ] 7_1 Keep the ownership record where it outlives what it describes, and read it per operation
  - **Deps**: 6_1
  - **Refs**: .reviews/round-7.md#b9, .reviews/round-7.md#b5, .reviews/round-7.md#b6, .reviews/round-7.md#b10, design.md#d16-ownership-history-outlives-the-root-it-describes, design.md#d15-the-ledger-is-a-lock-protected-file-not-globalstate
  - **Acceptance**:
    - Outcome: A command survives a storage-root move, and no decision uses a stale ledger view
    - Verify: unit src/agentHooks/install/managedEntryLedger.test.ts
  - **Plan**:
    1. Point the ledger at the per-user path in src/extension.ts, leaving the wrapper under the storage root, and create the containing directory before the first lock attempt
    2. Give src/agentHooks/install/managedEntryLedger.ts a per-operation snapshot taken under the ledger lock, so ownership, destination and pending answers come from a read this operation made rather than from a view refreshed once per host
    3. Stop reporting a write that reached only session memory as a durable one, and refuse the pre-write command record's failure rather than continuing into the configuration write
    4. Apply the pending ceiling where session-only and stored lists merge, refusing new obligations rather than truncating existing ones
    5. Reuse src/utils/keyedSerialQueue.ts for the store's in-process serialization instead of the second chain in src/agentHooks/install/managedEntryLedger.ts
    6. Cover in src/agentHooks/install/managedEntryLedger.test.ts: two ledgers over one file where the second writes between the first's load and its uninstall sweep; a storage root that moves while the ledger path does not, with the old command still claimed; a pre-write record that cannot persist leaving the configuration untouched; and a fold of two full pending lists staying at the ceiling

- [ ] 7_2 Answer only the settings this feature owns, and let the latest desired state win
  - **Deps**: 7_1
  - **Refs**: .reviews/round-7.md#b13, design.md#d13-one-serialized-transition-owner-per-agent
  - **Acceptance**:
    - Outcome: An unrelated settings change costs nothing; a burst settles at the latest state
    - Verify: unit src/agentHooks/install/agentHookTransitions.test.ts
  - **Plan**:
    1. In src/extension.ts submit only for agents whose own settings the event touched
    2. In src/agentHooks/install/agentHookTransitions.ts hold at most one running transition per agent plus one pending rerun that carries the latest desired state, so a burst collapses to the current answer without discarding the obligation to converge
    3. Cover in src/agentHooks/install/agentHookTransitions.test.ts: an unrelated settings event enqueueing nothing, a burst of relevant events running fewer transitions than events while ending at the latest state, and the forced location-only edit still reconciling

- [ ] 7_3 Qualify every interpreter the Windows wrappers invoke
  - **Deps**: 2_3
  - **Refs**: .reviews/round-7.md#b11
  - **Acceptance**:
    - Outcome: No wrapper resolves an executable against the working directory
    - Verify: unit src/agentHooks/install/cursorConfigAdapter.test.ts
  - **Plan**:
    1. Invoke PowerShell through its absolute system path in the Windows wrapper in src/agentHooks/install/cursorConfigAdapter.ts, as the same template already does for more.com
    2. Cover in src/agentHooks/install/cursorConfigAdapter.test.ts, and in src/agentHooks/install/claudeConfigAdapter.test.ts for its own wrapper, that no emitted Windows wrapper names an unqualified executable

- [ ] 7_4 Report a termination that did not complete, however it failed
  - **Deps**: 5_3
  - **Refs**: .reviews/round-7.md#b12, design.md#d14-one-process-runner-contract-absolute-and-cancellable
  - **Acceptance**:
    - Outcome: A tree kill that did not complete is always reported as incomplete
    - Verify: unit src/agentHooks/install/probeRunner.test.ts
  - **Plan**:
    1. In src/agentHooks/install/probeRunner.ts observe the terminator's exit status as well as its spawn failure, fall back to killing the leader on a nonzero exit, and settle only once the termination outcome is known
    2. Cover in src/agentHooks/install/probeRunner.test.ts: a terminator that starts and exits nonzero reporting incomplete termination and still killing the leader

- [ ] 7_5 Write the user's configuration only when it would change
  - **Deps**: 7_3
  - **Refs**: .reviews/round-7.md#w6
  - **Acceptance**:
    - Outcome: Installing over an installation already in the desired shape leaves the file untouched
    - Verify: unit src/agentHooks/install/ManagedConfigInstaller.test.ts
  - **Plan**:
    1. In src/agentHooks/install/ManagedConfigInstaller.ts skip the replacement when the serialized result equals what was read, so an idempotent install performs no write
    2. Replace the temporary-write, chmod, rename and cleanup sequence in the wrapper path with the one src/agentHooks/install/lockedJsonFile.ts already owns
    3. Cover in src/agentHooks/install/ManagedConfigInstaller.test.ts: a second install leaving the file's modification time unchanged, and an install that must change the file still replacing it

