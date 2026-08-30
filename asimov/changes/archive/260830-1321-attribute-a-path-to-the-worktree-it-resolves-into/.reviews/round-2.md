# Review Round 2: attribute-a-path-to-the-worktree-it-resolves-into

**Date**: 2026-08-30
**Cycle**: 1
**Round**: 2
**Mode**: verification (fastlane requested)
**Scope**: commit `57e0f642cc79522c69215425de2066580fb90fd0`
**Head**: `57e0f642cc79522c69215425de2066580fb90fd0` (explicit committed scope; working tree dirty outside the reviewed commit in change analytics and three `docs/` files)
**Reviewable lines**: 209
**Agents spawned**: logic (`gpt-5.6-sol[1M]`), frontend (`gpt-5.6-terra[1M]`), performance (`sonnet[1M]`); support trace by `asm-finder`
**Agents skipped**: data-security (no data/auth/security cone), contracts (message-contract cone covered by frontend and chair), reuse (no new reuse question beyond B4 ownership), second logic roster (one logic assignment covered memo/removal/lifecycle)
**Verdict**: **BLOCK**
**Counts**: 2 BLOCK, 2 WARN, 0 SUGGEST

## Scope lock

Passed. Commit `57e0f642` contains only accepted round-1 remediation, its interface propagation, regression tests, review triage, and task-completion metadata. The two webview fields and generation guards are remediation of B1/B2, not a new capability or invariant owner.

## Verification scope and impact cone

- B1: extension path memo -> terminal provider construction -> `FileTreeHost` -> init/root-change message -> controller -> panel containment and re-root behavior.
- B2/S1: workspace-folder preparation -> reset/rebuild -> path filtering -> decoration deltas, including delayed and superseded passes.
- B3: memo success/failure completion across single-key/global invalidation and replacement flights.
- B4: pane/session set retirement -> shared memo invalidation -> presence, removal, decoration, repository, and FileTree consumers; active-set growth axis.
- B5: synchronous pane observation -> awaited resolution -> pure removal evaluation.

## Findings

### B1

- **ID**: B1
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: asm-review-logic and asm-review-frontend, corroborated by chair and `asm-finder`
- **Class**: feature
- **File:line**: `src/providers/fileTreeHost.ts:121`
- **Title**: Resolved workspace-root behavior is not wired into production hosts
- **Evidence**: The changed `FileTreeHost` constructor makes `paths` optional and falls back lexically when absent. Every production construction still passes only `(gitDecorationProvider, watcherPool)`: `TerminalViewProvider.ts:162` and `TerminalEditorProvider.ts:203`; editor revival reaches the same constructor through `TerminalPanelSerializer`. `extension.ts` creates the shared memo but does not thread a tracker into any terminal provider. The new tests instantiate `FileTreeHost` with a resolver directly, so they do not exercise production wiring.
- **Impact**: Sidebar, panel, new editor, and revived editor surfaces still send identical spelled/resolved roots. A physical editor or shell path beneath a symlink-opened workspace remains outside by comparison, so round-1 B1 persists unchanged in production.
- **SuggestedFix**: Thread a distinct `createTrackedPathResolver(pathMemo)` through every terminal provider/editor creation and restoration path into `FileTreeHost`. Add a provider-level production-wiring test, not only a directly injected host test. Route resolution-only updates without remounting the tree as described in W1.
- **Status**: open; persists from round 1
- **Triage**: the host/message/panel mechanism is present, but the production dependency path is absent; severity unchanged because the accepted behavior remains unreachable
- **AuthorStatus**: accepted
- **AuthorTriage**: Confirmed against code, not argued: `TerminalViewProvider.ts:162` and `TerminalEditorProvider.ts:203` both construct `new FileTreeHost(gitDecorationProvider, watcherPool)`, so `paths` takes its `null` default on every shipped surface and the panel keeps comparing against the mounted spelling. The round-1 fix is real but unreachable. My round-1 tests injected the host directly, which is exactly the shape that cannot catch this. NOT fixed in this round: the wiring is "register a standing consumer with the shared memo", which is the same seam B4 reopens — see the handback note below.

### B2

- **ID**: B2
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: asm-review-logic
- **Class**: feature
- **File:line**: `src/providers/gitDecorationProvider.ts:176`
- **Title**: Decorations rebuild before workspace-folder resolution settles
- **Evidence**: The current folder pass now resets after `prepare()` settles and checks `folderPass` plus `disposed`, so a stale pass cannot rebuild over a newer folder set. The delayed-realpath regression proves a physical path appears without another Git event.
- **Impact**: The prior indefinite lexical result is removed. The remaining duplicate-reset cost is recorded separately as W2 and does not preserve the correctness defect.
- **SuggestedFix**: None for the B2 invariant; address W2 without removing the authoritative post-resolution rebuild.
- **Status**: fixed
- **Triage**: accepted remediation verified through cold and supersession paths
- **AuthorStatus**: accepted
- **AuthorTriage**: Fixed in 57e0f642 and confirmed fixed by this round. No further action.

