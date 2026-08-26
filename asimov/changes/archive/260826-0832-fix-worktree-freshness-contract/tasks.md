# Tasks: fix-worktree-freshness-contract

## 1. Contracts

- [x] 1_1 Make the host module the only declaration of the presence types — verified: pnpm run check-types && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D6
  - **Acceptance**:
    - Outcome: the four presence types are declared once and re-exported to the view
    - Verify: command pnpm run check-types
  - **Plan**:
    1. Delete the `PresenceDegradation` / `WorktreeSubagentRow` / `WorktreeAgentRow` / `WorktreePresence` declarations from `src/webview/worktree/worktreeViewTypes.ts`, keeping their doc comments on the survivors in `src/worktree/presenceTypes.ts` where the view's wording is better.
    2. Extend the existing re-export at `src/webview/worktree/worktreeViewTypes.ts:21` to cover all four, so no consuming view module changes.
    3. Update the header comment that predicted this move.

- [x] 1_2 Report why a workspace folder did not resolve to a repository — verified: bun test 'src/worktree/repoRoots.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D1
  - **Acceptance**:
    - Outcome: resolution reports a not-a-repository folder separately from a git that could not answer
    - Verify: unit src/worktree/repoRoots.test.ts
  - **Plan**:
    1. Extract `describeFailure` from `src/worktree/WorktreeDiscovery.ts` into `src/worktree/describeGitFailure.ts`, taking the command name as a parameter so its copy serves both callers; import it back.
    2. In `src/worktree/repoRoots.ts`, add per-folder outcomes beside `resolveRepoRoots` — resolved, not-a-repository, or failed-with-reason — leaving the existing export as the deduped wrapper so no current caller breaks.
    3. Read `timedOut` / `failedToSpawn` in `resolveToplevel` instead of collapsing every non-zero exit to `undefined`; give `resolveCommonDir` the same outcome shape.
    4. Classify by what is already known: once a toplevel resolves, the folder is a repository, so every later failure is `failed` and never `absent`.

## 2. Retention

- [x] 2_1 Carry a repository that failed to resolve forward as degraded — verified: bun test 'src/worktree/WorktreeCache.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-tree-freshness/spec.md#never-present-a-stale-listing-as-current, design.md D2
  - **Acceptance**:
    - Outcome: a still-open folder whose resolution fails keeps its worktrees, marked degraded
    - Verify: unit src/worktree/WorktreeCache.test.ts
  - **Plan**:
    1. Rewrite the isolation test so it reaches the inner worktree arrays, not only the outer array — it must fail before step 4.
    2. Add the folder→`repoId` memory to `src/worktree/WorktreeCache.ts`, pruned against the folder set on every `applyBuild`.
    3. Carry the per-folder outcomes through `WorktreeTreeBuild` in `src/worktree/WorktreeDiscovery.ts`.
    4. Make `applyBuild` retain a remembered repository whose folder is still open and failed to resolve, and keep dropping one whose folder is gone.

- [x] 2_2 Keep the retained listings when git is unavailable — verified: bun test 'src/worktree/WorktreeCache.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: specs/worktree-tree-freshness/spec.md#never-present-a-stale-listing-as-current, design.md D3
  - **Acceptance**:
    - Outcome: an unavailable git reports the retained repositories, each degraded, not an empty tree
    - Verify: unit src/worktree/WorktreeCache.test.ts
  - **Plan**:
    1. Rewrite `WorktreeCache.test.ts:209-225` — it asserts the empty tree this task removes, so it must fail before step 2.
    2. In `src/worktree/WorktreeCache.ts`, make `read()` return the retained repositories marked degraded with the git-unavailable reason, and an empty list only when none is retained; keep `gitAvailable: false` on the tree.

## 3. Scheduling

- [x] 3_1 Never lose a signal, and never answer a forced request from a running rebuild — verified: bun test 'src/worktree/rebuildGate.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-tree-freshness/spec.md#a-signal-that-arrives-during-a-rebuild-is-not-lost, specs/worktree-tree-protocol/spec.md#answer-a-worktree-tree-request, design.md D4
  - **Acceptance**:
    - Outcome: a request arriving mid-rebuild causes exactly one further rebuild
    - Verify: unit src/worktree/rebuildGate.test.ts
  - **Plan**:
    1. Split `rebuildGate.test.ts:100-120` into a non-forced case that still runs once and a forced case that runs twice — the forced half must fail before step 2.
    2. In `src/worktree/rebuildGate.ts`, replace `if (state.inFlight) return state.inFlight` with a single pending follow-up per scope, adopting the pending deferred so a rejection always has a waiter.
    3. Run the follow-up immediately when forced, and under the floor for a signal; resolve any orphaned waiter on `dispose()` the way the existing loop does.
    4. Add the `signal` option the gate needs to tell a watcher signal from a webview request, and pass it from the watcher callback in `src/providers/WorktreeHost.ts` — its only producer.

## 4. Watching

