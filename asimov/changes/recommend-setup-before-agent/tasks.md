## 1. Recommend the order the create will run in

- [x] 1_1 Default the wait to on, and say what it sequences — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/extension.worktreeAssembly.test.ts && pnpm run check-types && pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/extension.worktreeAssembly.test.ts exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{agent-startup-honours-the-setup-wait-choice,an-explicit-overlap-choice-is-never-silently-reversed}
  - **Boundary**: No message shape, host authority, execution order, or setup-row default change; the gate's meaning on the wire is unchanged
  - **Acceptance**:
    - Outcome: A selected setup step arms the wait by default, explains the resulting order, and never overrides an explicit user choice
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts` — arm the wait when a setup selection first exists, remember an explicit user choice against later selection changes, and render the order it produces.
    2. `src/webview/worktree/WorktreeCreateDialog.test.ts` — witness the recommended default, the preserved overlap choice, the emptied-and-refilled selection, the disabled state, and the unchanged submitted field.
    3. `src/extension.worktreeAssembly.test.ts` — keep the shipped ungated and gated agent paths true under the new default.
