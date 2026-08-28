# Review Round 9: install-claude-hooks

**Date**: 2026-08-27
**Cycle**: 4
**Mode**: discovery
**Scope**: explicit range `ce2e801..9f2b2e086c240356f8fa3311ea57bc3f88483b31`, interpreted through the `install-claude-hooks` change context; unrelated merged-main worktree hunks excluded
**Head**: `9f2b2e086c240356f8fa3311ea57bc3f88483b31`
**Tree state**: clean after restoring analytics files touched by `asm change verify-status`; explicit commit range unaffected
**Reviewable lines**: approximately 2,103 installation-owned reviewable lines — large change; accuracy may decrease
**Agents spawned**: data-security — ledger ownership/durability — `gpt-5.6-sol[1M]`; logic — transition state flow — `gpt-5.6-terra[1M]`; logic — wrappers/probe — `sonnet[1M]`; contracts — adapters/outcomes/wiring — `gpt-5.6-terra[1M]`; performance — bounded growth — `gpt-5.6-luna[1M]`; reuse — lock/queue cohesion — `gpt-5.6-luna[1M]`
**Agents skipped**: frontend — no UI/rendering surface in the installation-owned diff
**Verdict**: **REJECT**
**Counts**: 7 BLOCK, 0 WARN, 0 SUGGEST

## Gate, scope, and verification evidence

- Gate 2 is approved. D12–D16, resolved task Refs, Acceptance, and Boundaries were treated as obligations.
- `bun run asm change verify-status install-claude-hooks` reports every task through 7_5 at `[x]`, exit 0. No project type-check, lint, or test suite was run during review.
- Settled decisions were not reopened: ownership remains exact command-byte equality against the ledger; no parser/substring matcher is proposed; the POSIX leading `{}` and fully qualified Windows executables remain intentional.
- Full flows traced: activation and startup location drift; enabled and location-only setting events; uninstall-all; cross-host ledger/config locking; wrapper-root moves; durable pre-write and session-only post-write failures; pending/command ceilings; Windows wrapper probe and termination races.

## Findings

### B10

- **ID**: B10
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-performance` (corroborated by chair)
- **File:line**: `src/agentHooks/install/managedEntryLedger.ts:307-322`
- **Title**: Session/store folding still bypasses the pending-destination ceiling
- **Evidence**: `recordPending()` checks `MAX_PENDING_DESTINATIONS`, but `fold()` unions all stored and session-only paths without that bound. The new regression test explicitly expects `MAX_PENDING_DESTINATIONS + 1` at `managedEntryLedger.test.ts:543-545`. Multiple hosts can each accumulate a bounded session list while the store is unavailable and later persist those lists serially, growing the durable list by host/failure history.
- **Impact**: Transition and uninstall scans, lock time, and ledger size grow with cleanup history despite the advertised structural cap. B8's stop-the-move premise no longer describes the merged collection.
- **SuggestedFix**: Redesign the merge boundary so every representation remains structurally bounded without dropping cleanup authority, for example a durable blocked/overflow state or a compact per-destination record. Do not bless over-cap unions as the fix.
- **Status**: accepted
- **Triage**: persists from round 7. The direct insertion boundary is capped, but the same invariant remains violated through the session/store merge mechanism the claimed fix tests now codify.
- **Author triage**: accepted, and I am not proposing another patch for it. Round 4 capped insertion (B7); round 7 moved the ceiling to the merge boundary and refused additions rather than truncating (B10). The invariant has now survived two fix attempts because the two halves cannot both hold in the current representation: a list that retains every cleanup obligation from every host is not bounded, and a bounded list drops obligations D13 exists to preserve. This needs a representation that is bounded without discarding authority, which is a design decision.
- **Invariant inventory**: Every pending collection and scan consuming it must remain structurally capped while preserving all cleanup obligations. Boundaries searched: direct insertion, session fallback, cross-host merge, persisted reload, transition inventory, uninstall inventory. Verified safe: one host's direct append against its current merged view. Affected: merging independently accumulated host state.

### B12

- **ID**: B12
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic` (corroborated by chair and targeted probe)
- **File:line**: `src/agentHooks/install/probeRunner.ts:132-145`
- **Title**: The original child-close listener still settles before the termination outcome is known
- **Evidence**: After the deadline, the new listener gates on both `terminated` and `closed`, but the unconditional listener registered earlier still executes first on the same `close` event and calls `finish(code ?? 1)`. A targeted mock made the leader close at 5 ms and the failing terminator report at 50 ms; `runProbe` returned at 6 ms without `leaderOnlyTermination`.
- **Impact**: A partial or failed Windows tree kill can still be reported without the incomplete-termination signal, exactly the optimistic-success path D14 and B12 require closed.
- **SuggestedFix**: Once the deadline fires, prevent the original close/error handlers from settling. Route completion exclusively through the gate that waits for both child close and terminator outcome, or the reap-grace fallback. Add the reverse-order race test.
- **Status**: accepted
- **Triage**: persists from round 7. Nonzero terminator status is now observed, but the earlier listener bypasses that observation when the leader closes first.
- **Author triage**: accepted. Verified at `probeRunner.ts:132-145`: the gated `child.once("close")` is registered inside the deadline timer, but `child.on("close", (code) => finish(code ?? 1))` was registered at spawn time and therefore runs first, settling the probe before `terminated` is known. My round-7 fix added the correct gate and left the unconditional path that bypasses it — the finding is exactly right. Implementation fix: after the deadline fires, the unconditional close listener must stop being able to settle.
- **Invariant inventory**: After deadline, no result may settle until child closure and termination outcome are both known or grace expires. Boundaries searched: natural close, spawn error, deadline, leader close before killer, killer before leader, nonzero killer, grace expiry. Verified safe: killer outcome known before leader close. Affected: leader close first.

