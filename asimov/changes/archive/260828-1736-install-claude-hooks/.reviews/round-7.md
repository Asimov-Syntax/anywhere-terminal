# Review Round 7: install-claude-hooks

**Date**: 2026-08-27
**Cycle**: 3
**Mode**: discovery
**Scope**: final net whole-change diff, reconstructed as `08fbf5bd2c02bee360b06cabca592e32e2e59b0f..bb15c244516c45f39be96a33b9c0016e8d5b386d` over installation-owned paths. The base tree is the generalized hook runtime merged with `main`, before this change; unrelated merged-main worktree hunks are excluded.
**Head**: `bb15c244516c45f39be96a33b9c0016e8d5b386d`
**Tree state**: dirty non-production metadata/docs at review time; excluded from the explicit whole-change scope
**Reviewable lines**: 1,875 — large change; accuracy may decrease
**Agents spawned**: data-security — D15 ledger/config authority — `gpt-5.6-sol[1M]` replacement after an API-failed attempt; logic — transitions/install lifecycle — `gpt-5.6-terra[1M]`; contracts — adapters/registry/wiring — `sonnet[1M]`; logic — wrappers/probe — `gpt-5.6-terra[1M]`; performance — persistence and queue growth axes — `gpt-5.6-luna[1M]`; reuse — lock/queue extraction cohesion — `gpt-5.6-luna[1M]`
**Agents skipped**: frontend — no UI/rendering files
**Verdict**: **REJECT**
**Open counts**: 7 BLOCK, 1 WARN, 0 SUGGEST

## Gate, scope, and verification evidence

- Gate 2 is approved in `workflow.md`; D1–D15, resolved task Refs and Acceptance, and the delta spec were treated as obligations, with D12/D15 controlling where older text was superseded.
- `bun run asm change verify-status install-claude-hooks` reports every task through 6_2 at `[x]`, exit 0. No project type-check, lint, or test command was run during review.
- Deliberate decisions were not reopened as preferences: commands are never parsed; re-quoted/foreign-root lookalikes are not claimed; corrupt extension-owned ledger JSON is replaceable; a full pending list blocks a move; the wrapper's leading `{}` and JSON `--data-binary` body are settled.
- The whole-change scope excludes the already-reviewed generalized runtime and unrelated worktree code merged from `main`. The shared `keyedSerialQueue` and its worktree consumer remain in scope because this change extracted that primitive.

## Risk map and full-flow trace

- Highest risk: D15's cross-host authority over exact-command ownership and the destinations uninstall/retry claims to inventory.
- High risk: D13 transitions across activation, settings changes, destination moves, pending-ceiling failures, disable, and uninstall.
- High risk: Windows wrapper/process resolution and truthfulness after failed process-tree termination.
- Scale risk: pending destinations, per-agent transition backlog, and whole-document reconciliation against user-sized config files.
- Full flow traced: activation/settings/uninstall command → process-local ledger view and per-agent transition queue → current/recorded/pending inventory → pinned adapter → symlink check → wrapper creation/probe → config lock → ledger command record → classified config read and adapter sweep → atomic replacement → destination finalization → runtime authority; plus restart, second-host, storage-root-move, lock failure, pending overflow, POSIX, and Windows paths.

## Findings

### B5

