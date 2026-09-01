# Review Round 9

- Date: 2026-09-01
- Cycle: 6
- Mode: discovery
- Requested lane: fastlane
- Scope: range `7291cfd4bff224352a403445544d60cf6b190fbf..0467bf97e001e51271e957f71c0df31e6c63245a`; task 5_1, implementation `d72f0cbf`, verification `d3fa65d5`, and superseded round-8 record `0467bf97`
- Head: `0467bf97e001e51271e957f71c0df31e6c63245a` (working tree dirty only from generated `asimov/changes/render-the-removal-assessment-as-a-report/analytics.json` after round start)
- Reviewable lines: 70 production lines; changed scale tests reviewed inline
- Round extension: `asm review round-start` reused the user's original change-level FASTLANE instruction with `--user-approved`; no new user response was claimed
- Agents spawned:
  - `asm-review-performance` — unified report-lane bound, growth axis, and mutation ordering — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — lane concurrency, lifecycle, rejection, and re-enqueue schedules — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — mixed raw/explicit request and reply contracts — `sonnet[1M]`
  - `asm-review-data-security` — deletion-authority separation and fail-closed paths — `gpt-5.6-luna[1M]`
  - `asm-review-reuse` — generalized lane helper and existing-owner reuse — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-frontend` — task 5_1 changes no webview code; the reachable mutation-result and report handlers were traced by the chair and contracts review as consumers of the unchanged wire behavior
- Verdict: APPROVE
- Counts: 0 BLOCK, 0 WARN, 0 SUGGEST
- Split over gating blockers: 0 feature / 0 machinery
- Verify evidence: `bun run asm change verify-status render-the-removal-assessment-as-a-report` exits 0 for all 21 tasks, including task 5_1. The supplied HEAD Gate records clean type checking, 6596/6596 unit tests, the filesystem-deletion gate passing, and the established pre-existing Biome baseline of 3 errors / 14 warnings / 1 info. Review ran no project verification command.

## Findings

None.

## B5 adjudication

- **B5 fixed.** Both report-producing message doors now call the same `admitAssess(repoId, request)` owner. `lane.outstanding` is set synchronously before `runAssessLane` starts; later requests only replace the surface's pending entry and cannot enqueue another job. `takeNextAssess` serves one live surface in round-robin order, and `runAssessLane` clears the flag and decides whether to re-enqueue in one synchronous `finally` block after the served capability has settled. Raw requests call `removeWorktree(..., undefined)` inside that lane and retain the blocked mutation-result notice; explicit requests call `assessRemovalReport` and retain token/worktree reply semantics. A fingerprint-bearing removal takes the separate `perform` branch and remains a non-coalescing mutation.
- The growth axis is requests per repository. The structural high-water mark is one queued-or-running report job per repository, independent of raw/explicit mix, worktree alternation, attached surface count, or attach/ask/detach churn. Pending and rotation state are bounded by currently attached surfaces and active repositories, not request history.
- The held-lane witness covers two linked worktrees in one repository, repeated and alternating raw/explicit requests, multiple surfaces, detach churn, and a confirmed removal queued after the burst. It observes exactly one report job before the mutation and fails when raw admission is reverted to direct `perform`, so it is causal rather than a FIFO-only assertion.
- Status: fixed in `d72f0cbf`; no gating blocker remains.

## Rejected specialist candidate

- The contracts specialist proposed a BLOCK because raw and explicit requests share a per-surface pending key, so one kind can supersede the other before service and produce the successor's distinct reply shape. Rejected on both contract and behavior evidence.
  - Task 5_1 explicitly accepts one latest pending request per surface across both report-producing kinds; the archived dependency's contract is question-level supersession, not one reply owed per message.
  - The same shipped surface can consume both answers. An explicit successor reaches `handleRemoveAssessment`; a raw successor reaches `handleMutationResult`, which calls `showActionResult`, maps the blocked result to `needsConfirm`, and renders the existing blocked-notice report opener. The raw reply is therefore visible feedback, not an unconsumable message.
  - A stale `liveAssess` value does not wedge the row: `beginAssess` refuses nothing and every later ask replaces it; opening the raw notice's report invokes `onDialogOpened` and clears it. A legacy surface that only sends raw requests cannot create the cross-kind schedule, while the current surface handles both routes.
  - Keying by `(surface, kind)` as suggested would retain two pending questions for one surface and contradict the accepted latest-per-surface bound without fixing a demonstrated user-visible failure.

## Prior findings adjudicated

- **B1-B3 and W1-W5 remain fixed.** Task 5_1 changes only host admission around the already-reviewed report and confirmed-removal capabilities.
- **B5 fixed** as detailed above.
- **W6 and S2 remain fixed** by the archived coalescing dependency; re-asking remains unsuppressed and the replacement assembly witness is unchanged.
- **B4 and S1 remain rejected.** No new evidence changes either disposition.
- No prior `audit-backlog` or `risk-accepted` entries exist to carry forward.

## Full-flow trace

- Explicit menu ask: controller token -> `worktreeRemoveAssess` -> capability/target pre-flight -> shared per-repository lane -> forced rebuild/re-resolve inside `assessRemovalReport` -> token/worktree assessed or unavailable reply -> live-token report dialog.
- Raw fingerprint-free fallback: `worktreeRemove` with no fingerprint -> target pre-flight -> the same lane -> `removeWorktree(..., undefined)` -> mutation coordinator freshness barrier and assessment -> blocked mutation result plus report fingerprint -> existing blocked notice and report opener. It contributes no second queue job while one report request is outstanding.
- Mixed traffic: one latest pending request per surface and repository; round-robin prevents one continuously asking surface from starving another. A detached pending request is removed immediately; a request already taken may finish but costs only the one job the bound permits.
- Confirmed removal: `worktreeRemove` with a fingerprint bypasses report admission -> non-coalescing mutation queue -> fresh assessment -> one-shot redemption -> host-only `atRisk` force decision -> Git. Requests arriving after the confirmed mutation was queued stay outside the mutation queue until the current report job settles and then append behind that mutation.
- Error paths: explicit missing/rejected assessment answers `unavailable`; raw capability rejection is caught and logged with the same behavior as `perform`; every lane exit reaches the synchronous `finally`, so rejection cannot leave `outstanding` stuck or drop a pending wakeup.
- No queue-to-rebuild-gate lock cycle, authority widening, target redirection, cross-repository conflation, or request-history growth was found.

## Inline support review

- The changed scale test contains no `.only` or `.skip`; held promises and drain points are awaited.
- Existing host action and assembly coverage preserves the two reply forms and the raw blocked-notice fallback; task 5_1's new witness owns the admission high-water mark and confirmed-mutation ordering.
- The test distinguishes report jobs (`raw:` / `assess:`) from confirmed removals (`remove:`), covers linked worktrees and two repositories, and asserts behavior that fails under the round-7 implementation.
