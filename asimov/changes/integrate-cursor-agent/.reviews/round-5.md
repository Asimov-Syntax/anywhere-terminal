# Review Round 5

- Date: 2026-08-24
- Scope: working-tree changes after round 4, on top of commit `a07456f`
- Reviewable lines: 520
- Large change: no
- Agents spawned: asm-review-data-security, asm-review-logic, asm-review-contracts, asm-review-performance, asm-review-frontend, asm-review-reuse
- Agents skipped: none
- Verdict: REJECT
- Counts: BLOCK 4 | WARN 3 | SUGGEST 0

## Current Findings

### B14

- ID: B14
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-data-security, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorReader.ts:584
- title: Hidden project transcripts remain directly addressable without parent authority
- evidence: `readCursorDetail()` accepts any syntactically valid `project:<bucket>:<transcriptId>` id and point-resolves and decodes it. `VaultService.getDetail()` dispatches a webview-supplied entry id directly to this branch, but the request carries no parent entry, invocation locator, or host-side authorization proving that the id was emitted from a recognized parent Task/Agent result. Removing project rows from list/cache therefore hides discovery but does not enforce D12's exact-mirror-or-referenced-child access boundary.
- impact: A forged detail request can read an orphan or unrelated project JSONL transcript when its encoded bucket and transcript id are known. The same generic project entry resolver also makes the hidden identity available outside the parent-child flow that was meant to authorize it.
- suggestedFix: Keep CLI mirror fallback internal to the validated CLI detail path. For child detail, require a parent-scoped opaque locator/request token and re-derive or authorize the child from the validated parent's bounded normalized result, or maintain a bounded host-side authorization map keyed by the active parent/request generation. Do not expose arbitrary `project:*` ids through the generic detail endpoint.
- status: new
- triage: Confirmed against approved D12/D13 and task 10_7 Boundary. Source-qualification and containment validate a path, but they do not prove that the caller reached it through an accepted parent relationship.

### B15

- ID: B15
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorReader.ts:626
- title: Unverified or mismatched CLI stores still decode project JSONL fallback
- evidence: `readCursorStoreDetail()` returns the same `limited` result for identity mismatch, unreadable/malformed profile, and transcript-graph limitations. `readCursorDetail()` then attempts the same-project JSONL fallback for every `limited` result. Consequently a store whose `meta['0'].agentId` differs from `sessionId`, or whose identity cannot be read at all, can still return a full timeline from project JSONL. The new D14 contract explicitly requires Detail to prove the bounded store identity before decoding content, and the mismatched-identity scenario must fail closed.
- impact: A stale or moved CLI metadata directory can display project transcript content under an identity that the canonical store did not authorize. This bypasses the deferred identity boundary for preview even though Resume and Copy are gated.
- suggestedFix: Preserve identity-verification state separately from transcript compatibility. Return a result that distinguishes `identity-rejected/unverified` from `identity-verified-but-detail-limited`, or perform both operations in one snapshot-backed resolver. Permit project fallback only after the candidate store identity has been proven; mismatch/unavailable identity must return metadata-only.
- status: new
- triage: Chair-only full-flow finding. Existing fallback coverage proves the current behavior, but it predates and now contradicts the approved D14 task/spec boundary.

### B16

- ID: B16
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-data-security
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorStore.ts:267
- title: Ambiguous metadata rows can pass Resume identity proof
- evidence: `CURSOR_PROFILE_SQL` selects `meta.key = '0'` with `LIMIT 1`. `compatibleProfile()` checks column counts and declared types, but not the supported primary-key/uniqueness constraint and not that exactly one `key = '0'` row exists. A malformed two-column `meta` table with duplicate key-0 rows is therefore accepted, and `readCursorStoreProfile()` can prove whichever row SQLite returns first.
- impact: A malformed or ambiguous store can be treated as identity-proven, allowing executable probing, command copying, and terminal creation despite D14's fail-closed requirement for malformed stores.
- suggestedFix: Validate the supported schema constraint for `meta.key` and query bounded aggregate evidence that exactly one key-0 row exists. Reject zero, duplicate, or otherwise ambiguous identity rows before decoding the value.
- status: new
- triage: Confirmed. The profile query was reused correctly, but the newly side-effect-authorizing proof exposes its incomplete schema gate.

### B17

- ID: B17
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-performance, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/VaultLauncher.ts:84
- title: Resume and Copy re-resolve all Cursor history and can prove a different candidate
- evidence: `resolveLaunchable()` first calls `VaultService.getEntry()`, whose Cursor reader resolves the chat through `resolveCursorChatCandidate()` and `listCursorChatCandidates()`. It then calls `verifyResumeIdentity()`, which independently calls the same global candidate discovery again. `listCursorChatCandidates()` enumerates every historical bucket and chat before building its location index and has no structural discovery cap. The two independent resolutions also leave a race in which the entry/cwd comes from candidate A, the filesystem changes, and the proof validates a newly unique candidate B with the same chat id.
- impact: Growth axis is all Cursor chat buckets/chats per user per explicit Resume or Copy action; latency and filesystem I/O grow without a structural bound and duplicate the scan. Under a move/delete-create race, authorization can bind to a different storage context from the entry whose cwd is launched.
- suggestedFix: Resolve and validate the exact Cursor candidate once, carry its contained `metaPath`/`dbPath` and mapped entry through the proof, and then build/probe from that same resolved object. A validated persisted location may accelerate the point lookup, but duplicate ambiguity must still be checked without a second independent global resolution.
- status: new
- triage: Confirmed against the accepted round-4 B11 growth shape. Detail no longer scans twice, but this wave reintroduces the same unbounded duplicate discovery in Resume and Copy.