- **ID**: B5
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-data-security` (corroborated by chair)
- **File:line**: `src/agentHooks/install/managedEntryLedger.ts:82`
- **Title**: D15 serializes writes but still serves cross-host cleanup from stale snapshots
- **Evidence**: `fileLedgerStore` keeps `published` process-local and refreshes it only on this store's `load()` or successful `transact()` (`managedEntryLedger.ts:187-239`). `entry()` and every synchronous `destination`/`pending`/`isOwned` read use that snapshot. Production calls `load()` once at activation (`src/extension.ts:448`). A second host can then record pending destination P; the first host's `uninstallEverything()` builds its destination inventory from its stale view (`agentHookTransitions.ts:83-88`) and never attempts P. Even if removing the current destination later refreshes `published`, the inventory was already frozen, so the command can return `removed` while P still contains managed entries.
- **Impact**: Multi-window uninstall and retry can falsely claim completion and leave a user configuration modified. D15 fixed stale whole-entry replacement on writes, but not the read boundary that D9/D13 use to decide what exists.
- **SuggestedFix**: Give each operation a fresh per-agent ledger snapshot under the ledger's cross-process exclusion before it freezes ownership and destination inventory. For config sweep, refresh while holding the config lock so an installer that writes later cannot race ahead of the ownership snapshot; or introduce a cross-process per-agent transition authority that makes the snapshot and config mutation one ordered operation.
- **Status**: accepted
- **Triage**: persists from round 5 with an evidence delta. Durable facts are no longer overwritten, but another host's durable fact remains invisible to read-only cleanup until this process happens to transact.
- **Author triage**: accepted, and independently corroborated outside the review: an oracle consult run in parallel reached the same read-freshness gap from the design side, citing design.md's own words that reads must be fresh under the ledger authority while `entry()` serves `peek()` and `load()` runs once, outside the lock, at activation. Two findings from the specialist round land in the same place — a stale host reporting a clean uninstall — so the fix is one ordered snapshot, not three patches.
- **Invariant inventory**: Ownership and cleanup facts must be visible to every operation that claims cleanup completion. Boundaries searched: transaction writes, startup load, synchronous ownership, current/recorded/pending inventory, normal transition, uninstall, restart, and second-host writes. Verified safe: each mutation reads fresh inside the ledger lock; same-host reads after that mutation and a new host after `load()` see it. Affected: a long-lived host after another host writes.

### B6

- **ID**: B6
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-data-security`
- **File:line**: `src/agentHooks/install/managedEntryLedger.ts:155`
- **Title**: A failed pre-write ledger transaction no longer stops the configuration write
- **Evidence**: `ManagedConfigInstaller.install()` awaits `recordCommand()` before changing the config, but `ManagedEntryLedger.mutate()` catches every failed `transact()`, stores the update only in the process-local `session` map, and returns `false`. `recordCommand()` discards that result and resolves, so installation continues to atomic config replacement even though no durable ownership fact exists. If the durable entry already contains older commands, a future host does not use the seed and cannot claim the session-only command after this host exits.
- **Impact**: A crash or window termination after config replacement can leave a managed command permanently outside durable cleanup authority. The ordering change that previously fixed B6 is therefore bypassed by D15's failure conversion.
- **SuggestedFix**: Make `recordCommand()` return/throw on persistence failure and abort before touching the user configuration unless the command reached durable storage. Keep session-only fallback only for post-replacement destination finalization, where the config write has already happened.
- **Status**: accepted
- **Triage**: accepted. Verified: `mutate` (`managedEntryLedger.ts:155-170`) swallows a rejected `transact` into the session map and returns false, and `recordCommand` discards that boolean, so `install` proceeds past `ManagedConfigInstaller.ts:116` to replace the user's config with no durable record of the command it wrote. That is the exact inversion of round-4 B6, which the pre-write ordering was introduced to prevent — the ordering survived, the durability behind it did not. Session-only fallback is defensible only AFTER the bytes are on disk, where W5 put it, because there the alternative is losing a file we already modified.
- **Triage**: B6 persists through a new D15 boundary. The command is invoked before replacement, but failed durability is silently treated as success, recreating the same invariant violation.
- **Invariant inventory**: A config mutation may commit only after the exact command authorizing later cleanup is durable, or after a durable recovery intent exists. Boundaries searched: command pre-record, transaction failure, session fallback, atomic config replacement, host exit, seed behavior with an existing command history, and later uninstall. Verified safe: a successful transaction precedes the config write. Affected: failed pre-write transaction converted to session-only success.

### B9

