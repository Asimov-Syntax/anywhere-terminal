# Tasks: attribute-a-path-to-the-worktree-it-resolves-into

## 1. One memo, then the sites that use it

- [x] 1_1 Resolve a path once per spelling, and only when asked — verified: pnpm exec vitest run 'src/utils/resolvedPathMemo.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Refs**: design.md#d1-the-bounded-side-of-each-comparison-resolves-the-unbounded-side-does-not; design.md#d3-a-resolved-value-may-be-cached-here-because-the-answer-authorizes-nothing; design.md#d4-resolution-is-lazy-and-per-distinct-path-never-an-eager-sweep
  - **Acceptance**:
    - Outcome: repeated spellings of one path cost a single `realpath`
    - Verify: unit src/utils/resolvedPathMemo.test.ts
  - **Plan**:
    1. Add `src/utils/resolvedPathMemo.ts`: resolve a path to its real form, memoized by spelling, storing the in-flight promise so concurrent callers join one syscall rather than racing two.
    2. Fall back to `path.resolve` when `realpath` fails, per the design's failure surface — a worktree being created must not lose its rows.
    3. Give it an explicit `invalidate()` for the structural events of 1_2 and 1_3, and no timer.
    4. Cover: one syscall for repeated spellings, concurrent callers joining, the failure fallback, and that invalidation forces a re-resolve.

- [x] 1_2 Attribute a pane by where its cwd resolves — verified: pnpm exec vitest run 'src/worktree/presenceProjector.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-agent-presence/spec.md#attribute-a-pane-to-exactly-one-worktree; design.md#d5-presencedepsnormalize-becomes-the-seam-it-already-documents
  - **Acceptance**:
    - Outcome: a pane appears under the worktree its cwd resolves into
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Plan**:
    1. In `src/utils/resolvedPathMemo.ts` (+ `src/utils/resolvedPathMemo.test.ts`), add the batch/peek pair the sync comparison sites need: resolve many paths at the boundary, then read a settled value synchronously, falling back to the lexical form exactly as today.
    2. In `src/worktree/presenceDeps.ts`, resolve the pane and session cwds through the memo before the projection compares them, and replace the `normalize: (p) => path.resolve(p)` comment that documents this exact miss.
    3. In `src/worktree/presenceProjector.ts`, leave the comparison on `isPathInside` — both sides arrive resolved.
    4. In `src/worktree/worktreeBlockers.ts`, state the resolution contract its `isPathInside` filters depend on, and supply it from the producers of those facts — `src/extension.ts`'s `removalFacts` sharing one memo with the projector, and `src/providers/WorktreeHost.ts` awaiting the now-async pane read (with `src/providers/WorktreeHost.actions.test.ts` and `src/worktree/worktreeBlockers.test.ts` following).
    5. Invalidate the memo entry for a pane whose reported cwd changes.
    6. Cover both spec scenarios, plus a pane whose cwd fails to resolve keeping the row it has today.

- [x] 1_3 Discover the repository a folder resolves into — verified: pnpm exec vitest run 'src/worktree/repoRoots.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md#d1-the-bounded-side-of-each-comparison-resolves-the-unbounded-side-does-not
  - **Acceptance**:
    - Outcome: a workspace folder reached through a symlink matches the repository it resolves into, not the one it is spelled under
    - Verify: unit src/worktree/repoRoots.test.ts
  - **Plan**:
    1. In `src/worktree/repoRoots.ts`, resolve the workspace folder and each Git API `rootUri.fsPath` through the memo before the longest-prefix match.
    2. Invalidate on the Git API's repository set changing, so a repo opened later is not matched against a stale resolution.
    3. Cover a folder and a repo root spelled differently but resolving together, and a folder spelled under a repo it resolves outside of.
    4. Supply the resolver in production from `src/worktree/worktreeDeps.ts`, over the memo `src/extension.ts` already shares with the projection.

