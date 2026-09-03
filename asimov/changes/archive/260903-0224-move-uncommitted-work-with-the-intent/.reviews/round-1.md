# Review round 1 — move-uncommitted-work-with-the-intent

- Date: 2026-09-02
- Cycle: 1
- Mode: discovery
- Scope: range `eb1cca4595d3ba913da3ff7eb5b67758ac968ec0..0e8f47f2`, restricted to WT-012.10 implementation and its accepted artifacts; merged dependency/history work was context only and produced no findings
- Head: `0e8f47f2c5975977ad5c870cf81e4f80980271b8` (the working tree also contains dirty `asimov/changes/move-uncommitted-work-with-the-intent/analytics.json` telemetry created by the review protocol; it is outside the reviewed range)
- Reviewable lines: 1368 scoped TypeScript production additions; changed tests were reviewed inline. Large change — accuracy may decrease
- Intent context: Gate 2 is approved. `proposal.md` is absent; intent and obligations were reconstructed from approved `workflow.md`, `tasks.md`, `design.md`, `specs/worktree-panel/spec.md`, and blueprint WT-012.10
- Agents spawned: `asm-review-logic` (source evidence, bounded snapshots, special files and tests; `opus[1M]`), `asm-review-data-security` (source/destination authority and substitution; `gpt-5.6-terra[1M]`), `asm-review-contracts` (opaque offer and VS Code Git contracts; `sonnet[1M]`), `asm-review-logic` (execution ordering and indeterminate outcomes; `gpt-5.6-terra[1M]`), `asm-review-frontend` (consent reset and uncertainty rendering; `gpt-5.6-luna[1M]`)
- Agents skipped: `asm-review-performance` — status and filesystem work have explicit deadline/byte bounds and no collection growth axis; the one memory issue was found by the snapshot logic review. `asm-review-reuse` — the change reuses the shared Git runner, authorized-directory machinery, and regular-file opener rather than adding a competing implementation
- Verdict: **REJECT**
- Status: **blocked**
- Counts: 3 BLOCK · 2 WARN · 0 SUGGEST
- Split: 3 feature · 0 machinery

## Accepted obligations

Gate 2 accepts D1–D7 and tasks 1_1–2_4. The load-bearing obligations for this round are: one identified source incarnation and bounded snapshot; an opaque host-held offer; the destination repository owns the exact upstream `migrateChanges(sourcePath, { confirmation: false, deleteFromSource: true, untracked: true })` call; nested destinations are excluded before the call; only fresh/fresh-detached/reuse migrate; `moved` requires empty source plus exact non-conflicted destination state; every other result preserves the successful create, stops later work, and reports uncertainty without claiming restoration or single-location ownership.

## Full-flow trace

- Entry and offer: a row activation retains `WorktreeInfo.id`; repository and toolbar openings retain no source. The opening request sends the source id only for its repository. The host re-resolves that row, opens the exact source through the active Git API, captures bounded source evidence and a positive snapshot, stores both behind a random offer id, and sends only opening/repository/source id, token and count.
- Consent and redemption: the form draws the current count, starts unchecked, clears consent when the offer, repository or mode changes, and submits only the current token. The host validates shape, mode, surface, opening, repository and source row, consumes the token, re-probes the exact source, and passes only host-held source path/evidence/snapshot into the queued create.
- Create and migration: the mutation service revalidates the destination around the queue, runs `git worktree add`, attempts the existing nested-root exclusion, then calls the migration adapter before authorization, provisioning, ports or launch. The adapter opens source and destination, checks the source evidence/snapshot and a clean destination, calls `migrateChanges` on the destination repository with D1's exact options, then reads both working-tree snapshots.
- Outcome: `moved` continues into later work. Any rejection, timeout, failed read, pre-call drift or post-state mismatch returns a successful create carrying `migrationIndeterminate`; the mutation service returns immediately, so no later step runs. The webview renders a warning-tone successful-create notice directing inspection of both worktrees and Git stashes.
- Gaps found in this trace: the created destination is never bound to an incarnation; source identity is not checked after the API call; and exclusion is derived from the repository main checkout instead of the selected migration source.

## Findings

