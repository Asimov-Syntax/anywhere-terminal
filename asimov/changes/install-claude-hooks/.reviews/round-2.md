# Review Round 2: install-claude-hooks

**Date**: 2026-08-27
**Cycle**: 1
**Mode**: verification
**Scope**: commit `9cc09722b3c61cac1cba0a28cdfadb58187b90ea` only
**Head**: `9cc09722b3c61cac1cba0a28cdfadb58187b90ea`
**Tree state**: dirty at review time (`.claude/settings.json` and analytics files); explicit commit scope was unaffected
**Reviewable lines**: 225
**Agents spawned**: data-security — config-safety impact cone — `opus[1M]`; logic — destination lifecycle and probe process — `gpt-5.6-terra[1M]`; contracts — settings, wiring, and byte-pin contracts — `sonnet[1M]`
**Agents skipped**: frontend/performance — cone does not touch UI or growth paths; reuse — S1 was directly verifiable from the import; full discovery roster was not repeated
**Verdict**: **BLOCK**
**Open counts**: 2 BLOCK, 2 WARN, 1 SUGGEST

## Scope lock and verification evidence

- Scope lock passed: the commit contains remediation for round-1 findings plus task/review/analytics metadata; no new capability or semantic task/design expansion was found.
- `bun run asm change verify-status install-claude-hooks` reports the original tasks and remediation task 3_1 at `[x]`, exit 0. The coordinator additionally reported type check clean, lint with no new errors, and 3028 tests passing. No project verify command was run during review.
- Cross-restart destination stranding was explicitly recorded as out of contract and is not gating this round. B1 remains open solely for the mid-session transition implemented by this commit.

## Cross-round disposition

| ID | Severity | Round-2 status | Evidence delta |
|---|---|---|---|
| B1 | BLOCK | persists | Per-operation path snapshot is fixed; mid-session A→B cleanup/reconcile remains unserialized and incomplete |
| B2 | BLOCK | persists | Prefix/suffix/argument cases are fixed; malformed and quote-concatenated command tokens are still claimed |
| B3 | BLOCK | fixed | Non-extension group keys survive with `hooks: []`; exact extension-created husks are removed |
| W1 | WARN | persists | Parent kill restored, but the promise resolves before close/reap and descendants are not terminated |
| W2 | WARN | fixed | Package copy now truthfully describes loopback transport and no surfaced activity |
| W3 | WARN | persists | Claude POSIX gained an independent literal; Cursor POSIX/Windows remain generator-relative |
| S1 | SUGGEST | fixed | Existing `posixShellQuote` is reused |
| S2 | SUGGEST | fixed | Relative configured overrides are ignored and the setting says absolute-only |
| S3 | SUGGEST | new | Claude's literal-path adapter reconstructs `dirname(path)/settings.json` rather than pinning the supplied file |

## Open findings

### B1

