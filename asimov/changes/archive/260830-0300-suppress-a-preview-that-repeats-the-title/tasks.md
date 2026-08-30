## 1. One rule for what a preview shows

- [x] 1_1 Withhold a preview that adds nothing to the row — verified: pnpm exec vitest run 'src/webview/worktree/worktreeTreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{a-row-draws-its-preview-only-when-it-adds-something, an-agent-row-gives-its-last-activity-a-line-of-its-own}
  - **Acceptance**:
    - Outcome: a row whose preview repeats its title renders one line
    - Verify: unit src/webview/worktree/worktreeTreeView.test.ts
  - **Plan**:
    1. In `src/webview/worktree/worktreeFormat.ts`, add `presentedPreview(row: WorktreeAgentRow): string` that returns `""` when `(row.preview ?? "").trim()` is empty, returns `""` when `row.preview` equals a non-empty `stripDecorations(row.title)`, and otherwise returns `row.preview` verbatim — never running `stripDecorations` over the preview.
    2. In `src/webview/worktree/worktreeTreeView.ts`, replace `const previewText = row.preview ?? ""` in the agent-row builder with `presentedPreview(row)`, leaving the `data-tip` join and the `previewText !== ""` second-line guard reading from it unchanged.
    3. Add cases to `src/webview/worktree/worktreeFormat.test.ts` for the helper: exact repeat withheld, blank withheld, one-word difference kept, lone `*` preview against a title without it kept, and a preview reading `(untitled)` on a row with no title kept.
    4. Add cases to `src/webview/worktree/worktreeTreeView.test.ts` for the rendered row: an exact repeat produces no `.wt-apreview` element and names the sentence once in the root `data-tip`; a near-match renders the element verbatim; a marker-prefixed preview stays visible; and a row rerendered with a differing preview regains the element.
