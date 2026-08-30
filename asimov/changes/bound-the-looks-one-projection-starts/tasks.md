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

## 2. Review fixes — round 1

- [x] 2_1 Keep a line for every drawn row, and rotate the turn by row — verified: pnpm exec vitest run 'src/worktree/presenceProjector.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-agent-presence/spec.md#a-row-the-bound-excludes-keeps-its-line-and-is-looked-at-later, specs/worktree-agent-presence/spec.md#one-projection-provokes-a-bounded-number-of-transcript-looks <!-- design.md D5, D6, D7; .reviews/round-1.md B1, B2, W1, S1 -->
  - **Acceptance**:
    - Outcome: a drawn row keeps its line past the cache cap and is permitted to look as membership changes
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Plan**:
    1. In `src/worktree/sessionPreviewService.ts`, let a caller declare the set of sessions it is drawing; keep exactly that set, dropping what is outside it and evicting nothing inside it. The existing cap governs only while no set has been declared.
    2. Add a synchronous read of the line a session already holds, and remove the `mayLook` parameter that a caller no longer needs.
    3. In `src/worktree/presenceProjector.ts`, replace the index cursor with an order held over entry ids: add what is newly drawn, drop what is no longer drawn, grant the budget to the front, and move exactly those to the back.
    4. Declare that same set to the preview service before asking, await only the permitted rows, and read the rest synchronously.
    5. Mirror the changed dep in `src/worktree/presenceDeps.ts` and at `src/extension.ts`.
    6. Rework the `mayLook` cases in `src/worktree/sessionPreviewService.test.ts` onto the two new entry points, and add one drawing more sessions than the cap.
    7. Cover in `src/worktree/presenceProjector.test.ts`: a row drawn throughout while others appear and disappear; a projection set that shrinks and grows again; and the shipped default budget, both above and below it.
