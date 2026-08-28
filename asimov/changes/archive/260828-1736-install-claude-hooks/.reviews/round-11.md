# Review Round 11: install-claude-hooks

**Date**: 2026-08-27
**Cycle**: 5
**Mode**: discovery
**Scope**: explicit range `ce2e801..9b6bd9ee2bb051feb387c4abf26d1a74cf880da0`, interpreted through the `install-claude-hooks` change context; unrelated merged-main worktree hunks and the generalized runtime already present at `ce2e801` excluded
**Head**: `9b6bd9ee2bb051feb387c4abf26d1a74cf880da0`
**Tree state**: clean before writing this review artifact; targeted probes used temporary directories and removed them in the same command
**Reviewable lines**: approximately 2,412 installation-owned added/modified lines — large change; accuracy may decrease
**Agents spawned**: data-security — ledger identity/durability — `gpt-5.6-sol[1M]`; logic — transitions/activation — `gpt-5.6-terra[1M]`; contracts — adapters/outcomes/wiring — `sonnet[1M]`; performance — ledger bounds/growth — `gpt-5.6-terra[1M]`; logic — wrappers/probe — `gpt-5.6-luna[1M]`; reuse — lock/queue/ownership cohesion — `gpt-5.6-luna[1M]`
**Agents skipped**: frontend — no UI/rendering surface in the installation-owned diff
**Support agent**: `asm-finder` — ownership and lifecycle caller trace
**Verdict**: **REJECT**
**Counts**: 9 BLOCK, 2 WARN, 0 SUGGEST

## Gate, scope, and verification evidence

- Gate 2 is approved. D17-D19, earlier unsuperseded decisions, resolved task Refs, Acceptance, Boundaries, and the delta spec were treated as obligations.
- The caller reports the HEAD gate clean: check-types; `biome check src`; 4,554 tests across 229 files; `asm change verify-status` exit 0. No project type-check, lint, or test command was run during review.
- Targeted scratch probes confirmed: a shared `(path, command)` claim is removed from configuration while another claim survives; seed ownership re-arms after cleanup; migrated candidates disappear through sanitization; claims exceed 16; a prepared current-path reservation survives reconciliation; and uninstall reports `not-installed` while unresolved paths remain.
- Settled decisions were not reopened: exact command-byte equality remains required; no parser/substring matcher is proposed; the ledger remains at `~/.anywhere-terminal/agent-hooks-ledger.json`; the POSIX leading `{}`, fully-qualified Windows executables, and NUL record key remain intentional.

## Risk map and full-flow trace

- Highest risk: D17-D19's identity chain — installation scope → durable reservation → config mutation → claim finalization → path-scoped ownership → cleanup/surfacing.
- Highest risk: two installations sharing one machine ledger while targeting the same or different configuration paths and wrapper roots.
- High risk: legacy migration, prepared reservations, capacity admission, and every path that can report cleanup complete.
- High risk: config/ledger/wrapper cross-process locking and Windows probe termination truthfulness.
- Growth axes: writes per agent, claims per write per installation/scope churn, failed-persistence session entries per host, migrated unresolved obligations, user-config bytes, and configuration-event history.
- Full flows traced: activation with enabled/disabled settings; first-run scope minting; install success and each pre/post-write failure; location-only settings change; same-path and different-path multi-installation claims; disable and move; uninstall-all; legacy migration with and without surviving commands; prepared reservation after restart; wrapper creation on POSIX/Windows; probe natural close/error/deadline/termination orderings.

## Findings

### B10

