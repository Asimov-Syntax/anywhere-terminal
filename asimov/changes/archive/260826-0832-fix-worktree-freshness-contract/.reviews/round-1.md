# Review Round 1: fix-worktree-freshness-contract

- resume: ad109a7601bd1ac41 — round-1 chair; re-review resumes this id so round-1 context stays intact

- Date: 2026-08-26
- Scope: working tree (`git diff HEAD`)
- Reviewable lines: 1679
- Large change: yes — accuracy may decrease above 800 reviewable lines
- Intent obligations: `workflow.md` Gate 2 is unchecked, so proposal/design/tasks were treated as intent context rather than approved obligations
- Agents spawned: 6
  - asm-review-logic — rebuild scheduling — gpt-5.6-sol[1M]
  - asm-review-logic — cache/root retention — gpt-5.6-terra[1M]
  - asm-review-contracts — freshness contracts — sonnet[1M]
  - asm-review-performance — watcher/cache scale — gpt-5.6-luna[1M]
  - asm-review-frontend — retained-tree rendering — gpt-5.6-luna[1M]
  - asm-review-reuse — helper/type reuse — gpt-5.6-luna[1M]
- Agents skipped: asm-review-data-security — no persistence, auth, secret, input-validation, or third-party API surface changed
- Verdict: BLOCK
- Counts: BLOCK 1, WARN 2, SUGGEST 2
- Verification: `pnpm run check-types` passed; `pnpm run test:unit` passed (181 files, 3327 tests); targeted scratch regressions reproduced B1 and W2 and were removed in the same command

## B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-contracts
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/WorktreeCache.ts:85
- title: Failed alias folder loses its remembered shared repository
- evidence: `applyBuild` assigns `resolved = remembered` only inside `!next.has(remembered.repoId)`. When two workspace folders share one `repoId`, a resolving or earlier-failed sibling puts that repo in `next`; the other failed folder is then omitted from `nextRepoByFolder`. If the sibling is later removed or also fails, the still-open folder has no memory and the repository is dropped. A scratch regression with `/repo` and `/repo/sub` reproduced the final empty repo list.
- impact: A transient resolution failure can still remove retained worktrees while a workspace folder for that repository remains open, violating the change's primary freshness behavior and altering the reported worktree count.
- suggestedFix: Preserve every failed folder's remembered mapping regardless of whether the repo is already in `next`; dedupe only repository insertion/order. Add a regression covering two folders sharing one repo, one failing, then the resolving sibling disappearing while the failure persists.
- status: fixed (task 6_1)
- triage: Confirmed by reading applyBuild: `resolved = remembered` sits inside the `!next.has(remembered.repoId)` guard, so a failed folder whose repoId a sibling already contributed never reaches `nextRepoByFolder.set` and loses its memory while still open. This defeats design.md D2, whose whole premise is that the folder path is the only stable key a failed resolution has. Fixing: hoist the mapping out of the insertion guard so every failed folder with a remembered repo keeps it; only the `next.set` stays guarded so a sibling's fresh listing is never overwritten by a degraded one.

## W1

- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/repoRoots.ts:101
- title: Non-timeout rev-parse failures are classified as repository absence
- evidence: `resolveToplevel` maps every nonzero result other than `timedOut` or `failedToSpawn` to `{ kind: "absent" }`. Git can exit nonzero because it could not answer for permission, I/O, ownership-safety, or repository/configuration failures; those are not proof that the folder is not a repository.
- impact: The cache takes the deletion path and drops last-good worktrees instead of retaining them degraded for these failures, leaving part of the new absence-versus-failure contract unimplemented.
- suggestedFix: Positively identify the non-repository outcome and classify other nonzero results as `failed` with `describeGitFailure`; add a regression for a nonzero operational/configuration failure distinct from a genuine non-repository folder.
- status: fixed (task 6_1)
- triage: Correct and within design.md D1 as written — a dubious-ownership or EACCES exit is `git could not answer`, which D1 requires be told apart from `this folder is not a repository`, and the current code reports it as absence. Accepting as should-fix rather than deferring: absence is the deletion path, so this is the same data-loss class as A1. Note the fix needs `LC_ALL=C`/`LANG=C` pinned on the runner's env, because positively identifying the non-repository message means matching git's stderr text, and repoRoots.ts already warns in-file that unpinned stderr is locale-bound. Side effect accepted: degraded copy surfaced from stderr becomes English regardless of the user's locale.

