# Review Round 1: carry-a-contest-membership-once

- Date: 2026-09-02
- Cycle: 1
- Mode: discovery
- Review scope: range `abaf98e0~1..HEAD`
- Head: `a15a51caca3f05ff95a9c44ee5b82cd0fe5d80d7`
- Tree: dirty — untracked `asimov/changes/carry-a-contest-membership-once/analytics.json`; excluded from the explicit range
- Reviewable lines: 155
- Agents spawned:
  - `asm-review-contracts` — provisioning result wire/type contract — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — apply-to-report handoff lifecycle, errors, ordering, races — `gpt-5.6-terra[1M]`
  - `asm-review-performance` — N/T growth through wire and render — `sonnet[1M]`
  - `asm-review-frontend` — controller/state/notice rendering — `gpt-5.6-luna[1M]`
  - `asm-finder` — auxiliary full-flow inventory
- Agents skipped:
  - `asm-review-data-security` — no auth, persistence, datastore, or external API boundary changed
  - `asm-review-reuse` — no new duplicated capability or split with a visible reuse candidate
- Verdict: BLOCK
- Counts: 1 BLOCK, 4 WARN, 0 SUGGEST
- Split over gating blockers: 1 feature / 0 machinery
- Context note: no `proposal.md`; caller intent, approved `tasks.md`, `NO-DELTA.md`, and parent F008/D4a supplied the accepted obligations.
- Verify Gate: recorded green. `bun run asm change verify-status carry-a-contest-membership-once` reports all three task verifications at exit 0; `workflow.md` records the full gate complete. The review did not rerun project gates. Recorded/caller gate detail: check-types clean, 6690 unit tests pass, Biome at 3 errors / 14 warnings / 1 info, fs-deletion gate ok.

## Findings

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-performance
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeView.ts:1822`
- title: The webview expands the shared membership back into quadratic result text
- evidence: `withContest()` maps and joins every member of a contest, then `bad.map()` and `untouched.map()` call it once for each affected step before joining every row into one `reason` string. For a contest with `N` rows and aggregate membership text `T`, the wire is now `O(T + N)`, but the notice and DOM text are still `O(N*T)`. Parent F008 explicitly inventoried notice assembly and DOM text, and accepted task 1_3 requires result text to remain linear. The added growth witness serializes only `{ steps, contests }`, so the current quadratic renderer passes it unchanged.
- impact: A valid contest near the existing row/provider bounds can still expand hundreds of kilobytes of repository-controlled declarations into tens or hundreds of megabytes when the notice is assembled and rendered. Structured-clone bandwidth is fixed, but webview allocation and render stalls remain on the load-bearing create-result path, so the parent invariant is not closed end to end.
- suggestedFix: Render one membership block per contest and associate each refused row with that block, keeping each row's own outcome reason without copying the complete member list into every row. Extend the witness through final notice/DOM text, not only the wire report. This requires no change to peer-owned `applyProvision`.
- status: accepted
- triage: New gating blocker. The growth axis is contest cardinality `N` times aggregate declaration text `T`; affected boundaries are notice construction and DOM text. Verified safe boundaries are apply-result storage, the temporary host handoff, postMessage structured clone, controller state, and step production order.
- invariant: Repository-controlled provisioning metadata remains linearly bounded after every derived representation, including the user-visible notice; preserving per-row truth may group rows under one shared contest membership rather than duplicating the membership text.
- boundary inventory:
  - affected: `provisionSummary` membership reconstruction, joined reason string, notice DOM text, repeated recompute on render
  - verified safe: `ApplyProvisioningResult`, `WorktreeProvisionResultMessage`, extension-to-webview clone, controller/state storage, `provisionKey` cardinality

### F002

- ID: F002
- severity: WARN
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeView.ts:1823`
- title: Dangling contest indexes silently become plausible incomplete refusals
- evidence: `ProvisionStepResult.contest` and message `contests` are independently optional, while `withContest()` treats a missing, empty, or out-of-range record as an ordinary bare reason. Thus a type-valid message such as a refused step with `contest: 0` and no `contests` silently omits every path/source. The changed tests prove the apply output and manually injected view state separately; none drives the new `extension.ts` Map through the posted message, so the load-bearing handoff invariant is not witnessed.
- impact: Any producer/handoff regression loses D4a's membership without an error or visible degradation, and both current focused suites remain green. The current production flow generally supplies coherent data, so this is non-blocking contract hardening rather than a proven live omission.
- suggestedFix: Validate every defined contest index against the outgoing/incoming contest array and render an explicit incomplete-report failure instead of a bare reason. Add an extension/host assembly witness that starts from `applyProvisioning` and asserts the posted message carries the matching contests.
- status: accepted
- triage: New warning. The new cross-message invariant is load-bearing but currently represented only by convention and separated unit fixtures.

