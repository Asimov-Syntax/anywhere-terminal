# Tasks: never-release-a-lock-a-pending-write-still-owns

The shared acquisition/write gate precedes both consumers. Repository-local exclude proves the generic API before port publication adds its warning contract.

## 1. Deadline-aware locked mutation

- [x] 1_1 Add a latched acquisition and mutation gate to LockedFile — verified: pnpm exec vitest run 'src/utils/lockedFile.test.ts' 'src/agentHooks/install/lockedJsonFile.test.ts' 'src/worktree/gitExclude.test.ts' 'src/worktree/worktreePorts.test.ts' && pnpm run check-types && pnpm exec vitest run --maxWorkers=4 > /tmp/retained-lock-primitive-recorded.log 2>&1 exit 0
  - **Deps**: none
  - **Refs**: design.md D1, design.md D2, design.md D3, design.md D5, design.md D6
  - **Acceptance**:
    - Outcome: Deadline expiry reports its lock-retention state
    - Verify: command pnpm exec vitest run 'src/utils/lockedFile.test.ts' 'src/agentHooks/install/lockedJsonFile.test.ts' 'src/worktree/gitExclude.test.ts' 'src/worktree/worktreePorts.test.ts'
  - **Plan**:
    1. `src/utils/lockedFile.ts` and `src/utils/lockedFile.test.ts`: add the structural deadline overload before acquisition, permanent wall-clock and timer latch, guarded exclusive open and staged mutations, clean and dirty outcomes, late-promise observation, and bounded successor-safe release.
    2. `src/utils/lockedFile.ts` and `src/utils/lockedFile.test.ts`: split create publication from safe post-commit cleanup, route internal stage-failure cleanup through the gate, add close-only abandonment for late staged resources, and witness every stalled boundary, timer and clock disagreement, clean expiry, successor substitution, handle closure, and second-process exclusion.

- [x] 1_2 Adopt the mutation gate for repository-local excludes — verified: bun test 'src/worktree/gitExclude.test.ts' && pnpm run check-types && pnpm exec vitest run --maxWorkers=4 > /tmp/retained-lock-exclude-recorded.log 2>&1 exit 0
  - **Deps**: 1_1
  - **Refs**: design.md D2, design.md D7, design.md D8
  - **Acceptance**:
    - Outcome: Timed-out exclude mutation reports its serialization state
    - Verify: unit src/worktree/gitExclude.test.ts
  - **Plan**:
    1. `src/worktree/gitExclude.ts` and `src/worktree/gitExclude.test.ts`: accept a caller-owned worktree `Deadline` or mint one for standalone use, pass its gate through atomic replacement, return distinct clean-timeout and retained-lock failure data, log retained paths, and cancel only a locally owned timer after settlement, and preserve exact-line idempotence and existing read and publication failures.

- [x] 1_3 Bound port publication and report retained locks truthfully — verified: pnpm exec vitest run 'src/worktree/worktreePorts.test.ts' 'src/types/messages.contract.test.ts' 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run check-types && pnpm exec vitest run --maxWorkers=4 exit 0
  - **Deps**: 1_1, 1_2
  - **Refs**: design.md D1, design.md D4, design.md D5, design.md D6, design.md D7; specs/worktree-panel/spec.md#{a-dirty-port-write-timeout-retains-serialization, a-clean-port-write-timeout-releases-serialization, an-expired-port-write-starts-no-later-publication, successful-work-remains-successful-when-cleanup-is-late}
  - **Acceptance**:
    - Outcome: Timed-out port publication returns failures plus accurate lock warnings
    - Verify: command pnpm exec vitest run 'src/worktree/worktreePorts.test.ts' 'src/types/messages.contract.test.ts' 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types
  - **Plan**:
    1. `src/worktree/worktreePorts.ts` and `src/worktree/worktreePorts.test.ts`: replace the private numeric clock with one worktree `Deadline` spanning port-lock acquisition through exclude update, gate publication and prepublication cleanup, bound inode-owned post-commit cleanup, map retained states and cleanup failures truthfully, preserve committed success, and cancel only after settlement.
    2. `src/types/messages.ts` and `src/types/messages.contract.test.ts`: add `lockRetained` and `temporaryCleanupFailed` as distinct `ProvisionPortWarning` values without changing path or command authority.
    3. `src/webview/worktree/WorktreeView.ts` and `src/webview/worktree/WorktreeView.test.ts`: render retained-lock and staged-temporary cleanup guidance separately from release failure, keeping authoritative successes unchanged.

- [x] 1_4 Close round-1 deadline and reporting findings — verified: pnpm exec vitest run 'src/utils/lockedFile.test.ts' 'src/worktree/worktreePorts.test.ts' 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run check-types && pnpm exec vitest run --maxWorkers=4 exit 0
  - **Deps**: 1_3
  - **Refs**: design.md D1, design.md D2, design.md D3, design.md D4, design.md D5, design.md D6, design.md D7; .reviews/round-1.md F001, F002, F003, F004, F005
  - **Acceptance**:
    - Outcome: Deadline classification follows mutation capability and committed state while preview and retained-lock guidance remain truthful
    - Verify: command pnpm exec vitest run 'src/utils/lockedFile.test.ts' 'src/worktree/worktreePorts.test.ts' 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types
  - **Plan**:
    1. `src/utils/lockedFile.ts` and `src/utils/lockedFile.test.ts`: latch wall-clock-first expiry at protected-operation settlement, distinguish bounded observations from dirty mutations, and make rename the replace commit point before handle cleanup; add acquisition, publication, read-only observation, and stalled-close witnesses.
    2. `src/worktree/worktreePorts.ts` and `src/worktree/worktreePorts.test.ts`: route preview through the shared ancestor-aware nonzero directory authorization under its existing budget and remove the competing leaf-only helper.
    3. `src/webview/worktree/WorktreeView.ts` and `src/webview/worktree/WorktreeView.test.ts`: make retained-lock guidance source-neutral and accurate for both port-claim and repository-local exclude locks.
