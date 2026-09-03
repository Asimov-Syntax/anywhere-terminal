# Review round 5 — move-uncommitted-work-with-the-intent

- Date: 2026-09-03
- Cycle: 2
- Mode: verification
- Scope: range `0d7b439f6396aecc7757af51e1ac13eabc2202cf..c53c43e8be6cd06dd22ddd6db3728112176b3d83`, plus the cumulative F006/F007/F010-F014 authority cone and accepted artifacts
- Head: `c53c43e8be6cd06dd22ddd6db3728112176b3d83` (the working tree also contains CLI-generated review analytics outside the persisted round file)
- Reviewable lines: 75 additions — 31 TypeScript production and 44 review-analytics metadata; 246 changed test lines reviewed inline
- Agents spawned: `asm-review-data-security` (migration authority closure; `gpt-5.6-sol[1M]`), `asm-review-logic` (cache/queue transitions; `gpt-5.6-terra[1M]`), `asm-review-contracts` (authority contract and tests; `sonnet[1M]`)
- Agents skipped: `asm-review-frontend` — no UI production behavior changed. `asm-review-performance` — F008/F009 are unchanged and carried forward. `asm-review-reuse` — the delta extends existing cache/host/mutation owners and the test helper extracts an existing selector
- Verdict: **BLOCK**
- Status: **blocked**
- Counts: 1 BLOCK · 2 WARN · 0 SUGGEST

## Decision

### VERDICT: BLOCK

**Why:** F012-F014 are closed across cache, offer, and queued-create authority, but the new post-coordinator check runs after destructive debris clearance, so an already-withdrawn migration create can delete the authorized destination and then refuse before Git creates its replacement.

**Blocking:** 1 | **Warnings:** 2 | **Suggestions:** 0
**Status:** BLOCKED

## Scope lock and accepted obligations

The delta is remediation-only. Tasks 5_2-5_4 extend the accepted cache/offer/mutation authority owner; tasks 5_5-5_8 change tests only and add no production capability or invariant owner. The cycle remains cycle 2 in verification mode. `proposal.md` remains absent; intent comes from Gate-2-approved D3, tasks 5_2-5_8, round 4, and the supplied impact manifest.

D3 requires every migration checkpoint to derive authority from a currently published generation and paired registration, with all-failed duplicate retention remaining display-only and Git-unavailable private lookup refusing independently. The mutation body must recheck after the coordinator rebuild immediately before `git worktree add`. The pre-existing create contract also places debris clearance after every refusal-capable recheck, because clearance is destructive and the user requested a create rather than a clear-only operation.

## End-to-end verification trace

- F012 cache retention: when a current B root exists, failed siblings map to B; when no current same-repository root exists, `currentRoots.get(...) ?? remembered` preserves every failed folder's last-good canonical association. The both-fail → first-closes witness retains the two-worktree group degraded and generation-less.
- F013 Git-unavailable authority: repo-scoped `merge` receives `authoritative = gitAvailable`, so a clean repo-scoped listing during a global Git outage stores neither generation nor registration. `registrationFor` independently refuses while Git is unavailable. Cache and host witnesses cover the predictable next generation and prove no source probe starts.
- F014 offer checkpoints: `currentMigrationRegistration` reads the currently published generation through `readRepo` and resolves its paired registration. Probe completion, redemption, and final host handoff compare against that current authority rather than retained `rootFor`. Same-registration repo-scoped generation advance remains accepted.
- Post-coordinator checkpoint: the mutation service asks the host binding after the forced repo rebuild and directly before calling `createWorktree`; production `extension.ts` wires the host binding. Withdrawal, replacement, missing binding, equal-registration continuation, and no-migration omission are covered.
- Remaining blocker: for a `debris` destination, the body redeems and awaits destructive `clearDebris` before asking the new migration-authority question. Authority already withdrawn by the coordinator rebuild is therefore discovered only after the destination has been cleared.
- Assembly stabilization: changed waits use the state consumed by their assertions — linked row, report/dialog, exact Git argv, exact outcome text, provisioning result, or create-specific notice. The fallback pump never returns before the old 40-turn floor. No assertion was removed or broadened.

