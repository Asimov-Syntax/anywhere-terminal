# Tasks: freeze-the-first-observed-worktree-before-writing

Build the shared authorizer, mint it at the mutation seam, apply it to file provisioning, then harden target and sibling claims separately.

## 1. Directory authority

- [ ] 1_1 Extract one platform-aware component and identity owner
  - **Deps**: none
  - **Refs**: design.md D1, design.md D2, design.md D5
  - **Acceptance**:
    - Outcome: Directory authority rejects changed components and unavailable filesystem identity
    - Verify: command pnpm exec vitest run 'src/utils/authorizedDirectory.test.ts' 'src/utils/lockedFile.test.ts' 'src/agentHooks/install/lockedJsonFile.test.ts' 'src/agentHooks/install/ClaudeHookInstaller.test.ts' 'src/worktree/createPath.test.ts' 'src/worktree/gitExclude.test.ts'
  - **Plan**:
    1. `src/utils/authorizedDirectory.ts` and `src/utils/authorizedDirectory.test.ts`: own platform-specific component enumeration, nonzero identity, budgeted authorization minting, and full-chain rechecks with Windows, zero-inode, regular-root, recreated-ancestor, symlink, and expiry witnesses.
    2. `src/agentHooks/install/ClaudeHookInstaller.ts` and `src/worktree/createPath.ts`: consume the shared component and identity owner while preserving installer platform behavior and create-path dispositions.
    3. `src/utils/lockedFile.ts` and `src/utils/lockedFile.test.ts`: replace vacuous temporary and lock ownership comparisons with shared nonzero identity and cover substituted zero-inode paths.

- [ ] 1_2 Mint one authorization pair at the create mutation seam
  - **Deps**: 1_1
  - **Refs**: design.md D1, design.md D3; specs/worktree-panel/spec.md#selected-post-create-writes-retain-observed-checkout-identity
  - **Acceptance**:
    - Outcome: Mutation dependencies receive one observed source and destination pair
    - Verify: command pnpm exec vitest run 'src/worktree/worktreeMutationService.test.ts' 'src/extension.worktreeMutations.test.ts'
  - **Plan**:
    1. `src/worktree/worktreeMutationService.ts` and `src/worktree/worktreeMutationService.test.ts`: mint source and destination authorizations immediately after successful create, pass them to file provisioning and the destination to ports, and fail affected selections without changing create success or launch ordering.
    2. `src/extension.ts` and `src/extension.worktreeMutations.test.ts`: accept the widened production dependency inputs while preserving existing apply order and per-selection reporting.

- [ ] 1_3 Recheck observed roots at selected file mutations
  - **Deps**: 1_2
  - **Refs**: design.md D1, design.md D3; specs/worktree-panel/spec.md#selected-post-create-writes-retain-observed-checkout-identity
  - **Acceptance**:
    - Outcome: Unstable provisioning identity produces failed selected-file outcomes
    - Verify: command pnpm exec vitest run 'src/worktree/provisioning/entryGate.test.ts' 'src/worktree/provisioning/applyEntries.test.ts' 'src/extension.worktreeAssembly.test.ts'
  - **Plan**:
    1. `src/worktree/provisioning/entryGate.ts`, `src/worktree/provisioning/applyEntries.ts`, `src/worktree/provisioning/entryGate.test.ts`, and `src/worktree/provisioning/applyEntries.test.ts`: prepare authorized roots and recheck source and destination immediately before each selected read or destination mutation while preserving existing no-follow and containment rules.
    2. `src/extension.ts` and `src/extension.worktreeAssembly.test.ts`: bind production file provisioning to mutation-issued authorizations and witness source, ancestor, and regular-root substitution without using replacement content or destination.

- [ ] 1_4 Consume mutation-issued authority for target claims
  - **Deps**: 1_3
  - **Refs**: design.md D2, design.md D3, design.md D5; specs/worktree-panel/spec.md#selected-post-create-writes-retain-observed-checkout-identity
  - **Acceptance**:
    - Outcome: Unstable target identity prevents successful port persistence
    - Verify: unit src/worktree/worktreePorts.test.ts
  - **Plan**:
    1. `src/worktree/worktreePorts.ts` and `src/worktree/worktreePorts.test.ts`: remove target authority minting, consume the mutation-issued destination, budget every recheck before claim reading, staging, and commit, and use shared nonzero identity for final-entry source proof.

- [ ] 1_5 Require listing-time authority for sibling claims
  - **Deps**: 1_4
  - **Refs**: design.md D2, design.md D4; specs/worktree-panel/spec.md#sibling-claim-reads-sample-stable-listing-time-identity
  - **Acceptance**:
    - Outcome: Unstable sibling identity prevents fresh port allocation
    - Verify: command pnpm exec vitest run 'src/worktree/worktreePorts.test.ts' 'src/extension.worktreeMutations.test.ts' 'src/extension.worktreeAssembly.test.ts'
  - **Plan**:
    1. `src/worktree/worktreePorts.ts` and `src/worktree/worktreePorts.test.ts`: require budgeted listing-issued sibling authorizations, sample them around each claim read, and exclude the normalized target row by authorized leaf identity.
    2. `src/extension.ts`, `src/extension.worktreeMutations.test.ts`, and `src/extension.worktreeAssembly.test.ts`: authorize normalized `WorktreeInfo.id` values at the fresh listing boundary and cover raw alias display, expired authorization, and substituted sibling schedules.
