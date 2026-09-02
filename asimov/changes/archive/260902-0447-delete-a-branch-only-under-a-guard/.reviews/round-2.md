# Review round 2 — delete-a-branch-only-under-a-guard

- Date: 2026-09-02
- Cycle: 1
- Mode: verification
- Head: `a8bd6928003d949891fc5dd73658ded3081f01ff` (delta from round-1 Head `8c700b19e599258e3163624f31f2d03c23f19376`; working tree dirty only from protocol-generated `analytics.json` after the reviewed Head)
- Reviewable lines: 106
- Review session: `a1291900-3b03-4f9b-a3d3-d85b0a2cd9f6`
- Scope lock: passed — the delta contains only accepted review remediation and task-completion metadata; no new capability, contract, design obligation, or invariant owner was introduced.
- Verify evidence: `bun run asm change verify-status delete-a-branch-only-under-a-guard` records tasks 5_1 and 5_2 exit 0. The author additionally reports type check passed, 282 files / 6,844 tests passed, filesystem-deletion and bundle-require gates passed, and only the three documented pre-existing Biome format failures outside this change. The chair ran no project verify command.
- Verdict: **WARN**
- Counts: 0 BLOCK · 3 WARN · 0 SUGGEST
- Audit backlog: 1 WARN, non-gating

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-data-security | F001/F002 remediation cone | immutable proof evidence and consent binding | `gpt-5.6-sol[1M]` |
| asm-review-logic | F001/F006/F007 remediation cone | ordering, deadlines, transaction outcomes | `gpt-5.6-terra[1M]` |
| asm-review-frontend | F004/F006 rendering cone | confirmation and refusal truthfulness | `gpt-5.6-luna[1M]` |
| chair | complete remediation delta and cumulative impact cone | adjudication and full-flow trace | `gpt-5.6-sol[1M]` |

Skipped: data-scale/performance, reuse, and broader contracts review — the remediation cone is limited to proof issuance, consent matching, one holder deadline, transaction-failure classification, and two user-visible strings.

---

## Findings

### [F007] The holder deadline can expire without winning the promise race

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-logic; corroborated by chair
- Class: feature
- File: `src/worktree/deleteBranch.ts:425`
- Status: accepted
- Triage: Fix in review task 5_3 by checking synchronous expiry before accepting a clear holder result, with an already-expired causal witness.

**Evidence.** Lines 430–433 race `holders()` only against `holderDeadline.elapsed`; after the holder promise wins, line 445 can proceed to `update-ref` without checking `holderDeadline.expired`. The shared `Deadline` contract explicitly allows `expired === true` before the timer callback resolves `elapsed` (`src/worktree/deadline.ts:19-35`), covering an already-expired injected deadline or an event-loop turn where wall time passed before the timer reaction ran. The new test supplies `expired: false` and therefore cannot fail when this guard is removed.

**Impact.** The final holder read can complete after its accepted two-second bound and still authorize branch deletion. The scan remains fail-closed on a timer that actually wins, but “expiry returns holders-unavailable” is not invariant under the deadline abstraction the function accepts.

**Suggested fix.** After the race and before interpreting `holder === "clear"`, refuse when `holderDeadline.expired` is true. Add a causal witness whose deadline is already expired while `elapsed` has not resolved and whose holder scan returns clear; `update-ref` must remain unreachable.

**Invariant inventory.** Verified safe: a timer-promise win returns `holders-unavailable`, cancels the timer, and no late read can invoke the transaction. Affected boundary: synchronous expiry before the elapsed promise reaction. Final-read ordering, no-deref behavior, and the successful transaction path remain unchanged.

### [F008] Consent mismatches are still reported as a Git guard failure

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-frontend; corroborated by chair
- Class: feature
- File: `src/webview/worktree/WorktreeView.ts:1805`
- Status: accepted
- Triage: Fix in review task 5_3 with actor-neutral wording that is true for both consent rejection and Git guard unavailability.

**Evidence.** `worktreeMutationService.ts:658-671` returns `holders-unavailable` when the redeemed offer is missing or any fingerprint/ref/OID field mismatches, before `deps.deleteBranch` is invoked. `WorktreeView.ts:1805-1806` renders that reason as “Git could not safely complete the branch guard.” The new mismatch tests assert the refusal kind but do not cover the displayed explanation.

**Impact.** The worktree removal succeeds and the branch remains, but the user is told Git failed when the host actually rejected stale or substituted consent. This preserves safety while obscuring why the selected branch action did not run.

**Suggested fix.** Either add a distinct authorization/offer-mismatch refusal reason, or use neutral wording that is true for both pre-Git consent rejection and holder/transaction unavailability, such as “The branch deletion could not be safely authorized or completed.” Add a rendered mismatch-path witness.

### [F009] A deleted ref is collapsed into an unreadable post-transaction check

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-logic
- Class: feature
- File: `src/worktree/deleteBranch.ts:462`
- Status: accepted
- Triage: Fix in review task 5_3 with discriminated post-failure ref reads; established absence counts as movement, unreadable state remains generic.