### F001 — The created destination is never bound to the checkout that receives the move

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`
- Class: feature
- File: `src/worktree/migrateChanges.ts:768`
- Title: The created destination is never bound to the checkout that receives the move
- Evidence: After `git worktree add`, `worktreeMutationService.ts:1056-1061` carries only `destinationPath` into the adapter. `openRepositories` validates only that the returned repository's `rootUri.fsPath` resolves to the same lexical path (`migrateChanges.ts:688-696`). The pre-call destination check at `:768-780` proves only that whatever repository is currently at that path has a clean working tree; no authorized-directory, `.git`, admin-target, repository-common-dir, registration or post-create identity is captured or compared. A local process can rename the newly created checkout away and place a different clean linked checkout at the same path before the open. The replacement passes the path and clean-snapshot checks and its repository object receives the destructive move at `:783-789`. The post-check also compares path state only, so a replacement with the expected state can be reported `moved`.
- Impact: Work explicitly authorized for the newly created checkout can be moved into a different checkout. This is outside the accepted residual risk, which is limited to execution-time changes at the named source after its final check. It falsifies the exact-destination and successful-create obligations and can send uncommitted work to an unintended repository/worktree.
- SuggestedFix: Capture destination incarnation evidence immediately after Git creates the worktree, including authorized directory components, no-follow `.git` content/identity and resolved admin/common-repository identity tied to the new registration. Carry it into the adapter and require it before the API call and in post-verification. Refuse as indeterminate without calling the API when it differs. Add a replacement witness using a clean linked checkout at the same path.
- Status: accepted
- Triage: New gating discovery finding. Invariant: a path is not repository identity. Boundary inventory searched: create-path validation, post-`worktree add` capture, Git API open, clean destination snapshot, destination method invocation, and post-state verification. Affected: every destination boundary after Git success because no destination incarnation exists. Verified safe: pre-create path validation and source incarnation checks do not authorize the destination after creation.

### F002 — Post-verification can report moved after observable source `.git` substitution

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/worktree/migrateChanges.ts:803`
- Title: Post-verification can report moved after observable source `.git` substitution
- Evidence: The offer, host redemption and pre-call gate compare full source evidence, including directory components, `.git` and admin state (`migrateChanges.ts:768-778`). After the API resolves, however, `:803-811` calls only `readMigrationSnapshot` and returns `moved` when the source count is zero and destination path states match. It never re-captures or compares `MigrationSourceEvidence`. A migration can resolve after the source `.git` file/admin target is replaced with a different clean repository while the destination contains the expected states; the two final predicates still pass. The approved D1/accepted-risk boundary says observable source bytes or `.git` drift after the final check is indeterminate, not moved.
- Impact: The extension can announce a proven move, run provisioning/ports/opening/launch, and omit the inspection warning even though the named source incarnation disappeared and the original source/stash location is unresolved. This turns the accepted indeterminate state into a false success.
- SuggestedFix: Re-capture source evidence in the post-call read and require `sameSourceEvidence(post.source, input.source)` alongside the empty source snapshot. Any missing or changed evidence must remain indeterminate. Add a witness that swaps the source `.git`/admin target during the migration promise while returning an empty source status and exact destination states.
- Status: accepted
- Triage: New gating discovery finding. Invariant: the source identity proof must cover every boundary used to claim success. Boundary inventory searched: offer capture, host redemption, queued final recheck, pre-call adapter check, API execution, and post-call proof. Affected: post-call proof only. Verified safe: offer, redemption and pre-call checks compare the full evidence and refuse drift.

### F003 — Nested linked-source destinations are not excluded before migration

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair (corroborated by `asm-review-logic`)
- Class: feature
- File: `src/worktree/worktreeMutationService.ts:1032`
- Title: Nested linked-source destinations are not excluded before migration
- Evidence: The exclusion lookup receives the repository main path: `deps.gitExcludeDirFor(request.repoId, repoPath, check.path)`. Production's binding at `extension.ts:729-740` returns an exclusion only when `createdPath` is inside that main path and derives the pattern relative to it. The selected source is separately available as `request.migration.sourcePath` but is not consulted. When a row-context create originates from a linked worktree and places the destination inside that linked source but outside the main checkout, no exclusion is written. The new checkout then appears as untracked source work, the mandatory pre-call snapshot differs from the offered snapshot, and the adapter returns indeterminate without attempting the requested move. The ordering test at `worktreeMutationService.test.ts:2123-2161` stubs an exclusion and uses source `/repo-wt/source` with destination `/repo/wt/new`; it does not exercise a destination nested under the linked source.
- Impact: A valid D6 case always creates the checkout but cannot complete migration, then skips every later requested step under an uncertainty warning. The required sequence explicitly says the destination nested in the selected source is excluded before migration.
- SuggestedFix: Base the migration-specific containment and relative pattern on `request.migration.sourcePath`, while preserving any separate main-checkout hygiene the ordinary create path still owes. Add production-shape coverage for a destination nested in a linked source but outside the main checkout, asserting the exclusion is established before the migration call and the adapter can reach `moved`.
- Status: accepted
- Triage: New gating discovery finding. Boundary inventory searched: source-main nested destination, linked-source nested destination, outside-source destination, exclusion failure, pre-call snapshot, and later-step ordering. Affected: linked-source nested destinations. Verified safe: main-source nested destinations when the main path is the selected source, outside-source destinations, and exclusion failures, which remain indeterminate without calling the API.

### F004 — An intermediate symlink can make snapshot hashing read outside the source

