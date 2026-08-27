# Review Round 4

- Date: 2026-08-27
- Cycle: 2
- Round: 4
- Mode: verification
- Scope: working tree — accepted round-3 remediation and behavioral impact cone
- Scope lock: passed — tasks 8_1..8_9 remediate accepted round-3 findings; the branch-bearing defaults request and assembly test serve existing accepted requirements rather than adding capability.
- Reviewable lines: 444
- Agents spawned:
  - asm-review-logic — confirmation settlement, missing registrations, post-removal observation, prune reads, and partial create outcomes — opus[1M]
  - asm-review-frontend — create/prune entry, defaults correlation, result reconciliation, and real assembly coverage — gpt-5.6-terra[1M]
  - asm-review-data-security — exclude patterns, configured/free-path authority, stat failures, and prune count admission — sonnet[1M]
- Agents skipped:
  - asm-review-contracts — contract cone was covered by frontend/data-security against the approved D14-D17 and task fields
  - asm-review-performance — W5/W6 were verified chair-side in their narrow remediation cone
  - asm-review-reuse — no new extraction/split was introduced beyond the accepted remediation
- Verdict: BLOCK
- Counts: BLOCK 1 | WARN 8 | SUGGEST 1
- Verification: `pnpm run check-types` passed; focused round-4 verification passed (13 files, 404 tests); `pnpm run test:unit` passed (216 files, 4230 tests); `pnpm exec biome check src/` passed with 13 pre-existing warnings outside changed files; `git diff --check HEAD` passed.

## Current findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-frontend, asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:451
- title: A removal outcome is still reconciled before it exists, so the vanished row still loses its notice
- evidence: `handleTreeResponse()` runs `reconcile()` during the post-attempt tree push, before the service posts the mutation result. At that moment there is no result to re-scope. The later `handleMutationResult()` appends the result with its now-absent `worktreeId` and only calls `push()`; no further tree response is guaranteed. `WorktreeView.resultsFor()` still renders worktree-scoped notices only inside live rows. The changed tests exercise the reverse order (result first, tree second), not the production order (tree first, result second).
- impact: A successful removal, or an indeterminate removal whose registration vanished, still completes without the originating surface showing its outcome. The third boundary of round-3 B1 remains open.
- suggestedFix: In `handleMutationResult()`, compare the incoming `worktreeId` with the current tree immediately. If the row is absent but its repo remains, strip `worktreeId`, carry `orphanedLabel`, and store it at repo scope. Add the production ordering test: tree without row first, result second, then assert the repo notice renders.
- status: persists from round 1
- triage: Create entry and prune-origin forwarding are fixed. Severity remains BLOCK because the same accepted “every started mutation reports” invariant still fails on the ordinary successful-removal path; only the affected boundary inventory narrowed.

### B10

- ID: B10
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-data-security
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/extension.ts:496
- title: Exclude injection is closed, but the pattern is still per worktree and is platform-wrong on Windows
- evidence: Control characters are now rejected and the writer accepts one escaped relative pattern, closing the security defect. Production nevertheless passes `path.relative(repoPath, createdPath)`, so each create writes its leaf (`/<root>/<worktree>/`) rather than the one create-root entry D8 requires; repeated creates under one root still accumulate. On Windows `path.relative` returns backslashes, and `excludePatternFor()` escapes them as literal backslashes instead of converting separators to Git's `/`, so the pattern does not name the directory Git sees.
- impact: Parent status hygiene remains ineffective on Windows and the exclude file grows per created worktree rather than once per root.
- suggestedFix: Derive the intended create-root directory, normalize its relative path to `/` separators, and write one escaped anchored root pattern. Test two different creates under one root and a win32 relative path.
- status: persists from round 3
- triage: Downgraded from BLOCK with a stated evidence delta: the newline rule-injection/security reach is fixed. The remaining impact is correctness and duplicate accumulation.

### B12

