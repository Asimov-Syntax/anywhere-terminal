# Review Round 2

- Date: 2026-08-31
- Cycle: 2
- Mode: discovery
- Requested lane: fastlane
- Scope: range `a7003eb4..HEAD`
- Head: `3d8d22d111607f8d50a46ed6e8e3b1767a3b268e` (working tree dirty from untracked `asimov/changes/render-the-removal-assessment-as-a-report/analytics.json`, outside the reviewed range)
- Prior cycle: cycle 1 superseded by materially changed D2, changed spec delta, and tasks 1_4/1_5 added after round 1's Head
- Reviewable lines: 386
- Agents spawned:
  - `asm-review-logic` — removal control flow — `gpt-5.6-sol[1M]`
  - `asm-review-contracts` — refusal contract correction — `gpt-5.6-terra[1M]`
  - `asm-review-frontend` — refusal report UI — `sonnet[1M]`
- Agents skipped: `asm-review-data-security`, `asm-review-performance`, `asm-review-reuse` — no data/auth/storage, growth-axis, or reimplementation risk warranted a separate lens; `asm-finder` skipped because the relevant production flow and callers were already identified and verified directly
- Verdict: BLOCK
- Counts: 1 BLOCK, 1 WARN, 0 SUGGEST
- Blocker split: 1 feature / 0 machinery

## Findings

### B1

- ID: B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic` and `asm-review-frontend`, corroborated by chair
- Class: feature
- File: `src/webview/worktree/WorktreeRemoveDialog.ts:70`
- Title: The ordinary confirmation remains unreachable in the production removal flow
- Evidence: Persists from cycle 1 round 1. The sole production caller opens `WorktreeRemoveDialog` only for a blocked result carrying `needsConfirm` (`src/webview/worktree/WorktreeView.ts:1473-1487`). The host returns such a result only when `atRisk(assessment.evidence)` is true; when every confirmable risk passed, and when only proofs are unproven, `src/worktree/worktreeMutationService.ts:414-427,761-770` proceeds directly to `git worktree remove` on the first unforced menu request. Tasks 1_4 and 1_5 do not alter this seam. The ordinary-confirmation tests still call the dialog directly.
- Impact: A clean worktree is deleted from the menu click without showing the assessment, requesting ordinary confirmation, or stating the irreversible deletion and preserved branch. Tasks 1_2 and 1_3 remain unimplemented on their primary production path.
- SuggestedFix: User-owned product decision remains required: either make the first removal request return a fingerprint-bound assessment for ordinary as well as typed confirmation and execute only after the dialog callback, or remove the ordinary-control claims and unreachable implementation from this change and amend the accepted contract.
- Status: rebutted
- Triage: The observation is correct and I verified it again — `atRisk` gates whether the host sends a report, every predicate in it implies a confirmable check that is failing or unproven, so `confirmationFor` cannot return `ordinary` in production. What I dispute is that it is a defect of THIS change. docs/PLAN.md WT-013.4's Acceptance has six clauses and every one governs what the dialog renders or which control it selects for an assessment it is given; not one governs which removals are assessed. All six are met by 1_1-1_6. The `atRisk` gate predates this change and belongs to the removal flow. My delta did overclaim — its subject was "the removal", which made it false of the shipped system — and that is now corrected to the control the dialog selects, with the host's policy named as out of scope. The product question B1 raises is real and is recorded in workflow.md as a follow-up needing its own PLAN task; minting one is the user's call. If the chair still reads the rescope as cutting accepted scope rather than correcting an overclaim, overrule this and it goes back to the user.

### W3

- ID: W3
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-contracts` and `asm-review-logic`, corroborated by chair
- Class: feature
- File: `src/webview/worktree/WorktreeRemoveDialog.ts:391`
- Title: Refusal explanation assumes a local busy agent for unrelated refusal outcomes
- Evidence: Task 1_5 makes any refusal-class `unproven` check enter the refusal branch. That branch distinguishes `isMain` and `containsWorktrees` only when they `failed`; every other refusal reaches the local-agent copy. With the new test's `busyAgents: unproven` report and no rows, lines 422-424 say “An agent was mid-turn ... It is no longer listed here,” while the check list immediately below says “Could not tell whether an agent is mid-turn here.” An unproven `isMain` or `containsWorktrees` check receives the unrelated agent explanation, and a failed or unproven `externalAgents` check is also described as a local row the user should stop. Current host-produced `unavailable` assessments route to retry UI rather than this dialog, so the unproven contradiction is not reachable through today's producer, but task 1_5 explicitly establishes the wire-legal fallback; failed external-session refusal is a valid refused payload.
- Impact: The dialog can turn absence of evidence into a factual historical claim or direct the user to stop a local agent when the refusal came from another window, contrary to the baseline requirement that a refusal name the reason it actually has. The control remains safely absent, so the defect is explanatory rather than an authorization bypass.
- SuggestedFix: Select refusal copy from the same check id and outcome that selected the control. Add explicit failed/unproven external-session explanations and uncertainty wording for unproven `isMain` and containment; render local-agent guidance only for an applicable `busyAgents` refusal. Add user-visible matrix assertions.
- Status: accepted
- Triage: Verified, and it is a consequence of my own 1_5 fix: routing unproven refusals into this branch without widening the copy that explains them. Baseline requirement "A refusal names the reason it actually has" already forbids presenting one reason's explanation when a different one refused, so this is conformance and needed no delta. Fixed as task 1_6 — the refusing check is picked by class and host order, and the copy is selected from its id and outcome. The externalAgents half was reachable before this change too.
- Invariant: A refusal may fail closed without promoting unknown evidence to a factual claim.
- Boundary inventory:
  - Affected: refusal-copy selection for `busyAgents`, `isMain`, or `containsWorktrees` with `outcome: unproven`, plus `externalAgents` with `outcome: failed` or `unproven`.
  - Verified safe: confirmation remains absent; failed `isMain`, failed containment, and failed local `busyAgents` refusals retain their reason-specific branches; current host `unavailable` routing does not open this dialog.

