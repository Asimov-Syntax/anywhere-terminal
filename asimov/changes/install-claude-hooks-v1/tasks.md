## 1. Gate integrity

- [x] 1_1 Record the non-mutating lint gate and resolved-version check — verified: grep -F 'pnpm exec biome check src' asimov/project.md && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D10
  - **Acceptance**:
    - Outcome: Project verification cannot rewrite source files.
    - Verify: command grep -F 'pnpm exec biome check src' asimov/project.md
  - **Plan**:
    1. Replace the auto-fix lint gate in asimov/project.md with `pnpm exec biome check src` and record the version-drift warning.

- [x] 1_2 Preserve the exact Cursor bridge under the formatter gate — verified: pnpm exec biome check src && cmp <(git show d31d6d17^:src/cursor/CursorHookInstaller.test.ts) src/cursor/CursorHookInstaller.test.ts exit 0
  - **Deps**: 2_1
  - **Refs**: design.md D2
  - **Acceptance**:
    - Outcome: The non-mutating Biome gate passes.
    - Verify: command pnpm exec biome check src
  - **Plan**:
    1. Add a path-specific formatter override in biome.json for src/cursor/CursorHookInstaller.test.ts; lint remains enabled and every other changed source remains formatter-checked.

## 2. Replace the rejected installer lifecycle

- [x] 2_1 Restore the Cursor-specific installer bridge — verified: bun test 'src/cursor/CursorHookInstaller.test.ts' && pnpm run check-types exit 0
  - **Deps**: 1_1
  - **Refs**: design.md D1, D2
  - **Acceptance**:
    - Outcome: Cursor retains its released configuration writer pending inline migration.
    - Verify: unit src/cursor/CursorHookInstaller.test.ts
  - **Plan**:
    1. Restore src/cursor/CursorHookInstaller.ts and src/cursor/CursorHookInstaller.test.ts exactly from `d31d6d17^`.
    2. Add src/cursor/CursorHookInstaller.runtime.test.ts against the current generic runtime and Cursor registration.

- [x] 2_2 Narrow shared outcomes and lock discipline — verified: bun test 'src/agentHooks/install/lockedJsonFile.test.ts' && pnpm run check-types exit 0
  - **Deps**: 1_1
  - **Refs**: specs/agent-hook-installation/spec.md#claude-hook-writes-fail-closed; design.md D5, D9
  - **Acceptance**:
    - Outcome: Lock cleanup failures report exact unresolved paths.
    - Verify: unit src/agentHooks/install/lockedJsonFile.test.ts
  - **Plan**:
    1. Remove age reclamation and expose non-ENOENT release failure from src/agentHooks/install/lockedJsonFile.ts with paused-holder and release-residue tests in src/agentHooks/install/lockedJsonFile.test.ts; retarget stale-lock expectations in src/agentHooks/install/ManagedConfigInstaller.test.ts and src/agentHooks/install/managedEntryLedger.test.ts pending their task 2_6 deletion.
    2. Extend src/agentHooks/AgentHookController.ts outcomes with exact unresolved paths and warning-success semantics; pin authority behavior in src/agentHooks/AgentHookController.test.ts.

- [x] 2_3 Implement destination-local Claude reconciliation — verified: bun test 'src/agentHooks/install/ClaudeHookInstaller.test.ts' && pnpm exec vitest run src/agentHooks/install/claudeConfig.test.ts && pnpm run check-types exit 0
  - **Deps**: 2_2
  - **Refs**: specs/agent-hook-installation/spec.md#{claude-hook-installation-is-opt-in-and-destination-local, claude-hook-ownership-is-exact-and-event-scoped, claude-hook-writes-fail-closed, claude-hook-removal-is-currently-derivable, windows-claude-installation-is-unsupported-until-spiked}; design.md D3, D4, D5, D6, D8
  - **Acceptance**:
    - Outcome: Claude settings converge exact current handlers at one resolved destination.
    - Verify: unit src/agentHooks/install/ClaudeHookInstaller.test.ts
  - **Plan**:
    1. Add pure resolution and group-preservation helpers in src/agentHooks/install/claudeConfig.ts with structural tests in src/agentHooks/install/claudeConfig.test.ts.
    2. Add src/agentHooks/install/ClaudeHookInstaller.ts over the narrowed dedicated reconciliation flow and cover path snapshotting, symbolic-link and malformed-input refusal, canonical-group ownership conflicts, concurrency, removal, and no-filesystem Windows behavior in src/agentHooks/install/ClaudeHookInstaller.test.ts.