- **ID**: B10
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-performance` (corroborated by chair and the existing regression test)
- **File:line**: `src/agentHooks/install/managedEntryLedger.ts:245-262,326-345,442-450`
- **Title**: Session-held writes still bypass the durable reservation ceiling
- **Evidence**: `recordPending()` may add a new `{path, command: ""}` key. If its transaction fails, `mutate()` stores that new key in `session`. A later transaction folds the held key into the durable 16-write entry before applying its capacity check; when the current change is refused, the already-folded 17-write entry is still persisted. `managedEntryLedger.test.ts:601-625` explicitly expects the merged view to contain `MAX_TRACKED_WRITES + 1`. Repeating the sequence across hosts persists `16 + hosts` writes.
- **Impact**: The advertised structural bound is absent. Ledger parse/stringify/rewrite and cleanup scans grow with failed-host history, and the collection can overflow while preserving neither D17's reservation-only admission nor B10's bounded-work invariant.
- **SuggestedFix**: Remove every key-adding compatibility path outside durable `reserve()`. Session state may update only an already-reserved key. Reject any transaction whose fully folded entry exceeds the durable bound rather than persisting the overflow.
- **Status**: accepted
- **Triage**: persists from round 9. D17's representation is sound only if reservation is the sole admission boundary; `recordPending()` and the session fold bypass it.
- **Invariant inventory**: Every tracked-write collection and cleanup scan must stay structurally capped while retaining admitted obligations. Boundaries searched: reservation, transition fallback, session catch, fold, durable transaction, sanitize/load, pending scan, uninstall scan. Verified safe: a direct durable reservation against a non-overflowed entry. Affected: failed-persistence session key folded into another host's full durable entry.

### B14

- **ID**: B14
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic` and `asm-review-data-security` (corroborated by chair and targeted probe)
- **File:line**: `src/agentHooks/install/ManagedConfigInstaller.ts:153-166`; `src/agentHooks/install/managedEntryLedger.ts:301-311`
- **Title**: Removing one installation deletes a hook still claimed by another
- **Evidence**: `uninstall()` removes every ledger-owned handler from the shared configuration before `recordRemoved()` releases only the caller's scope. With claims `[A, B]` on one `(path, command)`, A's uninstall removes the hook, then `release()` retains B's claim. A targeted real-file probe produced `claimsBefore: [A,B]`, `removed: true`, B's destination still recorded, and no hook bytes remaining.
- **Impact**: Installation B remains enabled and durably claims a registration that no longer exists. One profile/window can silently disable another's Claude or Cursor observability, violating D18's last-claim cleanup rule.
- **SuggestedFix**: Make release and cleanup one claim-aware operation. Under the ledger/config authority, release this scope first and rewrite the configuration only when no live claim remains; otherwise report successful detachment without removing the shared entry.
- **Status**: accepted
- **Triage**: persists from round 9. Multiple paths are now representable, but the cleanup boundary still ignores claim cardinality.
- **Invariant inventory**: Every live installation claim must prevent removal until the last claim is released. Boundaries searched: same path/same command, different paths, disable, move, uninstall-all, release persistence. Verified safe: different paths remain independently discoverable. Affected: ordinary disable/move from a shared `(path, command)`.

### B19

- **ID**: B19
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic` (corroborated by chair)
- **File:line**: `src/agentHooks/install/ManagedConfigInstaller.ts:124-130`; `src/agentHooks/install/managedEntryLedger.ts:512-525`
- **Title**: Installing a new command at a shared path erases the other installation's live claim
- **Evidence**: Install-time sweeping accepts every command owned anywhere in the agent ledger, not just the installing scope. When A and B target one config path but have different wrapper roots/commands, B removes A's active command and appends B's. `claim()` then discards every other record at that path and retains only B's command and claim; A's controller remains authoritative but its claim and hook are gone. Existing two-installation tests use different paths or stub the controller and do not cover this case.
- **Impact**: The last writer silently disables the other installation. When B later disables or moves, neither registration remains although A still reports enabled.
- **SuggestedFix**: Define and implement a shared-path replacement policy. If one command is canonical for the file, transfer every still-live same-path claim to the replacement write; otherwise preserve peer-owned commands. Never discard another installation's live claim merely because the wrapper command changed.
- **Status**: open
- **Triage**: pending author triage.
- **Invariant inventory**: Rewriting one shared configuration must preserve every installation still entitled to that configuration. Boundaries searched: same path/same command, same path/different command, different wrapper roots, install sweep, claim finalization, later disable. Verified safe: different paths in the current tests. Affected: same path with different wrapper commands.

### B20

- **ID**: B20
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-data-security` (expanded by chair and targeted probe)
- **File:line**: `src/agentHooks/install/managedEntryLedger.ts:65-80,166-183`; `src/agentHooks/install/ManagedConfigInstaller.ts:124-125,153-156`
- **Title**: D19 ownership is still command-global and its bootstrap seed re-arms
- **Evidence**: The ownership contract remains `isOwned(command)`; it never receives the configuration path, so a recorded `(path A, command C)` authorizes deletion of C from path B. The fallback also remains `writes.length === 0 ? command === seedCommand`: no concrete bootstrap `(currentPath, seedCommand)` record is materialized or consumed. A targeted probe showed seed ownership true before cleanup and true again afterward with an empty ledger.
- **Impact**: The extension can delete a byte-identical entry the user placed at another settings path, or delete a later user-authored copy after the pre-ledger entry was already cleaned. Both are irreversible mutations of user-owned configuration and directly contradict D19's `(path, command)` identity and one-time bootstrap.
- **SuggestedFix**: Bind ownership to the canonical path being reconciled. Materialize the bootstrap once as a durable path-command record before any sweep, persist that it was consumed, and never infer bootstrap state from an empty collection again.
- **Status**: open
- **Triage**: pending author triage.
- **Invariant inventory**: Ownership must require durable evidence for this exact canonical path and command, with bootstrap authority consumed once. Boundaries searched: install sweep, uninstall sweep, moved destination, copied identical command, empty ledger, post-cleanup ledger. Verified safe: non-identical lookalikes and edited commands. Affected: identical command at another path and seed reuse after cleanup.