## Findings

### F001 — The created destination is never bound to the checkout that receives the move

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`
- Class: feature
- File: `src/worktree/migrateChanges.ts:777`
- Title: The created destination is never bound to the checkout that receives the move
- Evidence: Immediate destination capture and pre/post migration registration/evidence checks remain intact.
- Impact: The original unintended-destination mechanism remains closed.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2; unchanged by round 5.

### F002 — Post-verification can report moved after observable source `.git` substitution

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/worktree/migrateChanges.ts:1114`
- Title: Post-verification can report moved after observable source `.git` substitution
- Evidence: Post-call source evidence and snapshot remain bracketed and registration-bound.
- Impact: Observable post-call source identity drift cannot authorize `moved`.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2; unchanged by round 5.

### F003 — Nested linked-source destinations are not excluded before migration

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/worktree/worktreeMutationService.ts:1117`
- Title: Nested linked-source destinations are not excluded before migration
- Evidence: The normalized selected-source exclusion still precedes migration; independent main hygiene remains nonfatal.
- Impact: The original wrong-root exclusion mechanism remains closed.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2; unchanged by round 5.

### F004 — An intermediate symlink can make snapshot hashing read outside the source

- Severity: WARN
- Confidence: MEDIUM
- Priority: P2
- Agent: `asm-review-logic`
- Class: feature
- File: `src/worktree/migrateChanges.ts:504`
- Title: An intermediate symlink can make snapshot hashing read outside the source
- Evidence: Parent components remain authorized before and after no-follow final reads.
- Impact: Persistent intermediate redirection remains refused.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2; accepted transient ABA risk unchanged.

### F005 — A hostile `.git` file can double the nominal snapshot memory bound

- Severity: WARN
- Confidence: MEDIUM
- Priority: P3
- Agent: `asm-review-logic`
- Class: feature
- File: `src/worktree/migrateChanges.ts:414`
- Title: A hostile `.git` file can double the nominal snapshot memory bound
- Evidence: The opened-handle 1 MiB cap and single exact buffer remain in place.
- Impact: The original excess allocation mechanism remains closed.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2; unchanged by round 5.

### F006 — Source evidence is not bound to the selected repository registration

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`
- Class: feature
- File: `src/worktree/migrateChanges.ts:878`
- Title: Source evidence is not bound to the selected repository registration
- Evidence: Source role, common registration, linked topology, destination capture, and pre/post snapshots remain bound to one `MigrationRepositoryBinding`; current cache authority now gates every host and mutation handoff.
- Impact: Wrong-repository or wrong-role source evidence cannot reach migration.
- SuggestedFix: None; retain the full ownership witness inventory.
- Status: fixed
- Triage: Fixed in round 3 and reverified through round 5's four current-authority checkpoints.

### F007 — Raw display spelling defeats normalized selected-source admission

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/providers/WorktreeHost.ts:2804`
- Title: Raw display spelling defeats normalized selected-source admission
- Evidence: Selection, probing, offer storage, request handoff, validation, and exclusion continue to use normalized `WorktreeInfo.id`; `displayPath` remains presentation-only.
- Impact: Symlink-spelled selected sources follow the normalized exclusion and ownership path.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 3 and reverified in round 5.

### F008 — Snapshot budget excludes Git stderr and status-derived retained allocations

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-performance`
- Class: feature
- File: `src/worktree/migrateChanges.ts:583`
- Title: Snapshot budget excludes Git stderr and status-derived retained allocations
- Evidence: Unchanged: the budget charges stdout and filesystem bytes but not the second process-output stream or retained parsed representation.
- Impact: Peak extension-host memory can exceed the nominal 512 MiB snapshot budget.
- SuggestedFix: Enforce a total output/representation ceiling or stream parsing with explicit headroom.
- Status: accepted
- Triage: Persists as a non-gating WARN; this is accepted triage, not user risk acceptance.

