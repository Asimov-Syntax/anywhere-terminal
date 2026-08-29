## 1. The agent row's second line

- [x] 1_1 Give the agent row a second line, and take the model identifier off it — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{an-agent-row-gives-its-last-activity-a-line-of-its-own, each-of-an-agent-row-s-lines-truncates-on-its-own, a-decorative-frame-is-neither-shown-in-a-preview-nor-a-reason-to-repaint, a-list-row-does-not-name-the-model}
  - **Acceptance**:
    - Outcome: a previewed row is two lines, a preview-less one is one, and no row names a model
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    0. Files: `src/webview/worktree/worktreeTreeView.ts`, `src/webview/worktree/worktreePanel.css`, `src/webview/worktree/worktreeRenderSignature.ts`, `src/webview/worktree/WorktreeView.test.ts`, `src/webview/worktree/worktreeRenderSignature.test.ts`, `src/webview/worktree/WorktreeRemoveDialog.test.ts`.
    1. In `renderAgentRow` (`src/webview/worktree/worktreeTreeView.ts`), delete the `else if (row.model)` branch so the sixth slot carries only the external-scope chip, and update the stale comments at its head and above `.wt-arow` in the CSS, both of which still describe eight tracks and a model chip.
    2. Strip `row.preview` with `stripDecorations` (`src/webview/worktree/worktreeFormat.ts`) ONCE into a local, and append the `.wt-apreview` span only when that local is non-empty — so a decoration-only or whitespace-only preview produces no span. Write the stripped value to the span's `textContent`, its `dataset.tip`, and the row's composed `el.dataset.tip`; all three carry it today.
    3. In `src/webview/worktree/worktreePanel.css`, give `.wt-arow` seven explicit first-line columns (gutter, state, icon, title, scope, count, age) and pin those cells to `grid-row: 1`. Give `.wt-apreview` `grid-row: 2; grid-column: 4 / -1` so it starts under the title, not under the glyphs, and creates an IMPLICIT second row — an explicit `grid-template-rows: auto auto` still reserves the row gap when the child is absent.
    4. Replace `.wt-arow`'s `gap: 5px` with a separate `column-gap` and `row-gap`, or a visible preview inherits the 5px column gap as vertical separation.
    5. Delete the `.wt-model` rule and the `@container vault (max-width: 380px)` block from the CSS. The breakpoint existed because the preview competed with the title on one line; on its own line it does not, and hiding the row's most useful line by width contradicts worktree-panel-ui.md § 7.1.
    6. In `src/webview/worktree/worktreeRenderSignature.ts`, wrap `r.preview` in `stripDecorations` as `r.title` already is, and delete `r.model` from the per-row field list. Add `model` to the `NOT_RENDERED` set in `worktreeRenderSignature.test.ts` beside `pid` and `titleSourceId`, or its coverage walk fails.
    7. Cover in `WorktreeView.test.ts`: two lines with a preview, one line without, one line for a decoration-only preview, the stripped value in all three exposed places, and the age column and leading glyph tracks unchanged. In `worktreeRenderSignature.test.ts`: a spinner-only preview change leaves the signature identical, and a real preview change does not.
    8. `renderAgentRow` also draws rows inside `WorktreeRemoveDialog` (`src/webview/worktree/WorktreeRemoveDialog.ts:263-276`), which is not in this task's writes — assert in `WorktreeRemoveDialog.test.ts` that its rows survive the change rather than editing the dialog.
    9. Leave `WorktreeAgentRow.model` declared in `src/worktree/presenceTypes.ts`: the inspector is its stated home, and removing the field is WT-010.5's to do.

- [x] 1_3 Close review round 1's comment and hand-off findings — verified: manual — comment and task-text only, no behavior to observe; type check clean and 520 worktree tests green after the edits, and the full 4993-test suite runs at the Verify Gate
  - **Deps**: 1_1
  - **Refs**: .reviews/round-1.md#{s2, s3, s4}
  - **Acceptance**:
    - Outcome: the row comment, the CSS gap comment, and 1_2's steps describe the row that shipped
    - Verify: none — comment and task-text only, no behavior to observe
  - **Plan**:
    0. Files: `src/webview/worktree/worktreeTreeView.ts`, `src/webview/worktree/worktreePanel.css`, `asimov/changes/add-last-activity-preview-to-agent-rows/tasks.md`.
    1. S2: the `row-gap` comment names 5px as the vertical air while sitting above `row-gap: 1px`. State the value it guards and why it is not the column gap.
    2. S3: renumber `renderAgentRow`'s slot comments against DOM order; the preview is the second line, not a first-line slot.
    3. S4: add the external row to 1_2's narrow-width step — it is the only row whose scope column is non-empty.

- [ ] 1_2 Confirm the two-line row at the widths jsdom cannot measure
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#each-of-an-agent-row-s-lines-truncates-on-its-own
  - **Acceptance**:
    - Outcome: the preview sits under the title and both lines ellipsize, at wide and narrow widths
    - Verify: manual open the Worktree panel with an agent row that has a preview, one that has none, and one whose scope is `external`, at a wide and a narrow panel width, and confirm the preview starts under the title, both lines ellipsize rather than wrap, the age column and leading glyphs stay put even on the external row whose scope chip fills column 5, and the preview-less row is a single line with no extra vertical space