### B14

- **ID**: B14
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-data-security` (expanded by chair full-flow trace)
- **File:line**: `src/extension.ts:455-458`; `src/agentHooks/install/managedEntryLedger.ts:36-43,145-149`
- **Title**: The singular destination record is overwritten before prior or parallel configurations are reconciled
- **Evidence**: Startup calls `agentHookController.start()` before loading and reconciling the ledger. If `claudeConfigDir` changed while the extension was closed, initial install writes the new config and `recordInstalled()` replaces the old singular `destination`; the later transition can no longer inventory the old file. D16 also makes one ledger serve every local VS Code installation, while the supported machine-scoped config override can make two profiles/installations target different settings files; one `destination` cannot represent both, so each host treats the other's file as stale or overwrites its only pointer.
- **Impact**: A user-authored config the extension modified can become undiscoverable and survive uninstall, or two simultaneously enabled installations can remove/replace each other's registration. D16 fixes ledger location but its widened sharing exposes a cardinality the ledger cannot represent.
- **SuggestedFix**: Hand the destination model back to planning. Preserve every active/cleanup destination needed across startup and concurrent installations, keyed by a stable installation/config scope where necessary; load and reconcile old obligations before any initial install may replace them.
- **Status**: open
- **Triage**: pending author triage.
- **Status**: accepted
- **Triage**: accepted, both halves, and the second half returns the change to planning. Verified at `extension.ts:455-458`: `await agentHookController.start()` runs before `agentHookLedger.load()`, so an enabled agent installs and calls `recordInstalled` against an empty view, overwriting the singular `destination` before anything has read the record naming the file the previous session wrote. That half is an ordering fix. The cardinality half is not: D16 deliberately made one ledger serve the whole machine, and `AgentLedgerEntry.destination` is one string, so two installations with different `claudeConfigDir` values cannot both be represented. D16 traded a root-scoped ledger that lost history on relocation for a machine-scoped ledger that cannot express more than one live destination per agent. That is a design decision to reopen, not a bug to patch.
- **Invariant inventory**: Every configuration still modified or actively managed must retain a discoverable destination record. Boundaries searched: closed-window location edit, startup ordering, profile/installation concurrency, current destination, pending set, install finalization, uninstall inventory. Verified safe: one stable destination in one host after ledger load. Affected: startup drift and multiple legitimate destinations.

### B15

- **ID**: B15
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic` (corroborated by chair)
- **File:line**: `src/extension.ts:443-447`
- **Title**: Location-only configuration edits submit the transition without force
- **Evidence**: The listener detects `moved`, but passes `enabled` as `submit`'s force argument. On a `claudeConfigDir`-only event, `enabled` is false. If no previous durable destination exists — after uninstall, an earlier failed install, or an activation race — `transition()` finds no stale candidate, leaves `reconciled` false, and never calls the controller for the new location.
- **Impact**: Claude hooks can remain absent while the enabled setting is true, or remain installed at the wrong path, violating the explicit location-only forced-reconcile contract.
- **SuggestedFix**: Pass a force value that includes location changes, and cover uninstall-then-move, failed-install-then-move, and activation-race paths through the real extension listener seam.
- **Status**: open
- **Triage**: pending author triage.
- **Status**: accepted
- **Triage**: accepted. Verified at `extension.ts:443-446`: `force` is passed the enabled-setting boolean, so a `claudeConfigDir` move alone submits `force = false`. My round-7 B13 fix added the `moved` term to the filter and did not carry it into the argument — the event is now delivered and then declines to do anything. Implementation fix: `submit(entry, enabled || moved)`.

