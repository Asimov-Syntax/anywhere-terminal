# Review Round 6

- Date: 2026-09-01
- Cycle: 4
- Mode: discovery
- Requested lane: fastlane
- Scope: range `f026c306..HEAD`; approved D10-D12, tasks §3, the assess token contract, and their implementation as one cumulative remediation slice
- Head: `965aeff4cd18288942d44446cd4ecf3bec38e638` (working tree dirty from generated `asimov/changes/render-the-removal-assessment-as-a-report/analytics.json`, outside the explicit reviewed range)
- Reviewable lines: 389
- Agents spawned:
  - `asm-review-data-security` — deletion authority and freshness parity — `opus[1M]`
  - `asm-review-logic` — queue ordering, error paths, and reply liveness — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — token wire contract and D10-D12 conformance — `sonnet[1M]`
  - `asm-review-frontend` — live intent and dialog lifecycle — `gpt-5.6-terra[1M]`
  - `asm-review-performance` — shared queue growth and starvation — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-reuse` — no new helper, parser, validator, split, or duplicated repository capability in the remediation range
- Verdict: BLOCK
- Additional review input: independent oracle attack forwarded before final adjudication
- Counts: 1 BLOCK, 1 WARN, 1 SUGGEST
- Split over gating blockers: 1 feature / 0 machinery
- Verify evidence: the build record supplied for this Head reports clean type checking, 6254/6254 tests, the filesystem-deletion gate, the pre-existing Biome 3/14/1 baseline, and `asm change verify-status` exit 0 for all 16 tasks. Review ran no project verify commands.

## Findings

### B5

- ID: B5
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-performance`, corroborated by chair and independent oracle
- Class: feature
- File: `src/worktree/worktreeMutationService.ts:442`
- Title: Superseded assessments can accumulate without bound in the shared mutation queue
- Evidence: Every `assessRemovalReport` now enters `coordinator.run`, and `createKeyedSerialQueue` deliberately appends every call rather than coalescing it. The webview guard at `WorktreeController.ts:1360` drops only when the one currently-live request names the same worktree. A request for A followed by B replaces `liveAssess` with B; another request for A is then admitted, so alternating two rows enqueues A, B, A, B indefinitely. Separate surfaces have separate controllers and admit their own copies too. Superseded tokens prevent obsolete replies from opening dialogs, but they do not cancel or skip the already-enqueued host work. Each obsolete job still holds the per-repo queue across two forced rebuilds plus status/proof reads with a 10 s timeout and the ignored scan with a 1.5 s bound.
- Impact: The queue retains an uncapped number of assessment closures and runs all of them before later lock, unlock, remove, prune, or create work for the same repository. A burst of alternating clicks can delay an irreversible removal or other mutation by the cumulative worst-case cost of every obsolete assessment, directly falsifying D10's ledger claim that assessment bursts cannot back up the mutation queue.
- SuggestedFix: Put the bound at the host/service queue boundary, not only in one controller: coalesce or supersede pending assessments per surface/repository, skip a queued assessment whose token is no longer current before it takes the expensive barrier and reads, and/or give mutations priority over obsolete reads. The enforced bound must cover alternating worktrees and multiple surfaces, not only consecutive same-row clicks.
- Status: open
- Triage: New in round 6. The growth axis is requests per repository; it is not structurally capped because two worktree ids can alternate forever and every surface owns an independent guard. The queue is intentionally non-coalescing, so this is enforced accumulation rather than a theoretical scheduler concern. Gating because the accepted backlog-control obligation is false and the shared queue carries every destructive mutation.
- Invariant: Read-only assessment traffic must have a structural pending-work bound, so a mutation is never placed behind an arbitrarily large obsolete assessment backlog.
- Boundary inventory:
  - Affected: alternating requests for two worktrees in one controller; requests from multiple surfaces; stale-token jobs already queued; mutations queued behind assessment traffic.
  - Verified safe: consecutive duplicate requests for the same worktree in one controller are dropped; each individual read has time bounds; repositories use independent queues.
