# Asimov Review Round 1

- Date: 2026-08-30
- Cycle: 1
- Round: 1
- Mode: discovery
- Requested mode: fastlane
- Scope: commit range `200dee01..b42cd5aff21a4ddbaa1044a8d1b9323181f091af`
- Head: `b42cd5aff21a4ddbaa1044a8d1b9323181f091af`
- Tree: dirty outside the explicit range; current analytics, `skills-lock.json`, and unrelated research-document changes were excluded
- Reviewable lines: 1,814, including generated Asimov analytics/build metadata; 156 added / 123 removed test lines reviewed inline
- Size note: Large change — accuracy may decrease
- Agents spawned:
  - `asm-review-logic` — engine atomicity, race behavior, failure routing, liveness — `gpt-5.6-sol[1M]`
  - `asm-review-data-security` — read-only source, WAL/SHM failure, destination SQL and error origin — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — approved D1-D4, task acceptance, status consumers — `sonnet[1M]`
  - `asm-review-performance` — multi-GB growth axis, restart liveness, hot-path materialization — `gpt-5.6-terra[1M]`
  - `asm-finder` — caller and status-consumer flow inventory — support search
- Agents skipped:
  - `asm-review-frontend` — no frontend code or client-state cone
  - `asm-review-reuse` — no material repository reimplementation candidate after the engine mechanisms were selected by the approved design
- Verification evidence: `bun run asm change verify-status snapshot-a-live-store-atomically` records tasks 1_1 through 1_4 at exit 0. The caller brief reports type check clean, 5,391 unit tests passing, I10 passing, and Biome `src` at its 4/14/3 baseline. Review did not rerun project verification.
- Verdict: BLOCK
- Counts: 2 BLOCK, 2 WARN, 1 SUGGEST
- Split over gating blockers: 2 feature / 0 machinery

## Risk map and full-flow trace

- Top-risk flow, in-process engine: `readSqlite` / `withSqliteSnapshot` → engine probe → presence proof → private temp directory → read-only `DatabaseSync` source → Online Backup API → read-only query of destination → status translation → Codex/OpenCode/Cursor consumers → cleanup.
- Top-risk flow, CLI engine: the same entry and presence gates → `sqlite3 -readonly <source> VACUUM INTO <minted destination>` → `sqlite3 -readonly -json <snapshot>` → status translation → consumer unreadable/unknown handling → cleanup.
- Consumer inventory verified: list paths surface `query-error`/`db-unreachable` as unreadable; point lookups map them to unknown except Codex's conservative JSONL fallback; only confirmed `no-db` can prove absence where no alternate source exists. No changed path converts a snapshot throw into `ok`.
- Security inventory verified: both source opens are read-only; the destination is minted below `mkdtemp`, passed without a shell, and single quotes are SQL-escaped. A targeted CLI probe confirmed a missing `-shm` in a non-writable store directory fails loudly with code 14 and matches the source-open classifier.
- Atomicity evidence: official SQLite documentation guarantees completed Online Backup and `VACUUM INTO` outputs are consistent snapshots. The implementation mechanism is sound against torn base/WAL assembly; the remaining gates concern unbounded completion, status-origin discrimination, and missing acceptance coverage.

## Findings

### B1

