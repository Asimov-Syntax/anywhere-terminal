# Review Round 7

- Date: 2026-09-01
- Cycle: 5
- Mode: discovery
- Requested lane: fastlane
- Scope: requested range `cf4492aaf82c7cd7f528b00c996fcbd6d20ba779..7291cfd4bff224352a403445544d60cf6b190fbf`; post-handback section 4 implementation slice `1f4819b7..HEAD` (tasks 4_1 through 4_4) plus the integration seam with archived dependency `asimov/changes/archive/260901-0348-coalesce-assessment-requests-at-the-host/`. Earlier cumulative work was prior-round context, not re-reported.
- Head: `7291cfd4bff224352a403445544d60cf6b190fbf` (working tree dirty only from generated `asimov/changes/render-the-removal-assessment-as-a-report/analytics.json` after round start)
- Reviewable lines: 68 production lines; changed tests reviewed inline
- Round extension: `asm review round-start` recorded the caller's explicit post-cap FASTLANE authorization with `--user-approved`
- Agents spawned:
  - `asm-review-data-security` — deletion authority and report fingerprint boundary — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — redemption, fresh force derivation, and error exits — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — removal wire contract and nullability — `sonnet[1M]`
  - `asm-review-frontend` — dialog authority and callback lifecycle — `gpt-5.6-luna[1M]`
  - `asm-review-performance` — raw fallback queue growth and dependency integration — `gpt-5.6-terra[1M]`
- Agents skipped:
  - `asm-review-reuse` — section 4 adds no helper, parser, validator, split, or duplicate implementation; it reuses the existing fingerprint store, `atRisk`, mutation coordinator, and archived admission owner
- Verdict: BLOCK
- Counts: 1 BLOCK, 0 WARN, 0 SUGGEST
- Split over gating blockers: 1 feature / 0 machinery
- Verify evidence: `bun run asm change verify-status render-the-removal-assessment-as-a-report` exits 0 for all 20 tasks. The supplied HEAD Gate records clean type checking, 6595/6595 unit tests, the filesystem-deletion gate passing, and the established pre-existing Biome baseline of 3 errors / 14 warnings / 1 info. Review ran no project verification command. Machine-wide concurrent Vitest timing flakes were not treated as evidence without isolated reproduction.

## Findings

### B5

- ID: B5
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `chair`, corroborated by `asm-review-performance`
- Class: feature
- File: `src/providers/WorktreeHost.ts:2071`
- Title: Fingerprint-free raw removals bypass the per-repository assessment-lane bound
- Evidence: Section 4 makes a fingerprint-free `worktreeRemove` a non-destructive report request for every readable non-refused published target, but the host still delegates every such message directly through `perform(() => remove(...))`. Each call enters `worktreeMutationService.removeWorktree` at `src/worktree/worktreeMutationService.ts:515`, then `withTarget` / `coordinator.run`, pays the forced rebuild barrier, resolves, runs the full removal assessment, returns `blocked`, issues a fingerprint, and pays the coordinator's post-attempt rebuild. The archived dependency bounds only the `worktreeRemoveAssess` case through `assessLanes`; the raw `worktreeRemove` case never consults that lane. Because `handleMessage` admits each raw message synchronously while the row is still published, N repeated or alternating fingerprint-free raw requests from one or several surfaces append N FIFO assessment-like jobs. A later remove, lock, unlock, prune, or create for the repository waits behind all N. Task 4_4 explicitly preserves this raw blocked-notice door, so it is supported integration behavior rather than an invented caller. The existing scale witness bursts `worktreeRemoveAssess`; its single raw removal uses a stubbed action and cannot witness this service-path backlog.
- Impact: The section 4 integration reopens round-6 B5's exact invariant through a second entry door. Non-destructive authority-bearing reads can again accumulate without structural bound in the shared mutation queue, delaying an irreversible removal or any other repository mutation by the cumulative cost of the entire raw-message burst and falsifying design.md's settled D10 ledger row.
- SuggestedFix: Admit every fingerprint-free raw `worktreeRemove` through the same per-repository assessment lane before `removeWorktree` / `coordinator.run`, preserving the blocked mutation-result notice for the latest pending raw request. Coalesce raw and explicit assess requests together so all report-producing work contributes at most one queued job per repository; keep fingerprint-bearing confirmations on the non-coalescing mutation path. Add a held-barrier scale witness covering repeated/alternating raw requests, multiple surfaces, surface churn, and a mutation queued after the burst.
- Status: accepted — gating
- Triage: Reopens round-6 B5 under its original ID. The invariant and causal mechanism are unchanged: read-only assessment traffic sharing the repository mutation queue lacks a structural admission bound. The archived child fixed the explicit assess door; section 4 newly widens the raw door into the same report-producing behavior for clean targets while bypassing that owner. Severity remains BLOCK; the evidence delta is the changed reachability and the accepted task 4_4 fallback.
- Invariant: Read-only removal-report traffic must have one structural pending-work bound per repository, across every message door and every surface, so a mutation waits behind at most one assessment.
- Boundary inventory:
  - Affected: repeated raw fingerprint-free requests for one worktree; alternating raw requests for several worktrees in one repository; several attached surfaces; requests already admitted before a later mutation; the raw blocked-notice fallback added to the assembly witness.
  - Verified safe: `worktreeRemoveAssess` requests use the archived per-repository lane; fingerprint-bearing confirmations remain non-coalesced mutations; repositories use independent queues; each individual assessment read is time-bounded.

