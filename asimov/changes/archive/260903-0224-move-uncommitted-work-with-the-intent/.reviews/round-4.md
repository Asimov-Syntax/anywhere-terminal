# Review round 4 — move-uncommitted-work-with-the-intent

- Date: 2026-09-03
- Cycle: 2
- Mode: verification
- Scope: range `bd89af921e865f2f85ebcb557f516d7d51c7e73f..0d7b439f`, plus the cumulative F006/F007/F010 ownership cone and accepted artifacts
- Head: `0d7b439f6396aecc7757af51e1ac13eabc2202cf` (the working tree also contains CLI-generated review analytics outside the persisted round file)
- Reviewable lines: 63 additions — 23 TypeScript production and 40 review-analytics metadata; 41 changed test lines reviewed inline
- Agents spawned: `asm-review-data-security` (cache publication authority; `gpt-5.6-sol[1M]`), `asm-review-logic` (duplicate-folder transitions; `gpt-5.6-terra[1M]`), `asm-review-contracts` (generation/registration contract; `sonnet[1M]`), plus `asm-finder` for the ownership impact cone
- Agents skipped: `asm-review-frontend` — no UI behavior changed. `asm-review-performance` — F008/F009 are unchanged and carried forward. `asm-review-reuse` — the remediation changes the existing cache owner and adds no parallel facility
- Verdict: **REJECT**
- Status: **blocked**
- Counts: 3 BLOCK · 2 WARN · 0 SUGGEST

## Decision

### VERDICT: REJECT

**Why:** F010's stale cross-owner join is closed, but the remediation leaves three gating boundaries open: an order-dependent loss of duplicate-folder retention, a predictable unpublished generation that still resolves private authority while Git is unavailable, and pending offers that survive a degraded authority withdrawal through retained `rootFor` state.

**Blocking:** 3 | **Warnings:** 2 | **Suggestions:** 0
**Status:** BLOCKED

## Scope lock and accepted obligations

The delta is remediation-only. It changes the existing `WorktreeCache` owner and its accepted task-5_1 witness; it adds no capability, task contract, external interface, or new invariant owner. The cycle therefore remains cycle 2 in verification mode. `proposal.md` is absent; intent is reconstructed from the Gate-2-approved `design.md`, task 5_1, round 3, and the supplied impact manifest.

The applicable accepted invariant is D3/F010: one successful whole-tree apply chooses one canonical current root per `repoId`; the generation and private registration produced by that observation are stored and resolved together; every same-repository folder association uses the canonical root; repo-scoped follow-ups revalidate that root; stale, retained, degraded, and Git-unavailable states cannot provide migration authority. F006 and F007 remain the ownership and normalized-source boundaries downstream of that cache result.

## End-to-end verification trace

- Whole-tree observation: `resolveRepoOutcomes` records every folder outcome; `dedupeResolvedRepos` chooses the first currently resolved root per `repoId`; `listRegisteredRepoWorktrees` brackets the listing with that root's private registration.
- F010 core fix: `applyBuild` stores the canonical root's registration in the same `CachedRepo` literal as its new generation. `registrationFor` now reads both from that record instead of joining `repos` to `order`. The supplied A→B witness proves stale-generation refusal, fresh generation/registration/root B, repo-scoped B continuity, and immediate successful-sibling closure retaining B without a public generation.
- Downstream ownership: the controller carries the normalized row id and public generation; the host resolves it through `registrationFor`; source evidence, role, common repository, destination capture, pre-call state, and post-call state remain bound to that registration. F006 and F007 remain closed on the ordinary authoritative path.
- Duplicate failure fallback: after both same-repository folders fail, `next.has(repoId)` no longer proves a current sibling exists. The changed branch asks only `currentRoots`, drops the later failed folder's remembered mapping, and can later erase the retained group when the first folder closes.
- Git-unavailable fallback: a successful repo-scoped apply can cache a new sequential generation/registration while global `gitAvailable` remains false. Public reads hide the number, but `registrationFor` does not check the global state and resolves a predictable value.
- Pending-offer fallback: probe completion, redemption, and the final pre-create host check compare the offer binding to retained `rootFor(...).registration`, not to current cached authority. The new canonical-B retention therefore keeps those checks true after the cache has cleared generation/registration authority.

## Findings

