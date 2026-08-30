# Review Round 5

- Date: 2026-08-31
- Cycle: 2
- Mode: verification
- Review lane: fastlane
- Escalation flags: security-privacy, re-review
- Scope: range `cd2b088c60065589b7d4539db291568b2fd7652e..49e81febe4c218de87dd77ec18d4b8a51a34c4e7`
- Head: `49e81febe4c218de87dd77ec18d4b8a51a34c4e7` (tree dirty after the reviewed range: `asimov/changes/assess-a-removal-before-offering-it/analytics.json`)
- Reviewable lines: 261
- Large change: no
- Scope lock: passed — tightening D6 from `not exited` to `idle` corrects a clause that contradicted D6's already-approved fail-closed decision and project invariant I14; it adds no source, capability, or invariant owner. The shared deadline extraction centralizes an existing primitive. W3's new invariant owner is explicitly absent from the range.
- Recorded Verify Gate: `bun run asm change verify-status assess-a-removal-before-offering-it` reports every task step exit 0. Workflow notes record check-types clean, 5,720 unit tests passing across 259 files, `gate:fs-deletion` passing, and only the reproduced untouched-file Biome baseline. The chair ran no project verify command.
- Agents spawned:
  - `asm-review-data-security` — idle-only session suppression — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — deadline edges and async classification — `gpt-5.6-terra[1M]`
  - `asm-review-performance` — abandoned-stat accumulation — `sonnet[1M]`
  - `asm-review-reuse` — shared deadline extraction — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-contracts` — no route/schema/external contract change; the internal deadline contract was covered by logic and reuse
  - `asm-review-frontend` — no UI files changed
- Verdict: WARN
- Counts: 0 BLOCK, 1 WARN, 0 SUGGEST
- Round cap: cycle 2 has reached its third and final round; no round 6 may be opened in this cycle

## Cross-round disposition

### B4
- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-performance`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/ignoredMaterial.ts:136`
- Title: The production ignored walk is still outside its approved entry and time budgets
- Evidence: No regression in the already-fixed process timeout, output ceiling, zero-budget guard, entry admission, or per-stat race. The round-5 deadline extraction preserves those mechanisms.
- Impact: None remaining from B4's original mechanism.
- SuggestedFix: None.
- Status: fixed
- Triage: remains fixed from round 4.

### B5
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/worktreeBlockers.ts:266`
- Title: A stale idle row can still suppress a pane that is currently running
- Evidence: Suppression now uses `idlePanesHere`, which requires the current pane snapshot to report `activity === "idle"`. Running, waiting, unknown, exited, absent, missing-cwd, and outside-target panes all leave the registry record standing, so its undefined production activity refuses. The independent `paneIds` filter remains the pre-fix report filter — in-target and not exited — preserving confirmable evidence. Forced re-evaluation receives the same corrected assessment before fingerprint redemption. Boundary inventory verified: claim publication/cache, current pane/activity snapshot, cached rows, registry suppression, refusal, confirmable pane evidence, fingerprint re-evaluation, final git side effect.
- Impact: The stale-row path no longer permits removal while the current pane is running, waiting, or unclassified.
- SuggestedFix: None.
- Status: fixed
- Triage: fixed in task 6_1. The D6 wording correction is remediation, not a changed decision: its approved principle already required uncorroborated claims and undetermined activity to refuse, and project invariant I14 already forbids force-removing a working agent.

### W2
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-logic`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/ignoredMaterial.ts:122`
- Title: Deadline equality and a late empty listing can still be reported as measured
- Evidence: All in-walk comparisons now use `>=`, and a final elapsed check runs after enumeration even when it yielded no entries. The check remains inside the enumeration/sizing try, so enumeration errors still map to `unreadable`. Zero-byte sizes are boxed as `{ bytes: 0 }` and cannot collide with deadline expiry. A specialist candidate to check again after `readManifest()` was rejected: D3 bounds the count/size walk, and the code explicitly performs the optional provenance read after that walk; a slow provenance read does not turn an already-completed count/size into a partial measurement.
- Impact: The exact-cap and late-empty paths no longer return a measured total.
- SuggestedFix: None.
- Status: fixed
- Triage: fixed in task 6_1.

