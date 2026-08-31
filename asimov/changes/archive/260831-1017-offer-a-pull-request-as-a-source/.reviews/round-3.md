# Review round 3

- Date: 2026-08-31
- Cycle: 1
- Mode: verification
- Scope: commit range `c8cf7069..c95c8077`
- Head: `c95c8077f93fa915e9fc03c5e1cb1cee81db9000`
- Tree: dirty, but the dirty analytics files were outside the explicit commit range
- Reviewable lines: 19
- Scope lock: passed — the range contains only accepted B2/B3/S1 remediation plus task/review metadata; no new capability, contract, design decision, or invariant owner
- Agents spawned:
  - `asm-review-frontend` — B2/B3 transition and asynchronous-render cone — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — S1 destination witness and B3 async impact — `gpt-5.6-terra[1M]`
- Agents skipped:
  - `asm-review-contracts` — no contract shape changed
  - `asm-review-data-security` — no process/input boundary changed
  - `asm-review-performance` — no growth-axis change
  - `asm-review-reuse` — no ownership or duplication change
- Verification evidence: `asm change verify-status offer-a-pull-request-as-a-source` records all task gates passing; no project verify command was run during review
- Verdict: APPROVE
- Counts: 0 BLOCK, 0 WARN, 0 SUGGEST
- Open gating blockers: 0

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
- Evidence: Round 2 verified the statement now names the fork-head requirement and explicitly says this create does not configure the remote. Round 3 does not alter that wording or submitted payload.
- Impact: The authorization statement remains truthful without adding the out-of-scope remote write.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2 and unchanged in round 3

### B2

- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair, corroborated by `asm-review-frontend`
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:738`
- Title: Fork note survives a switch to detached mode
- Evidence: Entering detached now sets `forkHead = null` at the boundary that surrenders the PR source. Leaving detached re-derives the still-present `pr/<number>` text as an ordinary branch, but there is no retained PR identity to resurrect the note. The render guard still independently keeps the note hidden while detached. Explicit PR re-selection repopulates the identity.
- Impact: The statement now remains withdrawn through the full select PR → detach → un-detach transition while valid re-selection behavior is preserved.
- Boundary inventory: verified safe — entering detached, leaving detached, explicit PR re-selection, refs arriving after a valid PR selection, repository change, typed-past selection, same-repository PR selection.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 2; verified fixed in round 3

### B3

- ID: B3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: chair, corroborated by `asm-review-frontend` and `asm-review-logic`
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1904`
- Title: A capped pull-request list is presented as complete
- Evidence: The active-repository `bindPullRequests` callback now calls `syncDerived()` after storing and optionally rendering the late answer. The default `settled = false` means it recomputes the partial notice and other display state without calling `askForDestination()` or arming the destination gate. Tests begin with the notice hidden, then prove a late truncated answer shows it and a late complete answer leaves it hidden.
- Impact: Seeded and real asynchronous forge paths now state completeness consistently, and omitted PRs are no longer presented as a complete searchable set.
- Boundary inventory: verified safe — late truncated, late complete, seeded truncated/complete, unavailable, absent, non-active repository early return, closed dialog early return; destination selection/request ownership unchanged.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 2; verified fixed in round 3

### W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair, `asm-review-logic`
- Class: feature
- File: `src/providers/WorktreeHost.ts:1826`
- Title: A rejected PR reader is swallowed instead of becoming unavailable
- Evidence: Round 2 verified success, unavailable, and rejection converge on `postForge`; round 3 changes only the witness and confirms refs and create-defaults replies survive the rejected reader.
- Impact: Forge rejection remains isolated from local discovery and the create opening.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2 and corroborated in round 3

### W2

- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-contracts`
- Class: feature
- File: `src/types/messages.ts:2361`
- Title: The new wire type permits contradictory availability states
- Evidence: The discriminated wire/view unions and single controller conversion are unchanged from the round-2 verified fix.
- Impact: Contradictory availability states remain unrepresentable.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2 and unchanged in round 3

### W3

- ID: W3
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-logic`
- Class: feature
- File: `src/worktree/repoPullRequests.ts:68`
- Title: Cross-repository rows are accepted without a fork owner
- Evidence: The round-2 verified fail-closed owner check is unchanged.
- Impact: Unnamed fork rows remain unable to reach the authorization statement.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2 and unchanged in round 3

### W4

- ID: W4
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-contracts`
- Class: feature
- File: `src/webview/worktree/worktreeMessageHandlers.ts:42`
- Title: The assembly witness hand-mirrors production message handlers
- Evidence: The round-2 verified shared delegation table and honest non-pure carve-outs are unchanged.
- Impact: Production and the assembly witness continue to share one owner for pure worktree routes.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2 and unchanged in round 3

### S1

- ID: S1
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair, corroborated by `asm-review-logic`
- Class: feature
- File: `src/providers/WorktreeHost.actions.test.ts:1294`
- Title: The rejected-reader test claims a destination witness it does not run
- Evidence: The test now sends `requestWorktreeCreateDefaults` after starting the rejected forge read and asserts a `worktreeCreateDefaults` answer for the repository, alongside the refs and unavailable assertions. `builtHost` clears setup posts before returning, so the defaults assertion cannot be satisfied by initialization noise.
- Impact: The test's claim that forge discovery cannot take the create opening down is now an executable witness rather than commentary.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 2; verified fixed in round 3

## Final verification impact cone

- Fork identity lifecycle: explicit PR selection establishes identity; entering detached withdraws it; leaving detached cannot resurrect it; explicit PR re-selection restores it.
- Late forge state: only the active repository reaches `syncDerived`; closed and non-active answers return first. Unsettled derivation updates the partial notice without asking for or invalidating a destination.
- Failure isolation: a rejected forge reader still permits refs, create defaults, and the unavailable PR answer to land independently.
- Tests: the three round-3 witnesses begin from states that make each assertion capable of failing; no inherited assertion was removed or weakened.

## Open items

None. All accepted round-1 and round-2 findings are fixed. The fork-remote write remains deliberately outside this change and is stated truthfully as unconfigured; it is a planning item, not accepted risk in this implementation.
