## 1. Create dialog language and defaults

- [ ] 1_1 Make each create choice predict its effect before submit
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
