# Review round 1 — delete-a-branch-only-under-a-guard

- Date: 2026-09-02
- Cycle: 1
- Mode: discovery
- Head: `8c700b19e599258e3163624f31f2d03c23f19376` (explicit range `d3ccc700df75d77e0ec0191c1e4cff2b324dbea5..HEAD`; working tree dirty only from protocol-generated `analytics.json` after the reviewed Head)
- Reviewable lines: 958
- Large change: yes — accuracy may decrease above 800 reviewable lines
- Review session: `a1291900-3b03-4f9b-a3d3-d85b0a2cd9f6`
- Verify evidence: `bun run asm change verify-status delete-a-branch-only-under-a-guard` records tasks 1_1 through 4_5 exit 0. The chair ran no project verify command.
- Verdict: **REJECT**
- Counts: 3 BLOCK · 4 WARN · 0 SUGGEST
- Split over gating blockers: 3 feature · 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-data-security | proof, redemption, holder scan, ref transaction | destructive security boundary | `gpt-5.6-sol[1M]` |
| asm-review-logic | proof and holder implementation | races, state parsing, ordering, atomicity | `gpt-5.6-terra[1M]` |
| asm-review-contracts | host/service/message seam | runtime validation and authority flow | `sonnet[1M]` |
| asm-review-frontend | removal dialog and notices | opt-in truthfulness and outcome rendering | `gpt-5.6-luna[1M]` |
| asm-review-reuse | new guard and parsers | repository capability reuse and drift | `gpt-5.6-luna[1M]` |
| asm-review-logic | bundled-require gate included in the explicit range | fixed-point correctness and complexity | `gpt-5.6-luna[1M]` |
| chair | full range | all applicable lenses and full-flow trace | `gpt-5.6-sol[1M]` |

Skipped: `asm-review-performance` — the branch-delete flow adds no persistent growth axis or hot runtime path; the unrelated build-gate algorithm in the explicit range was assigned as a separate complexity review. An `asm-finder` trace supplied callers, consumers, and analogous guard locations.

---

## Findings

### [F001] Merge evidence can name commits that were never proven merged

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; corroborated by asm-review-data-security and asm-review-logic
- Class: feature
- File: `src/worktree/orphanProofs.ts:181`
- Status: accepted
- Triage: Fix in review task 5_1 by resolving both OIDs before ancestry testing and testing only that immutable pair; this repairs D1/D10 without changing the accepted contract.

**Evidence.** `merge-base --is-ancestor` is run against mutable branch names at line 181. Only after it succeeds do lines 193–196 resolve those names to OIDs. Another Git process can advance either ref between those operations, so the emitted `mergeEvidence` can hold a branch/default OID pair that the ancestry command never examined. The later guard correctly verifies the emitted pair, which makes the substitution survive all the way to deletion instead of catching it.

**Impact.** An unmerged branch commit can receive a passed report and then be deleted after worktree removal. This is irreversible loss of work and defeats the primary guard.

**Suggested fix.** Resolve both refs to OIDs first, then run `git merge-base --is-ancestor <branchOid> <baseOid>`, and emit exactly that pair only when it passes. Add a witness that moves a ref between the reads and proves no untested pair can be issued.

**Invariant inventory.** Searched proof issuance, wire projection, fingerprint storage/redemption, fresh assessment, and the final transaction. Affected: proof issuance. Verified safe once evidence exists: redemption returns issued evidence rather than caller/fresh OIDs, and the transaction checks the recorded OIDs atomically.

### [F002] A stale branch opt-in can delete the branch from a different issued report

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-data-security
- Class: feature
- File: `src/worktree/worktreeMutationService.ts:658`
- Status: accepted
- Triage: Fix in review task 5_1 by requiring the nested fingerprint and all echoed branch/default names and OIDs to match the redeemed report before any guarded branch call.

**Evidence.** Lines 666–672 replace every echoed branch/default name and OID with `redemption.approved.proofs.mergeEvidence`; neither those fields nor `deleteBranchRequest.fingerprint` are compared with the redeemed report. `extension.ts:760-766` then drops the nested fingerprint entirely. Separately, `worktreeFingerprint.ts:102-108,197-207` replaces the one record for a worktree and computes a deterministic fingerprint that deliberately excludes proofs. Two surfaces can therefore receive reports A and B with identical removal risk but different branch evidence and the same fingerprint; B replaces the stored evidence, then A's checked opt-in redeems B and deletes B's branch.