### F001 — The created destination is never bound to the checkout that receives the move

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`
- Class: feature
- File: `src/worktree/migrateChanges.ts:777`
- Title: The created destination is never bound to the checkout that receives the move
- Evidence: Destination capture remains immediate after create and requires the pre-offer common-directory registration; pre/post migration evidence rechecks it.
- Impact: The round-1 unintended-destination mechanism remains closed.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2; outside the F010 delta and unchanged in round 4.

### F002 — Post-verification can report moved after observable source `.git` substitution

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/worktree/migrateChanges.ts:1114`
- Title: Post-verification can report moved after observable source `.git` substitution
- Evidence: Post-call source evidence and snapshot remain bracketed and reauthorize the retained repository binding.
- Impact: Observable post-call source identity drift cannot authorize `moved`.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2; unchanged in round 4.

### F003 — Nested linked-source destinations are not excluded before migration

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/worktree/worktreeMutationService.ts:1106`
- Title: Nested linked-source destinations are not excluded before migration
- Evidence: The selected-source exclusion still precedes migration and receives the normalized source id; independent main-checkout hygiene remains nonfatal.
- Impact: The original wrong-root exclusion mechanism remains closed.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2; unchanged in round 4.

### F004 — An intermediate symlink can make snapshot hashing read outside the source

- Severity: WARN
- Confidence: MEDIUM
- Priority: P2
- Agent: `asm-review-logic`
- Class: feature
- File: `src/worktree/migrateChanges.ts:504`
- Title: An intermediate symlink can make snapshot hashing read outside the source
- Evidence: Affected-path parent components remain authorized before and after the no-follow final read.
- Impact: Persistent intermediate redirection remains refused.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2; the user-accepted transient ABA interval is unchanged.

### F005 — A hostile `.git` file can double the nominal snapshot memory bound

- Severity: WARN
- Confidence: MEDIUM
- Priority: P3
- Agent: `asm-review-logic`
- Class: feature
- File: `src/worktree/migrateChanges.ts:414`
- Title: A hostile `.git` file can double the nominal snapshot memory bound
- Evidence: The 1 MiB opened-handle cap and exact single-buffer read remain in place.
- Impact: The original chunk-retention plus concatenation peak remains closed.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2; unchanged in round 4.

### F006 — Source evidence is not bound to the selected repository registration

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`
- Class: feature
- File: `src/worktree/migrateChanges.ts:878`
- Title: Source evidence is not bound to the selected repository registration
- Evidence: The production probe and migration adapter still require one `MigrationRepositoryBinding`; source role, common path and identity, linked placement, canonical back-pointer, destination capture, and pre/post snapshots reauthorize it.
- Impact: A stable cross-repository source or wrong source role cannot reach migration on an authoritative cache path.
- SuggestedFix: None; retain the wrong-repository, role, registration-replacement, topology, and back-pointer witnesses.
- Status: fixed
- Triage: Fixed in round 3 and reverified in round 4 through publication, offer, redemption, queued handoff, destination capture, and migration. F013/F014 are separate cache/offer-authority mechanisms.

### F007 — Raw display spelling defeats normalized selected-source admission

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/providers/WorktreeHost.ts:2798`
- Title: Raw display spelling defeats normalized selected-source admission
- Evidence: Row selection, source probing, offer storage, internal create request, path validation, and migration exclusion continue to use `WorktreeInfo.id`; `displayPath` remains presentation-only.
- Impact: Symlink-spelled selected sources can reach the normalized nested-destination exclusion flow.
- SuggestedFix: None; retain normalized-id, source-generation, and nested assembly witnesses.
- Status: fixed
- Triage: Fixed in round 3 and reverified in round 4.

### F008 — Snapshot budget excludes Git stderr and status-derived retained allocations

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-performance`
- Class: feature
- File: `src/worktree/migrateChanges.ts:583`
- Title: Snapshot budget excludes Git stderr and status-derived retained allocations
- Evidence: Unchanged from round 2: the budget charges stdout and filesystem bytes but not a second process-output stream or the retained parsed representation.
- Impact: Peak extension-host memory can materially exceed the nominal 512 MiB snapshot budget.
- SuggestedFix: Enforce a total output/representation ceiling or stream porcelain parsing with explicit headroom.
- Status: accepted
- Triage: Persists as a non-gating WARN. This is accepted triage, not user risk acceptance.

