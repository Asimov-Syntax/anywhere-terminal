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
- Agent: `asm-review-performance`, corroborated by chair
- Class: feature
- File: `src/worktree/worktreeMutationService.ts:442`
- Title: Superseded assessments can accumulate without bound in the shared mutation queue
- Evidence: Every `assessRemovalReport` now enters `coordinator.run`, and `createKeyedSerialQueue` deliberately appends every call rather than coalescing it. The webview guard at `WorktreeController.ts:1360` drops only when the one currently-live request names the same worktree. A request for A followed by B replaces `liveAssess` with B; another request for A is then admitted, so alternating two rows enqueues A, B, A, B indefinitely. Separate surfaces have separate controllers and admit their own copies too. Superseded tokens prevent obsolete replies from opening dialogs, but they do not cancel or skip the already-enqueued host work. Each obsolete job still holds the per-repo queue across two forced rebuilds plus status/proof reads with a 10 s timeout and the ignored scan with a 1.5 s bound.
- Impact: The queue retains an uncapped number of assessment closures and runs all of them before later lock, unlock, remove, prune, or create work for the same repository. A burst of alternating clicks can delay an irreversible removal or other mutation by the cumulative worst-case cost of every obsolete assessment, directly falsifying D10's ledger claim that assessment bursts cannot back up the mutation queue.
- SuggestedFix: Put the bound at the host/service queue boundary, not only in one controller: coalesce or supersede pending assessments per surface/repository, skip a queued assessment whose token is no longer current before it takes the expensive barrier and reads, and/or give mutations priority over obsolete reads. The enforced bound must cover alternating worktrees and multiple surfaces, not only consecutive same-row clicks.
- Status: open
- Triage: New in round 6. The growth axis is requests per repository; it is not structurally capped because two worktree ids can alternate forever and every surface owns an independent guard. The queue is intentionally non-coalescing, so this is enforced accumulation rather than a theoretical scheduler concern. Gating because the accepted backlog-control obligation is false and the shared queue carries every destructive mutation.
- Invariant: Read-only assessment traffic must have a structural pending-work bound and must not indefinitely delay mutations sharing its repository queue.
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

### S1

- ID: S1
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: `asm-review-data-security`
- Class: feature
- File: `src/providers/WorktreeHost.ts:1755`
- Title: A delivery failure is caught as though the assessment itself failed
- Evidence: The new `.catch()` is attached after `.then()`, so it catches both a rejected `assess(...)` and a throw from the successful-result `surface.post(...)`. This host already treats `surface.post` as throw-capable in `postTo`. A successful assessment post that throws therefore enters the D12 catch and tries to send `unavailable: ["the assessment"]`; if that second direct post throws, the rejection escapes the voided chain.
- Impact: A transient delivery failure can be described as a failed assessment and provoke another expensive retry while an undelivered fingerprint remains stored until expiry. A repeated delivery failure can also surface as an unhandled rejected promise. No force authority is disclosed, so this is non-gating.
- SuggestedFix: Attach rejection handling to `assess(...)` itself (`then(onResult, onReject)` or an earlier catch), and use one throw-tolerant reply helper for both result arms.
- Status: open
- Triage: Kept as a suggestion. It is a real changed-chain distinction, but delivery failure reveals no fingerprint and cannot authorize deletion.
- Author status: accepted
- Author triage: Accepted as non-gating, and carried into the handback rather than auto-fixed here —
  the tree is parked, so landing it now would be a commit outside any lease. It also sits next to a
  liveness hazard the oracle raised that this finding does not fully cover: both production surface
  adapters are fire-and-forget (`TerminalViewProvider.ts:1659-1666`,
  `TerminalEditorProvider.ts:1132-1139`) and swallow a fulfilled `false` or a rejection, so a
  transient delivery failure strands `liveAssess` and kills that row's Remove for good. Closing every
  HOST exit in 3_3 did not make "one live request, one reply" true end to end, as I claimed it did;
  the transport can still drop it. Both belong with B5's redesign, since a pending-work bound and a
  request lifetime that survives a dropped reply are the same question asked twice.

## Prior findings adjudicated

- **B3 fixed.** `coordinator.run` forces the rebuild barrier before resolve and assessment, so the exact stale-cache-before-assessment witness now starts from the registration the barrier revealed. The service test holds the barrier unresolved and proves neither resolve nor assess runs; the unit replacement witness and assembled deferred-watcher witness both fail if the barrier is bypassed. The replacement-during-the-assessment-reads window is a different mechanism shared with the unchanged blocked→force path; D10 states that residual rather than claiming to close it.
- **W4 fixed.** Every production assess request mints a token, every reply arm echoes it, the controller accepts only the live token, every actual dialog opener invalidates it (including the view-owned blocked-result opener), and re-scoped unavailable notices offer no inert Retry. The same-worktree and view-owned-opener falsifiers exercise the boundaries an id-only guard missed.
- **W5 fixed.** Rejected assessments and coordinator-missing/null exits produce one typed `unavailable` answer while a live surface exists; detached surfaces receive none. The pre-flight answer is a valid D12 conformance extension rather than an overreach: without it the same-row duplicate guard could retain a request that will never answer.
- **B4 remains rejected.** Both authority paths still call the shared `atRisk` predicate and fingerprint store; no behavioral divergence supports reopening it.

## Full-flow trace

- Menu assess: Remove click → controller token → host pre-flight → per-repo coordinator queue → forced rebuild/broadcast → re-resolve → assessment and optional fingerprint → post-attempt rebuild/broadcast → token-checked reply → report → nullable-fingerprint confirmation → ordinary or forced removal coordinator path.
- Supersession: a newer request or any actual dialog opening retires the live token; stale replies are discarded. The host work itself is not retired, which is B5.
- Unavailable: missing target, null capability result, or assessment rejection → non-destructive unavailable reply → live-target Retry re-asks; departed target is re-scoped and offers no Retry.
- Blocked-result entry: mutation result notice → view-owned Force remove opener → `onDialogOpened` invalidates any outstanding assess → shared report dialog.
- Lock order: assess takes mutationQueue then rebuildGate. The rebuild callback rebuilds cache, reconciles fingerprints synchronously, and projects/broadcasts; it never awaits the mutation queue, so no queue↔gate cycle was found.
- Authority: request token only orders UI answers. Fingerprint remains the sole force authority, is minted after the freshness barrier, and is re-evaluated/redeemed on the removal path.

## Inline support review

- New tests contain no `.only`/`.skip`; asynchronous gates and rejections are awaited.
- The barrier witness is non-vacuous because it asserts no resolve/assessment while the rebuild promise is held.
- The assembly witness asserts that a watcher exists and no listing rebuild landed before the click before checking the typed replacement report.
- The token tests kill the id-only implementation on same-worktree ordering and on the view-owned opener; the Retry and host rejection tests exercise their real production doors.
