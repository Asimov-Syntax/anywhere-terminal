# Review Round 2: carry-a-contest-membership-once

- Date: 2026-09-02
- Cycle: 1
- Mode: verification
- Review scope: range `abaf98e0~1..HEAD`; verification delta `a15a51caca3f05ff95a9c44ee5b82cd0fe5d80d7..HEAD`
- Head: `4320ff307ce80a1c1a2787f5fa03ce88c8288f67`
- Tree: dirty — `asimov/changes/carry-a-contest-membership-once/analytics.json` was updated by review accounting and is outside the explicit committed range
- Reviewable lines: 77 production lines in the remediation delta; changed tests reviewed inline; generated change analytics excluded
- Scope lock: passed — tasks 2_1 through 2_4 remediate accepted round-1 findings and the recovered render-guard issue; no new capability, task contract, design obligation, or invariant owner was introduced
- Agents spawned:
  - `asm-review-frontend` — renderer, per-row association, unresolved indexes, and render guard — `gpt-5.6-sol[1M]`
  - `asm-review-performance` — final notice/DOM growth and one-copy witnesses — `gpt-5.6-terra[1M]`
  - `asm-review-logic` — contest-index production and render-key false negatives — `sonnet[1M]`
- Agents skipped:
  - `asm-review-data-security` — no auth, persistence, datastore, secret, or external API boundary is in the remediation cone
  - `asm-review-contracts` — no schema or public API shape changed; the accepted contest-index contract was directly verified in producer and tests by logic/chair
  - `asm-review-reuse` — no helper extraction, mirrored implementation, or split introduced a reuse candidate
- Verdict: WARN
- Counts: 0 BLOCK, 1 WARN, 0 SUGGEST
- Verify Gate: recorded green. `bun run asm change verify-status carry-a-contest-membership-once` reports tasks 1_1 through 2_4 at exit 0, and `workflow.md` records the full gate complete. The review did not rerun project gates. Caller-recorded detail: check-types clean, 6692 unit tests pass, Biome at the 3 errors / 14 warnings / 1 info baseline, fs-deletion gate ok. The one observed `src/extension.worktreeAssembly.test.ts` `[3_4] removes the replacement the barrier resolved` failure passed alone and on the next full run and belongs to a peer change, so it is not attributed here.

## Findings

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-performance
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeView.ts:1846`
- title: The webview expands the shared membership back into quadratic result text
- evidence: `withContest()` now adds only a constant-size marker and records the cited index. `contestLines()` emits each cited contest's member list once after the rows. Final notice text is linear in row text plus aggregate cited membership text; no row rebuilds a contest membership.
- impact: The former `O(N*T)` notice/DOM expansion is removed; valid maximum-size provisioning reports no longer multiply every declaration by every affected row.
- suggestedFix: None; the accepted invariant is closed.
- status: fixed
- triage: Accepted in round 1; verified fixed at notice construction, joined reason text, and final DOM text. A contest absent from `cited` emits no membership line. Wire storage, host handoff, structured clone, controller state, and producer order remain unchanged and safe.
- invariant: Repository-controlled provisioning metadata remains linearly bounded after every derived representation, including the user-visible notice.
- boundary inventory:
  - verified safe: apply-result storage, temporary host handoff, postMessage structured clone, controller state, notice assembly, joined reason string, DOM text, repeated render computation
  - affected: none open

### F002

- ID: F002
- severity: WARN
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeView.ts:1851`
- title: Dangling contest indexes silently become plausible incomplete refusals
- evidence: A defined index whose contest is absent, out of range, or empty now renders the row's reason followed by `[contest N, which was not reported]`. The new test injects an unresolved index and asserts the explicit degradation.
- impact: A producer or handoff regression can no longer silently erase the contest association and leave a plausible bare refusal.
- suggestedFix: None; the accepted behavior is present.
- status: fixed
- triage: Accepted in round 1; verified fixed at the renderer fallback boundary and witnessed directly.

### F003