- **ID**: B9
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-data-security` (corroborated by chair)
- **File:line**: `src/extension.ts:353`
- **Title**: Moving the storage root also moves away the ledger needed to recognise the old command
- **Evidence**: Production derives both the wrapper command and `agent-hooks-ledger.json` from `context.globalStorageUri.fsPath` (`extension.ts:353-367`). When that root changes from R1 to R2, the next host opens `R2/agent-hooks-ledger.json`; nothing reads or migrates the ledger at R1. The empty R2 ledger seeds only the command for R2, so D12 deliberately refuses the R1 command and the adapter appends R2 beside it. The root-move test uses one shared in-memory ledger across both roots (`managedEntryLedger.test.ts:109-120`), so it does not model the production co-move.
- **Impact**: The accepted moved-script scenario can leave a dead R1 hook beside the current R2 hook, duplicate every event, and make uninstall unable to remove the old entry. This directly violates convergence and cleanup across a supported storage relocation.
- **SuggestedFix**: Hand this back to planning: exact-byte ownership history must live at an identity stable across wrapper-root relocation, or a trusted migration/pointer must make the previous ledger reachable before any new command is written. A parser fallback would violate D12 and is not the fix.
- **Status**: accepted
- **Triage**: accepted, and this is the finding that returns the change to planning. Verified at `src/extension.ts:348-357`: `agentHookStorageRoot` is `globalStorageUri.fsPath`, and it roots BOTH the wrapper command and the ledger file, so a relocated root takes the ownership history with it and the new root seeds only its own command. The old entry is then unowned: never swept, and re-appended alongside. I confirm the chair's reading of my own test — `managedEntryLedger.test.ts` "still reaches an entry written before the storage root moved" passes one `ledger` object across both roots, which is a scenario production cannot produce. The test proved the command-history mechanism, not the relocation case it is named for. D3 established `globalStorageUri` as stable across extension UPDATES; nothing established it as stable across profile, portable-mode, or remote-vs-local moves, and the design never separated those. A parser is not the fix — that was settled in cycle 1 — so where ownership history lives is a design question, not an implementation one.
- **Triage**: pending author triage; this is a D15 architecture conflict, not a request to weaken D12.
- **Invariant inventory**: Every configuration the extension modified must remain discoverable across every supported wrapper-root move. Boundaries searched: ledger location, wrapper location, seed command, install sweep, uninstall sweep, restart, profile/relocation path, and root-move tests. Verified safe: extension updates where `globalStorageUri` stays fixed and config-destination-only moves within one ledger. Affected: wrapper/global-storage root relocation.

### B11

- **ID**: B11
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic` (corroborated by chair)
- **File:line**: `src/agentHooks/install/cursorConfigAdapter.ts:105`
- **Title**: The Windows Cursor wrapper still executes a working-directory-resolved PowerShell
- **Evidence**: The batch wrapper invokes bare `powershell` while the next helper is correctly qualified as `%SystemRoot%\System32\more.com`. Windows command resolution can select a repository-local `powershell.*` before PATH.
- **Impact**: Opening/running Cursor Agent in a hostile repository can execute repository-controlled code on every hook, consume or alter hook stdin, or stall the agent. This is the same working-directory binary class this change fixed for `more`, `cmd`, and `taskkill`.
- **SuggestedFix**: Invoke the absolute Windows PowerShell executable, such as `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`, using the same trusted absolute-system-path policy as the other Windows helpers.
- **Status**: accepted
- **Triage**: accepted, must-fix, and not eligible for risk acceptance — executing a working-directory-resolved binary in the extension host is the same class as round-3 B4, which was already ruled ineligible. Verified at `cursorConfigAdapter.ts:105`: the wrapper invokes bare `powershell`, while line 107 of the same template qualifies `%SystemRoot%\\System32\\more.com` and `claudeConfigAdapter.ts:213` qualifies `curl.exe`. Task 2_3 fixed this class for `more`/`curl` and missed the PowerShell branch, so the defect predates this cycle and shipped through six rounds unnoticed.
- **Triage**: pending author triage. The bare command predates this change, but arbitrary repository-controlled execution meets the critical-security exception for unchanged code and sits in the Windows hardening impact cone.

### B12

