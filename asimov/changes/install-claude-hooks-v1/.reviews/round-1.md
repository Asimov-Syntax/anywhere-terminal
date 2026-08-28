# Review Round 1

- **Date**: 2026-08-28
- **Cycle**: 1
- **Mode**: discovery
- **Scope**: commit `cf09075d^..cf09075d`
- **Head**: `cf09075d1198ea2f5cee708aff9c3e96bf35c139`
- **Tree state**: dirty during review; only `asimov/changes/install-claude-hooks-v1/.analytics-cursor.json` and `asimov/changes/install-claude-hooks-v1/analytics.json` were modified outside the explicit commit scope before this round file was written
- **Classification**: 32 reviewable files, 25 test files, 29 skipped files
- **Reviewable lines**: 4,236
- **Size note**: Large change — accuracy may decrease
- **Assignments**: 6 review assignments; the config-security, shell-privacy, and reuse lanes were rerun after the API interruption (9 agent executions total)
- **Skipped lenses**: frontend (no UI behavior changed); performance (no uncapped collection, full-history recompute, duplicate accumulation, or hot list/query path)
- **Verdict**: REJECT
- **Counts**: 6 BLOCK, 2 WARN, 2 SUGGEST
- **Verify evidence**: `bun run asm change verify-status install-claude-hooks-v1` reports every task exit 0; the chair ran no project verification command

## Risk map and full-flow trace

- Claude enable flow: machine setting/config-dir resolution → lifecycle queue → controller desired revision → installer path classification and sibling lock → classified JSON read → canonical-group reconcile → compare/atomic rename → lock release result → runtime authority → per-pane tokenized environment → frozen POSIX command → loopback route → unchanged Claude decoder and presence projection.
- Claude location-change flow: configuration event → lifecycle queue → controller revocation/reinstall. The old authority is not revoked before the new install begins (B3).
- Cursor compatibility flow: exact `d31d6d17^` source/test restoration → wrapper creation/probe → Cursor hooks file reconciliation → generic controller/runtime. Exact bytes were verified, but the restored bytes reintroduce three previously removed execution/serialization defects (B4-B6).
- Removal flow: remove-all enters each per-agent queue and calls controller disable, which revokes before current-destination uninstall. No durable or historical destination inventory remains, as accepted.
- Data scale: Claude event vocabulary is fixed; settings passes grow only with the current settings file and compare/retry is capped at three. No growing destination inventory remains.
- Test/support pass: corresponding tests exist, no focused `.only` was found, the one platform `skipIf` is intentional, and only `src/cursor/CursorHookInstaller.test.ts` is exempted from formatting while lint remains enabled.

## Findings

### B1

