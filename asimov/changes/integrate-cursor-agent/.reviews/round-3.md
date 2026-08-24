# Review Round 3

- Date: 2026-08-24
- Scope: changes since round 2 plus prior accepted findings
- Reviewable lines: 232
- Final authorized review round: yes
- Agents spawned: asm-review-logic, asm-review-performance, asm-review-data-security, asm-review-contracts, asm-review-reuse
- Agents skipped: asm-review-frontend (no round-3 frontend behavior changed)
- Verdict: REJECT
- Counts: BLOCK 3 | WARN 4 | SUGGEST 2

## Current Findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-logic, asm-review-contracts, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/VaultService.ts:405
- title: A cold hinted refresh publishes and persists a target-only Vault list
- evidence: `refresh({ hint })` starts a hinted run whenever no refresh is active, without requiring a complete baseline. `startRefresh` loads `this.mem` and calls `readAll(this.mem, hint)` even when the cache load returned null. `readAll` then invokes only the hinted agent and seeds every untouched segment from the null previous document, producing an empty complement. Watchers attach when the webview resolves, before the first complete Vault request, and all added hinted tests seed a complete refresh first. A direct probe returned and persisted only `cursor:chat` while the Claude reader was never called.
- impact: On a first install, missing/corrupt/version-invalid cache, or no cache store, one Cursor event makes the normal full-list response and persisted cache omit Claude, Codex, and OpenCode until a later complete refresh. Round-2 B1 therefore persists on the cold-cache boundary.
- suggestedFix: After loading memory, promote a hinted request to a complete refresh whenever no complete cached document exists, and derive `inflightRefreshKind` from that effective hint. Add a first-ever hinted-refresh regression asserting every reader and segment is present.
- status: accepted
- triage: Persists from round 2 — warm targeted dispatch is fixed, cold targeted dispatch violates the full-list contract.

### B5

- ID: B5
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-performance, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/VaultService.ts:435
- title: Coalesced follow-up hint paths have no structural cap
- evidence: Each coordinator-emitted hint is capped at 128 paths, but `queueHint` continuously adds paths from every later same-agent hint into `pendingHint.paths` while a reader is active. No service-level cap promotes an oversized pending set to a complete refresh. The growth axis is distinct paths arriving during one slow read and is unbounded.
- impact: Sustained writes can build an arbitrarily large follow-up and then trigger a delayed I/O burst, defeating the round-2 W7/W5 bounding fix and multiplying the per-path bucket probes.
- suggestedFix: Apply a structural cap to `pendingHint.paths`; when exceeded, discard the path set and queue exactly one complete refresh.
- status: accepted
- triage: Persists from round 2 W7 — coalescing exists, but the accumulated follow-up is not bounded.

### B6

- ID: B6
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-performance, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorPaths.ts:187
- title: Every targeted Cursor update still scans all workspace buckets
- evidence: Even one valid changed path calls `listDirNames(root)`, materializes every Cursor workspace bucket, and stats the affected chat id beneath every bucket. With A affected ids and B historical buckets, the targeted path performs up to A × B probes. A is capped only before service-level coalescing and B has no structural cap.
- impact: Round-2 W5 persists at the workspace-bucket growth axis; ordinary events become progressively more expensive as the user's Cursor workspace history grows despite avoiding all-chat enumeration.
- suggestedFix: Carry the validated bucket from the watcher path and resolve that location directly. Maintain a bounded duplicate-location index from complete scans so ambiguity checks do not require probing every bucket per event.
- status: accepted
- triage: Persists from round 2 W5 — all-chat enumeration is removed, but uncapped full-bucket traversal remains on every event.

### W9

- ID: W9
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-contracts, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/VaultCacheStore.ts:109
- title: Cursor cache validation accepts a non-boolean canResume capability
- evidence: The new `cursor-files` branch delegates entry validation to `isValidCachedEntry`, which does not validate optional `canResume`. A persisted Cursor entry with `canResume: "false"` passes validation, while UI consumers disable Resume only for literal boolean `false`.
- impact: A malformed cache can transiently expose unsupported Resume/copy actions and produce a host-side launch rejection. The host re-resolves the entry before process launch, so this does not bypass the final launch gate, but it violates the strict cache/UI capability contract.
- suggestedFix: Require `canResume` to be undefined or boolean and add a malformed Cursor-cache fixture with a non-boolean value.
- status: accepted
- triage: Accepted — strict persisted capability validation must require `canResume` to be absent or boolean; add the malformed-cache case in the next authorized fix pass.

### W10

- ID: W10
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-performance
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/VaultWatchCoordinator.ts:260
- title: Two attached Vault clients make one event execute two refreshes
- evidence: Every `attach()` creates an independent `StoreWatchLifecycle` subscription. Sidebar and panel callbacks receive the same shared watcher event; the first starts a hinted run and the second queues a same-path follow-up because active paths are not deduplicated against pending paths.
- impact: The normal two-client topology performs duplicate reader work, cache writes, and full-list materialization for one unchanged event, and feeds B5 under sustained activity.
- suggestedFix: Centralize store refresh scheduling in the shared coordinator and fan one result out to clients, or track active hint paths and suppress exact duplicate client deliveries without suppressing genuinely later changes.
- status: accepted
- triage: Accepted — duplicate store lifecycles in the normal sidebar-plus-panel topology cause redundant refresh work; central scheduling or exact active-path suppression is required.

