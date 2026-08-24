# Review Round 4

- Date: 2026-08-24
- Scope: implementation changes after round 3, including Cursor CLI/JSONL/IDE preview sources and prior accepted fixes
- Reviewable lines: 3534
- Large change: yes — accuracy may decrease
- Agents spawned: asm-review-data-security, asm-review-logic, asm-review-contracts, asm-review-performance, asm-review-frontend, asm-review-reuse
- Verdict: REJECT
- Counts: BLOCK 7 | WARN 1 | SUGGEST 3

## Current Findings

### B7

- ID: B7
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-logic, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorReader.ts:364
- title: Project JSONL transcripts are never surfaced or resolved as standalone entries
- evidence: The complete Cursor list reads CLI candidates and IDE sessions only. `cursorResult` can persist a `projects` map but never adds project entries, and the full path leaves that map at its empty default. `readCursorEntry` only special-cases `ide:` before attempting CLI chat resolution, while `readCursorDetail` requires that entry resolver to succeed. A syntactically valid `cursor:project:<bucket>:<id>` can receive a follow watch target in `VaultService`, but it cannot be listed, entry-resolved, or detail-read.
- impact: The accepted D12/D13 standalone unmatched-project feature is absent. Project-only history cannot appear in the Vault, cannot open a preview or Continue flow, and cannot publish follow detail despite its watcher being installed.
- suggestedFix: Index bounded project candidates during full and project-hinted reads, validate independent cwd/source identity, reconcile only proven same-context CLI mirrors, emit source-qualified non-resumable unmatched entries, and add exact `project:` branches to entry/detail resolution.
- status: accepted
- triage: Confirmed against D12 and the current combined reader: project candidates are parsed and watched but never merged into list, entry, or detail resolution. Fix as a review task.

### B8

- ID: B8
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-logic, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorReader.ts:300
- title: Mixed Cursor source batches silently discard changed sources
- evidence: `cursorHintKinds` can classify one coalesced watcher batch as CLI plus project or IDE plus project. The hinted reader returns immediately for `project` at lines 315-323, before CLI candidate updates; the IDE branch similarly returns after refreshing only IDE. `VaultWatchCoordinator` intentionally coalesces every Cursor source path under one agent hint, so mixed batches are normal rather than impossible.
- impact: A project JSONL write batched with a CLI metadata/create/delete event can leave the CLI row stale or deleted rows visible until an unrelated later refresh. Once project entries are integrated, IDE/project combinations will likewise lose one affected segment.
- suggestedFix: Partition each hint by source and update every affected cache/list segment before producing one merged result, or conservatively promote any multi-source Cursor batch to a complete Cursor refresh.
- status: accepted
- triage: Confirmed: project+CLI returns through the project branch before CLI refresh, and project+IDE returns after IDE-only work. Promote every multi-source Cursor hint to a complete refresh for the smallest correct fix.

### B9

- ID: B9
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-data-security, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorReader.ts:161
- title: CLI metadata identity is never matched to the chat directory
- evidence: `isCompatibleMeta` validates only `schemaVersion` and `cwd`; `isEligible` checks only conversation presence, subagent state, and sibling database presence. Neither requires the stored `agentId` to be a safe string equal to `candidate.chatId`, yet `mapCursorMeta` marks the directory id `canResume: true`. Point lookup repeats the same incomplete checks. The accepted session-index requirement explicitly excludes absent or mismatched stored identity.
- impact: A moved, stale, or malformed `meta.json` can publish a resumable row under the wrong chat id, and host-side re-resolution preserves the false capability before constructing `--resume <directory-id>`.
- suggestedFix: Require `meta.agentId === candidate.chatId` as part of list and point-lookup eligibility before emitting an entry or setting Resume capability. Add absent and mismatched identity fixtures.
- status: rejected
- triage: Rebutted by installed-schema evidence: all 13 observed schema-1 `meta.json` files omit `agentId`, while the identity exists only inside `store.db`. Requiring `meta.agentId` removes every real CLI row; reading store metadata during list indexing violates the accepted metadata-only/privacy boundary. The plan must choose deferred identity proof at explicit Resume/detail time or retain the documented directory-id contract.

### B10

