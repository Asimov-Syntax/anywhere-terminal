# Review Round 1

- Date: 2026-08-31
- Cycle: 1
- Mode: discovery
- Review lane: fastlane
- Scope: range `cf4492aa..4ae1ac51e2051e29850fa8c96bccde9f75e02d3f`
- Head: `4ae1ac51e2051e29850fa8c96bccde9f75e02d3f` (tree dirty after the reviewed range: `asimov/changes/clear-crash-debris-under-an-explicit-authorization/analytics.json`)
- Reviewable lines: 782
- Large change: no
- Recorded Verify Gate: `asm change verify-status` reports exit 0 for tasks 1_1 through 1_7 and their focused/type/unit/I10 gates; workflow notes the inherited Biome baseline and one known unrelated flaky test. Review ran no project verify command.
- Agents spawned:
  - `asm-review-data-security` — destructive clearance security — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — clearance races and errors — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — debris IPC contracts — `sonnet[1M]`
  - `asm-review-frontend` — recover dialog flow — `gpt-5.6-terra[1M]`
  - `asm-review-reuse` — helper reuse and cohesion — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-performance` — no persistence/list/recompute growth axis in the reviewable behavior; the authorization map is TTL-swept and one record per path
- Verdict: REJECT
- Counts: 7 BLOCK, 2 WARN, 0 SUGGEST
- Split: 0 feature blockers, 7 machinery blockers

## Findings

### B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/.claude/worktrees/clear-crash-debris-under-an-explicit-authorization/src/providers/WorktreeHost.ts:1611`
- Title: The authorization endpoint will mint a clearance for a path the opening never showed
- Evidence: `worktreeAuthorizeDebris` validates only a non-empty path, repository presence, and an opening token, then passes `msg.path` directly to the filesystem issuer. The `Opening` record retains no latest resolved debris candidate, so the host cannot prove that the requested path equals the occupied candidate it published. A valid opening can therefore request entries and a fingerprint for any readable directory without a `.git`. Invariant inventory — boundaries searched: opening ownership, latest probe sequence, published occupied candidate, authorization issuance, response delivery; affected: candidate/path binding at issuance; verified safe: repository and opening-token existence are checked.
- Impact: A forged or misrouted webview message can enumerate an arbitrary directory and obtain a host record authorizing a destination the user was never shown, violating the highest-risk explicit-acceptance boundary before create redemption is even considered.
- SuggestedFix: Persist the exact normalized debris candidate for the current opening/probe and admit authorization only when repo, opening token, and path match it; invalidate that candidate on every newer probe/opening and re-check ownership after the asynchronous issue.
- Status: accepted
- Triage: Confirmed by reading the handler: it validates path/repo/token and nothing binds `msg.path` to the candidate the probe published, so the issuer will read and fingerprint any readable non-git directory. The spec requirement this change added says an authorization is issued "only in answer to a request naming that destination" — the destination the panel resolved, not any destination a message names. Fix: the opening retains the normalized debris candidate its latest resolution published, and issuance requires an exact repo + token + path match. No new D# — D6 already owns the request/answer shape.

### B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-contracts`, `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/.claude/worktrees/clear-crash-debris-under-an-explicit-authorization/src/providers/WorktreeHost.ts:1106`
- Title: The production IPC boundary rejects every debris-backed create
- Evidence: The changed dialog/controller now submits `disposition: { kind: "debris", authorization }`, but `isKnownDisposition` still accepts only the exact `{ kind: "free" }`. The `worktreeCreate` handler returns at line 1517 before calling the mutation capability. Direct service tests bypass this boundary, and no host-to-service debris-create witness exists.
- Impact: A user can accept recovery and receive a valid authorization, but Create is silently dropped; the entire implemented clearance path is unreachable in production.
- SuggestedFix: Extend the runtime validator with an exact debris variant requiring non-empty authorization path/fingerprint, require `authorization.path === msg.path`, reject extra fields, and add an end-to-end host-boundary test proving the request reaches `createWorktree`.
- Status: accepted
- Triage: Verified at src/providers/WorktreeHost.ts:1110 — `isKnownDisposition` returns true only for `kind === "free"`, so a debris create is dropped before the mutation service is reached and the feature cannot run in production. My own miss: 1_7's acceptance exercised the dialog and the controller's post and never crossed the host's inbound validator. Fix: validate the exact debris variant, require non-empty `authorization.path`/`fingerprint` and `authorization.path === msg.path`, and add a host-to-service test so the reachability claim has an assertion that can fail.

