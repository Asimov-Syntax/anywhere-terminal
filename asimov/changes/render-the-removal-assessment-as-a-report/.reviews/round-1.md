# Review Round 1

- Date: 2026-08-31
- Cycle: 1
- Mode: discovery
- Requested lane: fastlane
- Scope: range `a7003eb4..HEAD`
- Head: `6ec5fd0b763e4ac0279efdb1b1bdfe4ccffb8089` (working tree dirty from untracked `asimov/changes/render-the-removal-assessment-as-a-report/analytics.json`, outside the reviewed range)
- Reviewable lines: 359
- Agents spawned:
  - `asm-review-logic` — deletion authorization — `gpt-5.6-sol[1M]`
  - `asm-review-contracts` — removal contract composition — `gpt-5.6-terra[1M]`
  - `asm-review-frontend` — report UI and accessibility — `sonnet[1M]`
  - `asm-review-logic` — presenter truth conditions — `gpt-5.6-luna[1M]`
  - `asm-finder` — removal authorization flow — `gpt-5.6-luna[1M]`
- Agents skipped: `asm-review-data-security`, `asm-review-performance`, `asm-review-reuse` — no data/auth/storage, growth-axis, or reimplementation risk warranted a separate lens
- Verdict: BLOCK
- Counts: 2 BLOCK, 2 WARN, 0 SUGGEST
- Blocker split: 2 feature / 0 machinery

## Findings

### B1

- ID: B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/webview/worktree/WorktreeRemoveDialog.ts:316`
- Title: The ordinary confirmation is unreachable in the production removal flow
- Evidence: The new ordinary branch is selected only inside `openWorktreeRemoveDialog`, but the sole production caller opens that dialog only for a blocked result carrying `needsConfirm` (`src/webview/worktree/WorktreeView.ts:1473-1487`). The host returns such a result only when `atRisk(assessment.evidence)` is true; when every confirmable risk passed, and also when only proofs are unproven, `worktreeMutationService.ts:414-427,761-770` proceeds directly to `git worktree remove` on the first unforced menu request. The new ordinary-confirmation tests call the dialog directly and do not cross this seam.
- Impact: A clean worktree is still deleted from the menu click without showing any assessment, without an ordinary confirmation, and without stating the irreversible deletion or that the branch is kept. This defeats tasks 1_2 and 1_3 on their primary production path.
- SuggestedFix: Make the first removal request return a fingerprint-bound assessment for both ordinary and typed confirmation, and execute only after the dialog's confirmation callback. Add an assembly test that starts from the menu action and proves a clean removal cannot reach execution before the ordinary button is pressed.
- Status: accepted — handback (product scope, user-owned)
- Triage: Verified independently. `atRisk` returns true for dirty, untracked, panes, external sessions, locked, or ignored (>0 or unproven); every one of those maps to a confirmable check that `checksFor` reports as failed or unproven, so `confirmationFor` can never return `ordinary` through the panel. The ordinary control and its 1_3 copy are unreachable. Not fixed in the loop: the suggested remedy makes a clean worktree confirm where today it removes in one click, which changes what the product does, needs a host-side owner and a changed D#; the alternative remedy is to cut the ordinary control from this change. Both are scope calls the user makes, and fastlane never auto-chooses product scope.

### B2

- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/webview/worktree/WorktreeRemoveDialog.ts:364`
- Title: Refused dialogs still omit the checks the host reported
- Evidence: The refusal branch returns at line 488. `buildBlockerList` and `buildProofList` are appended only after that return at lines 491-495, so a refused dialog renders only its bespoke refusal box. A refused assessment currently reports four refusal-class checks through `checksFor`, including the passing checks, but none are rendered as check outcomes. The inherited test at `WorktreeRemoveDialog.test.ts:317-323` still asserts that `.wt-blockers` is absent.
- Impact: The accepted requirement says every check the assessment reported must render, passed checks included. Refused removals remain the old problem-list presentation and do not show what else was checked, so task 1_1 is incomplete.
- SuggestedFix: Render the reported check list in the refusal path as well, while preserving the refusal-specific explanation and the absence of any confirmation control. Replace the inherited absence assertion with coverage of all refusal-report checks and outcomes.
- Status: accepted
- Triage: Verified. `checksFor` returns four checks for a refused assessment (isMain, busyAgents, containsWorktrees, externalAgents), passing ones included, and the refusal branch returns before either list is appended. The 1_1 requirement is unqualified about which dialog renders them, so this is conformance to an accepted requirement rather than a new decision — D1's presenter table already owns the rendering. Fixable inside the change; held until B1's scope call lands, so the fix is not built on a control that may be cut.

