# Tasks: offer-a-yielding-declaration-as-yielding

The apply refuses a held declaration on every volume. The dialog still checks it by default and
counts it into "N copied", so the offer promises what the apply will refuse.

- [x] 1_1 Offer a yielding declaration unselected, and say why — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Refs**: specs/worktree-panel/spec.md#a-declaration-that-will-yield-is-offered-as-yielding, asimov/changes/award-a-contested-destination-or-refuse-it/.reviews/round-3.md#f007
  - **Acceptance**:
    - Outcome: A held contender is offered unselected and says it will be refused
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts` offers a member of a favoured contest that is not the favoured one unselected, with a label saying it yields.
    2. A group with no favoured member is untouched — both stay selected.
    3. `src/webview/worktree/WorktreeCreateDialog.test.ts` witnesses both, and that the repository's own stays selected.

- [x] 1_2 Count only what will be brought over — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#a-declaration-that-will-yield-is-offered-as-yielding
  - **Acceptance**:
    - Outcome: The summary counts the selected declarations, not the yielding ones
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts` builds the summary from the rows it offers selected rather than from every entry in the model.
    2. `src/webview/worktree/WorktreeCreateDialog.test.ts` witnesses the count for a contested pair.
