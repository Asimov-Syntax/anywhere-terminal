# Review Round 5: attribute-a-path-to-the-worktree-it-resolves-into

**Date**: 2026-08-30
**Cycle**: 2
**Round**: 5
**Mode**: verification (fastlane requested)
**Scope**: commit `25f22b7f3feefe466be582ac548f49fa45c491d2`
**Head**: `25f22b7f3feefe466be582ac548f49fa45c491d2` (explicit committed scope; working tree dirty outside the reviewed commit in change analytics and three `docs/` files)
**Reviewable lines**: 12
**Agents spawned**: logic (`gpt-5.6-sol[1M]`), frontend (`gpt-5.6-terra[1M]`)
**Agents skipped**: data-security, contracts, performance, reuse — the final verification cone is one FileTreeHost root-reconciliation method and its attach lifecycle
**Verdict**: **BLOCK**
**Counts**: 1 BLOCK, 0 WARN, 0 SUGGEST

## Scope lock

Passed. Commit `25f22b7f` contains only B9/B10 remediation, the attach-harness regressions, prior-round triage, analytics, and task/workflow completion metadata. No new capability, task semantics, contract owner, or unrelated production work was added.

## Prior findings verified

### B9 — fixed

`resolveWorkspaceRoot()` now calls the resolver for every root state. A null root supplies `[]`, whose reconciliation synchronously releases the prior claim before the null-root message is posted. Late resolutions remain harmless: memo flight ownership prevents stale settlement, and the existing root-generation guard prevents superseded corrective posts.

### B10 — fixed

`attach()` now reconciles the host's current root before installing the new folder listener. A workspace change taken while the view was detached therefore releases the old claim and prepares the current one on reattach; init may carry the lexical fallback while resolution is in flight, but the same guarded pass posts the physical correction afterward.

## Full-flow trace

- **A -> null**: folder event increments generation -> host reads null -> `prepare([])` releases A -> immediate null message -> settled empty pass may post a second idempotent null update.
- **A -> B while attached**: event -> generation bump -> `prepare([B])` releases A and claims B -> immediate message can be lexical -> current pass posts physical B.
- **Detached A -> B -> reattach**: old listener is absent -> `attach()` reads B and reconciles before the next event -> A is released. With ordinary init delivery, lexical init is corrected by the settled pass; a transient init retry can lose that correction, which is B11.
- **Late A after B/null**: final-release invalidation prevents A from settling in the memo; callbacks compute the host's current root and generation, never the stale root.
- **Constructor plus attach overlap**: both passes use the same resolver and root. They join one syscall; any duplicate correction is idempotent, and D7 prevents same-root/same-generation messages from remounting the tree.
- **Permanent editor close**: the prior round's host disposal still releases the complete current set after attachment teardown.

## Verification questions

- Null, same-root, changed-root and superseded passes end with the correct claim set.
- Reattachment reconciles every folder change missed while detached, but delivery is not guaranteed across a retried init; see B11.
- No path is reclaimed after permanent disposal; attachment listeners are removed before host disposal.
- The two new tests drive the actual `attach()` seam, assert release/current-root preparation, and fail independently under the two reported mutations.

## Inline support review

Changed tests contain no `.only` or `.skip`, await asynchronous state, and replace the previously deleted incorrect draft with behaviorally discriminating attach-harness coverage. They force an always-ready, always-successful post seam and therefore do not cover B11's init-retry ordering.

## Findings

### B11

- **ID**: B11
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: asm-review-frontend, corroborated by chair
- **Class**: feature
- **File:line**: `src/providers/fileTreeHost.ts:240`
- **Title**: A root correction can arrive before a retried init and be dropped
- **Evidence**: `attach()` now starts root reconciliation immediately. Provider `onReady` flips `_ready = true` before `safeSendWithRetry(init)` succeeds, and FileTreeHost gates corrective posts only on that early readiness flag. If the first init post fails and enters its 50 ms retry window, realpath can settle and successfully post `workspace-root-changed` first. The webview drops it because `fileTreeController` is created only while processing init (`src/webview/main.ts:764-766,1052`). The retry then delivers the init object captured with the lexical root, and the already-settled resolution has no remaining callback to correct it. TerminalViewProvider and TerminalEditorProvider share this ready-before-init retry shape.
- **Impact**: Under a supported transient postMessage failure, sidebar, bottom-panel, new-editor, or revived-editor FileTree containment can remain lexical for the surface's lifetime, recreating the core symlink attribution failure after B9/B10 reconciliation succeeded internally.
- **SuggestedFix**: Distinguish “webview sent ready” from “init was successfully delivered” for FileTreeHost correction posts, or explicitly send the host's current root state immediately after every successful retried init. Add provider-lifecycle regressions for view and editor surfaces with deferred realpath, failed first init post, successful retry, and a required physical containment root afterward.
- **Status**: open
- **Triage**: new finding inside B10's attach/init delivery cone; elevated from specialist WARN because the hard resolved-root acceptance remains false for the lifetime of a successfully initialized surface

**Invariant inventory**: Root reconciliation is not complete until its authoritative state is delivered after init creates the webview controller. Affected: first attach and reattach for sidebar, bottom panel, new editor and revived editor when init retries. Verified safe: first-attempt init success, resolution that settles after successful init, and later workspace-folder changes after the controller exists.
- **AuthorStatus**: accepted — confirmed, NOT fixed (cycle exhausted)
- **AuthorTriage**: Verified against code, not conceded on authority. `initPayload()` is captured by value where the message literal is built (`TerminalViewProvider.ts:1494,1548,1609`), `safeSendWithRetry` sleeps 50ms between attempts (`:1697`), and `onReady` sets `_ready = true` before the first send — so a realpath settling inside the retry window posts a correction to a webview with no controller, and the retry then delivers the payload captured before it. The surface keeps lexical containment for its lifetime. `TerminalEditorProvider` has the same ordering. This is D7's delivery gate naming the wrong event: the correction is gated on `_ready`, but the thing that must exist to receive it is a PROCESSED init. I am not fixing it in this cycle — the chair declared cycle 2 exhausted and the workflow's thrash stop hands the decision to the user.

## Recorded verification evidence

`bun run asm change verify-status attribute-a-path-to-the-worktree-it-resolves-into` records task 5_1 at exit 0 with three added assertions. The caller reports check-types clean, 5,512 unit tests passing, I10 clean, Biome at 0 errors / 14 warnings, and both esbuild bundles building. Project verification was not rerun by review.

## Specialist results

- `asm-review-logic` — null, reattach, overlap and supersession flow — `gpt-5.6-sol[1M]` — no findings.
- `asm-review-frontend` — view lifecycle, init/correction and attach-harness tests — `gpt-5.6-terra[1M]` — B11.

## Cycle conclusion

Cycle 2 reached its third and final round with B11 open. The cycle is exhausted: do not open round 6. Apply the workflow's thrash-stop handback rather than attempting another fix/verification round in this cycle.

## Requested record

The snapshot-pool dispose-barrier defect remains outside this commit and unchanged.

## Audit backlog

None.

## Accepted risk

None.