### W14

- ID: W14
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: asm-review-performance
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorReader.ts:507
- title: Child linking repeats the same project-path reconstruction up to 64 times
- evidence: For each distinct child id, `linkCursorChildSessions()` serially calls `resolveCursorProjectTranscriptForCwd()`. Every call recomputes the same project bucket and reruns `resolveCursorProjectCwd()` for the unchanged parent cwd; that resolver permits up to 4,096 directory checks. With the 64-child cap, one preview can perform up to 262,144 repeated path checks before the exact two-layout transcript stats.
- impact: The work is structurally capped, so it is not unbounded, but a transcript with many child calls can incur avoidable high latency and filesystem load.
- suggestedFix: Validate and resolve the parent project bucket/cwd once before the child loop, then pass that resolved bucket into the exact child transcript lookup. Optionally perform the bounded leaf lookups with bounded concurrency.
- status: new
- triage: Retained as a bounded performance warning, not a blocker.

### W15

- ID: W15
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-frontend
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/PreviewController.ts:421
- title: Reopened child requests can consume a stale response from the same entry id
- evidence: Nested responses are correlated only by `msg.entryId`. Closing/collapsing or switching clears `pendingNested`, but reopening the same child id creates a new pending set with the same key. If the old response arrives after that reopen, `handleSessionDetailResponse()` consumes it as the new request's response because no request generation/token distinguishes them.
- impact: A stale child transcript or stale error can replace the newly opened card's content or fallback after close/reopen. The root-preview active-entry guard does not apply because nested responses use the child id rather than the active root id.
- suggestedFix: Add a per-request generation/token to nested detail requests and replies, store it with the pending child set, and accept a response only when it matches the current preview/request generation. Invalidate it on preview close/switch and child collapse.
- status: new
- triage: Retained because task 10_10 explicitly requires stale-response guards; the current test covers switching to a different preview but not close/reopen of the same child id.

### W16

- ID: W16
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-frontend, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/PreviewController.ts:864
- title: One duplicate child card can cancel every card sharing the request
- evidence: Duplicate bodies are intentionally coalesced in one `Set` keyed by child `entryId`, while expansion state is also keyed only by `entryId`. Clicking another card for the same child while one is open toggles the shared state closed, and the collapse callback deletes the entire `pendingNested` entry rather than removing only that body. After a rerender where both cards are open, collapsing either card likewise drops the response/fallback delivery for the other still-open body.
- impact: The still-open card can remain stuck on Loading and never receive either the child detail or its own WeakMap fallback, violating the accepted per-card fallback behavior for duplicate references.
- suggestedFix: Track expanded/pending membership per card body while coalescing only the underlying fetch by child id. On collapse remove that body from the pending set; cancel/invalidate the shared request only when no bodies remain.
- status: new
- triage: Retained as a concrete duplicate-card interaction defect. The WeakMap correctly isolates fallback values, but the surrounding shared expansion/pending lifecycle is not per-card.

## Cross-round Disposition

- Round-4 B7: superseded by the approved D12 replan — project JSONL is intentionally no longer a standalone row. B14 addresses enforcement of the replacement exact-detail-only boundary, not the retired standalone-row obligation.
- Round-4 B8: fixed — project-only hints no-op and mixed CLI/IDE hints update every affected top-level segment.
- Round-4 B9: remains rejected as written because schema-1 `meta.json` omits `agentId`; deferred store proof is the approved replacement. B15/B16 review defects in that replacement rather than re-reporting metadata-list identity.
- Round-4 B10: fixed for global/cross-project id matching. B15 is a distinct failure to require validated store identity before same-project fallback.
- Round-4 B11: fixed in CLI detail by resolving once; B17 identifies the same full-history duplication newly introduced in Resume/Copy.
- Round-4 B12: fixed — project mirror/child lookup is exact within one derived project bucket and no longer globally scans transcript ids.
- Round-4 B13: fixed — follow detail reads are single-flight with one dirty/coalesced follow-up.
- Round-4 W13: fixed — already-proven reachable blobs are fetched in bounded batches.
- Round-4 S7: remains rejected.
- Round-4 S8: fixed — the canonical Cursor resumability predicate is shared across launch seams while host boundaries retain independent assertions as required by task 10_3.
- Round-4 S9: fixed — Cursor source is included in the render signature.

## Specialist Disposition

- asm-review-contracts: no findings.
- asm-review-logic: no findings.
- asm-review-reuse: two proposed duplication warnings were not retained. The independent launcher/builder capability assertions are explicitly required by task 10_3, and the local safe-id repetition is not a demonstrated behavior defect.
- asm-review-data-security symlink-containment finding: not retained in this round because the relevant resolver/open behavior is unchanged from the reviewed base and does not meet the workflow's changed-code exception threshold for re-reporting unchanged code.

## Verification

- Focused proof/launch suites: passed, 5 files / 191 tests.
- Focused preview/cache/watcher suites: passed, 4 files / 204 tests.
- `pnpm run check-types`: exited 2 with only the documented pre-existing `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/markdownLite.ts:80` TS2339 error.
- `git diff HEAD --check`: passed.
- Manual Extension Development Host smoke task 9_9 remains intentionally open for the user.
