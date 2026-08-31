# Review round 1

- Date: 2026-08-31
- Cycle: 1
- Mode: discovery
- Scope: commit range `8fecc533~1..HEAD`
- Head: `5c095a865c90c001e76c0804099456902541bc6a`
- Tree: dirty, but the dirty analytics files were outside the explicit commit range
- Reviewable lines: 463
- Agents spawned:
  - `asm-review-logic` — PR selection, resolution, and async flow — `gpt-5.6-sol[1M]`
  - `asm-review-frontend` — create-dialog list and selection state — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — extension-to-webview message contract and routing — `sonnet[1M]`
  - `asm-review-data-security` — `gh` process boundary and response validation — `gpt-5.6-terra[1M]`
  - `asm-review-reuse` — runner, resolution, and assembly-test ownership — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-performance` — the only new growth axis, open PRs per repository, is structurally bounded to 101 process rows and 100 wire/UI rows
- Verification evidence: `asm change verify-status offer-a-pull-request-as-a-source` records all task gates passing; no project verify command was run during review
- Verdict: REJECT
- Counts: 3 BLOCK, 4 WARN, 0 SUGGEST
- Gating split: 3 feature, 0 machinery

## Findings

### B1

- ID: B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair, corroborated by `asm-review-logic` and `asm-review-frontend`
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1581`
- Title: Fork note promises a remote write the submitted create cannot perform
- Evidence: The rendered note says a remote “is configured when the worktree is created.” D5 and the task boundary explicitly say this change does not configure a remote, and the submitted create request carries neither fork owner nor remote information. The production create path therefore cannot make the statement true.
- Impact: The user authorizes the create believing a repository-level side effect will occur, but the created worktree has no configured route to the fork head. This is a material divergence from the approved D5 boundary, not merely the acknowledged planning gap.
- SuggestedFix: Keep this task read-only and change the statement to the behavior that is true now, for example that the head is on the named owner’s fork and using that head requires a remote to be configured. Do not claim the current create configures it.
- Status: accepted
- Triage: Accepted. The note claims a write this change is forbidden to perform, and a statement made to earn authorization has to be true of the create being authorized. Remediation, not redesign: the spec requires the fork remote to be STATED before the create, and naming the remote the head requires still states it — no D# moves and no invariant changes owner. Reworded; the remote write stays unowned and is called out for planning.

### B2

- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair, corroborated by `asm-review-frontend`
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1572`
- Title: Fork note survives a switch to detached mode
- Evidence: `forkStated` checks only repository id and the still-populated branch input. Selecting a fork PR and then enabling detached mode leaves both values unchanged, so the note remains visible even though the submitted create now detaches at `baseRef` and no longer uses the PR source.
- Impact: The pre-authorization statement describes a different operation from the one Create will run. The note’s active-selection invariant fails at the detached-mode boundary.
- SuggestedFix: Make the note conditional on the active non-detached PR selection, or clear the PR-source state whenever detached mode takes ownership. Add a witness that selects a fork PR, enables detached mode, and observes the statement withdrawn.
- Status: accepted
- Triage: Accepted, and it is the same invariant B1 is about: the statement must describe the create that is about to run. Detached takes the branch out of the create entirely, so the note describes an operation the form is no longer offering. Fixed at the guard rather than by clearing state at the toggle, so a fifth mode added later inherits the rule.

### B3

- ID: B3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: chair, corroborated by `asm-review-frontend`
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1563`
- Title: A capped pull-request list is presented as complete
- Evidence: The host carries `pullRequests.truncated`, but `syncDerived` renders a partial-results note only from `repo.refs?.truncated`. `currentRepo().pullRequests?.truncated` is never stated. Approved D2 requires the PR cap to receive the same one-over treatment and for the truncated row count to be stated.
- Impact: Repositories with more than 100 open PRs silently omit valid PR sources, and typing cannot discover the omitted rows because filtering is local over the capped payload. The UI therefore makes the exact completeness claim the accepted design forbids.
- SuggestedFix: Render a PR-specific partial-results statement when the PR offer is truncated, preserving a truthful combined state when refs and PRs are independently truncated. Add a >100-PR dialog witness.
- Status: accepted
- Triage: Accepted. § 5 makes a capped list saying so the one claim this control must not omit — the refs list already says it, and filtering is local, so a PR past the cap cannot be found by typing either. The omission is mine, not a design gap.

### W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair
- Class: feature
- File: `src/providers/WorktreeHost.ts:1841`
- Title: A rejected PR reader is swallowed instead of becoming unavailable
- Evidence: The success and `{ ok: false }` paths post `worktreePullRequests`, but the promise rejection handler is `.catch(() => {})`. The changed host test explicitly expects no PR message for a throwing reader, leaving the dialog in the distinct “not answered yet” state. The production `createGitCommandRunner` currently resolves every command outcome, so the enumerated shipped process failures remain covered; this warning concerns a rejected dependency or future reader implementation.
- Impact: An unexpected reader rejection leaves an open dialog permanently silent about PR availability instead of collapsing to the one unavailable row D1/D3 describe.
- SuggestedFix: In the rejection path, after the same disposed/surface checks, post `{ available: false }` with the echoed repo id and token. Change the throwing-reader witness to require that row while still proving refs arrive independently.
- Status: accepted
- Triage: Accepted as must-fix in effect though non-blocking as filed: the catch is the one path that can leave the form in 'not asked yet' forever, which is precisely the state D1 collapses every failure out of. The current runner resolves rather than rejects, so this is a contract-level hole rather than a live bug — which is why it is cheap to close now.

