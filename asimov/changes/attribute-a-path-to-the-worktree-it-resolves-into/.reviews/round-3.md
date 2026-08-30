# Review Round 3: attribute-a-path-to-the-worktree-it-resolves-into

**Date**: 2026-08-30
**Cycle**: 2
**Round**: 3
**Mode**: discovery (fastlane requested)
**Scope**: range `ae9e44ced295a34dfafc0a1dad1c791386aa511c..890bec509001199d16449389f82550fe5502fe62`
**Head**: `890bec509001199d16449389f82550fe5502fe62` (explicit committed range; working tree dirty outside the reviewed range in change analytics and three `docs/` files)
**Reviewable lines**: 178
**Agents spawned**: logic (`gpt-5.6-sol[1M]`), performance (`gpt-5.6-terra[1M]`), contracts (`sonnet[1M]`), frontend (`gpt-5.6-terra[1M]`), reuse (`gpt-5.6-luna[1M]`); two support traces by `asm-finder`
**Agents skipped**: data-security — no changed data/auth/input/security boundary; the read-authorizing resolved predicate is outside this range
**Verdict**: **REJECT**
**Counts**: 3 BLOCK, 0 WARN, 0 SUGGEST
**Blocker split**: 3 feature / 0 machinery

## Cycle and gate context

- Cycle 1 closed after round-2 B4 failed the remediation obligation test and was handed back to planning. Gate 2 was re-earned at `ae9e44ce`; this is cycle 2 discovery, not verification.
- Binding additions: D6 owns claimant release separately from D4 freshness; D7 makes an unchanged root/generation a containment-only update. Tasks 3_1 and 3_2 are complete.
- Scope lock is not applicable to this discovery round. The new claimant registry is the planned invariant owner this cycle exists to review.
- Prior `audit-backlog`: none.

## Risk map

- Shared mutable state: memo promises, settled answers, holder sets, and resolver-local previous sets must agree under overlap and disposal.
- Growth axes: workspace-folder history, editor surfaces opened/closed, active pane/session sets, removal-assessment snapshots, open Git repositories, and live file-tree surfaces.
- Lifecycle split: extension-lifetime consumers, per-surface consumers, operation-scoped removal reads, and changing pinned/tracked sets use one resolver abstraction.
- Cross-repository concurrency: mutation queues serialize per repo, while removal assessments for different repositories can overlap through one resolver handle.
- UI integration: four file-tree surface construction paths, resolution-only messages, and decoration rebuild ownership.

## Full-flow trace

- Memo cold/hot path: resolver claims owner -> shared promise joins/settles -> synchronous `resolvedOr`; final release invalidates the answer. Failed realpath leaves the claim but retries on the next prepare.
- Presence: separate pane/session handles claim the current sets; failed session reads reuse the last successful set, so no release occurs. The host projection single-flight reruns dirty work before commit.
- Removal: two extension-level handles prepare facts, then callers read `resolvedOr`; per-repository queues allow these transactions to overlap across repositories.
- Repository discovery: current workspace folders are passed as `pinned`; current Git API roots are `tracked`; discovery itself is rebuild-gated.
- Decorations: one extension-lifetime tracked handle; folder passes may overlap, but `folderPass` lets only the current pass rebuild.
- File tree: each surface owns a distinct tracked handle; sidebar, bottom panel, new editor, and revived editor receive the shared memo. Same root and generation updates only containment metadata.
- Error/fallback: unresolved paths remain lexical; the defensive rejected-prepare decoration branch is unreachable through the production memo because realpath failures resolve lexically rather than reject.

## Prior-cycle disposition

- **B1** production FileTree wiring: fixed across all four surfaces; provider-level wiring tests are discriminating.
- **B4** cross-producer over-release: fixed for active claimants; one claimant can no longer delete another's answer.
- **W1** resolution-only remount: fixed by root/generation identity check.
- **W2** duplicate decoration rebuild: fixed; the post-resolution pass owns the single authoritative rebuild.
- Earlier fixed findings B2, B3, B5 and S1 remain fixed.

## Findings

### B6