- ID: F003
- severity: WARN
- confidence: HIGH
- priority: P1
- agent: asm-review-contracts, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:222`
- title: Successful contested steps lose the contest association promised by the contract
- evidence: The producer now attaches `indexOf.get(contest)` whenever `contest !== undefined`, independent of outcome kind. The witness asserts both the favoured successful step and held refused step carry index `0`.
- impact: Consumers can rely on the contract for every contested outcome instead of reverse-scanning membership by id.
- suggestedFix: None; the accepted contract is restored.
- status: fixed
- triage: Accepted in round 1; verified fixed across the shared favoured-result path and the existing contest refusal helper/held-member path.

### F004

- ID: F004
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.test.ts:370`
- title: The 6x linearity threshold is calibrated to one serialization fixture, not the invariant
- evidence: The ratio test is gone. The replacement counts each member path exactly once in serialized contests and exactly once in serialized steps as that step's own path, asserts declaring-file tokens are absent from steps, and asserts no step reason contains `declared in`. The restored quadratic representation would put those declaring tokens into step reasons and fail.
- impact: Unrelated fixed-size report growth can no longer make the known quadratic representation pass through a calibrated threshold.
- suggestedFix: None; the structural witness closes the accepted gap.
- status: fixed
- triage: Accepted in round 1; verified fixed with a representation-shape assertion rather than a measured ratio.

### F005

- ID: F005
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeView.test.ts:2518`
- title: The refusal witness checks the whole notice, not every refused row
- evidence: The test now splits the reason text into lines, locates each refused path's own line, and requires that line to contain both its own refusal reason and `[contest 1]`. Membership declarations are separately asserted exactly once in the complete notice.
- impact: One refused row can no longer borrow the other row's association and leave the per-row contract unwitnessed.
- suggestedFix: None; the per-row witness is present.
- status: fixed
- triage: Accepted in round 1; verified fixed for both refused rows while preserving one shared membership block.

### F006

- ID: F006
- severity: WARN
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-frontend, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeView.ts:1811`
- title: The widened render signature still omits provisioning text the notice renders
- evidence: `provisionKey()` projects only step id, outcome kind, contest index, and top-level reason. `provisionSummary()` also renders `step.path` for refused/failed/degraded/skipped rows and flattens `step.details` into the descendant count plus every detail path and reason. Two successive results can therefore have identical `provisionKey` and `contestKey` values while requiring different notice text; `applyAt()` then keeps the old signature and skips the render. The hand-built comma/plus/at-sign encoding is also not structurally injective when free-text fields contain delimiters. The new test changes only one contest source, so it does not witness path-only or details-only corrections.
- impact: A corrected provisioning result can leave a stale row path, descendant count, descendant path, or descendant refusal reason on screen even though task 2_4 exists to make corrected result content redraw.
- suggestedFix: Build a collision-safe structured signature over every field consumed by `provisionSummary`, for example `JSON.stringify` of normalized step tuples including path, outcome, contest, and all details plus normalized contest member tuples. Add second-`setData` witnesses for a path-only change and a details-only change.
- status: open
- triage: pending. The logic specialist proposed BLOCK; the chair keeps WARN because production currently emits one provisioning result per create and no ordinary path/details correction channel was established. The defect is nevertheless inside task 2_4's render-guard impact cone and repeats the same false-negative mechanism the task fixes.
- invariant: The data signature guarding a render must distinguish every change to data that the guarded render consumes.
- boundary inventory:
  - affected: top-level step path, descendant detail count/path/reason, delimiter-based structural encoding
  - verified safe: outcome kind, top-level reason, contest index, contest member source/path for the tested ordinary shape

## Verification notes

- F001: membership is emitted once per cited contest; uncited contests and unresolved indexes do not emit membership blocks. The cited-index sort is over a structurally capped set (`MAX_MODEL_ROWS = 200`) and does not duplicate output text.
- F002: the missing-contest branch stays explicit without manufacturing a membership line.
- F003: all producer paths that construct contested results share either the contest-aware refusal helper or the unconditional post-apply attachment.
- F004/F005: changed tests contain no `.only` or `.skip`; async apply tests remain awaited.
- Task 2_4: contest/reason/source changes are covered, but F006 is a remaining false-negative in the same guard.

## Adjudication notes

- The frontend specialist and chair independently found F006. The logic specialist found the same omission and additionally demonstrated the delimiter-collision class; these are merged under the one render-signature invariant.
- The logic specialist's BLOCK severity is downgraded to WARN with specific reachability evidence: `extension.ts` reports provisioning once from the create apply and `WorktreeController.handleProvisionResult()` has no normal correction protocol. This matches the recovered issue's prior WARN classification while retaining the concrete defect in the changed guard.
- The performance specialist found no remaining data-scale defect. The final output representation is one-copy and bounded; the test no longer depends on a size ratio.

## Audit backlog

None.

## Author triage

F006 accepted and fixed rather than carried: the hand-rolled key was still an enumeration of the
fields I happened to think of, and `path` plus the `details` the notice also renders were not among
them. Replaced with a structured signature over exactly what `provisionSummary` consumes, which
removes the whole class rather than the two instances named.
