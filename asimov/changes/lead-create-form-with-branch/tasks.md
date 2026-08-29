## 1. The form

- [ ] 1_1 Lead with the branch, state the destination once, and collapse the rest
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{the-create-form-leads-with-the-branch-name, the-destination-is-stated-once-and-its-exact-value-stays-reachable, a-destination-is-named-only-once-it-is-known, derived-and-overriding-inputs-sit-behind-one-disclosure}, docs/design/worktree-actions.md#321-form-presentation
  - **Acceptance**:
    - Outcome: the form opens on the branch name with one shortened destination under it and everything else collapsed
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    0. Files: `src/webview/worktree/WorktreeCreateDialog.ts`, `src/webview/worktree/WorktreeCreateDialog.test.ts`, `src/webview/worktree/worktreePanel.css`.
    1. Order is the requirement, so move controls rather than restyle them: branch name first, the destination line under it, the repository picker below that (it stays visible — a multi-repo workspace needs it and the destination is derived from it — but "nothing above the lead input" puts it under, not in advanced), then "After creating", then the agent block, then the disclosure.
    2. The destination stops being an input in the common case. It becomes one derived line; the editable field moves inside the disclosure and keeps `pathIsDerived` as its only owner of "the user typed over it". Two controls writing `draft.path` is how the derived value and the override drift.
    3. Shortening is a display concern and the exact value must survive it. `attachTooltipDelegate` is bound to the tree element, not to a dialog mounted on the panel host, so a `data-tip` here reaches nothing — reuse `attachTooltip` on the destination line itself, which is the per-element form the same module already exports, and dispose it with the dialog.
    4. The collision line names the result only. The current hint names the taken path AND the resolved one; the requirement moved and one of those two is now the one to drop — keep the one the create will actually use.
    5. The disclosure follows the mechanism this dialog already has, not a second one: a toggle carrying `aria-expanded` over a region carrying `hidden`, the way the agent block is revealed. `openDialogShell`'s focus trap already filters on `[hidden]`, and a native `<details>` would need that filter widened to a construct it does not know. Refresh the trap on every toggle, as the "After creating" change already does.
    6. Cover: the opening order and initial focus; that a collapsed disclosure contributes nothing tabbable and an open one does; that the override the user typed is what submits; that a resolved destination is stated exactly once and the exact value is reachable; that an unresolved destination is not stated shortened; the collision line; and that Escape, the scrim, and ⌘↵ behave as they did.

- [ ] 1_2 One folder choice, both of its modes
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{every-open-after-mode-is-reachable-from-the-offered-choices, the-agent-block-is-revealed-only-when-an-agent-was-asked-for}, docs/design/worktree-actions.md#321-form-presentation
  - **Acceptance**:
    - Outcome: one folder choice reaches both of its wire modes through a secondary control
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    0. Files: `src/webview/worktree/WorktreeCreateDialog.ts`, `src/webview/worktree/WorktreeCreateDialog.test.ts`, `src/webview/worktree/worktreePanel.css`.
    1. The four choices are a presentation over the wire values, so keep `WorktreeOpenAfter` as it is and map at the edge. The draft still carries one wire value; what changes is that two of them are reached through one choice plus a secondary control.
    2. The secondary control is revealed by the folder choice the same way the agent block is revealed by the agent choice — one reveal idiom in this dialog, and the same focus-trap refresh.
    3. `rebuildAfterOptions` already withdraws a choice a repo cannot perform and resets the draft when it does. The folder choice is always performable, so it must not be caught by that withdrawal, and the secondary selection must survive a repo switch that leaves the choice standing.
    4. The agent block's reveal rule is already implemented and unpinned by any test that would notice it moving. Pin it here rather than trusting the restructure left it alone — including that nothing agent-shaped is tabbable while it is absent, and that a non-agent create submits no agent details.
    5. Cover: both folder modes submitting their own wire value; every open-after mode reachable from the form; the secondary control absent for the other three choices; a repo switch that withdraws the agent choice leaving the folder choice and its selection intact.
