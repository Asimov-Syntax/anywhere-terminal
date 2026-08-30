## 1. A bounded projection

- [x] 1_1 Let a session be asked without being looked at — verified: pnpm exec vitest run 'src/worktree/sessionPreviewService.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-agent-presence/spec.md#a-row-the-bound-excludes-keeps-its-line-and-is-looked-at-later <!-- design.md D3 -->
  - **Acceptance**:
    - Outcome: an ask that may not look returns the held line and starts no work
    - Verify: unit src/worktree/sessionPreviewService.test.ts
  - **Plan**:
    1. In `src/worktree/sessionPreviewService.ts`, give `preview` a second parameter for whether this ask may look, defaulting to the behaviour it has today.
    2. When it may not: return the line already held, touching the session in the LRU; answer a session that was never held without inserting one.

- [x] 1_2 Spend one budget across the whole projection — verified: pnpm exec vitest run 'src/worktree/presenceProjector.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-agent-presence/spec.md#one-projection-provokes-a-bounded-number-of-transcript-looks, specs/worktree-agent-presence/spec.md#a-row-the-bound-excludes-keeps-its-line-and-is-looked-at-later <!-- design.md D1, D2, D4 -->
  - **Acceptance**:
    - Outcome: a projection over many rows permits no more looks than its budget
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Plan**:
    1. In `src/worktree/presenceProjector.ts`, widen the `sessionPreview` dep to carry whether the ask may look, and add the budget to the projector's options with a default constant.
    2. Replace `previewFromVault`'s per-worktree loop with one flattened pass over every row that has an `entryId`, awaited as a single wave, writing each preview back to the row it came from.
    3. Hold a rotation cursor on the projector's closure; grant the budget to the rows starting at it, wrapping, then advance it by the budget.
    4. Mirror the widened dep in `src/worktree/presenceDeps.ts` and pass the argument through at `src/extension.ts`.