- **ID**: B1
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `chair`, `asm-review-logic`, `asm-review-data-security`
- **File:line**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/worktree-phase6/src/agentHooks/install/ClaudeHookInstaller.ts:68-72,158-172`
- **Title**: Symlink substitution can invalidate the pre-lock destination check
- **Evidence**: `install()` and `uninstall()` classify the pathname with `lstat()` before acquiring the sibling lock. The locked body later reopens the pathname through `readFile`, `stat`, `matches`, and `atomicReplace` without proving it is still the same non-symlink file. A targeted scratch probe swapped the checked regular file for a symlink in `beforeReplace`; `install()` returned `{installed:true}`, replaced the symlink with a managed regular file, and left the symlink target untouched.
- **Impact**: A dotfile manager or concurrent local process can make reconciliation destroy/substitute a symlinked settings pathname and report success, violating the fail-closed promise that symbolic-link settings remain unchanged.
- **SuggestedFix**: Keep classification, read, compare, and commit under an identity-safe operation. Revalidate type and file identity under the lock and immediately before commit; prefer no-follow/open-handle or directory-handle semantics so pathname substitution cannot pass the final decision.
- **Status**: accepted
- **Triage**: accepted — reproduced identity substitution violates D3/D5 fail-closed path authorization; fix every listed filesystem boundary.
- **Invariant inventory**: A write-authorizing classification must remain true through every filesystem boundary. Boundaries searched: resolution, initial `lstat`, lock acquisition, read/stat, compare, temp write, rename, diagnostics. Affected: read/compare/rename after the pre-lock check. Verified safe: Windows early return and paths rejected before any replacement attempt.

### B2

- **ID**: B2
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-data-security`
- **File:line**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/worktree-phase6/src/agentHooks/install/ClaudeHookInstaller.ts:72-78,94-100,134-151`
- **Title**: Fail-closed outcomes discard the required exact settings path
- **Evidence**: Ownership conflicts return only `ownership-conflict`, lock acquisition failure only `lock-unavailable`, and locked-body exceptions only `write-failed`. None carries the resolved settings path; only lock-release residue populates `unresolved`. These are the only values the controller can log, so the accepted D3/D5/spec diagnostics cannot identify the affected settings file for ordinary conflict, lock, or write failures.
- **Impact**: In multi-profile or configured-directory use, the user cannot tell which user configuration or lock failed, despite the accepted contract requiring exact-path reporting. Persistent fail-closed failures become ambiguous and difficult to remediate.
- **SuggestedFix**: Add a typed affected-path diagnostic to every outcome and preserve it through the controller warning surface. Report the resolved settings path for ownership/read/write failure and the exact sibling lock path for lock unavailability/release residue; expose both when both facts apply.
- **Status**: accepted
- **Triage**: accepted — D3 explicitly threads the resolved path through diagnostics; preserve exact settings and lock paths through controller warnings.
- **Invariant inventory**: Every fail-closed decision must report the exact resource that blocked mutation. Boundaries searched: resolver output, ownership conflict, lock unavailable, classified-read/write failure, release residue, controller warning. Affected: every failure except release-residue success. Verified safe: committed install/remove with release residue retains the exact lock path in the installer result.

### B3

- **ID**: B3
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `chair`, `asm-review-logic`
- **File:line**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/worktree-phase6/src/agentHooks/install/agentHookLifecycle.ts:28-30,46-50`
- **Title**: Claude location changes do not revoke authority before reinstallation
- **Evidence**: A `claudeConfigDir` event is folded into the same `reconcile()` path as an enabled-setting event. That path makes one `setDesiredEnabled("claude", readEnabled("claude"))` call. When the setting remains true, `AgentHookController` does not revoke first because immediate revocation occurs only for `false`. This contradicts D6's accepted location sequence of disable, then execution-time reread and reconcile.
- **Impact**: The no-longer-selected destination's handler retains live runtime authority while the new destination installation waits or fails. Stale coordinates remain usable during the relocation window instead of being revoked before filesystem work.
- **SuggestedFix**: Add a location-specific queued body that awaits `setDesiredEnabled("claude", false)`, then rereads the current opt-in and awaits the second transition. Keep the one-step path for enabled-setting-only events.
- **Status**: accepted
- **Triage**: accepted — current lifecycle contradicts D6’s explicit disable → execution-time reread sequence for location changes.
- **Invariant inventory**: A destination-identity change must revoke old runtime entitlement before reconciling the new destination. Boundaries searched: configuration routing, lifecycle queue, controller revision, runtime disable/enable, install lock wait/failure, contributor attach/detach. Affected: location-only events while enabled. Verified safe: explicit disable and remove-all revoke synchronously before uninstall.

### B4