- [x] 2_4 Pin the frozen Claude command through the real POSIX shell — verified: bun test 'src/agentHooks/install/ClaudeHookInstaller.test.ts' && pnpm run check-types exit 0
  - **Deps**: 2_3
  - **Refs**: specs/agent-hook-installation/spec.md#{claude-hooks-fail-open, claude-hook-payloads-stay-on-validated-loopback, background-claude-jobs-make-no-status-claim}; design.md D7
  - **Acceptance**:
    - Outcome: Only valid foreground loopback coordinates deliver Claude payloads.
    - Verify: unit src/agentHooks/install/ClaudeHookInstaller.test.ts
  - **Plan**:
    1. Export the exact D7 command from src/agentHooks/install/ClaudeHookInstaller.ts.
    2. Execute it via `/bin/sh -c` in src/agentHooks/install/ClaudeHookInstaller.test.ts with neutral output, background drain, generic encoded session ids, PATH, functions, post-entry tracing, proxy, curl startup, PIPE, EPIPE, lookup failure, and timeout controls.

- [x] 2_5 Rewire activation around current destinations — verified: bun test 'src/agentHooks/install/agentHookLifecycle.test.ts' && pnpm run check-types exit 0
  - **Deps**: 2_1, 2_4
  - **Refs**: specs/agent-hook-installation/spec.md#{claude-hook-installation-is-opt-in-and-destination-local, claude-hook-removal-is-currently-derivable}; design.md D1, D2, D6, D9
  - **Boundary**: preserve AgentHookRuntime, both agent decoders, WT-006.3 presence projection, and user-owned configuration bytes
  - **Acceptance**:
    - Outcome: Activation uses destination-local hook reconciliation.
    - Verify: unit src/agentHooks/install/agentHookLifecycle.test.ts
  - **Plan**:
    1. Add a bounded in-memory settings reconciler in src/agentHooks/install/agentHookLifecycle.ts and src/agentHooks/install/agentHookLifecycle.test.ts for execution-time setting reads, disabled and enabled location reconcile, authority revocation, ordered races, and currently derivable remove-all.
    2. Rewire src/extension.ts and package.json to explicit installers for both agents, registrations, settings events, and remove-all outcomes.

- [x] 2_6 Delete rejected ownership state and stale exemptions — verified: test ! -e src/agentHooks/install/managedEntryLedger.ts && test ! -e src/agentHooks/install/ManagedConfigInstaller.ts && test ! -e src/agentHooks/install/agentHookTransitions.ts && test -z "$(git grep -l -E 'managedEntryLedger|ManagedConfigInstaller|agentHookTransitions|createAdapterForPath|DestinationPointer' -- src/extension.ts src/agentHooks -- ':!src/agentHooks/install/lockedJsonFile.ts' || true)" && pnpm run check-types exit 0
  - **Deps**: 2_5
  - **Refs**: design.md D1, D6
  - **Boundary**: preserve the narrowed installer, lock helper, settings reconciler, runtime/controller, and both agent decoders
  - **Acceptance**:
    - Outcome: Rejected destination ownership state has no live source reference.
    - Verify: command test ! -e src/agentHooks/install/managedEntryLedger.ts && test ! -e src/agentHooks/install/ManagedConfigInstaller.ts && test ! -e src/agentHooks/install/agentHookTransitions.ts && test -z "$(git grep -l -E 'managedEntryLedger|ManagedConfigInstaller|agentHookTransitions|createAdapterForPath|DestinationPointer' -- src/extension.ts src/agentHooks -- ':!src/agentHooks/install/lockedJsonFile.ts' || true)"
  - **Plan**:
    1. Delete explicit rejected installer, ledger, transition, registry, adapter, probe, and activation files under src/agentHooks/install/ while retaining the four narrowed modules and tests; clean the retained lock-helper header.
    2. Remove stale exemptions in src/test/invariants/sourceBytes.test.ts, src/test/invariants/registry.ts, and src/test/invariants/coverage.test.ts.