### F009 — Parent authorization repeats full component scans for every affected path

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-performance`
- Class: feature
- File: `src/worktree/migrateChanges.ts:467`
- Title: Parent authorization repeats full component scans for every affected path
- Evidence: Unchanged from round 2: every affected path repeats relative and absolute component walks before and after reads at each snapshot phase.
- Impact: Deep, large valid change sets can consume the availability deadline in duplicate prefix work.
- SuggestedFix: Reuse per-snapshot prefix construction while retaining immediate before/after identity revalidation.
- Status: accepted
- Triage: Persists as a non-gating WARN. This is accepted triage, not user risk acceptance.

### F010 — A fresh generation can resolve to a stale repository registration

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security` (corroborated by chair and `asm-review-contracts`)
- Class: feature
- File: `src/worktree/WorktreeCache.ts:333`
- Title: A fresh generation can resolve to a stale repository registration
- Evidence: Fixed: `CachedRepo` now stores registration beside generation; `merge` co-assigns or co-clears both; `currentRoots` supplies B to the fresh cache record and duplicate folder mappings; `registrationFor` reads only that record. The supplied witness proves A is stale, B owns the fresh generation/root, repo-scoped follow-up remains B, and immediate sibling closure leaves no public generation.
- Impact: The original cross-owner join from fresh public generation to stale private registration is closed.
- SuggestedFix: None for the original mechanism; retain the A→B witness.
- Status: fixed
- Triage: Fixed in round 4. F012, F013, and F014 are distinct boundary mechanisms and impacts, so they receive new IDs.

### F011 — Lexical admin placement accepts a redirected `worktrees` directory

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`
- Class: feature
- File: `src/worktree/migrateChanges.ts:913`
- Title: Lexical admin placement accepts a redirected `worktrees` directory
- Evidence: The proposed witness proves alternate physical placement of Git's own internal directory while retaining the same registered common directory, selected source, linked role, admin evidence, and canonical back-pointer.
- Impact: No unintended repository, source, destination, work content, or false `moved` result was demonstrated.
- SuggestedFix: None.
- Status: rejected
- Triage: Round-3 arbiter rejection stands; no materially new evidence reopens it.

### F012 — A second failing duplicate folder loses the retained repository mapping

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/worktree/WorktreeCache.ts:199`
- Title: A second failing duplicate folder loses the retained repository mapping
- Evidence: After failed-first/current-second B, a later build where both `/a` and `/a/sub` fail has no `currentRoots`. The first failure inserts the retained repo into `next`; the second then enters `remembered && next.has(repoId)` and assigns `resolved = currentRoots.get(repoId)`, which is `undefined`, so `/a/sub` is omitted from `nextRepoByFolder`. A targeted cache probe retained one group after both failures but dropped it to zero when `/a` closed and only still-failing `/a/sub` remained.
- Impact: A failed scan plus folder-order transition falsely removes a still-open repository's last-good two-worktree group and disposes its watch, violating I8, D3, task 5_1's every-folder association, and the cache's last-good retention contract.
- SuggestedFix: Distinguish a repo present in `next` because a current sibling resolved from one present only because an earlier failed folder retained it. Use the current canonical root when it exists; otherwise preserve each failed folder's remembered root. Add the both-fail → first-folder-closes witness.
- Status: accepted
- Triage: New round-4 gating finding inside the exact duplicate-folder retention cone. Invariant: every still-open failed folder must retain the last-good repository association unless a current successful root supersedes it. Affected: multiple same-repository folders that all fail before the earlier folder closes. Verified safe: the supplied failed-first/current-second B sequence and immediate closure of the successful sibling while the earlier failed folder remains.

