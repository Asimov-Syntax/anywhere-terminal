# Review Round 4

- Date: 2026-09-01
- Cycle: 3
- Mode: discovery
- Requested lane: fastlane
- Scope: range `4e7443c4..HEAD`; tasks 2_1 through 2_5 only, using the approved D6-D9 change context
- Head: `f026c306c12381aac9310d28971cab7b630f253e` (working tree dirty from generated `asimov/changes/render-the-removal-assessment-as-a-report/analytics.json`, outside the reviewed range)
- Master session: `649500f6-d2af-47ae-ba3d-6351c690ebca`
- Reviewable lines: 402
- Agents spawned:
  - `asm-review-data-security` — removal authority and stale-target boundary — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — async removal flow, errors, and races — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — assessment wire contract and D6-D9 conformance — `sonnet[1M]`
  - `asm-review-frontend` — report UI state and dialog lifecycle — `gpt-5.6-luna[1M]`
  - `asm-review-reuse` — assessment reuse seams — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-performance` — no persistence, growing collection, list/query endpoint, recomputation loop, or hot-path scale axis was introduced
- Verdict: BLOCK
- Counts: 1 BLOCK, 2 WARN, 0 SUGGEST
- Split over gating blockers: 1 feature / 0 machinery
- Verify evidence: `bun run asm change verify-status render-the-removal-assessment-as-a-report` records tasks 2_1 through 2_5 at exit 0; the build gate records clean type checking, 6243/6243 tests, the filesystem-deletion gate, and the byte-identical Biome baseline. Review ran no project verify commands.

## Findings

### B3

- ID: B3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, corroborated by chair
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1739`
- Title: A stale cached registration can mint authority for its replacement
- Evidence: The new `worktreeRemoveAssess` branch calls `assessRemovalReport` directly. Unlike the existing removal path, it does not enter `withTarget`, whose coordinator forces an authoritative repository rebuild before resolving the target. Production `assessRemoval` therefore starts from `locate(target.worktreeId)` in the current cache (`WorktreeHost.ts:3056`) and only checks whether the repository observation changes while its reads are in flight (`WorktreeHost.ts:3116`). If an external remove-and-recreate at the same path has already happened while the watcher rebuild is still pending, the observation remains unchanged: the assessment keeps the old cached `WorktreeInfo` but reads status, sessions, panes, ignored material, and proofs from the replacement directory. `assessRemovalReport` then issues a fingerprint over that replacement evidence at `worktreeMutationService.ts:426-428`. Confirmation enters the ordinary mutation coordinator, rebuilds, resolves the replacement, re-reads the same evidence, and can redeem the token because fingerprints are keyed by `worktreeId` plus evidence, not the cached registration that the report described. The deliberate decision not to use `perform` explains why the read must not publish a mutation result; it does not supply an equivalent freshness or identity boundary before deletion authority is minted.
- Impact: The report can display the old worktree's row/branch identity while granting force authority over a newly registered worktree at the same path. Confirming can delete a different worktree from the one the user believed they assessed.
- SuggestedFix: Keep the request read-only and separate from `perform`, but give authority-bearing assessment an equivalent freshness/identity boundary: for example, a read-only coordinator lane that serializes with mutations, rebuilds, resolves, assesses, and returns without publishing a mutation result. Alternatively prove a durable incarnation identity and bind both the response and fingerprint to it. Reject the response if that identity changes before posting. Add a deferred-watcher replacement test that proves a stale cached row cannot produce an assessed response or redeemable fingerprint for its replacement.
- Status: open
- Triage: Confirmed. This is introduced by the new direct assessment door: the prior blocked-report path acquired the coordinator's forced-rebuild boundary before it assessed and issued authority. D6's no-mutation-result requirement is preserved by a dedicated read-only path; bypassing `perform` cannot also bypass target freshness when the read mints a force token.
- Invariant: Deletion authority must be issued for the same worktree incarnation the report identifies, never merely for whichever registration later occupies the same normalized id.
- Boundary inventory:
  - Affected: watcher rebuild pending before assessment; same-path remove-and-recreate; evidence read from the replacement under the old cached row; force redemption after confirmation rebuild.
  - Verified safe: target unresolved at request time posts nothing; repository observation changing during the assessment produces an unavailable result; detached surfaces receive no reply; redemption still rejects evidence growth for the same target.
- Author status: accepted
- Author triage: Accepted, and verified independently of the report. `worktreeMutationService.ts:340` already names this exact hazard in its own words for mutations — "a queued mutation that resolved on arrival would act on a path whose registration may have been replaced while it waited, which for a forced removal means deleting a different worktree than the one confirmed" — and closes it by carrying the id through the coordinator's forced rebuild. D6 rejected `perform` for a real reason (the rebuild gate and the mutation-result publication), but it took the freshness boundary out with it, and D7 then mints force authority on that unbounded read. The finding is introduced by this range. NOT fixed in this cycle: the remedy mints a new invariant owner — a freshness-and-identity discipline for authority-bearing reads — which the remediation boundary sends to `asimov-plan`, and cycle 3 makes that mandatory rather than optional.

### W4

