## 1. Live tree

- [x] 1_1 Carry repository presence to the webview on init — verified: pnpm exec vitest run src/worktree/hasGitRepo.test.ts src/providers/WorktreeHost.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#the-panel-opens-on-the-view-the-workspace-earns <!-- design.md D1 -->
  - **Acceptance**:
    - Outcome: Every init message says whether the workspace holds a git repository
    - Verify: command pnpm exec vitest run src/worktree/hasGitRepo.test.ts src/providers/WorktreeHost.test.ts
  - **Plan**:
    1. add src/worktree/hasGitRepo.ts — the D1 probe over the workspace folders, with an injectable `exists`
    2. add `initPayload()` to src/providers/WorktreeHost.ts returning `{ worktreeHasRepo }`
    3. add the required `worktreeHasRepo` field to `InitMessage` in src/types/messages.ts
    4. spread `this.worktreeHost?.initPayload() ?? { worktreeHasRepo: false }` into every init post in src/providers/TerminalViewProvider.ts and src/providers/TerminalEditorProvider.ts

- [x] 1_2 Drive the Worktree view from the host's tree — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{the-panel-shows-the-workspace-s-own-worktrees, a-row-is-never-offered-an-action-it-cannot-perform} <!-- design.md D2, D3, D4, D5 -->
  - **Acceptance**:
    - Outcome: The Worktree segment shows the workspace's worktrees and updates as they change
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. add src/webview/worktree/WorktreeController.ts — mount, visibility posting, tree request, response → `setData`, and the three render states
    2. make `actions` and `onActivateAgent` optional in src/webview/worktree/WorktreeView.ts, and `onContextMenu` optional in src/webview/worktree/worktreeTreeView.ts so no listener swallows the right-click when there is no menu
    3. add `onWorktreeTreeResponse` to src/webview/messaging/MessageRouter.ts, and `onWorktreeVisibility` to src/webview/vault/VaultPanel.ts — it owns both halves of `view × collapsed`
    4. mount the controller in src/webview/main.ts in place of `createWorktreePreview`, wire `onWorktreeRefresh` to a forced request, and delete src/webview/worktree/worktreePreview.ts

- [x] 1_3 Open on the earned view and keep the state a reload restores — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.state.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1, 1_2
  - **Refs**: specs/worktree-panel/spec.md#{the-panel-opens-on-the-view-the-workspace-earns, a-chosen-view-survives-a-reload} <!-- design.md D1 -->
  - **Acceptance**:
    - Outcome: The panel opens on the body the workspace earns, and a recorded choice wins
    - Verify: unit src/webview/worktree/WorktreeController.state.test.ts
  - **Plan**:
    1. export `resolveInitialView(persisted, hasRepo)` from src/webview/worktree/WorktreeController.ts and call it from `getInitialView` in src/webview/main.ts, persisting nothing it derives
    2. cover the persisted round trip: state written without the worktree keys, a collapsed set that is empty, and ids a live push drops