### F013 — Hidden generations retain authority while Git is unavailable

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security` (corroborated by chair)
- Class: feature
- File: `src/worktree/WorktreeCache.ts:333`
- Title: Hidden generations retain authority while Git is unavailable
- Evidence: A Git-unavailable whole-tree build clears the retained record's generation/registration, but a later successful `applyRepo` calls `merge`, caches the next sequential generation and the retained root's registration, and leaves global `gitAvailable` false. `copyRepo` hides the number, while `registrationFor` checks only the cached generation. A targeted probe observed public generation 1, then no public generation with `gitAvailable: false`, while `registrationFor(repoId, 2)` still returned the private registration. The host accepts any positive safe integer before that lookup.
- Impact: A client that observed N can quote predictable N+1 and make the host resolve private registration and start a migration-source probe from a group whose public contract says it has no authority. Git-unavailable retention is display-only, not an authorization source.
- SuggestedFix: Make `registrationFor` refuse while `gitAvailable` is false and preferably prevent repo-scoped applies from minting cached authority in that state. Add cache and host witnesses for Git-unavailable → successful repo-scoped apply → guessed generation, proving no probe or offer.
- Status: accepted
- Triage: New round-4 gating finding. Invariant: an unpublished generation cannot authorize an untrusted request, and Git-unavailable groups expose neither generation nor registration authority. Affected: retained groups followed by a successful repo-scoped listing while global Git capability remains unavailable. Verified safe: ordinary authoritative whole-tree and repo-scoped B publications.

### F014 — Retained `rootFor` lets pending offers survive authority withdrawal

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/providers/WorktreeHost.ts:2818`
- Title: Retained `rootFor` lets pending offers survive authority withdrawal
- Evidence: The F010 remediation intentionally makes the failed folder retain canonical root B after its successful sibling closes, while the cache clears generation/registration authority. Probe completion compares only `cache.rootFor(repoId)?.registration` with the original B registration and can therefore deliver an offer after degradation. Existing-offer redemption at line 2271 and the final host pre-create check at line 2315 repeat the same retained-root comparison and retained-row lookup; none asks for the cache's current authoritative registration or generation. Rebuilds do not retire migration readings/offers for a repository that remains displayed.
- Impact: A migration offer that began while B was authoritative remains mintable and redeemable after the cache states that the group is retained/degraded and has no registration authority. This falsifies D3's completion/redemption current-binding requirement and reopens the F006 ownership handoff through a different mechanism.
- SuggestedFix: At probe completion, redemption, and final host handoff, compare the offer binding with the cache's currently authoritative registration, derived from a currently published generation, rather than with `rootFor`. This must continue to allow a repo-scoped generation advance that revalidates the same B registration while refusing retained/degraded/Git-unavailable states. Add pending-probe and issued-offer degradation witnesses.
- Status: accepted
- Triage: New round-4 gating finding inside the offer lifecycle and successful-sibling-closure impact cone. Invariant: retained roots support display and follow-up discovery, never current action authority. Affected: pending probes and issued offers across any degradation that keeps the same root registration. Verified safe: replacement B→C, which changes `rootFor` and is already refused; new offers from a degraded group without a guessed generation are also refused.

## Accepted risk

- Status: risk-accepted (user grant; non-gating)
- Owner: worktree subsystem
- Scope: another process may transiently substitute source bytes, an intermediate source component, source `.git`, or the destination between path-based observations and restore it before a later comparison; execution-time named-path work is authorized, while persistent or observed divergence is refused or indeterminate
- Expiry: none recorded
- Reactivation: `vscode.git` exposes transactional expected-state and typed-result inputs; Node exposes a cross-platform handle-relative filesystem primitive; or a source/destination substitution incident is observed
- Review note: F012-F014 are deterministic cache/offer state transitions, not unobservable path ABA intervals.

## Support review

The changed test has no `.only`, unconditional `.skip`, or missing async wait. Its A→B assertions are non-vacuous and close F010's quoted mechanism. It does not cover the later all-duplicate-fail transition that exposes F012. The existing Git-unavailable test asserts only that `read()` withholds the generation, so it cannot detect F013's private `registrationFor` authority. Existing offer tests cover replacement and fresh degraded asks, not an in-flight probe or issued offer crossing into degradation, so they cannot detect F014.

## Verification evidence

`bun run asm change verify-status move-uncommitted-work-with-the-intent` records tasks 1_1 through 5_1 at exit 0. Supplied current-head evidence reports type-check passing; 288 files / 7269 tests passing; filesystem-deletion gate passing; production bundle and bundle-requires passing; and all changed files passing Biome. Full Biome reports only the established clean-tree formatting errors in untouched `src/agentHooks/AgentHookController.test.ts`, `src/agentHooks/install/ClaudeHookInstaller.test.ts`, and `src/cursor/CursorHookInstaller.test.ts`. No project verify command was run by the chair. Two targeted in-memory cache probes were used only to reproduce F012 and F013.

## Sub-agents spawned

- `asm-review-data-security`: cache publication and migration authority — `gpt-5.6-sol[1M]`
- `asm-review-logic`: duplicate-folder transitions and state lifecycle — `gpt-5.6-terra[1M]`
- `asm-review-contracts`: generation/registration cache contract — `sonnet[1M]`
- `asm-finder`: ownership impact-cone mapping — support only