- ID: B12
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-frontend
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:717
- title: Create-default authority still fails for production filesystem collisions and stale branch replies
- evidence: The host now accepts a branch, shares sanitization, and production supplies `readWorktreeCreateRoot`, fixing most of B12. Its filesystem check is still `options.exists?.(candidate) ?? false`, but `activate()` never supplies `exists`, so production checks registrations only and still offers an unregistered occupied directory. In the webview, defaults replies carry no requested branch or revision; `handleCreateDefaults()` applies every reply to the open form. The submit button is not disabled while a new branch's answer is pending, so the user can submit the previous branch's path, and out-of-order replies can overwrite a newer destination.
- impact: A create can be shown with a path that immediately fails validation, or branch B can be created at branch A's displayed path. The host-authoritative destination requirement is not yet reliable under normal asynchronous messaging.
- suggestedFix: Supply a real filesystem existence probe in production. Correlate defaults requests/replies with the branch or a monotonically increasing request id, ignore stale replies, and disable submission until the current branch has an authoritative path.
- status: persists from round 3
- triage: Downgraded from BLOCK because configured-root precedence and branch-derived host resolution are now present, and final create validation prevents unsafe overwrite. The remaining reach is stale/wrong destination and safe refusal.

### W3

- ID: W3
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/docs/design/worktree-rpc.md:1
- title: Project-design protocol synchronization remains pending
- evidence: The implementation and change-local specs now carry the new request/result shapes, but the project blueprint still documents the old RPC/outcome vocabulary and workflow.md still has Blueprint sync incomplete.
- impact: Later work can implement against stale project-level contracts.
- suggestedFix: Complete the existing Blueprint sync gate before archive.
- status: persists from round 1
- triage: Unchanged accepted archive obligation; not risk-accepted by the user.

### W6

- ID: W6
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-frontend
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:507
- title: Orphan result reconciliation remains append-only after the first re-scope
- evidence: `reconcile()` removes `worktreeId` and stores `orphanedLabel`. Every later tree response then takes the `worktreeId === undefined` branch and retains that result forever while the repo remains. It no longer reattaches to a recreated row, but repeated removals accumulate one undismissed repo-level notice per historical worktree.
- impact: Long-lived surfaces still grow action state by removed-worktree history rather than current state.
- suggestedFix: Bound orphan notices per repo/action, replace or age them, or retain only a small dismissible queue. Add repeated-removal reconciliation coverage.
- status: persists from round 3
- triage: The stale reattachment half is fixed; the historical-growth half remains.

### W7

- ID: W7
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/worktreeMutationService.ts:491
- title: The follow-up error still replaces the successful create in the panel
- evidence: The service posts `ok` and then an `error` for the same create/repo scope. `WorktreeController.handleMutationResult()` deduplicates by action, worktreeId, and repoId, so the second message removes the first. The resulting notice title is still “Couldn't create this worktree,” despite the message body admitting it was created.
- impact: The surface ends in the same false top-level state W7 described: users see failure rather than a successful create with a follow-up problem.
- suggestedFix: Add a distinct partial-success/follow-up result shape, or a separate dedupe identity that lets the successful mutation and failed open-after step coexist without contradictory copy.
- status: persists from round 3
- triage: Posting two messages fixed only the service-local sequence; the behavioral consumer still collapses them.

### W9

- ID: W9
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:222
- title: Invalid non-empty branch names still reach git
- evidence: Blank branch/base-ref translation is fixed, but the controller still supplies no `validateBranch` dependency and the host performs no `git check-ref-format --branch`. Non-empty invalid names reach a mutation attempt and are rejected only by git.
- impact: Users learn late through a generic mutation failure rather than field-level validation; an avoidable attempt and rebuild occur.
- suggestedFix: Complete the accepted warning with host-authoritative branch validation, optionally mirrored in the dialog.
- status: persists from round 3
- triage: The author's partial remedy reduces reach but does not close the accepted finding. This is not a user-granted risk acceptance.

### W10

