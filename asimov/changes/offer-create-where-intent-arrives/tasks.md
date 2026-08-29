## 1. Four doors, one create

- [x] 1_1 One repo-scoped opener, and the toolbar reaching it — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{every-create-entry-point-opens-the-same-offer, a-control-is-offered-only-in-the-body-it-acts-on}, ../../../specs/worktree-panel/spec.md#{a-row-is-never-offered-an-action-it-cannot-perform}, docs/design/worktree-actions.md#322-where-create-is-offered
  - **Acceptance**:
    - Outcome: the toolbar control opens a form offering every repository, and is absent when there is no repository
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    0. Files: `src/webview/worktree/WorktreeController.ts`, `src/webview/worktree/WorktreeController.test.ts`, `src/webview/vault/VaultPanel.ts`, `src/webview/vault/VaultPanel.test.ts`, `src/webview/main.ts`.
    1. The toolbar control is already built and already hidden correctly for the sessions body, and it is never constructed: `VaultPanel` builds it only when `deps.onCreateWorktree` is supplied and `main.ts` supplies nothing. Wire it; do not rebuild it. The blueprint is the scope authority here — the applied requirement's positive scenario is a truncated sentence, which is why nothing ever caught this.
    2. `openCreateFor` is keyed on a `WorktreeInfo` because the context menu was its only caller. Three of the four doors have a repository and no row, and the toolbar has neither. Re-key the opener on the repository and let the row door resolve its row to one — the reverse cannot be done without inventing a row.
    3. An unscoped open cannot wait for one answer. The request carries a `repoId`, `createRepos()` lists only repositories that have already answered, `openCreateDialog` returns on an empty seed, and the form builds its repository picker once from the seed it opened with. So a toolbar create asks every repository in the current tree and opens when the ones it asked have answered — opening on the first reply would offer a picker holding one repository and call it the whole workspace.
    4. Absent, not inert. An action the view cannot perform must be absent from the toolbar, so the control tracks whether the tree holds a repository at all, not just which body is showing. Supplying the callback constructs the button unconditionally, so availability is a second gate beside the body gate rather than a reason to withhold the callback.
    5. Nothing here may build a create request. Every door ends at the request the menu already sends; a second construction site is how the safety model in § 3.2 acquires a hole.
    6. Cover: a cold single-repo panel, a cold multi-repo panel whose answers arrive out of order, and a panel whose answers never arrive; that the picker offers every repository with none chosen on the user's behalf; the control absent with no repository and absent in a sessions body.

- [x] 1_2 Create on the group header — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{a-repo-group-header-offers-create-for-its-own-repository, keyboard-traversal-follows-the-declared-hierarchy}, docs/design/worktree-panel-ui.md#31-repo-group-header
  - **Acceptance**:
    - Outcome: a group header offers create for its own repo, reachable by keyboard
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    0. Files: `src/webview/worktree/worktreeTreeView.ts`, `src/webview/worktree/WorktreeView.ts`, `src/webview/worktree/WorktreeView.test.ts`, `src/webview/worktree/worktreePanel.css`, `src/webview/worktree/WorktreeController.ts`, `src/webview/worktree/WorktreeController.test.ts`.
    1. The header already carries a spacer between its count and its chevron, which is where the control goes. Two mechanisms it must not disturb, both of which it breaks by default:
    2. `bindActivation` binds a **bubbling** click and keydown on the header itself, so a child button's activation reaches the button and then the header — one gesture, a create AND a collapse. The child stops what it handled.
    3. `onKeyDown` derives its position with `rows.indexOf(document.activeElement)`, so focus on a non-row yields `-1`: both vertical arrows land on the top of the tree, and the horizontal pair hands `expandOrDescend` something that is not a row. The traversal must resolve a focused control to the row that owns it before indexing — the same closest-row idiom the `focusin` delegate already uses to stamp the roving key.
    4. Hover-only is the failure this task exists to avoid, so the reveal is `:hover` **and** `:focus-within`. Keyboard reach follows the roving model the tree already has rather than a second tab stop: the control is in the tab order only while its own header holds focus. That is the rule the spec delta now states, and it is the part most likely to be got wrong quietly — assert the control is NOT tabbable from another row.
    5. The header exists only in the multi-repo case, and that is the rule the control inherits rather than restates. The control is offered only where the view was given a way to perform it — the same absent-not-inert rule the toolbar gate follows, and the same defect if the controller never supplies the dep.
    6. Cover: activation opening the form on that repository and not another; that one pointer activation and one Enter and one Space each start exactly one create and leave the expansion alone; Tab reaching the control from its own header and not from another; each of the four arrow keys still moving between rows while the control holds focus; nothing header-shaped offering create in a single-repo tree.

- [ ] 1_3 The state that can create, creates
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#{the-unbranched-repository-state-offers-the-create-it-describes, a-state-describing-nothing-to-create-in-offers-no-create, each-cause-of-emptiness-reads-differently}, ../../../specs/worktree-panel/spec.md#{present-the-supplied-worktree-tree}, docs/design/worktree-panel-ui.md#5-states
  - **Acceptance**:
    - Outcome: a repo holding only its main checkout says so and offers the create beside its main row
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    0. Files: `src/webview/worktree/worktreeTreeView.ts`, `src/webview/worktree/WorktreeView.ts`, `src/webview/worktree/WorktreeView.test.ts`, `src/webview/vault/renderAtoms.ts`, `src/webview/worktree/worktreePanel.css`.
    1. The state does not exist yet: `WorktreeEmptyKind` has four members and the design's fifth is unimplemented, so such a repository renders as one bare `main` row and says nothing. § 3.2.2 and § 5 name it twice, as "no worktrees yet" and "one worktree so far"; build one state and let the blueprint sync settle the wording.
    2. Read the state off the repository, not off the render. Exactly one worktree, of kind `main`, with no degraded reason — a listing failure produces a repository carrying zero worktrees and a degraded reason, and a filter, the display cap, and the idle fold each reduce what is drawn without saying anything about what the repository holds. Deciding from visible rows would call four different things unbranched.
    3. Beside the main row, never instead of it. Every supplied worktree stays reachable exactly once, and the main row is where the existing "New Worktree…" menu item lives — replacing it would break the base requirement and delete one of the four doors inside the state that advertises them.
    4. `emptyState` takes an icon, a title, and a body and has no slot for an action. Four of the five states must not carry one, so the slot is optional and its absence is the default: extend that atom, leave every existing caller rendering what it renders now.
    5. The no-match state keeps winning. A query that matches nothing already has its own state and its own copy, and the two must not both describe the same screen.
    6. Cover: the state rendering for a repository holding only its main checkout, with its control opening the form on that repository and the main row still present with its menu; a repository with a second worktree not rendering it; a degraded repository with no rows not rendering it; a repository showing only main because of the filter, the cap, or the fold not rendering it; the four states that cannot create offering no control.