### B3

- **ID**: B3
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: asm-review-logic
- **Class**: feature
- **File:line**: `src/utils/resolvedPathMemo.ts:46`
- **Title**: In-flight resolution can restore stale state after invalidation
- **Evidence**: Both continuations now compare the current map entry with their own promise before publishing or deleting. Tests cover stale success after `invalidate`, stale success after `invalidateAll`, and stale failure against a replacement flight.
- **Impact**: Invalidated and superseded operations can no longer restore stale settled state or evict a newer entry.
- **SuggestedFix**: None.
- **Status**: fixed
- **Triage**: prior invariant verified across success, failure, single-key invalidation, global invalidation, and replacement
- **AuthorStatus**: accepted
- **AuthorTriage**: Fixed in 57e0f642 and confirmed fixed by this round. No further action.

### B4

- **ID**: B4
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: asm-review-logic, corroborated by chair
- **Class**: feature
- **File:line**: `src/worktree/presenceProjector.ts:1046`
- **Title**: Producer-local release still invalidates paths owned by other consumers
- **Evidence**: The new pane and session set differences independently call the global `forgetCwd`. Within presence, a session departure after pane preparation leaves a live pane path absent until the next projection. More importantly, a pane or session leaving a symlink-spelled workspace root deletes the standing answer used by `gitDecorationProvider.ts:161`; decorations prepare only at construction/folder changes, so subsequent physical Git deltas fall back lexically and can be dropped indefinitely. The planned FileTree resolver has the same prepare-on-root-change shape. The author's rebuttal that every consumer re-prepares after invalidation is true for presence/removal/repository passes, but false for decoration and FileTree standing roots.
- **Impact**: The history leak is fixed, but the same round-1 cross-producer correctness mechanism persists. Unrelated pane/session retirement can disable symlink-aware decoration and, once B1 is wired, FileTree containment until an unrelated structural event.
- **SuggestedFix**: Track ownership across producer sets and invalidate only after the final owner releases the normalized spelling, or provide an equivalent invalidation/reprepare protocol for every standing consumer. At minimum, pane and session ownership must be released against their union; the complete invariant must include decoration, FileTree, and repository owners.
- **Status**: open; persists from round 1
- **Triage**: author rebuttal rejected with concrete non-preparing consumers; severity unchanged. Verified safe boundaries: pane-only shared directories, successful pane/session history eviction, failed registry retention, steady-set syscall bound. Affected boundaries: pane/session cross-set retirement and standing decoration/FileTree roots.
- **AuthorStatus**: accepted
- **AuthorTriage**: My round-1 rebuttal was wrong and this round refutes it with the case I failed to check. I claimed cross-producer invalidation costs a re-resolve rather than correctness. That holds only for consumers that reprepare. Decorations do not: `resolveFolders()` runs at construction and on workspace-folder change only (`gitDecorationProvider.ts:727,733`). A workspace folder is also a pane cwd in the ordinary case, so the last pane there closing drops the entry and decorations fall back lexically for the window's life. That is the defect this change exists to remove.

  NOT fixed in this round, and deliberately so. Every fix that closes it either introduces an ownership registry over the shared memo (a new lifecycle owner) or restates D4, whose current wording -- resolution is invalidated structurally -- is what presence's retirement release is claiming cover under. A pane closing is not a structural change to the filesystem; the directory did not move. So the release is memory bounding wearing D4's clothes, and round-1 B4 (the leak) and round-2 B4 (the over-release) pull in opposite directions until something owns "who still needs this path". That is a decision, not a patch: it fails the obligation test in the design lifecycle's remediation boundary, so it is parked and handed back to asimov-plan rather than landed as a fix commit.

### B5

- **ID**: B5
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: asm-review-logic
- **Class**: feature
- **File:line**: `src/extension.ts:706`
- **Title**: Removal facts combine pane cwd and activity from different observations
- **Evidence**: Pane id, cwd, and activity are now copied synchronously into `observed` before path preparation is awaited; the returned facts only replace each captured cwd with its resolved form.
- **Impact**: The removal assessment no longer combines pre-await cwd with post-await activity. The absence of a dedicated activation harness is acknowledged; the structural invariant is directly visible in the changed producer.
- **SuggestedFix**: None.
- **Status**: fixed
- **Triage**: one-pane-observation property verified by reading the full producer/evaluator flow
- **AuthorStatus**: accepted
- **AuthorTriage**: Fixed in 57e0f642 and confirmed fixed by this round. No further action.

### S1

