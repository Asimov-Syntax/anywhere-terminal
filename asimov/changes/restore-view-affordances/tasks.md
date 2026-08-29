# Tasks — restore-view-affordances

## 1. Controls appear where they belong

- [x] 1_1 Reset `[hidden]` in the shared webview stylesheet so every hidden control disappears — verified: pnpm exec vitest run 'src/providers/webviewHtml.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#a-control-is-offered-only-in-the-body-it-acts-on
  - **Acceptance**:
    - Outcome: hiding any webview control removes it from the toolbar
    - Verify: unit src/providers/webviewHtml.test.ts
  - **Plan**:
    1. Add a `[hidden] { display: none !important; }` rule to the global style block in `src/providers/webviewHtml.ts`, placed after the imported panel stylesheets so no author `display` outranks it.
    2. Assert the generated HTML carries that reset in `src/providers/webviewHtml.test.ts`, so removing it goes red. This is the only honest tripwire — jsdom reports `display: none` for a `hidden` element whether or not the reset exists, so a computed-style assertion cannot fail for this defect.
    3. Assert in `src/webview/vault/VaultPanel.test.ts` that switching to the worktree body hides the folder-scope filter and reveals the create control, and that switching back reverses both.

## 2. Hover hints reach the user

- [x] 2_1 Add a delegated mode to the shared tooltip widget — verified: pnpm exec vitest run 'src/webview/ui/Tooltip.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/vault-panel/spec.md#a-row-s-abbreviated-content-is-reachable-on-hover-and-on-focus
  - **Acceptance**:
    - Outcome: one listener set on a container serves every descendant carrying the hint attribute
    - Verify: unit src/webview/ui/Tooltip.test.ts
  - **Plan**:
    1. Export a delegate attach from `src/webview/ui/Tooltip.ts` that binds one listener set to a container, resolves the hovered or focused target with `closest()`, and reads its hint from a data attribute at show time so a rebuilt row needs no re-attach. Reuse the existing widget, delay, positioning, and `aria-describedby` handling — do not add a second widget.
    2. Cover in `src/webview/ui/Tooltip.test.ts`: a descendant added after attach still gets its hint; a container rebuilt while a hint is showing leaves nothing on screen; keyboard focus shows the hint as pointer hover does; disposing the delegate stops it.

- [x] 2_2 Deliver the worktree tree's hints through the delegate — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: specs/worktree-panel/spec.md#an-open-worktree-is-marked-without-claiming-exclusivity <!-- existing: asimov/specs/worktree-panel/spec.md#no-row-exposes-a-filesystem-path -->
  - **Acceptance**:
    - Outcome: hovering a worktree row presents its branch, path, and lock reason
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. In `src/webview/worktree/worktreeTreeView.ts`, replace every native `title` assignment with the delegate's hint attribute, keeping the text each site already produces.
    2. Attach the delegate once to the tree root in `src/webview/worktree/WorktreeView.ts` and dispose it with the view; the root survives `replaceChildren`, so no per-render bookkeeping is added.
    3. Retarget the existing assertions in `WorktreeView.test.ts` that read `.title` — they pass today while nothing renders — and add one that the hint is actually presented on hover.

- [x] 2_3 Deliver the vault session list's hints through the delegate — verified: pnpm exec vitest run 'src/webview/vault/VaultPanel.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: specs/vault-panel/spec.md#a-row-s-abbreviated-content-is-reachable-on-hover-and-on-focus
  - **Acceptance**:
    - Outcome: a truncated session row presents its full text on hover
    - Verify: unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. In `src/webview/vault/vaultListView.ts`, replace the native `title` assignments on rows, agent dots, cwd chips, resume actions, and group headers with the delegate's hint attribute.
    2. Attach the delegate once to the list root in `src/webview/vault/VaultPanel.ts`, registering its disposer alongside the two existing `attachTooltip` calls. Leave those two alone — they use dynamic text and are not rebuilt.

## 3. The workspace-folder mark reads honestly

- [x] 3_1 Rename the `here` pill so it cannot be read as the user's location — verified: pnpm exec vitest run 'src/webview/worktree/worktreeFormat.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_2
  - **Refs**: specs/worktree-panel/spec.md#an-open-worktree-is-marked-without-claiming-exclusivity
  - **Acceptance**:
    - Outcome: a worktree open as a workspace folder reads `open`, and several rows may
    - Verify: unit src/webview/worktree/worktreeFormat.test.ts
  - **Plan**:
    1. Rename the pill's text and kind in `src/webview/worktree/worktreeFormat.ts`, and its hint to state the worktree is open as a workspace folder.
    2. Follow the kind through the class name in `src/webview/worktree/worktreeTreeView.ts` and the selector in `src/webview/worktree/worktreePanel.css`.
    3. Update `worktreeFormat.test.ts` and add a case proving two worktrees open at once both carry the mark.
