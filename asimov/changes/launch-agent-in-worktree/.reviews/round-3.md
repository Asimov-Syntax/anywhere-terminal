# Review Round 3

- Date: 2026-08-27
- Cycle: 1
- Round: 3
- Mode: verification
- Scope: commit `fa51ef950bb499bafb8b71333b855232e76ffade` only
- Head: `fa51ef950bb499bafb8b71333b855232e76ffade` (explicit commit scope; before this artifact was written the working tree had changes only in `.analytics-cursor.json` and `analytics.json` for this change)
- Change context: `launch-agent-in-worktree` — Gate 2 approved
- Scope lock: passed — the commit contains round-2 remediation, focused regression coverage, and review/build/task metadata; no new capability or semantically changed task/design contract was found
- Reviewable lines: 173
- Agents spawned:
  - asm-review-contracts — launch-target publication, admission, and final worktree contract — `gpt-5.6-sol[1M]`
  - asm-review-logic — async launch resolution and handoff — `gpt-5.6-terra[1M]`
  - asm-review-frontend — provider routing and owner-level UI coverage — `sonnet[1M]`
  - asm-finder — launch-fix behavioral impact-cone trace — `gpt-5.6-luna[1M]`
- Agents skipped:
  - asm-review-data-security — no new data/auth/storage boundary beyond the admission contract covered by contracts/logic
  - asm-review-performance — no growth-axis or hot-path change in this remediation cone
  - asm-review-reuse — no new helper/extraction/duplication decision in this remediation cone
- Verdict: BLOCK
- Counts: 2 BLOCK | 1 WARN | 0 SUGGEST
- Verification evidence: `bun run asm change verify-status launch-agent-in-worktree` reports tasks 1_1 through 6_2 at exit 0. The author records type check clean, 4,349 tests passing, and Biome check-mode clean apart from five pre-existing findings in untouched files. No project verify command was run during review.

## Findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:691`
- title: Admission can advance to a launch-target answer the surface has not received
- evidence: `publishLaunchTargets()` writes the newly detected set into `publishedTargets` before calling `surface.post()`. `WorktreeSurface.post` returns `void`; the production implementation delegates to `TerminalViewProvider.safePostMessage()`, which suppresses synchronous throws and asynchronous rejection/false delivery. A refresh can therefore replace the authoritative admission set without a successfully delivered answer. Even on success, the snapshot changes before the webview handles the reply, so an overlapping stale or forged action is judged against a different answer than the controller currently holds. The new test at `WorktreeHost.actions.test.ts:1106` proves sequential detector drift only after `publishLaunchTargets()` has completed into a synchronous test surface; it does not exercise delivery failure or an overlapping refresh/action.
- impact: The per-surface ownership fixes the original independent re-probe, but it does not guarantee that admission uses the set actually answered to that surface. A previously offered value can be refused after an undelivered refresh, while a value from the not-yet-observed snapshot can be admitted. The round-1/round-2 issued-answer invariant remains open.
- suggestedFix: Version each published offer and require launch/create requests to echo the matching offer generation or opaque token. Commit or activate the new snapshot only on a delivery-aware path, retain the prior snapshot on failed delivery, and prevent an older concurrent publication from superseding a newer one. Add failed-delivery and overlapping refresh/action regression cases.
- status: open
- triage: persists from rounds 1 and 2; `fa51ef9` fixes sequential registry drift, per-surface separation, never-answered surfaces, and missing-capability fail-closed behavior, but not the delivery/observation boundary
- invariant: A fresh launch may execute only values in the authoritative start-target set issued to the requesting surface.
- boundary inventory:
  - affected: failed target-answer delivery; successful answer not yet observed by the webview; overlapping refresh/action; concurrent publications without an offer generation
  - verified safe: sequential registry drift before a refresh; separate surfaces; a surface never answered; absent `launchTargets` capability publishes/stores empty; detached surfaces cannot route actions because `handleMessage` requires attachment; standalone and create-with-launch share admission

### B5