- ID: W10
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-logic, chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/mutationCoordinator.ts:65
- title: A rejected body-requested settle suppresses the coordinator's fallback rebuild
- evidence: `settle()` sets `settled = true` before awaiting `gate.request()`. If that request rejects, the `finally` call sees `settled` and returns without retrying. The earlier coordinator always attempted its final rebuild independently.
- impact: A removal whose classification rebuild rejects can exit without the coordinator making its promised post-attempt recovery attempt, leaving the tree/result without authoritative aftermath.
- suggestedFix: Memoize the in-flight settle promise, but mark completion only after success; allow `finally` to retry a rejected request or deliberately propagate a typed rebuild-unavailable result after a second attempt.
- status: new
- triage: Inside W5's coordinator impact cone. Production rebuilds normally confine discovery/projection failures, so retained at WARN rather than BLOCK.

### W11

- ID: W11
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-frontend
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/extension.worktreeAssembly.test.ts:208
- title: The new assembly test does not satisfy its claim that every mutating verb reaches git
- evidence: The suite drives remove to git and locks once. It never clicks Unlock, never submits Create, and tests only that Prune is absent when the count is zero. Its header and task 8_9 acceptance claim all five verbs reach git argv, but three positive flows are absent.
- impact: Production composition regressions in create submission, unlock, and confirmed prune can still pass the test intended to close round 3's central coverage gap.
- suggestedFix: Add positive menu/dialog-to-git walks for create and prune, and click the post-lock Unlock item with its argv assertion. Keep the current negative prune case as a separate test.
- status: new
- triage: Test/support finding within the explicit 8_9 verification cone; WARN maximum applies.

### S1

- ID: S1
- severity: SUGGEST
- confidence: MEDIUM
- priority: P3
- agent: asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/worktreeMutationService.ts:258
- title: An unexpected assessment rejection can still leave a forced token live
- evidence: Token spending is branch-local after `await deps.assessRemoval(target)`. A rejection skips those branches, while the coordinator finally rebuilds and reports the error. Production sources are mostly outcome-typed, so reachability is narrow, but the structure does not enforce D15's “every forced exit” invariant.
- impact: A future throwing producer could make an error exit a free retry.
- suggestedFix: Put forced-token spending in a one-shot finally/guard around assessment and redemption, while preserving redeem's normal consume semantics.
- status: new
- triage: Non-gating structural hardening; no demonstrated current production throw path.

## Audit backlog

### A1

- ID: A1
- severity: WARN
- confidence: MEDIUM
- priority: P3
- agent: asm-review-data-security
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/createPath.ts:241
- title: Windows create-root detection does not normalize parent-path case before counting
- evidence: Parent strings are counted case-sensitively even though Windows path identity is case-insensitive.
- impact: Mixed-case listings can choose the wrong layout root.
- suggestedFix: Normalize/case-fold Windows parent keys while preserving one display spelling.
- status: audit-backlog
- triage: Existing helper behavior outside the round-4 remediation cone; non-gating unless a later change touches root-mode normalization.

### A2

- ID: A2
- severity: SUGGEST
- confidence: MEDIUM
- priority: P4
- agent: asm-review-data-security
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/worktreeBlockers.ts:89
- title: SourceRead duplicates an existing outcome shape
- evidence: The repository already has analogous read-outcome unions, while this change introduces another local variant with `notApplicable`.
- impact: Future producers can drift in naming and handling.
- suggestedFix: Consider consolidating read outcomes when that shared contract is next changed.
- status: audit-backlog
- triage: Reuse concern outside this verification cone; no current behavioral defect.

## Fixed prior findings

- B5: fixed — missing-route `forget`, idempotent settle, and every authoritative rebuild reconcile fingerprints.
- B8: fixed — missing status is `notApplicable`; remaining blockers still evaluate.
- B9: fixed — both prune entries use the confirmation dialog; only its confirm posts.
- B11: fixed — blank optional base ref is omitted and blank branch does not post.
- B13: fixed — only ENOENT/ENOTDIR mean absence; other stat failures are indeterminate.
- W4: fixed — prune count failures are typed unavailable and run no prune; malformed counts are rejected.
- W5: fixed for ordinary successful settle — removal no longer performs a third rebuild; W10 records the rejected-settle edge.
- W8: fixed — blocked results retain repoId and replace same-scope notices.