- **ID**: B4
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `chair`, `asm-review-reuse`
- **File:line**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/worktree-phase6/src/cursor/CursorHookInstaller.ts:149,351,353`
- **Title**: Exact Cursor restoration reintroduces working-directory executable resolution on Windows
- **Evidence**: The restored installer probes with bare `cmd.exe` and emits bare `powershell` and `more` in the live wrapper. The parent implementation used an absolute system resolver for `cmd.exe` and `%SystemRoot%`-qualified PowerShell and `more.com`; the archived round-7 B11 had already accepted this executable-resolution class as a P1 must-fix. Byte-for-byte restoration from `d31d6d17^` was verified; the defect is in those restored bytes, not restoration drift.
- **Impact**: A hostile working directory or PATH can supply repository-controlled executables during install or every Cursor hook invocation, enabling arbitrary code execution and hook-payload interception on Windows.
- **SuggestedFix**: Hand D2 back to planning: retain absolute trusted system executable resolution as a safety delta, or land the independently reviewed inline Cursor replacement before this change can be approved. Exact unsafe bytes cannot remain the requirement.
- **Status**: accepted
- **Triage**: accepted — exact D2 restoration revives a previously accepted P1 executable-resolution defect; requires a D2 safety amendment before code edits.
- **Invariant inventory**: Every Windows helper executable in the installer/probe/wrapper chain must resolve from a trusted absolute system path. Boundaries searched: probe launcher, PowerShell sender, stdin drain helper, PATH/current-directory behavior. Affected: all three helpers. Verified safe: POSIX Claude command uses `command -p`; Claude writes nothing on Windows.

### B5

- **ID**: B5
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `chair`, `asm-review-reuse`
- **File:line**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/worktree-phase6/src/cursor/CursorHookInstaller.ts:139-145`
- **Title**: Restored Cursor wrapper writes bypass shared locking and atomic replacement
- **Evidence**: `createWrapper()` calls `writeFile()` directly on the shared global-storage wrapper and applies `chmod()` afterward, with neither a wrapper lock nor temp-and-rename replacement. The surviving `LockedFile` already owns those semantics, and the parent implementation used them after archived round-9 B18 established that multiple extension hosts share this path.
- **Impact**: Concurrent activation or an overlapping version can expose an empty/partial/non-executable wrapper to a live Cursor hook or leave final bytes chosen by an uncontrolled race, breaking hook execution and installation truthfulness.
- **SuggestedFix**: Amend the exact-byte D2 premise and route wrapper creation through `LockedFile.withLock()` plus `atomicReplace()` on the wrapper path, separate from the config-file lock.
- **Status**: accepted
- **Triage**: accepted — exact D2 restoration contradicts shared-writer serialization; requires the same D2 safety amendment.
- **Invariant inventory**: Every shared executable writer must serialize and publish complete executable bytes atomically. Boundaries searched: shared storage identity, mkdir, write/truncate, chmod, concurrent hosts, hook execution during replacement. Affected: the complete wrapper creation path. Verified safe: Claude v1 has no wrapper; Claude config replacement uses a lock and atomic rename.

### B6

- **ID**: B6
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-reuse`
- **File:line**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/worktree-phase6/src/cursor/CursorHookInstaller.ts:375-391`
- **Title**: Restored Cursor probe reports timeout before descendants are reaped
- **Evidence**: `runCommand()` calls `child.kill()` and immediately resolves the timeout result without waiting for `close` or terminating the `cmd.exe` process tree. The parent `runProbe` capability coordinated tree termination, close, and a reap grace period; this commit deletes it and restores the weaker runner.
- **Impact**: A timed-out Windows probe can return while `cmd.exe` or its PowerShell descendant remains alive, leaving orphan processes and allowing later installation work to race with a probe represented as complete.
- **SuggestedFix**: Retain the established process-tree termination and reap behavior, with an outer deadline longer than the reap grace. This requires a safety delta to D2 or making the inline Cursor replacement a prerequisite.
- **Status**: accepted
- **Triage**: accepted — exact D2 restoration drops established process-tree reap semantics; requires the same D2 safety amendment.
- **Invariant inventory**: A bounded external probe must not report completion before its process tree is terminated or honestly reported unresolved. Boundaries searched: inner timer, leader kill, descendants, `close`, outer deadline, later installer work. Affected: timeout and failed termination paths. Verified safe: normal probe completion after `close`.

### W1