## 3. Execute the real Claude boundary

- [x] 3_1 Run the exact command through real Claude Code — verified: bun scripts/verify-claude-inline-hook.mjs && git diff --check -- scripts/verify-claude-inline-hook.mjs docs/research/20260828-claude-inline-hook-spike.md exit 0
  - **Deps**: 2_6
  - **Refs**: specs/agent-hook-installation/spec.md#{claude-hooks-fail-open, claude-hook-payloads-stay-on-validated-loopback, background-claude-jobs-make-no-status-claim}; design.md D10
  - **Acceptance**:
    - Outcome: Real Claude Code delivers lifecycle payloads through the frozen command.
    - Verify: command bun scripts/verify-claude-inline-hook.mjs
  - **Plan**:
    1. Add scripts/verify-claude-inline-hook.mjs as a bounded scratch project and listener harness around installed Claude Code.
    2. Record CLI and shell versions, command hash, delivered events, excluded-source sentinels, startup probe, stderr privacy, and untouched project and user settings in docs/research/20260828-claude-inline-hook-spike.md.

## 4. Publish the narrowed contract

- [x] 4_1 Synchronize the WT-006.2 blueprint — verified: grep -A20 '\[WT-006.2\]' docs/PLAN.md | grep -q 'Claude Hook Installation v1' && git diff --check -- docs/PLAN.md docs/DESIGN.md docs/design/agent-hook-server.md exit 0
  - **Deps**: 2_6
  - **Refs**: design.md D11
  - **Acceptance**:
    - Outcome: Blueprint reflects Claude v1.
    - Verify: command grep -A20 '\[WT-006.2\]' docs/PLAN.md | grep -q 'Claude Hook Installation v1'
  - **Plan**:
    1. Narrow WT-006.2 in docs/PLAN.md while preserving its dependency and WT-006.3's completed runtime and presence contract.
    2. Update only installer-owned sections in docs/DESIGN.md and docs/design/agent-hook-server.md; retain runtime, token, and presence sections.

- [x] 4_2 Disclose the POSIX-only Claude v1 release — verified: grep -F 'Claude hook installation v1' CHANGELOG.md && git diff --check -- CHANGELOG.md exit 0
  - **Deps**: 3_1
  - **Refs**: specs/agent-hook-installation/spec.md#windows-claude-installation-is-unsupported-until-spiked; design.md D8
  - **Acceptance**:
    - Outcome: Release notes state Claude v1 support and its Windows gate.
    - Verify: command grep -F 'Claude hook installation v1' CHANGELOG.md
  - **Plan**:
    1. Add an Unreleased entry to ./CHANGELOG.md naming POSIX support, current-destination cleanup, and the real-Windows-spike gate.