- **ID**: B1
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic` and `asm-review-contracts` (corroborated by chair)
- **File:line**: `src/extension.ts:192`
- **Title**: Destination changes still bypass serialized reconciliation
- **Evidence**: A location-only event advances `agentHookDestinations` to the new path and starts an unawaited uninstall of the old path. `setDesiredEnabled()` is called only when the enablement key changed, so an enabled A→B location change removes A but never installs B. Cleanup failure is discarded after the map has forgotten A, and later setting events cannot retry it. The cleanup also runs outside the controller queue and its `onWarning` path.
- **Impact**: Hooks disappear from the newly configured destination, while lock/write/unsupported failures can strand managed entries in an old user config with no in-session recovery. This is the same round-1 lifecycle invariant and does not concern the accepted cross-restart limitation.
- **SuggestedFix**: Put destination migration in one per-agent serialized operation: retain A until cleanup succeeds or remains tracked for retry, surface failures, then force reconciliation of the latest desired enabled state at B even when only the location key changed.
- **Status**: accepted
- **Triage**: accepted — confirmed by reading my own listener: a location-only change advances the map and fires an unawaited uninstall of A, while `setDesiredEnabled` runs only when the *enablement* key changed, so enabled hooks end up installed nowhere. My round-1 fix introduced this. Round 3 moves the whole migration into one awaited, testable operation that cleans A, only then advances the map, and forces reconciliation at B; a failed cleanup keeps A recorded so a later change retries it.
- **Invariant inventory**: One destination transition owns old cleanup, failure state, map advancement, and new reconciliation as one serialized lifecycle. Boundaries now verified safe: install/uninstall snapshot one path through symlink check, mkdir, lock, read/stat, comparison, and atomic replacement. Boundaries still affected: configuration listener, stale-destination failure reporting/retry, map advancement, and new-destination reconciliation.

### B2

- **ID**: B2
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic` (corroborated by chair)
- **File:line**: `src/agentHooks/install/ManagedConfigInstaller.ts:441`
- **Title**: Ownership parsing still claims foreign quoted commands
- **Evidence**: `unquote()` returns accumulated text even when no closing quote exists, so an unterminated foreign command ending in the owned pair is claimed instead of failing closed. It also stops at a valid closing quote without checking adjacent token text: POSIX executes `'/x/claude-hooks/claude-hook-observer.sh'.bak` as the `.bak` executable, while `invokedPath()` returns the unsuffixed owned-looking path. A targeted scratch probe confirmed this quote-concatenation behavior. Added tests cover suffixes inside quotes, not unclosed quotes or text concatenated after the quote.
- **Impact**: Install/uninstall can still delete a user-authored hook command that does not invoke the managed wrapper, preserving the round-1 data-loss impact.
- **SuggestedFix**: Return an explicit parse failure unless a closing delimiter is found. Track the consumed token boundary and require the remainder to be whitespace/end; otherwise parse the full concatenated shell word or fail closed. Add single/double unterminated and post-quote suffix cases for both adapters.
- **Status**: accepted
- **Triage**: accepted — verified independently, not taken on report: `sh -c "'/tmp/.../claude-hook-observer.sh'.bak"` prints the .bak file's output while `invokedPath` returns the unsuffixed owned path. Round 3 replaces the single-token unquoter with a real first-word parser per platform (POSIX quoting and backslash, cmd `""`), so adjacent concatenation is resolved the way the shell resolves it and an unterminated quote fails closed.
- **Invariant inventory**: Only a successfully parsed invoked token whose final two path components exactly equal the managed directory/file may be swept. Verified safe: unquoted component boundaries, suffixes inside quotes, argument-only occurrences, same-name foreign directories, emitted POSIX apostrophe escapes, and emitted Windows doubled quotes. Still affected: unterminated leading quotes and adjacent quoted/unquoted token concatenation, across Cursor/Claude install and uninstall through the shared predicate.

### W1