- [x] 4_1 Rebase the watch targets so none is recursive over the git directory — verified: bun test 'src/worktree/worktreeWatchTargets.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-tree-freshness/spec.md#watch-a-repository-without-recursively-watching-its-git-directory, design.md D5
  - **Acceptance**:
    - Outcome: only the linked-worktree metadata directory is watched recursively
    - Verify: unit src/worktree/worktreeWatchTargets.test.ts
  - **Plan**:
    1. Replace the `**`-absence assertion with one that classifies each target by the vendored rule — a pattern with a path segment is recursive — so the current targets fail it.
    2. Rewrite `worktreeWatchTargets` in `src/worktree/worktreeWatchTargets.ts` to the four targets in design.md D5.
    3. Correct the comment claiming a watcher cannot see a directory appear, and the one claiming the globs are narrow at the watcher layer.
    4. `src/providers/WorktreeHost.invalidation.test.ts` pins the old three-target shape by base and glob; move its expectations to the new set so the tree is never red between waves.

- [x] 4_2 Confirm the rebased watches against a real watcher and a failing pool — verified: bun test 'src/providers/WorktreeHost.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: specs/worktree-tree-freshness/spec.md#watch-a-repository-without-recursively-watching-its-git-directory, design.md D5
  - **Acceptance**:
    - Outcome: a repository with no linked worktrees is rebuilt when it gains its first one
    - Verify: unit src/providers/WorktreeHost.test.ts
  - **Plan**:
    1. Replace the always-active pool double at `src/providers/WorktreeHost.test.ts:70` with one that can fail chosen targets, so `reconcileWatches` degradation is reachable.
    2. Cover a repository gaining its first linked worktree through W2 — the common-dir `worktrees` create — which is the path that does not rest on the "monitored until created" contract. That contract stays doc-asserted: this repo mocks `vscode` in vitest and defines no E2E harness, so record it as residual rather than proving it with a double that cannot.
    3. Adjust `src/providers/WorktreeHost.ts` only where the new target count or failure aggregation changes what it reads.

## 5. View

- [x] 5_1 Show a retained listing instead of the git-unavailable empty state — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_2
  - **Refs**: specs/worktree-panel/spec.md#{each-cause-of-emptiness-reads-differently, a-retained-listing-is-shown-rather-than-replaced-by-an-empty-state}
  - **Acceptance**:
    - Outcome: worktrees stay on screen under a staleness notice when git goes away
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. In `src/webview/worktree/WorktreeView.ts`, take the `gitMissing` empty state only when the retained tree holds no repositories.
    2. Otherwise render the tree under `renderNotice` with `tone: "warn"` and `live: "status"`, naming the cause from the tree's `unreadable` reasons.
    3. Add the retained-but-git-unavailable tree to `src/webview/worktree/worktreeFixtures.ts` beside the existing empty one at `:123`.

## 6. Review fixes (round 1)

- [x] 6_1 Close the round-1 findings on retention, absence and degraded cause — verified: bun test 'src/worktree/WorktreeCache.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 5_1
  - **Refs**: .reviews/round-1.md#{b1, w1, w2, s1, s2}, design.md D1, design.md D2, design.md D3
  - **Acceptance**:
    - Outcome: a still-open folder keeps its repository through failure even when a sibling folder shares it
    - Verify: unit src/worktree/WorktreeCache.test.ts
  - **Plan**:
    1. B1 — in `src/worktree/WorktreeCache.ts`, hoist `resolved = remembered` out of the `!next.has(...)` insertion guard so a failed folder keeps its mapping when a sibling already contributed the same `repoId`; only the `next.set` stays guarded, so a sibling's fresh listing is never overwritten by a degraded one. Test two folders sharing one repo, one failing, then the sibling removed while the failure persists.
    2. S1 — replace the `nextOrder.some(...)` membership scans in the same function with a `Set<string>`.
    3. W2 — in `read()`, overlay the git-unavailable reason onto any retained repository that carries no `degraded`, so a successful `applyRepo` cannot leave a repo undegraded while the tree reports git unavailable. This is what design.md D3 already specifies. The watch-reconciliation half of W2 is rejected in triage; do not merge degradation sources.
    4. W1 — in `src/worktree/repoRoots.ts`, take `absent` only from git's own not-a-repository message and classify every other nonzero exit as `failed` via `describeGitFailure`. Erring toward `failed` is deliberate: a false `failed` retains a stale-but-marked listing, a false `absent` deletes it. Cover both branches in `src/worktree/repoRoots.test.ts`.
    5. W1 — pin `LC_ALL`/`LANG` to `C` on the runner env in `src/worktree/gitCommandRunner.ts`, because step 4 matches stderr text and this file's own callers already warn that unpinned stderr is locale-bound. Assert it in `src/worktree/gitCommandRunner.test.ts`.
    6. S2 — extract the first-seen `repoId` dedup shared by `resolveRepoRoots` and `buildWorktreeTreeDetailed` into one helper in `src/worktree/repoRoots.ts`; use it from `src/worktree/WorktreeDiscovery.ts`.
