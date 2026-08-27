# Review Round 4

- Date: 2026-08-27
- Cycle: 1
- Round: 4
- Mode: verification
- Extension: one bounded extension round after the round-3 thrash stop
- Scope: commit `22ae8a37ce6c54be0117035f4d0e110cd5234e1b` only
- Head: `22ae8a37ce6c54be0117035f4d0e110cd5234e1b` (explicit commit scope; before this artifact was written the working tree had changes only in `.analytics-cursor.json` and `analytics.json` for this change)
- Change context: `launch-agent-in-worktree` — Gate 2 approved
- Scope lock: passed — the explicit commit contains only the stated B1/B5/W6 remediation, focused tests, and review/build/task metadata. Merge `266ef86` is an ancestor but is outside this commit-only diff.
- Reviewable lines: 178
- Agents spawned:
  - asm-review-logic — asynchronous offer and worktree identity handoffs — `gpt-5.6-sol[1M]`
  - asm-review-contracts — launch admission, wire, and final-target contracts — `gpt-5.6-terra[1M]`
  - asm-review-frontend — rendered offer ownership and dialog lifecycle — `sonnet[1M]`
- Agents skipped:
  - asm-review-data-security — no new data/auth/storage boundary beyond the admission contract covered by contracts and logic
  - asm-review-performance — no collection growth, recompute, or hot-path change in this remediation cone
  - asm-review-reuse — no new extraction or duplicated capability decision in this remediation cone
- Verdict: REJECT
- Counts: 3 BLOCK | 1 WARN | 0 SUGGEST
- Verification evidence: `bun run asm change verify-status launch-agent-in-worktree` reports tasks 1_1 through 6_3 at exit 0. The author records type check clean, 4,368 tests passing, and Biome check-mode clean apart from five pre-existing findings in untouched files. No project verify command was run during review.
- Thrash stop: the bounded extension did not clear the blockers. Do not continue this cycle with another patch-verification round; hand the unresolved identity design back to planning/rework.

## Findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts, asm-review-logic, asm-review-frontend
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:297`
- title: Open launch-capable dialogs quote a newer offer than the one they rendered
- evidence: `openLaunchFor()` passes the current `launchAgents` snapshot into the launch dialog, and the create dialog is likewise seeded from `createRepos()`. `handleLaunchTargets()` can later replace both `launchAgents` and the mutable controller-wide `launchOfferId`. Neither open dialog receives the new agent snapshot, but menu submission reads the live `launchOfferId` at line 297 and create-with-launch reads it at line 346. A visibility round trip legitimately requests another start answer while the dialog remains mounted. An action selected from offer A can therefore be posted with offer B's id and pass the host's current-offer check whenever its fields are also admissible under B, even though B was never rendered in that dialog.
- impact: The host-side token check is bypassed by the controller relabelling stale rendered state with a current identity. Both fresh-launch entry paths still admit an overlapping refresh/action against an answer the user did not choose from, so the issued-answer invariant remains open.
- suggestedFix: Capture `{offerId, agents}` as one immutable context when each launch-capable dialog opens and submit that captured id, or dismiss/invalidate the open dialog when a newer answer arrives. Add controller-level tests that open menu launch and create under offer A, deliver offer B, then submit and prove the request still quotes A and is refused, or that the dialog was closed.
- status: open
- triage: persists from rounds 1–3. `22ae8a3` closes host-side absent/stale quote admission but does not carry the identity with the rendered UI state across the user-interaction boundary. Severity remains BLOCK because the accepted exact-answer invariant and affected overlapping-refresh boundary are unchanged.
- invariant: A fresh launch may execute only values in the authoritative start-target set issued to and rendered by the requesting surface for that action.
- boundary inventory:
  - affected: launch dialog open across a new start-target answer; create dialog open across a new start-target answer; visibility-driven refresh while either dialog remains mounted
  - verified safe: host rejects absent ids, manually stale ids, never-answered surfaces, and undelivered superseding posts; host admission shares the same check for standalone and create-with-launch; `continue` remains separate

### B5

- ID: B5
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:980`
- title: Fresh launch captures the selected incarnation after asynchronous admission
- evidence: `worktreeLaunchAgent` captures `path`, calls the `async` `admissibleLaunch()`, and enters `launch()` only from its promise continuation. `launch()` does not capture `asked = incarnationOf(worktreeId)` until line 1019. An already in-flight forced rebuild can replace the worktree at that id between the request and that continuation; `launch()` then records the replacement as the requested incarnation. The resolver still starts from the pre-admission path, while the final cwd overwrite targets the replacement's current path.
- impact: Fresh launch can hand a session to a replacement worktree that became current during the admission boundary. The final guard protects only changes after `launch()` begins, not every asynchronous eligibility/resolution boundary required by B5.
- suggestedFix: Capture the expected worktree identity before invoking `admissibleLaunch()` and pass it into `launch()`. Require it before starting executable resolution and again at final handoff, resolving cwd only from the identity-checked current record. Add a test with a replacement completing while admission is pending, before `startAgent()` begins.
- status: open
- triage: persists from rounds 2 and 3 with a newly isolated earlier boundary. `22ae8a3` closes disappearance/replacement during resolver execution, but its “read BEFORE the awaits” occurs after fresh launch's admission promise boundary.
- invariant: A worktree-scoped launch must carry the selected worktree identity across every asynchronous eligibility and resolution boundary through the final side-effect handoff.
- boundary inventory:
  - affected: standalone fresh launch when the cached registration changes while admission is pending
  - verified safe: Resume Here captures before its resolver; fresh and Resume Here disappearance after `launch()` begins; changed-head/branch replacement during resolver execution; final cwd is re-resolved