### W4
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-reuse`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/deadline.ts:23`
- Title: `expiresIn` duplicates the repository's existing unref'd deadline helper
- Evidence: `afterDelay` is now the single timer/cancellation primitive used by both ignored-material sizing and session previews. `sessionPreviewService` preserves its `wait` injection seam and re-exports the same `Deadline` type for existing importers. No duplicate deadline implementation remains in the immediate subsystem.
- Impact: Deadline timer semantics now have one owner.
- SuggestedFix: None.
- Status: fixed
- Triage: fixed in task 6_1.

## Findings

### W3
- Severity: WARN
- Confidence: MEDIUM
- Priority: P2
- Agent: `asm-review-performance`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/ignoredMaterial.ts:136`
- Title: Repeated timed-out stats can accumulate outside the per-assessment cap
- Evidence: The extracted `afterDelay` preserves the prior race: it stops waiting and cancels only its timer, not the underlying `fs.promises.lstat`. Neither `WorktreeHost.assessRemoval` nor `worktreeMutationService.removeWorktree` adds cross-assessment in-flight deduplication, a semaphore, or enforced serialization across targets/retries. One timed-out assessment can therefore abandon one filesystem request, and each concurrent or repeated assessment can add another. Growth axis: unresolved `lstat` operations per assessment retry/concurrent target; structural cross-assessment bound: none. The author's stalled-mount plus repeated-action qualification affects likelihood, not the cost shape, and was already reflected in MEDIUM confidence.
- Impact: On a stale/FUSE/network filesystem, repeated or concurrent removal assessments can consume the process-wide libuv filesystem worker pool and stall unrelated filesystem-backed extension work.
- SuggestedFix: Put the read behind a bounded shared in-flight registry or semaphore, ideally one outstanding stat per path/worktree with a global cap, and return `unproven` without issuing duplicates while one remains unsettled. This is correctly identified as a new invariant owner and should be planned rather than patched into this cycle.
- Status: accepted, open
- Triage: persists from round 4. Author acceptance and deferral do not make a finding non-gating and are not user-granted risk acceptance. No evidence delta supports rejection or downgrade.
- Author status: accepted, open — NOT risk-accepted, and not claimed as fixed
- Triage: I am not recording a risk acceptance, because I have not been granted one; the user has been asleep for this entire cycle and a waiver is theirs alone to give. Carried forward as an open, non-gating warning instead, named in the Build Complete summary and in workflow.md Notes so it survives the archive with an owner. Two things bound it, offered as scope and not as rebuttal: the walk awaits its stats serially, so ONE assessment can abandon at most one read, and an assessment runs on a user action rather than on a timer — so reaching the libuv pool needs a stalled mount plus repeated removal dialogs. The fix the chair describes is a bounded shared read owner, which is a new invariant owner and belongs to planning, not to a fix loop. Noting the disagreement plainly rather than resolving it in my own favour: this round's own verdict line counts 0 blocking findings and `asimov-build` defines WARN as non-blocking unless explicitly accepted as must-fix, so by the skill's severity semantics the fix loop has exited; the chair reads the same finding as gating until the user speaks. The user decides which reading governs, and that decision is the first item in the approval summary.

## Accepted risk

None. W3 has not been accepted by the user with an owner, expiry, and reactivation trigger.

## Audit backlog

None.

## Round-cap route

Cycle 2 is closed at its three-round cap. Do not open a fourth verification round. W3 now requires one of the user-controlled routes: explicit risk acceptance through build triage, or planning/extraction of the bounded shared-read owner followed by a new review cycle for its integration.