- ID: W4
- Severity: WARN
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-frontend`, corroborated by chair
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeController.ts:1342`
- Title: Assessment replies are not bound to the live remove intent
- Evidence: The request/reply carries only `worktreeId`; the controller holds no pending request generation or active remove-intent token. Every assessed reply that still has a row calls `openRemoveReport`, and `WorktreeView.openRemoveDialog` first invokes the one global `closeDialog`. A slow earlier assessment can therefore land after a newer remove request or after the user opened a create, launch, prune, or other removal dialog, close that newer dialog, and replace it with the obsolete report. The `unavailable` arm exposes the second boundary: if its row left while the read was pending, `showActionResult` re-scopes it by removing `worktreeId`, but `WorktreeView` still renders Retry and `onRetryAction` silently does nothing when the id is absent.
- Impact: A stale reply can discard a current form or draft and replace the user's latest destructive target with an earlier one. A stale unavailable reply can instead leave a visible recovery control that cannot recover. Fingerprint redemption still prevents forged risk authority, but it does not preserve the user's current interaction or target selection.
- SuggestedFix: Add a per-surface assessment request token/sequence, echo it in the reply, and accept a response only while it matches the controller's live remove intent. Invalidate it when a newer removal is asked, another dialog supersedes it, the target leaves, the surface/controller is disposed, or the intent is canceled. Render Retry only while the target remains resolvable.
- Status: open
- Triage: Confirmed and merged from the logic specialist's out-of-order and stale-retry reports plus the frontend specialist's cross-dialog reproduction. One invariant and one missing lifecycle owner cause both boundaries.
- Invariant: An asynchronous assessment response may alter the UI only while it still answers the live remove intent and a live target.
- Boundary inventory:
  - Affected: two remove requests completing out of order; an assessment completing after another dialog opens; an unavailable assessment completing after its row departs.
  - Verified safe: an assessed reply for an already absent row is dropped; a reply after surface detach is dropped host-side; the dialog itself disposes after confirm/cancel and prevents a second click on that instance.
- Author status: accepted
- Author triage: Accepted. The same family as B3 — an answer outliving the question it answered — but owned on the webview side, and the `openRemoveDialog` single-`closeDialog` reproduction is concrete rather than theoretical. The inert Retry is a second, cheaper witness of the same missing lifecycle. Handed back with B3 rather than patched here: a request token echoed through the wire is a contract change, and inventing one inside a fix round is what the remediation boundary forbids.

### W5

- ID: W5
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-logic`, corroborated by chair
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1748`
- Title: Assessment exceptions disappear instead of reaching the retry surface
- Evidence: `assessRemovalReport` is asynchronous and production assessment awaits a `Promise.all` of filesystem, process, registry, pane, and proof reads. If that capability rejects rather than returning its typed `unavailable` arm, the new host branch catches the rejection and posts nothing. The controller can only render D8's non-destructive retry notice when it receives `worktreeRemoveAssessment.result.kind === "unavailable"`; this catch creates no reply or result at all.
- Impact: A failed read can make Remove Worktree appear inert. Nothing is deleted, but the user is not told that assessment failed and receives no retry path.
- SuggestedFix: Convert assessment rejection into a safe discriminated unavailable/error reply for the originating live request, with a generic unreadable reason, and cover a rejecting capability in the host action tests.
- Status: open
- Triage: Confirmed. Silence is fail-closed for deletion but violates the accepted recoverable unavailable flow and leaves the user's explicit action unanswered.
- Author status: accepted
- Author triage: Accepted. The catch was written deliberately — inventing an empty report would render a worktree of unknown risk as one with none — but the conclusion drawn from that was wrong: the choice is not between a false report and silence, it is between a false report and the `unavailable` arm D8 already defines. Handed back rather than fixed because the honest reply needs a decision this change's design does not carry: `unavailable` promises a NAMED list of failed reads and a rejection has no source to name, so either the payload gains an unnamed-failure shape or D8's promise is weakened. That is a `D#`, not a patch.

## Rejected specialist candidate

### B4

- ID: B4
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-reuse`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/worktreeMutationService.ts:426`
- Title: Risk-gated fingerprint issuance is duplicated between assessment and blocked removal
- Evidence: The specialist observed that both paths call the same `atRisk` function and the same `fingerprints.issue` operation in separate branches.
- Impact: Proposed impact was future drift if one branch changes without the other.
- SuggestedFix: Extract one local helper used by both branches.
- Status: rejected
- Triage: No current behavioral divergence exists: both branches invoke the single shared `atRisk` predicate and the same store call, exactly the construction D7 and task 2_2 require. The accepted design requires one predicate and one authority rule, not a particular helper extraction. Future drift without present mismatched behavior is not a HIGH-confidence BLOCK; keep the focused parity tests rather than inventing a gating refactor obligation.

## Prior resolution retained

- Round-3 B1 is fixed by this range at its invariant witness: the menu now asks through `worktreeRemoveAssess`, the clean assembled path records no git removal before the report is answered, and null authority returns through the unforced re-evaluating path.
- Prior B2 and W1-W3 remain fixed; tasks 1_1 through 1_7 were outside this range and were not re-reviewed.
- No prior `audit-backlog` or `risk-accepted` entries exist to carry forward.

## Full-flow trace

- Clean: menu ask -> cached target gate -> assessment -> assessed/null reply -> ordinary report -> unforced confirmation -> coordinator rebuild/re-resolve/re-assess -> remove only if still clean.
- Risky: menu ask -> assessment -> at-risk fingerprint -> typed report -> forced confirmation -> coordinator rebuild/re-resolve/re-assess -> one-shot fingerprint redemption -> remove or reprompt.
- Refused: assessed/null reply -> refusal-class report -> no confirmation control.
- Unavailable: discriminated reply -> non-destructive notice -> retry re-asks; W4 and W5 cover the stale-target and thrown-read gaps.
- Missing/notApplicable: assessed/null reply -> ordinary report -> unforced path prunes only after re-evaluation.
- Surface detach: host drops the response; no destructive call is reached.
