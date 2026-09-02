# Review Round 3

- Date: 2026-09-02
- Cycle: 2
- Round: 3
- Mode: verification
- Arbiter: yes
- Review profile: fastlane
- Scope: requested range `0c6c8050..HEAD`; production remediation is commit `7a473f9e`
- Previous Head: `d8c73c32934ed6694139b5bec75478bb3121022a`
- Head: `7a473f9e8d6322ee5adcda61fe6b0ad4cc4e632e` (the committed remediation was reviewed; review accounting left the change's analytics dirty)
- Reviewable lines: 170 (64 production-code churn plus 106 lines of tracked analytics; tests and Markdown change/review artifacts classified separately)
- Scope lock: passed — the production diff contains only accepted F004/F005 remediation; no new capability, contract, task semantics, or invariant owner
- Agents spawned:
  - `asm-review-logic` — F004 latest-attempt replacement, object identity, and save-message guards — `gpt-5.6-sol[1M]`
  - `asm-review-frontend` — F005 mixed-problem summary semantics — `gpt-5.6-terra[1M]`
  - `asm-review-performance` — F004 repeated-failure growth bound — `sonnet[1M]`
- Agents skipped:
  - `asm-review-data-security` — the cone does not touch the pathless warning/security boundary, already fixed in round 2
  - `asm-review-contracts` — no wire/schema change in this remediation; `ProvisionProblem` shape is unchanged
  - `asm-review-reuse` — no new helper duplication or split in the cone
- Recorded verification: `bun run asm change verify-status say-which-lock-a-save-left-behind` reports task 3_1 at exit 0 and the full gate green. The chair ran no project verification command.
- Verdict: BLOCK
- Status: blocked
- Counts: BLOCK 1 | WARN 0 | SUGGEST 0

## Prior finding dispositions

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, `asm-review-data-security`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/agentHooks/install/ClaudeHookInstaller.ts:105`
- title: Installer warnings still expose reboundable lock pathnames
- status: fixed
- triage: Round-2 disposition remains fixed; this remediation does not intersect the warning path.

### F002

- ID: F002
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, `asm-review-frontend`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:689`
- title: The new summary is hidden on real models and falsely calls no-op saves saved
- status: fixed
- triage: Required write outcomes still reach the renderer before the content-count return. F004 is a distinct latest-attempt ownership mechanism.

### F003

- ID: F003
- severity: SUGGEST
- confidence: HIGH
- priority: P3
- agent: `asm-review-reuse`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/agentHooks/install/ClaudeHookInstaller.ts:4`
- title: Reuse the shared identity predicate in the changed installer
- status: fixed
- triage: Round-2 disposition remains fixed; this remediation does not intersect identity capture/comparison.

### F005

- ID: F005
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: `asm-review-frontend`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:770`
- title: A lock summary masks a co-present provider read problem
- evidence: Round 2 changed the old all-locked condition into filtered existential checks, so `malformed + locked/written` incorrectly selected `Saved, may still be locked` instead of the prior read-failure answer.
- impact: A single-attempt summary could claim the save outcome over a model that also says a provider file could not be read.
- suggestedFix: Restore the all-locked guard while preserving refusal precedence.
- status: fixed
- author triage: accepted in round 2
- triage: The guard at lines 765-771 correctly restates the old `every(reason === "locked")` behavior. `unsaved` and `locked/refused` still return `Not saved`; every other non-lock reason falls through to content counts or `Could not be read`. The changed witness is producer-reachable and covers the missed `malformed + locked/written` state.

## Findings

### F004

- ID: F004
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, `asm-review-logic`; corroborated on the same-attempt boundary by `asm-review-performance`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:173`
- title: Save-report replacement is coupled to appending and still loses the latest attempt
- evidence: The new `post()` marks its incoming problem, filters every problem already in `postedBySave`, and appends that one problem. This closes repeated `written -> unchanged` and `refused -> written` cases only when the latest attempt appends a lock. It leaves two accepted F004 boundaries open. First, a refused save with `mayStillBeLocked` calls `refusedSave()` and then `leftLocked()` at lines 2555 and 2560. The first call marks/appends the current refusal; the second call immediately filters that same marked refusal and leaves only the lock problem, losing the current refusal cause/detail. Second, when an earlier failed-reread offer contains a marked save problem and the latest write succeeds without `mayStillBeLocked`, neither helper calls `post()`; line 2560 republishes `base` unchanged, so the previous lock/refusal remains the headline even though the latest save generated no problem. Both new accumulation witnesses force `mayStillBeLocked: true` on the second result and therefore miss the zero-current-problem boundary; neither asserts that a current refused+locked result retains both current diagnostics.
- impact: F004's invariant remains false. A current refusal can lose why it was refused, and a clean current save can continue displaying an earlier lock or refusal indefinitely after another failed reread. The growth axis is capped, but latest-attempt correctness is not.
- suggestedFix: Separate old-report removal from current-report construction. Scrub marked prior-attempt problems from the fallback exactly once for every completed write, including a write that emits zero new problems, then append the complete current attempt as one batch (refusal plus lock when both apply). Add failed-reread witnesses for `locked -> clean` and `unsaved -> clean`, plus a single refused+locked witness asserting both current problems and the refusal detail.
- status: accepted
- author triage: round-2 F004 accepted; round-3 remediation incomplete
- triage: Persists from round 2 under the same ID and invariant. The causal mechanism is still ownership/removal of prior post-save diagnostics; the fix couples removal to each append rather than owning the current attempt as a batch. The boundary inventory expanded from repeated non-empty reports to zero-current-report and two-current-report cases, so patch-level fixing has failed and handback is required.
- invariant: A provisioning offer contains exactly the current attempt's complete post-save diagnostics — zero, one, or the refusal-plus-lock pair — and none from an earlier failed-refresh attempt.
- growth axis: structurally capped by the WeakSet filter; no longer a blocker on size, but correctness remains gating
- boundary inventory:
  - fixed: previous `written/locked -> current unchanged/locked`; previous `refused/locked -> current written/locked`; object identity through `offerStore.remint`; preservation of read-generated problems; repeated-attempt cardinality
  - not safe: previous lock/refusal -> current clean save with no posted problem; current refused+locked attempt where the second `post()` removes the first current diagnostic
  - verified guards: the second test message uses a higher monotonic switch, the latest issued offer id, the live opening, and the still-present surface; if the second write were skipped, both tests' expected latest outcomes would fail

## Full-flow verification

- F004 witness reproduction: the failed-reread fallback still uses `shown`; `offerStore.remint()` preserves problem object identities, so WeakSet recognition itself works. The issue is when cleanup runs, not identity loss.
- The new tests genuinely reach two writes. They use the current offer id after the first settlement and raise `switch` from 1 to 2; opening, repository, surface, and disposal guards all remain satisfied. Their expected second outcomes would not be present if the second write returned at a guard.
- F005 verification: the restored non-lock guard correctly preserves the old all-locked condition. Read problems no longer yield to written/unchanged lock summaries, while refusal precedence remains unchanged.
- Support review: changed tests contain no `.only`/`.skip`, await both settlements, and add no fixture secret or destructive behavior. The missing F004 witnesses are semantic gaps, not async harness failures.

## Arbiter dispositions

- F004 — **accepted**. Deciding evidence: `post()` removes marked objects on each append, so it deletes the current refusal when the current lock is appended; when the current clean save appends nothing, it never removes the previous marked report. Both paths falsify task 3_1's latest-attempt Acceptance and round-2 F004's invariant. This is repo-fixable, load-bearing, and not eligible for audit backlog or external-blocker status.

## Handback

Round 3 sustains F004 as an accepted gating blocker. The change is parked. The next work must re-enter as cycle 3 with a handback/replan of post-save diagnostic ownership: remove prior-attempt state once, then publish the current attempt atomically as zero/one/two diagnostics. Another line-level fix inside the current cycle is not permitted.