- Severity: WARN
- Confidence: MEDIUM
- Priority: P2
- Agent: `asm-review-logic`
- Class: feature
- File: `src/worktree/migrateChanges.ts:419`
- Title: An intermediate symlink can make snapshot hashing read outside the source
- Evidence: `pathState` proves containment with `path.resolve`/`path.relative`, then calls `lstat(target)`. `lstat` and the later file open follow every intermediate component. `O_NOFOLLOW` protects only the final component, and the identity checks compare the reached outside inode with itself. Replacing `dir` with a symlink between the status read and snapshotting `dir/file` can therefore make the extension open and hash a regular file outside the authorized worktree. Existing tests cover final-component symlinks and replacements, not an intermediate component.
- Impact: A repository-controlled race can provoke bounded reads outside the selected source. The content is retained only as a hash and later drift normally makes the offer fail closed, so this does not by itself prove migration of the wrong work; it does violate the snapshot read boundary and can consume the byte/time budget on an unrelated file.
- SuggestedFix: Resolve and verify the affected path's parent inside the prepared source root before and after the no-follow final-component read, or use a directory-anchored primitive where available. Preserve final symlinks as symlink state rather than following them. Add an intermediate-directory replacement witness.
- Status: accepted
- Triage: New non-gating discovery finding. Affected: intermediate components of affected paths during snapshot reads. Verified safe: lexical traversal, absolute paths, final symlinks, final regular-file substitution, special files, deadline and byte overflow.

### F005 — A hostile `.git` file can double the nominal snapshot memory bound

- Severity: WARN
- Confidence: MEDIUM
- Priority: P3
- Agent: `asm-review-logic`
- Class: feature
- File: `src/worktree/migrateChanges.ts:551`
- Title: A hostile `.git` file can double the nominal snapshot memory bound
- Evidence: A linked worktree's `.git` entry is read through `readBoundedFile`, which retains every chunk in an array and then allocates `Buffer.concat(chunks)`. Its only size guard is the shared 512 MiB snapshot budget. A malformed or replaced `.git` regular file near that ceiling can therefore retain roughly 512 MiB of chunks and allocate another roughly 512 MiB contiguous buffer before the one-line `gitdir:` parse rejects it. This path runs at offer and pre-call recheck; tests cover the shared budget but no `.git`-entry-specific cap.
- Impact: Opening or submitting a row-context create against a hostile source can create near-gigabyte extension-host memory pressure or OOM instead of simply withholding the offer.
- SuggestedFix: Give `.git` link files a small explicit maximum appropriate to one `gitdir:` line, or stream the hash while retaining only a bounded parse prefix. Add just-under/just-over witnesses for that specific entry.
- Status: accepted
- Triage: New non-gating discovery finding. Growth axis: bytes in one replaced `.git` regular file, structurally capped at 512 MiB but duplicated by buffering plus concatenation. Ordinary changed files stream and do not have this peak.

## Accepted risk

- Status: risk-accepted (user grant recorded at Gate 1; non-gating)
- Owner: worktree subsystem
- Scope: another process may change source bytes or `.git` after the final host recheck and before VS Code's Git extension creates its stash; execution-time work is authorized, and observable divergence must be reported indeterminate
- Expiry: none recorded
- Reactivation: a transactional/typed `vscode.git` expected-state API becomes available, or a source-substitution incident is observed
- Review note: F002 does not challenge this residual interval; it finds that an observable post-call `.git` substitution is currently reported as moved instead of indeterminate.

## Support review

Changed production paths have corresponding unit/integration suites, no changed test contains `.only` or unconditional `.skip`, and changed async assertions are awaited. The suites exercise malformed porcelain, status and byte limits, real FIFO/symlink behavior, offer retirement/replay, exact wire shapes, all create modes, ordering, error/rejection mapping, and truthful UI wording. Missing behavioral witnesses align with the findings: destination incarnation replacement, post-call source `.git` replacement, a linked source containing its destination, intermediate-component symlink replacement, and a `.git`-file-specific size cap.

## Verification evidence

`bun run asm change verify-status move-uncommitted-work-with-the-intent` records tasks 1_1 through 2_4 as exit 0. The supplied build evidence reports type-check passing; 288 files / 7227 tests passing; migration-owned Biome files passing under 2.4.5; three pre-existing formatting errors only in untouched `AgentHookController.test.ts`, `ClaudeHookInstaller.test.ts`, and `CursorHookInstaller.test.ts`; and the filesystem-deletion and bundle-requires gates passing. No project verify command was run by the chair.

## Sub-agents spawned

- `asm-review-logic`: source identity, bounded snapshots, special files and tests — `opus[1M]`
- `asm-review-data-security`: source/destination authority and substitution — `gpt-5.6-terra[1M]`
- `asm-review-contracts`: opaque offer and VS Code Git contracts — `sonnet[1M]`
- `asm-review-logic`: execution ordering and indeterminate outcomes — `gpt-5.6-terra[1M]`
- `asm-review-frontend`: consent reset and uncertainty rendering — `gpt-5.6-luna[1M]`
