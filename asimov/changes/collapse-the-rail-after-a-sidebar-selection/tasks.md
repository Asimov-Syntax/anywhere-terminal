# Tasks: collapse-the-rail-after-a-sidebar-selection

## 1. Hand the room back after a selection

- [ ] 1_1 Collapse the rail on an explicit selection in the stacked layout
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{a-selection-in-the-narrow-layout-hands-the-room-back, a-collapse-the-user-did-not-ask-for-is-not-their-choice}
  - **Acceptance**:
    - Outcome: selecting a worktree in the stacked layout collapses the rail, and nothing else does
    - Verify: unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. In `src/webview/vault/VaultPanel.ts`, add a public `collapseAfterSelection()` that calls `this.setCollapsed(true, { persist: false })` and returns early when already collapsed, so an automatic collapse is never written into `vaultCollapsed`.
    2. In `src/webview/main.ts`, call it from the `onSelectWorktree` callback passed to `WorktreeController.mount`, alongside the existing `tabBarScope?.onSelectWorktree(worktreeId)`, and only when `msg.worktreeWorkbench` is true, the selection is a worktree rather than `null`, and the layout is the stacked one.
    3. In `src/webview/main.ts`, read the stacked-layout condition from the `webview-layout` element's `file-tree--top` / `file-tree--bottom` class the way `runAuxCollapseAnimation` already does, so one definition of the axis serves both and a user who docked the rail to a side keeps it open.
    4. In `src/webview/vault/VaultPanel.test.ts`, cover: an automatic collapse does not call `persistCollapsed`; it is inert when the rail is already collapsed; and the user's own header toggle still persists.

- [ ] 1_2 Guard what the collapse must not change
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#scope-does-not-depend-on-the-layout
  - **Acceptance**:
    - Outcome: a collapsed rail still names its scope and still offers the control that clears it
    - Verify: unit src/webview/tabBarScope.test.ts
  - **Plan**:
    1. In `src/webview/tabBarScope.test.ts`, assert that the scope chip and its clear control render identically with the vault section collapsed and expanded, and that the hidden-pane count is the same in both.
    2. Add a case asserting that a collapse changes no attribution and hides no additional pane — the rail's open state is not an input to the filter.