**Impact.** The user can authorize deletion of one displayed branch/report and the host can delete a different branch or commit pair from another report. The opt-in is acting as an unbound boolean rather than consent for the offer shown.

**Suggested fix.** Before invoking deletion, require all echoed branch/default names and OIDs to equal the redeemed `mergeEvidence`, and require the nested fingerprint to match the removal authority carried by the message. A mismatch must preserve the successful removal but return an explicit refused branch outcome. Add a two-surface/same-risk/different-proof witness.

**Invariant inventory.** Searched report issuance, per-worktree replacement, digest inputs, host validation, redemption, service substitution, and extension binding. Affected: opt-in-to-offer binding. Verified safe: caller OIDs alone cannot reach Git; malformed shapes do not reach the binding.

### [F003] The bundled-require worklist remains quadratic on callable fan-out

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-logic; corroborated by chair scratch probe
- Class: feature
- File: `scripts/bundleRequires.mjs:274`
- Status: rejected
- Triage: Valid for `fail-a-build-whose-bundle-cannot-resolve-itself`, but out of scope here: `scripts/bundleRequires.mjs` has no commit owned by this change; the long-lived branch range accidentally included commit `9790a09a`. Route it to that change rather than mixing unrelated remediation into this destructive guard cycle.

**Evidence.** Each newly discovered callable invokes `enqueue(symbol)`, which queues the same call again through `calledAs`; `applyCall()` then iterates every callable target accumulated for that call. A symbol acquiring N function facts therefore causes repeated scans of 1…N targets. A targeted in-memory probe measured 414.1 ms at 1,000 callable facts and 1,640.7 ms at 2,000, approximately 4× work for 2× input.

**Impact.** The package gate can still become quadratic on a legal bundle topology and stall the only package path, contrary to the accepted “each propagation edge once” obligation.

**Suggested fix.** Queue and mark individual `(call, target)` or equivalent edge/fact pairs, applying each newly discovered target to a call once rather than rescanning the full target set whenever one fact is added. Add a callable-fan-out performance witness in addition to the existing deep-chain witness.

**Invariant inventory.** Safe boundary: deep single-fact forwarding now uses reverse indexes. Affected boundary: one callee symbol with unbounded callable fan-out. The current artifact is shallow, but that is not a structural bound.

### [F004] The confirmation says the branch is kept after the user checks deletion

- Severity: WARN
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-frontend; corroborated by chair
- Class: feature
- File: `src/webview/worktree/WorktreeRemoveDialog.ts:577`
- Status: accepted
- Triage: Fix in review task 5_2 by making the consequence sentence follow the checkbox state and causally testing both states.

**Evidence.** The new branch-delete checkbox at lines 577–600 can be checked and causes a deletion request, while `buildRemovalWarning()` at lines 365–370 always says “The branch <name> is kept.” The text does not change with checkbox state.

**Impact.** A security-sensitive confirmation presents two contradictory outcomes for the same authorization. A user can approve branch deletion while the warning still promises the branch will remain.

**Suggested fix.** Make the consequence sentence conditional on the checkbox state, or word it explicitly as the unchecked default and update it when the control changes. Cover checked and unchecked rendered text.

### [F005] Guarded deletion is unavailable on supported Git 2.31–2.35

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair
- Class: feature
- File: `src/worktree/deleteBranch.ts:321`
- Status: audit-backlog
- Triage: Valid supported-version availability gap, but it cannot bypass a destructive guard: Git 2.31–2.35 fails closed with `holders-unavailable`. Owner: WT-013.3 compatibility follow-up. Reactivate when a strict line-delimited porcelain parser is admitted or CI adds Git 2.31–2.35 coverage; the existing lenient parser cannot safely authorize deletion.

**Evidence.** The guard unconditionally runs `git worktree list --porcelain -z`. Project design sets the minimum Git version to 2.31 and records `-z` as a 2.36 capability with a fallback. `WorktreeDiscovery.ts:77-95` already routes this through `gitCapabilities.runWithFallback` and line-delimited porcelain parsing; `deleteBranch.ts` does not.

**Impact.** On supported Git 2.31–2.35, worktree removal succeeds but every opted-in branch delete is refused as holder state unavailable. The new feature is silently nonfunctional on part of the supported version range.

**Suggested fix.** Use the shared Git capability decision and parser, while requiring zero skipped/malformed records before trusting the line-delimited fallback. Keep the stricter OID/state validation needed by the destructive guard.

