# Review Round 2

- **Date**: 2026-08-28
- **Cycle**: 2
- **Mode**: discovery
- **Scope**: commit range `cf09075d^..08cdbadf` (6 commits: v1 implementation, the round-1 remediation plan amendments, the inline-Cursor merge, and the remediation fix)
- **Head**: `08cdbadf`
- **Tree state**: dirty during review — `asimov/changes/install-claude-hooks-v1/.analytics-cursor.json`, `asimov/changes/install-claude-hooks-v1/analytics.json`, and `skills-lock.json` modified outside the reviewed range
- **Classification**: reviewable — `src/**` production, `scripts/verify-*.mjs`, `package.json`, `biome.json`; test — the `*.test.ts` set and `src/test/invariants/**`; skipped — `docs/**`, `CHANGELOG.md`, `asimov/**` artifacts. No behavioral (skill/agent/command) sources in the diff.
- **Reviewable lines**: 1,849 added (non-test reviewable), 3,962 added across reviewable+test
- **Size note**: Large change — accuracy may decrease
- **Assignments**: 6 review assignments spawned; 5 returned. The frozen-command/harness lane failed twice with an identical API stream disconnect and was closed with chair coverage rather than retried a third time (thrash stop).
- **Skipped lenses**: frontend (no UI surface changed); performance (fixed event vocabulary, retries capped at 3, lock wait bounded at 1 s, no durable inventory — the rejected growth axis was deleted, not replaced)
- **Verdict**: BLOCK
- **Counts**: 1 BLOCK, 3 WARN, 7 SUGGEST
- **Verify evidence**: `asimov/changes/install-claude-hooks-v1/.build/verified.ndjson` records 16 verified task entries; workflow.md has `[x] Verify gate`. The chair ran no project verification command. Chair probes were scratch-only, created and deleted in the same command.

## Cycle context

Cycle 1 (round 1) returned REJECT and was superseded: round-1 B4-B6 invalidated D2's exact-byte Cursor restoration, Gate 2 reopened, and the plan was amended to merge the independently reviewed `huybuidac/inline-cursor-hooks` branch. Gate 2 is now re-approved (`workflow.md`: "Fastlane Gate 2: approved after oracle recheck returned APPROVE"). This round is therefore cycle 2 round 1 in discovery mode, run at full strength over the integrated range rather than as a verification round.

## Risk map and full-flow trace

- **Claude enable flow**: setting read at queued-body start → one `resolveClaudeConfigPath` call → sibling lock acquired → ancestor + final-component classification without following symlinks → identity-checked `O_NOFOLLOW` read → canonical-group reconcile → exclusive random temp staged through an owned handle → ancestor/identity/byte revalidation → `link()` (create) or `rename()` (replace) → lock release → outcome with exact paths → controller authority + warning → runtime token/presence unchanged.
- **Claude location-change flow**: `claudeConfigDir` event → one queued body → `setDesiredEnabled(claude,false)` awaited to completion → setting reread → `setDesiredEnabled(claude, current)`. Round-1 B3's ordering defect is closed.
- **Remove-all flow**: command → per-agent queue → controller disable → revoke → uninstall of the currently derivable destination → **user message is unconditional** (B1 below).
- **Cursor flow**: merged inline implementation wired directly into the generic `AgentHookController`. No wrapper creation, no probe, no `spawn` — only legacy-wrapper removal. Windows is removal-only and the CHANGELOG discloses the observability regression.
- **Windows Claude flow**: `install()`/`uninstall()` return `unsupported-platform` before `resolveClaudeConfigPath` and before any fs call. D8 satisfied.
- **Frozen command flow**: export is byte-identical to the D7 literal in `design.md` (chair-verified: 1,046 bytes, sha256 `a2a47005c04f2bcc870ef97f16f8a64a42bdcb1075586234e62c300e05a00e6a`). Chair probed the awk validator across 11 grammar cases — loopback-only authority, bounded decimal port, single non-empty `encodeURIComponent` segment with uppercase-only escapes, 64-lowercase-hex token; every intended reject rejected.
- **Data scale**: no collection grows. The event set is fixed at 8, settings passes are bounded by the current file, compare-and-retry is capped at 3, lock wait at 1 s. The rejected ledger/pointer/residue inventory is deleted with a source-absence gate (task 2_6).
- **Test/support pass**: corresponding tests exist for every changed production module; no `.only`; the single `skipIf` is an intentional platform guard in `CursorHookInstaller.runtime.test.ts`; the round-1 formatter exemption for the Cursor test was removed from `biome.json` as task 5_3 step 3 required; the two stale peer-owned exemptions in `src/test/invariants/sourceBytes.test.ts` and `registry.ts` were deleted with their assertions tightened, not loosened. No PII or secrets in fixtures. The harness is scratch-isolated (`HOME` redirected, `--setting-sources project`, sentinels that must not fire) and cleans up in a `finally`.

