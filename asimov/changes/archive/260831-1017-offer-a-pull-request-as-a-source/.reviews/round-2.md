# Review round 2

- Date: 2026-08-31
- Cycle: 1
- Mode: verification
- Scope: commit range `5c095a86..c8cf7069`
- Head: `c8cf70691a48975b687ee63570024826dbc8ec57`
- Tree: dirty, but the dirty analytics files were outside the explicit commit range
- Reviewable lines: 291
- Scope lock: passed — the new route-table owner is accepted W4 remediation inside the existing message-routing contract; task/review/analytics changes are review metadata, not new capability
- Agents spawned:
  - `asm-review-frontend` — B1-B3 dialog rendering and transition cone — `gpt-5.6-sol[1M]`
  - `asm-review-contracts` — W2 message union and W4 shared routing owner — `gpt-5.6-terra[1M]`
  - `asm-review-logic` — W1 rejection path and W3 fork-owner validation — `sonnet[1M]`
- Agents skipped:
  - `asm-review-data-security` — W3 is a narrow validation change covered by the logic cone; no new process/auth surface
  - `asm-review-performance` — no growth-axis change
  - `asm-review-reuse` — W4's one-owner remediation is covered by the contracts assignment
- Verification evidence: `asm change verify-status offer-a-pull-request-as-a-source` records all task gates passing; no project verify command was run during review
- Verdict: BLOCK
- Counts: 2 BLOCK, 0 WARN, 1 SUGGEST
- Gating split: 2 feature, 0 machinery

## Prior finding adjudication

### B1

- ID: B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair, `asm-review-frontend`
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1613`
- Title: Fork note promises a remote write the submitted create cannot perform
- Evidence: The replacement statement says fetching the fork head requires a remote for the owner and explicitly says this create does not configure one. No fork metadata or remote write was added to the submitted request.
- Impact: The authorization statement now distinguishes the requirement from the current create's behavior, so the round-1 overclaim is gone without expanding scope into a remote write.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### B2

- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair, corroborated by `asm-review-frontend`
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1600`
- Title: Fork note survives a switch to detached mode
- Evidence: The added `draft.branchMode !== "detached"` guard hides the note while detached, but it does not withdraw the stored PR selection. `forkHead` remains keyed only by repository and branch. When detached mode is toggled off, `deriveChoice()` reclassifies the unchanged `pr/<number>` text as an ordinary new/existing branch, yet the guard matches the retained `forkHead` again and resurrects the PR-only statement without the user selecting a PR.
- Impact: The same active-selection invariant remains open on the detached-off boundary: the note can again describe a PR source that the current combobox selection no longer owns. Severity remains BLOCK from round 1.
- Boundary inventory: affected — detached off / return to branch mode; verified safe — entering detached hides the note, repository change requires matching repo id, typing a different branch hides it, selecting a same-repository PR clears it.
- SuggestedFix: Withdraw the PR-source identity when detached takes ownership, or represent the current source kind explicitly and require `source.kind === "pr"` for the note. Add the missing sequence witness: select fork PR → detach → return to branch mode; the note must remain withdrawn until a PR row is selected again.
- Status: persists from round 1
- Triage: accepted; remediation incomplete at the invariant boundary

### B3

- ID: B3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: chair, corroborated by `asm-review-frontend`
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1880`
- Title: A capped pull-request list is presented as complete
- Evidence: Seeded PR offers now compose the partial notice correctly, but the normal independent forge path is late. `bindPullRequests` stores the offer and optionally calls `renderList()`; it never calls `syncDerived()`, which is the only place that recomputes `prsPartial` and the partial notice. A truncated PR answer arriving after the dialog opens therefore adds rows while leaving the completeness note hidden or stale.
- Impact: The D3 path that exists specifically because the forge is asynchronous still presents a capped list as complete. Filtering remains local, so omitted PRs cannot be discovered by typing. Severity remains BLOCK from round 1.
- Boundary inventory: affected — late available+truncated answer for the active repository; verified safe — seeded refs-only, seeded PR-only, seeded both-truncated, unavailable, and absent states.
- SuggestedFix: After storing an active repository's PR offer, re-run the derivation that owns the partial notice without touching the destination outstanding gate; add a late truncated-answer witness rather than only seeded offers.
- Status: persists from round 1
- Triage: accepted; remediation incomplete on the async arrival boundary

### W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair, `asm-review-logic`
- Class: feature
- File: `src/providers/WorktreeHost.ts:1826`
- Title: A rejected PR reader is swallowed instead of becoming unavailable
- Evidence: Success, `{ ok: false }`, and rejection now converge on `postForge`; rejection posts the unavailable union member after the same disposal/surface guards. The refs promise remains independent.
- Impact: A rejected dependency no longer leaves the form in “not answered yet.”
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### W2

- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-contracts`
- Class: feature
- File: `src/types/messages.ts:2361`
- Title: The new wire type permits contradictory availability states
- Evidence: Both the wire message and view offer are now discriminated unions. `pullRequestOffer` is the single controller conversion used by live delivery and dialog snapshots, and all consumers narrow on `available` before reading rows or truncation.
- Impact: Contradictory success/unavailable combinations are no longer representable in the typed contract.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### W3