- ID: B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts` (corroborated by `asm-review-logic` and chair)
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/sqlite.test.ts:345,359`
- Title: The accepted checkpoint/VACUUM interleaving has no automated guard
- Evidence: Tasks 1_1 and 1_2 require a WAL-resident row to survive while the live store checkpoints and vacuums during the snapshot, for both engines, verified by unit tests. The replacement real-engine tests only create a WAL-resident row and then snapshot it; neither starts a checkpoint or `VACUUM` while `backup()` or `VACUUM INTO` is in progress. The prior interleaving test was deleted, and verify-status explicitly records that the exact race was not replaced. Official engine guarantees support the implementation choice, but they do not satisfy the accepted test obligation.
- Invariant: every successful snapshot used to prove absence must correspond to one source state and preserve rows committed before its snapshot point across concurrent checkpoint/VACUUM activity. Boundary inventory searched: node and CLI engines; `readSqlite` and `withSqliteSnapshot`; WAL present/missing/unreadable; source-open and operation failures; zero-row consumers. Affected/unverified: concurrent checkpoint/VACUUM during both engine operations and the real-engine `withSqliteSnapshot` path. Verified safe: static WAL-resident rows through both engines, single engine call instead of file copies, and non-`ok` downstream mappings.
- Impact: CI can pass without exercising the exact race invariant this change owns. A later sequencing, engine-selection, or snapshot-wrapper regression could reintroduce false-empty success without a discriminating test.
- SuggestedFix: Add deterministic concurrent checkpoint/VACUUM acceptance tests for both engines and both snapshot entry contracts. Use a narrowly scoped progress/interleaving seam or a sufficiently controlled real-engine harness; if the accepted test is genuinely impossible, revise and re-approve the hard Acceptance field instead of marking it verified.
- Status: new
- Triage: pending

### B2

- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-performance` (corroborated by `asm-review-logic` and chair)
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/sqlite.ts:312`
- Title: The preferred node backup has no completion bound under live-store churn
- Evidence: `SNAPSHOT_TIMEOUT_MS` is applied only to the CLI process. The preferred path directly awaits `backup(source, dest)` with no deadline, cancellation, progress cutoff, or finite restart budget. SQLite's Online Backup contract restarts an incremental backup when another connection mutates the source and explicitly permits sufficiently frequent restarts to prevent completion. The growth axes are uncapped live-page count, explicitly multi-GB, and uncapped external write frequency.
- Invariant: every vault read must settle as a discriminated result within a bounded interval and release its private snapshot state. Boundary inventory searched: node/CLI engines; cached lists; direct entry/detail/identity reads; both entry points; failure catches; temp cleanup. Affected: every node-backed snapshot, especially active multi-GB stores. Verified safe: CLI snapshots have a 30-second process timeout and reach `finally` after settlement.
- Impact: a normal list, detail, point lookup, or resume identity check can remain pending indefinitely instead of returning `query-error`; its partial destination and source connection remain live because cleanup is unreachable until `backup()` settles.
- SuggestedFix: Run the node backup through a genuinely cancellable bounded execution path, such as an isolatable worker/process or another mechanism that can be terminated at a wall-clock deadline. On expiry, settle as `query-error` and delete the partial destination. A plain `Promise.race` is insufficient if the underlying backup continues using the source and destination.
- Status: new
- Triage: pending

### W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-data-security` (corroborated by chair)
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/sqlite.ts:297,314`
- Title: Destination-open failures are reported as source `db-unreachable`
- Evidence: both snapshot engines classify every `SQLITE_CANTOPEN`/`SQLITE_READONLY`-style error as `SnapshotOpenError`, even though the same codes can come from creating or opening the destination. A targeted CLI probe using a valid readable source and a destination below a missing directory produced code 14 and `unable to open database: <destination>`, which the current regex maps to `db-unreachable`.
- Impact: a temp-destination permission, removal, path, or filesystem failure violates D2's discrimination by masquerading as refusal to open the live store. Most consumers remain conservative, but diagnostics and Codex's fallback choice no longer reflect the actual failure boundary.
- SuggestedFix: Preserve error origin. Establish the destination before invoking SQLite or otherwise distinguish source-open from destination-open errors, then map only source refusal to `db-unreachable`; destination and snapshot-operation failures remain `query-error`. Add node and CLI destination-failure tests.
- Status: new
- Triage: pending

### W2

- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-performance` (corroborated by chair)
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/sqlite.ts:393,426`
- Title: Bounded-result reads now materialize the entire unbounded store
- Evidence: every snapshot reads and writes all live database pages before running bounded or point SQL. Store pages are structurally uncapped and explicitly exceed 1 GB; direct detail, entry lookup, and identity paths do not share the list cache. This replaces the common APFS/Linux copy-on-write clone path, which was near-constant metadata work, with O(P) source I/O, destination I/O, and temp space per request. Concurrent requests multiply that cost.
- Impact: an O(1) lookup or bounded detail/resume action can incur multi-GB latency, CPU, and temporary-disk demand. The CLI timeout limits elapsed time but may turn legitimate large stores into repeated failures after substantial I/O; the node path has the stronger unbounded-liveness defect in B2.
- SuggestedFix: Measure the supported multi-GB flows and introduce bounded snapshot reuse/coalescing for requests that prove the DB/WAL stamps unchanged, including one in-flight producer and a small explicit lifetime, without weakening point-in-time correctness.
- Status: new
- Triage: pending

### S1

- ID: S1
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/sqlite.ts:278-279`
- Title: A newly added comment still says the CLI assembles file copies
- Evidence: the comment above `takeSnapshot` says the CLI branch “still assembles one from file copies; task 1_2 replaces it,” while the immediately selected implementation is already `cliSnapshot` using `VACUUM INTO`. This directly contradicts the completed code and the module-level statement that nothing copies a store.
- Impact: future maintenance is pointed toward a mechanism that no longer exists, and task 1_4's prose-retirement claim is not fully true in `src/`.
- SuggestedFix: Replace the stale comment with the final two-engine snapshot contract.
- Status: new
- Triage: pending

