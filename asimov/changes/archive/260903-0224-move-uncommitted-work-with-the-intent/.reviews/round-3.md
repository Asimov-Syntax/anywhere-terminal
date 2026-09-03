# Review round 3 — move-uncommitted-work-with-the-intent

- Date: 2026-09-03
- Cycle: 2
- Mode: verification
- Arbiter: yes
- Scope: range `569ca05cd7fe929b7443656ebb1ce4f61bb26a91..bd89af921e865f2f85ebcb557f516d7d51c7e73f`, plus the cumulative F006/F007 impact cone and accepted artifacts
- Head: `bd89af921e865f2f85ebcb557f516d7d51c7e73f` (the working tree also contains dirty generated review analytics outside the reviewed range)
- Reviewable lines: 256 scoped TypeScript production additions; changed tests reviewed inline
- Agents spawned: `asm-review-data-security` (repository registration and source/destination ownership; `gpt-5.6-sol[1M]`), `asm-review-logic` (registration lifecycle, races and execution flow; `gpt-5.6-terra[1M]`), `asm-review-contracts` (public generation/private registration contract; `sonnet[1M]`)
- Agents skipped: `asm-review-frontend` — no rendering or consent behavior changed; controller identity transport was covered by contracts and chair. `asm-review-performance` — F008/F009 were not remediated and are carried unchanged. `asm-review-reuse` — the delta composes the existing `AuthorizedDirectory`, cache, discovery and migration owners rather than adding a parallel facility
- Verdict: **BLOCK**
- Status: **blocked**
- Counts: 1 BLOCK · 2 WARN · 0 SUGGEST

## Decision

### VERDICT: BLOCK

**Why:** F006 and F007 are closed, but one whole-tree merge path can publish a fresh generation while resolving it to stale private repository-registration evidence.

**Blocking:** 1 | **Warnings:** 2 | **Suggestions:** 0
**Status:** BLOCKED

## Verification scope and accepted obligations

Round 2 froze F006 and F007 as the gating set. The accepted replan adds tasks 4_1–4_5 and amends D2/D3/D5/D6/D8: repository resolution captures private common-directory evidence; listings are bracketed by it; only a public generation crosses the tree/wire; row selection freezes normalized id plus generation; the host synchronously maps them back to the private registration and source role; the binding remains current through offer, redemption, queued rebuild, destination capture and migration; source and destination must match that pre-offer common repository before the API and later work.

The user-accepted residual remains unchanged: an unobservable transient ABA substitution between named-path observations may receive the path-based operation. Persistent or observed source, common-directory, registration, role, destination or snapshot divergence must withhold the offer or become indeterminate.

## End-to-end verification trace

- Repository publication: `resolveOne` normalizes the common directory and captures an `AuthorizedDirectory`; `listRegisteredRepoWorktrees` lists through the resolved root and reauthorizes the retained common directory afterward. A changed registration degrades rather than publishing an authoritative listing.
- Private/public split: `WorktreeCache` stores `ResolvedRepo.registration` outside `WorktreeRepo`. Public groups receive only a generation. The controller freezes the selected normalized worktree id plus that generation; repository and toolbar doors remain source-free, and repository switching omits the source pair.
- Offer: the host requires a positive safe generation, maps it through `registrationFor`, uses `WorktreeInfo.id` rather than `displayPath`, binds the row's `main | linked` role, and probes under that private registration. Probe completion rechecks opening, source, role and current registration before minting an opaque offer.
- Redemption and queue: the host rechecks token, opening, repository, source row, role, current registration and a fresh registration-bound source probe. The queued create carries only host-held normalized path, evidence, snapshot and private binding.
- Destination and API: after `git worktree add`, destination capture must match the retained common registration. The selected-source exclusion is derived from the normalized source id. Pre-call and post-call source/destination snapshots each reauthorize the binding; wrong repository, role, common identity, linked topology, back-pointer, source/destination evidence or result state becomes indeterminate before later work.
- Remaining failure: `WorktreeCache.applyBuild` can assemble the public group/generation from one current `ResolvedRepo` but keep a different remembered `ResolvedRepo` first in `order`. `registrationFor` checks the fresh generation in `repos` and then returns the stale registration from `order`, breaking the generation-to-registration join that all later checks trust.

## Findings