- ID: B5
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts, asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:982`
- title: Final handoff checks worktree presence but still uses the pre-await resolution
- evidence: Fresh launch captures `path` at line 942 and Resume Here captures it at line 963, then each asynchronous resolver builds `CreateSessionOptions` from that pre-await value. At final handoff, `launch()` calls `actionPath(worktreeId, false)` only as an existence predicate and discards the returned current path; it neither compares `options.cwd` with the final path nor proves that the current record is the same worktree incarnation. A remove-and-recreate at the same normalized identifier, or a current display-path change for that identifier, passes the guard and hands the stale options to `surface.launchAgent`. The added deferred test covers disappearance for fresh launch only.
- impact: Both fresh launch and Resume Here can start in a replacement worktree occupying the identifier selected earlier, violating the accepted stale-worktree rule that no other worktree may be used in its place.
- suggestedFix: Capture an authoritative worktree incarnation/fingerprint with the initial resolution and require the same incarnation at final handoff. Re-resolve the final directory, require the resolved options to target it, and then invoke `surface.launchAgent` only from that validated result. Add deferred fresh-launch and Resume Here cases for both disappearance and remove/recreate replacement.
- status: open
- triage: persists from round 2 with a narrowed boundary; ordinary disappearance is fixed through the shared final presence check, but replacement/path drift still violates the same stale-resolution invariant and Resume Here lacks deferred coverage
- invariant: A worktree-scoped launch must resolve the same current worktree at the final side-effect handoff after every asynchronous eligibility/resolution boundary.
- boundary inventory:
  - affected: fresh launch and Resume Here when a worktree is removed/recreated at the same identifier or its current resolved display path changes during resolution
  - verified safe: unknown/missing worktree at request; ordinary disappearance before final handoff; create-after-launch uses the mutation service's newly created path; resolver/spawn errors are posted to the asking surface

### W6

- ID: W6
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-contracts, asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.actions.test.ts:1140`
- title: The new regression coverage still omits the remaining asynchronous boundaries
- evidence: The commit adds focused cases for sequential target drift, a never-answered surface, fresh-launch disappearance during deferred resolution, zero-choice posture refusal, templated executable failure, request deduplication, prompt max/count reset, and the launch dialog's returned disposer. It does not cover B1 answer-delivery failure or an overlapping refresh/action, B5 remove/recreate replacement, or deferred Resume Here. `WorktreeLaunchDialog.test.ts:43` proves the dialog factory returns a disposer, but no owner-level test exercises `WorktreeView.openLaunchDialog()` closing a prior modal or disposing it with the view.
- impact: The recorded suite can remain green while both open BLOCK invariants regress or while the accepted dialog ownership wiring is removed.
- suggestedFix: Add targeted cases for failed/overlapping target publication, fresh and Resume Here replacement during deferred resolution, and WorktreeView supersession/view disposal rather than only the dialog factory's disposer.
- status: open
- triage: persists from round 2 with reduced scope; most requested owner tests were added without weakening inherited assertions, but the uncovered boundaries align with B1/B5 and the owner-level dialog lifecycle

## Prior sustained outcomes

- B3 — rejected/out of scope: `presenceProjector.ts` remains untouched; do not re-report in this cycle.
- B4 — rejected/out of scope: `runningSessions.ts` remains untouched; do not re-report in this cycle.
- W5 — rejected/out of scope: `worktreeRenderSignature.ts` remains untouched; do not re-report in this cycle.

## Audit backlog

### S1

- ID: S1
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: asm-review-reuse, asm-review-frontend
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/worktreeDialogShell.ts:38`
- title: Continue and worktree dialogs maintain parallel modal lifecycles
- evidence: The duplicated focus, Escape, disposal, and focus-restoration lifecycles predate the scoped implementation; `fa51ef9` changes only tests around the worktree dialog.
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
- evidence: `openPruneDialog()` still opens its dialog without assigning the returned disposer. The prune implementation predates the scoped commits.
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
- evidence: `permissionArgs()` returns an empty list for an agent with no permission choices before consulting a supplied choice. This older Continue path is unchanged by `fa51ef9`; the fresh-start path is fixed.
- impact: The posture truthfulness rule is not universal across the older Continue path, but WT-005.3 did not introduce or worsen it.
- suggestedFix: In a change owning Continue admission, validate an explicit choice before the empty-choice fallback.
- status: audit-backlog
- triage: carried forward, non-gating

---

## Triage (author, round 3) — thrash stop

Round 3 ends with blockers, which is the thrash-stop condition. Of the three exits, this takes
**ONE bounded extension round**: both findings have a stated fix hypothesis, both reuse a
mechanism this repository already has, and neither grows the change's scope. Handing back to
plan would re-earn a gate for no design question, and neither blocker is a residual I would
ask the user to carry.

**Hypothesis.** Both are the same shape — a value captured on one side of an await and trusted
on the other — and both are closed by carrying an identity across it rather than a fact.

### [B1] Admission can advance to an answer the surface has not received
**Status**: accepted
**Triage**: Right that "the host published it" is not "the surface has it": a suppressed post,
or an action overlapping a refresh, leaves admission holding a set the panel never rendered.
The fix is the repository's own confirmation-token pattern (`worktreeFingerprint.ts`): each
answer carries an `offerId`, a launch echoes the one it was rendered from, and admission
requires the echo to match the offer that surface currently holds. Delivery failure then fails
CLOSED — the panel keeps an id the host has replaced, and its requests are refused — rather
than admitting against a set nobody saw.

### [B5] The handoff checks presence, not the same worktree
**Status**: accepted
**Triage**: Confirmed. `actionPath` answers "is something there", and remove-then-recreate at
the same normalized id answers yes for a different directory. The host already formulates an
incarnation for exactly this distinction in `mutationBindings.resolve`
(`${head}:${branch}`); the launch path now captures it at the request and requires it
unchanged at the handoff, and re-resolves the path rather than reusing the pre-await one.

### [W6] Regression coverage omits the remaining asynchronous boundaries
**Status**: accepted
**Triage**: Covered with the fixes — offer mismatch, a re-publish invalidating an in-flight
offer, remove-and-recreate at the same id, a deferred Resume Here, and `WorktreeView`'s dialog
supersession at its own owner.