### W11

- ID: W11
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-logic
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/VaultService.ts:407
- title: A hint arriving during a complete refresh can be silently lost
- evidence: When `inflightRefreshKind` is complete, `refresh({ hint })` returns the active promise without recording the path. `ensurePendingRefresh` similarly clears queued hints if it observes a complete run. Readers begin concurrently, so the relevant reader may already have snapshotted stale state when the event arrives. A probe where Cursor completed before a blocked Claude reader showed both complete and hinted callers returning `cursor:old`, with no hinted reader invocation.
- impact: A chat created or updated during a panel-open/force refresh can remain missing until another unrelated event or reopen.
- suggestedFix: Record hints arriving during complete work and run one coalesced follow-up after it settles; do not discard pending paths merely because the active run is complete unless ordering proves it observed the event.
- status: accepted
- triage: Accepted — a hint emitted after the complete reader snapshot must be retained for a follow-up rather than assumed covered by the active scan.

### W12

- ID: W12
- severity: WARN
- confidence: MEDIUM
- priority: P3
- agent: asm-review-logic
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/VaultService.ts:375
- title: Force refresh can be starved by a sustained hint stream
- evidence: Force repeatedly awaits whichever active/pending run exists but establishes no barrier preventing new hints from starting another run in the gap. A probe that enqueued a new hint from each read postponed the force read through twelve consecutive hinted runs and completed only after the synthetic stream stopped.
- impact: User-triggered force refresh has unbounded latency while an active Cursor process continues producing watcher events.
- suggestedFix: Establish a force barrier before draining; route later ordinary/hinted requests behind the force run and clear the barrier when the forced complete read settles.
- status: accepted
- triage: Accepted — force needs an explicit scheduling barrier so later hints cannot repeatedly win the gap while it drains active work.

### S5

- ID: S5
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: asm-review-reuse
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/utils/posixShellQuote.ts:12
- title: LaunchBuilder still owns a duplicate POSIX quote implementation
- evidence: The new canonical helper now serves Cursor hooks and shell integration, but `src/vault/LaunchBuilder.ts:90-98` independently implements the same apostrophe escape for complex copied-command arguments.
- impact: Future quoting fixes can diverge between copied Vault commands and the newly shared hook/shell behavior.
- suggestedFix: Keep LaunchBuilder's readable simple-token fast path but delegate its complex-token fallback to `posixShellQuote`.
- status: accepted
- triage: Accepted as a small reuse cleanup — preserve LaunchBuilder's simple-token fast path and delegate only complex quoting to the canonical helper.

### S6

- ID: S6
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: asm-review-logic
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/VaultWatchCoordinator.ts:97
- title: Trailing debounce has no maximum-wait ceiling
- evidence: Every event clears and re-arms the 300 ms timer. Reaching the 128-path cap changes the next refresh to complete but does not flush the batch, so a stream with gaps below 300 ms can postpone refresh indefinitely.
- impact: A continuously writing Cursor session can prevent the Vault list from updating while the stream continues.
- suggestedFix: Track the first event time and impose a maximum wait, flushing the current targeted/full batch after a bounded interval even if events continue.
- status: accepted
- triage: Accepted — retain trailing debounce but impose a maximum wait so continuous events cannot starve list refresh indefinitely.

## Cross-round Disposition

- B1: fixed for warm-cache targeted dispatch; persists for cold hinted refreshes.
- B2, B3: fixed.
- B4: fixed — valid Cursor caches now survive strict save/load validation.
- W1, W2: fixed.
- W3: fixed — unsafe/malformed hints trigger an exact complete recount.
- W4: fixed — proven shared POSIX quoting is used by installer and shell injector.
- W5: partially fixed — path batches cap at the coordinator, but bucket traversal remains B6 and debounce starvation remains S6.
- W6: fixed within accepted scope — redundant reader sort removed; final full-list materialization remains.
- W7: partially fixed — one follow-up coalesces hints, but its path set remains unbounded as B5.
- W8: fixed for complete-after-hinted ordering; W11 is the inverse hinted-after-complete race.
- S1, S2, S3: remain rejected and are not re-reported.
- S4: fixed.

## Verification

- `pnpm run test:unit`: passed, 150 files / 2672 tests.
- Focused round-3 Vitest suites: passed, 6 files / 167 tests.
- Bun Cursor installer suite: passed, 23 tests / 86 expectations.
- `pnpm run check-types`: exited 2 with only the documented pre-existing `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/markdownLite.ts:80` error.
- `pnpm exec biome check src/`: exited 0 with 13 pre-existing warnings.
- `git diff HEAD --check`: passed.
- Asimov `change verify-status integrate-cursor-agent`: exited 0.