### F003

- ID: F003
- severity: WARN
- confidence: HIGH
- priority: P1
- agent: asm-review-contracts, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:222`
- title: Successful contested steps lose the contest association promised by the contract
- evidence: When `contest !== undefined`, the producer adds `contest` only if the favoured result is `refused`; `copied`, `linked`, `degradedToCopy`, `skipped`, or `failed` pass through unchanged. This contradicts `messages.ts:2580`, which defines the index for a step "when this step is a member" of a contest, and the caller's stated contract that each contest member step carries the index. The test titled "points every member at it" asserts only `steps[1]`, not the successful favoured step.
- impact: Consumers cannot rely on the new association across outcomes and must reverse-scan `contests[].members` by id. Current refusal rendering still works because every refused path is decorated, so this is a contract defect rather than a current D4a failure.
- suggestedFix: Whenever `contest !== undefined`, attach `indexOf.get(contest)` to the returned step regardless of outcome, and assert the index on every member including successful/degraded cases.
- status: accepted
- triage: New warning under the `new-api-contract` escalation flag.

### F004

- ID: F004
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.test.ts:370`
- title: The 6x linearity threshold is calibrated to one serialization fixture, not the invariant
- evidence: The witness compares total serialized sizes at 4 and 16 members and chooses 6 between today's measured 4.3x and the restored implementation's 10.3x. For the restored quadratic fixture, adding a size-independent field larger than about 0.86 times the small report lowers `(10.3S + K)/(S + K)` below 6, making the old quadratic representation pass again. Partial membership repetition or different path/source lengths can also move the ratio without changing the asymptotic defect. It additionally stops before F001's render expansion.
- impact: Plausible unrelated report-shape growth can make the previously vacuous regression return while the test stays green; the threshold proves today's fixture, not one-copy membership.
- suggestedFix: Add a structural witness with unique long path/source sentinels that asserts each membership token occurs once in the wire report and never in per-step reasons, plus a separate full-flow witness for linear final notice output after F001 is fixed.
- status: accepted
- triage: New test warning. The exact old implementation is caught today, but the margin is fixture-dependent.

### F005