### B16

- **ID**: B16
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic` (expanded by chair)
- **File:line**: `src/agentHooks/install/agentHookTransitions.ts:93-105,118-158,161-166`; `src/extension.ts:446,450-458`
- **Title**: Fresh-ledger read failures escape typed outcomes and permanently wedge coalesced transitions
- **Evidence**: `ledger.refresh()` can reject when the ledger lock/read is unavailable. `converge()` has no `finally`, so a thrown transition leaves the agent in `coalesced` with an already-rejected `settled` promise; every future `submit()` returns that same rejection and never runs again. The settings listener and activation reconcile discard those promises. `uninstallEverything()` uses `Promise.all`, so one refresh rejection suppresses every per-agent result and the uninstall summary.
- **Impact**: One transient ledger-read failure can disable reconciliation for that agent until extension restart, produce unhandled rejections on activation/settings events, and make the uninstall command report nothing instead of typed per-agent failures.
- **SuggestedFix**: Contain refresh/read failures inside transition outcomes, clear coalesced state in `finally`, warn through the owned callback, and aggregate uninstall per agent with settled/typed results so one failure cannot suppress the others.
- **Status**: open
- **Triage**: pending author triage.
- **Status**: accepted
- **Triage**: accepted. Verified at `agentHookTransitions.ts:93-106`: `converge` deletes the coalesced state only on its normal return, so a rejected `ledger.refresh()` (now called first in both `transition` and `uninstallEverything`, round-7 B5) escapes with the entry still installed and its rejected promise cached — every later submit for that agent returns the same rejection, permanently. `reconcileAll` and `uninstallEverything` both `Promise.all`, so one agent's rejection also discards every other agent's result. Introduced by the B5 and B13 fixes together. Implementation fix: `finally` for the state, typed outcome for the failure, `allSettled` for the aggregation.
- **Invariant inventory**: Every async boundary must settle as a typed per-agent outcome and leave the queue reusable. Boundaries searched: activation, settings listener, coalesced rerun, ledger refresh failure, uninstall aggregation, later retry. Verified safe: installer operations contained by controller/LockedFile. Affected: transition and uninstall ledger reads.

### B17

- **ID**: B17
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-performance` and `asm-review-data-security` (corroborated by chair)
- **File:line**: `src/agentHooks/install/managedEntryLedger.ts:128-139,307-315`
- **Title**: Command eviction can make a still-pending configuration permanently unrecognizable
- **Evidence**: Ownership retains only the newest eight commands, independently of the up-to-sixteen pending destinations. A pending config may still contain a command that ages out after later wrapper-root changes. Its retry then fails exact ownership, returns `not-installed`, and the transition clears the pending destination, deleting the final recovery pointer.
- **Impact**: The extension silently abandons a config it modified. Old hook entries can accumulate and fire alongside current entries, while uninstall reports no managed entry at the path it was explicitly tracking.
- **SuggestedFix**: Associate command ownership with each destination or retain every command transitively required by active/pending destinations. Evict only after all configurations that may contain that exact command are proven clean.
- **Status**: open
- **Triage**: pending author triage.
- **Status**: accepted
- **Triage**: accepted, and this is the most damaging of the seven. Verified at `managedEntryLedger.ts:130`: `remember` keeps `.slice(-MAX_REMEMBERED_COMMANDS)` = 8 commands, while `MAX_PENDING_DESTINATIONS` = 16. `isOwned` is `recorded.includes(command)`, so once an older pending destination's command falls off the tail, its entries stop being ours: `clean` returns `not-installed`, `uninstallEverything` treats that as cleared and calls `clearPending`, and the extension drops the pointer to a file it modified that still fires hooks. The two ceilings were chosen independently and are not independent. Commands must be retained per destination, not globally — which is a design question, not a constant to raise.
- **Invariant inventory**: Bounding ownership history must never invalidate a live cleanup obligation. Boundaries searched: command append/eviction, active destination, pending destination, exact ownership sweep, not-installed handling, pending clear. Verified safe: at most eight distinct commands with no older active/pending config. Affected: older command still present at a tracked destination.

