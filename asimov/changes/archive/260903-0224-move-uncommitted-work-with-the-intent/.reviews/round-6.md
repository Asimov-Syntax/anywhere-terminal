# Review round 6 — move-uncommitted-work-with-the-intent

- Date: 2026-09-03
- Cycle: 2
- Mode: verification
- Scope: range `c53c43e8be6cd06dd22ddd6db3728112176b3d83..d26eafaffdb40d008a8d3d609c47c8dd4a491605`, plus the cumulative F012-F015 authority cone and accepted artifacts
- Head: `d26eafaffdb40d008a8d3d609c47c8dd4a491605` (the working tree also contains CLI-generated review analytics outside the persisted round file)
- Reviewable lines: 31 additions — 7 TypeScript production and 24 review-analytics metadata; 34 changed test lines reviewed inline
- Agents spawned: `asm-review-logic` (debris authority ordering; `gpt-5.6-sol[1M]`), `asm-review-data-security` (destructive refusal boundary; `gpt-5.6-terra[1M]`)
- Agents skipped: `asm-review-contracts` — no interface/schema change beyond reuse of the accepted local predicate. `asm-review-frontend` — no frontend change. `asm-review-performance` — F008/F009 are unchanged and carried forward. `asm-review-reuse` — the local predicate removes duplication between two checks rather than adding a parallel facility
- Verdict: **WARN**
- Counts: 0 BLOCK · 2 WARN · 0 SUGGEST

## Decision

### VERDICT: WARN

**Why:** F015 is closed: already-invalid migration authority refuses before debris clearance, authority changing during clearance or intervening awaits is caught by the retained final check before Git add, and no gating regression survives in the cumulative F012-F015 cone.

**Blocking:** 0 | **Warnings:** 2 | **Suggestions:** 0

## Scope lock and accepted obligations

The delta is remediation-only. Task 5_9 changes the existing mutation-service ordering and its focused witness; it adds no new capability, contract, or invariant owner. The cycle remains cycle 2 in verification mode. `proposal.md` remains absent; intent comes from Gate-2-approved D3, task 5_9, round 5, and the supplied impact manifest.

The binding obligation is narrow: a migration create whose authority is already invalid after the coordinator rebuild cannot enter destructive debris clearance; the final current-authority check remains directly before `createWorktree` so a later withdrawal stops Git add. Migration-free creates do not acquire this dependency.

## End-to-end verification trace

- The coordinator still performs its forced repository rebuild before entering the create body.
- Branch-name validation remains ahead of destructive clearance, preserving its existing refusal ordering.
- `migrationAuthorityIsCurrent` is local to the body and treats a no-migration request as current without consulting the optional binding.
- For `debris`, the predicate now refuses already-withdrawn, replaced, or unavailable migration authority before the authorization read/redeem and `clearDebris` path.
- The existing second predicate call remains immediately before `createWorktree`; there is no await between that call and invoking the async Git-add wrapper, whose runner is called synchronously before its first suspension.
- Equal registration from a newer authoritative publication continues. Free destinations retain the final check only. No-migration free or debris creates do not ask for migration authority.
- Unreadable or changed debris still refuses through its existing path. Partial clearance still reports survivors. A withdrawal during clearance or other intervening await prevents Git add through the final check.
- The new witness establishes a valid debris authorization, reachable removal implementation, withdrawn registration, and a migration request, then proves both removal and `git worktree add` are absent and an error is reported.

## Findings

### F001 — The created destination is never bound to the checkout that receives the move

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`
- Class: feature
- File: `src/worktree/migrateChanges.ts:777`
- Title: The created destination is never bound to the checkout that receives the move
- Evidence: Immediate destination capture and registration-bound pre/post evidence remain intact.
- Impact: The original unintended-destination mechanism remains closed.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2; unchanged in round 6.

### F002 — Post-verification can report moved after observable source `.git` substitution

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/worktree/migrateChanges.ts:1114`
- Title: Post-verification can report moved after observable source `.git` substitution
- Evidence: Post-call source evidence remains bracketed and registration-bound.
- Impact: Observable source identity drift cannot authorize `moved`.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2; unchanged in round 6.

### F003 — Nested linked-source destinations are not excluded before migration

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/worktree/worktreeMutationService.ts:1123`
- Title: Nested linked-source destinations are not excluded before migration
- Evidence: The normalized selected-source exclusion still precedes migration.
- Impact: The original wrong-root exclusion mechanism remains closed.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2; unchanged in round 6.

### F004 — An intermediate symlink can make snapshot hashing read outside the source

- Severity: WARN
- Confidence: MEDIUM
- Priority: P2
- Agent: `asm-review-logic`
- Class: feature
- File: `src/worktree/migrateChanges.ts:504`
- Title: An intermediate symlink can make snapshot hashing read outside the source
- Evidence: Parent components remain authorized before and after no-follow reads.
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
- Evidence: The 1 MiB handle cap and exact single-buffer read remain intact.
- Impact: The original excess-allocation mechanism remains closed.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2; unchanged in round 6.

### F006 — Source evidence is not bound to the selected repository registration

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`
- Class: feature
- File: `src/worktree/migrateChanges.ts:878`
- Title: Source evidence is not bound to the selected repository registration
- Evidence: Source/destination evidence and every cache/host/mutation checkpoint remain bound to the selected registration.
- Impact: Wrong-repository or wrong-role source evidence cannot reach migration.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 3; cumulative authority path remains closed in round 6.