### F001 — The created destination is never bound to the checkout that receives the move

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`
- Class: feature
- File: `src/worktree/migrateChanges.ts:777`
- Title: The created destination is never bound to the checkout that receives the move
- Evidence: Destination capture remains immediate after create and now additionally requires the pre-offer common-directory registration; pre/post migration evidence rechecks it.
- Impact: The round-1 unintended-destination mechanism remains closed.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and reverified through the new registration binding.

### F002 — Post-verification can report moved after observable source `.git` substitution

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/worktree/migrateChanges.ts:1114`
- Title: Post-verification can report moved after observable source `.git` substitution
- Evidence: Post-call source evidence and snapshot remain bracketed, and now also reauthorize the retained repository binding.
- Impact: Observable post-call source identity drift cannot authorize `moved`.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and reverified.

### F003 — Nested linked-source destinations are not excluded before migration

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/worktree/worktreeMutationService.ts:1106`
- Title: Nested linked-source destinations are not excluded before migration
- Evidence: The selected-source exclusion still precedes migration and now receives the normalized source id retained by the host; independent main-checkout hygiene remains nonfatal.
- Impact: The original wrong-root exclusion mechanism remains closed.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and reverified alongside F007.

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
- Triage: Fixed in round 2; the explicitly accepted transient ABA interval is unchanged.

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
- Triage: Fixed in round 2 and reverified.

### F006 — Source evidence is not bound to the selected repository registration

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`
- Class: feature
- File: `src/worktree/migrateChanges.ts:878`
- Title: Source evidence is not bound to the selected repository registration
- Evidence: Fixed: the production probe requires `MigrationRepositoryBinding`; `evidenceMatchesBinding` reauthorizes the retained common directory, common path and inode, source role, linked admin placement and canonical back-pointer path plus `.git` identity. The host carries the same private registration through token redemption and the mutation path, and source/destination are both rechecked before and after the API.
- Impact: A stable cross-repository source or wrong source role no longer reaches migration.
- SuggestedFix: None; retain the wrong-repository, role, registration-replacement, topology and back-pointer witnesses.
- Status: fixed
- Triage: Fixed from round 2. Boundary inventory verified: bracketed listing, generation lookup, offer probe, completion, redemption, queued handoff, destination capture, pre-call and post-call binding. F010 separately covers a cache join that can associate the wrong retained registration with an otherwise valid generation.

### F007 — Raw display spelling defeats normalized selected-source admission

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/providers/WorktreeHost.ts:2798`
- Title: Raw display spelling defeats normalized selected-source admission
- Evidence: Fixed: row selection freezes `WorktreeInfo.id`; the host probes and stores `source.id`; the internal request, create-path allowance and migration exclusion all receive that normalized path. `displayPath` remains presentation-only.
- Impact: Symlink-spelled selected sources can reach the normalized nested-destination exclusion flow.
- SuggestedFix: None; retain normalized-id, source generation and nested assembly witnesses.
- Status: fixed
- Triage: Fixed from round 2. Row door, toolbar/repository omission, repository switch, offer, redemption, path validation and exclusion were rechecked.

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
- Triage: Persists from round 2 as a non-gating WARN. This is accepted triage, not user risk acceptance.

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
- Triage: Persists from round 2 as a non-gating WARN. This is accepted triage, not user risk acceptance.

### F010 — A fresh generation can resolve to a stale repository registration

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security` (corroborated by chair)
- Class: feature
- File: `src/worktree/WorktreeCache.ts:319`
- Title: A fresh generation can resolve to a stale repository registration
- Evidence: `applyBuild` constructs `next` from the current build's assembled repositories, but its folder-outcome pass can put a remembered `ResolvedRepo` into `nextOrder` first. When an earlier workspace folder fails resolution while a later folder successfully resolves the same `repoId`, lines 185–202 select the earlier folder's remembered root because `next` already contains that repo, then suppress the later current root as a duplicate. `repos` therefore holds the current listing and fresh generation while `order` holds the old registration. `registrationFor` validates the generation against `repos` and returns the registration from `order`, joining values from different observations. A replacement A → B observed by the successful listing, followed by A again before the offer probe, can make the new generation authorize A even though B produced the publication.
- Impact: The required continuity from bracketed listing to public generation and private registration is false. A whole-tree repository replacement that was actually observed can be hidden, allowing an offer and migration binding for a different incarnation than the selected publication. This is not the accepted transient ABA interval because the build observed and published from B.
- SuggestedFix: Canonicalize one current successful `ResolvedRepo` per `repoId` before the folder-retention pass. When a failed folder remembers a repository also resolved by another current folder, retain only the folder association; use the current root/registration in `nextRepoByFolder` and `nextOrder`. Store generation and registration together in one cached record or otherwise make `registrationFor` return the registration from the same successful apply that minted the generation. Add a two-folder witness: first folder fails with remembered registration A, second resolves/list-brackets registration B, and the published generation resolves only to B.
- Status: accepted
- Triage: New round-3 gating finding. Invariant: a public generation must map to the exact private registration that bracketed the listing it publishes. Boundary inventory searched: whole-tree root resolution, duplicate repo folders, failed-folder retention, current successful sibling resolution, `next` merge, `nextOrder`, generation minting and `registrationFor`. Affected: whole-tree builds where an earlier failed folder remembers the same repo a later folder currently resolves. Verified safe: ordinary single-folder builds, all-success duplicate folders, repo-scoped rebuilds and stale-generation rejection.