### F009 — Parent authorization repeats full component scans for every affected path

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-performance`
- Class: feature
- File: `src/worktree/migrateChanges.ts:467`
- Title: Parent authorization repeats full component scans for every affected path
- Evidence: Unchanged: each path repeats relative and absolute component walks around every snapshot read.
- Impact: Deep, large valid change sets can spend the deadline in duplicate prefix work.
- SuggestedFix: Reuse per-snapshot prefix construction while retaining immediate identity revalidation.
- Status: accepted
- Triage: Persists as a non-gating WARN; this is accepted triage, not user risk acceptance.

### F010 — A fresh generation can resolve to a stale repository registration

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security` (corroborated by chair and `asm-review-contracts`)
- Class: feature
- File: `src/worktree/WorktreeCache.ts:337`
- Title: A fresh generation can resolve to a stale repository registration
- Evidence: Generation and registration remain co-owned by `CachedRepo`; current B canonicalization and same-record lookup remain intact through F012/F013's added branches.
- Impact: A fresh public generation cannot join to stale A registration.
- SuggestedFix: None; retain the A→B witness.
- Status: fixed
- Triage: Fixed in round 4 and reverified in round 5.

### F011 — Lexical admin placement accepts a redirected `worktrees` directory

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`
- Class: feature
- File: `src/worktree/migrateChanges.ts:913`
- Title: Lexical admin placement accepts a redirected `worktrees` directory
- Evidence: No new evidence shows an unintended repository, source, destination, work content, or false `moved` outcome.
- Impact: The round-3 proposed physical-containment restriction remains outside the accepted Git topology contract.
- SuggestedFix: None.
- Status: rejected
- Triage: Round-3 arbiter rejection stands.

### F012 — A second failing duplicate folder loses the retained repository mapping

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/worktree/WorktreeCache.ts:205`
- Title: A second failing duplicate folder loses the retained repository mapping
- Evidence: Fixed: the changed branch uses the current canonical root when present and otherwise falls back to that folder's remembered root. The both-fail → first-closes test retains two worktrees, marks them degraded, and exposes no generation.
- Impact: Every still-open failed duplicate preserves the last-good display association without reintroducing stale A when B currently resolves.
- SuggestedFix: None; retain the multi-step ordering witness.
- Status: fixed
- Triage: Fixed in round 5. Boundaries verified: failed-first/current-second B, all duplicates failed, first folder closed, degraded retention, and authority withholding.

### F013 — Hidden generations retain authority while Git is unavailable

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security` (corroborated by chair)
- Class: feature
- File: `src/worktree/WorktreeCache.ts:139`
- Title: Hidden generations retain authority while Git is unavailable
- Evidence: Fixed: repo-scoped `merge` receives `authoritative = gitAvailable`, stores neither generation nor registration during an outage, and `registrationFor` independently returns undefined while Git is unavailable. Cache and host tests quote the predictable next generation and prove no private lookup, probe, or offer.
- Impact: Git-unavailable retained groups are display-only on both public and private paths.
- SuggestedFix: None; retain both defense layers and the guessed-generation witnesses.
- Status: fixed
- Triage: Fixed in round 5. Verified safe after Git returns: the next authoritative observation may publish a fresh generation normally.

### F014 — Retained `rootFor` lets pending offers survive authority withdrawal

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/providers/WorktreeHost.ts:658`
- Title: Retained `rootFor` lets pending offers survive authority withdrawal
- Evidence: Fixed: `currentMigrationRegistration` derives a current public generation and its paired private registration. Probe completion, redemption, and final host handoff use it; the mutation service asks the same binding after the coordinator rebuild. Tests cover pending and issued offers, final source-recheck withdrawal, post-coordinator withdrawal/replacement, missing authority, equal-registration continuation, and no-migration creates.
- Impact: Retained roots support display and later discovery only; they cannot preserve offer authority after generation withdrawal.
- SuggestedFix: None for F014's mechanism; retain all four checkpoint witnesses.
- Status: fixed
- Triage: Fixed in round 5 and reverified across cache, host, mutation coordinator, and production wiring.

