# Review Round 4: install-claude-hooks

**Date**: 2026-08-27
**Cycle**: 2
**Mode**: discovery
**Scope**: range `b405735..3934d323b9fd3aa0f01a73256946fbc65582a80f`
**Head**: `3934d323b9fd3aa0f01a73256946fbc65582a80f`
**Tree state**: clean at review time; explicit range excludes merge commit `b405735`
**Reviewable lines**: 894 — large change; accuracy may decrease
**Agents spawned**: logic — transition lifecycle — `gpt-5.6-sol[1M]`; data-security — ledger/config durability — `gpt-5.6-terra[1M]`; logic — probe lifecycle — `sonnet[1M]`; contracts — D12–D14 wiring — `gpt-5.6-terra[1M]`; performance — ledger growth axes — `gpt-5.6-luna[1M]`; reuse — redesign cohesion — `gpt-5.6-luna[1M]`
**Agents skipped**: frontend — no UI/rendering changes
**Verdict**: **REJECT**
**Counts**: 4 BLOCK, 1 WARN, 1 SUGGEST

## Gate and context

- Gate 2 is approved in `workflow.md`; D12–D14, tasks 4_1/4_2/4_3 Acceptance/Refs, and the agent-hook installation delta were treated as obligations. D12's refusal to claim differently quoted equivalent commands was treated as deliberate, not a defect.
- This is cycle 2 discovery after cycle 1's round-3 thrash stop, not a verification round. No cycle-1 finding was carried as open; the findings below arise from the redesign's mechanisms.
- `bun run asm change verify-status install-claude-hooks` reports every task through 4_3 at `[x]`, exit 0. The caller additionally recorded type check clean, 4488 unit tests passing, and Biome check exit 0 with only 13 pre-existing warnings. No project verify command was run during review.

## Risk map and full-flow trace

- Highest risk: ledger authority over deletion of user-owned config, especially persistence ordering, concurrent agents/windows, and recovery after failed writes.
- High risk: the D13 lifecycle from configuration event or activation through stale cleanup, pending persistence, controller disable/enable reconciliation, runtime authority, and uninstall reporting.
- Medium risk: Windows probe spawn/termination failure paths and the new persisted collection's growth axis.
- Full flow traced: activation/settings event/uninstall command → per-agent transition queue → current/recorded/pending destination inventory → pinned installer → symlink refusal → cross-process config lock → classified read → exact-command sweep → atomic replace → ledger update → controller reconciliation/runtime authority → warning or user-facing summary. Cursor and Claude use the same flow; Windows additionally writes and probes the wrapper through `cmd.exe`, then terminates through `taskkill.exe` on deadline.

## Findings

### B5