### B6

- ID: B6
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:639`
- title: Head and branch are not the required same-id replacement identity
- evidence: `incarnationOf()` returns only `${head}:${branch}`. A worktree removed and recreated at the same normalized id on the same branch and commit produces the same value, so line 1027 admits the replacement for both fresh launch and Resume Here. The repository's own `worktreeFingerprint.ts:20-26` documents that `head:branch` repeats in exactly this case and is not an incarnation binding. The new `recreate()` test avoids the collision by deliberately changing HEAD before rebuilding. Task 6_3's approved Acceptance is unconditional: “a worktree recreated at the same id ... launches nothing.”
- impact: The stated B5 fix still allows a different registration to receive the launch whenever its branch and commit match the selected one. This directly violates the no-replacement acceptance case; documenting the limitation is not a user-granted risk acceptance.
- suggestedFix: Use a host-owned generation that changes whenever continuity across a cache rebuild cannot be proven, and fail closed on an intervening rebuild rather than treating `head:branch` as identity. Add fresh and Resume Here tests that rebuild a same-id replacement with unchanged head and branch.
- status: open
- triage: new finding inside B5's explicit replacement impact cone and the author's impact manifest. It is separate from B5 because the causal mechanism is token collision rather than late capture.
- invariant: A same-id replacement must not inherit a pending launch authorization from the prior registration.
- boundary inventory:
  - affected: fresh launch and Resume Here when replacement preserves normalized id, head, and branch
  - verified safe: replacements that change head or branch; disappearance; current display path is re-resolved after a successful identity comparison

### W6

- ID: W6
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-contracts, asm-review-logic, asm-review-frontend
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeView.test.ts:882`
- title: Coverage closes modal stacking but not the remaining identity boundaries
- evidence: The commit adds host-level stale/no-offer tests, changed-HEAD fresh replacement, deferred Resume Here disappearance, and a WorktreeView modal-supersession case. It adds no WorktreeController test that carries a concrete offer id through either real submission path, no open-dialog offer-A/offer-B overlap case, no replacement during fresh asynchronous admission, and no same-head/same-branch replacement case. Existing controller launch fixtures still omit `offerId`, so their expected posts do not exercise the new wire behavior.
- impact: The recorded suite can remain green with all three blocking identity defects above, as this commit demonstrates. The owner-level dialog lifecycle half of W6 is closed, but the asynchronous identity coverage requirement is not.
- suggestedFix: Add controller-level overlap cases for menu launch and create-with-launch, a fresh-launch replacement during admission, and same-head/same-branch replacement cases for fresh and Resume Here. Preserve the new WorktreeView supersession test.
- status: open
- triage: persists from rounds 2 and 3 with reduced scope. `22ae8a3` closes the requested WorktreeView owner test and several host boundaries, but not the exact causal paths still blocking B1/B5/B6.