## Prior finding resolution

### B2

- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/webview/worktree/WorktreeRemoveDialog.ts:475`
- Title: Refused dialogs omitted the checks the host reported
- Evidence: Fixed by task 1_4. The refusal path now appends `buildBlockerList` and any proof group before its actions, and changed tests assert host-order check ids while confirming that no destructive or typed control exists.
- Impact: Resolved.
- SuggestedFix: Applied.
- Status: fixed
- Triage: accepted in round 1; fixed in `ce21d0cc`.

### W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, corroborated by chair
- Class: feature
- File: `src/worktree/removalChecks.ts:244`
- Title: Unproven refusal-class checks fell through to confirmation
- Evidence: Fixed by task 1_5. `isRefusedByChecks` now treats refusal-class `failed` or `unproven` as refusal. Production search confirms its only non-test consumers are `isRemoveRefused` and `confirmationFor` in `WorktreeRemoveDialog.ts`; the host still chooses `assessment.kind` independently, and `unavailable` still routes directly to retry UI.
- Impact: Resolved for control selection; W3 records the separate copy consequence introduced by the corrected reachability.
- SuggestedFix: Applied.
- Status: fixed
- Triage: accepted in round 1; design/spec handback completed, fixed in `2bd823f0`.

### W2

- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-logic`
- Class: feature
- File: `src/webview/worktree/WorktreeRemoveDialog.ts:147`
- Title: The presenter called every live pane idle
- Evidence: Fixed by task 1_4. The failed sentence now states only that the counted terminals have the worktree as their working directory, matching the unchanged producer's non-exited-pane evidence. Tests assert the absence of “idle” and the working-directory claim.
- Impact: Resolved.
- SuggestedFix: Applied.
- Status: fixed
- Triage: accepted in round 1; fixed in `ce21d0cc`.
