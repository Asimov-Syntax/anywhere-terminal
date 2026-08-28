# Review Round 3: install-claude-hooks

**Date**: 2026-08-27
**Cycle**: 1
**Mode**: verification
**Scope**: commit `00628e29d4452419a6fd1b1cdb331847b81bd103` only
**Head**: `00628e29d4452419a6fd1b1cdb331847b81bd103`
**Tree state**: dirty at review time (`.claude/settings.json` and analytics files); explicit commit scope was unaffected
**Reviewable lines**: 217
**Agents spawned**: logic — final lifecycle/process/parser cone — `opus[1M]`; data-security — ownership and Windows termination — `gpt-5.6-terra[1M]`; contracts — listener and regression-contract coverage — `sonnet[1M]`
**Agents skipped**: frontend/performance/reuse — the verification cone does not touch those lenses
**Verdict**: **REJECT**
**Open counts**: 3 BLOCK, 1 WARN, 0 SUGGEST

## Scope lock and verification evidence

- Scope lock passed: this commit contains round-2 remediation plus review/task/analytics metadata only.
- `bun run asm change verify-status install-claude-hooks` reports remediation task 3_2 and all predecessor tasks at `[x]`, exit 0. The coordinator additionally reported type check clean, lint with zero errors, and 3041 tests passing. No project verify command was run during review.
- W3 and S3 are fixed. B1, B2, and W1 remain open in their impact cones; B4 is a new emergency security finding introduced by W1's remediation.

## Thrash stop

Cycle 1 has reached its maximum third round with BLOCK findings still open. There is no round 4 in this cycle. The B1 destination invariant and B2 ownership invariant have expanded across successive patches, so patch-level fixing has failed. Recommended disposition: hand B1/B2/W1/B4 back to planning for a single transition-owner design, a fail-closed ownership strategy, and one trusted cancellable process-runner contract. Any later review begins cycle 2 in discovery mode after that redesign; the alternative is explicit user-granted risk acceptance through build triage.

## Cross-round disposition

| ID | Severity | Round-3 status | Evidence delta |
|---|---|---|---|
| B1 | BLOCK | persists | One callback is awaited internally, but callbacks overlap; stale enablement/map writes and cleanup-failure orphaning remain |
| B2 | BLOCK | persists | Reported quote-concatenation cases are fixed; production probes still show fail-open POSIX parsing/normalization cases that sweep foreign commands |
| B3 | BLOCK | fixed (round 2) | unchanged |
| W1 | WARN | persists | Process-group kill was added, but the equal outer deadline returns before close/reap |
| W2 | WARN | fixed (round 2) | unchanged |
| W3 | WARN | fixed | Cursor POSIX and Windows now have independent literal pins plus lengths |
| S1 | SUGGEST | fixed (round 2) | unchanged |
| S2 | SUGGEST | fixed (round 2) | unchanged |
| S3 | SUGGEST | fixed | Claude's pinned adapter now returns the exact supplied config file |
| B4 | BLOCK | new | Windows timeout launches unqualified `taskkill` and does not handle its asynchronous spawn failure |

## Open findings

### B1

