## 1. The form

- [x] 1_1 Lead with the branch, state the destination once, and collapse the rest — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{the-create-form-leads-with-the-branch-name, the-destination-is-stated-once-and-its-exact-value-stays-reachable, a-destination-is-named-only-once-it-is-known, derived-and-overriding-inputs-sit-behind-one-disclosure}, docs/design/worktree-actions.md#321-form-presentation
  - **Acceptance**:
    - Outcome: the form opens on the branch name with one shortened destination under it and everything else collapsed
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    0. Files: `src/webview/worktree/WorktreeCreateDialog.ts`, `src/webview/worktree/WorktreeCreateDialog.test.ts`, `src/webview/worktree/worktreePanel.css`.
    1. Order is the requirement, so move controls rather than restyle them: branch name first, the destination line under it, the repository picker below that (it stays visible — a multi-repo workspace needs it and the destination is derived from it — but "nothing above the lead input" puts it under, not in advanced), then "After creating", then the agent block, then the disclosure.
    2. The destination stops being an input in the common case. It becomes one derived line; the editable field moves inside the disclosure and keeps `pathIsDerived` as its only owner of "the user typed over it". Two controls writing `draft.path` is how the derived value and the override drift.
    3. Shortening is a display concern and the exact value must survive it. `attachTooltipDelegate` is bound to the tree element, not to a dialog mounted on the panel host, so a `data-tip` here reaches nothing — reuse `attachTooltip` on the destination line itself, which is the per-element form the same module already exports, and dispose it with the dialog. `attachTooltip` listens for focus but does not make its target focusable, so a bare `<span>` would expose the exact value to the mouse only: give the line `tabindex="0"`. `openDialogShell`'s `focusable()` already matches `[tabindex]:not([tabindex="-1"])`, so it joins the trap without a shell change — and it is an extra stop the focus-order test has to expect rather than discover.
    3b. The stated destination is the one the submission carries, so the override has to move it. Today the path input IS the display, so they cannot disagree; splitting them makes the host's answer and `draft.path` two values, and a straightforward restructure would keep showing the host default while submitting the override. The collision message goes with it: it described a derived path the create no longer takes.
    4. The collision line names the result only. The current hint names the taken path AND the resolved one; the requirement moved and one of those two is now the one to drop — keep the one the create will actually use.
    5. The disclosure follows the mechanism this dialog already has, not a second one: a toggle carrying `aria-expanded` over a region carrying `hidden`, the way the agent block is revealed. `openDialogShell`'s focus trap already filters on `[hidden]`, and a native `<details>` would need that filter widened to a construct it does not know. Refresh the trap on every toggle, as the "After creating" change already does.
    6. Cover: the opening order and initial focus; that a collapsed disclosure contributes nothing tabbable and an open one does; that the override is both what the form states and what submits, and that it withdraws the collision line; that a resolved destination is stated exactly once and the exact value is reachable by focus as well as by pointer; that an unresolved destination is not stated shortened; the collision line; detached mode gating submit on the base ref while the lead input is disabled. Dismissal and the trap are named by the blueprint's acceptance, so assert the whole set rather than the two that are easy: Tab wrapping forward and backward, focus restored to the opener, Cancel, the title's dismiss control, Escape, the scrim, and ⌘↵.

- [x] 1_2 One folder choice, both of its modes — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
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

- [x] 1_3 A posture list with no safe choice selects nothing — verified: pnpm exec vitest run 'src/webview/worktree/worktreeAgentBox.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#{a-posture-list-with-no-safe-choice-preselects-nothing}, ../../../specs/worktree-panel/spec.md#{a-dangerous-posture-is-offered-but-never-preselected}
  - **Acceptance**:
    - Outcome: an agent offering only dangerous postures opens with none selected and cannot submit
    - Verify: unit src/webview/worktree/worktreeAgentBox.test.ts
  - **Plan**:
    0. Files: `src/webview/worktree/worktreeAgentBox.ts`, `src/webview/worktree/worktreeAgentBox.test.ts`, `src/webview/worktree/WorktreeCreateDialog.ts`, `src/webview/worktree/WorktreeCreateDialog.test.ts`, `src/webview/worktree/WorktreeLaunchDialog.ts`, `src/webview/worktree/WorktreeLaunchDialog.test.ts`.
    1. `initialPosture` already refuses to preselect a dangerous choice by returning undefined, and the rendering then loses that: a `<select>` with no option carrying `selected` displays and submits its first, which in this case is dangerous. The intent is right and only the rendering betrays it — fix where the choice becomes a selection, not by changing which choice is initial.
    2. Not selected is a state the control has to be able to hold, so it needs something to sit on that is not a posture. Whatever carries it must not be submittable as one, and `read()` must return no `permissionChoiceId` while it is showing.
    3. The block is shared with the launch dialog, so both doors get this. Both submit paths gate on it — the base requirement names both, and fixing one leaves the other stating the opposite.
    4. Cover: the all-dangerous agent, which no fixture exercises today; that a mixed list still opens on its first safe choice; that switching from a mixed agent to an all-dangerous one drops the carried selection rather than keeping a posture the new agent does not offer.

- [x] 1_4 Round-1 review fixes — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_3
  - **Refs**: specs/worktree-panel/spec.md#{the-destination-is-stated-once-and-its-exact-value-stays-reachable, a-destination-is-named-only-once-it-is-known}, ../../../specs/worktree-panel/spec.md#{a-created-worktree-names-the-destination-it-will-actually-use}
  - **Acceptance**:
    - Outcome: the stated destination belongs to the repo and branch on screen, and its exact value is genuinely reachable
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    0. Files: `src/webview/worktree/WorktreeCreateDialog.ts`, `src/webview/worktree/WorktreeCreateDialog.test.ts`, `src/webview/worktree/worktreeAgentBox.test.ts`, `src/webview/worktree/worktreeFixtures.ts`, `src/webview/worktree/worktreePanel.css`.
    1. B1: the request is repo-scoped and its dedup key is not. Key on both, so no caller that changes the repo — this handler or a later one — can reuse an answer computed for a different one.
    2. W1: `attachTooltip` resolves its text at attach and hands back a no-op when it is empty, so attaching before the first destination exists attached nothing. Attach when there is something to say, once, and keep the disposer. The second carrier failed for its own reason: `aria-label` on a bare `div` is not exposed, so the exact value needs an element whose name AT will read rather than an attribute on one it will not.
    3. W2: two separators, not one. The repo carries this idiom twice already; take the idiom rather than export a file-tree helper into this dialog.
    4. W3: the override is one-way and should not be. Clearing it returns the line to the derivation, because a face showing a derivation that is switched off is worse than no override at all.
    5. W6: the apply callback replaces the repo record wholesale, agents included, and refreshes only the destination. The posture gate now reads that list, so it has to be refreshed with it.
    6. Fixtures and assertions (W4, W5): the default fixture must be able to stand in for production, which always supplies both callbacks and a resolved path — seven tests currently submit through a branch production never reaches. Delete the two assertions that cannot fail, and assert the tooltip that W1 says nothing asserts: deleting the attach must turn the suite red.
