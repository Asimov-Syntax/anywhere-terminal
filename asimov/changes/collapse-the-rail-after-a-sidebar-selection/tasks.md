# Tasks: collapse-the-rail-after-a-sidebar-selection

## 1. Hand the room back after a selection

- [x] 1_1 Collapse the rail on an explicit selection in the stacked layout — verified: pnpm exec vitest run 'src/webview/vault/VaultPanel.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
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

- [x] 1_2 Keep presence flowing to a surface that holds a scope — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.state.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{a-surface-holding-a-scope-keeps-receiving-presence, scope-does-not-depend-on-the-layout}
  - **Acceptance**:
    - Outcome: a scoped surface keeps receiving presence with the rail collapsed
    - Verify: unit src/webview/worktree/WorktreeController.state.test.ts
  - **Plan**:
    1. In `src/webview/worktree/WorktreeController.ts`, add an optional dep `presenceNeeded?: () => boolean` and keep the value last passed to `setVisible` in a field separate from the effective one.
    2. In `src/webview/worktree/WorktreeController.ts`, make `setVisible` compute the effective value as the requested value OR `presenceNeeded()`, and post `worktreeViewVisibility` only when the effective value changes, so an idempotent call still posts nothing.
    3. In `src/webview/worktree/WorktreeController.ts`, add a public `revalidateVisibility()` that recomputes the effective value from the stored request and the current `presenceNeeded()`, for the edge where a scope is set or cleared while the rail state has not moved.
    4. In `src/webview/main.ts`, pass `presenceNeeded: () => tabBarScope?.effectiveScope() !== undefined` when mounting the controller, and call `worktreeController?.revalidateVisibility()` from the `render` callback the scope wiring already invokes on every scope change.
    5. In `src/webview/worktree/WorktreeController.state.test.ts`, cover: collapsing while scoped posts no `worktreeViewVisibility: false`; clearing the scope while collapsed posts it then; a scope set while collapsed posts `true` and requests the tree; and the shipped behaviour with no `presenceNeeded` dep is unchanged.