## Prior sustained outcomes

- B3 — rejected/out of scope: `presenceProjector.ts` is outside this explicit commit; do not re-report in this cycle.
- B4 — rejected/out of scope: `runningSessions.ts` is outside this explicit commit; do not re-report in this cycle.
- W5 — rejected/out of scope: `worktreeRenderSignature.ts` is outside this explicit commit; do not re-report in this cycle.

## Audit backlog

### S1

- ID: S1
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: asm-review-reuse, asm-review-frontend
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/worktreeDialogShell.ts:38`
- title: Continue and worktree dialogs maintain parallel modal lifecycles
- evidence: The duplicated focus, Escape, disposal, and focus-restoration lifecycles predate the scoped implementation; `22ae8a3` changes only ownership coverage around the worktree dialog.
- impact: Lifecycle fixes can drift between dialog families, but this remediation does not introduce or worsen the duplication.
- suggestedFix: Consider a separate refactor that generalizes the worktree shell for Continue.
- status: audit-backlog
- triage: carried forward, non-gating

### AB1

- ID: AB1
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-frontend
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeView.ts:290`
- title: The prune dialog remains outside `closeDialog` ownership
- evidence: `openPruneDialog()` still opens its dialog without assigning the returned disposer. This path predates and is outside the scoped commit.
- impact: A later dialog can stack over an open prune confirmation and leave its listener/focus trap mounted.
- suggestedFix: Address prune dialog ownership in the change that owns that pre-existing path.
- status: audit-backlog
- triage: carried forward, non-gating

### AB2

- ID: AB2
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/LaunchBuilder.ts:234`
- title: Entry-backed Continue still ignores an explicit posture for a zero-choice agent
- evidence: `permissionArgs()` returns an empty list for an agent with no permission choices before consulting a supplied choice. This older Continue path is unchanged and outside the explicit commit.
- impact: The posture truthfulness rule is not universal across the older Continue path, but WT-005.3 did not introduce or worsen it.
- suggestedFix: In a change owning Continue admission, validate an explicit choice before the empty-choice fallback.
- status: audit-backlog
- triage: carried forward, non-gating

---

## Triage (author, round 4) — loop exhausted

The bounded extension round is spent, so this triage decides nothing on its own: it records
what I judge each finding to be worth, and the decision goes to the user.

### [B1] Open dialogs quote a newer offer than the one they rendered
**Status**: accepted — valid, and cheap
**Triage**: Correct. The dialog renders from a snapshot of `launchAgents` but submits with the
controller's live `launchOfferId`, so an answer arriving under an open dialog relabels the
user's earlier choice as current. The fix is to capture the offer id beside the agent list
when the dialog opens — a few lines in `WorktreeController`, no contract change.

### [B5] Fresh launch captures identity after asynchronous admission
**Status**: accepted — valid, and cheap
**Triage**: Correct, and it is my own sequencing error: `launch()` reads the incarnation, but
`launch()` is called from inside the admission `.then`, so "before the awaits" is only true of
the resolution await, not the admission one. Reading it at message receipt and passing it in
is a three-line change.

### [B6] `head:branch` is not a same-ID replacement identity
**Status**: accepted as a defect, REFERRED as a design question
**Triage**: The collision is real and I documented it rather than hid it — a recreate onto the
same commit and branch repeats the string. What the fix costs is the open question: "fail
closed on an intervening rebuild" refuses a launch whenever ANY rebuild lands between request
and handoff, and rebuilds here are driven by filesystem watches, so the cost is spurious
refusals during ordinary git activity. Choosing between a narrow residual race and a
user-visible refusal rate is a design decision, not a fix — it belongs to `asimov-plan`, which
is also what the chair recommends.

### [W6] Coverage omits the remaining identity boundaries
**Status**: accepted — follows whichever fix lands

### Where this leaves the change
Fifteen tasks verified, four rounds run, six findings closed and verified closed across
rounds 1–3 (B2, W1, W2, W3, W4, S2). What remains is one identity design question and two
small sequencing defects that hang off the answer to it.
