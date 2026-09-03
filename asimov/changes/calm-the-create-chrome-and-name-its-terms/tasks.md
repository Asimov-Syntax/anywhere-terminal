## 1. Give the secondary actions a secondary weight

- [x] 1_1 Style the empty-state and save actions as secondary — verified: pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeCreateDialog.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{a-secondary-action-does-not-carry-a-primary-action-s-weight}
  - **Boundary**: No change to the vault panel's own empty states, and no change to what either action does when pressed
  - **Acceptance**:
    - Outcome: Neither the tree's inline create nor the provisioning save is painted as the surface's primary button
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/worktreePanel.css` — scope a secondary treatment to `.wt-empty-inline .vault-empty-action` so the shared atom keeps its primary paint elsewhere, and give `.wt-bring-save-row`, `.wt-bring-save` and `.wt-bring-save-note` the rules they never had: a secondary button with the note stacked beneath it.
    2. `src/webview/worktree/WorktreeView.test.ts` and `src/webview/worktree/WorktreeCreateDialog.test.ts` — witness the rules against the stylesheet source, the way this suite already reads paint jsdom does not load.

## 2. Say what a term means where it is used

- [ ] 2_1 Name the disclosure and explain the git terms of art
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{a-disclosure-names-what-it-hides,a-term-of-art-carries-its-own-explanation}
  - **Boundary**: No new control, no change to any default, and no explanation that requires opening a second surface to read
  - **Acceptance**:
    - Outcome: The collapsed region names its contents and each term of art carries a hover and assistive explanation
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts` — name the disclosure by what it holds, and attach a `title` plus an assistive description to the detached-checkout toggle, the base ref label and the destination override label.
    2. `src/webview/worktree/WorktreeCreateDialog.test.ts` — witness the disclosure's name and each control's explanation, including that reading one changes no draft value.
