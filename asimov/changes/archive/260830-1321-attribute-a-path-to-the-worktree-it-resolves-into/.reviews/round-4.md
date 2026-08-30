# Review Round 4: attribute-a-path-to-the-worktree-it-resolves-into

**Date**: 2026-08-30
**Cycle**: 2
**Round**: 4
**Mode**: verification (fastlane requested)
**Scope**: commit `cc21a52c5a7258583f027498f7e36b2b54b10c26`
**Head**: `cc21a52c5a7258583f027498f7e36b2b54b10c26` (explicit committed scope; working tree dirty outside the reviewed commit in change analytics and three `docs/` files)
**Reviewable lines**: 96
**Agents spawned**: logic (`gpt-5.6-sol[1M]`), frontend (`gpt-5.6-terra[1M]`), performance (`sonnet[1M]`); support trace by `asm-finder`
**Agents skipped**: data-security (no security/data cone), contracts (one-set/dispose contract covered by logic and chair), reuse (no new reuse question), additional discovery lenses (verification cone limited to B6-B8)
**Verdict**: **BLOCK**
**Counts**: 2 BLOCK, 0 WARN, 0 SUGGEST

## Scope lock

Passed. Commit `cc21a52c` contains only accepted B6-B8 remediation, interface adaptations, regression tests, prior-round triage, analytics, and task/workflow completion metadata. No new capability, task semantics, external contract, or invariant owner was introduced.

## Verification scope and impact cone

- B6: every resolver call now reconciles one complete set; workspace-folder/repository callers and root transitions must pass empty sets as well as non-empty sets.
- B7: resolver disposal, FileTreeHost ownership, editor panel permanent teardown, persistent view-provider lifecycle, and in-flight root resolution.
- B8: per-assessment pane/session resolver creation, success/failure/throw paths, cross-repository overlap, materialization before final release.

## Findings

### B6

- **ID**: B6
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: asm-review-logic and asm-review-performance
- **Class**: feature
- **File:line**: `src/utils/resolvedPathMemo.ts:198`
- **Title**: Changing pinned sets are claimed forever
- **Evidence**: The pinned/tracked split is deleted. `prepare(paths)` releases every previously claimed path absent from the complete next set, then claims the deduplicated current set. Repository discovery now passes workspace folders and Git roots as one array; tests cover a path leaving either former half.
- **Impact**: The original repo-discovery workspace-history leak and stale reopen mechanism are removed.
- **SuggestedFix**: None for the helper/repository boundary. The separate root-to-null caller gap is B9.
- **Status**: fixed
- **Triage**: prior B6 invariant verified at the helper and repo-discovery callers

### B7

- **ID**: B7
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: asm-review-logic, frontend, and performance
- **Class**: feature
- **File:line**: `src/providers/TerminalEditorProvider.ts:419`
- **Title**: Closed editor surfaces retain permanent claimant identities
- **Evidence**: `TrackedPathResolver.dispose()` releases the complete current set and is idempotent. `FileTreeHost.dispose()` owns it. The shared new/revived editor setup calls host disposal from the panel's permanent `onDidDispose` path after attachment cleanup; provider-level coverage drives the panel callback and proves the memo entry leaves. Persistent sidebar and bottom-panel provider hosts deliberately remain extension-lifetime.
- **Impact**: Closed editor panels no longer accumulate dead claimant symbols or prevent final release.
- **SuggestedFix**: None.
- **Status**: fixed
- **Triage**: B7b's production wiring mutation is killed; new and revived editors share the verified teardown

### B8

- **ID**: B8
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: asm-review-logic
- **Class**: feature
- **File:line**: `src/extension.ts:721`
- **Title**: Overlapping prepares can invalidate an assessment's in-flight paths
- **Evidence**: Every pane or session fact read creates its own resolver, awaits and materializes resolved strings through that resolver, then disposes it in `finally`. Failed registry reads return before claiming. Different repository queues therefore never share a resolver-local set, and every success, rejection, or thrown preparation releases its transaction claim.
- **Impact**: Concurrent removal assessments cannot release one another's in-flight paths or read lexical blocker evidence after their own prepare.
- **SuggestedFix**: None.
- **Status**: fixed
- **Triage**: prior B8 transaction invariant verified across both fact sources and terminal paths

### B9

- **ID**: B9
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: asm-review-logic, frontend, and performance, corroborated by chair and `asm-finder`
- **Class**: feature
- **File:line**: `src/providers/fileTreeHost.ts:143`
- **Title**: Closing the last workspace folder does not release the FileTree root claim
- **Evidence**: The workspace-folder handler always calls `resolveWorkspaceRoot()`, but that method returns immediately when `workspaceRoot` is `null`; it never calls `paths.prepare([])`. The one-set resolver can reconcile old to new non-null roots, but it cannot release the old root if the current set is empty unless the caller supplies that empty set. Sidebar and bottom-panel hosts persist for the window and intentionally are not disposed on view teardown, so no other path releases their unique owner claims. The author-declared removed FileTreeHost re-root test leaves this transition uncovered.
- **Impact**: After closing the last workspace folder, the former root remains claimed. If the same symlink spelling is retargeted and reopened, the host reuses the stale physical answer instead of resolving again, reproducing incorrect FileTree containment under the new D6 lifecycle.
- **SuggestedFix**: When a resolver exists, reconcile on every workspace-root state: call `prepare(root === null ? [] : [root])`. Preserve the immediate null-root post, and add an attachment-harness regression for root A -> null -> retargeted/reopened A proving a second realpath and the new containment root.
- **Status**: open
- **Triage**: new finding inside B6/B7's direct remediation cone; different caller mechanism, so it receives a new ID rather than extending B6