## Round-1 obligation status

All ten round-1 findings are closed. Verified at the invariant level, not at the quoted line.

| ID | Status | Closure evidence |
|---|---|---|
| B1 | fixed | `authorize()` now runs inside `withLock`'s work closure. Every ancestor is `lstat`ed non-following; the final component is `lstat`ed then reopened `O_RDONLY\|O_NOFOLLOW` with a dev/ino match. `readAuthorized` and `matchesAuthorizedSource` re-run the full chain on every attempt and immediately before commit. Create publishes with `link()` (EEXIST-safe). Chair probe: a symlinked `~/.claude` ancestor yields `unsupported-config` with the exact path, no `settings.json` through the link, no residue in the target. |
| B2 | fixed | `failure()` defaults `affected:[path]`; ownership-conflict, unsupported-config, write-failed, retry-exhaustion, and the thrown-work fallback all carry it; `lock-unavailable` carries `[path, lockPath]`; release residue appends `unresolved` and rewrites the reason to `lock-release-failed` only when the write committed; `formatWarning` unions affected ∪ unresolved. |
| B3 | fixed | `AgentHookLifecycle.reconcileClaudeLocation()` awaits `setDesiredEnabled("claude", false)` then rereads and awaits the second transition, inside one keyed-queue body. |
| B4 | fixed (structurally) | Merged inline Cursor source contains no `cmd.exe`, `powershell`, `more.com`, or `spawn`. The Windows executable-resolution surface was deleted, not patched. |
| B5 | fixed (structurally) | No `createWrapper` path exists; only `removeLegacyWrapper()` cleanup with `legacy-wrapper-delete-failed` / `legacy-wrapper-referenced` outcomes carrying the exact wrapper path. |
| B6 | fixed (structurally) | No probe runner exists in the merged source; `src/agentHooks/install/probeRunner.ts` is deleted. |
| W1 | fixed | `scripts/verify-claude-inline-hook.mjs:14-15` pins independent checked-in `EXPECTED_COMMAND_BYTES = 1_046` and `EXPECTED_COMMAND_SHA256`; the comparison at `:172` fails before Claude Code is invoked. Chair confirmed both constants against the export and against the D7 literal in `design.md` — the check is no longer tautological. |
| W2 | fixed | `agentHookLifecycle.ts:1,26` uses `createKeyedSerialQueue()`; the local tail map is gone. |
| S1 | fixed | `claudeConfig.test.ts:52` — "refuses the exact handler under an unregistered event without mutation". |
| S2 | fixed | Per-field `sensitivePayloadValues()` checks plus a random `payload-privacy-sentinel-*`, each asserted individually absent from stderr, alongside the endpoint and command hash. |

## Findings

### B1

