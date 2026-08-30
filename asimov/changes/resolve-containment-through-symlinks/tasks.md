# Tasks: resolve-containment-through-symlinks

- [x] 1_1 One predicate that resolves before it compares — verified: pnpm exec vitest run 'src/utils/pathBoundary.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Refs**: specs/vault-session-preview/spec.md#{a-transcript-is-located-inside-the-store-it-resolves-into-not-the-one-it-spells} <!-- design.md D1, D3, D4, D5 -->
  - **Acceptance**:
    - Outcome: containment is decided on resolved paths, and a path the filesystem declines to resolve is refused rather than compared literally
    - Verify: unit src/utils/pathBoundary.test.ts
  - **Plan**:
    1. In `src/utils/pathBoundary.ts` add the async resolved predicate beside `isPathInside`, resolving both sides through `realpath` and finishing with `isPathInside` so the lexical rules stay defined once (design.md D1).
    2. Tolerate one failure only: an `ENOENT` tail beneath a parent that itself resolved inside the root. Refuse every other error and refuse an existing symlink whose target will not resolve — do not reuse `realpathTolerant`, which swallows all of them (design.md D3).
    3. Make the test strict about equality: `candidate === root` is not contained, unlike `isPathInside` (design.md D5).
    4. In `src/utils/pathBoundary.test.ts` cover the escaping link, the symlinked root, the not-yet-created tail, the **dangling** link whose target does not exist, `ELOOP`, `EACCES`, and the equality case.

- [x] 1_2 The Claude resolvers ask the shared question — verified: pnpm exec vitest run 'src/vault/readers/claudePaths.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/vault-session-preview/spec.md#{a-transcript-is-located-inside-the-store-it-resolves-into-not-the-one-it-spells} <!-- design.md D2, D6 -->
  - **Acceptance**:
    - Outcome: a Claude transcript reached through a link out of the projects root is not returned
    - Verify: unit src/vault/readers/claudePaths.test.ts
  - **Plan**:
    1. In `src/vault/readers/claudePaths.ts` replace the three inline `path.relative` containment blocks — session, subagent, and workflow-agent resolution — with the shared predicate, deleting the open-coded checks rather than leaving them beside it (design.md D6).
    2. `claudePaths.ts` has no test file of its own — its resolvers are exercised through `src/vault/readers/claudeReader.detail.test.ts`. Add `src/vault/readers/claudePaths.test.ts` covering each resolver directly: the escaping link, and a genuinely contained transcript under a symlinked projects root that is still found.

- [x] 1_3 The Codex reader asks the shared question — verified: pnpm exec vitest run 'src/vault/readers/codexReader.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/vault-session-preview/spec.md#{a-transcript-is-located-inside-the-store-it-resolves-into-not-the-one-it-spells} <!-- design.md D2, D5, D6 -->
  - **Acceptance**:
    - Outcome: an index-supplied rollout path that resolves outside the sessions root is ignored in favour of the filename scan
    - Verify: unit src/vault/readers/codexReader.test.ts
  - **Plan**:
    1. In `src/vault/readers/codexReader.ts` delete `isUnder` and route both callers — the child-thread meta read and `pickRolloutPath` — through the shared predicate.
    2. In `src/vault/readers/codexReader.test.ts` cover a stored `rolloutPath` that escapes through a link, asserting the reader falls back to the filename scan rather than reading it, and one that is contained under a symlinked sessions root and is used.
    3. Keep the regression `isUnder` guarded: a `rolloutPath` equal to the sessions directory must still be rejected so the filename scan runs (design.md D5).