- **ID**: W1
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-data-security`
- **File:line**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/worktree-phase6/scripts/verify-claude-inline-hook.mjs:153-157,255-257`
- **Title**: Real-Claude harness does not pin the approved command bytes
- **Evidence**: The harness computes the byte count and SHA-256 from the imported `CLAUDE_HOOK_COMMAND`, writes the explicit settings from that same import, and only prints the hash. It never compares either value with an independent checked-in D7 expectation, so the equality check is tautological if the export drifts.
- **Impact**: The real CLI gate can pass after the frozen command is changed to different executable bytes, weakening D10's role as the final admission check for D7.
- **SuggestedFix**: Compare the imported command's byte count and SHA-256 against independent checked-in D7 constants before invoking Claude Code, then keep the loaded-settings equality check for the CLI translation boundary.
- **Status**: accepted
- **Triage**: accepted — pin independent 1,046-byte and SHA-256 expectations in the real-CLI admission harness.

### W2

- **ID**: W2
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-reuse`
- **File:line**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/worktree-phase6/src/agentHooks/install/agentHookLifecycle.ts:24,57-71`
- **Title**: Lifecycle hand-rolls the repository's keyed serial queue
- **Evidence**: `AgentHookLifecycle` maintains its own tail map, rejection isolation, and conditional cleanup even though `src/utils/keyedSerialQueue.ts` already provides the same keyed serialization for string keys and the deleted transition layer used it.
- **Impact**: Two implementations now own the same sequencing invariant and can drift on rejection or cleanup behavior during later lifecycle changes.
- **SuggestedFix**: Replace the local `tails`/`enqueue` implementation with `createKeyedSerialQueue()` keyed by agent name.
- **Status**: accepted
- **Triage**: accepted — reuse createKeyedSerialQueue so one repository primitive owns keyed serialization.

### S1

- **ID**: S1
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P4
- **Agent**: `asm-review-contracts`
- **File:line**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/worktree-phase6/src/agentHooks/install/claudeConfig.test.ts:44-50`
- **Title**: Unregistered-event ownership conflict is not pinned by a test
- **Evidence**: Production iterates every hook event key and correctly treats the exact managed handler under an unregistered event as an ownership conflict, but the structural tests cover only a noncanonical `PreToolUse` group.
- **Impact**: A later refactor could narrow conflict scanning to registered events and silently weaken the exact ownership boundary.
- **SuggestedFix**: Add a pure reconciliation case with the exact handler under an unlisted event and assert `ownership-conflict` plus source immutability.
- **Status**: accepted
- **Triage**: accepted — add the missing unregistered-event ownership-conflict immutability regression.

### S2

- **ID**: S2
- **Severity**: SUGGEST
- **Confidence**: MEDIUM
- **Priority**: P2
- **Agent**: `asm-review-data-security`
- **File:line**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/worktree-phase6/scripts/verify-claude-inline-hook.mjs:246-252`
- **Title**: Stderr privacy check detects only an exact compact body
- **Evidence**: The harness rejects stderr only when it contains the recorder's complete exact body string. Pretty-printing, escaping differences, or a partial selection of sensitive payload fields would evade that substring test.
- **Impact**: D10's evidence can claim no payload on stderr while differently serialized or partial lifecycle data is present.
- **SuggestedFix**: Add a payload-specific privacy sentinel and assert all sensitive values/fields are absent from stderr, rather than checking only the full compact body.
- **Status**: accepted
- **Triage**: accepted — assert payload-specific sensitive values and fields are individually absent from stderr.

## Specialist adjudication

- The shell specialist's proposed production finding that the token grammar was not validated was rejected with specific code evidence: the leading URL regex already requires `[0-9a-f]+` for segment 5, `length(p[5])` requires 64 characters, and `s=p[4]` intentionally validates the encoded session segment.
- The no-lock missing-file uninstall race considered by the chair was not promoted: overlapping install/remove operations may linearize with removal before the install commit, and the accepted current-destination contract leaves later opt-in reconciliation able to install again. The concrete pre-lock identity substitution in B1 is different because it violates the symlink fail-closed invariant inside one operation.
- Exact `CursorHookInstaller.{ts,test.ts}` restoration and the formatter-only exemption were verified. That proves D2 implementation fidelity; it does not waive B4-B6's concrete safety regressions in the restored bytes.
- No user-granted accepted risk applies to any finding in this round.