- ID: W3
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-logic`
- Class: feature
- File: `src/worktree/repoPullRequests.ts:68`
- Title: Cross-repository rows are accepted without a fork owner
- Evidence: Cross-repository rows now return `null` when the owner login is absent or empty, while same-repository rows remain valid without an owner. The validation sits with the existing number/base fail-closed conversion.
- Impact: An unnamed fork can no longer reach the authorization statement.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### W4

- ID: W4
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-contracts`
- Class: feature
- File: `src/webview/worktree/worktreeMessageHandlers.ts:42`
- Title: The assembly witness hand-mirrors production message handlers
- Evidence: The ten pure controller delegations now have one table consumed by both `main.ts` and the assembly test. The carve-outs are honest: `onWorktreeTreeResponse` goes through `tabBarScope.applyTree` in production, and `onVaultLaunchTargets` dispatches by capability between the worktree controller and vault panel, so neither is a pure delegation suitable for this table.
- Impact: Adding or removing an individual delegated worktree route can no longer leave production and the assembly witness with independent copies.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

## New support finding

### S1

- ID: S1
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair
- Class: feature
- File: `src/providers/WorktreeHost.actions.test.ts:1286`
- Title: The rejected-reader test claims a destination witness it does not run
- Evidence: The changed test correctly inverts the inherited PR expectation and still asserts that the refs answer lands, so the W1 assertion was moved rather than weakened. However, its comment and impact manifest also say the destination reply lands; the test sends only `requestWorktreeRefs` and contains no destination request or destination assertion.
- Impact: The recorded verification overstates this test's coverage. The destination path is a separate handler and no production regression was found, so this does not gate the fix.
- SuggestedFix: Remove the unsupported destination claim from this witness, or add a focused concurrent destination request and assertion if that independence is intended to be part of the contract.
- Status: accepted
- Triage: Accepted. The comment claims coverage the test does not have — it says the destination reply survives a throwing reader, and the test never asks for one. An assertion that cannot fail is worse than no assertion, and a COMMENT that names one is worse still, because the next reader trusts it. Fixed by making the claim true (the request is sent and the reply asserted) rather than by deleting the sentence: the claim is the one that matters — discovery must never take the create down with it.

## Inherited assertion check

- W1 host assertion: moved, not weakened for the behavior under test. It changed from expecting silence to expecting the unavailable answer and still proves refs survive. The separate destination claim is not asserted; recorded as S1.
- W2 controller assertion: moved, not weakened. It remains an exact equality assertion and now requires the unavailable union member to carry only `{ available: false }`.
- W4 assembly witness: now consumes the shared production delegation table. Removing `onWorktreePullRequests` from that owner breaks the walk; the two explicit carve-outs have real production behavior beyond delegation.

## Verification impact cone

- Fork statement: wording, detached transitions, repository identity, typed-name transitions, and alternate PR selection were checked. The detached-off transition remains open as B2.
- Partial-list state: refs-only, PR-only, combined, unavailable, absent, and late-answer paths were checked. The late truncated-answer path remains open as B3.
- Forge failures: resolved success, resolved unavailable, rejection, disposed surface, and refs independence were checked; W1 is fixed.
- Message contract: wire union, view union, controller live conversion, and snapshot conversion were checked; W2 is fixed.
- Fork validation: cross-repository missing/empty owner and same-repository missing owner were checked; W3 is fixed.
- Routing: all pure worktree delegations and both non-pure carve-outs were checked; W4 is fixed.

## Author triage (round 2)

Both blockers verified against the code before accepting, and both are mine: round-1's remediation
was incomplete, not wrong.

- **B2** — confirmed. `#wt-detached` sets `branchMode` back to `"new"` and calls `deriveChoice()`,
  which reclassifies the still-present `pr/<n>` text as an ordinary branch. `forkHead` is untouched
  by that path, so the guard matches again. Fixed by withdrawing the pull-request identity where the
  source is actually surrendered — entering detached — rather than by adding a second condition to
  the guard. Clearing it inside `deriveChoice()` was considered and rejected: a refs answer landing
  after a valid pull-request pick also runs that derivation, and would have withdrawn a statement
  that was still true.
- **B3** — confirmed, and the asymmetry is visible in the file: `bindRefs` ends with
  `deriveChoice()` / `renderList()` / `syncDerived()`, and `bindPullRequests` ends without the
  `syncDerived()`. `syncDerived` is the only writer of the partial notice, so the seeded path I
  tested was the only path that worked. Fixed by matching the sibling, with the settled flag left
  false exactly as `bindRefs` leaves it, so the destination gate is untouched.
- **S1** — accepted; see its own Triage line.

No finding rebutted. All three are remediation inside the accepted contract — no `D#` moves, no new
invariant owner — so they stay in this cycle. This is cycle 1, round 3.