### F015 — Migration authority is checked after destructive debris clearance

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic` (corroborated by chair)
- Class: feature
- File: `src/worktree/worktreeMutationService.ts:1045`
- Title: Migration authority is checked after destructive debris clearance
- Evidence: In a migration create with `mustMatchDebrisAuthorization`, the coordinator has already forced its repository rebuild. The body then validates and redeems the debris authorization and awaits `clearDebris` at lines 1009-1043 before asking `migrationRegistration` at lines 1045-1050. If the coordinator rebuild already withdrew or replaced migration authority, the destination is cleared first and the newly added check then refuses without calling `git worktree add`. The surrounding comment explicitly requires clearance to follow every refusal-capable recheck, but this new recheck is after it.
- Impact: A create request can permanently delete the authorized debris destination and then fail for migration authority that was already known to be invalid at body entry, leaving no replacement worktree. The user authorized recovery as part of create, not a clear-only operation.
- SuggestedFix: Check migration authority before entering the destructive debris-clearance branch, and retain the current final check immediately before `createWorktree` to catch authority changes during clearance or any other intervening await. Add a combined debris+migration witness with authority already withdrawn, asserting neither `clearDebris` nor `git worktree add` runs.
- Status: accepted
- Triage: New round-5 gating finding inside the post-coordinator and migration/no-migration create cone. Invariant: no destructive clearance occurs while a known refusal-capable migration precondition is already false. Affected: migration-selected creates combined with the independent `debris` destination disposition. Verified safe: free destinations, creates without migration, and migration creates whose authority remains equal through the final check.

## Accepted risk

- Status: risk-accepted (user grant; non-gating)
- Owner: worktree subsystem
- Scope: another process may transiently substitute source bytes, an intermediate source component, source `.git`, or the destination between path-based observations and restore it before a later comparison; execution-time named-path work is authorized, while persistent or observed divergence is refused or indeterminate
- Expiry: none recorded
- Reactivation: transactional expected-state/typed-result Git APIs, a cross-platform handle-relative filesystem primitive, or an observed substitution incident
- Review note: F015 is deterministic sequencing of a known-false precondition and is unrelated to the accepted ABA interval.

## Support review

Focused authority tests are non-vacuous: they assert probe/create/Git calls are absent on withdrawal and present on equal-registration or no-migration paths. The all-failed cache witness requires retained worktrees and degradation, so undefined retention cannot pass. The assembly stabilization changes no production code, removes no assertion, and narrows waits to the exact DOM/message/argv state consumed. `createNotices()` preserves the prior exact text predicate while deduplicating it. The fallback pump retains the old 40-turn minimum and only extends while DOM state changes. No `.only`, unconditional `.skip`, or missing async wait was introduced.

No test covers the newly identified combined `debris` plus migration-authority-withdrawal sequence.

## Verification evidence

`bun run asm change verify-status move-uncommitted-work-with-the-intent` records tasks 1_1 through 5_8 at exit 0. Supplied final evidence reports `pnpm run check-types` passing; 288 files / 7278 tests passing; filesystem-deletion gate passing; production bundle and `build:check-requires` passing. Full Biome reproduces only the established clean-tree format errors in untouched `src/agentHooks/AgentHookController.test.ts`, `src/agentHooks/install/ClaudeHookInstaller.test.ts`, and `src/cursor/CursorHookInstaller.test.ts`. No project verify command was run by the chair.

## Sub-agents spawned

- `asm-review-data-security`: migration publication and execution authority — `gpt-5.6-sol[1M]` — no findings
- `asm-review-logic`: cache and coordinator state transitions — `gpt-5.6-terra[1M]` — F015
- `asm-review-contracts`: authority API and test-contract verification — `sonnet[1M]` — no findings