- Author status: accepted
- Author triage: Accepted, and it refutes an obligation I wrote rather than merely finding a gap
  around it. D10's backlog control is `beginAssess`, and I keyed it on the ONE live worktree id, so
  alternating two rows defeats it by construction — my own test at `WorktreeController.test.ts:3142`
  walks A→A only, which is exactly why I did not see it. An independent oracle attack on the same
  range reported this before the round closed and I forwarded it here rather than patching it.
  NOT fixed in this cycle, for two independent reasons either of which is sufficient: the
  remediation boundary (the accepted D10 claim "a burst cannot back up the mutation queue" is false,
  so this needs a changed `D#`, and the finding's own invariant — a structural pending-work bound on
  read traffic sharing a mutation queue — is an owner this change does not have), and the cycle cap,
  this being cycle 4. Handed back to `asimov-plan`.

### W6

- ID: W6
- Severity: WARN
- Confidence: HIGH
- Priority: P1
- Agent: independent oracle, corroborated by chair
- Class: feature
- File: `src/webview/worktree/WorktreeController.ts:1359`
- Title: A dropped host reply can strand the same-row assessment slot
- Evidence: `beginAssess` stores `liveAssess` before posting and rejects every later request for the same worktree until that slot is cleared. The host calls `surface.post` on every internal exit, but the production adapters at `TerminalViewProvider.ts:1659-1666` and `TerminalEditorProvider.ts:1132-1139` are fire-and-forget: they ignore a fulfilled `false` and swallow asynchronous rejection. The controller therefore receives no completion signal when transport drops the reply. A request for A whose reply is lost leaves Remove on A suppressed until some different request or dialog happens to clear the slot.
- Impact: Remove Worktree can remain dead for that row indefinitely after a transient delivery failure, even though the controller and surface remain alive; recovery requires an unrelated dialog or different-row request. D12's host-local one-reply rule does not establish the end-to-end lifetime D10's duplicate suppression depends on.
- SuggestedFix: Give `liveAssess` a bounded end-to-end lifetime independent of successful delivery — for example, expire the slot after the assessment budget plus transport margin while continuing to reject the late token — or send this critical reply through an acknowledged/retrying transport. Cover fulfilled `false`, rejected delivery, and a later same-row retry.
- Status: open
- Triage: New in round 6 from the forwarded oracle attack. Kept separate from W4: W4 was stale replies outliving an intent; this is the inverse, an intent outliving a reply the transport dropped. Non-gating because another dialog or different-row request recovers the surface and no deletion authority is exposed, but the primary same-row action can remain inert indefinitely.
- Author status: accepted
- Author triage: Accepted. Closing every host exit in task 3_3 did not make "one live request, one reply" true end to end; the production transport can still drop it. Handed back with B5 because the pending-work bound and request lifetime must be designed together rather than patched on opposite sides of the boundary.

### S2

- ID: S2
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P3
- Agent: independent oracle, corroborated by chair
- Class: feature
- File: `src/extension.worktreeAssembly.test.ts:803`
- Title: The assembly witness proves barrier refresh, not remove-and-recreate deletion safety
- Evidence: The fake keeps one stable registered path and models the alleged replacement only by setting `lockedRow = true`; nothing removes or recreates a registration. The test never calls the watcher's `deliver()`, so `watchers.length > 0` proves a watcher exists rather than that an event is pending, and the walk ends after the typed report opens without confirming or observing which registration git removes. Bypassing the barrier still fails the test, so it is a real causal proof of the narrower task Acceptance outcome: the assembled assess reads the listing the barrier refreshed.
- Impact: The test title, comments, task title, and commit message overstate what the assembly layer proves. A later regression in a real same-path replacement/confirmation walk would not be caught by this witness, although the production barrier behavior and narrower Acceptance remain covered.
- SuggestedFix: Either narrow the test prose to the behavior it proves, or extend the fake to hold two registration generations, a genuinely pending watcher event, and a confirmation assertion showing the predecessor's report cannot remove the replacement.
- Status: open
- Triage: Non-gating. The witness is not vacuous and task 3_4's Acceptance outcome is satisfied; this is proof-strength debt, not evidence that the production fix is wrong. It does not require a planning handback on its own.