### B21

- **ID**: B21
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic`, `asm-review-data-security`, and chair
- **File:line**: `src/agentHooks/install/managedEntryLedger.ts:465-485,528-547`; `src/agentHooks/install/agentHookTransitions.ts:155-175`
- **Title**: Legacy unresolved obligations lose their evidence and are reported clean
- **Evidence**: `migrate()` creates `candidates`, and ownership depends on them, but `sanitize()` omits `candidates`; the first persisted/read new-shape value therefore loses every surviving legacy command. Separately, uninstall treats `not-installed` as clean, calls `clearPending()`, and does not add the path to `left`; `clearPending()` deliberately retains unresolved records, and `unresolved()` has no production caller. A targeted probe returned `not-installed` with `left: []` while both unresolved paths remained. `claim()` also drops other same-path records, so a new install can discard an unresolved pointer even when the unrecognized old hook remains in the file.
- **Impact**: A migrated hook can keep firing while its only recognition evidence disappears, its record consumes capacity indefinitely, and the user is told there was nothing to remove. This is the optimistic-success outcome D19 was written to prevent.
- **SuggestedFix**: Preserve validated candidate arrays through sanitization and persistence; retain unresolved same-path records until positive recognition; and include every still-unresolved path in transition warnings and uninstall `left`/summary rather than treating `not-installed` as completion.
- **Status**: open
- **Triage**: pending author triage.
- **Invariant inventory**: Unprovable history must remain recognizable when evidence survives, remain tracked when it does not, and be surfaced until positively resolved. Boundaries searched: old-shape migration, sanitize, persistence round-trip, ownership, install finalization, clearPending, uninstall summary. Verified safe: an untouched in-memory legacy value before any mutation. Affected: first mutation/read and every user-facing cleanup result.

### B22

- **ID**: B22
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic` and `asm-review-data-security` (corroborated by chair)
- **File:line**: `src/extension.ts:75-91`
- **Title**: Installation identity is used before it is durably and uniquely minted
- **Evidence**: When the key is absent, `installationScope()` returns a random UUID immediately and fires `globalState.update()` with `void`; the API returns `Thenable<void>`. Two concurrently activating hosts can both observe no value, mint different IDs, and durably claim writes before competing updates settle. Update failure is ignored. Future sessions retain at most one of those IDs. The VS Code API contract only promises that `globalState` is workspace-independent; it does not document the stronger profile/installation isolation D18 assumes.
- **Impact**: Losing scopes become permanent orphan claims. Later disable/move cannot release them, last-claim cleanup is blocked, and capacity can fill with identities no running installation can ever present again.
- **SuggestedFix**: Initialize identity asynchronously before constructing the ledger, under an atomic cross-host compare-and-create authority, and fail typed if it cannot persist. Use an identity source whose profile/installation isolation is an explicit supported contract rather than an undocumented assumption.
- **Status**: open
- **Triage**: pending author triage.
- **Invariant inventory**: Every durable claim must be releasable by the installation identity that created it, and one installation must mint exactly one durable identity. Boundaries searched: first activation, concurrent windows, update failure, restart, profile isolation, later release. Verified safe: an already-persisted non-empty ID. Affected: first mint and any undocumented scope sharing.

