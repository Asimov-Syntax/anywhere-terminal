# Tasks: split-the-view-toggle-from-grouping

## 1. The two-level control

- [x] 1_1 Build the primary body toggle and demote grouping into the sessions body — verified: pnpm exec vitest run 'src/webview/vault/VaultPanel.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{the-control-that-swaps-the-body-is-separate-from-the-one-that-groups-a-body, a-view-recorded-by-an-older-build-keeps-its-meaning, a-control-is-offered-only-in-the-body-it-acts-on}
  - **Acceptance**:
    - Outcome: the toolbar names both bodies, and grouping renders only inside the sessions body
    - Verify: unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. Add `workbench?: boolean` to `VaultPanelDeps` in `src/webview/vault/VaultPanel.ts` and store it on the panel; pass `workbench: msg.worktreeWorkbench` at the `new VaultPanel({…})` call in `src/webview/main.ts`.
    2. In the constructor of `src/webview/vault/VaultPanel.ts`, keep today's single four-button `.vault-segmented` tablist verbatim when `workbench` is false, so a build with the setting off renders exactly what it renders now.
    3. When `workbench` is true, build a second tablist `div.vault-view-toggle` with `role="tablist"`, `aria-label="View"`, and two buttons carrying `data-view="worktree"` (label `Worktrees`, `ICON_BRANCH`) and `data-view="sessions"` (label `Sessions`, `ICON_RECENT`); append it to `toolbar` before the create button. Both buttons always render their `.vault-segmented-label` span.
    4. When `workbench` is true, build `.vault-segmented` with only the three grouping buttons (`recent`, `agent`, `folder`) and append it as the FIRST child of `this.bodyEl` rather than to `toolbar`, wrapped in `div.vault-groupbar`.
    5. In `syncView()`, set `this.groupBarEl.hidden = worktree` so the grouping control occupies no space in the Worktree body; leave the existing `folderToggleEl` / `statusEl` / create / refresh gating unchanged.
    6. Extend `syncSegmented()` to also mark the `.vault-view-toggle` buttons, setting `aria-selected` from `this.view`; in `setGroupMode()`, take the "picking a grouping leaves the Worktree body" branch only when `workbench` is false — under the two-level control the grouping tablist is not reachable from that body.

- [x] 1_2 Give both levels real tab semantics and keyboard operation — verified: pnpm exec vitest run 'src/webview/vault/VaultPanel.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#a-control-that-chooses-among-values-says-so-and-is-reachable-by-keyboard
  - **Acceptance**:
    - Outcome: arrow keys move between a control's values and select the one they land on
    - Verify: unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. In `src/webview/vault/VaultPanel.ts`, add a private `wireTablist(el: HTMLElement, select: (btn: HTMLButtonElement) => void)` that gives the tablist roving focus: the selected button carries `tabindex="0"` and every other button `tabindex="-1"`.
    2. Have `syncSegmented()` set that `tabindex` pair on both tablists from the same `aria-selected` computation it already performs, so focus order follows selection.
    3. In `wireTablist`, bind `keydown`: `ArrowRight`/`ArrowDown` move to the next button and `ArrowLeft`/`ArrowUp` to the previous, both wrapping; `Home` and `End` move to the first and last; each calls `select` on the button it lands on and then focuses it, and calls `preventDefault()`.
    4. Call `wireTablist` for both the `.vault-view-toggle` and the `.vault-groupbar` tablist, and only when `workbench` is true — the shipped control keeps the focus behaviour it has today.

- [x] 1_3 Retire the label squeeze with the control that caused it — verified: pnpm exec vitest run 'src/webview/vault/VaultPanel.test.ts' && pnpm run check-types && pnpm run test:unit && pnpm exec biome check src/webview/vault/vaultPanel.css src/webview/worktree/worktreePanel.css exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#the-control-that-swaps-the-body-is-separate-from-the-one-that-groups-a-body
  - **Acceptance**:
    - Outcome: no control drops a value's label at any panel width under the workbench setting
    - Verify: unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. In `src/webview/vault/VaultPanel.ts`, add the class `vault-segmented--flat` to the `.vault-segmented` element only on the `workbench === false` construction path, so the shipped four-segment control is selectable on its own.
    2. In `src/webview/worktree/worktreePanel.css`, narrow the `@container vaultbar (max-width: 400px)` label-hiding rule to `.vault-segmented--flat button[aria-selected="false"] .vault-segmented-label`, and rewrite the comment above it to say the rule exists for the shipped flat control and is retired with it.
    3. In `src/webview/vault/vaultPanel.css`, style `.vault-view-toggle` with the same rules `.vault-segmented` already carries (inline-flex, 2px gap, and its button, hover, selected and focus-visible rules), and style `.vault-groupbar` as a row of the sessions body with the panel's existing horizontal padding above the list.

## 2. Round-1 review fixes

- [x] 2_1 Stack the grouping strip, and follow the rollout at runtime — verified: pnpm exec vitest run 'src/webview/vault/VaultPanel.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_3
  - **Refs**: specs/worktree-panel/spec.md#{the-control-that-swaps-the-body-is-separate-from-the-one-that-groups-a-body, a-control-is-offered-only-in-the-body-it-acts-on}
  - **Acceptance**:
    - Outcome: the grouping strip sits above the list, and a rollout flip recomposes the panel
    - Verify: unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. In `src/webview/vault/vaultPanel.css`, add `flex-direction: column` to `.vault-body` and `flex: 0 0 auto` to `.vault-groupbar`, so the strip sits above `.vault-list` instead of taking a column beside it (round-1 B1).
    2. In `src/webview/vault/VaultPanel.test.ts`, assert that rule by reading `vaultPanel.css` the way `src/webview/worktree/WorktreeView.test.ts` reads `worktreePanel.css` — jsdom computes no layout, so the file is the only place the invariant is observable.
    3. In `src/webview/vault/VaultPanel.ts`, extract the control construction from the constructor into a private `composeControls()` that removes any controls already mounted, rebuilds them for the current `workbench` value, mounts the level-1 control into the toolbar and the level-2 strip as the first child of `this.bodyEl`, then calls `syncView()` and `syncSegmented()`.
    4. In `src/webview/vault/VaultPanel.ts`, add a public `setWorkbench(enabled: boolean)` that returns early when the value is unchanged and otherwise records it and calls `composeControls()`; `view` and `groupMode` are panel state and are preserved across the recomposition.
    5. In `src/webview/main.ts`, call `vaultPanel?.setWorkbench(msg.enabled)` from `onWorktreeWorkbench` alongside the existing `tabBarScope` and `worktreeController` routing, on both the enable and the disable path and on the post-initialization resend.