- **ID**: B5
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic`, `asm-review-data-security`, and `asm-review-contracts` (corroborated by chair)
- **File:line**: `src/agentHooks/install/managedEntryLedger.ts:113`
- **Title**: Concurrent ledger mutations overwrite another agent's ownership record
- **Evidence**: `mutate()` performs a load-modify-update of the entire value under one Memento key: it reads `this.state()`, overlays one agent, then awaits asynchronous `store.update()`. Production starts agent reconciliations concurrently, and `AgentHookTransitions.reconcileAll()` and `uninstallEverything()` both use `Promise.all` across agents. The repository's recorded Memento contract states that a second `get()` can observe stale state until the first asynchronous update completes; the test store instead changes its map synchronously before returning. Two overlapping writes can therefore both derive from the same old root, and the later replacement drops the other agent's `destination`, `commands`, and `pending`. Separate extension hosts/windows add the same stale-snapshot problem beyond any in-process queue.
- **Impact**: D12 ownership history and D13 retry destinations can disappear after successful config mutation. A later location/storage move or restart can no longer find or prove ownership of the overwritten agent's entries, permanently stranding hooks in user configuration.
- **SuggestedFix**: Make the durable ledger mutation atomic across every writer, not merely per-agent transition work. Use a lock-protected durable ledger or another representation that cannot replace unrelated records from a stale snapshot; an in-process ledger-wide write tail is necessary for same-host calls but is not sufficient for two extension hosts. Add deferred-visibility and cross-writer tests that prove Cursor and Claude records both survive.
- **Status**: accepted
- **Triage**: Confirmed by reading the code, not the report: `mutate()` reads one shared root synchronously and awaits the write, so cursor and claude — started together by `reconcileAll` and `uninstallEverything` — can both derive from the same snapshot. Accepted with the representation half of the suggested fix rather than a second lock: one Memento key per agent removes the shared root entirely, so unrelated records are structurally unreachable from a stale snapshot, and a ledger-wide in-process write tail closes same-agent overlap. Two hosts writing the SAME agent still race; that is the case a lock would address, and it is the same conflict a lock would have to arbitrate anyway, so it is left to the config-file lock that already guards the write it describes.
- **Invariant inventory**: Durable ownership and cleanup facts must never be lost by an unrelated writer. Boundaries searched: controller activation concurrency, transition `reconcileAll`, uninstall-all, per-agent queues, Memento persistence, config-file locks, and multi-window ownership. Affected: the shared ledger root update. Verified safe: one agent's transition body is serialized in one host, and each individual config file mutation remains protected by its cross-process lock.

### B6

- **ID**: B6
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-data-security` and `asm-review-logic` (corroborated by chair)
- **File:line**: `src/agentHooks/install/ManagedConfigInstaller.ts:121`
- **Title**: Ledger failure after atomic replacement leaves an unrecorded installation
- **Evidence**: Installation first atomically writes the command into the user's config, then calls `recordInstalled()`. If `globalState.update()` rejects, `withLock()` returns generic `write-failed`, but the config change is already committed and no durable intent or compensation records it. This is irrecoverable on the supported storage-root-move path when the ledger already contains older commands: the seed is disabled once any command is recorded, so the newly written command is not owned on the next uninstall/reconcile. Removal has the mirror split at `recordRemoved()` after bytes were already deleted.
- **Impact**: Controller authority can report failure while a hook is installed, later retries can append a duplicate command, and uninstall can leave the new command behind because the only ownership fact failed to persist. This violates exact-ledger ownership and the moved-script convergence contract on a persistence error path.
- **SuggestedFix**: Use a recoverable operation protocol. Persist an install/remove intent containing destination and exact command before config mutation, finalize it after atomic replacement, and reconcile unfinished intents at activation by inspecting exact bytes; or roll back while the config lock is held and persist a cleanup intent if rollback fails. A generic `write-failed` after a partial commit is insufficient.
- **Status**: accepted
- **Triage**: Confirmed: `atomicReplace` mutates the user's file, and only then does `recordInstalled` run inside the same try, so a persistence failure returns `write-failed` over a config that really did change. The consequence the report names is the real one — after a storage-root move the ledger is non-empty, so the seed no longer covers the unrecorded command. Fixed by recording the command BEFORE the replacement and the destination after: a command we own but never wrote costs nothing (there is nothing to remove), while a command we wrote but never recorded is unreachable.
- **Invariant inventory**: A config mutation and the durable fact authorizing its later cleanup must commit together or leave recoverable intent. Boundaries searched: install, uninstall, atomic replace, ledger finalization, lock error conversion, restart, config-destination move, storage-root move, and retry. Affected: ledger finalization after both install and removal. Verified safe: config replacement itself is atomic and occurs under the correct config lock.

### B7