### F011 — Lexical admin placement accepts a redirected `worktrees` directory

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`
- Class: feature
- File: `src/worktree/migrateChanges.ts:913`
- Title: Lexical admin placement accepts a redirected `worktrees` directory
- Evidence: The linked-role test compares the admin parent spelling with `<common>/worktrees`; an intermediate symlink can place the physical admin directory elsewhere while preserving that spelling, common identity and canonical back-pointer.
- Impact: The specialist alleged that physical placement outside the common directory lets a misplaced linked admin entry reach migration.
- SuggestedFix: The specialist proposed canonicalizing both admin parents.
- Status: rejected
- Triage: Arbiter rejected. The accepted D3/task-4_3 contract requires a linked gitfile whose admin path is under the registered repository's Git `worktrees/` path, plus the canonical back-pointer and `.git` file identity; it does not impose physical containment on the implementation of Git's own `worktrees` directory. The proposed witness remains the same Git common directory, the same selected source path, a Git-listed linked role, a revalidated common-directory identity, a bracketed admin identity/files, and the exact canonical `.git` back-pointer. No different repository, source, destination, work content or false `moved` result is demonstrated. Canonical-parent containment would add a new filesystem-topology restriction and could reject a Git repository whose internal `worktrees` directory is intentionally symlinked. No concrete defect survives.

## Arbiter dispositions

- F010 — **accepted**: generation and private registration are demonstrably read from different cache owners after the two-folder failed/current build; this directly falsifies D3's publication-to-registration binding. Gating; the change parks.
- F011 — **rejected**: the evidence proves alternate physical placement of Git's own internal directory, not an unintended repository/source/destination or violation of the accepted canonical back-pointer contract.

## Accepted risk

- Status: risk-accepted (user grant; non-gating)
- Owner: worktree subsystem
- Scope: another process may transiently substitute source bytes, an intermediate source component, source `.git`, or the destination between path-based observations and restore it before a later comparison; execution-time named-path work is authorized, while persistent or observed divergence is refused or indeterminate
- Expiry: none recorded
- Reactivation: `vscode.git` exposes transactional expected-state and typed-result inputs; Node exposes a cross-platform handle-relative filesystem primitive; or a source/destination substitution incident is observed
- Review note: F010 is an observed cross-owner mismatch inside the cache, not an unobservable path ABA interval.

## Support review

Changed production paths have corresponding tests, and no changed test introduces `.only` or unconditional `.skip`. The supplied witnesses directly cover F006/F007's expected repository, role, common-directory replacement, linked topology/back-pointer, normalized source generation, degraded refusal, whole-tree replacement invalidation, repo-scoped continuity, binding handoff and nested-source exclusion. The missing two-folder failed/current duplicate-repository witness aligns with F010.

## Verification evidence

`bun run asm change verify-status move-uncommitted-work-with-the-intent` records tasks 1_1 through 4_6 at exit 0. Supplied final-gate evidence reports type-check passing; 288 files / 7268 tests passing; filesystem-deletion gate passing; production bundle and bundle-requires passing. Full Biome reports only the established clean-tree formatting errors in untouched `src/agentHooks/AgentHookController.test.ts`, `src/agentHooks/install/ClaudeHookInstaller.test.ts`, and `src/cursor/CursorHookInstaller.test.ts`; all changed paths pass check mode. No project verify command was run by the chair.

## Sub-agents spawned

- `asm-review-data-security`: repository registration and source/destination ownership — `gpt-5.6-sol[1M]`
- `asm-review-logic`: registration lifecycle, races and execution flow — `gpt-5.6-terra[1M]`
- `asm-review-contracts`: public generation/private registration contract — `sonnet[1M]`