## Rejected specialist candidate

### S1

- ID: S1
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: `asm-review-data-security`
- File: `src/providers/WorktreeHost.ts:1755`
- Title: A delivery failure is caught as though the assessment itself failed
- Status: rejected
- Triage: The candidate assumes production `surface.post` can throw into the assessment promise chain. Both production adapters catch synchronous throws and swallow asynchronous rejection inside `safePostMessage`, so that path does not reach this `.catch()`. The real transport defect is W6: delivery failure is hidden from both host and controller, not misclassified by this catch.

## Prior findings adjudicated

- **B3 fixed.** `coordinator.run` forces the rebuild barrier before resolve and assessment, so the exact stale-cache-before-assessment witness now starts from the registration the barrier revealed. The service test holds the barrier unresolved and proves neither resolve nor assess runs; the unit replacement witness and assembled deferred-watcher witness both fail if the barrier is bypassed. The replacement-during-the-assessment-reads window is a different mechanism shared with the unchanged blocked→force path; D10 states that residual rather than claiming to close it.
- **W4 fixed.** Every production assess request mints a token, every reply arm echoes it, the controller accepts only the live token, every actual dialog opener invalidates it (including the view-owned blocked-result opener), and re-scoped unavailable notices offer no inert Retry. The same-worktree and view-owned-opener falsifiers exercise the boundaries an id-only guard missed.
- **W5 fixed.** Rejected assessments and coordinator-missing/null exits produce one typed `unavailable` answer while a live surface exists; detached surfaces receive none. The pre-flight answer is a valid D12 conformance extension rather than an overreach: without it the same-row duplicate guard could retain a request that will never answer.
- **B4 remains rejected.** Both authority paths still call the shared `atRisk` predicate and fingerprint store; no behavioral divergence supports reopening it.

## Full-flow trace

- Menu assess: Remove click → controller token → host pre-flight → per-repo coordinator queue → forced rebuild/broadcast → re-resolve → assessment and optional fingerprint → post-attempt rebuild/broadcast → token-checked reply → report → nullable-fingerprint confirmation → ordinary or forced removal coordinator path.
- Supersession: a newer request or any actual dialog opening retires the live token; stale replies are discarded. The host work itself is not retired, which is B5.
- Unavailable: missing target, null capability result, or assessment rejection → non-destructive unavailable reply → live-target Retry re-asks; departed target is re-scoped and offers no Retry. Transport delivery is not acknowledged, so a dropped reply strands the same-row slot (W6).
- Blocked-result entry: mutation result notice → view-owned Force remove opener → `onDialogOpened` invalidates any outstanding assess → shared report dialog.
- Lock order: assess takes mutationQueue then rebuildGate. The rebuild callback rebuilds cache, reconciles fingerprints synchronously, and projects/broadcasts; it never awaits the mutation queue, so no queue↔gate cycle was found.
- Authority: request token only orders UI answers. Fingerprint remains the sole force authority, is minted after the freshness barrier, and is re-evaluated/redeemed on the removal path.

## Inline support review

- New tests contain no `.only`/`.skip`; asynchronous gates and rejections are awaited.
- The barrier witness is non-vacuous because it asserts no resolve/assessment while the rebuild promise is held.
- The assembly witness is non-vacuous for barrier refresh, but it models the alleged replacement only by changing a lock bit, proves watcher existence rather than a pending event, and never confirms a deletion; S2 records the overclaim.
- The token tests kill the id-only implementation on same-worktree ordering and on the view-owned opener; the Retry and host rejection tests exercise their real production doors.