- **ID**: B7
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-performance`
- **File:line**: `src/agentHooks/install/managedEntryLedger.ts:90`
- **Title**: Failed destinations create an unbounded persistent retry scan
- **Evidence**: `recordPending()` appends every distinct failed destination with no structural cap. Every later transition, activation reconciliation, and uninstall inventories the full list and attempts cleanup sequentially. The growth axis is one entry per distinct destination move whose cleanup fails; unlike `commands` (capped at eight), registered agents (currently two), and managed events (eight), nothing bounds this axis.
- **Impact**: Repeated failures make globalState grow monotonically and turn every ordinary activation or setting event into O(history) filesystem/config operations. The design cannot simply truncate the list without recreating the orphaning D13 was introduced to prevent.
- **SuggestedFix**: Bound both state and work without discarding ownership: canonicalize/coalesce equivalent destinations, process retries with bounded batches/backoff, and refuse installing into further destinations once a hard tracked-failure ceiling is reached until cleanup succeeds or the user explicitly resolves it. Add a scale test over the chosen bound.
- **Status**: accepted
- **Triage**: Confirmed: `recordPending` appends without a cap, and every transition walks the list. Accepted as a growth axis; the suggested remedy is modified. Canonicalizing destinations and bounding the list are taken. Blocking further installation once the ceiling is reached is not: it makes a cleanup failure at some abandoned path disable the feature the user is currently asking for, which is a worse outcome than the one it prevents. The bound instead refuses to TRACK beyond the ceiling and says so, keeping every already-tracked destination — dropping the oldest is the orphaning D13 exists to prevent.
- **Invariant inventory**: Every persisted collection and per-event scan must have a structural bound while retaining required cleanup authority. Boundaries searched: pending insertion/dedup, successful clearing, activation, normal transition, uninstall-all, command history, agent registry, and managed event set. Affected: pending destinations and every scan consuming them. Verified safe: command history, agent count in the registry, and managed event count are bounded.

### B8

- **ID**: B8
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `chair`
- **File:line**: `src/agentHooks/install/agentHookTransitions.ts:82`
- **Title**: Partial uninstall is reported as complete removal
- **Evidence**: `uninstallEverything()` ORs `removed` across destinations while retaining only one `reason`. If any destination succeeds and another fails, the result is `{ removed: true, reason: <failure> }`. `summarizeUninstall()` checks `removed` first and prints `<agent>: removed`, hiding the failed destination. Multiple destinations are the normal D13 state when an active destination and pending cleanups coexist; tests cover one agent failing wholly, not a mixed result within one agent.
- **Impact**: The user-facing uninstall command can say an agent was removed while managed entries remain in a user config. This directly violates the command's hard requirement to clear every managed entry or report why it could not.
- **SuggestedFix**: Track per-destination outcomes and define agent success as all destinations clean (`removed` or verified `not-installed`). Preserve every failed destination in pending state, and summarize partial failure with the exact destinations/reasons instead of treating any success as total success.
- **Status**: accepted
- **Triage**: Confirmed by reading `uninstallEverything`: `removed = removed || outcome.removed` collapses a mixed result into success, and `summarizeUninstall` then prints `removed`. Telling a user their configuration is clean when it is not is the failure mode this whole change exists to avoid. Fixed exactly as suggested — success is every destination clean, failures stay pending, and the summary names what was left.
- **Invariant inventory**: Uninstall success may be reported only after every current, recorded, and pending destination is verified clean. Boundaries searched: destination dedup, mixed success/failure ordering, pending retention, aggregate result, and user summary. Affected: mixed per-agent outcomes. Verified safe: single-destination, all-success, and all-failure outcomes report consistently.

### W4

- **ID**: W4
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P3
- **Agent**: `asm-review-logic`
- **File:line**: `src/agentHooks/install/probeRunner.ts:118`
- **Title**: Windows taskkill startup failure falls back to leader-only termination
- **Evidence**: The primary path uses absolute `taskkill.exe /T /F`, but its asynchronous `error` handler calls only `child.kill("SIGKILL")`. On Windows that targets the `cmd.exe` leader, not descendants such as the wrapper's `curl`. The test verifies the absolute taskkill path but never emits a taskkill startup error or proves descendant cleanup on the fallback.
- **Impact**: A taskkill lookup/policy/quota failure can leave a descendant running after the runner reports its bounded failure, narrowing the D14 process-tree guarantee on the exact failure path the fallback exists for.
- **SuggestedFix**: Exercise the taskkill error path and either provide a Windows tree-capable fallback or explicitly surface that termination was not reaped rather than representing the fallback as equivalent process-tree cleanup.
- **Status**: accepted
- **Triage**: Confirmed: the Windows branch's error handler calls `child.kill("SIGKILL")`, which reaches `cmd.exe` and not the `curl` it spawned. Accepted despite being non-blocking, because the coverage gap is the part that would let it regress silently. Windows offers no better tree-capable fallback without taskkill, so the fix is honest reporting plus a test that exercises the fallback path.

### S4

- **ID**: S4
- **Severity**: SUGGEST
- **Confidence**: MEDIUM
- **Priority**: P4
- **Agent**: `asm-review-reuse`
- **File:line**: `src/agentHooks/install/agentHookTransitions.ts:49`
- **Title**: The transition owner duplicates the repository's keyed serial queue
- **Evidence**: `AgentHookTransitions` adds its own `Map<key, Promise>` tail chain. `src/worktree/mutationQueue.ts:16-53` already implements keyed settlement-safe serialization, including tail cleanup and synchronous-throw handling. The current transition implementation is behaviorally adequate, so this is a reuse/cohesion finding rather than a correctness warning.
- **Impact**: Queue settlement and cleanup fixes can drift between two local implementations.
- **SuggestedFix**: Extract the generic keyed promise-tail primitive to a neutral utility and let both the worktree queue and agent transitions use it; keep worktree-specific depth/`isBusy` behavior at the worktree layer.
- **Status**: accepted
- **Triage**: Verified `src/worktree/mutationQueue.ts` independently: it is a keyed serial queue with settlement-safe chaining, an uncalled-body contract for synchronous throws, and tail cleanup my promise-tail lacks — my version leaks a map entry per key for the host's lifetime. Reuse-first applies. Taken as suggested: the neutral primitive is extracted, and worktree keeps its depth/`isBusy` behaviour on top of it.