- **ID**: B12
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic` (corroborated by chair)
- **File:line**: `src/agentHooks/install/probeRunner.ts:141`
- **Title**: A started taskkill that exits nonzero is reported as a clean tree-termination attempt
- **Evidence**: Windows termination observes only the spawned `taskkill.exe` process's `error` event. Node does not emit `error` for a process that starts and exits nonzero. No `close`/exit status is checked, no leader fallback runs, and `leaderOnlyTermination` remains false while the reap timer can settle the probe.
- **Impact**: Access denial or another taskkill failure can leave the probe leader and descendants running while the result omits the required incomplete-termination signal, violating D14's truthfulness contract.
- **SuggestedFix**: Coordinate termination asynchronously: observe taskkill startup and nonzero close/exit, mark leader-only before probe settlement, attempt `child.kill()` as fallback, and wait until the termination outcome is known or the reap grace expires.
- **Status**: accepted
- **Triage**: accepted. Verified at `probeRunner.ts:141-147`: the spawned `taskkill.exe` carries only `.on("error", leaderOnly)`. `error` fires when the process cannot be spawned; a taskkill that starts and exits nonzero — access denied, pid already gone — emits no `error`, so no fallback kill runs and `leaderOnlyTermination` stays false. The result then asserts a complete tree termination that may not have happened, which is precisely the claim round-3 W1 and 5_3 set out to make honest.
- **Triage**: pending author triage.

### B10

- **ID**: B10
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-performance` and `asm-review-data-security` (corroborated by chair)
- **File:line**: `src/agentHooks/install/managedEntryLedger.ts:248`
- **Title**: Multi-host session folding bypasses the pending-destination ceiling
- **Evidence**: `recordPending()` caps one entry at 16, but `fold()` concatenates durable `stored.pending` with this host's session-only `held.pending` without applying `MAX_PENDING_DESTINATIONS`; `sanitize()` also accepts any array length. One host can hold 16 paths while ledger writes fail, another host can durably record 16 different paths, and the first host's next successful transaction persists all 32. Repeating this across hosts/history grows the list without a structural bound.
- **Impact**: Every transition and uninstall returns to O(history) cleanup scans and lock waits, reopening the B7 resource failure. The cap also no longer provides the premise B8's `blockedBy` behavior relies on.
- **SuggestedFix**: Enforce one global bound at the store/session merge boundary and prevent new config moves before an unpersisted host can accumulate obligations that may exceed the durable budget. Do not truncate paths; overflow must block before mutation or use a bounded representation that retains cleanup authority.
- **Status**: accepted
- **Triage**: accepted. Verified at `managedEntryLedger.ts:248-258`: `fold` unions `stored.pending` and `held.pending` with no ceiling, while `recordPending` caps only its own append path. Two hosts each holding sixteen unpersisted destinations merge to thirty-two. I accept the fix constraint as stated — bound at the merge boundary and refuse new obligations rather than truncate — because dropping a pending entry is the orphaning D13 exists to prevent, and that direction was already settled in round 4.
- **Triage**: pending author triage; this reopens B7's invariant through D15's new session-fold mechanism, so it is a new finding rather than a severity change to the old insertion defect.
- **Invariant inventory**: Every pending collection and every scan consuming it must remain structurally capped while retaining all cleanup obligations. Boundaries searched: insertion, duplicate detection, direct ceiling refusal, session fallback, cross-host merge, sanitize/load, transition inventory, and uninstall inventory. Verified safe: direct `recordPending` within one current entry. Affected: durable-plus-session fold and oversized loaded entries.

### B13

