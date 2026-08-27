# Review Round 5: install-claude-hooks

**Date**: 2026-08-27
**Cycle**: 2
**Mode**: verification
**Scope**: range `3934d32..f145111abf36769a15978647b9135e072325896e`
**Head**: `f145111abf36769a15978647b9135e072325896e`
**Tree state**: clean at review start; explicit commit range unaffected by later analytics updates
**Reviewable lines**: 336
**Agents spawned**: data-security — B5/B6 ledger durability cone — `opus[1M]`; logic — B8/W4/S4 uninstall, probe, and queue cone — `gpt-5.6-terra[1M]`; performance — B7 pending-growth cone — `sonnet[1M]`
**Agents skipped**: frontend — no UI/rendering cone; contracts — no new contract surface beyond prior accepted results; reuse — S4 extraction was directly verified in the logic cone and unchanged worktree queue tests
**Verdict**: **BLOCK**
**Open counts**: 2 BLOCK, 1 WARN, 0 SUGGEST; 1 audit-backlog suggestion

## Scope lock and verification evidence

- Scope lock passed: `f145111` contains remediation for round-4 findings plus task/review/analytics metadata. The keyed-queue extraction is the accepted S4 fix and its worktree mutation-queue impact cone; no unrelated capability or semantically changed design/task was introduced.
- `bun run asm change verify-status install-claude-hooks` reports remediation tasks 5_1, 5_2, and 5_3 plus all predecessor tasks at `[x]`, exit 0. The caller additionally recorded type check clean, the full unit suite passing, and Biome check exit 0 with only 13 pre-existing warnings. No project verify command was run during review.
- Modified fixes were adjudicated on behavior rather than rationale. Per-agent keys and the in-process write tail close part of B5, but the stated config-lock coverage does not close cross-host same-agent writes. The B7 resource bound works, but refusing to retain the seventeenth failure reopens B8's cleanup/reporting invariant.

## Cross-round disposition

| ID | Severity | Round-5 status | Evidence delta |
|---|---|---|---|
| B5 | BLOCK | persists, narrowed | Cross-agent and same-host overlap are fixed; same-agent writes from two extension hosts still perform stale whole-entry replacement, and pending mutations are outside the config lock |
| B6 | BLOCK | fixed | `recordCommand` succeeds before config mutation or aborts it; every committed command is reclaimable. A narrower destination-finalization failure is W5 |
| B7 | BLOCK | fixed for its growth invariant | Pending state and scan work are structurally capped at 16; the ceiling's cleanup-authority defect is folded into B8 rather than double-reported |
| B8 | BLOCK | persists with new affected boundary | Immediate mixed outcomes now report truthfully, but a cleanup refused by the pending ceiling is forgotten after the recorded/current path advances, so a later uninstall can again claim nothing remains |
| W4 | WARN | fixed | Taskkill startup failure returns `leaderOnlyTermination: true`; the installer still treats it as probe failure through unchanged exitCode/stdout semantics |
| S4 | SUGGEST | fixed | One settlement-safe keyed queue now serves transitions and worktree mutations; ordering, rejection, synchronous-throw release, cross-key concurrency, tail cleanup, and isBusy timing are covered |

## Open findings

### B5

- **ID**: B5
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-data-security` (corroborated by chair)
- **File:line**: `src/agentHooks/install/managedEntryLedger.ts:141`
- **Title**: Same-agent ledger writes from two extension hosts still clobber durable state
- **Evidence**: One key per agent prevents Cursor from overwriting Claude, and `writes` serializes one ledger instance. It does not serialize two VS Code extension hosts: each host retains its own Memento snapshot and `mutate()` still rewrites the complete `{destination, commands, pending}` entry from `change(this.entry(agent))`. The config-file lock does not repair this. It sequences time but does not refresh the second host's Memento cache, and `recordPending()`/`clearPending()` run after `clean()` has released the config lock. Different stale-destination files also use different config locks. A current-destination install in one window can therefore overwrite a pending cleanup another window just recorded for the same agent.
- **Impact**: Routine multi-window use can erase a failed-cleanup destination or command history. The erased config remains modified but is no longer retried or provably owned after restart, preserving the original D12/D13 stranding impact.
- **SuggestedFix**: Give the per-agent ledger its own cross-process serialization and fresh read. Prefer a lock-protected durable file under global storage, read and written while holding a stable per-agent ledger lock; move pending mutations under that authority too. A per-instance promise tail or destination-specific config lock cannot provide cross-host read freshness.
- **Status**: accepted
- **Triage**: accepted, overruling my round-4 deferral. I checked the premise rather than the argument: VS Code's `globalState` is a per-window cache written back on update, not a store synchronized between hosts, so two windows genuinely do hold independent same-agent snapshots and the later write wins. The config lock does not help — it guards a different file, and `recordPending`/`clearPending` run outside it anyway. My round-4 reasoning was that this is the conflict a lock would have to arbitrate; that was true and beside the point, because the loss here is of the record that says cleanup is still owed. Fix takes the suggestion: the ledger moves out of `globalState` to a lock-protected file under global storage, read fresh under the lock, using the same lock discipline the config write already has. This changes where D12 says the ledger lives, so it goes back through planning as D15 rather than being decided here.
- **Invariant inventory**: Durable ownership and cleanup facts must never be lost by another writer. Boundaries verified safe: different agents, overlapping mutations in one ledger instance, failed writes chained to later attempts. Boundaries still affected: same agent across extension hosts, pending record/clear after config-lock release, and config moves whose old/new files use different locks.

### B8

- **ID**: B8
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic` (corroborated by chair; B7 performance half independently verified fixed)
- **File:line**: `src/agentHooks/install/agentHookTransitions.ts:149`
- **Title**: The pending ceiling can permanently forget a failed cleanup destination
- **Evidence**: At 16 tracked failures, `recordPending()` returns false and `trackPending()` only logs a warning. Consider an agent with recorded destination A plus 16 pending destinations, then a move to B: cleanup of A fails, the ceiling refuses to retain A, `moved` still forces reconciliation, and successful installation at B makes `recordInstalled()` replace `destination: A` with B. A is now neither current, recorded, nor pending. The immediate operation says it was left behind, but after a restart or another settings move `uninstallEverything()` cannot inventory A and can report nothing to remove.
- **Impact**: The cap fixes unbounded work by recreating the permanent orphaning and false future-cleanliness claim D13 and B8 exist to prevent. A console warning is not durable cleanup authority and does not let the uninstall command find the file later.
- **SuggestedFix**: Do not advance/install at a new destination when the old failed destination cannot be durably retained. Keep the recorded destination until a pending slot is available, or require an explicit user decision that names the path before abandoning it. Any overflow representation must itself remain structurally bounded without dropping an earlier unresolved path.
- **Status**: accepted
- **Triage**: accepted, and it overturns my round-4 modification. I argued a ceiling that blocks installation is worse than one that refuses to track; this shows the version I chose loses a config file we modified — the ceiling refuses A, the transition continues, and `recordInstalled(B)` overwrites the last record naming A. Silently forgetting a file we wrote to is strictly worse than freezing at the current location, so the trade I made was the wrong way round. Fix as suggested: a stale destination that can neither be cleaned nor tracked stops the move — the agent stays where it is, the record still names it, and the user is told which path is holding the queue.
- **Invariant inventory**: Uninstall may report completion only when every destination the extension modified remains discoverable until verified clean. Boundaries verified safe: ordinary mixed success/failure, all-success, all-not-installed, and failures already present in the capped pending set. Boundaries still affected: a new failed recorded/current destination when all 16 pending slots are occupied, subsequent destination advancement, restart, and later uninstall inventory.

