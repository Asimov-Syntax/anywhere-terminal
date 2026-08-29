# Tasks: default-the-workbench-on

- [x] 1_1 Build one toolbar, not two — verified: pnpm exec vitest run 'src/webview/vault/VaultPanel.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Refs**: specs/worktree-panel/spec.md#{the-control-that-swaps-the-body-is-separate-from-the-one-that-groups-a-body, a-control-that-chooses-among-values-says-so-and-is-reachable-by-keyboard} <!-- design.md D1, D2, D5 -->
  - **Acceptance**:
    - Outcome: the panel builds the two-level control under every configuration, and no flat four-segment control exists
    - Verify: unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. In `src/webview/vault/VaultPanel.ts` delete the `workbench` dep, the field that holds it and its transition-only comment, `setWorkbench`, and every branch that chooses between the two-level and the flat composition — the control builder, the grouping-selection coupling, the tab selection and focus paths.
    2. In `src/webview/main.ts` delete the `workbench` property from the `new VaultPanel` literal and the `vaultPanel?.setWorkbench` call inside `onWorktreeWorkbench` (design.md D2 — the literal is direct, so leaving it is a type error).
    3. In `src/webview/worktree/worktreePanel.css` delete the `vault-segmented--flat` hook and the unselected-label rule that only applies under it; leave the shared grouping and card rules alone.
    4. In `src/webview/vault/VaultPanel.test.ts` delete the cases whose subject is the flat control or a rollout transition, and drop the obsolete field from any remaining fixture.

- [x] 1_4 A selection hands the room back on its own terms — verified: pnpm exec vitest run 'src/webview/vault/collapseAfterSelection.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{a-selection-in-the-narrow-layout-hands-the-room-back} <!-- design.md D2, D3 -->
  - **Acceptance**:
    - Outcome: a stacked-layout selection collapses the rail with no setting consulted, and a docked one still does not
    - Verify: unit src/webview/vault/collapseAfterSelection.test.ts
  - **Plan**:
    1. In `src/webview/vault/collapseAfterSelection.ts` drop the `workbench` parameter and the paragraph of its docstring about reading the flag live; keep both remaining conditions and their reasons.
    2. In `src/webview/main.ts` drop the `workbench:` argument from the `shouldCollapseAfterSelection` call and the comment about reading it live. This runs before 1_2 because that argument is what reads the getter 1_2 deletes (design.md D2).
    3. Delete the flag's case in `src/webview/vault/collapseAfterSelection.test.ts` and drop the argument from the rest.

- [x] 1_2 A worktree is selectable and always in scope — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_4
  - **Refs**: specs/worktree-panel/spec.md#{a-worktree-can-be-selected-and-selection-is-an-explicit-act, selecting-a-worktree-opens-an-inspector-under-the-tree} · specs/tab-bar-component/spec.md#{scoping-is-offered-only-where-it-has-been-turned-on} <!-- design.md D2, D4, D5 -->
  - **Acceptance**:
    - Outcome: a row selects and a persisted scope takes effect with no setting consulted
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. In `src/webview/worktree/WorktreeView.ts` delete the `workbench` dep and its rollout comment, the gate at the top of `select`, and `refresh()` — which exists only so the controller's setter could repaint — and draw the card's selection marking and `aria-selected` unconditionally.
    2. In `src/webview/worktree/WorktreeController.ts` delete `init.workbench` and its rollout comment, the held flag, the getter passed to the view, `setWorkbench` (with its `view.refresh()` call) and `isWorkbenchEnabled`, and the inspector close that hung on the disabling edge.
    3. In `src/webview/main.ts` delete the `workbench` property from the `init` literal and the `worktreeController?.setWorkbench` call in `onWorktreeWorkbench`.
    4. Delete the OFF-arm cases in `src/webview/worktree/WorktreeView.test.ts` and `src/webview/worktree/WorktreeController.inspector.test.ts`, and remove the obsolete `init.workbench` initializers from `src/webview/worktree/WorktreeController.test.ts` and `src/webview/worktree/WorktreeController.state.test.ts` (helpers and per-case literals both) along with the rollout-transition case in each.
    5. In `src/webview/tabBarScope.ts` delete the `workbench` dep, the held flag, `TabBarScopePanel.setWorkbench` — which is what the controller implements, and why this cannot be a separate task — and the branches that made the effective scope, the presence subscription and the dropped-scope notice inert. In `src/webview/tabBarScopeWiring.ts` delete the flag from the wiring deps and `setWorkbench` from the interface and its implementation. In `src/webview/main.ts` drop the `wireTabBarScope` property and the now-empty `onWorktreeWorkbench` handler — the router's member is optional, so this type-checks before 2_1 removes it. Leave the persisted scope key and everything that reads or writes it alone (design.md D4), and delete the OFF-arm and transition cases in `src/webview/tabBarScope.test.ts`, `src/webview/tabBarScopeWiring.test.ts` and `src/extension.worktreeAssembly.test.ts`.
    6. `WorktreeView.test.ts`'s `mount` omits `workbench`, which today means OFF, so five cases in that suite assert the OFF arm's "expansion equals card" without saying so. Move each to the ON arm's separate `.wt-group` wrapper and selected `.wt-card` — the expanded-worktree wrapper, collapse-and-restore, restored disclosure levels, empty persisted collapse list, and first-run collapse seeding. Read them one at a time: a collapsed selected worktree keeps `.wt-card` on purpose (design.md D5).