- **ID**: B1
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic`, `chair`
- **Class**: feature
- **File:line**: `src/extension.ts:435-437`
- **Title**: The remove-all command reports success even when nothing was removed
- **Evidence**: `registerCommand(AGENT_HOOK_UNINSTALL_COMMAND, async () => { await agentHookLifecycle.removeAll(); void vscode.window.showInformationMessage("AnyWhere Terminal agent hook removal reconciliation completed."); })`. `AgentHookLifecycle.removeAll()` returns `Promise<void>`; `AgentHookController.uninstall()` converts every installer failure — `ownership-conflict`, `lock-unavailable`, `write-failed`, `unsupported-config`, and committed-with-`unresolved` — into `{success:false}` routed to `onWarning`, which `extension.ts:412-420` sends only to `console.warn`. `setDesiredEnabled` resolves regardless, so the information message always fires. This replaced `summarizeUninstall(results)` (`git show cf09075d^:src/agentHooks/install/agentHookTransitions.ts:283-297`), which reported per-agent outcome and named the exact destinations still holding entries.
- **Impact**: A user who runs the removal command to get the extension out of their Claude configuration is affirmatively told it completed while the managed hook is still in `settings.json` and Claude Code keeps executing it. The only trace is an extension-host console line. D9 and the spec both require a removal carrying unresolved paths to be unsuccessful; the one surface the user sees contradicts that.
- **SuggestedFix**: Have `removeAll()` return per-agent outcomes (agent, removed, reason, affected, unresolved) and have the command show a warning or error message naming the failed agents and their exact paths. Reserve `showInformationMessage` for a fully successful removal.
- **Status**: accepted
- **Triage**: Accepted. The visible success claim violates D9 when the settled removal outcome is unsuccessful. The fix will return the controller's settled per-agent outcomes through the lifecycle and reserve the information notification for all-success results.
- **Invariant inventory**: A user-invoked reconciliation must report its true outcome at the surface the user sees. Boundaries searched: installer outcome, controller `install`/`uninstall`, `runReconciliation` warning emission, `onWarning` sink, lifecycle return type, command handler, notification call. Affected: the lifecycle return type and the command handler. Verified safe: the installer and controller layers carry exact reasons and paths correctly; the enable/disable settings path has no comparable user-facing claim.

### W1

- **ID**: W1
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P3
- **Agent**: `asm-review-logic` (evidence corrected by `chair`)
- **Class**: feature
- **File:line**: `src/agentHooks/install/ClaudeHookInstaller.ts:125-170`
- **Title**: The retry loop cannot make progress against inode-changing drift and misreports it as `write-failed`
- **Evidence**: `reconcile()` takes one `authorization` snapshot before the loop and reuses it for all three attempts. The specialist claimed every concurrent edit deterministically fails; the chair refutes that for the in-place case — `openAuthorized` matches on dev/ino only, so a same-inode edit is reread on the next attempt and reconciled against the new bytes. The real gap is narrower: when another writer replaces the file via temp+rename (the shape most editors and Claude Code itself use), the inode changes, `readAuthorized`/`matchesAuthorizedSource` return `mismatch` on every remaining attempt, and the loop exhausts to `this.failure(operation, "write-failed", path)` at `:170`.
- **Impact**: The fail-closed refusal is D3-conformant ("any substitution... aborts"), but two of three attempts are spent on a snapshot that can never match, and the diagnostic points the user at a write failure rather than at concurrent drift. Authority stays revoked until the next settings event.
- **SuggestedFix**: Re-authorize (re-`lstat` + reopen) at the top of each attempt so a legitimately rewritten file is reconciled, or return a distinct bounded `concurrent-drift` reason so the warning names the real cause.
- **Status**: rejected
- **Triage**: Rebutted as non-gating, D3-conformant fail-closed behavior. Re-authorizing an inode-changing destination would widen the accepted operation snapshot; a new diagnostic reason is not required to close B1.

### W2

- **ID**: W2
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P3
- **Agent**: `asm-review-contracts`, `asm-review-reuse`, `chair`
- **Class**: machinery
- **File:line**: `src/agentHooks/install/agentHookLifecycle.ts:5-8`
- **Title**: `AGENT_HOOK_SETTINGS` is dead and has already drifted from the keys actually read
- **Evidence**: The exported constant declares `cursorAgent.hooks.enabled`, `agentHooks.claude.enabled`, `agentHooks.claudeConfigDir` — unprefixed. `grep -rn "AGENT_HOOK_SETTINGS" src/` finds no reader anywhere, including in its own file. `handleConfigurationChange` at `:49-51` independently hardcodes the fully-qualified `anywhereTerminal.*` forms, and `readAgentHookEnabled` in `src/extension.ts:339-342` hardcodes a third copy. Three representations of one settings contract, already inconsistent in shape.
- **Impact**: Nothing couples a future key rename or addition across all three sites. A missed edit in `handleConfigurationChange` silently stops reconciling on a setting change — the exact failure mode the constant looks like it exists to prevent.
- **SuggestedFix**: Delete the unused export, or drive `handleConfigurationChange` and `readAgentHookEnabled` from it with the `anywhereTerminal.` prefix applied in one place.
- **Status**: accepted
- **Triage**: Accepted as a trivial same-owner cleanup. The lifecycle will derive all configuration-change keys from one fully-qualified settings map.

### W3

- **ID**: W3
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P3
- **Agent**: `asm-review-contracts`
- **Class**: machinery
- **File:line**: `src/agentHooks/AgentHookController.ts:13,22`
- **Title**: The new `affected` outcome field is honoured by only one of the two wired installers
- **Evidence**: This diff adds `affected?: readonly string[]` to `HookInstallOutcome` and `HookRemoveOutcome` and threads it through `install()`, `uninstall()`, and `formatWarning`. `ClaudeHookInstaller` populates it on every failure. `grep -n "affected" src/cursor/CursorHookInstaller.ts` returns nothing — Cursor outcomes only ever set `unresolved`.
- **Impact**: D9 states the controller contract as outcomes carrying "exact affected resource paths separately from unresolved cleanup residue". Cursor failures produce a warning with a reason and no path, Claude failures produce one with both, so per-agent diagnostics differ in shape for no functional reason. Optional-field typing hides the divergence from the compiler.
- **SuggestedFix**: Populate `affected` in `CursorHookInstaller` for parity, or narrow the interface doc comments to state that `affected` is Claude-only pending the Cursor change.
- **Status**: rejected
- **Triage**: Rebutted for this change. D2 explicitly assigns Cursor diagnostics and migration semantics to the independently reviewed inline-Cursor change; broadening its outcome shape here would duplicate that lane's work.

### S1

- **ID**: S1
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P4
- **Agent**: `asm-review-data-security`, `chair`
- **Class**: feature
- **File:line**: `src/agentHooks/install/lockedJsonFile.ts:118-127,171-176`
- **Title**: Temp-file cleanup failure is swallowed and never surfaced as residue
- **Evidence**: `discard()` unlinks best-effort via `.catch(() => undefined)`. After a successful `commit("create")`, a non-`ENOENT` unlink failure leaves `live` true and the pathname in place; the outer `finally` retries and swallows again. That file is a complete copy of the user's settings under `.settings.json.<32-hex>.tmp`, and unlike the lock path it never enters `unresolved`.
- **Impact**: Silent accumulation of settings copies in the user's config directory with no diagnostic. D5 specifies residue reporting for the lock only, so this is a gap in the contract's coverage rather than a violation of it.
- **SuggestedFix**: Add the staged temp path to `unresolved` when `discard()` fails to unlink an owned temp, reusing the existing lock-residue channel.
- **Status**: rejected
- **Triage**: Rejected as a non-gating contract extension. D5/D9 require exact lock residue; broadening staged-temp residue ownership is not needed for B1.

### S2

- **ID**: S2
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P4
- **Agent**: `asm-review-contracts` (evidence corrected by `chair`)
- **Class**: feature
- **File:line**: `src/agentHooks/install/claudeConfig.ts:148-152`
- **Title**: Key-order-sensitive comparison forces one avoidable full-document rewrite
- **Evidence**: `sameGroupSequence` compares with `JSON.stringify`, which is key-order sensitive, while `isCanonicalManagedGroup`/`hasOnlyKeys` treat key order as irrelevant. A group written `{hooks, matcher}` is recognised as canonical, filtered out, and replaced by `canonicalManagedGroup`'s `{matcher, hooks}`, so `changed` is true. The specialist reported this as recurring on every reconcile; chair probe shows it converges — pass 1 `changed`, pass 2 `unchanged`.
- **Impact**: One avoidable reserialization of the whole document (any `changed` install reserializes anyway, so the incremental cost is a single extra write, not repeated churn).
- **SuggestedFix**: Compare groups structurally, or normalize key order before stringifying.
- **Status**: rejected
- **Triage**: Rejected as non-gating normalization churn; the current write converges after one pass and does not violate the ownership contract.

### S3

- **ID**: S3
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P4
- **Agent**: `asm-review-data-security`
- **Class**: machinery
- **File:line**: `src/agentHooks/install/lockedJsonFile.ts:191-213`
- **Title**: `readText()` and `atomicReplace()` are unused public API, and `readText()` follows symlinks
- **Evidence**: Neither has a caller outside the module (`CursorHookInstaller` defines its own private `atomicReplace`). `readText` uses path-based `readFile`, which resolves symlinks, while every read `ClaudeHookInstaller` actually performs goes through `openAuthorized` with `O_NOFOLLOW` plus a dev/ino check.
- **Impact**: The module header advertises the class as the extension's write discipline, but exports a symlink-following read helper carrying none of the classification guarantees. The next caller reaching for the obvious-looking pair gets weaker semantics than the installer relies on.
- **SuggestedFix**: Delete both, or open with `O_NOFOLLOW` and document `atomicReplace` as unclassified.
- **Status**: rejected
- **Triage**: Rejected as unrelated API cleanup. The production installer uses only the no-follow authorization path, and B1 does not introduce a caller of these helpers.

### S4

- **ID**: S4
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P5
- **Agent**: `asm-review-data-security`
- **Class**: feature
- **File:line**: `src/agentHooks/install/lockedJsonFile.ts:131-136`
- **Title**: The create-new path's `0o600` is a umask ceiling, not an enforced mode
- **Evidence**: `open(temporaryPath, "wx", mode ?? 0o600)` supplies the default, but the following `handle.chmod(mode)` is guarded by `if (mode !== undefined)`. `ClaudeHookInstaller.replace` passes `mode = undefined` on the missing-target install path (`:141`), so no `fchmod` runs and the result is `0o600 & ~umask`. The replace-existing path is correct: mode is recorded as `opened.mode & 0o777` (setuid/setgid/sticky stripped) and restored through the owned handle.
- **Impact**: Benign for ordinary umasks; a umask carrying owner bits produces a read-only settings.json. Never widened, so predictability rather than exposure.
- **SuggestedFix**: Always `await handle.chmod(mode ?? 0o600)`.
- **Status**: rejected
- **Triage**: Rejected as non-gating hardening outside the visible removal-result seam. The default remains a restrictive umask ceiling and never widens access.

### S5

- **ID**: S5
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P4
- **Agent**: `asm-review-reuse` (severity downgraded by `chair`)
- **Class**: machinery
- **File:line**: `src/cursor/CursorHookInstaller.ts:446-452`, `src/agentHooks/install/ClaudeHookInstaller.ts:367-369`
- **Title**: `isNotFound`/`isAlreadyExists` and `sameIdentity` are redefined beside their exported originals
- **Evidence**: `lockedJsonFile.ts:264-277` exports all three shapes; the Cursor installer redefines the two errno predicates and the Claude installer redefines the dev/ino comparison.
- **Impact**: The filesystem-error and identity invariants are represented twice each and can drift. Downgraded from the specialist's WARN because these are one-line pure predicates and because D2 forbids reworking the merged, independently reviewed Cursor source here.
- **SuggestedFix**: Import the shared predicates; export `sameIdentity` from `lockedJsonFile.ts`. Defer the Cursor half to that change's own lane.
- **Status**: rejected
- **Triage**: Rejected under D2: do not rework the independently reviewed Cursor implementation or create a cross-lane filesystem-helper refactor here.

### S6

- **ID**: S6
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P4
- **Agent**: `asm-review-reuse` (severity downgraded by `chair`)
- **Class**: machinery
- **File:line**: `scripts/verify-claude-inline-hook.mjs:39-41`
- **Title**: The harness reimplements `posixShellQuote`
- **Evidence**: `quotePosix()` duplicates the single-quote escaping in `src/utils/posixShellQuote.ts:12`; the harness already imports TypeScript source at `:8`, so the shared utility is reachable.
- **Impact**: A quoting-rule change could make the harness quote sentinel paths differently from production. Scope is limited to harness-controlled scratch paths, hence SUGGEST rather than WARN.
- **SuggestedFix**: Import `posixShellQuote`.
- **Status**: rejected
- **Triage**: Rejected as non-gating harness cleanup; the checked-in quoting implementation is byte-equivalent and the frozen-command admission evidence is unchanged.

### S7

- **ID**: S7
- **Severity**: SUGGEST
- **Confidence**: MEDIUM
- **Priority**: P5
- **Agent**: `asm-review-data-security` (severity downgraded by `chair` — explicitly out of scope)
- **Class**: feature
- **File:line**: `src/agentHooks/install/lockedJsonFile.ts:133-182`
- **Title**: No durable flush before commit
- **Evidence**: `handle.writeFile` then `link()`/`rename()` with no `handle.sync()`/`datasync()` and no parent-directory fsync. A crash or power loss between rename and writeback can leave a truncated settings.json.
- **Impact**: Recorded for completeness only. `proposal.md` Out of scope explicitly names "Power-loss/fsync durability beyond process-crash ordering around atomic rename", so this is an accepted plan boundary, not an obligation this change owes. Reported per the evidence-over-intent rule; not gating.
- **SuggestedFix**: If the boundary is ever revisited, `await handle.sync()` before commit and fsync the parent directory on the create path.
- **Status**: rejected
- **Triage**: Rebutted as an explicit accepted scope boundary in proposal.md; no remediation is owed in this change.

## Adjudication

### Relayed BLOCK claims on the Claude identity writer

A mid-review coordinator message reported that the identity-writer specialist had raised five BLOCKs — ancestor substitution before staging/lock, a compare-to-commit in-place edit window, no post-publication validation, swallowed temp cleanup, and pre-authorization lock mutation — plus stale-authorization retries. **The `asm-review-data-security` report for that lane, when it arrived, contained zero BLOCKs**: one WARN (fsync durability) and three SUGGESTs, and it affirmatively confirmed round-1 B1 and B2 closed with line-level evidence. No agent message is user approval or a review verdict; the chair adjudicated each claim against the code regardless.

1. **Ancestor substitution / pre-authorization lock mutation — rejected as BLOCK.** These are one claim. `withLock` does acquire the lock, and `acquireLock` does `mkdir(dirname, {recursive:true})`, before `authorize()` runs — but D3 explicitly orders classification *under* the lock, so this is the accepted design order. The lock is created only with `open(lockPath,"wx")`, which cannot follow a symlink at the final component and cannot overwrite an existing file; `releaseLock` unlinks only after an fstat/lstat dev+ino match. Chair probe with `~/.claude` symlinked to another directory: `install()` returned `{installed:false, reason:"unsupported-config", affected:[<exact path>]}`, wrote no `settings.json` through the link, and left the target directory empty. Residual: `mkdir -p` of the parent may traverse a symlinked ancestor to create directories. Recorded below as audit-backlog, not a finding.
2. **Compare-to-commit in-place edit window — rejected as BLOCK, real but inherent.** `commit("replace")` is an unconditional `rename()`. Closing the window needs `renameat2(RENAME_EXCHANGE)` or `renamex_np(RENAME_SWAP)`; Node exposes neither. D3 concedes exactly this by specifying revalidation "immediately before commit" rather than an atomic compare-and-swap, and D5 names temp+rename as the mechanism. The create path is genuinely closed: `link()` fails `EEXIST`, satisfying "missing-target publication must not overwrite a file that appeared after classification". The specialist's own answer to verification question 1 reached the same conclusion independently.
3. **No post-publication validation — rejected.** No accepted obligation requires it, and any check after the rename is itself a TOCTOU with no remediation path: the bytes are already published and a later writer is entitled to change them. Adding one would produce false diagnostics, not safety.
4. **Swallowed temp cleanup — confirmed, not BLOCK.** Landed as S1. No data loss, no boundary bypass; D5 scopes residue reporting to the lock, so this extends the contract rather than violating it.
5. **Stale-authorization retries — partially confirmed.** Landed as W1 with corrected evidence: in-place edits *are* reread on the next attempt, so the "deterministically fails" framing is wrong; only inode-changing drift exhausts the loop, and that refusal is D3-conformant.

### Conflicting logic assessments

Two logic lanes ran on different regions. The lifecycle/controller lane reported 2 BLOCK + 1 WARN; the Cursor-under-generic-controller lane reported no findings at all. These are not strictly contradictory — different assignments — but the clean lane's scope did include the controller outcome handling and the extension wiring, and it did not surface the remove-all message.

- **B1 stands.** The lifecycle lane supplied specific code evidence; the chair independently verified `extension.ts:435-437` and the deleted `summarizeUninstall` it replaced. A silent clean report does not refute specific code evidence (Phase 3 rule 2: neither side without code evidence is WARN at most; here one side has code and the other has silence).
- **The lifecycle lane's second BLOCK — a pre-`start()` location event skipping the disable transition — is refuted and dropped.** `revokeAgent` pre-start is a no-op because `this.runtime` is null, so there is no authority to revoke; `initialize()` unconditionally calls `revokeAll()` before granting any; the uninstall the path skips targets the *newly resolved* destination (the installer resolves at execution time), which the subsequent install reconciles anyway; and spec + D3 explicitly make no cleanup promise for a destination no longer derivable. The path is also unreachable in production: `context.subscriptions.push(...)` and `await agentHookController.start()` are adjacent synchronous statements with no await between them, and `start()` sets `started = true` synchronously.
- **The clean lane's positive findings are kept as corroboration**: it independently confirmed the merged Cursor source under the generic controller has no B4/B5/B6 surface, matching the reuse lane's separate conclusion. Two independent confirmations of the same structural closure.

### Other adjudications

- The contracts lane's key-order finding was reported as recurring "forever"; chair probe shows convergence after one rewrite, so it is S2 (SUGGEST), not WARN.
- The reuse lane rated the duplicated errno predicates and harness quoting as WARN P3; downgraded to SUGGEST because they are one-line pure functions and because D2 forbids reworking the merged Cursor source in this change.
- The fsync finding is explicitly named in `proposal.md` Out of scope; recorded as S7 and marked non-gating rather than turning an accepted boundary into an obligation.
- Chair probes confirmed D4 independently: ownership conflict leaves the source object unmutated; unrelated group order is preserved with the managed group appended last; reconciliation is idempotent after convergence.
- No user-granted accepted risk applies to any finding in this round. The Windows waiver recorded in the archived `install-claude-hooks` change does not intersect this scope: Claude is `unsupported-platform` here and the Cursor Windows removal is disclosed in CHANGELOG.

## Audit backlog

Valid, non-gating observations outside any finding's remediation cone. Carry forward to the next discovery round; do not re-report as new.

- **AB1** — `LockedFile.acquireLock` calls `mkdir(dirname(path), {recursive:true})` before the path is classified, so a symlinked ancestor can be traversed to create directories. No user bytes are at risk (`open("wx")` cannot overwrite; the lock self-cleans on release; classification then fails closed), and D3 places classification under the lock by design. Worth revisiting only if the lock ever moves outside the settings directory.
- **AB2** — `design.md` Failure Surface Inventory says non-cooperating drift "retries or fails without overwrite". The rename commit can overwrite an in-place edit landing inside the post-validation window. The code matches D3/D5's stated mechanism; the inventory row is marginally stronger than any Node-based implementation can deliver. This is a documentation-precision item, not a code defect.
- **AB3** — Task 5_3 step 2 required retaining `src/cursor/CursorHookController.ts` and `.test.ts` from the merged branch "without reimplementation". Neither exists at HEAD. The reuse lane confirmed the capability is correctly owned by the generic `src/agentHooks/AgentHookController.ts`, which D1 and D2 both require be preserved — so the outcome is right and the task plan text is stale. Plan-text drift, not a behavior defect.

## Sub-agents spawned

- `asm-review-data-security` — Claude installer + locked-file identity/locking/diagnostics — `opus[1M]`
- `asm-review-logic` — lifecycle ordering, controller authority, extension wiring — `gpt-5.6-terra[1M]`
- `asm-review-contracts` — canonical-group ownership, settings surface, outcome contracts — `sonnet[1M]`
- `asm-review-data-security` — frozen D7 command + both real-CLI admission harnesses — `gpt-5.6-luna[1M]` — **never returned a report.** Spawned twice; both attempts terminated early with an identical `API Error: stream error: stream disconnected before completion`. That is an infrastructure failure carrying no signal about the code, and a third attempt would be thrash, so the lane was closed with chair coverage instead. The chair covered its scope directly: `CLAUDE_HOOK_COMMAND` verified byte-identical to the D7 literal fenced in `design.md` (1,046 bytes, sha256 `a2a47005c04f2bcc870ef97f16f8a64a42bdcb1075586234e62c300e05a00e6a`) and matching the checked-in `EXPECTED_COMMAND_BYTES`/`EXPECTED_COMMAND_SHA256` compared at `verify-claude-inline-hook.mjs:172` before Claude Code is invoked (closes round-1 W1); an 11-case probe of the awk validator (rejects non-loopback host, port > 65535, uppercase hex token, empty and space-bearing session segment, extra path segment, bare `%`; accepts a valid URL, an uppercase `%2F` escape, and `08080` which normalizes to 8080 on the same authority); and a read of the harness's per-field stderr sentinels (closes round-1 S2), scratch isolation (`HOME` redirect, `--setting-sources project`, non-firing user/local sentinels, real-user-settings fingerprint), and `finally`-guarded recorder close plus scratch removal.

  **Residual review debt** — this lane's independent hunt did not run. Chair coverage confirmed the accepted D7/D10 obligations and probed the validator, but a specialist pass looking for grammar holes beyond those 11 cases, post-entry leak paths, and harness bound/cleanup gaps was never performed. No finding in this round depends on the missing report and the verdict is unaffected, but the next discovery round should re-run this lens rather than treat D7/D10 as fully swept.
- `asm-review-reuse` — Cursor merge seam, deletion completeness, duplication — `gpt-5.6-luna[1M]`
- `asm-review-logic` — merged Cursor installer under the generic controller — `gpt-5.6-luna[1M]`
