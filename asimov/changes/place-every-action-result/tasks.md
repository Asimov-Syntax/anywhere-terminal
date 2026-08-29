## 1. One owner for notice reach

- [x] 1_1 Place every action result from one pass — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{every-action-result-is-rendered-whatever-the-tree-chose-to-draw, a-result-whose-row-is-not-on-screen-says-which-worktree-it-is-about, a-name-in-a-notice-identifies-one-worktree}
  - **Acceptance**:
    - Outcome: every held result renders exactly once, naming its worktree when the row is not on screen
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    0. Files: `src/webview/worktree/WorktreeView.ts`, `src/webview/worktree/WorktreeView.test.ts`.
    1. Give placement ONE owner. Three attempts have each taught the same lesson from a different branch — the lead loop, then the folded tail, then the cap — and every one was a place that decides what to DRAW being asked to also decide what to REPORT. A fourth such branch fails the same way the next time a display rule is added.
    2. The pass iterates every result exactly once and is the only thing that appends a notice, so the three existing emission sites go: the worktree-scoped loop, the folded-tail loop, and the repo-scoped loop. Leaving any of them beside the new pass is how the same result renders twice.
    3. It must sit where no display decision precedes it. A collapsed repository returns before the repo-scoped loop it never reaches, and `render` has several early exits before any repository is drawn — a pass placed after the repo loop inherits every one of those holes.
    4. Use the rendered DOM to choose each result's anchor and whether it needs a name — `renderedWorktreeIds()` already reads `[data-worktree-id]` back out and exists for exactly this reason. A second predicate restating the draw rules would be a second thing to keep in step.
    5. Naming is by row presence, which is the seam the implementation actually has. `buildActionNotice` already composes a name through `withAbout`; what it lacks is a name for a worktree the tree still carries but the view did not draw. Resolve from the tree first, then from what the panel last knew of a departed worktree — note that value is reconstructed in `WorktreeController`, not supplied by the host, so treat it as a fallback and not as an authority.
    6. Qualification is part of the name, not a nicety: a row label repeats across worktrees and across repositories, so a name that does not separate one result's subject from another's fails its Refs.
    7. Reach is about the notice, never about the listing: do not open a fold, lift a cap, widen a filter, or expand a repository to make a row appear.
    8. Preserve the `WorktreeInfo` the tree lookup found when building a notice for an undrawn row, so an offer the result carries — Force remove among them — is not silently dropped for exactly the rows that most need it.
    9. Cover: excluded by cap; hidden by fold; excluded by filter; a collapsed repository's repo-scoped result; absent from the tree entirely; a tree that could not be listed at all. Each proves the row is absent AND that one unique marker occurs exactly once. Then: two undrawn failures sharing a row label, told apart; a drawn row's notice asserted present before asserting it omits the label; and the same result across a drawn → undrawn → drawn pair of pushes, one notice after each render.

- [x] 1_2 Round-1 review fixes — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{every-action-result-is-rendered-whatever-the-tree-chose-to-draw, a-result-whose-row-is-not-on-screen-says-which-worktree-it-is-about, a-name-in-a-notice-identifies-one-worktree}
  - **Acceptance**:
    - Outcome: a result still renders, attributed to the right repository, on a render that drew no tree
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    0. Files: `src/webview/worktree/WorktreeView.ts`, `src/webview/worktree/WorktreeView.test.ts`.
    1. The anchor map is a DRAWING artifact that placement was allowed to depend on — the same mistake this change was written to remove, one level down. Its lifetime must be tied to the DOM it describes, so it is reset where that DOM is, not where the repo loop happens to start.
    2. Trusting an anchor is a second decision from recording one. An anchor still in the map but no longer in the tree makes `after()` a silent no-op, which is the one outcome placement must never produce: verify before use and fall back to appending.
    3. Only record an anchor when the section actually grew. A repository that appended nothing has no last element of its own, and the previous repository's is not a substitute — a repo-scoped notice carries no name, so nothing on screen would contradict the wrong attribution.
    4. Reuse what the view already has: one DOM scan feeding both placement and the ceiling scheduler, and the existing repository lookup rather than a second one.
    5. Return the focus key rather than parking it on the instance; a synchronous re-entrant render must not read a predecessor's.
    6. Cover what the round-1 tests did not: a repo-scoped result surviving each of the four early-exit renders when a successful render preceded it; a filter that empties one repository while another still holds a result; and the NAME itself asserted present and correct, not only different from its neighbour.

- [x] 1_3 Round-2 test strengthenings — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#{every-action-result-is-rendered-whatever-the-tree-chose-to-draw, a-name-in-a-notice-identifies-one-worktree}
  - **Acceptance**:
    - Outcome: each placement assertion fails against a mutant that satisfies its old form
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    0. Files: `src/webview/worktree/WorktreeView.test.ts`, `src/webview/worktree/WorktreeView.ts`.
    1. Three assertions read like their requirement without pinning it: a name checked by a substring the worktree id also contains, a positional check whose fixture makes the right and wrong answers the same index, and an exit set that names four cases and covers three.
    2. Comments are claims too. Two here assert properties the code does not have — one cites synchronous re-entry as handled when only the focus key moved, one calls a guard load-bearing when nothing reaches it. Say what is true, including that the guard is unreachable and kept anyway.