### B23

- **ID**: B23
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-performance` (corroborated by chair and targeted probe)
- **File:line**: `src/agentHooks/install/managedEntryLedger.ts:206-223,512-519`
- **Title**: Claim growth is unbounded despite D18 counting claims against capacity
- **Evidence**: Reservation admission checks only `entry.writes.length`. A known `(path, command)` is always admitted, while `claim()` appends every distinct scope with no ceiling. A targeted probe added 20 scopes to one write despite `MAX_TRACKED_WRITES = 16`; scope churn from B22 makes the axis practically reachable.
- **Impact**: One write's claim array and every whole-ledger read/copy/stringify/rewrite grow with installation/profile history, outside the advertised structural bound. Stale claims also retain cleanup authority indefinitely.
- **SuggestedFix**: Define one atomic capacity over writes plus claims as D18 requires. Reject a new claim before mutation when that capacity is exhausted, and provide a safe, explicit stale-scope reclamation policy rather than unlimited append.
- **Status**: open
- **Triage**: pending author triage.
- **Invariant inventory**: Every independently growing ledger unit must have a structural admission bound. Boundaries searched: new write, known-write reservation, claim append, duplicate scope, scope churn, full-file persistence. Verified safe: duplicate use of the same scope. Affected: each distinct installation scope claiming an existing write.

### B24

- **ID**: B24
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic` and `asm-review-contracts` (corroborated by chair)
- **File:line**: `src/agentHooks/AgentHookController.ts:204-213`; `src/agentHooks/install/agentHookTransitions.ts:237-244`; `src/agentHooks/install/types.ts:44-53`
- **Title**: Installer refusal is narrowed away and the transition reports reconciliation
- **Evidence**: `ManagedConfigInstaller` returns actionable `at-capacity` detail in `blockedBy`, but `AgentHookController.install()` narrows every outcome to `{success, reason}` and drops the paths. `setDesiredEnabled()` resolves `void` even when installation fails. `transition()` then unconditionally returns `reconciled: true` after the false→desired controller calls.
- **Impact**: A move can remove the old hook, fail to install the enabled hook at the new destination, return `reconciled: true`, and surface only `at-capacity` without the paths the user must clear. This is exactly the optimistic success and non-actionable typed failure the change's intent rejects.
- **SuggestedFix**: Return a revision-bound structured controller outcome carrying the full installer result. Mark the transition reconciled only when the final desired state actually succeeded, propagate `blockedBy`, and retain or restore the previous installation when the move cannot complete safely.
- **Status**: open
- **Triage**: pending author triage.
- **Invariant inventory**: Every async reconciliation boundary must report the actual settled hook state and retain actionable typed details. Boundaries searched: installer result, controller narrowing, desired-state revision, transition return, warning callback, move rollback. Verified safe: successful installs and scalar non-capacity warning text. Affected: every failed final install, especially capacity refusal after stale cleanup.

### B25

- **ID**: B25
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `chair`
- **File:line**: `src/agentHooks/install/ManagedConfigInstaller.ts:118-130`; `src/agentHooks/install/agentHookTransitions.ts:207-244`
- **Title**: A prepared reservation at the current disabled path is never retried or released
- **Evidence**: Install reserves before reading/reconciling the config, but no cancellation exists when the known operation returns `unsupported` or fails before replacement. On the next disabled activation, controller uninstall may return `not-installed`/`unsupported` without `recordRemoved()`. `transition()` includes the reservation in `pending`, then filters it out of `stale` because it equals the current configured path; with no force or move it performs no cleanup. A targeted probe left the prepared current path pending after the transition.
- **Impact**: A reservation for bytes never written can consume capacity forever. Repeating failed installs or crash/restart/location sequences can exhaust all 16 slots and prevent unrelated future hook installation, while normal activation never advances the obligation.
- **SuggestedFix**: Add an explicit reservation-cancel/finalize state transition for failures known to precede the config write. During disabled reconciliation, process prepared obligations even when they equal the current configured path, clearing them after a positively safe no-op sweep.
- **Status**: open
- **Triage**: pending author triage.
- **Invariant inventory**: Every admitted reservation must eventually become a claimed live write, a surfaced unresolved obligation, or a cleared no-write record. Boundaries searched: reserve, unsupported read, replacement failure, crash, disabled startup, current-path filtering, uninstall-all. Verified safe: enabled restart that successfully installs and finalizes the same pair. Affected: disabled/current-path prepared records and known pre-write failures.