- **ID**: B13
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-performance`
- **File:line**: `src/extension.ts:432`
- **Title**: Every workspace configuration event creates an unbounded per-agent transition backlog
- **Evidence**: The listener submits one transition for every registered agent on every workspace configuration event, including unrelated settings. `createKeyedSerialQueue` preserves every queued body and has no coalescing or bound. The growth axis is configuration-event history E per host; with pending cleanup, one body can perform many sequential config-lock attempts before the latest desired setting runs.
- **Impact**: A burst of configuration events can retain O(E × agents) promises/bodies and delay the current hook state behind obsolete historical work. With lock-unavailable pending paths, delay grows by event history times pending inventory, contradicting D13's latest-state settlement goal.
- **SuggestedFix**: Filter to hook-relevant settings and use a per-agent latest-state gate: at most one running transition plus one dirty rerun that re-reads current settings and ledger state. Preserve all cleanup obligations in the ledger, not by replaying every event body.
- **Status**: accepted
- **Triage**: accepted as stated, including the mechanism. Verified at `extension.ts:432-438`: every configuration event enqueues one transition per registry agent regardless of which setting changed. The no-op path is cheap today, but B5's fix makes each transition take a cross-process lock and a file read, so the backlog stops being theoretical the moment that lands. I note one constraint the fix must respect rather than modifying it: `createKeyedSerialQueue` deliberately refuses to coalesce (`keyedSerialQueue.ts:5-6`) because dropping one of two enqueued bodies loses work silently. "One running plus one latest-state rerun" is compatible with that — it keeps a pending rerun rather than discarding the need to converge — and I am implementing exactly that, not a general coalescing gate.
- **Triage**: pending author triage.
- **Invariant inventory**: Per-event work must be bounded by current state rather than event history. Boundaries searched: VS Code configuration listener, per-agent enqueue, settled-tail deletion, pending-cleanup latency, and latest desired-state reconciliation. Verified safe: settled tails are deleted and different agents have separate lanes. Affected: queued same-agent bodies before settlement.

### W6

- **ID**: W6
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P3
- **Agent**: `asm-review-performance`
- **File:line**: `src/agentHooks/install/ManagedConfigInstaller.ts:248`
- **Title**: Idempotent installs still rewrite the entire user configuration
- **Evidence**: Both adapters return `true` after sweeping/re-appending their managed entries even when the canonical result is unchanged. Reconcile therefore clones, serializes, and atomically replaces the full document on each enabled activation/forced reconcile. The growth axis is the user-authored config size H, which has no structural bound.
- **Impact**: Repeated windows/activation create avoidable O(H) writes, mtime churn, and larger collision windows with editors for a config whose managed state was already correct.
- **SuggestedFix**: Detect an already-canonical managed state or compare serialized desired bytes with the source and skip atomic replacement when unchanged.
- **Status**: accepted
- **Triage**: accepted, non-blocking. Verified: both adapters return true unconditionally after sweeping and re-appending, so `reconcile` always serializes and replaces even when the canonical result is byte-identical. Cheapest correct form is comparing the serialized bytes against what was read and skipping the replacement, which also removes the mtime churn that gives a concurrent editor something to collide with.
- **Triage**: pending author triage. Full-file parsing is inherent to safe JSON reconciliation; the avoidable finding is the unconditional no-op replacement.

## Carried findings independently verified

- **B8 — fixed**: when cleanup of the recorded/current destination fails and the pending set cannot accept it, `transition()` returns `blockedBy` before either controller call. The ledger destination remains the only record naming the modified file, and uninstall still finds it.
- **W5 — fixed at its accepted invariant**: a failed destination finalization is retained in the session entry, added to pending when possible, and folded into the next successful transaction, so a same-session location change cannot lose the written path.
- **A1 — fixed**: `transition()` compares `resolve(candidate)` with `resolve(destination)`; the raw adapter path is no longer compared directly with canonical ledger paths.

## Specialist adjudication notes

- Contracts found the production adapters, registry, settings, event set, and runtime wiring coherent. Its spec/design prose-drift observations are outside the reviewable-file classification and do not gate this code review.
- Reuse found no current behavior defect. The ledger's private same-file tail and wrapper replacement duplication were not promoted without concrete divergence; the gating issues are the stale cross-host read and cap bypass above.
- The logic specialist's proposed escalation of W5 across a host crash during total ledger-write failure was not carried forward: D15 explicitly defines the in-memory fallback for that unavailable-store state, and the original W5 same-session loss is fixed. No user-granted risk waiver was inferred.

## Author triage summary

Every finding accepted; none rebutted, none risk-accepted. B11 and B12 are not eligible for risk acceptance in any case.

Two reuse findings reached the author directly rather than through the chair's report and are accepted here so they are not lost: `fileLedgerStore` re-implements the settlement-safe serial chaining that `src/utils/keyedSerialQueue.ts` already provides (round-4 S4 extracted it for exactly this reason, so exempting the ledger would be inconsistent), and `ManagedConfigInstaller.createWrapper` repeats the temp-write/chmod/rename/cleanup sequence `LockedFile.atomicReplace` now owns.

B9 changes where ownership history has to live, which is accepted design rather than an implementation defect, so the change returns to planning rather than being fixed in this loop. The remaining seven are implementation work planned alongside it.

An oracle consult run in parallel with this round settled the question standing behind B9 and the ledger's existence: ownership cannot be derived from the hook document. Claude's `hookMatcher` and every `hookCommand` branch are closed with `additionalProperties: false`, so an entry-level sentinel is not schema-valid, and Cursor publishes no unknown-key preservation guarantee. More decisively, a self-identifying command still cannot say WHERE a former `claudeConfigDir` went after a failed cleanup and a restart, which is what D13's pending list exists to answer. The lock-protected file is kept; what B9 moves is its location, not its existence. The oracle also corrected the guarantee this design can honestly claim: never removing a non-identical lookalike or a command-edited entry — not per-occurrence provenance, since a byte-identical copy a user wrote themselves is indistinguishable. That correction is owed to design.md.