- **ID**: S1
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P4
- **Agent**: chair
- **Class**: feature
- **File:line**: `src/providers/gitDecorationProvider.test.ts:861`
- **Title**: The surviving decorated-path mutation is not equivalent
- **Evidence**: The new regression prepares the decorated candidate's own spelling to resolve elsewhere, then proves production still compares that candidate lexically while resolving only the folder root. Applying `resolvedOr(absPath)` changes the result and fails the test.
- **Impact**: The mutation is now correctly classified and killed; D1's per-event lexical boundary is pinned.
- **SuggestedFix**: None.
- **Status**: fixed
- **Triage**: non-equivalence conceded and regression verified
- **AuthorStatus**: accepted
- **AuthorTriage**: Fixed in 57e0f642. I conceded the round-1 equivalent-mutant claim: sharing the memo in 1_4 is what made the mutant non-equivalent, and the reviewer was right.

### W1

- **ID**: W1
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: chair
- **Class**: feature
- **File:line**: `src/webview/fileTree/FileTreeController.ts:152`
- **Title**: A resolved-only root update tears down and remounts the file tree
- **Evidence**: `FileTreeHost.resolveWorkspaceRoot()` re-posts `workspace-root-changed` with the same spelling and generation when realpath settles. The controller always calls `panel.handleRootChanged()`, which exits search, disposes the tree, clears `expandedPaths`, empties the DOM, and remounts. The message changes only the containment root; the mounted root did not change. No test covers the controller receiving this resolution-only update after the panel is mounted.
- **Impact**: Once B1 is wired, a slow initial realpath can interrupt search, cancel in-flight tree work, and discard expanded descendants solely because containment metadata became available.
- **SuggestedFix**: Detect unchanged `rootPath`/`rootGeneration` and update only the resolved-root pair, or use a distinct containment-root update message that does not enter `handleRootChanged`. Add a mounted/expanded-panel regression.
- **Status**: open
- **Triage**: new finding inside B1's behavioral impact cone
- **AuthorStatus**: accepted
- **AuthorTriage**: Correct, and it upgrades in practice: wiring B1 without this ships a visible regression, since every window open would discard search and expansion state the moment a slow realpath settles. Fixed together with B1, not before it -- the re-post only exists because the host resolves after mount.

### W2

- **ID**: W2
- **Severity**: WARN
- **Confidence**: MEDIUM
- **Priority**: P3
- **Agent**: asm-review-performance
- **Class**: feature
- **File:line**: `src/providers/gitDecorationProvider.ts:176`
- **Title**: Each workspace-folder change now performs two full decoration resets
- **Evidence**: The existing folder-change handler calls `resolveFolders()` and immediately `provider.reset()`. The changed `resolveFolders()` calls `provider.reset()` again when preparation settles. Each reset scans all decorated paths, clears repo maps, and rebuilds every open repository. Growth axis is total decorated paths across open repositories, paid twice per folder-change event.
- **Impact**: Folder changes produce duplicate full recomputation and delta processing. The event is cold and structurally bounded, so this is warning-level rather than gating.
- **SuggestedFix**: Preserve immediate stale-state clearing without rebuilding twice—for example, split clear from authoritative rebuild—or make the post-resolution reset the sole full rebuild while maintaining correct interim semantics.
- **Status**: open
- **Triage**: new performance finding inside B2's remediation cone
- **AuthorStatus**: accepted
- **AuthorTriage**: Correct. Two full rebuilds per folder change, one of which is pure waste. Cold and bounded, so non-gating. Fixed alongside B1/W1 in the same seam.

## Adjudication

- B1 remains BLOCK, not the frontend specialist's proposed WARN: persistence cannot lower severity without an impact/likelihood delta, and the hard acceptance remains entirely inactive in production.
- B4 remains the same BLOCK. The leak half is fixed, but the original invariant also named cross-producer invalidation. Decoration provides a concrete consumer that does not reprepare after pane/session invalidation, refuting the round-1 rebuttal.
- B2, B3, B5, and S1 are fixed. Their mutations and regressions discriminate the corrected mechanisms; B5 is structural and honestly has no activation test.
- W1 and W2 are new but admissible because both lie directly inside the B1/B2 fix impact cone.

## Inline support review

Changed tests contain no `.only` or `.skip`, await their asynchronous operations, and add behaviorally discriminating assertions. The production-wiring gap is not covered because B1 tests inject `FileTreeHost` directly. The resolution-only remount path is also untested.

## Recorded verification evidence

`bun run asm change verify-status attribute-a-path-to-the-worktree-it-resolves-into` records task 2_1 at exit 0 and 22 added assertions. The caller reports check-types clean, 5,489 unit tests passing, I10 clean, Biome at 0 errors / 14 warnings, and both esbuild bundles building. Project verification was not rerun by review.

## Specialist results

- `asm-review-logic` — B3/B4/B5 and shared-memo cone — `gpt-5.6-sol[1M]` — B4 persists; B1 wiring independently corroborated; B3/B5 fixed.
- `asm-review-frontend` — B1/B2/S1 host-to-webview and decoration flows — `gpt-5.6-terra[1M]` — B1 wiring gap; B2/S1 fixed.
- `asm-review-performance` — B4 growth/cost and standing consumers — `sonnet[1M]` — direct pane/session leak fixed; W2 duplicate full reset.

## Audit backlog

None.

## Accepted risk

None.
