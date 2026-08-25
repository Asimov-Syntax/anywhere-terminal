# Review Round 2

- Date: 2026-08-25
- Target: separate-detail-completeness-signals
- Scope: working-tree re-review — round-1 rebutted files plus changes since round 1
- Reviewable lines: 54
- Agents spawned: 5 (`asm-review-performance`, `asm-review-data-security`, `asm-review-logic`, `asm-review-contracts`, `asm-review-reuse`)
- Agents skipped: `asm-review-frontend` (no webview production changes in the re-review scope)
- Verdict: REJECT
- Counts: BLOCK 3 | WARN 1 | SUGGEST 1

## Cross-round resolution

- Round 1 B1: fixed for a stable, successful query set — exact 2,100/5,000 capacity no longer reports omission, and capacity+1 does.
- Round 1 W1: fixed — tests now supply source totals independently of retained windows and cover exact capacity, capacity+1, and count failure.
- Round 1 W2: fixed — the newer task 2_3 verification explicitly supersedes the circular gap-based declaration. A new cost-characterization warning remains below.

## Findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-contracts, asm-review-reuse
- file: src/vault/readers/opencodeReader.ts:691
- title: Count and window results do not share one SQLite snapshot
- evidence: The completeness decision compares `msgCountRes`/`partCountRes` with rows returned by four window queries, but all seven `readSqliteFn` calls execute independently. The default `readSqlite` path copies the live database and WAL/SHM sidecars separately for every call. OpenCode can commit between copies, so a count can observe a different database version from the retained windows it is compared with.
- impact: A post-window insert can produce `partial: true` even though the window snapshot was complete, while a count taken before later window snapshots can suppress `partial` despite omission. The new mechanism therefore does not establish the promised iff completeness signal on a live store.
- suggestedFix: Reuse `withSqliteSnapshot` for the entire detail read and execute every related query through one `snapshot.query` callback. Inject that snapshot function for tests, following the existing Cursor reader pattern.
- status: accepted
- triage: ACCEPTED. Verified: readSqlite (src/vault/sqlite.ts:256-280) ends in readSqliteViaCopy, so all 7 queries copy the live DB independently. Fixing via withSqliteSnapshot, following the cursorIdeReader pattern (options.withSqliteSnapshotFn ?? readSnapshot). Contained: 12 readOpenCodeDetail call sites in opencodeReader.detail.test.ts; opencodeReader.test.ts uses only the list path and is untouched.

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-contracts
- file: src/vault/readers/opencodeReader.ts:721
- title: Failed count queries silently present unknown completeness as complete
- evidence: `rowsExceed` returns false for non-ok, absent, or unparseable counts. The four bounded window queries can succeed and omit middle rows while one count fails; `finalizeDetail` then receives `false` and omits `partial`. The added test at `opencodeReader.detail.test.ts:533` pins this behavior rather than an honest failure/unknown state.
- impact: The caller receives a successful, non-pageable detail with no incompleteness marker even though the reader cannot establish that the fixed source window is complete. This contradicts the added requirement to set `partial` when source records were omitted.
- suggestedFix: Require successful completeness probes before returning a normal detail. On probe failure, either fail/degrade the detail read consistently with required window-query failures or introduce an explicit unknown-completeness state and define its consumer behavior. Do not encode unknown as `partial` absent.
- status: accepted
- triage: ACCEPTED. rowsExceed encoding unknown as complete is the false-complete direction, which is the one the requirement cannot tolerate. User decision: on probe failure the read still renders the timeline but sets partial with a limitedReason saying completeness could not be verified. No spec change — the ADDED requirement says partial SHALL be set WHEN records were omitted, which does not forbid setting it when omission is unknown, so this stays inside build rather than a handback.

### B3

- ID: B3
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-performance
- file: src/vault/readers/opencodeReader.ts:681
- title: COUNT(*) defeats the fixed detail read's structural bound
- evidence: The message and part growth axes are per-session history and are not capped. Their indexes make these covering scans, but SQLite must still visit every matching index entry for `COUNT(*)`, so each detail request adds O(messages + parts) work. This repeats on preview open and each load-more request. It also adds two `readSqlite` copy/query/delete cycles; on the byte-copy fallback that is two additional whole-store copies per request (about 2.8 GB for the documented 1.4 GB OpenCode store), excluding WAL/SHM.
- impact: Detail latency and I/O now grow with full session history even though retained output remains capped at 2,100 messages and 5,000 parts, reintroducing the scale behavior the fixed windows were designed to prevent.
- suggestedFix: Use bounded existence probes on the shared snapshot, such as `SELECT 1 FROM message WHERE session_id = ... LIMIT 1 OFFSET 2100` and the equivalent part probe at offset 5000. No `ORDER BY` is needed for cardinality existence; both plans use covering session indexes and inspect at most 2,101/5,001 entries. Batch or fold probes into the shared read to avoid extra snapshot cycles.
- status: accepted
- triage: ACCEPTED, and the arithmetic correction with it. My round-2 objection generalized from the disjointness predicate to all probes and was wrong: comparing the pre-trim evidence union cardinality against the retained H+T is exact (2100 -> false, 2101 -> true, 2102 -> true), and LIMIT 1 OFFSET H+T is the same result more cheaply. COUNT was never required. Replacing both COUNT queries with bounded existence probes on the shared snapshot.

### W1

- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-contracts
- file: asimov/changes/separate-detail-completeness-signals/build-state.json:107
- title: Verification state incorrectly describes COUNT as bounded
- evidence: The replacement test-change reason calls each `SELECT COUNT(*)` “bounded.” The result cardinality is one row, but the scan is proportional to every matching message/part row and has no structural bound.
- impact: The durable verification record overstates the data-scale property of the chosen fix and can mislead later gates reviewing the fixed-window contract.
- suggestedFix: Re-declare task 2_3 after replacing COUNT with a genuinely bounded probe, or accurately describe COUNT as a bounded-result aggregate with an unbounded per-session scan.
- status: accepted
- triage: ACCEPTED. Third time this declaration has overclaimed; re-declaring task 2_3 after the probes land, describing bounded existence probes rather than calling an unbounded scan bounded.

### S1

- ID: S1
- severity: SUGGEST
- confidence: MEDIUM
- priority: P4
- agent: chair, asm-review-logic
- file: src/vault/readers/opencodeReader.detail.test.ts:523
- title: Capacity-plus-one coverage only exercises the message branch
- evidence: The new +1 test sets `messageTotal` above capacity while `partTotal` remains exact. Because `messageWindowTruncated || rowsExceed(partCountRes, ...)` short-circuits, no test makes the part-table overflow branch independently return true.
- impact: A regression isolated to part-count overflow detection could pass while message-boundary tests remain green.
- suggestedFix: Add the symmetric case with messages at exact capacity and parts at 5,001; retain the existing count-failure case or split failures per table if the error policy remains table-specific.
- status: accepted
- triage: ACCEPTED. The || short-circuits on message overflow, so the part branch is unproven. Adding a case with messages at exact capacity and partTotal = 5001.