### W5

- **ID**: W5
- **Severity**: WARN
- **Confidence**: MEDIUM
- **Priority**: P3
- **Agent**: `asm-review-data-security`
- **File:line**: `src/agentHooks/install/ManagedConfigInstaller.ts:123`
- **Title**: Failed destination finalization can leave a written config untracked
- **Evidence**: B6's command half is fixed: `recordCommand()` runs before reconcile. If the later `recordInstalled(configPath, command)` update rejects, however, the atomic config replacement has already committed and `withLock()` returns `write-failed`. The ledger owns the command but retains its previous destination, and no pending record is created for the path just modified.
- **Impact**: While settings continue to name the path it remains reachable. If `claudeConfigDir` changes before the next successful finalization, the extension can lose the location of a config it wrote even though it still recognizes the command bytes.
- **SuggestedFix**: On destination-finalization failure, preserve `configPath` as pending before returning `write-failed`, with an in-memory authoritative fallback if the persistence failure prevents that second update too.
- **Status**: accepted
- **Triage**: accepted. Confirmed the window: `atomicReplace` lands, then `recordInstalled` persists the destination; a failure between them leaves the ledger naming the previous destination while the new file is already modified. The command is safe since round-4 B6, but the location is not. Fixed by recording the written path as pending when finalization fails, and by keeping the last written destination in memory for the rest of the session so this host can still reconcile it even if nothing persisted.

## Fixed findings

### B6

- **Status**: fixed
- **Evidence**: `recordCommand()` is awaited before reconcile. A rejected command write aborts before config mutation; a later config failure leaves an exact extension-generated command claim but no config bytes to remove. Successful config replacement cannot leave its command unowned, including after a storage-root move.

### B7

- **Status**: fixed for the original performance/growth finding
- **Evidence**: `MAX_PENDING_DESTINATIONS = 16` is enforced before insertion, canonical spellings deduplicate, and each transition processes at most current/recorded plus 16 pending paths per agent. The ceiling's correctness consequence is B8 above.

### W4

- **Status**: fixed
- **Evidence**: A taskkill startup error marks the result `leaderOnlyTermination: true` before the leader fallback is issued, and the regression test drives that path. Normal process-tree termination leaves the field absent.

### S4

- **Status**: fixed
- **Evidence**: `createKeyedSerialQueue` carries settlement-safe chaining, uncalled-body handling, current-tail cleanup, and per-key concurrency. `createMutationQueue` retains enqueue-time depth and settlement-time release through hooks; its unchanged suite covers ordering, rejection, synchronous throws, cross-repo concurrency, and `isBusy`.

## Audit backlog

### A1

- **ID**: A1
- **Severity**: SUGGEST
- **Confidence**: MEDIUM
- **Priority**: P5
- **Agent**: `asm-review-data-security`
- **File:line**: `src/agentHooks/install/agentHookTransitions.ts:120`
- **Title**: Canonical ledger paths are compared with a raw adapter path
- **Evidence**: Ledger destinations are `resolve()`d, while `transition()` compares them to `adapter.configPath()` without canonicalizing the latter. Current production adapters return normalized paths, so no current behavior fails; a future non-normalizing adapter could clean the destination it is about to install into.
- **Impact**: No reachable production impact in this round; retained for a later contract-hardening pass.
- **SuggestedFix**: Canonicalize the current destination at the transition boundary or make canonical absolute paths an enforced adapter contract.
- **Status**: audit-backlog
- **Triage**: non-gating, outside the accepted B5/B6 impact cone and not an emergency