- [x] 1_4 The preview service asks the shared question — verified: pnpm exec vitest run 'src/worktree/sessionPreviewService.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/vault-session-preview/spec.md#{a-transcript-is-located-inside-the-store-it-resolves-into-not-the-one-it-spells} <!-- design.md D2, D6 -->
  - **Acceptance**:
    - Outcome: a vault hint that resolves outside the projects root leaves the row unresolved rather than previewed
    - Verify: unit src/worktree/sessionPreviewService.test.ts
  - **Plan**:
    1. In `src/worktree/sessionPreviewService.ts` delete `isInside` and route the Claude hint branch of `resolve` through the shared predicate.
    2. In `src/worktree/sessionPreviewService.test.ts` cover a hint escaping through a link — the row stays unresolved and is retried on the ordinary cadence rather than being recorded as uncovered — and a hint under a symlinked root that resolves normally.

- [x] 1_5 An enumerated file is checked like a resolved one — verified: pnpm exec vitest run 'src/vault/readers/claudeReader.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/agent-session-index/spec.md#{enumeration-is-not-exempt-from-containment} <!-- design.md D2 -->
  - **Acceptance**:
    - Outcome: a listed session file that resolves outside the projects root is skipped, and its siblings are still indexed
    - Verify: unit src/vault/readers/claudeReader.test.ts
  - **Plan**:
    1. `src/vault/readers/claudeReader.ts` stats and reads every path `listJsonlFiles` returns with no containment check at all — the one adopter that reaches transcripts by enumeration rather than by resolving an id. Gate the per-file branch on the shared predicate before `stat`.
    2. Skip, do not throw: a link out of the store is one entry lost, not a directory lost. The existing per-file tolerance already models this.
    3. In `src/vault/readers/claudeReader.test.ts` cover a directory holding one escaping symlink beside two ordinary transcripts, asserting exactly the two are indexed.

- [x] 2_1 Case is data once the filesystem has spoken — verified: pnpm exec vitest run 'src/utils/pathBoundary.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/vault-session-preview/spec.md#{a-transcript-is-located-inside-the-store-it-resolves-into-not-the-one-it-spells} <!-- design.md D7, D8 -->
  - **Acceptance**:
    - Outcome: a candidate differing from the root only in a component's case is refused
    - Verify: unit src/utils/pathBoundary.test.ts
  - **Plan**:
    1. In `src/utils/pathBoundary.ts` extract the boundary rules `isPathInside` holds into a private core parameterized by its normalizer, and give the resolved predicate a normalizer that folds separators and the drive letter only (design.md D1, D7). `isPathInside` keeps its exact current behaviour — its callers compare ids, not files.
    2. In `src/utils/pathBoundary.ts` split the resolved predicate into `prepareResolvedRoot` and `isResolvedPathInsideRoot`, keeping `isResolvedPathInside` as the single-shot form (design.md § Interfaces, D8).
    3. Cover in `src/utils/pathBoundary.test.ts`: a candidate under `C:\vault\store` against root `C:\vault\Store` refused while `isPathInside` still accepts it; drive-letter case still folded; POSIX case still significant; a prepared root reused across several candidates; a prepared root whose directory has been replaced refusing rather than admitting.

- [x] 2_2 The listing adopters prepare the root once — verified: pnpm exec vitest run 'src/vault/readers/claudePaths.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: specs/agent-session-index/spec.md#{enumeration-is-not-exempt-from-containment} <!-- design.md D8 -->
  - **Acceptance**:
    - Outcome: a listing pass resolves its store root once, however many files it holds
    - Verify: unit src/vault/readers/claudePaths.test.ts
  - **Plan**:
    1. In `src/vault/readers/claudeReader.ts` prepare the projects root before the project-directory loop and pass it to the per-file check; refuse the whole pass when it does not resolve.
    2. In `src/vault/readers/claudePaths.ts` prepare the projects root once per resolver call, before its directory loop.
    3. Add the healthy symlinked-root success cases round 1 found missing (S1): `resolveClaudeSubagentPath` and `resolveClaudeWorkflowAgentPath` under a symlinked projects root must still find their transcripts.
    4. Assert the root is resolved once, not once per file — count `realpath` calls against the injected dep rather than inferring it from timing.