### B3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/.claude/worktrees/clear-crash-debris-under-an-explicit-authorization/src/worktree/worktreeMutationService.ts:759`
- Title: An unreadable current directory is redeemed as an empty one
- Evidence: `CreatePathDeps.readdir` documents `null` as unreadable/not a readable directory, but redemption passes `entries ?? []`. Because the store permits the current set to be a subset of the approved set, `[]` is covered by every authorization whose identity still matches. Invariant inventory — boundaries searched: issuance read, current redemption read, store subset comparison, final clearance; affected: unreadable current-entry read; verified safe: unreadable issuance refuses and an actual array with a new name is rejected.
- Impact: Permission or I/O failure can turn an unknown current entry set into proven-safe emptiness and recursively delete contents the host could not inspect.
- SuggestedFix: Refuse immediately when the current `readdir` returns `null`; never synthesize an evidence set. Add a service witness where an empty authorization is followed by an unreadable current read and neither remove nor git runs.
- Status: accepted
- Triage: Verified: the redemption passes `entries ?? []`, and `covers()` accepts every subset — so an unreadable directory redeems as though it were empty and a recursive delete follows on contents nobody inspected. Fix: a null read is a refusal, and the authorization is forgotten rather than left spendable.

### B4
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/.claude/worktrees/clear-crash-debris-under-an-explicit-authorization/src/worktree/worktreeMutationService.ts:759`
- Title: The authorized entry set is stale before recursive removal starts
- Evidence: The entry names are read and redeemed, then execution awaits `lstat` and calls `clearDebris`, which awaits another `lstat`. `clearDebris` rechecks only identity and `.git`; it never compares the directory entries again. A writer can add a non-`.git` entry after redemption while preserving the directory inode, and `rm({ recursive: true })` removes it. Invariant inventory — boundaries searched: redemption entries, identity read, final `.git` read, final remove; affected: entry-set observation at the destructive boundary; verified safe: `.git` and device/inode are rechecked immediately before the remove call.
- Impact: Files that appeared after the user-authorized snapshot can be deleted without ever being shown or covered by the fingerprint.
- SuggestedFix: Move the authoritative entry-set comparison into the final synchronous destructive-boundary probe, alongside identity and `.git`, with no suspension before starting removal; add an interleaving witness that inserts a name after redemption and proves remove is not called.
- Status: accepted
- Triage: Correct against the delta this change wrote: the evidence must still cover "what is present when the removal runs", and clearDebris re-checks identity and `.git` but not the entry set — several awaits separate the redemption's read from the delete. Fix: the approved entry set travels into clearDebris and is re-compared inside the no-await window, which needs a synchronous read alongside the synchronous `.git` probe. Conformance to worktree-create.md § 2.2 and design.md D3/D5, no new D#.

### B5
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/.claude/worktrees/clear-crash-debris-under-an-explicit-authorization/src/worktree/clearDebris.ts:87`
- Title: The symlink-component and re-resolution guard is not retaken at the delete boundary
- Evidence: `validateCreatePath` performs the lexical component walk and normalization before later awaits for branch validation and authorization redemption. `clearDebris` receives only the earlier normalized string and performs `lstat` on the final target; it neither re-normalizes nor walks every component. An ancestor can be renamed and replaced by a symlink to the same authorized directory, preserving device/inode so the current checks pass while the recursive call traverses a symlinked component. Invariant inventory — boundaries searched: phase-1 walk/normalize, phase-2 walk/normalize, final identity, final `.git`, remove; affected: final path resolution and ancestor-symlink check; verified safe: a final-component symlink is rejected as not a directory and a different target inode is rejected.
- Impact: The delete can run through a mutable symlink path despite the explicit no-symlink bound, reopening target substitution at the only direct recursive deletion site.
- SuggestedFix: Give the delete boundary the raw path and a synchronous resolved-path/component probe, then re-resolve and reject every symlinked component immediately before removal with no suspension; assert an ancestor-symlink substitution witness.
- Status: accepted
- Triage: Verified: the component symlink walk is `firstSymlinkedComponent` in src/worktree/createPath.ts, run during phase-1 validation and separated from the delete by several awaits. § 2.2 lists "no component of it is a symlink" as a bound of the carve-out, and a bound checked before a suspension point is not a bound on what is deleted. Fix: re-walk the components synchronously in the same no-await window, reusing createPath's own walk rather than spelling a second one.