### W2

- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-contracts`
- Class: feature
- File: `src/types/messages.ts:2348`
- Title: The new wire type permits contradictory availability states
- Evidence: `available` is a plain boolean while `pullRequests` and `truncated` are independently optional. Values such as `available: true` without rows or `available: false` with rows type-check, although the source read correctly models success and unavailable as a discriminated union. The controller masks the first invalid form with `?? []`.
- Impact: Future producers can compile a contract state whose meaning contradicts the comments and UI state model, making a message bug look like an empty successful list.
- SuggestedFix: Make both `WorktreePullRequestsMessage` and `WorktreePullRequestOffer` discriminated unions on literal `available: true | false`, requiring rows/truncation only on the true branch.
- Status: accepted
- Triage: Accepted. This change carries the new-api-contract flag, and a wire shape that can spell 'available with no list' or 'unavailable with a list' is exactly what that flag exists to catch. Modelled as a discriminated union so the invalid combinations stop being representable rather than being checked for at each reader.

### W3

- ID: W3
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-data-security`
- Class: feature
- File: `src/worktree/repoPullRequests.ts:65`
- Title: Cross-repository rows are accepted without a fork owner
- Evidence: A row with `isCrossRepository: true` and a missing or empty `headRepositoryOwner.login` is accepted with `fromFork: true` and `headOwner: ""`. That value directly drives the fork statement.
- Impact: Malformed-but-parseable forge output can produce “on 's fork” and an empty remote identity. Static argv and `textContent` prevent command or DOM injection, but the authorization statement becomes contradictory.
- SuggestedFix: Reject a cross-repository row unless the owner login is non-empty, or model unknown ownership explicitly and suppress the remote statement until identity is complete.
- Status: accepted
- Triage: Accepted. A fork row with no owner produces a statement naming nobody, and the statement is the whole of what this feature offers for a fork. Dropped at the reader, which is where the same rule already drops a row lacking a number or a base — one fail-closed rule, not a second one at the view.

### W4

- ID: W4
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-reuse`
- Class: feature
- File: `src/extension.worktreeAssembly.test.ts:476`
- Title: The assembly witness hand-mirrors production message handlers
- Evidence: The test constructs its own `worktreeHandlers` and explicitly routes `onWorktreePullRequests` to the controller. Production separately defines that handler in `src/webview/main.ts`. The end-to-end test therefore proves the test-owned route, not that the shipped route remains present.
- Impact: Removing or miswiring `onWorktreePullRequests` in `main.ts` can ship PR discovery dark while this assembly test stays green—the exact regression class the witness is meant to prevent.
- SuggestedFix: Extract the production worktree handler construction into one factory consumed by `main.ts` and the assembly test, or drive the actual production route table from the assembly witness.
- Status: accepted
- Triage: Accepted. This exact duplication already shipped the feature dark once during build — the handler was added to main.ts and the hand-mirrored set in the assembly test, and the witness failed until the second copy was updated. A test that can pass while production routing is gone is not a dark-ship guard. The route table now has one owner and both use it.

## Full-flow trace

- Entry: each create opening posts one `requestWorktreeRefs` per repository with the opening token.
- Discovery: the host starts the local refs and `gh pr list` reads independently; refs do not await the forge. `gh` runs through the existing runner in the repository main checkout and requests 101 rows.
- Contract translation: success or unavailable is posted on `worktreePullRequests` with repo id and token; the controller drops stale-opening tokens and stores answers per repository.
- UI: the dialog inserts matching PR rows after matching refs and before create-new; titles use substring matching, numbers use prefix matching, and unavailable is disabled.
- Selection: a PR becomes `pr/<number>` plus its own base, is classified against offered refs, then enters the existing host resolution path. The host’s `blockedBy` answer remains the final held-branch owner, including refs omitted by the cap.
- Side effect: create submission carries the existing branch/base/resolution draft only. No fork metadata or remote write reaches the host, which is why B1 is reachable.
- Error/fallback: known runner failures become unavailable and do not delay refs; an unexpected rejected reader is swallowed (W1). Capped PR discovery reaches the UI but its partial state is not rendered (B3).

## Author triage (round 1)

All seven findings accepted; none rebutted. Every one is remediation inside the accepted contract —
no `D#` changes and no new invariant owner — so the fixes land in this cycle rather than as a
handback.

The one thing NOT fixed here is the thing B1 exposed underneath the wording: nothing configures a
fork remote. That is a capability this change never had and never claimed to add (D5, and the task's
own Boundary). It needs its own PLAN task, and it is named in the Build Complete summary rather than
smuggled into a fix round.