### [F006] Every transaction failure is reported as ref movement

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-data-security; corroborated by chair
- Class: feature
- File: `src/worktree/deleteBranch.ts:425`
- Status: accepted
- Triage: Fix in review task 5_2 by classifying `refs-moved` only after post-failure ref reads establish movement; otherwise return the existing generic guard-unavailable refusal and render it truthfully.

**Evidence.** Non-zero exit, timeout, and failed process spawn all return `reason: "refs-moved"`. Permission errors, ref-lock failures, storage errors, unsupported behavior, and inability to start Git do not establish that either recorded ref moved. `WorktreeView.ts:1807-1808` renders all of them as “It moved since it was checked.”

**Impact.** The branch remains, but the user is given a false diagnosis after the worktree is already gone and may retry an action that cannot succeed.

**Suggested fix.** Reserve `refs-moved` for an expected-old-value mismatch that can be identified. Route spawn/timeout/storage/unrecognized failures to an unavailable/transaction-failed outcome with accurate wording.

### [F007] Raw holder reads can hang after the worktree has already been removed

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair
- Class: feature
- File: `src/worktree/deleteBranch.ts:208`
- Status: accepted
- Triage: Fix in review task 5_2 with one bounded deadline around the full raw-holder scan; expiry returns `holders-unavailable`, and the abandoned read has no path to the transaction.

**Evidence.** `optionalFile`, `optionalExists`, `readRawAdminDirs`, and `readAdministrativeHolders` await direct `node:fs/promises` operations without a deadline. These execute after successful worktree removal and before any branch outcome is returned. The repository already bounds analogous destructive assessment filesystem reads in `orphanProofs.ts:25,123-145` because a stalled mount otherwise produces silence rather than `unproven`.

**Impact.** A stalled common Git directory or administrative entry can leave the compound action pending forever after the irreversible worktree removal succeeded, so the user receives neither removal completion nor the required separate branch result.

**Suggested fix.** Put one deadline around the complete raw-holder scan and return `holders-unavailable` when it expires. Abandoned reads must remain read-only and must not be allowed to trigger the transaction later.

---

## Verification questions

1. **Does passed merge evidence necessarily describe the exact ancestry-tested pair?** No — F001 shows the ancestry check precedes OID capture.
2. **Do default-branch, ref-type, holder-state, and raw-administration guards fail closed?** The target deletion uses no-deref semantics and the modern-Git holder inventory/reconciliation is comprehensive; no holder bypass was established. F005 and F007 leave supported-version and non-terminating-read gaps. The accepted external checkout/default-selector races remain disclosed residuals.
3. **Is TOCTOU ordering and transaction atomicity correct?** After the holder scan returns, no additional awaited read occurs before `update-ref` is spawned, and the transaction verifies the recorded default OID and deletes the target with its expected OID atomically. The unsafe TOCTOU is earlier, at proof issuance (F001), not between the final holder result and transaction.
4. **Does runtime validation and redemption bind the delete to the user's issued report?** Exact shape validation is present and caller OIDs are not trusted, but the opt-in itself is not bound to the redeemed offer (F002).
5. **Are opt-in and outcomes user-visible and truthful?** The control is absent without proof, unchecked by default, independent of typed confirmation, and the branch outcome reaches the notice. F004 and F006 leave contradictory confirmation copy and false failure diagnoses.

## Full-flow trace

Pre-removal assessment resolves the default and merge state in `orphanProofs.ts` → `removalChecks.ts` projects passed evidence into an offer → `extension.ts` sends the report → `WorktreeRemoveDialog.ts` renders the unchecked opt-in → `WorktreeController.ts` posts the removal fingerprint plus optional request → `WorktreeHost.ts` validates exact shape → `worktreeMutationService.ts` re-assesses, redeems the one-shot fingerprint, removes and settles the worktree, then obtains issued evidence → `extension.ts` adapts it to `deleteBranch.ts` → the guard re-derives default, resolves object format, reconciles porcelain with raw administration, reads every holder class, and immediately spawns one `update-ref --stdin` transaction → the separate branch outcome maps through `toResultMessage`, `WorktreeController`, and `WorktreeView` to the removal notice. F001 breaks the proof before the flow begins; F002 substitutes which issued proof the opt-in acts on; F004/F006/F007 affect the user's consent or terminal outcome.