- [x] 4_3 Archive superseded installer plans without applying them — verified: test ! -d asimov/changes/install-claude-hooks && test ! -d asimov/changes/remove-rejected-hook-installer && find asimov/changes/archive -maxdepth 1 -type d -name '*-install-claude-hooks' | grep -q . && grep -F "specification delta remains unapplied" asimov/changes/archive/260828-1736-install-claude-hooks/workflow.md && grep -F "no specification delta was applied" asimov/changes/archive/260828-1736-remove-rejected-hook-installer/workflow.md exit 0
  - **Deps**: 4_1, 4_2
  - **Refs**: design.md D11
  - **Acceptance**:
    - Outcome: Superseded reviews remain archived with unapplied specifications.
    - Verify: command test ! -d asimov/changes/install-claude-hooks && test ! -d asimov/changes/remove-rejected-hook-installer && find asimov/changes/archive -maxdepth 1 -type d -name '*-install-claude-hooks' | grep -q .
  - **Plan**:
    1. Add explicit superseded notes to asimov/changes/install-claude-hooks/workflow.md and asimov/changes/remove-rejected-hook-installer/workflow.md while preserving incomplete gates and evidence.
    2. Move both directories intact to asimov/changes/archive/*-install-claude-hooks/ and asimov/changes/archive/*-remove-rejected-hook-installer/ without invoking `change apply` for either.
    3. Remove only their matching markers under asimov/.analytics-open/changes/ when present.

## 5. Review round 1 remediation

- [ ] 5_1 Make Claude file authorization identity-safe and diagnostic
  - **Deps**: 4_3, 5_3
  - **Refs**: specs/agent-hook-installation/spec.md#claude-hook-writes-fail-closed; design.md D3, D5, D9; .reviews/round-1.md B1, B2
  - **Acceptance**:
    - Outcome: Claude settings reject path substitution and concurrent drift.
    - Verify: unit src/agentHooks/install/ClaudeHookInstaller.test.ts
  - **Plan**:
    1. Harden src/agentHooks/install/lockedJsonFile.ts and src/agentHooks/install/lockedJsonFile.test.ts with exclusive random temporary handles and final validation support.
    2. Rework src/agentHooks/install/ClaudeHookInstaller.ts and src/agentHooks/install/ClaudeHookInstaller.test.ts around under-lock no-follow identity checks, no-overwrite missing-file publication, bounded drift retry, and exact affected settings and lock paths.
    3. Preserve affected and unresolved paths through src/agentHooks/AgentHookController.ts and src/agentHooks/AgentHookController.test.ts diagnostics.

- [ ] 5_2 Correct location revocation and reuse the keyed queue
  - **Deps**: 4_3, 5_3
  - **Refs**: design.md D6; .reviews/round-1.md B3, W2
  - **Acceptance**:
    - Outcome: Claude location changes revoke before ordered reinstallation.
    - Verify: unit src/agentHooks/install/agentHookLifecycle.test.ts
  - **Plan**:
    1. Replace the local tail map in src/agentHooks/install/agentHookLifecycle.ts with src/utils/keyedSerialQueue.ts and pin disable-then-reread ordering in src/agentHooks/install/agentHookLifecycle.test.ts.

- [ ] 5_3 Merge the reviewed inline Cursor replacement
  - **Deps**: 4_3
  - **Refs**: design.md D2; .reviews/round-1.md B4, B5, B6
  - **Acceptance**:
    - Outcome: Cursor uses the independently reviewed inline hook implementation.
    - Verify: command bun scripts/verify-cursor-inline-hook.mjs
  - **Plan**:
    1. Merge the reviewed branch named in D2 and resolve CHANGELOG.md, asimov/project.md, src/cursor/CursorHookInstaller.ts, and src/cursor/CursorHookInstaller.test.ts by preserving current Claude v1 work plus the branch's Cursor-owned behavior.
    2. Retain the branch's asimov/changes/archive/260828-0724-inline-cursor-hooks/, asimov/specs/cursor-agent-status/spec.md, docs/audit/2026-08-28-agent-hook-recovery-plan.md, docs/research/20260828-cursor-inline-hook-spike.md, scripts/verify-cursor-inline-hook.mjs, src/cursor/CursorHookController.ts, and src/cursor/CursorHookController.test.ts without reimplementation.
    3. Remove the temporary Cursor formatter override from biome.json and verify the merged source against the existing inline review evidence.
    4. Update CHANGELOG.md with the Cursor release note without dropping the Claude v1 entry.

- [ ] 5_4 Strengthen frozen-command and ownership admission tests
  - **Deps**: 4_3, 5_3
  - **Refs**: design.md D4, D10; .reviews/round-1.md W1, S1, S2
  - **Acceptance**:
    - Outcome: Independent command bytes and every ownership/privacy boundary are pinned.
    - Verify: command bun scripts/verify-claude-inline-hook.mjs
  - **Plan**:
    1. Add the unregistered-event conflict and immutability case in src/agentHooks/install/claudeConfig.test.ts.
    2. Pin independent command byte and hash constants and payload-specific stderr sentinels in scripts/verify-claude-inline-hook.mjs and refresh docs/research/20260828-claude-inline-hook-spike.md.

