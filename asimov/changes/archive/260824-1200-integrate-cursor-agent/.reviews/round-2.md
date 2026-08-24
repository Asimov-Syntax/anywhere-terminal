# Review Round 2

- Date: 2026-08-24
- Scope: changes since round 1 plus rebutted files
- Reviewable lines: 609
- Agents spawned: asm-review-logic, asm-review-performance, asm-review-data-security, asm-review-contracts, asm-review-reuse
- Agents skipped: asm-review-frontend (no round-2 frontend behavior changed)
- Verdict: BLOCK
- Counts: BLOCK 2 | WARN 6 | SUGGEST 0

## Current Findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-performance, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/VaultService.ts:255
- title: Cursor hints still invoke every agent reader and rebuild the complete Vault list
- evidence: `readAll` always maps over every `VAULT_AGENT_IDS` member; a Cursor hint is passed only to Cursor while Claude, Codex, and OpenCode are still called normally. The changed test explicitly expects the Claude reader to run with an undefined hint. Claude consequently re-lists and stats its unbounded JSONL history, after which all returned entries are copied and globally sorted. One Cursor metadata event still pays unrelated full-history work across uncapped provider histories.
- impact: Round-1 B1 persists: the fix shifts the full-history scan away from Cursor files but does not make watcher-driven refresh targeted at the Vault-service boundary. Large Claude/other histories continue to make ordinary Cursor metadata events expensive.
- suggestedFix: For a targeted hint, invoke only the hinted reader, carry non-target agents' cached entries/cache forward unchanged, and replace only that agent segment in the merged result before persisting.
- status: accepted
- triage: Persists from round 1 — accepted targeted-refresh fix is incomplete at the aggregate service boundary.

### B4

- ID: B4
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-logic, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/cacheTypes.ts:67
- title: Persisted cursor-files caches are rejected on every load
- evidence: The active `ReaderListCache` union and round-2 targeted state use `kind: "cursor-files"`, but `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/VaultCacheStore.ts:65-96` validates only `files` and `store` and returns false for every other discriminant. `VaultCacheStore.load` voids the entire cache if any agent cache fails validation. No save-to-load Cursor-cache round-trip test exists.
- impact: `listCached()` returns null after every restart, eliminating instant Vault rendering for all providers and forcing a full uncached rebuild. Cursor cannot reuse its targeted cache across extension sessions, materially reintroducing B1's full-history startup cost.
- suggestedFix: Validate `cursor-files` chats, stamps, entries, optional `unreadableById`, and `rejected` in `VaultCacheStore`; add a save/load round-trip fixture containing a Cursor cache and bump the cache version if incompatible persisted shapes must be discarded.
- status: accepted
- triage: Accepted — persisted Cursor state is part of the active cache union and must survive a save/load round trip; add strict shape validation and regression coverage.

### W3

- ID: W3
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-data-security, asm-review-contracts, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorReader.ts:256
- title: Targeted refresh still cannot maintain exact rejected-id accounting
- evidence: A hinted refresh combines the previous whole-scan rejected total with only the current event batch using `Math.max(prevRejected, changedRejected)`. Separate unsafe-id creations do not accumulate, while deletion can never decrement the value. A count of one therefore remains one after a second unsafe id appears and remains nonzero after the sole unsafe directory is removed.
- impact: Round-1 W3 persists for watcher-driven create/delete transitions; the user-visible unreadable count under- or over-reports until a later complete scan.
- suggestedFix: Recompute rejected candidates with a safe full candidate scan whenever an unsafe hint occurs, or persist keyed rejected identity/location state that supports exact incremental addition and removal without joining or reading the rejected path.
- status: accepted
- triage: Persists from round 1 — full-scan counting is fixed, targeted transition accounting is not.

### W4

- ID: W4
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-data-security, asm-review-reuse, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/cursor/CursorHookInstaller.ts:337
- title: Apostrophe paths still produce invalid POSIX hook commands
- evidence: Exact execution of the current function for `/tmp/O'Brien/hook.sh` emits raw bytes representing `'/tmp/O'\"'\"'Brien/hook.sh'`; feeding those bytes directly to `/bin/sh -n` exits 2 with an unmatched single quote. The rebuttal's passing string omitted the literal backslashes and was not the function's output. `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/pty/ShellIntegrationInjector.ts:225-227` already contains the correct POSIX ` '\'' ` quoting implementation, proving the two helpers have diverged.
- impact: Users whose storage path contains an apostrophe receive broken commands in their user-owned Cursor hook configuration and no semantic observation.
- suggestedFix: Extract the correct pure POSIX argument-quoting helper from `ShellIntegrationInjector` into a shared utility and use it from both callers. This extraction is warranted inside this fix because the duplicated implementations already differ behaviorally. Add a raw-output `/bin/sh -n` regression test.
- status: accepted
- triage: Accepted — exact raw-byte reproduction overrules the round-1 rebuttal; reuse one proven POSIX argument-quoting helper and test the actual emitted command with `/bin/sh -n`.