### F007 — Raw display spelling defeats normalized selected-source admission

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/providers/WorktreeHost.ts:2804`
- Title: Raw display spelling defeats normalized selected-source admission
- Evidence: Operational source paths remain normalized `WorktreeInfo.id` values.
- Impact: Display aliases cannot bypass source admission or exclusion.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 3; unchanged in round 6.

### F008 — Snapshot budget excludes Git stderr and status-derived retained allocations

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-performance`
- Class: feature
- File: `src/worktree/migrateChanges.ts:583`
- Title: Snapshot budget excludes Git stderr and status-derived retained allocations
- Evidence: Unchanged: the budget charges stdout/filesystem bytes but not the second process-output stream or retained parsed representation.
- Impact: Peak extension-host memory can exceed the nominal 512 MiB budget.
- SuggestedFix: Enforce a total output/representation ceiling or stream parsing with headroom.
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
- Evidence: Unchanged: each affected path repeats component walks around every snapshot read.
- Impact: Deep, large valid changes can spend the deadline in duplicate prefix work.
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
- Evidence: Generation and registration remain co-owned by the same cached record.
- Impact: A current generation cannot join to stale registration A.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 4; unchanged in round 6.

### F011 — Lexical admin placement accepts a redirected `worktrees` directory

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`
- Class: feature
- File: `src/worktree/migrateChanges.ts:913`
- Title: Lexical admin placement accepts a redirected `worktrees` directory
- Evidence: No new evidence demonstrates an unintended repository, source, destination, or false result.
- Impact: The proposed physical-containment restriction remains outside the accepted Git topology contract.
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
- Evidence: Current-root-or-remembered fallback and the both-fail/first-closes witness remain unchanged.
- Impact: Every still-open failed duplicate retains display state without authority.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 5; no round-6 regression intersects the cache.

### F013 — Hidden generations retain authority while Git is unavailable

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security` (corroborated by chair)
- Class: feature
- File: `src/worktree/WorktreeCache.ts:139`
- Title: Hidden generations retain authority while Git is unavailable
- Evidence: Git-unavailable repo-scoped applies and private lookup remain non-authoritative.
- Impact: Retained groups remain display-only during Git unavailability.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 5; no round-6 regression intersects the cache.

### F014 — Retained `rootFor` lets pending offers survive authority withdrawal

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/providers/WorktreeHost.ts:658`
- Title: Retained `rootFor` lets pending offers survive authority withdrawal
- Evidence: Probe completion, redemption, pre-queue handoff, and post-coordinator mutation continue to use current published authority.
- Impact: Retained roots cannot preserve offer authority after withdrawal.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 5; the round-6 predicate reuses the same production binding without altering it.

### F015 — Migration authority is checked after destructive debris clearance

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic` (corroborated by chair)
- Class: feature
- File: `src/worktree/worktreeMutationService.ts:1004`
- Title: Migration authority is checked after destructive debris clearance
- Evidence: Fixed: `migrationAuthorityIsCurrent` runs before the debris authorization/clearance branch and again immediately before `createWorktree`. The focused witness supplies valid authorization and a reachable remover with authority already withdrawn, then proves no removal, no Git add, and an error outcome. Existing tests retain equal-registration success, withdrawn/replaced/missing refusal, free disposition, and no-migration omission.
- Impact: A migration create cannot clear an authorized debris destination when the coordinator rebuild has already withdrawn authority; later withdrawal cannot reach Git add.
- SuggestedFix: None; retain both predicate calls and the combined debris+migration witness.
- Status: fixed
- Triage: Fixed in round 6. Boundary inventory verified: free/debris, migration/no migration, equal/replaced/withdrawn/missing registration, branch validation, authorization redemption, unreadable/partial clearance, final pre-create check, and unchanged production binding.

## Accepted risk

- Status: risk-accepted (user grant; non-gating)
- Owner: worktree subsystem
- Scope: another process may transiently substitute source bytes, intermediate source components, source `.git`, or destination between path observations and restore them before a later comparison; observable divergence is refused or indeterminate
- Expiry: none recorded
- Reactivation: transactional expected-state/typed-result Git APIs, a cross-platform handle-relative filesystem primitive, or an observed substitution incident
- Review note: No deterministic F012-F015 authority defect remains open.

## Support review

The changed test contains no `.only`, unconditional `.skip`, or missing await. It is non-vacuous: the issued authorization matches the path, entry set, device/inode identity, and current directory contents; the injected `clearDebris` remover records any destructive call; the ordinary harness records `git:add`; and the test also requires an error outcome. The pre-fix ordering would call the remover before refusing.

No test or production file outside the F015 cone changed in this remediation range.

## Verification evidence

`bun run asm change verify-status move-uncommitted-work-with-the-intent` records tasks 1_1 through 5_9 at exit 0. Supplied evidence reports the focused WorktreeCache, WorktreeHost, mutation-service, and extension-mutation suites passing; final typecheck passing; 288 files / 7279 tests passing; filesystem-deletion gate passing; production bundle and bundle-requires passing. Full Biome reproduces only the established untouched format failures in `src/agentHooks/AgentHookController.test.ts`, `src/agentHooks/install/ClaudeHookInstaller.test.ts`, and `src/cursor/CursorHookInstaller.test.ts`. No project verify command was run by the chair.

## Sub-agents spawned

- `asm-review-logic`: debris authority ordering — `gpt-5.6-sol[1M]` — no findings
- `asm-review-data-security`: destructive refusal boundary — `gpt-5.6-terra[1M]` — no findings