**Evidence.** `readRefOid()` returns `undefined` for every nonzero `rev-parse --verify --quiet`, timeout, spawn failure, or malformed output. Lines 462–466 require both post-failure reads to return OIDs before reporting `refs-moved`. For the already-validated ref names used here, a clean exit indicating the target or default ref is absent establishes that its expected OID no longer holds, but the code reports `holders-unavailable`. The new tests cover changed-to-another-OID and unchanged/unreadable states, not target-absent or default-absent states.

**Impact.** A concrete ref deletion between the holder scan and transaction is reported as unspecified guard unavailability instead of the established expected-value mismatch. The deletion remains fail-closed, but the F006 truthfulness remediation is incomplete for one reachable movement state.

**Suggested fix.** Return a discriminated post-read result such as `oid | absent | unavailable`. Classify either a different valid OID or established absence as `refs-moved`, and reserve `holders-unavailable` for reads that could not answer. Add target-absent and default-absent regression witnesses.

---

## Prior finding dispositions

- **F001 — fixed.** `orphanProofs.ts:181-200` resolves both OIDs before ancestry and runs `merge-base --is-ancestor` on that immutable pair. The issued evidence is byte-for-byte the tested pair; ref movement afterward is caught by the final expected-old-value transaction.
- **F002 — fixed.** `worktreeMutationService.ts:658-675` now requires the nested fingerprint and all four echoed ref/OID fields to match the redeemed report before the binding runs. The same-risk/two-report regression proves replacement evidence cannot inherit an older surface's opt-in.
- **F003 — rejected.** The bundled-require worklist belonged to `fail-a-build-whose-bundle-cannot-resolve-itself` and entered round 1 only because the long-lived branch range included that unrelated change. It is outside this change's accepted obligations and remediation cone.
- **F004 — fixed.** The confirmation now states that the branch is kept unless the separately offered deletion option is selected. The checkbox remains unchecked and independent of typed confirmation.
- **F005 — audit-backlog.** The unconditional `--porcelain -z` path fails closed on Git 2.31–2.35. A strict line-delimited fallback needs its own admitted parser and CI-version coverage, so it is visible but does not gate this remediation round.
- **F006 — fixed.** Timeout/spawn failures and unchanged nonzero transactions now use the generic refusal; changed readable OIDs produce `refs-moved`, and successful atomic transactions are unchanged. F008 separately records the generic copy's pre-Git authorization boundary; F009 records the independently actionable absent-ref representation gap.
- **F007 — persists.** See current finding.

## Audit backlog

### [F005] Strict holder reconciliation has no admitted old-Git fallback

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair
- Class: feature
- File: `src/worktree/deleteBranch.ts:321`
- Status: audit-backlog
- Triage: Non-gating because Git 2.31–2.35 fails closed and cannot cause unauthorized deletion. The safe fallback requires a separately accepted owner for strict line-delimited parsing and versioned CI evidence.
- Owner: future Git compatibility / strict worktree-list fallback change
- Reactivation trigger: guarded branch deletion is promised on Git below 2.36, or an accepted change introduces a strict line-delimited holder parser and Git 2.31–2.35 CI coverage.

---

## Verification questions

1. **Does the emitted evidence now describe the exact ancestry-tested pair?** Yes. Both OIDs are resolved first and those immutable values are the merge-base inputs and emitted evidence.
2. **Can same-risk reports still substitute branch consent?** No established bypass remains. The request fingerprint and all echoed fields must match the redeemed report; mismatch preserves successful removal and never invokes Git.
3. **Are valid/no-opt-in/missing-proof paths preserved?** Yes. Matching opt-ins reach the same binding, absent opt-in leaves removal-only behavior unchanged, and missing/mismatched proof refuses only the branch action.
4. **Is the complete holder scan bounded and incapable of acting late?** A timer-promise win and every abandoned continuation are safe, but F007 shows synchronous deadline expiry is not checked before the transaction.
5. **Are transaction and user-visible outcomes truthful?** The conditional branch-kept confirmation and changed-readable-OID classification are fixed. F008 remains for pre-Git consent mismatches rendered as a Git failure, and F009 for absent refs collapsed into generic unavailability.

## Full-flow verification

The remediation keeps the accepted flow and narrows only its failed boundaries: proof issuance now resolves immutable OIDs before ancestry; report issuance and fingerprint storage are unchanged; redemption still returns issued evidence; the service now compares every opt-in field before the successful-removal follow-up can call Git; the holder inventory and raw reconciliation are unchanged inside one new read-only deadline race; successful `update-ref` transaction ordering and atomicity are unchanged; nonzero failures take bounded read-only ref checks before choosing movement versus generic refusal, though F009 shows established absence is still collapsed with unreadability; the result still maps through the existing controller and notice path. No new finding was admitted outside that behavioral cone.
