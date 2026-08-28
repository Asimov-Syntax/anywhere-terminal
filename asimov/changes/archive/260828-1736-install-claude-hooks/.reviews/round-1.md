# Review Round 1: install-claude-hooks

**Date**: 2026-08-27
**Cycle**: 1
**Mode**: discovery
**Scope**: commit `d31d6d175799fd8dac9ada4332ff4bf94db1db70` only
**Head**: `d31d6d175799fd8dac9ada4332ff4bf94db1db70`
**Tree state**: dirty at review time (`.claude/settings.json` and analytics files); explicit commit scope was unaffected
**Reviewable lines**: 1396 — large change; accuracy may decrease
**Agents spawned**: data-security — config mutation/security — `opus[1M]`; logic — installer concurrency/errors — `gpt-5.6-terra[1M]`; contracts — Claude settings/wiring contracts — `sonnet[1M]`; logic — registry/controller lifecycle — `gpt-5.6-terra[1M]`; reuse — installer extraction — `gpt-5.6-luna[1M]`
**Agents skipped**: frontend — no UI/rendering changes; performance — managed event count is structurally capped at eight and no unbounded collection/recompute path was introduced
**Verdict**: **REJECT**
**Counts**: 3 BLOCK, 3 WARN, 2 SUGGEST

## Gate and context

- Gate 2 is approved in `workflow.md`; D1–D11, task Acceptance/Boundary/Refs, and the agent-hook installation delta spec were treated as obligations.
- Recorded Verify Gate evidence: `bun run asm change verify-status install-claude-hooks` reports tasks 1_1, 1_2, 2_1, 2_2, and 2_3 at `[x]`, exit 0. No project verify command was run during review.
- Settled context was not reopened: Claude is transport-only; wrappers are fail-open; leading `{}` is defensive output; POSIX/Windows stdin order differs intentionally; Claude posts JSON; Cursor wrapper behavior is deliberately pinned.

## Risk map and full-flow trace

- Highest risk: mutation of user-owned Cursor/Claude config across path resolution, symlink refusal, locking, classified read, merge, and atomic replacement.
- Medium risk: wrapper process lifecycle and user-facing setting/command contracts.
- Flow traced: package setting → registry slot → `AgentHookController` reconcile → managed config/wrapper → runtime registration → PTY environment mint → wrapper POST → runtime auth/entitlement/dedup/body cap → Claude drop-only session → disable/session teardown authority revocation. Runtime transport and teardown remain coherent; the gating defects are in destination stability and config ownership/preservation.

## Findings

### B1

