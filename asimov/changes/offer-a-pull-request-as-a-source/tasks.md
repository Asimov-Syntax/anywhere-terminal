## 1. Reading the forge

- [x] 1_1 Read open pull requests through `gh`, bounded, with every failure as one state — verified: bun test 'src/worktree/repoPullRequests.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#an-unavailable-forge-costs-discovery-never-the-ability-to-create; design.md D1, D2
  - **Acceptance**:
    - Outcome: A missing `gh`, a failed call, and unparseable output all answer one unavailable state
    - Verify: unit src/worktree/repoPullRequests.test.ts
  - **Plan**:
    1. `src/worktree/repoPullRequests.ts`: `MAX_PULL_REQUESTS`, a `PullRequest` shape (number, title, headRefName, baseRefName, headOwner, fromFork), and `readPullRequests(runner, { cwd })` calling `gh pr list --json …  --limit <cap + 1>`, splitting a full page from an exactly-capped one the way `readRepoRefs` does.
    2. Same file: one `{ ok: false }` for `failedToSpawn`, non-zero exit, `timedOut`, and JSON that does not parse — the distinction is kept for the log, not for the caller.
    3. `src/worktree/repoPullRequests.test.ts`: a normal list, a truncated list, and one case per failure mode proving they collapse to the same answer.
  - **Boundary**: no new process seam — the runner is `createGitCommandRunner({ executable: "gh" })` per D2, and `src/worktree/gitCommandRunner.ts` is not modified

- [x] 1_2 Carry pull requests on their own message, fired beside the refs read — verified: bun test 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#an-unavailable-forge-costs-discovery-never-the-ability-to-create; design.md D3; docs/design/worktree-create.md#41-one-combobox-not-a-tab-bar
  - **Acceptance**:
    - Outcome: The refs message does not wait for the pull-request read
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/types/messages.ts`: `WorktreePullRequestsMessage` — `repoId`, the echoed `token`, and either the rows plus `truncated` or an unavailable marker. Extension → WebView, so NOT added to `WORKTREE_MESSAGE_TYPES`.
    2. `src/providers/WorktreeHost.ts`: in the existing `requestWorktreeRefs` case, start the pull-request read as a second, independent promise; post its own message when it lands; drop it if the surface detached, exactly as the refs read does.
    3. `src/providers/WorktreeHost.actions.test.ts`: a witness holding the pull-request read open and asserting the refs message is already posted — reverting the separation must fail it.
  - **Boundary**: the refs read's own promise, message and timing are unchanged — this task adds a sibling, it does not rewrite the existing answer

## 2. Offering them in the one list

- [x] 2_1 Render pull requests as rows between the prefix matches and create-new — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#pull-requests-are-offered-in-the-branch-list-never-in-a-second-tab; docs/design/worktree-create.md#41-one-combobox-not-a-tab-bar
  - **Acceptance**:
    - Outcome: A matching pull request lists below the ref matches and above create-new
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts`: extend `BranchChoice` with a `pr` variant and place it in `orderChoices` after `prefixed` and before `{ kind: "new" }`; match on number and on title.
    2. Same file: a `bindPullRequests` dep in the shape of `bindRefs`, and per-repo state beside `refs` so an answer for another repository cannot render here.
    2b. `src/webview/worktree/worktreeViewTypes.ts`: `WorktreePullRequestOffer` beside `WorktreeRefOffer`, and the optional field on the per-repo record — the form's own holder for the answer, added here because the state in step 2 has to live somewhere the view types own.
    3. Same file: the unavailable state renders one non-selectable row; create-new stays last and stays selectable.
    4. `src/webview/worktree/WorktreeCreateDialog.test.ts`: ordering, the unavailable row, create-new still last, and a repo-id mismatch rendering nothing.
  - **Boundary**: no tab, no mode switch, no second input — the ordering is the whole UI change

- [ ] 2_2 Route the message to the dialog
  - **Deps**: 2_1
  - **Refs**: design.md D3
  - **Acceptance**:
    - Outcome: A `worktreePullRequests` message for the open repository reaches the dialog; one carrying a stale refs token is dropped
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/webview/messaging/MessageRouter.ts` and `src/webview/main.ts`: declare and route `onWorktreePullRequests`, in the same shape as the refs route.
    2. `src/webview/worktree/WorktreeController.ts`: hold the answer per repository and hand it to the dialog, dropping an answer whose token is not the live one.
    3. `src/webview/worktree/WorktreeController.test.ts`: delivery, and a stale-token drop.
  - **Boundary**: no change to how refs are routed

## 3. What selecting one means

- [ ] 3_1 Resolve a selected pull request to `pr/<number>` and its base
  - **Deps**: 2_2
  - **Refs**: specs/worktree-panel/spec.md#a-pull-request-resolves-to-a-deterministic-branch-and-its-base; design.md D4
  - **Acceptance**:
    - Outcome: Selecting a pull request submits branch `pr/<number>` and that request's own base ref
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts`: committing a `pr` row sets the typed name to `pr/<number>` and the base to the pull request's `baseRefName`, then goes through the existing resolution path so reuse, held-by and collision are answered by the machinery that already answers them for refs.
    2. Same file: the branch name is derived from the number alone — never the title, never `headRefName`.
    3. `src/webview/worktree/WorktreeCreateDialog.test.ts`: a fresh PR resolves `new` with the PR's base; the same PR once `pr/<number>` exists resolves `reuse`; a PR whose branch is held by another worktree is refused with the held-by wording; the title changing does not change the branch.
  - **Boundary**: no new resolution path — this task feeds the existing one

- [ ] 3_2 State the fork remote before the create is authorized
  - **Deps**: 3_1
  - **Refs**: specs/worktree-panel/spec.md#a-fork-head-states-the-remote-before-the-action-is-authorized; design.md D5; docs/design/worktree-create.md#5-pull-request-as-a-source
  - **Acceptance**:
    - Outcome: A fork-headed pull request states its remote before the create can be submitted
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts`: render the remote statement from `fromFork` and `headOwner` on selection, beside the destination line rather than after submit.
    2. `src/webview/worktree/WorktreeCreateDialog.test.ts`: a fork PR states the remote before submit; a same-repo PR does not; changing selection withdraws the statement.
  - **Boundary**: this change STATES the remote and does not configure it — no git config write, no remote add, per D5
