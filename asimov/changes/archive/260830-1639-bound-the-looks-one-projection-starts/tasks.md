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

## 3. Review fixes — round 3

- [x] 3_1 Narrow the two promises to what bounded state can keep — verified: pnpm exec vitest run 'src/worktree/presenceProjector.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: specs/worktree-agent-presence/spec.md#a-row-the-bound-excludes-keeps-its-line, specs/worktree-agent-presence/spec.md#a-row-drawn-on-every-projection-is-looked-at-within-a-bounded-number-of-them, specs/worktree-agent-presence/spec.md#one-projection-provokes-a-bounded-number-of-transcript-looks <!-- design.md D8, D9; .reviews/round-3.md B1, B2, W1, S1 -->
  - **Acceptance**:
    - Outcome: a row drawn on every projection is permitted to look within a bounded number of them
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Plan**:
    1. In `src/worktree/sessionPreviewService.ts`, remove the declared-set entry point and the state behind it, restoring the cache cap as the unconditional retention rule; make the synchronous read touch what it returns and read only what is held.
    2. In `src/worktree/presenceProjector.ts`, hold the turn queue over exactly the ids drawn now: drop what is not drawn, append what is newly drawn, grant the front, move the granted to the back. Remove the ceiling and the back-pruning that retaining absent ids required.
    3. Drop the declaration dep from `src/worktree/presenceDeps.ts` and its wiring at `src/extension.ts`.
    4. In `src/worktree/presenceProjector.test.ts`, replace the cases that assert a place is kept across an absence with ones asserting a returning row is granted as an arrival; add a case for a row drawn on every projection among churning others.
    5. Exercise the shipped default in `src/worktree/presenceProjector.test.ts` with no budget override: at most 16 rows permitted above it, all rows permitted at or below it (S1).
    6. Rework the declared-set cases in `src/worktree/sessionPreviewService.test.ts` onto the cap, keeping the one that draws more sessions than the cap.

## 4. Review fixes — round 4

- [x] 4_1 Give the falling edge an owner, and the preview pair one shape — verified: pnpm exec vitest run 'src/worktree/presenceProjector.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: specs/worktree-agent-presence/spec.md#a-row-drawn-on-every-projection-is-looked-at-within-a-bounded-number-of-them <!-- design.md D10, D11; .reviews/round-4.md B1, S1 -->
  - **Acceptance**:
    - Outcome: a window that stops drawing rows and starts again grants every returned row as an arrival
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Plan**:
    1. In `src/worktree/presenceProjector.ts`, expose a way to tell the projector its rows are no longer drawn, clearing the turn order and bumping a generation; capture that generation before the enrichment block and skip the preview pass when it has moved.
    2. In `src/providers/WorktreeHost.ts`, settle the falling edge where the rising one is already settled, and on the path that tears the surface down.
    3. In `src/worktree/presenceDeps.ts`, make the two preview operations one optional capability, and mirror it at `src/extension.ts`.
    4. Cover in `src/worktree/presenceProjector.test.ts`: a returned row granted as an arrival after the order is forgotten, and an edge landing between the title and preview passes leaving the queue empty.
    5. Cover the host edges in `src/providers/WorktreeHost.test.ts`: rows to presence-only, rows to hidden, and detach.
    6. Extend the projector stubs in `src/providers/WorktreeHost.actions.test.ts`, `src/providers/WorktreeHost.delegations.test.ts` `src/providers/WorktreeHost.presence.test.ts`, `src/providers/WorktreeHost.secondSurface.test.ts` and `src/extension.worktreeAssembly.test.ts` with the new operation — the last two wrap a real projector and are cast past the type checker, so they fail only at runtime.