- **ID**: B1
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic` (corroborated by chair and lifecycle specialist)
- **File:line**: `src/agentHooks/install/agentHookRegistry.ts:54`
- **Title**: Mutable config resolution breaks destination and lifecycle invariants
- **Evidence**: The registry gives the long-lived installer a live `configuredDirectory: () => settings(...)` closure, and `claudeConfigAdapter.configPath()` resolves it on every call. One install/uninstall independently resolves the path for symlink refusal, directory creation, lock creation, read/stat, comparison, replacement, and reporting. Changing directory A→B while enabled then disabling targets B and can leave the managed entries in A; changing it during an operation can check or lock A while reading/writing B.
- **Impact**: The extension can strand hooks in the prior user config, mutate a destination that was not symlink-checked or locked, and lose concurrent changes there. This violates per-agent disable/uninstall, D5, and the shared reconciler's single-config authority.
- **SuggestedFix**: Make destination changes an explicit serialized controller transition: retain the old resolved path, revoke/uninstall it, create a new fixed-path adapter/installer, then reconcile the current desired state. Independently snapshot one immutable path at the start of every install/uninstall and thread it through all filesystem stages.
- **Status**: accepted
- **Triage**: Accepted, both halves. The intra-operation race is real and is the blocking part: one operation must own one destination, or the symlink refusal and the lock are checked against a file we do not go on to write. Fixed by snapshotting the resolved path once per install()/uninstall(). The A→B stranding is accepted too and fixed in the listener, which now uninstalls from the previously resolved destination before reconciling the new one. Cross-restart stranding remains out of reach without persisted state — D4's reload semantics and the uninstall command are the remedy there, recorded in workflow.md Notes rather than fixed.
- **Invariant inventory**: One reconciliation/lifecycle transition targets one immutable config destination. Boundaries searched: path resolution, symlink check, mkdir, lock, classified read/stat, compare, atomic replace, enable→disable cleanup, uninstall-all/report. Affected: all listed config boundaries. Verified safe: wrapper storage path and runtime entitlement/teardown do not depend on config-path resolution.

### B2

- **ID**: B2
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic` (corroborated by chair and data-security)
- **File:line**: `src/agentHooks/install/ManagedConfigInstaller.ts:140`
- **Title**: Substring ownership matching deletes foreign hook commands
- **Evidence**: Ownership is `normalizeSeparators(command).includes("<agent>-hooks/<agent>-hook-observer.<ext>")`. It is not a parsed terminal path suffix or component match. A managed-shaped user entry invoking `/tmp/not-claude-hooks/claude-hook-observer.sh`, `...observer.sh.backup`, or using the owned-looking text as an argument is swept by both adapters.
- **Impact**: Install or uninstall silently deletes a user-authored Cursor/Claude hook, violating D3 and the hard preservation requirement.
- **SuggestedFix**: Parse the single emitted command token for the platform, normalize its path, and require the directory and filename as terminal path components at the command boundary. Keep stale-root reconciliation, but reject prefix/suffix lookalikes and argument occurrences. Add Cursor and Claude regression cases for `not-<agent>-hooks`, filename suffixes, and argument-only occurrences.
- **Status**: accepted
- **Triage**: Accepted. Verified: `not-cursor-hooks/cursor-hook-observer.sh` does contain the owned pair, so a managed-shaped user entry there is swept. My own regression test used a path that could not hit it, which is why it passed. Fixed by anchoring the owned pair at a path boundary of the parsed command token and requiring it to end there, with the missed cases added as tests.
- **Invariant inventory**: Only a command whose parsed invoked path ends in the exact owned directory component plus wrapper filename may be swept. Boundaries searched: Cursor flat install/uninstall and Claude nested install/uninstall. Affected: all four through the shared predicate. Verified safe: same-named scripts in a different directory without the owned-looking substring are preserved by current tests.

### B3

- **ID**: B3
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `chair`
- **File:line**: `src/agentHooks/install/claudeConfigAdapter.ts:122`
- **Title**: Sweeping the last managed handler drops user-owned matcher-group metadata
- **Evidence**: `sweepGroups()` removes managed handlers and only keeps the group when at least one handler remains. If a supported group contains unknown user/CLI keys but its sole handler is managed, the whole group is dropped. For example, `{ matcher: "*", label: "keep", hooks: [managedHandler] }` loses `label` during either reinstall or uninstall.
- **Impact**: User-authored settings accepted by the adapter are not preserved, directly violating the delta spec's unknown-key round-trip guarantee. Existing tests cover top-level unknown keys and a user handler inside the group, but not group-level metadata with no remaining user handler.
- **SuggestedFix**: Delete an emptied group only when its complete group shape is exactly the extension-created shape. Otherwise preserve the group and its unknown keys with `hooks: []`. Add install and uninstall regression tests for unknown group-level keys.
- **Status**: accepted
- **Triage**: Accepted. `{matcher: "*", label: "keep", hooks: [managed]}` loses `label`, which contradicts the round-trip requirement this change's own spec states. Fixed by dropping a group only when its shape is exactly one the extension creates; anything else keeps its keys with an empty hooks array.
- **Invariant inventory**: Removing a managed handler must preserve every non-managed byte-semantic field in its containing supported group. Boundaries searched: top-level siblings, event arrays, group metadata, mixed handlers, handler unknown keys. Affected: group metadata when no user handler remains. Verified safe: top-level siblings, mixed groups, and unknown keys on non-managed handlers.

### W1