### W7

- **ID**: W7
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic`
- **File:line**: `src/agentHooks/install/probeRunner.ts:143-146`
- **Title**: A child error after the deadline bypasses the termination gate
- **Evidence**: The `close` handler correctly defers settlement while `killing`, but the `error` handler always calls `finish(1)`. A failed fallback `child.kill()` can emit `error` after the deadline while taskkill/close is still pending.
- **Impact**: The probe may return before child closure or the termination outcome is known, leaving the process or descendants alive despite the runner's wait-and-reap contract.
- **SuggestedFix**: Once `killing` is true, treat `error` as state and settle through the same `finishWhenKnown()`/grace gate; retain immediate failure only before the deadline.
- **Status**: open
- **Triage**: pending author triage. This is a different event boundary from round-9 B12's fixed `close` listener race.

### W8

- **ID**: W8
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P3
- **Agent**: `asm-review-performance`
- **File:line**: `src/agentHooks/install/ManagedConfigInstaller.ts:252-329`
- **Title**: Reconciliation fully buffers an unbounded user settings file several times
- **Evidence**: Each attempt reads and parses the whole document, `structuredClone`s it, stringifies it, and `matches()` reads the whole file again; up to three attempts produce multiple full-file allocations and reads. Claude's general user settings file has no structural size cap in this change.
- **Impact**: Activation and settings reconciliation can consume memory and I/O proportional to an arbitrarily large user file, with repeated work under contention.
- **SuggestedFix**: Define a supported file-size ceiling before buffering/parsing and return the typed unsupported outcome above it, while retaining whole-document atomic reconciliation within the bounded domain.
- **Status**: open
- **Triage**: pending author triage.

## Round-9 blockers adjudicated

- **B10 — persists**: session-held key admission and fold still exceed the structural ceiling.
- **B12 — fixed at its original invariant**: after the deadline, the sole `close` listener waits for both child close and terminator outcome or grace. W7 is a different `error`-event bypass.
- **B14 — persists**: claims represent multiple installations, but ordinary uninstall removes before last-claim evaluation.
- **B15 — fixed**: location-only configuration events submit `force: true` through the extracted event seam.
- **B16 — fixed**: transition refresh failure returns a typed unavailable result, coalesced state is released in `finally`, and uninstall aggregates with `allSettled`.
- **B17 — fixed at its original invariant**: tracked writes retain their exact command per path with no independent command eviction. B20/B21 are distinct D19 identity/migration mechanisms.
- **B18 — fixed**: wrapper replacement now takes the shared `LockedFile` lock before atomic replacement; the frozen-clock collision test exercises concurrent hosts.

## Specialist adjudication notes

- Rejected the proposed blocker on post-write claim-finalization durability: D15/D17 explicitly accept session-only state updates after bytes are already written, provided the durable reservation exists. The defects above concern false claim semantics and reporting, not that accepted fallback itself.
- Rejected the proposed blocker on replacing malformed extension-owned ledger JSON: prior accepted review context explicitly permits replacing corrupt extension-owned bookkeeping; D10's byte-preservation rule protects the user's config, not this file.
- Dropped two reuse warnings about duplicated path construction/canonicalization: both implementations currently agree and no changed-path behavior failure was demonstrated. Future drift alone is not a finding.
- No `.only` or `.skip` was found in the changed tests. The principal coverage gaps are same shared path with multiple claims/commands, seed consumption after cleanup, migrated candidates after persistence, claim-count capacity, prepared current-path cleanup, and controller propagation of `blockedBy`.