- **ID**: B6
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: asm-review-logic and asm-review-performance, corroborated by chair
- **Class**: feature
- **File:line**: `src/utils/resolvedPathMemo.ts:179`
- **Title**: Changing pinned sets are claimed forever
- **Evidence**: `createTrackedPathResolver` stores and reconciles only `tracked` in `last`; every `pinned` path is claimed but never recorded or released. `resolveRepoOutcomes()` passes the current workspace folders as `pinned` on every rebuild (`src/worktree/repoRoots.ts:182`). Removing folder A and later preparing folder B therefore leaves this resolver's owner permanently attached to A. The new test explicitly asserts that pinned paths are never released, but does not cover a changing pinned set.
- **Impact**: `holders`, `memo`, and `settled` grow with workspace-folder history over the extension-host lifetime, with no structural cap. More importantly, reopening the same spelling after a symlink retarget reuses the obsolete resolution because the stale pinned claim prevented final-release invalidation, so repository discovery can choose the wrong root.
- **SuggestedFix**: Reconcile the complete bounded set owned by the resolver, tracking previous pinned paths as well as tracked paths and releasing either when absent from the next call. If a truly lifetime-long pin is needed, model it with a distinct explicit lifetime rather than treating every value ever passed as permanent.
- **Status**: open
- **Triage**: new cycle-2 discovery; concrete D6 release failure

**Invariant inventory**: Every changing bounded set releases paths that leave it. Affected: repo-discovery workspace folders. Verified safe: tracked repository roots, decoration folders, pane cwds, and session cwds all use the tracked-set difference.
- **AuthorStatus**: accepted
- **AuthorTriage**: Confirmed at `repoRoots.ts:182`, and the mistake is mine in the doc as much as the code: I wrote that `pinned` "is the caller's own standing set" and that pruning it "would re-resolve on every pass". Both halves are wrong. Repository discovery passes the workspace folders as pinned and those change, so it is not standing; and reconciling would re-resolve nothing, because only a path that LEFT the set is released and an unchanged one is a set membership test. The distinction bought nothing and cost a leak, so it goes: one reconciled set, `prepare(paths)`.

### B7

- **ID**: B7
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: asm-review-performance and asm-review-logic, corroborated by frontend, contracts, chair, and `asm-finder`
- **Class**: feature
- **File:line**: `src/providers/TerminalEditorProvider.ts:210`
- **Title**: Closed editor surfaces retain permanent claimant identities
- **Evidence**: Every new or revived editor creates a distinct `createTrackedPathResolver(pathMemo)` and `FileTreeHost.resolveWorkspaceRoot()` claims its root. Panel disposal runs the FileTree attachment disposable, but `TrackedPathResolver` exposes no `dispose`/release-all operation and `FileTreeHost` cleanup never empties the resolver's tracked set. The unique owner symbol therefore remains in `holders` after the editor provider is gone.
- **Impact**: Opening and closing N editor panels at one root grows that root's holder set by N; across workspace changes, holder keys and resolved entries grow with closed-panel/root history. Dead owners prevent final release, so a reopened or retargeted path can keep a stale resolved value. This directly violates D6's “released when the last claimant lets go.”
- **SuggestedFix**: Add an idempotent resolver `dispose()`/release-all operation covering every claimed path, have `FileTreeHost` own and invoke it at permanent consumer disposal, and wire editor panel teardown to that lifecycle. Add a regression that closes multiple editor surfaces, changes/reopens the root, and proves the old owners no longer retain it.
- **Status**: open
- **Triage**: new cycle-2 discovery; uncapped per-surface growth and stale ownership

**Invariant inventory**: A claimant identity lives no longer than its consumer. Affected: new and revived editor FileTree hosts. Verified safe: extension-lifetime decoration, worktree-discovery, presence, removal, sidebar and panel provider handles end with the extension host; their process exit drops the entire memo.
- **AuthorStatus**: accepted
- **AuthorTriage**: Confirmed. Every `FileTreeHost` mints a resolver and nothing ever releases it, so N opened-and-closed editors at one root leave N dead symbols holding it — and a dead claimant is worse than a leaked entry, because it blocks the final release that would let a retargeted spelling resolve again. The claim lifecycle D6 defines has no end, which is the gap. Fixed with an idempotent `dispose()` on the resolver, owned by the host and called on permanent surface teardown.