- **ID**: B1
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic`, `asm-review-data-security`, and `asm-review-contracts` (corroborated by chair)
- **File:line**: `src/extension.ts:189`
- **Title**: Configuration-change transactions still race across listener invocations
- **Evidence**: Each event starts an independent unawaited async IIFE. It snapshots `enabled`, `previous`, and `current`, then crosses an `await` before writing `agentHookDestinations` and forcing controller state. A location migration that captured enabled=true can resume after a later disable event and reinstall hooks. A→B→C events can both read previous=A and let the older continuation overwrite the map after the newer one. Separately, when cleanup of A fails, the map retains A while reconciliation installs B; a later B→C move cleans A and forgets B permanently because one string cannot represent both the active destination and pending cleanup.
- **Impact**: The latest user setting can lose, and hook entries can be permanently stranded in a user configuration that neither the destination map nor uninstall-all can reach.
- **SuggestedFix**: Replace event-local IIFEs with one per-agent serialized transition owner/revision queue. Track the active destination separately from a pending-cleanup set, re-read latest desired state inside the serialized step, and make uninstall-all drain both current and pending destinations. Add deferred-cleanup integration tests against the actual listener orchestration, not only `migrateAgentDestination` in isolation.
- **Status**: accepted
- **Triage**: accepted, and accepted as undesignable by patch. Confirmed: each configuration event starts its own async IIFE with no serialization, so overlapping events interleave and a stale continuation can reinstall after a newer event disabled, or overwrite the destination record. My round-2 fix made the single transition correct and left the *sequence* of transitions unowned. This needs a serialized per-agent transition owner that also distinguishes the active destination from destinations still pending cleanup — a design decision, not another listener edit.
- **Invariant inventory**: One per-agent transition must serialize settings revision, old cleanup, pending failures, destination-map state, controller desired state, and new reconciliation. Verified safe: one install/uninstall operation holds one immutable filesystem path; one isolated migration helper call awaits cleanup. Still affected: cross-event ordering, stale enabled snapshots, concurrent map read/write, and representing active plus pending-cleanup destinations.

### B2

- **ID**: B2
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `chair` (logic and contracts confirmed the parser does not implement complete POSIX quote/escape semantics)
- **File:line**: `src/agentHooks/install/ManagedConfigInstaller.ts:496`
- **Title**: Hand-rolled POSIX parsing still sweeps foreign hook commands
- **Evidence**: Double-quoted runs locate their closing quote with raw `indexOf`, ignoring POSIX backslash escaping, and the shared post-parse normalization converts every backslash to `/` even on POSIX where a quoted backslash is a literal filename character. Targeted probes against the production installer showed both an escaped-terminal-quote command and a valid single-quoted path containing a literal backslash were removed and replaced as owned entries. The new tests cover plain unterminated quotes and post-quote suffix concatenation, not these fail-open cases.
- **Impact**: Install/uninstall still silently deletes a user-authored Cursor or Claude handler whose invoked path is not the managed wrapper, preserving the original B2 data-loss impact.
- **SuggestedFix**: Stop extending the ad-hoc parser patch-by-patch. Use a reviewed platform tokenizer or a deliberately narrower ownership encoding/grammar that can be proven fail-closed. At minimum, implement POSIX quote states and in-double-quote escapes character-by-character, and make separator handling platform-specific (`/` only on POSIX).
- **Status**: accepted
- **Triage**: accepted. Verified independently: a single-quoted POSIX path containing a literal backslash (`my\cursor-hooks`, one real directory) is turned into two segments by `normalizeSeparators` and claimed as owned, so that user hook would be deleted. The escaped-terminal-quote input I constructed does fail closed, so I confirm one of the two probes rather than both. The conclusion stands either way, and so does the wider point: three parser revisions have each fixed the named case and left a new one. Ownership must stop depending on parsing an arbitrary user string.
- **Invariant inventory**: A foreign command must never be claimed; unsupported syntax fails closed. Verified safe: reported post-quote suffixes, plain unterminated quotes, argument-only occurrences, and standard emitted quoting. Still affected: POSIX escaped delimiters inside double quotes and literal backslashes in quoted POSIX filenames. The inventory has expanded in both verification rounds, triggering planning handback.

### B4

- **ID**: B4
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-data-security` (corroborated by chair)
- **File:line**: `src/agentHooks/install/ManagedConfigInstaller.ts:438`
- **Title**: Windows timeout executes an untrusted `taskkill`
- **Evidence**: `terminateTree()` uses `spawn("taskkill", ...)` rather than the absolute System32 executable. Windows executable resolution can select the inherited working directory before PATH—the same ordering this change already corrected for wrapper binaries. The returned killer process is discarded with no `error` listener, so lookup/policy failure emits asynchronously outside the surrounding `try/catch`; the intended fallback never runs.
- **Impact**: A malicious working directory can substitute an executable in the extension-host context. Independently, taskkill startup failure can crash the extension host or leave the timed-out probe tree alive while reporting failure normally.
- **SuggestedFix**: Resolve and invoke the trusted `%SystemRoot%\System32\taskkill.exe` explicitly. Attach synchronous `error`/close handling to the killer, fall back to direct child termination when it cannot start, and report completion only from a contained termination outcome.
- **Status**: accepted
- **Triage**: accepted. Same class as the unqualified `more` I fixed in task 2_3, which makes missing it here my error rather than an unforeseeable one: `spawn("taskkill")` searches the working directory before PATH on Windows, and the child has no `error` listener, so a spawn failure escapes the surrounding try/catch. Belongs with B1/B2 in one trusted, cancellable process-runner contract rather than a spot fix.

### W1

- **ID**: W1
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-logic` (corroborated by chair)
- **File:line**: `src/agentHooks/install/ManagedConfigInstaller.ts:217`
- **Title**: The outer probe deadline preempts the inner reap wait
- **Evidence**: `runCommand` and the installer-level `withDeadline` both use 2000 ms. At the deadline, the inner timer starts process-tree termination and arms the 500 ms reap grace without resolving; the outer timer then resolves its fallback in the same timer phase. The production installer therefore returns before `close` or the reap deadline, while the direct `runCommand` regression test cannot exercise this composition.
- **Impact**: Process termination is initiated, but the accepted sequencing guarantee—installation reports only after close/reap or its secondary bound—is not enforced on the actual installer path.
- **SuggestedFix**: Keep both layers, but set the outer injected-runner bound strictly beyond the inner deadline plus reap grace and margin, or expose an explicit cancellable-runner contract whose production implementation owns the complete timeout.
- **Status**: accepted
- **Triage**: accepted. Both deadlines are 2,000 ms, so the outer one fires first and resolves before the inner reap grace has run — the awaiting I added in round 3 is preempted and never observed. Folded into the same process-runner redesign.

## Fixed in round 3

### W3

- **ID**: W3
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P3
- **Agent**: `chair`
- **File:line**: `src/agentHooks/install/ManagedConfigInstaller.test.ts:313`
- **Title**: Cursor wrapper bytes remain generator-relative
- **Evidence**: Both Cursor wrappers now have independent full literals alongside the existing generator equality, length, and behavior assertions.
- **Impact**: resolved
- **SuggestedFix**: none
- **Status**: fixed
- **Triage**: accepted in round 2

### S3

- **ID**: S3
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P4
- **Agent**: `asm-review-data-security`
- **File:line**: `src/agentHooks/install/agentHookRegistry.ts:65`
- **Title**: Claude's pinned-path factory reconstructs rather than pins its argument
- **Evidence**: `createAdapterForPath` now supplies `configFile`, and the resolver returns that exact value before directory/environment/default resolution. A non-default filename is covered for both agents.
- **Impact**: resolved
- **SuggestedFix**: none
- **Status**: fixed
- **Triage**: accepted in round 2

## Previously fixed and carried forward

| ID | Severity | Status |
|---|---|---|
| B3 | BLOCK | fixed in round 2 |
| W2 | WARN | fixed in round 2 |
| S1 | SUGGEST | fixed in round 2 |
| S2 | SUGGEST | fixed in round 2 |
