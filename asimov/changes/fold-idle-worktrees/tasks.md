## 1. The tail

- [x] 1_1 Fold the idle tail — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{present-the-supplied-worktree-tree, worktrees-known-to-be-agentless-are-ordered-last, a-worktree-with-no-agents-renders-as-one-dim-line, the-idle-tail-folds-once-it-is-long-enough-to-bury-the-rest, the-idle-fold-and-the-display-cap-never-describe-the-same-rows, a-worktree-whose-presence-cannot-be-read-is-never-folded-away, a-search-match-inside-the-tail-opens-it, the-idle-disclosure-is-a-first-class-row-of-the-tree, the-tail-s-fold-state-persists-and-defaults-to-folded-exactly-once}
  - **Acceptance**:
    - Outcome: agentless worktrees render last as dim lines and fold under one counted disclosure
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    0. Files: `src/webview/worktree/WorktreeView.ts`, `src/webview/worktree/WorktreeView.test.ts`, `src/webview/worktree/worktreeTreeView.ts`, `src/webview/worktree/worktreePanel.css`, `src/webview/worktree/WorktreeController.ts`, `src/webview/state/WebviewState.ts`, `src/webview/worktree/WorktreeController.test.ts`, `src/webview/worktree/WorktreeController.state.test.ts`.
    1. Derive idleness as a positive determination, not an absence: no rows AND presence loaded AND no source degraded. The three-way `agents / none / cannot tell` is the point — a boolean over `rows.length` collapses the third case into the second and folds away the rows the degradation marker exists to surface. `PresenceDegradation` carries no repository or worktree attribution, so tree-wide suppression is the only honest reading, not a shortcut.
    2. Order inside `shownWorktrees`, which already owns collapse and cap, so the four rules cannot disagree about what is drawn. Resolve in the order filter → stable partition → cap → fold: the cap's own affordance keeps reporting only what the cap excluded, and the fold counts only rows the cap admitted, so neither affordance describes the other's rows.
    3. Persistence needs a second signal, not a second meaning on the first. An absent key in a restored `worktreeCollapsed` array already means *expanded* — `restored` makes every key seen — so one key cannot separate "never presented" from "the user opened it", and an existing user would meet this feature already unfolded. Add the marker to `src/webview/state/WebviewState.ts`, wire it in `src/webview/worktree/WorktreeController.ts` beside the existing pair, and namespace the fold key so it cannot collide with a repo or worktree id. Carry both through `pruneStaleState`, which rebuilds from live ids and drops what it does not recognise.
    4. The disclosure is a new row kind, not a restyled repo header: `navRows` matches on class and derives depth from it, and toggling routes through repo and worktree ids. Give it its own class, navigation key and toggle path, the tree item role, `aria-expanded`, and the same open-and-close arrow behaviour its Refs require of it.
    5. Let an active filter reveal the tail at render time only. Writing the fold open would spend the user's own choice on a transient query.
    6. Cover: both sides of the threshold; the degraded and not-yet-loaded cases; unknown-presence ordering; cap-and-fold together above the cap with most of it consumed by agent-holding rows; keyboard reach, toggle and focus retention on the disclosure; persistence across a push, across a reload, and on a restored array that predates the marker.

- [x] 1_2 Round-1 review fixes — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{the-idle-fold-and-the-display-cap-never-describe-the-same-rows, a-search-match-inside-the-tail-opens-it, the-idle-disclosure-is-a-first-class-row-of-the-tree, present-the-supplied-worktree-tree}
  - **Acceptance**:
    - Outcome: the disclosure keeps its own navigation identity and never overwrites a fold it only revealed
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    0. Files: `src/webview/worktree/WorktreeView.ts`, `src/webview/worktree/WorktreeView.test.ts`, `src/webview/worktree/worktreeTreeView.ts`, `src/webview/worktree/worktreePanel.css`.
    1. B1 + the duplication SUGGEST are one defect: route both toggles through a shared helper so the query guard cannot live on the render path alone.
    2. B2: two key spaces, one namespaced. The navigation key needs the same namespace the collapse key already has, or the repo header keeps winning `keyOf`.
    3. Cover multi-repo. A single-repo fixture is what hid B2 — no header exists there to collide with.
