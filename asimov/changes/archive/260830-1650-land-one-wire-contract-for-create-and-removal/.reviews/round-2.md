# Review Round 2

- Date: 2026-08-30
- Cycle: 1
- Mode: verification
- Scope: range `10e3dd648d54539fbe07a58dacd3cfd7680cd0a0..214960d42400e27506208efdbbc90d85ac2e0fa8`
- Head: `214960d42400e27506208efdbbc90d85ac2e0fa8` (clean working tree)
- Reviewable lines: 270
- Scope lock: passed. Commit `a42de0a0` contains the two UI mockups already identified and excluded in round 1; both are `docs/**`, add no production capability or invariant owner, and remain skipped. The task/review/analytics changes are remediation metadata, not a design or contract delta.
- Agents spawned:
  - `asm-review-contracts`: B1/B2/W1 create-boundary impact cone — `gpt-5.6-terra[1M]`
  - `asm-review-frontend`: W2 destructive-dialog impact cone — `sonnet[1M]`
- Agents skipped:
  - `asm-review-data-security`: B1's authorization boundary is fully represented by the exact-disposition contract cone; no separate storage/auth implementation landed
  - `asm-review-logic`: no changed mutation, queue, path, or removal-decision algorithm
  - `asm-review-performance`: no growth axis or hot path changed
  - `asm-review-reuse`: no duplication/split-cohesion change in the remediation cone
- Verification evidence: `bun run asm change verify-status land-one-wire-contract-for-create-and-removal` reports task 2_1 exit 0 and scope-unchanged; no verify command or test suite was run by review
- Verdict: WARN
- Counts: 0 BLOCK, 2 WARN, 0 SUGGEST; 1 non-gating audit-backlog suggestion

## Cross-round disposition

### B1

- ID: B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `asm-review-data-security`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:896`
- Title: Unredeemed destination disposition crosses the host boundary
- Evidence: `isKnownDisposition` is now checked beside the mode and after-create guards and admits only `kind === "free"`; forged or malformed debris never reaches the capability. Boundary tests cover debris, unknown, missing, and defined extra authorization values.
- Impact: The round-1 authorization bypass is closed before capability or git work.
- SuggestedFix: None; fixed at the invariant boundary.
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### B2

- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `asm-review-data-security`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:904`
- Title: After-create validation accepts malformed union variants
- Evidence: The agent arm now requires boolean `waitForSetup`; non-agent arms admit only their discriminant; launch-field value admission still runs before create. Restored host tests exercise missing/non-boolean setup gates and launch fields on non-launch variants across `handleMessage`.
- Impact: The behavior-changing malformed variants from round 1 no longer reach create execution.
- SuggestedFix: None for B2's accepted invariant; the remaining exact-key issue is carried as W1.
- Status: fixed
- Triage: accepted in round 1; verified fixed in round 2

### W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-contracts`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:837`
- Title: Undefined foreign keys still bypass exact union validation
- Evidence: `onlyKeys` accepts every entry whose value is `undefined` before checking whether its key is allowed. Consequently `{ kind: "free", authorization: undefined }`, `{ kind: "reuse", branch: "feat", baseRef: undefined }`, and `{ kind: "none", agent: undefined }` cross the boundary despite those keys being absent from the variant. Structured clone preserves those own keys; genuinely optional fields do not require this exception because each variant's allow-list already includes its optional key.
- Impact: The dangerous defined values are fixed, but the remediation's stated exact-shape invariant and W1's structural-absence contract remain incomplete at the serialized edge. A later reader using property presence rather than value would receive a shape the validator claims is exact.
- SuggestedFix: Reject every key outside `allowed` regardless of its value. Keep optional keys in that variant's allow-list and let the variant-specific value check decide whether `undefined` is permitted. Add boundary tests with forbidden keys explicitly set to `undefined`.
- Status: persists from round 1
- Triage: Accepted, and my rationale was the defect. I wrote that an undefined value counts as absence because that is what an optional field can look like after a serialization round trip — true, but irrelevant: every optional field a variant legitimately has is already named in its own allow-list, so the exemption could only ever admit forbidden keys. `onlyKeys` now rejects any key outside the list whatever it holds, and whether an ALLOWED key may be undefined stays the variant validator's call. Boundary cases added for `reuse` with `baseRef: undefined`, `none` with `agent: undefined`, and `free` with `authorization: undefined`.
- Triage: accepted; partial fix verified, exactness residual remains

### W2

- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-frontend`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeRemoveDialog.ts:332`
- Title: Unproven checks fall into an empty force-removal confirmation
- Evidence: The dialog now withholds `Force remove` when any check is `unproven`, independent of class or id. `countOf` returns a magnitude only for a failed check. The currently reachable confirmable-assessment path emits no unproven outcomes, so its rendering and confirmation behavior remain unchanged.
- Impact: The irreversible action now fails closed for every unproven report. New explanatory copy is not required to clear this change's safety obligation and remains owned by WT-013.4.
- SuggestedFix: None for the accepted safety half; report-legibility follow-up is recorded below as audit backlog.
- Status: fixed
- Triage: accepted with ownership split in round 1; dangerous half verified fixed in round 2

## New findings

### W3

- ID: W3
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-frontend`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeRemoveDialog.test.ts:351`
- Title: Refusal-class unproven test uses a selector that never matches
- Evidence: `danger()` queries `.wt-dialog-actions .danger, button.danger`, while `textButton(..., "danger", ...)` produces `wt-btn wt-btn--danger`. The refusal-class case's only assertion is therefore vacuous: it returns null even if `Force remove` is present. The confirmable-class test has an independent text assertion, but the refusal-specific regression round-1 W2 named is not directly protected.
- Impact: A later class-specific change could re-expose force for an unproven refusal while this regression test stays green.
- SuggestedFix: Query `.wt-btn--danger` or assert the button-text list does not contain `Force remove`, as the adjacent confirmable test already does.
- Status: new
- Triage: Accepted. `textButton` renders `wt-btn wt-btn--danger`, so the helper's `.danger` matched nothing and both withhold-force assertions held regardless of the button. Exactly the failure the suite rule exists to catch, and it was mine. Selector corrected to `button.wt-btn--danger`; both tests still pass, which is now evidence rather than an artefact of a dead query.
- Triage: pending

## Accepted risk

None.

## Audit backlog

### A1

- ID: A1
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: `asm-review-frontend`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeRemoveDialog.ts:317`
- Title: Withheld-force dialog still renders force-action warning copy
- Evidence: `buildForceWarning` is appended before the unproven guard and says “Force remove deletes…” even when that guard omits the Force button.
- Impact: When a later task routes unproven checks here, the page will name an unavailable action. It is a copy mismatch, not a fail-open condition, and the path remains unreachable today.
- SuggestedFix: WT-013.4 should replace or gate this warning when it adds the explanatory unproven-report copy.
- Status: audit-backlog
- Triage: Accepted as backlog, not fixed here — it is the same boundary as W2's deferred half. `buildForceWarning` still renders "Force remove deletes…" under a report whose force button was withheld, which is a copy mismatch on an unreachable path, not a safety exposure. Rewriting it needs the unreadable-report copy WT-013.4 owns, so fixing it here would land exactly the prose this change's Must not forbids. Carried to WT-013.4.
- Triage: owner WT-013.4; non-gating