- [x] 1_4 Scope decorations by a resolved root — verified: pnpm exec vitest run 'src/providers/gitDecorationProvider.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md#d1-the-bounded-side-of-each-comparison-resolves-the-unbounded-side-does-not
  - **Acceptance**:
    - Outcome: a workspace folder reached through a symlink still scopes decorations, and no `realpath` is issued per decorated file
    - Verify: unit src/providers/gitDecorationProvider.test.ts
  - **Plan**:
    1. In `src/providers/gitDecorationProvider.ts`, resolve the workspace folders once through the memo and invalidate on `onDidChangeWorkspaceFolders`; leave the decorated path lexical, per D1.
    2. Cover that decorating many files issues no additional resolution, which is the cost half of the acceptance and not a type-check.
    3. This is the second consumer of "resolve a bounded set, forget what left", so move that resolver out of `src/worktree/repoRoots.ts` into `src/utils/resolvedPathMemo.ts` (+ `src/utils/resolvedPathMemo.test.ts`, `src/worktree/repoRoots.test.ts`) rather than duplicating it, and wire the provider from `src/extension.ts`.

- [x] 1_5 Delete the file tree's private copy of the rule — verified: rg -n 'function isPathInside' src/ && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md#d2-the-comparison-stays-lexical-and-stays-ispathinside
  - **Acceptance**:
    - Outcome: no site outside `src/utils/pathBoundary.ts` defines its own containment rule
    - Verify: command rg -n 'function isPathInside' src/
  - **Plan**:
    1. In `src/webview/fileTree/FileTreePanel.ts`, delete the local `isPathInside` at line 1715 and import the shared predicate, resolving the workspace root through the memo where the panel receives it.
    2. Confirm the webview bundle still builds — the shared module must not drag extension-host-only imports into the webview. It does not today: `node:fs/promises` and `node:path` are there for the RESOLVED predicate only, so move that half out of `src/utils/pathBoundary.ts` into `src/utils/resolvedPathBoundary.ts` (with `src/utils/pathBoundary.test.ts`, `src/utils/resolvedPathBoundary.test.ts` and its five importers — `src/vault/readers/claudePaths.ts`, `src/vault/readers/claudeReader.ts`, `src/vault/readers/codexReader.ts`, `src/vault/readers/subagentLookup.ts`, `src/worktree/sessionPreviewService.ts`) and leave the lexical rule where D2 puts it.

## 2. Round-1 review fixes

- [x] 2_1 Close the five round-1 blockers — verified: pnpm exec vitest run 'src/utils/resolvedPathMemo.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_5
  - **Refs**: .reviews/round-1.md; design.md#d1-the-bounded-side-of-each-comparison-resolves-the-unbounded-side-does-not; design.md#d4-resolution-is-lazy-and-per-distinct-path-never-an-eager-sweep
  - **Acceptance**:
    - Outcome: every accepted round-1 blocker has a test that fails without its fix
    - Verify: unit src/utils/resolvedPathMemo.test.ts
  - **Plan**:
    1. B3 — in `src/utils/resolvedPathMemo.ts` (+ `src/utils/resolvedPathMemo.test.ts`), settle a resolution only while it is still the entry for its key, so a flight that started before `invalidate`/`invalidateAll` cannot write `settled` or delete a newer promise.
    2. B4 — in `src/worktree/presenceProjector.ts` (+ `src/worktree/presenceProjector.test.ts`), release a cwd when its pane leaves the live set and when an external session is evicted, so the growth axis is directories the window currently holds rather than every directory it has ever seen.
    3. B5 — in `src/extension.ts`, read each pane's activity in the same synchronous pass as the pane list, before awaiting resolution, so a removal's blocker set is one pane observation.
    4. B2 — in `src/providers/gitDecorationProvider.ts` (+ `src/providers/gitDecorationProvider.test.ts`), rebuild once the folder resolution settles, guarded by a generation so a superseded pass cannot reset over a newer one.
    5. B1 — carry the resolved workspace root to the webview as its own field on the init and `workspace-root-changed` payloads (`src/types/messages.ts`, `src/providers/fileTreeHost.ts`, `src/providers/fileTreeHost.test.ts`), keep `workspaceRoot` as the user's spelling for mounting and display, and compare containment against the resolved one in `src/webview/fileTree/FileTreePanel.ts`, `src/webview/fileTree/FileTreeController.ts`, `src/webview/main.ts` and `src/webview/messaging/MessageRouter.test.ts`.
    6. S1 — prove the per-event candidate stays lexical against a memo that HAS its spelling prepared, which is the case my equivalence claim missed.