### B8

- **ID**: B8
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: asm-review-logic, corroborated by chair and `asm-finder`
- **Class**: feature
- **File:line**: `src/utils/resolvedPathMemo.ts:179`
- **Title**: Overlapping prepares can invalidate an assessment's in-flight paths
- **Evidence**: One resolver mutates shared `last` before awaiting. Prepare A claims set A and waits on realpath; prepare B releases A, replaces `last`, and claims B. A's guarded promise then cannot publish to `settled`, yet A resumes and its caller reads `resolvedOr(A)` lexically. Removal uses one pane handle and one session handle across all repositories. Mutation queues serialize only per repository, so assessments for different repositories can overlap; neither removal transaction has a generation/retry guard.
- **Impact**: If pane/session evidence changes while two repository removals are assessed, the earlier assessment can compare a symlink spelling lexically and omit occupants from the confirmation for an irreversible removal.
- **SuggestedFix**: Make each removal read transaction own an independent claim until it has materialized its resolved fact array, releasing in `finally`, or serialize the complete `prepare -> resolvedOr` transaction per shared resolver. A generation guard that only suppresses output is insufficient for removal because its result is the safety evidence.
- **Status**: open
- **Triage**: new cycle-2 discovery; reachable across per-repository mutation queues

**Invariant inventory**: The claimed set used by an observation remains valid until that observation has materialized every resolved value. Affected: pane and external-session removal facts across concurrent repositories. Verified safe: presence projection is single-flight with dirty rerun; worktree discovery is rebuild-gated; decoration and FileTree allow overlap but discard superseded side effects with pass/generation guards.
- **AuthorStatus**: accepted
- **AuthorTriage**: Confirmed, and it is the sharpest of the three because the answer feeds a confirmation for an irreversible removal. `prepare` mutates `last` synchronously and then awaits, so a second assessment through the same handle releases the first one's paths mid-flight; the guarded continuation then declines to publish and the first assessment reads its panes lexically — silently missing exactly the symlink-reached pane this whole change exists to catch.

  Fixed by giving each removal assessment its own claim for the length of the transaction, released in a `finally`. That also retires the two long-lived removal handles: an assessment is a transaction, not a standing consumer, and modelling it as one was the error.

## Inline support review

- Changed tests contain no `.only` or `.skip` and await asynchronous behavior.
- Provider wiring tests boot every surface and assert a physical resolved root, so they do not pass on silence.
- Mutation M4's failed-registry behavior is now covered and killed.
- No test covers a changing pinned set, editor claimant disposal, or overlapping removal prepares; these are exactly the three open findings.
- The deleted rejected-prepare decoration test was correctly removed: the production memo converts realpath failure into a lexical success, so that test asserted an unreachable mechanism.

## Recorded verification evidence

`bun run asm change verify-status attribute-a-path-to-the-worktree-it-resolves-into` records tasks 3_1 and 3_2 at exit 0, with 14 added assertions for 3_1 and 5 for 3_2. The caller reports check-types clean, 5,504 unit tests passing, I10 clean, Biome at 0 errors / 14 warnings, and both esbuild bundles building. Project verification was not rerun by review.

## Specialist results

- `asm-review-logic` — claimant state machine and overlapping operations — `gpt-5.6-sol[1M]` — B6, B7, B8.
- `asm-review-performance` — holder/memo growth axes — `gpt-5.6-terra[1M]` — B6, B7.
- `asm-review-contracts` — lifecycle and provider propagation — `sonnet[1M]` — B7 corroboration; constructor propagation and optional compatibility verified.
- `asm-review-frontend` — four surfaces, D7 and decoration flow — `gpt-5.6-terra[1M]` — B7 corroboration; B1/W1/W2 fixes verified.
- `asm-review-reuse` — resolver extraction and duplication — `gpt-5.6-luna[1M]` — no findings; presence duplication was removed coherently.

## Requested record

- The snapshot-pool dispose-barrier defect remains outside this range; neither `snapshotPool.ts` nor its test changed.
- All nine reported 3_1/3_2 mutations are killed, but they do not exercise the three lifecycle/concurrency boundaries above.

## Audit backlog

None.

## Accepted risk

None.