- **ID**: W1
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-logic`
- **File:line**: `src/agentHooks/install/ManagedConfigInstaller.ts:405`
- **Title**: Probe deadline returns before termination is reaped
- **Evidence**: The inner deadline calls `child.kill()` and immediately resolves through `finish(1)` rather than waiting for `close`; descendants are not killed as a process tree. The regression test proves the shell cannot perform a later marker write, but not that children and process resources are gone. The outer deadline is not redundant: it correctly bounds injected runners that do not implement cancellation.
- **Impact**: Installation can return while timed-out probe descendants/listeners remain alive, so the accepted terminate-and-reap contract is only partially restored.
- **SuggestedFix**: On timeout, terminate the applicable process tree and resolve only after `close` confirms reaping, with a secondary hard bound if needed. Keep the outer deadline for injected runners.
- **Status**: accepted
- **Triage**: accepted. The distinction the round draws is right — the two layers are not redundant — and the remaining gap is real: resolving on `kill()` rather than `close` reports a reaping that has not happened, and `cmd.exe /c wrapper` has descendants that a bare `kill` leaves running. Round 3 awaits `close` behind a secondary hard deadline and terminates the group rather than the leader.

### W3

- **ID**: W3
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P3
- **Agent**: `chair`
- **File:line**: `src/agentHooks/install/ManagedConfigInstaller.test.ts:273`
- **Title**: Cursor wrapper bytes remain generator-relative
- **Evidence**: Claude POSIX now has an independent literal and length pin, but Cursor POSIX/Windows still compare installed output with `cursorWrapperScripts()`, the production generator, plus length and selected substrings. A same-length Cursor byte change can still update expected and actual together and pass.
- **Impact**: The accepted byte-for-byte regression contract remains unenforced for the shipped Cursor wrappers.
- **SuggestedFix**: Add independent Cursor POSIX and Windows literals or hard-coded expected digests, retaining the existing length and behavioral assertions.
- **Status**: accepted
- **Triage**: accepted. Correctly scoped: only the Claude POSIX half was done. Round 3 pins both Cursor wrappers to independent literals on the same footing.

### S3

- **ID**: S3
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P4
- **Agent**: `asm-review-data-security`
- **File:line**: `src/agentHooks/install/agentHookRegistry.ts:65`
- **Title**: Claude's pinned-path factory reconstructs rather than pins its argument
- **Evidence**: `createAdapterForPath(configPath)` calls `claudeConfigAdapter({ configuredDirectory: () => dirname(configPath) })`, which always resolves `dirname(configPath)/settings.json` and can fall through when the directory is not absolute. Cursor's implementation returns the supplied file exactly.
- **Impact**: Current callers pass an absolute `settings.json`, so behavior is safe today, but the interface promise is stronger than the implementation and future cleanup callers can be silently retargeted.
- **SuggestedFix**: Add a literal config-file option/factory for Claude that returns the exact supplied path, and test a path resolution would otherwise transform.
- **Status**: accepted
- **Triage**: accepted. The interface says 'pinned to one config file' and the implementation honours only the directory. Round 3 has the adapter take an explicit config file so the factory returns exactly what it was given.

## Fixed prior findings

### B3

- **ID**: B3
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `chair`
- **File:line**: `src/agentHooks/install/claudeConfigAdapter.ts:135`
- **Title**: Sweeping the last managed handler drops user-owned matcher-group metadata
- **Evidence**: `isExtensionCreatedGroup()` now limits group deletion to exactly `{hooks}` or `{matcher: "*", hooks}`; every other emptied group retains its keys with `hooks: []`. Tests cover metadata preservation and extension-created husk removal.
- **Impact**: resolved
- **SuggestedFix**: none
- **Status**: fixed
- **Triage**: accepted in round 1

### W2

- **ID**: W2
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P3
- **Agent**: `asm-review-contracts`
- **File:line**: `package.json:111`
- **Title**: Claude setting claims activity reporting that the transport deliberately drops
- **Evidence**: The description now states that events are posted to loopback and no terminal activity is surfaced yet.
- **Impact**: resolved
- **SuggestedFix**: none
- **Status**: fixed
- **Triage**: accepted in round 1

### S1

- **ID**: S1
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P4
- **Agent**: `asm-review-reuse`
- **File:line**: `src/agentHooks/install/ManagedConfigInstaller.ts:9`
- **Title**: Shared POSIX quoting helper was duplicated during extraction
- **Evidence**: The local duplicate was removed and `src/utils/posixShellQuote.ts` is imported.
- **Impact**: resolved
- **SuggestedFix**: none
- **Status**: fixed
- **Triage**: accepted in round 1

### S2

- **ID**: S2
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P4
- **Agent**: `asm-review-data-security`
- **File:line**: `src/agentHooks/install/claudeConfigAdapter.ts:33`
- **Title**: Relative config-directory overrides write under the extension host CWD
- **Evidence**: The configured override is used only when absolute; relative values fall through, and package copy explicitly documents that behavior.
- **Impact**: resolved
- **SuggestedFix**: none
- **Status**: fixed
- **Triage**: accepted in round 1