## Inline support review

- No `.only`, `.skip`, disabled test, unawaited async assertion, or secret-bearing fixture was introduced.
- The new real WAL tests prove both engines see a committed WAL-resident row, but they do not execute the accepted concurrent checkpoint/VACUUM scenario (B1).
- `withSqliteSnapshot` covers one-snapshot/many-query reuse and generic snapshot failure, but its real-engine concurrency boundary remains part of B1's unverified inventory.

## Accepted risk

None.

## Audit backlog

None.

## Author triage

### B1 — accepted
Fair, and the gap is mine: I recorded an Acceptance about surviving a concurrent checkpoint and then shipped tests that never run one. Fixable rather than a contract revision: `node:sqlite`'s `backup()` takes `{ rate, progress }`, the callback fires per step, and firing a `wal_checkpoint(TRUNCATE)` plus `VACUUM` from inside it interleaves the race deterministically — verified by probe. The CLI cannot be stepped, so its test drives the checkpoint concurrently against a store large enough that `VACUUM INTO` is still running; the assertion (whole, or a failure status — never a successful short read) is safe either way.

### B2 — accepted
Real liveness defect. `SNAPSHOT_TIMEOUT_MS` reaches only the CLI, and SQLite restarts an incremental backup whenever the source is written, so a busy store can starve it forever. The chair is right that `Promise.race` is not a fix. It does not need a worker either: throwing from the `progress` callback aborts the backup for real — verified by probe, the promise rejects and stepping stops. A wall-clock deadline enforced there is genuine cancellation in-process.

### W1 — accepted
Correct. Classifying on the result code alone cannot tell whose open failed, and a destination failure reported as `db-unreachable` is a lie about the user's store — precisely the class of misattribution D2 exists to prevent. Fixed by proving the source is readable before blaming it.

### S1 — accepted
Stale comment; 1_2 already landed.

### W2 — accepted, and it blocks archive despite being a WARN
Measured rather than argued: a 522 MB store clones in 5 ms via APFS `cp -c` and backs up in 951 ms — ~190x, scaling linearly, against an OpenCode store known to exceed 1 GB. That is ~2.5 s added to every list, detail, lookup and resume identity check on the primary platform. The old mechanism was wrong but O(1); this one is right and O(pages), and shipping it as-is trades a rare false-absent for a constant, universal latency regression.

I am not fixing it in this fix loop. Snapshot reuse — keying a live snapshot to a DB/WAL stamp, one in-flight producer, an explicit lifetime — is a new invariant owner (snapshot freshness and lifetime), and folding it in as remediation is exactly the boundary violation that closed a cycle as superseded on the parent change. So: fix B1, B2, W1 and S1 as in-contract remediation, then hand back to `asimov-plan` for the reuse decision BEFORE archive. This change does not archive carrying the regression.