**Invariant inventory**: A FileTree host claims exactly its current workspace root, including the empty set. Affected: root-to-null transitions on persistent sidebar and bottom-panel hosts, and on editor hosts before permanent disposal. Verified safe: non-null A-to-B reconciliation, null-to-non-null initial claim, and permanent editor disposal.
- **AuthorStatus**: accepted
- **AuthorTriage**: Confirmed at `fileTreeHost.ts:144`: the null-root guard returns before `prepare`, so closing the last folder leaves the old root claimed by a host that outlives the window's workspace. B6 taught `prepare` to reconcile; this is a caller that declines to call it. Fixed by treating "no root" as the empty set rather than as nothing to do.

### B10

- **ID**: B10
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: asm-review-frontend, corroborated by chair
- **Class**: feature
- **File:line**: `src/providers/fileTreeHost.ts:228`
- **Title**: Persistent views miss workspace-root changes while their webview is detached
- **Evidence**: Sidebar and bottom-panel teardown disposes the `attach()` subscription, including `onDidChangeWorkspaceFolders`, while deliberately retaining the host and its resolver claim. If the workspace folders change during that detached interval, the next `attach()` only copies `activeFileTreeRoot` and installs a new listener; it never calls `resolveWorkspaceRoot()`. The old root remains claimed and the current root is unprepared. The next init therefore gets a lexical `resolvedWorkspaceRoot` until some later folder event.
- **Impact**: A re-resolved sidebar or bottom panel can resume with stale ownership and repeat the original symlink containment failure even though B1's constructor wiring is present. The stale old claim also blocks final release.
- **SuggestedFix**: Reconcile the current root whenever `attach()` starts (including the empty set), before or alongside the new webview's init flow. Guard any late post by the existing generation, and add a detach -> workspace change -> reattach regression that requires the new physical root and release of the old one.
- **Status**: open
- **Triage**: new finding inside B7's persistent-view lifecycle cone; elevated from specialist WARN because the hard resolved-root acceptance remains false after a supported teardown/re-resolve sequence

**Invariant inventory**: A persistent host reconciles changes that occurred both while attached and while detached. Affected: sidebar and bottom-panel re-resolution after workspace changes. Verified safe: changes while attached, constructor-time initial claim, and permanent editor teardown.
- **AuthorStatus**: accepted
- **AuthorTriage**: Confirmed. `attach` installs the workspace-folder listener but never reconciles the root it is attaching to, so a folder change taken while the view was detached is invisible until the NEXT change — and a re-resolved sidebar initializes on the lexical root, which is exactly the failure this change exists to remove, reappearing after an ordinary view teardown.

## Adjudication

- B6, B7 and B8 are fixed. The simplified resolver, disposal ownership and operation-scoped removal claims match the accepted D6 contract.
- B9 is not B6 persistence through the same causal mechanism: the helper now reconciles correctly, but `FileTreeHost` omits the empty-set call. It is a new caller-level mechanism within the verification cone.
- B10 is a separate lifecycle mechanism: the host receives no root event while detached and `attach()` does not reconcile the state it missed.
- The deleted pinned-behavior test was correctly replaced. Deleting the proposed host re-root test did leave the exact root-to-null boundary unverified and B9 present.

## Inline support review

Changed tests contain no `.only` or `.skip`, await asynchronous operations, and discriminate helper release, idempotent disposal, transaction isolation, and production editor teardown. No test covers `workspaceRoot` becoming null while a persistent host remains alive, or changing while a persistent view is detached and then re-resolved.

## Recorded verification evidence

`bun run asm change verify-status attribute-a-path-to-the-worktree-it-resolves-into` records task 4_1 at exit 0 with 10 added assertions after the two declared test deletions. The caller reports check-types clean, 5,509 unit tests passing, I10 clean, Biome at 0 errors / 14 warnings, and both esbuild bundles building. Project verification was not rerun by review.

## Specialist results

- `asm-review-logic` — one-set reconciliation, dispose, removal isolation — `gpt-5.6-sol[1M]` — B6-B8 fixed; B9.
- `asm-review-frontend` — FileTree surface lifetime and root transitions — `gpt-5.6-terra[1M]` — B7 fixed; B9 and B10.
- `asm-review-performance` — claimant growth and release bounds — `sonnet[1M]` — B6-B8 fixed; B9.

## Requested record

- The removed “pinned path never releases” test correctly asserted the old defect and should remain deleted.
- The snapshot-pool dispose-barrier defect remains outside this commit and unchanged.

## Audit backlog

None.

## Accepted risk

None.

## Author note on the deleted test

The chair is right that removing the host root-transition test left B9 and B10
uncovered, and the deletion is the reason to say so plainly: I dropped it because
it called `setRoot`, which is `FileTreePanel`'s method and not the host's. The
correct response was to rewrite it against the attach harness, not to delete it
and record the deletion. Deleting a test because the version I wrote was wrong is
not the same judgement as deciding the behaviour needs no test, and I reported it
as though it were. Both transitions are now covered through `attach`.
