# Review round 2 — move-uncommitted-work-with-the-intent

- Date: 2026-09-03
- Cycle: 2
- Mode: discovery
- Scope: range `eb1cca4595d3ba913da3ff7eb5b67758ac968ec0..569ca05c`, restricted to WT-012.10 accepted artifacts and cumulative implementation; unrelated merged/archive work in the range was context only
- Head: `569ca05cd7fe929b7443656ebb1ce4f61bb26a91` (the working tree is dirty only from the review protocol's `workflow.md` round marker)
- Reviewable lines: 1659 scoped TypeScript production additions; changed tests and behavioral artifacts reviewed inline. Large change — accuracy may decrease
- Intent context: Gate 2 is approved. `proposal.md` is absent; obligations were reconstructed from approved `workflow.md`, `tasks.md`, `design.md`, `specs/worktree-panel/spec.md`, blueprint WT-012.10, and round 1
- Agents spawned: `asm-review-data-security` (source/destination identity and repository ownership; `gpt-5.6-sol[1M]`), `asm-review-logic` (snapshot proof, races, ordering and errors; `gpt-5.6-terra[1M]`), `asm-review-contracts` (wire/host/Git contracts; `sonnet[1M]`), `asm-review-performance` (byte, record and syscall growth axes; `gpt-5.6-terra[1M]`), `asm-review-reuse` (identity/path/exclusion reuse; `gpt-5.6-luna[1M]`), `asm-review-frontend` (consent and uncertainty rendering; `gpt-5.6-luna[1M]`)
- Agents skipped: none
- Verdict: **BLOCK**
- Status: **blocked**
- Counts: 2 BLOCK · 2 WARN · 0 SUGGEST
- Split: 2 feature · 0 machinery

## Decision

### VERDICT: BLOCK

**Why:** The destination-side round-1 findings are closed, but a persistently substituted source can still be accepted from another repository, and normalized worktree identity is lost when admitting a destination nested under a symlink-spelled source.

**Blocking:** 2 | **Warnings:** 2 | **Suggestions:** 0

## Accepted obligations

Gate 2 accepts D1–D8 and tasks 1_1–3_2. This cycle reviewed the complete flow under the accepted best-effort identity boundary: one row-selected source; opaque host-held consent; complete bounded status and path-state snapshot; exact VS Code Git call; immediate destination registration capture; selected-source exclusion before migration; source/destination evidence bracketing before and after the API; `moved` only for an empty source plus the expected non-conflicted destination working-tree state; every other result preserves the successful create, stops later work, and reports uncertainty.

The user explicitly accepts only transient ABA substitutions that occur between named-path observations and are restored before the next observation. Persistent or observable source, component, `.git`, registration, destination, snapshot, or result divergence remains a refusal or indeterminate outcome.

## Full-flow trace

- Entry and offer: a row opening retains normalized `WorktreeInfo.id`, while the host currently chooses the row's raw `displayPath` as the filesystem source. The host opens that path through the active Git API, brackets a complete source snapshot with directory/`.git`/admin/common metadata evidence, stores it behind an opaque token, and sends only token plus count. Repository and toolbar openings carry no source.
- Consent and redemption: the form starts unchecked, clears the selection on offer/repository/mode replacement, and submits only the current token. The host validates surface, opening, repository, source row and eligible create mode, consumes the token once, and repeats the source probe before enqueueing host-held evidence.
- Create and migration: queued create re-runs path validation, creates the checkout, immediately captures destination directory/`.git`/admin/common/back-pointer evidence, requires the selected-source exclusion, attempts independent main-checkout hygiene, opens exact source and destination repositories, brackets clean pre-call snapshots with retained identities, and invokes destination `migrateChanges(sourcePath, { confirmation: false, deleteFromSource: true, untracked: true })`.
- Outcome: after resolution, source and destination are bracketed again. Empty source, retained source/destination identities, matching destination record topology and matching path states yield `moved`; every missing read, API rejection, observable drift, conflict or mismatch is indeterminate. Indeterminate returns from the successful-create arm before authorization, provisioning, ports or `afterCreate`; the webview renders a warning-tone successful-create notice directing inspection of source, destination and Git stashes.
- Remaining gaps: the source probe has no expected common-repository input, so its first stable baseline may already be another repository; and the raw `displayPath` passed as `sourcePath` does not equal the normalized ids used by create containment and can reject the accepted nested-source case.

## Findings

### F001 — The created destination is never bound to the checkout that receives the move

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`
- Class: feature
- File: `src/worktree/migrateChanges.ts:770`
- Title: The created destination is never bound to the checkout that receives the move
- Evidence: Fixed by immediate `captureMigrationDestination(repoId, path)` after `git worktree add`, which requires the destination common repository, admin-directory placement and `gitdir` back-pointer; the retained evidence is compared before and after the API call.
- Impact: The prior unintended-destination move path is closed.
- SuggestedFix: None; retain the destination replacement and back-pointer witnesses.
- Status: fixed
- Triage: Fixed from round 1. Invariant inventory rechecked: post-add capture, exact repository open, clean pre-call destination, API receiver, post-call destination identity and result snapshot are now covered. The accepted transient ABA interval remains explicitly outside the observable proof.

### F002 — Post-verification can report moved after observable source `.git` substitution

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/worktree/migrateChanges.ts:1023`
- Title: Post-verification can report moved after observable source `.git` substitution
- Evidence: Fixed: post-call verification now uses `captureMigrationOfferEvidence` for the source and requires `sameSourceEvidence(afterSource.source, input.source)` beside the empty source snapshot.
- Impact: Observable post-call source identity drift can no longer authorize later work as `moved`.
- SuggestedFix: None; retain the post-call `.git`/admin substitution witnesses.
- Status: fixed
- Triage: Fixed from round 1. Offer, redemption, queued recheck, pre-call and post-call source identity boundaries were re-inventoried; all compare the retained evidence once a valid baseline exists. F006 separately covers the missing repository ownership of that baseline.

### F003 — Nested linked-source destinations are not excluded before migration

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair (corroborated by `asm-review-logic`)
- Class: feature
- File: `src/worktree/worktreeMutationService.ts:1092`
- Title: Nested linked-source destinations are not excluded before migration
- Evidence: Fixed: the migration-specific exclusion is derived from `request.migration.sourcePath`, runs before migration, is migration-critical, and is independent from nonfatal main-checkout hygiene; identical rules deduplicate.
- Impact: A normally spelled linked-source destination can now reach migration without entering the source snapshot.
- SuggestedFix: None for the original mechanism; F007 covers the remaining normalized-id/raw-display spelling mismatch.
- Status: fixed
- Triage: Fixed from round 1. Main-source, linked-source, outside-source, critical failure, independent hygiene and dedup boundaries were rechecked.

### F004 — An intermediate symlink can make snapshot hashing read outside the source

- Severity: WARN
- Confidence: MEDIUM
- Priority: P2
- Agent: `asm-review-logic`
- Class: feature
- File: `src/worktree/migrateChanges.ts:497`
- Title: An intermediate symlink can make snapshot hashing read outside the source
- Evidence: Fixed: each affected path now authorizes its existing parent chain before the no-follow final-component read and repeats the authorization afterward, rejecting static or persisting intermediate symlinks and changed component identities.
- Impact: Persistent intermediate redirection no longer produces a snapshot hash outside the selected source.
- SuggestedFix: None; retain static, missing-parent and persistent replacement witnesses.
- Status: fixed
- Triage: Fixed from round 1. Final symlinks remain represented as symlink state. Only the user-accepted transient ABA interval between observations remains.

### F005 — A hostile `.git` file can double the nominal snapshot memory bound

- Severity: WARN
- Confidence: MEDIUM
- Priority: P3
- Agent: `asm-review-logic`
- Class: feature
- File: `src/worktree/migrateChanges.ts:407`
- Title: A hostile `.git` file can double the nominal snapshot memory bound
- Evidence: Fixed: linked-worktree `.git` and retained metadata text reject sizes above 1 MiB before allocation, use one exact-sized buffer, and verify handle/path identity after the read. The cap remains above the documented usable host path envelope.
- Impact: The prior chunk retention plus `Buffer.concat` near-gigabyte peak is closed.
- SuggestedFix: None; retain over-cap, exact-allocation and long-path witnesses.
- Status: fixed
- Triage: Fixed from round 1. F008 separately covers Git process output and parsed-record allocations outside this reader.

### F006 — Source evidence is not bound to the selected repository registration

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security` (corroborated by chair)
- Class: feature
- File: `src/providers/WorktreeHost.ts:2771`
- Title: Source evidence is not bound to the selected repository registration
- Evidence: The host locates a cached source row under `msg.repoId` but calls `probeMigrationSource(sourcePath)` without the expected repository identity, both when issuing the offer and at redemption (`WorktreeHost.ts:2287`). The probe records `git.commonPath`, `commonIdentity` and an optional back-pointer, but never requires the common path to equal the selected `repoId` or validates a linked source's admin placement/back-pointer. `migrateChanges` then compares source and destination evidence independently and never requires them to share the selected common repository. A stable replacement of the cached source path's `.git` with a dirty checkout from repository B can therefore become the initial baseline, survive every later equality check, and be passed to repository A's destination.
- Impact: Uncommitted work from an unrelated checkout can be stashed and deleted from its source, applied to the new destination, and potentially reported `moved`; an incompatible apply is still destructive because the upstream integration creates the source stash before recovery. This is persistent substitution, not the accepted transient ABA interval.
- SuggestedFix: Bind source probing to the expected `repoId`; require common path/identity ownership and, for linked sources, admin placement plus the `gitdir` back-pointer to the selected source `.git`. Carry and re-enforce the expected common repository before API entry. Add a stable cross-repository source-replacement witness that produces no offer and no API call, while retaining standalone separate-git-dir support when that admin directory is the expected common repo.
- Status: accepted
- Triage: New cycle-2 gating finding. Invariant: a source baseline must prove it is the selected row's registration in the selected common repository. Boundary inventory searched: cached row lookup, offer probe, redemption probe, queued recheck, exact repository open, pre-call evidence and post-call proof. Affected: initial source ownership and every later check derived from that unbound baseline. Verified safe: once a correctly owned baseline exists, persistent subsequent identity drift is detected; destination repository ownership is independently checked.

### F007 — Raw display spelling defeats normalized selected-source admission

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/providers/WorktreeHost.ts:2769`
- Title: Raw display spelling defeats normalized selected-source admission
- Evidence: Worktree discovery deliberately keeps Git's exact spelling in `displayPath` while `id` is normalized (`WorktreeDiscovery.ts:163-172`, directly witnessed with `/var/repo` versus `/private/var/repo`). Migration stores `source.displayPath` as `sourcePath`. Create context, however, lists normalized worktree ids (`WorktreeHost.ts:3984-3988`), and `validateCreatePath` admits a containing linked worktree only when `normalizePathForCompare(sourcePath)` equals that normalized id (`createPath.ts:207-215`); on POSIX that helper does no realpath normalization. The production exclusion repeats the raw comparison at `extension.ts:743-746`. A selected linked source reported through a symlink alias therefore cannot create a nested destination under its normalized location, despite D4/D6 requiring that case.
- Impact: A valid row-context create is rejected before `git worktree add` on supported symlink-spelled paths, so the accepted selected-source nested-destination flow remains unavailable on cases the worktree identity model explicitly supports.
- SuggestedFix: Carry the normalized `WorktreeInfo.id` as the host-held operational source path/identity and keep `displayPath` presentation-only, or normalize the source once through the same owner used for worktree ids before containment and exclusion. Add an end-to-end witness where Git reports `/var/...`, the row id is `/private/var/...`, and a destination nested under the selected source is admitted and narrowly excluded.
- Status: accepted
- Triage: New cycle-2 gating finding. Invariant: source containment and exclusion must compare the same normalized worktree identity the tree publishes. Boundary inventory searched: discovery id/display split, row opening, host offer storage, create context, both create-path checks and migration exclusion. Affected: symlink-alias and other realpath-spelling differences on the selected source. Verified safe: identical spellings and Windows-only separator/case folding covered by current tests.

### F008 — Snapshot budget excludes Git stderr and status-derived retained allocations

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-performance`
- Class: feature
- File: `src/worktree/migrateChanges.ts:576`
- Title: Snapshot budget excludes Git stderr and status-derived retained allocations
- Evidence: `git status` receives `maxBufferBytes: context.maxBytes`, which Node applies per output stream, while the snapshot budget charges only `status.stdout.length`. Up to the configured ceiling may also be retained in stderr. Parsing then creates part arrays, decoded strings, records, affected-path collections and states from stdout without reserving headroom for those retained representations.
- Impact: The advertised shared 512 MiB bound can produce substantially more than 512 MiB of extension-host memory pressure at each offer/redemption/pre-call/post-call snapshot, including the near-gigabyte class F005 was meant to avoid.
- SuggestedFix: Enforce a total stdout+stderr ceiling and a lower structural byte/record limit that reserves memory for parsed snapshot representations, or stream/backpressure porcelain parsing rather than materializing a maximum-sized result before accounting it.
- Status: accepted
- Triage: New cycle-2 non-gating finding. Growth axes: Git stdout bytes, Git stderr bytes and porcelain record count. Each stream has a ceiling, but the combined retained memory is outside the accepted single 512 MiB budget. Revisit with a total-output and parsed-representation bound.

### F009 — Parent authorization repeats full component scans for every affected path

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-performance`
- Class: feature
- File: `src/worktree/migrateChanges.ts:460`
- Title: Parent authorization repeats full component scans for every affected path
- Evidence: For each affected path, `pathState` calls `authorizeExistingParent` before and after the final read. Each call walks relative parent components, then calls `authorizeDirectory`, which walks all absolute components and immediately revalidates them. The work is therefore proportional to affected paths times path depth, repeatedly rescanning shared prefixes at all four snapshot phases.
- Impact: Large or deeply nested valid change sets can spend most of the 10-second budget on duplicate metadata reads and have the move offer withheld despite otherwise readable bounded work.
- SuggestedFix: Keep the required before/after identity observations, but build each boundary's component evidence in one pass and reuse per-snapshot prefix structure so shared parent construction is not rediscovered for every path; never cache away the immediate revalidation that closes F004.
- Status: accepted
- Triage: New cycle-2 non-gating finding. Growth axes: affected path count and component depth; deadline/status-byte caps bound the total, but duplicate prefix traversal unnecessarily consumes the availability budget.

## Adjudication notes

- The logic specialist proposed blocking on destination `XY`/index differences. Rejected: the accepted D1 call uses upstream `popStash` without `reinstateStagedChanges` on the destination, and D2 deliberately proves expected working-tree state rather than preservation of source staging semantics. Requiring equal porcelain signatures would reject legitimate migrations across different destination bases and impose a contract the accepted artifacts do not state.
- The reuse specialist proposed blocking on a local `dev`/`ino` comparator duplicating `sameFileIdentity`. Rejected as a blocker: both currently implement the same rule and no divergent behavior exists. The duplicated post-read validation ladder is likewise a maintainability preference without a present behavioral failure; neither survives as a finding.
- Contracts and frontend specialists found no additional defects. The opaque wire shape, one-time redemption, eligible modes, indeterminate short-circuit, consent reset, render signature and uncertainty wording match the accepted contract.

## Accepted risk

- Status: risk-accepted (user grant; non-gating)
- Owner: worktree subsystem
- Scope: another process may transiently substitute source bytes, an intermediate source component, source `.git`, or the destination between path-based observations and restore it before a later comparison; execution-time named-path work is authorized, while persistent or observed divergence is refused or indeterminate
- Expiry: none recorded
- Reactivation: `vscode.git` exposes transactional expected-state and typed-result inputs; Node exposes a cross-platform handle-relative filesystem primitive; or a source/destination substitution incident is observed
- Review note: F006 is a persistent unowned baseline from another repository, and F007 is deterministic identity-spelling drift. Neither is the accepted transient ABA interval.

## Support review

Changed production paths have corresponding unit/integration suites, and no changed test contains `.only` or unconditional `.skip`. Round-1 witnesses now cover destination registration/back-pointers, post-call source identity, linked-source exclusion, persistent intermediate symlinks, and the 1 MiB gitfile cap. Missing direct witnesses align with the two blockers: stable cross-repository source replacement before offer capture, and normalized-id/raw-display aliasing through the full nested-source path.

## Verification evidence

`bun run asm change verify-status move-uncommitted-work-with-the-intent` records tasks 1_1 through 3_2 at exit 0. The supplied build evidence reports the targeted suites and the full 288-file / 7250-test unit rerun passing. Full Biome has only the three clean-HEAD pre-existing format errors in untouched `src/agentHooks/AgentHookController.test.ts`, `src/agentHooks/install/ClaudeHookInstaller.test.ts`, and `src/cursor/CursorHookInstaller.test.ts`; migration-owned files pass check mode. No project verify command was run by the chair.

## Sub-agents spawned

- `asm-review-data-security`: source/destination identity and repository ownership — `gpt-5.6-sol[1M]`
- `asm-review-logic`: snapshot proof, races, ordering and errors — `gpt-5.6-terra[1M]`
- `asm-review-contracts`: wire, host and optional VS Code Git contracts — `sonnet[1M]`
- `asm-review-performance`: byte, record and syscall growth axes — `gpt-5.6-terra[1M]`
- `asm-review-reuse`: identity, path and exclusion reuse — `gpt-5.6-luna[1M]`
- `asm-review-frontend`: consent lifecycle and uncertainty rendering — `gpt-5.6-luna[1M]`