### W5

- ID: W5
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-logic, asm-review-performance, asm-review-contracts
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/VaultWatchCoordinator.ts:87
- title: Targeted path batches are unbounded and probe every bucket for every affected id
- evidence: `pendingPaths` and the watcher pool's per-kind URI maps have no cap and their debounce timers restart on every event. The resulting A affected ids are passed to `resolveChangedCursorChatCandidates`, which discards the already-known bucket from each watcher path and performs A × B sequential directory stats over every historical workspace bucket. Neither A nor B is structurally capped.
- impact: Bulk sync/delete/restore activity can make the targeted path more expensive than a complete scan and postpone refresh indefinitely during a sustained event stream.
- suggestedFix: Cap pending paths and degrade oversized batches to one complete scan; retain the bucket from the validated watcher path as the primary candidate and use an indexed duplicate-location map or bounded fallback only when cross-bucket ambiguity must be checked.
- status: accepted
- triage: Accepted — cap queued watcher paths and fall back to a complete scan when the cap is exceeded; preserve exact safe-path handling and avoid lifetime-history directory enumeration.

### W6

- ID: W6
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-performance
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorReader.ts:206
- title: Each targeted event clones and re-sorts the entire Cursor cache
- evidence: The hinted branch shallow-copies every cached chat, and `cursorResult` materializes and sorts every entry after updating one affected id. The growth axis is total lifetime Cursor chats per machine and has no cap.
- impact: Filesystem reads are more targeted, but each event still performs O(N) cache copying and O(N log N) sorting on the watcher hot path.
- suggestedFix: Maintain an incrementally replaceable ordering/index keyed by chat id and modified time, or at minimum avoid sorting when an update cannot change ordering and coalesce updates before one materialization.
- status: accepted
- triage: Accepted narrowly — remove the redundant Cursor-reader sort because VaultService owns final ordering; a delta-only webview/list protocol would be a broader capability change, so complete result materialization remains.

### W7

- ID: W7
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-performance, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/VaultService.ts:362
- title: Hinted batches are serialized but never coalesced while I/O is active
- evidence: Each hinted caller drains `inflightRefresh` and then starts its own complete `readAll`; later hint paths are not merged into one pending per-agent delta. Multiple attached Vault clients also independently enqueue the same store events.
- impact: Under sustained metadata activity, refresh runs accumulate as a serial backlog and repeatedly pay the unrelated-reader and full-sort costs from B1/W6.
- suggestedFix: Maintain one pending per-agent path set while a refresh runs, merge arriving hints, and execute at most one follow-up targeted refresh with the coalesced delta.
- status: accepted
- triage: Accepted — merge pending same-agent hint paths behind one active run and execute at most one follow-up targeted refresh.

### W8

- ID: W8
- severity: WARN
- confidence: MEDIUM
- priority: P3
- agent: asm-review-logic
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/VaultService.ts:353
- title: A complete refresh can join an in-flight hinted refresh
- evidence: A no-option `refresh()` returns any current `inflightRefresh`, including a hinted run. Panel open and other ordinary refresh callers can therefore receive the partial targeted run instead of starting the complete scan they requested.
- impact: Missed watcher events or cache drift may remain uncorrected when a panel-open/manual refresh happens during the hinted refresh window, and the partial state is persisted again.
- suggestedFix: Track whether the in-flight run is hinted; a non-hinted caller should drain a hinted run and then perform its complete refresh rather than join it.
- status: accepted
- triage: Accepted — a complete caller must drain any hinted run and then execute its own full source-of-truth refresh rather than joining partial cached state.

## Cross-round Disposition

- B1: accepted, persists from round 1.
- B2: fixed — Windows sibling temp path is path-flavor aware and covered.
- B3: fixed — authority now depends on successful serialized reconciliation.
- W1: fixed — the controller captures setting changes during async startup.
- W2: fixed — Cursor identity, positional prompt, and structural options are validated.
- W3: accepted, persists for targeted rejected-id transitions.
- W4: reopened — exact raw-byte verification disproved the rebuttal.
- S1: rejected, not re-reported; bounded-reader extraction remains deferred without observed drift.
- S2: rejected, not re-reported; empty-key provenance tradeoff unchanged.
- S3: rejected, not re-reported; stated same-user threat-model rebuttal unchanged.
- S4: fixed — the Windows probe is deadline-bounded and late settlement guarded.

## Verification

- `pnpm run test:unit`: passed, 150 files / 2655 tests.
- Focused round-2 suites: passed, 7 files / 136 tests.
- `pnpm run check-types`: exited 2 with only the documented pre-existing `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/markdownLite.ts:80` error.
- `pnpm exec biome check src/`: exited 0 with 13 pre-existing warnings.
- `git diff HEAD --check`: passed.
- Asimov `change verify-status integrate-cursor-agent`: exited 0.