- [ ] 2_1 Stop carrying the flag to the webview
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#{a-setting-the-panel-no-longer-reads-decides-nothing} <!-- design.md D1, D2 -->
  - **Acceptance**:
    - Outcome: no webview module names the rollout
    - Verify: command pnpm run check-types
  - **Plan**:
    1. In `src/webview/messaging/MessageRouter.ts` delete the optional handler member, its dispatch arm, and the `WorktreeWorkbenchMessage` import.
    2. Delete the OFF fixture value from `src/webview/messaging/MessageRouter.test.ts`.
    3. Grep `src/webview/` for the retired names and clear whatever is left.

- [ ] 2_2 Retire the setting
  - **Deps**: 2_1
  - **Refs**: specs/worktree-panel/spec.md#{a-setting-the-panel-no-longer-reads-decides-nothing} <!-- design.md D1, D6 -->
  - **Acceptance**:
    - Outcome: the extension declares and reads no workbench rollout setting, and a configuration that still holds one changes nothing
    - Verify: unit src/providers/TerminalViewProvider.worktree.test.ts
  - **Plan**:
    1. Delete the manifest entry in `package.json`.
    2. In `src/settings/SettingsReader.ts` delete `readWorktreeWorkbench` and `affectsWorktreeWorkbench`.
    3. In `src/providers/TerminalViewProvider.ts` and `src/providers/TerminalEditorProvider.ts` delete the two imports, the change listener, the post-init resend, and the init field on all three open paths each.
    4. In `src/types/messages.ts` delete the init field, the live-change message type, and its membership in the `ExtensionToWebviewMessage` union.
    5. Delete the rollout cases in `src/providers/TerminalViewProvider.worktree.test.ts` and `src/providers/TerminalEditorProvider.test.ts`, including the non-boolean coverage of the retired reader (design.md D6), and add one case per provider proving a configuration that still holds the key changes nothing.

- [ ] 2_3 Stop describing a setting nothing reads
  - **Deps**: 2_2
  - **Refs**: specs/worktree-panel/spec.md#{a-setting-the-panel-no-longer-reads-decides-nothing} <!-- design.md D1 -->
  - **Acceptance**:
    - Outcome: no blueprint document presents the workbench as a rollout a user can turn off
    - Verify: command bash -c '! grep -rq "anywhereTerminal.worktree.workbench" docs/'
  - **Plan**:
    1. In `docs/design/worktree-panel-ui.md` rewrite § 2.3 as the record of a finished rollout: drop the OFF-layout sentence, the runtime-follow protocol and the live-read rule for the collapse, which described machinery that no longer exists, and stop naming the retired key.
    2. In `docs/DESIGN.md` remove the setting from the rollout inventory.