- ID: B10
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-data-security, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorReader.ts:437
- title: CLI fallback can decode a project transcript from another storage context
- evidence: When a validated CLI store is unsupported, `readCursorDetail` calls `resolveCursorTranscriptCandidate(sessionId)`. That resolver globally scans every project bucket and accepts the sole transcript with the same id; it receives neither the CLI candidate bucket/storage context nor its validated cwd. Global id uniqueness is therefore treated as proof of mirror identity, contrary to D12's same-storage-context requirement.
- impact: If CLI chat `X` belongs to one workspace and the only project JSONL named `X` belongs to another, the preview displays the unrelated conversation and tool details under the CLI row. Continue can then be seeded from the wrong local transcript.
- suggestedFix: Resolve a fallback from the validated CLI candidate's storage context and require the project mapping/cwd to match that chat. If context cannot be proven, fail closed to metadata-only rather than using an id-only global match.
- status: accepted
- triage: Confirmed: global transcript-id uniqueness does not prove that a JSONL candidate mirrors the selected CLI chat. Bind fallback to a proven project/storage context or fail closed to metadata-only.

### B11

- ID: B11
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-performance, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorReader.ts:422
- title: Every CLI preview and follow read rescans all CLI history twice
- evidence: `readCursorDetail` first calls `readCursorEntry`, whose `resolveCursorChatCandidate` performs `listCursorChatCandidates()` over every bucket/chat. It then calls `resolveCursorChatCandidate` again at line 426, repeating the same complete discovery before decoding one selected store. Live-follow invokes this detail path after each refresh event.
- impact: Growth axis is historical Cursor buckets/chats per user multiplied by preview/follow events. One active preview repeatedly performs two unrelated full-history traversals, so latency and filesystem load grow without a structural bound as history accumulates.
- suggestedFix: Resolve and validate the candidate once, carry its mapped entry into the detail path, and use the persisted bounded location index or an exact validated location rather than repeating global discovery.
- status: accepted
- triage: Confirmed: detail performs two complete CLI candidate resolutions before decoding one store. Resolve once immediately; follow-up work should use the bounded location index where available.

### B12

- ID: B12
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-performance, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorTranscript.ts:108
- title: Point resolution discovers every project transcript without a structural cap
- evidence: `listCursorTranscriptCandidates` sorts every project bucket and every `agent-transcripts` directory and accumulates one candidate group per id without a traversal/admission cap. `resolveCursorTranscriptCandidate` invokes that complete discovery to resolve one selected CLI fallback. The persisted project-cache cap is applied only by cache validation and does not bound this discovery work.
- impact: Growth axis is historical project buckets and transcript files per user. A single selected preview or watch-target resolution can perform O(all project history) directory work and allocation, which becomes unbounded independently of the selected session.
- suggestedFix: Resolve from a validated project context/location index, or apply a structural discovery cap before allocation and return an explicit limited fallback on overflow.
- status: accepted
- triage: Confirmed for the id-only fallback path: it enumerates all project buckets and transcript entries without a discovery ceiling. Replace it with exact source-qualified/context lookup; retain an explicit cap for full project indexing.

### B13

- ID: B13
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-performance
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/VaultWatchCoordinator.ts:182
- title: Follow events can start overlapping full Cursor snapshot decodes
- evidence: Each debounced follow event starts `pushDetail`, which calls `VaultService.getDetail` and rebuilds the selected Cursor detail from scratch. While that promise is active, later events can arm and start another read; `refreshSeq` suppresses stale posting only after the expensive work completes and provides no single-flight or concurrency bound.
- impact: Growth axis is follow-event rate multiplied by selected store history. A continuously writing Cursor session can accumulate concurrent SQLite snapshots/full decodes or 32 MiB JSONL window parses, causing avoidable CPU, I/O, temporary-file, and memory pressure.
- suggestedFix: Make follow reads single-flight per client/entry, retain one dirty/high-water flag while active, and run at most one coalesced follow-up after completion. Reuse validated source stamps/root ids/JSONL offsets so unchanged or append-only sources avoid full reconstruction.
- status: accepted
- triage: Confirmed: sequence checks suppress stale publication but do not bound concurrent detail reads. Add one in-flight read plus one dirty/coalesced follow-up per watched entry.

### W13

- ID: W13
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-performance
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorStore.ts:175
- title: CLI detail performs one serial SQLite query per reachable blob
- evidence: `fetchBlob` calls `snapshot.query` for the root, every archive, and every message blob. The structural blob cap is 4,096, but on the supported `sqlite3` fallback each query can invoke up to two subprocess attempts, yielding up to 8,192 process launches for one preview.
- impact: Large compatible chats can make fallback previews extremely slow despite staying within byte/count bounds, and repeated follow reads multiply the cost.
- suggestedFix: Fetch validated hashes in bounded `IN` batches from the same snapshot, retaining per-blob SHA-256 and total-byte validation.
- status: accepted
- triage: Confirmed on the `sqlite3` fallback. Keep root-reachability and hash/byte checks, but fetch already-discovered message references in bounded batches rather than one subprocess-backed query per blob.