### W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, corroborated by chair
- Class: feature
- File: `src/webview/worktree/WorktreeRemoveDialog.ts:70`
- Title: Unproven refusal-class checks fall through to a confirmable control
- Evidence: `confirmationFor` and `isRemoveRefused` rely on `isRefusedByChecks`, which refuses only `cls === "refusal" && outcome === "failed"`. A refusal-class `unproven` check therefore yields typed confirmation if another confirmable check earned one, or ordinary confirmation otherwise. This contradicts project decision D43 and the baseline requirement that activity which cannot be determined refuses removal. The current producer routes wholly unavailable assessments to retry UI rather than this dialog, so the immediate production path remains fail-closed; however the changed test explicitly establishes the contradictory fallback as supported behavior.
- Impact: The wire class no longer consistently expresses what an unproven outcome costs. A future or alternate producer that routes an unproven refusal check through the report can authorize deletion while agent activity is unknown.
- SuggestedFix: Reconcile D2/D3 with D43 in the shared refusal predicate or producer contract: refusal-class `unproven` must remain non-authorizable, or the host must expose a distinct unavailable/retry control state that cannot be mistaken for ordinary confirmation.
- Status: accepted — handback (contradicts blueprint D43)
- Triage: Verified, and stronger than a warning. docs/DESIGN.md D43 states in terms that "a hard refusal unproven still refuses"; worktree-removal.md § 2.2 says the same — "Activity that cannot be determined is treated as live". This change's design.md D2 says "Refusal keeps reading isRefusedByChecks", which refuses only on `failed`. D2 was accepted as written and the residual was recorded in workflow.md, without noticing that the blueprint had already decided it the other way. The blueprint outranks the change's design, so D2 is wrong and must be re-earned rather than patched under. The live path is fail-closed today only because `unavailable` assessments route to retry UI instead of the dialog — one producer away from authorizing a deletion while agent activity is unknown.
- Invariant: Unknown activity must not authorize directory deletion.
- Boundary inventory:
  - Affected: webview control selection for `refusal + unproven`; synthetic test contract.
  - Verified safe: current host routes unreadable listing/session assessments to `unavailable`; `refusal + failed` has no confirmation; `confirmable + unproven` requires typed confirmation; `proof + unproven` does not affect removal.

### W2

- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-logic`
- Class: feature
- File: `src/webview/worktree/WorktreeRemoveDialog.ts:149`
- Title: The presenter calls every live pane idle
- Evidence: The failed `idlePanes` sentence says the counted terminals are idle. The producer deliberately fills `paneIds` from every pane in the worktree whose activity is not `exited` (`src/worktree/worktreeBlockers.ts:296-305`), including running and waiting panes; only the separate registry-suppression set is restricted to idle panes. The changed tests assert counts and outcomes but never cross this producer-to-presenter distinction.
- Impact: The report can understate active terminal use immediately before deleting its working directory. The later consequence sentence correctly says the terminals keep running, but the check line has already made a stronger unsupported claim about their activity.
- SuggestedFix: Word the check from the evidence actually carried, for example “terminal(s) in this window have it as their working directory,” or change the producer and contract if this check is truly intended to count only idle panes. Add a producer-to-dialog assertion with a non-exited, non-idle pane.
- Status: accepted
- Triage: Verified. `checksFor` counts `e.paneIds`, which the producer fills with every non-exited pane, while the presenter's failing sentence calls them "idle terminals". The report understates active terminal use immediately before deleting their working directory. The wording is the defect, not the count — the clause should say the terminals have the worktree as their working directory. Trivial and inside the presenter table; held with B2.
