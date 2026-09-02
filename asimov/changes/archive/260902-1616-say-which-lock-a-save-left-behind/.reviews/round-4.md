# Review Round 4

- Date: 2026-09-02
- Cycle: 3
- Round: 4
- Mode: discovery
- Review profile: fastlane
- Scope: commit `4f94e3f2572d0876323034980e849ea0ba2e88b5` (`7a473f9e..HEAD`)
- Previous Head: `7a473f9e8d6322ee5adcda61fe6b0ad4cc4e632e`
- Head: `4f94e3f2572d0876323034980e849ea0ba2e88b5` (the committed designed remediation was reviewed; review accounting left the change's analytics dirty)
- Reviewable lines: 123 (45 production-code churn plus 78 lines of tracked analytics; tests and Markdown change/review artifacts classified separately)
- Framing: the caller described this as verification, but round 3 explicitly handed the change back for a new design and D7/task 4_1 were approved afterward. Under the master protocol a handback opens a new cycle, so this is cycle-3 discovery rather than cycle-2 verification.
- Extension authorization: `asm review round-start` accepted the already-recorded round-4 extension. The chair passed no `--extend` or `--user-approved` flag and did not rely on the coordinator message as consent.
- Scope lock: passed — D7 and task 4_1 are the approved post-handback design; the production diff implements only that decision and introduces no additional capability or invariant owner.
- Agents spawned:
  - `asm-review-logic` — D7's total state transformation and every publication path — `gpt-5.6-sol[1M]`
  - `asm-review-contracts` — D7 equation, identity ownership, and call-structure enforcement — `gpt-5.6-terra[1M]`
  - `asm-review-performance` — repeated failed-reread growth and identity preservation — `sonnet[1M]`
- Supporting trace: `asm-finder` — provisioning offer publication and model-clone inventory — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-data-security` — no pathname, lock ownership, warning, or external trust boundary changed
  - `asm-review-frontend` — no renderer code changed; F005 remains fixed and the model contract reaching it is unchanged
  - `asm-review-reuse` — the single local batching helper owns one cohesive transformation and duplicates no repository capability
- Recorded verification: `bun run asm change verify-status say-which-lock-a-save-left-behind` reports task 4_1 at exit 0 and the complete gate green. The chair ran no project verification command.
- Verdict: APPROVE
- Counts: BLOCK 0 | WARN 0 | SUGGEST 0
- Blocking split: 0 feature | 0 machinery

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
- triage: Unchanged from round 2; no lock pathname is returned through Claude or Cursor warning fields.

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
- triage: Required write outcomes and pre-count save summaries remain intact.

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
- triage: Shared identity predicate remains adopted.

### F005

- ID: F005
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: `asm-review-frontend`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:770`
- title: A lock summary masks a co-present provider read problem
- status: fixed
- triage: The restored all-lock guard remains unchanged and correctly preserves non-lock problem summaries.

### F004

- ID: F004
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, `asm-review-logic`, `asm-review-performance`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:182`
- title: Save-report replacement is coupled to appending and loses the latest attempt
- status: fixed
- author triage: accepted in rounds 2 and 3; redesigned as D7 after handback
- triage: D7 closes the invariant at its owner. `refusedSave` and `leftLocked` now construct problems only; the completed-write site constructs the current attempt's entire zero/one/two-element `posts` list and calls `withSaveReports(base, posts)` exactly once. That helper removes all prior marked objects unconditionally before marking/appending the complete current list. A clean save therefore clears prior diagnostics, while a refused-and-locked save retains both current diagnostics in order.
- invariant: A provisioning offer contains exactly the current attempt's complete post-save diagnostics — zero, one, or the refusal-plus-lock pair — and none from an earlier failed-refresh attempt.
- boundary inventory:
  - fixed: fresh base with `{}`, `{refusal}`, `{lock}`, `{refusal, lock}`; fallback base with the same four post shapes; repeated failed rereads; clean attempt after residue; refusal plus lock in one attempt; genuine read-problem preservation; object identity through offer remint; per-attempt problem-count bound
  - verified safe publication paths: initial opening read, provider switch, and unknown-offer correction publish fresh read models and complete no write; every completed write publishes only at `WorktreeHost.ts:2575` through `withSaveReports`; thrown writes publish nothing; disposed/superseded saves fail the guards before publication
  - verified identity paths: save-created problems are marked before `offerStore.issue`; `offerStore.remint` rebuilds selectable rows but preserves `model.problems` and each problem object; lookup returns that host-held model; successful rereads create new unmarked read problems

## Findings

None.

## Full-flow trace

- Initial opening publication: `readProvisioning(repo.mainPath)` returns a fresh model, `offers.issue()` remints selectable ids, and the host delivers it. No save completed and no marked problem can originate on this path.
- Provider-switch publication: the host reads the requested detected provider and issues that fresh model directly. It intentionally replaces any prior save-result offer; no write completed.
- Unknown/expired save-offer correction: the host performs no write, rereads a fresh model, and republishes it. It correctly bypasses D7 because there is no attempt result to report.
- Completed save publication: this is the sole write-result call to the local `publish` closure. The host derives `did`, builds `posts` as exactly one of the four D7 shapes, and unconditionally calls `withSaveReports(base, posts)`, where base is either the fresh reread or the preserved shown fallback.
- Thrown save, disposal, surface loss, opening retirement, or a newer switch publishes no stale attempt: each exits before the D7 publication site or is rejected by the local publish guard.
- No ninth state was found. The state space is the Cartesian product of the two base sources and four complete post lists, and the same expression handles all eight.

## Inline support review

- The two prior repeated-save witnesses remain and use the current offer id plus a higher monotonic switch.
- The new refused-and-locked witness asserts the complete ordered pair `unsaved`, `locked` from one attempt.
- The new clean-after-failed-refresh witness exercises empty `posts` and asserts neither stale `unsaved` nor stale `locked` survives.
- Existing single-attempt tests cover refusal-only and lock-only shapes. Together the suite exercises all four post shapes and both base sources without weakening prior assertions.
- Changed tests contain no `.only`/`.skip`, await the existing settlement boundary, and add no fixture secret or destructive behavior.

## Adjudication notes

- Logic, contracts, and performance specialists reported no findings. The performance specialist independently confirmed the 0-2 bound and that `offerStore.remint()` preserves problem identities.
- Object identity remains the correct key: a read-generated and save-generated `malformed` problem can share reason and filename, while only save-created objects enter `postedBySave`.
- The recorded extension was accepted by `round-start`; no agent message was treated as the grant itself.