### S7

- ID: S7
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: asm-review-reuse
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorStore.ts:250
- title: Cursor store and JSONL paths duplicate record normalization
- evidence: `cursorStore.ts` and `cursorTranscript.ts` independently implement role filtering, text extraction, tool-call/result normalization, tool naming, and bounds. They already diverge on generated/summary filtering, oversized text handling, and reasoning cleanup.
- impact: The same logical chat can render differently depending on whether canonical SQLite decoding succeeds or JSONL fallback is used, and format updates require two edits.
- suggestedFix: Extract one Cursor-specific bounded record normalizer while keeping source framing and source-specific read limits in each reader.
- status: rejected
- triage: Rebutted for this change: SQLite message blobs and project JSONL envelopes have deliberately different framing, failure, truncation, and reasoning-leak rules. A shared normalizer would couple source-specific privacy behavior without a demonstrated defect; retain focused parity tests instead.

### S8

- ID: S8
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: asm-review-contracts, asm-review-reuse
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/VaultLauncher.ts:53
- title: Cursor Resume capability predicate is duplicated across launch seams
- evidence: `VaultLauncher.resolve` and `LaunchBuilder.assertLaunchCapability` independently repeat the source, `canResume`, canonical id, safe-regex, and `..` checks; the regex also duplicates canonical `isSafeCursorChatId`.
- impact: Future tightening of the CLI-only Resume boundary can drift between resolution, command-copy, and build paths.
- suggestedFix: Centralize a pure `isCursorCliResumableEntry`/assertion using `isSafeCursorChatId`, and invoke it at both host boundaries.
- status: accepted
- triage: Confirmed duplication at security-sensitive host boundaries. Extract one pure canonical CLI-resume predicate backed by `isSafeCursorChatId`, while retaining assertions at both call sites.

### S9

- ID: S9
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: asm-review-frontend
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/vaultRenderSignature.ts:17
- title: The no-op render signature omits the source field used by Cursor badges/actions
- evidence: `entriesSignature` includes `canResume` but not `source`, while `cursorSourceLabel` and `canResumeVaultEntry` both read `source`.
- impact: A same-id source correction could be masked by the no-op guard and leave stale source presentation. Current canonical ids make such transitions unlikely, so this is defensive rather than a demonstrated launch bypass.
- suggestedFix: Add `e.source ?? ""` to the signature and cover a source-only delta.
- status: accepted
- triage: Confirmed as a small defensive correctness gap: `source` controls both badge and Resume visibility but is absent from the no-op render signature. Add it with a source-only delta test.

## Cross-round Disposition

- Round-3 B1: fixed — cold hinted refreshes promote to complete when no baseline exists.
- Round-3 B5: fixed — service-level pending and post-force hint paths are capped and promote to complete.
- Round-3 B6: fixed — targeted CLI updates use persisted bucket locations instead of scanning all buckets.
- Round-3 W9: fixed — cached `canResume` and source values are strictly validated.
- Round-3 W10: fixed for duplicate simultaneous client delivery through active-hint path coverage.
- Round-3 W11: fixed — hints not covered by an active complete read queue a follow-up.
- Round-3 W12: fixed — the force barrier routes later hints behind the forced complete read.
- Round-3 S5: fixed — LaunchBuilder delegates complex POSIX quoting to the canonical helper.
- Round-3 S6: fixed — store refresh debounce has a one-second maximum wait.
- Prior rejected findings remain rejected and are not re-reported.

## Adjudication Notes

- The frontend specialist re-reported `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/markdownLite.ts:80`; it is unchanged in this feature scope and documented as the pre-existing typecheck baseline, so it is not a round-4 finding.
- The data-security specialist proposed a strict Cursor IDE `user_version`/embedded-bubble-id profile. The accepted design does not specify those exact markers, and current queries bind identity through exact safe Composer/bubble keys plus header workspace checks, so that proposal was not retained as a concrete blocker.

## Verification

- `pnpm run test:unit`: passed, 153 files / 2744 tests.
- Focused round-4 Vitest suites: passed, 13 files / 387 tests.
- `pnpm run check-types`: exited 2 with only the documented pre-existing `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/markdownLite.ts:80` TS2339 error.
- Focused `pnpm exec biome check`: exited 0 with style warnings only; formatting/style is excluded from review findings.
- `git diff HEAD --check`: passed.
- Asimov `change verify-status integrate-cursor-agent`: exited 0; manual task 9_9 remains unrecorded/open.