## Adjudication notes

- The data-security specialist proposed a BLOCK because deterministic evidence digests can have the same bytes after a later identical report is issued. Rejected: `FingerprintStore.redeem` authorizes only while a current store record exists; spend and expiry delete that record, so the old bytes fail until a later assessment creates a new issuance. At that point authority is bound to a currently issued report over the same target and evidence, which is exactly the narrowed accepted D7 ledger claim. The plan attack explicitly rejected the stronger claim that the host proves a human answered and records that a same-trust-domain client can replay an issued fingerprint. The candidate therefore re-litigates an accepted distinction and does not show execution without current issued-report authority.
- The contracts specialist found stale `force` prose in `docs/design/worktree-rpc.md` and adjacent source comments. These are not findings in this round: the wire document is unchanged in the section 4 implementation slice and workflow.md explicitly leaves that correction to the pending Blueprint Sync; the source comments are non-behavioral stale prose beside a runtime contract that is internally consistent. No changed caller retains a client force choice.
- Logic, contracts, and frontend specialists found no runtime authority, force-derivation, nullability, dialog, or callback defect beyond B5. The clean and risky flows use the same host `atRisk` owner after fresh re-assessment and redemption; refusal/unavailable mount no executable control; malformed confirmable null reports fail closed.

## Prior findings adjudicated

- **B1 fixed.** Every readable non-refused assessment now carries report authority, the clean menu path opens the ordinary report before Git, and the assembled callback sends the fingerprint that the host redeems into ordinary execution when fresh evidence is clean.
- **B2, W1, W2, W3 remain fixed.** Section 4 does not reopen presenter inventory, refusal classification/copy, or pane wording.
- **B3, W4, W5 remain fixed.** The authority-bearing assess still takes the coordinator barrier, replies remain token-ordered, and failed/missing assessments answer through `unavailable`.
- **B5 reopened.** The archived dependency closes the explicit `worktreeRemoveAssess` lane, but section 4's raw fingerprint-free fallback creates the same unbounded assessment-like queue through `worktreeRemove`.
- **W6 and S2 remain fixed by the archived dependency.** Re-asking is never suppressed, and the strengthened assembly replacement witness remains present.
- **B4 and S1 remain rejected.** No new evidence changes either disposition.
- No prior `audit-backlog` or `risk-accepted` entries exist to carry forward.

## Full-flow trace

- Menu, clean: Remove click -> controller request token -> host per-repository assessment lane -> forced rebuild/re-resolve -> clean assessment plus fingerprint -> token-checked report -> ordinary confirmation -> `worktreeRemove` carrying only the fingerprint -> mutation queue -> fresh assessment -> one-shot redemption -> `atRisk` false -> ordinary Git removal.
- Menu, risky: the same path issues a report fingerprint, the dialog requires typed confirmation, fresh evidence redeems, and host `atRisk` alone selects `--force`. Evidence growth or substitution re-prompts; evidence narrowing may proceed and can select ordinary Git.
- Refusal/unavailable: refusal carries null and the dialog mounts no destructive control; unavailable is a separate result and reaches Retry without a fingerprint.
- Raw fallback: fingerprint-free `worktreeRemove` -> direct mutation queue -> forced rebuild/re-resolve -> full assessment -> blocked mutation result plus fingerprint -> blocked notice -> report dialog -> fingerprint-bearing confirmed mutation. Each raw ask independently enters the queue, which is B5.
- Stale UI answers: the request token orders assess replies only; actual deletion authority is target/evidence-bound fingerprint state. Opening another dialog or asking again retires the old live assess token.
- Surface and queue integration: explicit assess traffic is bounded one job per repository by the archived dependency, but raw fallback traffic bypasses that admission owner. No queue-to-rebuild-gate lock cycle was found.

## Inline support review

- Changed tests contain no `.only` or `.skip`; asynchronous settle, confirmation, watcher, and coordinator gates are awaited.
- The section 4 service tests causally prove missing/invalid/expired/mismatched/replayed authority stops before Git and that fresh clean versus risky evidence selects ordinary versus forced argv.
- The assembly tests causally prove the clean menu and raw fallback reach no Git call before a report callback. They do not burst the raw fallback or observe coordinator admissions, so they cannot falsify B5.