### B18

- **ID**: B18
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-reuse`
- **File:line**: `src/agentHooks/install/ManagedConfigInstaller.ts:204-212`
- **Title**: Wrapper replacement bypasses the shared-file lock discipline
- **Evidence**: Config and ledger writes enter `LockedFile.withLock()` before atomic replacement, but `createWrapper()` calls `atomicReplace()` directly and asserts that nothing else writes the path. Multiple extension hosts sharing `globalStorageUri` do write the same wrapper. The temporary name is only path plus millisecond timestamp, so same-millisecond installs can collide; during overlapping versions, replacements can also race on which script bytes remain.
- **Impact**: Cross-host activation can spuriously fail wrapper creation or leave a wrapper chosen by an uncontrolled race, despite the stated lock-plus-atomic-rename invariant for every shared file.
- **SuggestedFix**: Run wrapper replacement through the same `withLock` plus `atomicReplace` primitive. Keep one authority rather than adding a wrapper-specific lock implementation.
- **Status**: open
- **Triage**: pending author triage.
- **Status**: accepted
- **Triage**: accepted. Verified: `createWrapper` calls `LockedFile.atomicReplace` directly while config and ledger replacement go through `withLock`. The temporary name is `.<base>.<now()>.tmp`, so two hosts activating in the same millisecond collide and one rename fails an install for no reason. Implementation fix — the authority already exists, this path just does not take it.

## Carried findings adjudicated fixed

- **B5 — fixed**: transition/uninstall inventories call `ledger.refresh()` per operation; config sweep refreshes ownership inside the config lock. The remaining post-refresh concurrency is a later concurrent operation, not the stale process snapshot B5 identified.
- **B6 — fixed**: `recordCommand()` returns durability and install aborts before the user config write when it is false.
- **B9 — fixed**: production now roots the ledger at `~/.anywhere-terminal/agent-hooks-ledger.json`, independent of `globalStorageUri`; old commands remain reachable after wrapper-root moves once recorded there.
- **B11 — fixed**: the Cursor Windows wrapper invokes the absolute `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` path.
- **B13 — fixed at its original invariant**: unrelated settings are filtered and same-agent submissions coalesce to one running transition plus one rerun, so work no longer grows with raw configuration-event history. B15/B16 are distinct correctness failures in the new gate.
- **W6 — fixed**: serialized desired bytes are compared with source contents and identical user configs skip replacement.

## Specialist adjudication notes

- The contracts claim that uninstall must lock an absent file was rejected: task 2_2 explicitly accepts a missing-config no-lock answer, and a concurrent later install can linearize after that answer.
- The contracts claim that uninstall must mutate controller desired state was rejected: D9 explicitly defines a direct removal command independent of settings/controller reconciliation. B15 covers the concrete later-reconcile failure instead.
- Two specialists proposed blocking on session-only post-write destination fallback. That was not re-reported: D15 explicitly accepts session-only fallback after bytes are already written. The startup overwrite in B14 is a separate, non-waived loss under normal durable operation.
- A stale-lock lease redesign was not promoted: it re-litigates the reused shipped lock mechanism without a demonstrated changed-path failure. The concrete new wrapper bypass is B18.