## Author triage — round 4 (cycle 2, verification round 2)

Every finding verified against the code before triage. None rebutted.

| ID | Sev | Status | Triage |
|---|---|---|---|
| B1 | BLOCK | accepted | Confirmed. `mutationCoordinator.ts:75` awaits `settle()` in `finally`, so the rebuilt tree reaches the surface BEFORE the promise resolves and `report()` runs. `reconcile()` therefore sees no result to re-scope, and `handleMutationResult` then appends a worktree-scoped result whose row is already gone. My 8_7 tests drove result-then-tree, the reverse of production — a hollow test of exactly the kind round 3 was about. Fix: re-scope on arrival, and assert the production order. |
| B10→W | WARN | accepted | Confirmed. One leaf pattern per worktree where one create-root pattern is the actual intent of D8, and `excludePatternFor` escapes a Windows backslash instead of converting it to git's `/`. The newline-injection half stays fixed. |
| B12→W | WARN | accepted | Confirmed and the more serious of the two: `options.exists` is supplied by my test harness and by nothing in `extension.ts`, so in production an unregistered occupied directory still reads as free. Same composition class as round 3. Reply correlation and submit-while-pending accepted with it. |
| W3 | WARN | accepted | Already the open `Blueprint sync complete` gate; no new work, it must simply be done before archive. |
| W6 | WARN | accepted | Confirmed. Re-scoped notices are bounded by nothing but repository lifetime. |
| W7 | WARN | accepted | Confirmed. `handleMutationResult` dedupes on `(action, worktreeId, repoId)`, which the create's ok and its open-after error share, so the error replaces the success. The message text is truthful but the outcome the user sees is still `error`. |
| W9 | WARN | accepted | Confirmed still open. My round-3 reasoning was that reimplementing `check-ref-format` client-side is easy to get subtly wrong — that objection does not apply to ASKING git, which is the fix now taken. |
| W10 | WARN | accepted | Confirmed. `settled = true` is set before the awaited rebuild, so a rejected rebuild leaves `finally` unable to retry. |
| W11 | WARN | accepted | Confirmed, and it is my own overstatement: task 8_9's Acceptance says every mutating verb reaches git argv, and the test reaches git for remove and lock only. |
| S1 | SUGGEST | accepted | Cheap to close alongside W10 in the same file. |
| Audit: `createPath.ts:241` | — | audit-backlog | Windows-only case sensitivity; no reachable defect on the supported paths this change touches. |
| Audit: `worktreeBlockers.ts:89` | — | audit-backlog | `SourceRead` overlaps an existing outcome shape; a consolidation, not a defect. |

### Thrash-stop declaration

Condition 2 of the thrash-stop rule holds and I am recording it rather than proceeding silently: the invariant *"every mutation this surface started states its outcome"* has now survived four fix attempts across both cycles — round 1 (capabilities inert), round 2 (results posted past the attached surfaces), round 3 (notice hung on a row the removal deleted), round 4 (reconciliation ordered before the result exists). Four distinct mechanisms, one user-visible invariant.

The other three conditions do NOT hold: this is round 2 of cycle 2, blockers fell 8 → 1, and no previously closed finding was reintroduced — all eight round-3 fixes were confirmed fixed.

Option taken under fastlane: **option 3, one bounded extension round**, with a stated hypothesis and no scope growth.

**Hypothesis.** Every previous attempt fixed a *component* of the outcome path and verified it with a test that constructed its own ordering. The defect that survived each time lived in the ORDER the real assembly produces, which no such test could see. So this round fixes the ordering at the point of arrival — a result is re-scoped when it arrives, not only when a tree arrives — and the acceptance is a test driven in production order through the real assembly, not a controller called directly.