### B6
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/.claude/worktrees/clear-crash-debris-under-an-explicit-authorization/src/worktree/clearDebris.ts:111`
- Title: Post-removal success does not prove the destination is gone
- Evidence: After `remove` resolves, `clearDebris` returns success for both `readdir === null` and `readdir === []`. Production maps every `fsp.readdir` error to `null`, so absence, EACCES, EIO, and other failures are indistinguishable; an empty directory that still exists also passes. Invariant inventory — boundaries searched: remove rejection, post-remove directory read, remaining-entry report, git handoff; affected: unreadable and still-present empty destinations; verified safe: a non-empty returned array fails and a thrown remove fails.
- Impact: An incomplete or unprovable clearance can reach `git worktree add`, and an empty surviving directory can be treated as the directory removal the user authorized even though that removal did not complete.
- SuggestedFix: Verify absence with an error-aware `lstat`/stat result that distinguishes confirmed ENOENT/ENOTDIR from every other failure; return success only when the destination is proven absent, and report remaining state after any partial failure.
- Status: accepted
- Triage: Verified: the post-removal `readdir` maps every failure to null and null is read as success, so an unprovable clearance reports `ok` and the create proceeds to `git worktree add`. The requirement says a create never reports success for a clearance that did not complete — "could not prove it completed" is not "completed". Fix: prove absence with the error-aware sync probe already in these deps; only absence counts.

### B7
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-frontend`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/.claude/worktrees/clear-crash-debris-under-an-explicit-authorization/src/webview/worktree/WorktreeCreateDialog.ts:995`
- Title: A reattach can offer recovery and then report success without clearing it
- Evidence: `debrisOffer` suppresses reattach only indirectly by comparing `targetOf(effective)` with `effective.freePath`. Reattach resolutions are already valid with `repairPath === freePath`; if such an answer also names a different debris `occupiedCandidate`, the offer is shown and submitted. The mutation service exits into the reattach branch at line 605 before interpreting `request.disposition`, repairs `repairPath`, and can return `ok` while the accepted debris path was never cleared. The service also has no runtime rejection for a reattach+debris combination.
- Impact: The UI can state and authorize one destructive compound action while the host successfully performs a different repair-only action, directly violating the deliberate reattach boundary and the rule that a create never reports success for an incomplete clearance.
- SuggestedFix: Explicitly withhold recovery whenever the effective mode is reattach, reject reattach+debris at the host/service contract boundary, and add the equal `repairPath`/`freePath` plus debris-candidate witness.
- Status: accepted
- Triage: The suppression is `targetOf(effective) === effective.freePath`, which is a proxy for the mode and coincides when a stale registration's own path is also the first free candidate. The offer would then arm a clearance the service's reattach branch never performs, and the create would report a successful repair. My workflow.md note claimed the suppression WAS the mode rule; it is not. Fix: an explicit mode guard in the dialog and a refusal at the service boundary, so neither side depends on the other having got it right.

### W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-contracts`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/.claude/worktrees/clear-crash-debris-under-an-explicit-authorization/src/providers/WorktreeHost.ts:1453`
- Title: Real unreadable failures are reported as “not debris”
- Evidence: `issueDebrisAuthorization` returns only `null` for `.git` present, failed `lstat`, non-directory, missing identity, and failed `readdir`; the host maps every production `null` to `because: "notDebris"`. The `unreadable` variant is reachable only when the issuer callback is absent, but production always wires it.
- Impact: Permission and I/O failures tell the user that the directory holds a repository, an affirmative and incorrect claim that contradicts the new refusal contract.
- SuggestedFix: Return a discriminated issuer result that preserves `notDebris` versus `unreadable` and route it unchanged to the webview.
- Status: accepted
- Triage: Cheap and it changes what the user is told: a permission failure currently reads "that directory holds a repository". Fix: the issuer returns a discriminated failure and the host maps it to the matching `because`.

### W2
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-frontend`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/.claude/worktrees/clear-crash-debris-under-an-explicit-authorization/src/webview/worktree/WorktreeCreateDialog.ts:1795`
- Title: A response to a withdrawn acceptance is retained for a later acceptance
- Evidence: Unchecking calls `withdrawRecover`, but a later same-path response is accepted without checking `recoverWanted` or a request generation and stores `recoverGrant`. Re-checking the same offer then sees a same-path grant and sends no new request.
- Impact: A withdrawn request can outlive the UI state that created it, so a later acceptance reuses an earlier response rather than establishing its own current authorization conversation.
- SuggestedFix: Add a per-authorization request sequence/nonce, retain it only while recovery is accepted, and ignore answers unless the nonce and current accepted offer match; clear it on uncheck and every selection change.
- Status: accepted
- Triage: Verified: the answer handler writes `recoverGrant` without asking whether a request is outstanding, so a grant landing after an uncheck is retained and a later re-check reuses it instead of asking again — the entries shown would be a read the user's second acceptance never made. Fix: a request generation, discarded on withdrawal.

## Author triage summary

- Accepted: B1, B2, B3, B4, B5, B6, B7, W1, W2. Rebutted: none.
- Premise audit (machinery-majority round, 0 feature / 7 machinery): re-verified the shipped baseline — `main`
  offers no recover path at all, so none of this machinery serves a state a supported user can hold from an earlier
  release. The machinery IS the feature: every accepted blocker is a bound worktree-create.md § 2.2 states for the
  carve-out, and dropping the bounds would ship the delete without them. No scope cut indicated; the fixes proceed.
- Obligation test: none of the nine needs a new or changed `D#` and none mints a new invariant owner. B1/B2 are
  conformance to D6 and to the spec delta this change already accepted; B3-B6 are conformance to § 2.2 and D3/D5;
  B7 is conformance to § 2.0. Remediation, not a handback.
- All nine land as one fix task (1_8): their leases overlap across the host, the service, the clearance module and
  the dialog.
