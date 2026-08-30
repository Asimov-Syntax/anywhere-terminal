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

- [ ] 1_2 Attribute a pane by where its cwd resolves
  - **Deps**: 1_1
  - **Refs**: specs/worktree-agent-presence/spec.md#attribute-a-pane-to-exactly-one-worktree; design.md#d5-presencedepsnormalize-becomes-the-seam-it-already-documents
  - **Acceptance**:
    - Outcome: a pane appears under the worktree its cwd resolves into
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Plan**:
    1. In `src/utils/resolvedPathMemo.ts` (+ `src/utils/resolvedPathMemo.test.ts`), add the batch/peek pair the sync comparison sites need: resolve many paths at the boundary, then read a settled value synchronously, falling back to the lexical form exactly as today.
    2. In `src/worktree/presenceDeps.ts`, resolve the pane and session cwds through the memo before the projection compares them, and replace the `normalize: (p) => path.resolve(p)` comment that documents this exact miss.
    3. In `src/worktree/presenceProjector.ts`, leave the comparison on `isPathInside` — both sides arrive resolved.
    4. In `src/worktree/worktreeBlockers.ts`, take the same resolved cwd for the pane and session filters.
    5. Invalidate the memo entry for a pane whose reported cwd changes.
    6. Cover both spec scenarios, plus a pane whose cwd fails to resolve keeping the row it has today.

- [ ] 1_3 Discover the repository a folder resolves into
  - **Deps**: 1_1
  - **Refs**: design.md#d1-the-bounded-side-of-each-comparison-resolves-the-unbounded-side-does-not
  - **Acceptance**:
    - Outcome: a workspace folder reached through a symlink matches the repository it resolves into, not the one it is spelled under
    - Verify: unit src/worktree/repoRoots.test.ts
  - **Plan**:
    1. In `src/worktree/repoRoots.ts`, resolve the workspace folder and each Git API `rootUri.fsPath` through the memo before the longest-prefix match.
    2. Invalidate on the Git API's repository set changing, so a repo opened later is not matched against a stale resolution.
    3. Cover a folder and a repo root spelled differently but resolving together, and a folder spelled under a repo it resolves outside of.

- [ ] 1_4 Scope decorations by a resolved root
  - **Deps**: 1_1
  - **Refs**: design.md#d1-the-bounded-side-of-each-comparison-resolves-the-unbounded-side-does-not
  - **Acceptance**:
    - Outcome: a workspace folder reached through a symlink still scopes decorations, and no `realpath` is issued per decorated file
    - Verify: unit src/providers/gitDecorationProvider.test.ts
  - **Plan**:
    1. In `src/providers/gitDecorationProvider.ts`, resolve the workspace folders once through the memo and invalidate on `onDidChangeWorkspaceFolders`; leave the decorated path lexical, per D1.
    2. Cover that decorating many files issues no additional resolution, which is the cost half of the acceptance and not a type-check.

- [ ] 1_5 Delete the file tree's private copy of the rule
  - **Deps**: 1_1
  - **Refs**: design.md#d2-the-comparison-stays-lexical-and-stays-ispathinside
  - **Acceptance**:
    - Outcome: no site outside `src/utils/pathBoundary.ts` defines its own containment rule
    - Verify: command rg -n 'function isPathInside' src/
  - **Plan**:
    1. In `src/webview/fileTree/FileTreePanel.ts`, delete the local `isPathInside` at line 1715 and import the shared predicate, resolving the workspace root through the memo where the panel receives it.
    2. Confirm the webview bundle still builds — the shared module must not drag extension-host-only imports into the webview.