- ID: F005
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeView.test.ts:2467`
- title: The refusal witness checks the whole notice, not every refused row
- evidence: The fixture contains two refused rows, but the assertions query one `.wt-notice` text blob and require each declaration only once. Removing the contest index or membership reconstruction from either refused step still passes because the other row supplies the same member strings. The title and D4a obligation are per-row.
- impact: A regression can leave one refused contestant without its own contest association while the focused acceptance witness remains green.
- suggestedFix: Split/assert the rendered refusal rows individually and require each refused row to retain the complete contest association and its own reason. If F001 groups the display, assert every refused row is contained in or references the one membership block for its contest.
- status: accepted
- triage: New test warning on the accepted per-row refusal contract.

## Full-flow trace

- Entry: `WorktreeController` submits a create draft carrying the selected offer/item ids; `WorktreeHost` resolves those ids against the host-owned current offer before invoking the create capability.
- Identity and ordering: `worktreeMutationService` revalidates the destination inside the per-repository mutation queue, creates the git worktree, and invokes provisioning before `afterCreate`. Same-repository creates are serialized; a second same-path create is revalidated and cannot also reach a successful apply. No auth boundary or durable persistence is involved.
- Apply translation: `applyProvisioning` computes contests once, preserves the prior `answered` insertion/append production order, returns `{ steps, contests }`, and adds an index to every refused contested step. Successful contested steps omit it (F003).
- Temporary handoff: `extension.ts` stores contests under the normalized `check.path` supplied to `applyProvision`, and the settled create reports through `.then(...deps.report...)`; message assembly takes and deletes the entry before `WorktreeHost.reportMutation`. `validateCreatePath` already assigns normalized `check.path`, both production normalizers are the same function, and the queue prevents a same-repository overwrite. The specialist claim that the Map is routinely keyed by a raw path is rejected by `createPath.ts:165,215`. A create whose promise never settles retains the same data as its pending operation, but no independent accumulating leak or normal same-path race was established.
- Error/fallback paths: unreadable roots return failed steps without contests; a rejected apply is caught and converted to failed steps; post-create launch failures do not replace the successful create outcome; report assembly deletes the contest entry before posting. Missing/dangling contest data currently degrades silently (F002).
- Output: the host posts the create result before the provision result on the same surface; the router sends it to `handleProvisionResult`, which folds steps/contests into the existing create notice. `provisionSummary` then reconstructs complete membership for every refused row, preserving current D4a content but recreating the forbidden `O(N*T)` final text (F001).

## Inline support review

- No `.only`/`.skip`; changed async tests await the apply.
- Focused apply and view tests exist, but the host handoff, structural linearity, and per-row refusal assertions have the gaps recorded as F002, F004, and F005.
- No changed fixtures, seeds, secrets, or destructive support code.

## Adjudication notes

- The performance specialist's Map-leak BLOCK is rejected: `validateCreatePath` stores the normalized result in `check.path` before `applyProvision` receives it, so the claimed raw-vs-normalized normal path is factually wrong. No ordinary mismatch, overwrite, or unbounded completed-create retention was demonstrated; the logic specialist independently found no lifecycle/race defect.
- The performance specialist's render-growth WARN is upgraded to F001 BLOCK. Its proposed precomputed join would reduce repeated computation but not the `O(N*T)` final string/DOM size; the accepted parent invariant and task 1_3 include the rendered representation.
- The frontend specialist's stale-render-key warning is rejected. Production emits one provision result per create, and offer item ids are monotonic and never reused, so a later create changes `provisionKey`; no reachable correction message with identical ids/kinds was found. Reason omission from the key predates this diff.
- The contracts specialist's two findings survive as F002 and F003, with dangling-reference enforcement kept at WARN because the current producer is coherent on established paths.
- Step production order is unchanged. No accepted risk or prior-round finding exists for this change.

## Audit backlog

None.

## Author triage

All five accepted; none rebutted. None changes an accepted contract — the parent's D4a asks that a
refusal NAME every member, not that every row repeat the list — so these are remediation.

- **F001** is the finding this change exists to prevent, relocated: the wire is linear and the
  renderer is not. The notice will carry one membership block per contest and refused rows will be
  associated with it.
- **F002** accepted: an index that does not resolve is a handoff bug, and falling back to a bare
  reason hides it exactly where D4a's obligation lives.
- **F003** accepted: the type says the index is present when a step belongs to a contest, and only
  refused steps got one. A favoured `copied` row belongs to the contest too.
- **F004** accepted: the threshold sits between today's two measurements, which is calibration, not
  a structural claim. A token-level assertion replaces it.
- **F005** accepted: the witness reads the combined notice, so either row could supply the strings
  for both.