## W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P1
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/WorktreeCache.ts:123
- title: Repo-local reconciliation can erase the active degradation cause
- evidence: An unavailable-git build stores retained repos as degraded, but a later successful `applyRepo` replaces the cached repo without degradation while `gitAvailable` remains false; `read()` emits that repo unchanged. A targeted scratch regression observed `degraded === undefined`. Likewise, `reconcileWatches` can replace a root-resolution cause with the watcher-failure string because degradation is a single overwriteable field.
- impact: Retained groups can lose or misstate why they are stale. The tree-level git notice partly compensates for unavailable git, but a root-resolution cause can disappear entirely, and the per-repo contract no longer consistently marks each retained repository degraded.
- suggestedFix: Track/merge degradation sources independently, or overlay the active whole-tree git-unavailable reason in `read()` and preserve root-resolution degradation through watch reconciliation. Test a repo-local update after an unavailable-git build and combined resolution/watch failures.
- status: fixed-in-part (second half rejected) (task 6_1)
- triage: First half accepted: a successful `applyRepo` clears `degraded` while `gitAvailable` stays false, and it is reachable now precisely because retention keeps `order` non-empty so the watches survive. It is also a literal miss against design.md D3, which says `read()` SHALL return the retained repositories each marked degraded — the change instead marks them in `applyBuild`. Fixing by overlaying the git-unavailable reason in `read()`, which satisfies D3's wording and closes the hole in one place. Second half rejected: merging every degradation source so a root-resolution cause survives watch reconciliation buys a second true-but-older cause at the price of either unbounded reason accumulation or a source-tracking structure this change has no requirement for. The watcher-failure reason that replaces it is itself accurate and current — the user is not misinformed about staleness, only about which of two causes is named.

## S1

- ID: S1
- severity: SUGGEST
- confidence: HIGH
- priority: P3
- agent: asm-review-logic, asm-review-performance, chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/WorktreeCache.ts:98
- title: Whole-tree reconciliation repeats quadratic membership scans
- evidence: Each folder outcome scans `nextOrder` with `.some`, then each repo in `next` scans it again. Whole-tree reconciliation therefore performs up to O(F×R + R²) repo-id comparisons.
- impact: This is not on repo-local watcher rebuilds, so it is not blocking, but large multi-root workspaces pay avoidable quadratic work on full refreshes and workspace changes.
- suggestedFix: Maintain a `Set<string>` of ordered repo IDs and use `has` for dedupe and final membership filtering.
- status: fixed (task 6_1)
- triage: Trivial and low-risk. Growth axis is workspace folders x repositories, which is single-digit in practice, so this is hygiene rather than a live cost — taking it because the fix is a Set and lands in the function B1 already reopens.

## S2

- ID: S2
- severity: SUGGEST
- confidence: MEDIUM
- priority: P4
- agent: asm-review-contracts, asm-review-reuse
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/WorktreeDiscovery.ts:268
- title: Production and compatibility paths duplicate repository deduplication
- evidence: `buildWorktreeTreeDetailed` performs first-seen `repoId` deduplication with `seenRepoIds`, while the preserved `resolveRepoRoots` wrapper independently implements the same ordering rule with a `Map`. The wrapper currently has no production caller, so its tests can pass while production dedup behavior changes separately.
- impact: Future ordering or tie-break changes can drift between the compatibility API and the production tree builder.
- suggestedFix: Keep the required `resolveRepoRoots` wrapper, but extract one pure `dedupeResolvedOutcomes` helper used by both paths.
- status: fixed (task 6_1)
- triage: Real duplication introduced by this change: buildWorktreeTreeDetailed and the resolveRepoRoots compatibility wrapper each implement first-seen repoId dedup. Extracting one helper in repoRoots.ts keeps the wrapper's compatibility purpose intact.
