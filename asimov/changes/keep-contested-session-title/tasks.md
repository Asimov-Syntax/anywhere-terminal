# Tasks — keep-contested-session-title

Ownership and naming are two different claims about a session. `settleContestedSessions` collapses
them: when two panes resolve to one session it withdraws `entryId` — correct, neither pane owns it —
and in the same step replaces the row's title with the pane's own. A pane running `npm run watch`
has a title to fall back to. A pane running `zsh` has none, so the row renders `(untitled)` even
though the session's name was resolved moments earlier.

Withdrawing the *title* was never the finding. Only ownership is contested.

Observed: two panes in one directory, both resolving `claude:a6b2727e…` by `directory` evidence,
both rendering `(untitled)` while the projector had already computed `cyberk-skills-04`.

## 1. Keep the name a contested row already resolved

- [x] 1_1 Separate the id that names a row from the id that claims it — verified: pnpm exec vitest run 'src/worktree/presenceProjector.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Refs**: src/worktree/presenceProjector.ts; src/worktree/presenceTypes.ts
  - **Acceptance**:
    - Outcome: A disowned row with no pane title still shows the session's name
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Boundary**: no change to which pane wins a contest; ownership rules stay exactly as they are
  - **Plan**:
    1. Add `titleSourceId` to WorktreeAgentRow in src/worktree/presenceTypes.ts — names the row, claims nothing
    2. In `settleContestedSessions` in src/worktree/presenceProjector.ts, stop discarding `title`; carry the withdrawn `entryId` as `titleSourceId`, and prefer a non-empty pane title over it
    3. In `titleFromVault` in src/worktree/presenceProjector.ts, consult `titleSourceId` when `entryId` is gone, but only for a row that has no title of its own
    4. Include `titleSourceId` in the `alive` set so the memo is not evicted while a contested row still reads it
    5. Record `titleSourceId` as non-rendering, with its reason, in src/webview/worktree/worktreeRenderSignature.test.ts

## 2. Review fixes (cycle 1)

- [x] 2_1 Ask who owns the title, not whether one exists — verified: pnpm exec vitest run 'src/worktree/presenceProjector.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: .reviews/round-1.md
  - **Acceptance**:
    - Outcome: A cleared or registry-named row still takes the vault's title
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Boundary**: ownership rules unchanged; only title provenance moves
  - **Plan**:
    1. Set `titleSourceId` only where the title is not pane-owned in src/worktree/presenceProjector.ts
    2. Drop the value-presence guard in `titleFromVault`, keeping the registry name as fallback, in src/worktree/presenceProjector.ts
    3. Cover reported-empty, whitespace-only and registry-name-upgraded cases in src/worktree/presenceProjector.test.ts