- **ID**: W1
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-logic`
- **File:line**: `src/agentHooks/install/ManagedConfigInstaller.ts:362`
- **Title**: Windows probe timeout no longer terminates the child process
- **Evidence**: The new `withDeadline()` resolves a fallback but cannot cancel `runCommand()`, and `runCommand()` never kills the spawned `cmd.exe`. The deleted implementation retained the child and killed it on the same deadline.
- **Impact**: A hung probe returns `windows-probe-failed` while leaving a live process and listeners behind; repeated activation can accumulate them, so the deadline does not bound installation work.
- **SuggestedFix**: Make the runner cancellation-aware, kill the process tree on deadline, detach listeners, and await close before returning the typed failure. Add a targeted test against the default runner seam rather than only an injected never-resolving promise.
- **Status**: accepted
- **Triage**: Accepted as must-fix, not should-fix: this is a regression I introduced during the extraction. Confirmed against `git show d31d6d1^:src/cursor/CursorHookInstaller.ts` — the deleted `runCommand` carried its own timer calling `child.kill()`, and the extracted copy dropped it while `withDeadline` only races the promise. Fixed by moving the deadline into `runCommand` so the timeout kills and reaps the child.

### W2

- **ID**: W2
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P3
- **Agent**: `asm-review-contracts`
- **File:line**: `package.json:111`
- **Title**: Claude setting claims activity reporting that the transport deliberately drops
- **Evidence**: The setting says the hooks “only report terminal activity,” while `ClaudeHookAgentSession.handle()` accepts and drops every payload and publishes no state until WT-006.3.
- **Impact**: Users opt into a user-config write and local payload posts based on a capability the current implementation does not provide.
- **SuggestedFix**: Describe the setting as installing a fail-open, transport-only Claude observer whose activity is not surfaced yet.
- **Status**: accepted
- **Triage**: Accepted. The description promises activity reporting that D6 deliberately does not implement until WT-006.3, and a user consents to config mutation on the strength of it. Reworded to state the observer is transport-only for now.

### W3

- **ID**: W3
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P3
- **Agent**: `chair`
- **File:line**: `src/agentHooks/install/ManagedConfigInstaller.test.ts:241`
- **Title**: Wrapper tests do not actually pin all emitted bytes
- **Evidence**: Cursor tests compare the installed file with `cursorWrapperScripts()`, the same producer used by the adapter, plus a byte length and selected substrings. Claude POSIX similarly compares against `claudeWrapperScripts().posix` and selected ordering. Same-length Cursor changes and broad Claude POSIX changes can pass because expected and actual change together; only the Claude Windows test has a literal full-script expectation.
- **Impact**: The explicit byte-for-byte regression contract can drift without test failure, including behaviorally meaningful wrapper changes.
- **SuggestedFix**: Assert each wrapper against an independent literal fixture or a hard-coded expected digest and length; keep behavior probes separately.
- **Status**: accepted
- **Triage**: Accepted. The equality assertion is self-referential; only Cursor's length pins and Claude's Windows literal were doing real work. Fixed by pinning the Claude POSIX wrapper to an independent literal and adding a length assertion, matching what the Windows case already does.

### S1

- **ID**: S1
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P4
- **Agent**: `asm-review-reuse`
- **File:line**: `src/agentHooks/install/ManagedConfigInstaller.ts:341`
- **Title**: Shared POSIX quoting helper was duplicated during extraction
- **Evidence**: `posixShellQuoteCommand()` duplicates `src/utils/posixShellQuote.ts` byte-for-byte; the deleted Cursor installer imported the shared helper.
- **Impact**: Future quoting fixes can diverge between hook installation and the other shell-path consumers.
- **SuggestedFix**: Remove the local helper and import `posixShellQuote`.
- **Status**: accepted
- **Triage**: Accepted. Verified `src/utils/posixShellQuote.ts` exists with identical semantics and was itself extracted for exactly this caller in a prior review. Reusing it.

### S2

- **ID**: S2
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P4
- **Agent**: `asm-review-data-security`
- **File:line**: `src/agentHooks/install/claudeConfigAdapter.ts:33`
- **Title**: Relative config-directory overrides write under the extension host CWD
- **Evidence**: The configured directory is trimmed and passed to `join()` without an absolute-path check, despite the adapter contract describing an absolute config path.
- **Impact**: A relative setting silently creates a stray settings file that Claude will normally never read.
- **SuggestedFix**: Require an absolute configured directory and report/refuse invalid values, or explicitly resolve relative input against a documented base.
- **Status**: accepted
- **Triage**: Accepted, minimally: a non-absolute override now falls through to CLAUDE_CONFIG_DIR and then the default rather than resolving against whatever the host process's working directory happens to be, and the setting description says the value must be absolute.
