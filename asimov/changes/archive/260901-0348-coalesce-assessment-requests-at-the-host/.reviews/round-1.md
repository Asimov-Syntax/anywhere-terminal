# Review Round 1

- Date: 2026-09-01
- Cycle: 1
- Mode: discovery
- Requested lane: fastlane
- Scope: range `a72bc499..HEAD`; change context `coalesce-assessment-requests-at-the-host`
- Head: `a033e0de5ead371b1c76489a3d2ef9c98d9705de` (working tree dirty from generated `asimov/changes/coalesce-assessment-requests-at-the-host/analytics.json` after round start; outside the explicit reviewed range)
- Reviewable lines: 691
- Agents spawned:
  - `asm-review-logic` — host lane concurrency, lost wakeups, and lifecycle — `gpt-5.6-sol[1M]`
  - `asm-review-data-security` — deletion authority, identity, and reply loss — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — D1-D4/D6 supersession and message contracts — `sonnet[1M]`
  - `asm-review-performance` — queue bound, rotation growth, and fairness — `gpt-5.6-terra[1M]`
  - `asm-review-frontend` — controller token, retry, and report lifecycle — `gpt-5.6-luna[1M]`
  - `asm-review-reuse` — lane helper reuse and host lifecycle cohesion — `gpt-5.6-luna[1M]`
- Agents skipped: none
- Verdict: APPROVE
- Counts: 0 BLOCK, 0 WARN, 0 SUGGEST
- Split over gating blockers: 0 feature / 0 machinery
- Verify evidence: `bun run asm change verify-status coalesce-assessment-requests-at-the-host` reports tasks 1_1, 1_2, 1_3, and 2_1 verified with exit 0 and scope unchanged. The supplied Head gate records clean type checking, 6262/6262 unit tests across 269 files, the filesystem-deletion gate, and the pre-existing Biome 3 errors / 14 warnings / 1 info baseline with none in changed files. Review ran no project verify commands.

## Findings

None.

## Adjudication notes

- R1 holds at the changed admission boundary. `outstanding` is set before the first `runAssessLane` call; while true, all handler turns only replace `pending`. The lane clears and decides whether to re-enqueue in one synchronous `finally` block. The awaited production capability does not resolve until `mutationCoordinator.run` has completed its own `finally`/`settle`, so the recursive call appends after the prior queue job has settled and cannot overlap it or jump an already queued mutation.
- D3/D4 compose across same/different worktrees, repositories, and surfaces. A pending same-surface request is replaced only within its repository; a request already taken retains its own token/worktree pair and may reply, but the controller's single live token rejects it after any newer ask. The synchronous pre-flight `unavailable` arm installs no lane state and answers the token already installed by `beginAssess`.
- Rotation membership is unique because admission checks `rotation`, not `pending`; serving shifts and cycles one live key, detach removes its pending entry and unique key, and an empty lane is deleted. The detach sweep is prompt retention cleanup, not correctness machinery: without it, `takeNextAssess` would discard a departed pending key before calling the paid assessment capability.
- The performance specialist proposed O(1) membership and a reverse detach index because admission uses `rotation.includes` and detach scans active lanes. Rejected as a finding: the collections are structurally bounded by currently attached surfaces and currently active repository lanes, never by request history; a lane is deleted when it becomes idle. No scale evidence makes the extra synchronization state a required fix.
- Best-effort delivery remains non-wedging. A lost reply may leave the controller's old `liveAssess` value until the next gesture and may leave one TTL-bounded fingerprint record per worktree in the host store, but every new ask replaces the controller value, no host lane slot waits for delivery, and a fingerprint never delivered to a surface cannot be presented by that surface. Forced removal re-assesses and redeems against current evidence. No stale authority or inert row was found.

## Full-flow trace

- Entry and identity: the menu mints and installs a fresh controller token before posting `worktreeRemoveAssess`; the host derives `repoId` from its cached published worktree and rejects an unregistered target through a typed `unavailable` reply.
- Admission and ordering: the host writes the latest `(surface, repo)` request and rotation membership synchronously. One `runAssessLane` invokes the production assessment capability, which enters the repository's FIFO `mutationCoordinator.run`, takes the forced rebuild barrier, and re-resolves the target against that repository.
- Assessment and authority: the host reads status, ignored material, sessions, panes, claims, and proofs under one observation. Risk-bearing evidence issues one fingerprint record for the served worktree; unavailable/refused/clean outcomes issue none.
- Reply and fallback: the lane replies with the exact token and worktree id it took. Assessment rejection becomes `unavailable`; detach suppresses delivery; production `postMessage` remains best-effort. A later ask always installs a new token and is admitted or coalesced, so delivery loss does not block recovery.
- UI and destructive side effect: only the live token can open the report. Confirmation sends ordinary removal for a null fingerprint or forced removal with the report fingerprint. The host re-derives the repository, queues the mutation behind any earlier assessment, forces another rebuild, re-resolves, re-assesses, redeems/spends force authority against current evidence, checks the observation immediately before git, performs removal, and settles with a final rebuild.
- Supported modes: independent repositories have independent lanes; multiple surfaces share fair round-robin service within one repository; detached surfaces lose pending requests; replaced pending messages cost no assessment job; running predecessors may finish but stale replies cannot open UI.

## Inline support review

- Changed tests contain no `.only` or `.skip`; asynchronous gates, drains, watcher delivery, and confirmation paths are awaited.
- Host witnesses assert observable action admissions, served targets/tokens, surface churn, cross-repository independence, and fair service. The scale witness makes a later removal run before the one assessment re-admitted after it.
- The assembly walk now changes registration generation at one path, delivers the withheld watcher rebuild, opens the replacement's locked report, confirms, and observes the git removal path. The task correctly records its barrier-bypass mutation as external mutation evidence rather than claiming the Verify can observe it.
- Parent review artifacts and project documentation in the range were classified as skipped support/context; no behavioral production contract or wire message changed there.
