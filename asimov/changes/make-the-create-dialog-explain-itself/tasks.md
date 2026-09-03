## 1. Create dialog language and defaults

- [x] 1_1 Make each create choice predict its effect before submit — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/worktreeAgentBox.test.ts src/webview/worktree/WorktreeController.test.ts src/extension.worktreeAssembly.test.ts && pnpm run check-types && pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/worktreeAgentBox.test.ts src/webview/worktree/WorktreeController.test.ts src/extension.worktreeAssembly.test.ts exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{the-create-form-opens-on-a-safe-useful-after-create-action, repository-changes-preserve-the-chosen-after-create-action, each-after-create-action-states-its-consequence, the-provisioning-save-action-names-what-it-persists, clearing-an-occupied-destination-is-named-as-deletion, a-disabled-create-action-states-what-it-is-waiting-for, the-agent-block-is-revealed-only-when-an-agent-was-asked-for, a-save-that-has-nothing-to-record-writes-nothing}; design.md D1, D2, D3, D4
  - **Boundary**: No message shape, host authority, execution order, destructive default, or dangerous permission default changes
  - **Acceptance**:
    - Outcome: The create dialog opens safely and explains every consequential action and disabled state
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/worktreeAgentBox.test.ts src/webview/worktree/WorktreeController.test.ts src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts` and `src/webview/worktree/worktreeAgentBox.ts` — default the after-create choice per D2; add the dynamic action hint and truthful save, clear, and disabled-state text.
    2. `src/webview/worktree/WorktreeCreateDialog.test.ts`, `src/webview/worktree/worktreeAgentBox.test.ts`, `src/webview/worktree/WorktreeController.test.ts` and `src/extension.worktreeAssembly.test.ts` — witness all defaults, repository switches, hints, disabled states, clear evidence, and unchanged submitted authority.
    3. `src/webview/worktree/worktreePanel.css` — reuse compact dialog styles and keep the action row visible in short viewports.

- [x] 1_2 Reconcile the explanatory UI with review round 1 — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/worktreeAgentBox.test.ts src/webview/worktree/WorktreeController.test.ts src/extension.worktreeAssembly.test.ts && pnpm run check-types && pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/worktreeAgentBox.test.ts src/webview/worktree/WorktreeController.test.ts src/extension.worktreeAssembly.test.ts exit 0
  - **Deps**: 1_1
  - **Refs**: design.md D2, D3; .reviews/round-1.md F001, F002, F003, F004, F005
  - **Boundary**: No message shape, host authority, execution order, destructive default, or new browser-test dependency changes
  - **Acceptance**:
    - Outcome: The dialog uses one safe-posture policy, mode-neutral truthful hints, and a complete disabled-reason witness inventory
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/worktreeAgentBox.test.ts src/webview/worktree/WorktreeController.test.ts src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/webview/worktree/worktreeAgentBox.ts` and `src/webview/worktree/WorktreeCreateDialog.ts` — centralize the initial-safe-agent policy and make every after-create hint true for no-axis, pending-posture, repair, and adoption states.
    2. `src/webview/worktree/WorktreeCreateDialog.test.ts` and `src/webview/worktree/worktreeAgentBox.test.ts` — cover the shared safe selection and every disabled-reason arm, priority, accessible association, and enabled state.
    3. `src/extension.worktreeAssembly.test.ts` — remove the source-text assertion that claimed to prove browser layout; the browser witness remains the declared follow-up because this repository has no browser layout test lane.
