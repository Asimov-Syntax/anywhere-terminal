# Asimov Review Round 2

- Date: 2026-08-30
- Cycle: 1
- Round: 2
- Mode: verification
- Requested mode: fastlane
- Scope: commit range `b42cd5aff21a4ddbaa1044a8d1b9323181f091af..92e078e4860d2575b529abc8b4348114dd301b91`
- Head: `92e078e4860d2575b529abc8b4348114dd301b91`
- Parent / prior reviewed Head: `b42cd5aff21a4ddbaa1044a8d1b9323181f091af`
- Tree: dirty outside the explicit range; current analytics, `skills-lock.json`, and unrelated audit/research documents were excluded
- Scope lock: passed — the range contains round-1 remediation, additive tests, task/review metadata, and no snapshot-reuse/freshness owner
- Reviewable lines: 243, including generated Asimov analytics/build metadata; 140 added test lines reviewed inline
- Agents spawned:
  - `asm-review-logic` — B1 race matrix, B2 deadline behavior, cleanup cone — `gpt-5.6-sol[1M]`
  - `asm-review-data-security` — W1 source/destination refusal attribution — `gpt-5.6-terra[1M]`
  - `asm-review-performance` — B2 bound and W2 routing/growth axis — `sonnet[1M]`
- Agents skipped:
  - `asm-review-contracts` — no new public contract; accepted obligations were carried directly into the verification contexts
  - `asm-review-frontend` — no frontend cone
  - `asm-review-reuse` — reuse was deliberately not implemented; its ownership is the planning route, not this verification diff
- Verification evidence: `bun run asm change verify-status snapshot-a-live-store-atomically` records task 2_1 at exit 0 and assertions +6. The coordinator brief reports type check clean, 5,395 unit tests passing, I10 passing, and Biome `src` at its 4/14/3 baseline. Review did not rerun project verification.
- Verdict: BLOCK
- Counts: 1 BLOCK, 3 WARN, 0 SUGGEST

## Verification scope and adjudication

- B1: verify the checkpoint/VACUUM race guard across node and CLI engines, `readSqlite` and `withSqliteSnapshot`, and the production snapshot path.
- B2: verify that live-store churn cannot starve node backup forever and that rejection still closes the source and reaches temp cleanup.
- W1: verify source-vs-destination failure attribution in both engines.
- W2: verify the unchanged full-store materialization cost and whether routing a freshness/reuse owner to planning is the correct scope boundary.
- S1: verify the stale mechanism comment is gone.

Node v24.7.0 source confirms each continued `SQLITE_OK`/`SQLITE_BUSY`/`SQLITE_LOCKED` backup step with pages remaining invokes the supplied progress callback before rescheduling; a callback throw finalizes the backup, rejects the promise, and schedules no further step. That fixes B2's production churn-starvation mechanism. The 30-second wall-clock budget is defensible against the supplied 951 ms / 522 MB and approximately 2.5 s / 1.4 GB measurements: it leaves substantial normal-throughput headroom while deliberately failing a continuously restarting store. The remaining B2 issue is test fidelity, recorded separately as W3.

The post-error node `SELECT 1` proof is conservative but not causal: a source condition can change between the backup error and the probe. No separate finding is opened because both outcomes remain fail-closed and the stable destination-failure case is correctly classified. A pre-operation source proof would be more deterministic. The CLI branch, however, retains the exact round-1 result-code-only defect and therefore keeps W1 open.

## Findings

### B1 — persists from round 1

- ID: B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic` (corroborated by chair)
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/sqlite.test.ts:497-576`
- Title: The atomicity acceptance remains unguarded outside one injected node/readSqlite path
- Evidence: The only new interleaving test forces the node engine, overrides `deps.snapshot` with a test-owned Online Backup implementation, and invokes only `readSqlite`. It never forces the real CLI `VACUUM INTO` path and never invokes `withSqliteSnapshot`, so three boundaries from B1's round-1 inventory remain untested. It also sets `raced = true` before the checkpoint and `VACUUM` complete and accepts `query-error`; if either live-store operation throws from the progress callback, the test can pass without the required interleaving having completed. Removing or breaking the production default snapshot selection does not invalidate this test because the production snapshot is replaced.
- Invariant: every successful snapshot used to prove absence must correspond to one source state and preserve pre-snapshot rows across concurrent checkpoint/VACUUM activity. Boundary inventory searched: node/CLI engines; `readSqlite`/`withSqliteSnapshot`; real/default vs injected snapshot; completed interleaving witness; whole result vs failure status. Affected/unverified: real CLI concurrency, both `withSqliteSnapshot` engine paths, production node selection, and proof that checkpoint plus `VACUUM` completed. Verified safe: the test-owned node backup contains all 4,001 rows when its callback completes successfully, and non-`ok` results remain conservative.
- Impact: the accepted B1 matrix still permits CLI, callback-entry, or production-wiring regressions to return a successful short snapshot while CI stays green. Task 2_1's plan specifically names the concurrent CLI case, but no such test exists in the diff.
- SuggestedFix: Drive the real production node snapshot through both entry contracts and add the planned forced-CLI test against a sufficiently large live store while a second connection checkpoints and vacuums. Set the interleaving witness only after those operations complete, then require either the whole result or a snapshot failure status.
- Status: persists
- Triage: accepted in round 1; remediation covers only part of the invariant inventory

### W1 — persists from round 1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-data-security` (corroborated by `asm-review-logic` and chair)
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/sqlite.ts:294-303`
- Title: CLI destination-open failures still map to source `db-unreachable`
- Evidence: `cliSnapshot` still wraps every `isOpenClass(err)` failure in `SnapshotOpenError` without proving the source opened and read successfully. `VACUUM INTO` uses the same CANTOPEN/READONLY messages for destination failures; round 1's targeted CLI probe demonstrated this directly. The new destination-failure test forces `hasNodeSqlite: true`, so it covers only the node path and remains green with the CLI defect unchanged.
- Impact: on CLI-fallback hosts, a private temp-directory or destination-filesystem failure is still blamed on the user's live store, preserving D2's status-contract violation and potentially changing Codex fallback selection.
- SuggestedFix: Establish a source-only CLI open/read step before `VACUUM INTO`, or otherwise separate destination creation/open errors from source refusal, and add a forced-CLI destination-failure test expecting `query-error`. Prefer a source read that touches the database/schema rather than a constant-only expression.
- Status: persists
- Triage: accepted in round 1; node boundary fixed, CLI boundary unchanged

### W2 — persists from round 1

- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-performance` (corroborated by chair)
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/sqlite.ts:427,460`
- Title: Every bounded read still materializes the whole uncapped store
- Evidence: The remediation adds a per-call deadline but no reuse, coalescing, or per-store-state cap. The supplied measurement establishes the evidence delta: a 522 MB store takes about 951 ms to back up versus 5 ms for an APFS clone, approximately 190x, and the known 1.4 GB store projects to about 2.5 seconds for every list, detail, lookup, or identity action. Concurrent callers still create N full backups of the same store state.
- Impact: the implementation remains correct but imposes a universal O(database pages × concurrent calls) latency, I/O, and temp-space regression on primary-platform flows. The 30-second deadline bounds one call's duration; it does not bound duplicate copies or total per-store work.
- SuggestedFix: Do not add ad hoc caching in this verification loop. Extract snapshot freshness/reuse into its own Asimov change owning the DB/WAL stamp key, in-flight producer sharing, lifetime, invalidation, cleanup, and failure semantics. Review that owner independently to APPROVE, then return here to review only its integration seam.
- Status: persists
- Triage: accepted in round 1; not risk-accepted and still gating

### W3 — new inside the remediation cone

- ID: W3
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-logic` (corroborated by chair)
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/sqlite.test.ts:578-594`
- Title: The deadline test cannot detect removal of the production completion bound
- Evidence: The test replaces `snapshot` with a function that immediately throws the expected error text. It never invokes `defaultSnapshot`, observes a production progress callback, advances a clock past `SNAPSHOT_TIMEOUT_MS`, or depends on `SNAPSHOT_PAGES_PER_STEP`. Deleting the production deadline and progress options leaves this test green.
- Impact: B2 is fixed in current production code, but its regression guard does not protect that fix. The original indefinitely pending backup can be restored without any focused test failure, contrary to task 2_1's accepted “starved one fails on a deadline” outcome.
- SuggestedFix: Exercise the real default snapshot with a database larger than one step and a controlled `Date.now` sequence that crosses the deadline in its actual progress callback. Assert `query-error`, source closure, and temp cleanup; mutation-check removal of the production progress/deadline block.
- Status: new
- Triage: pending

## Prior finding disposition

- B1: persists; node injected/readSqlite coverage added, remaining inventory still open.
- B2: fixed in production. Node v24.7.0 finalizes and rejects when progress throws, including BUSY/LOCKED reschedules. W3 records the non-discriminating test separately.
- W1: persists for CLI; node stable destination-failure attribution is fixed.
- W2: persists and remains gating; acknowledgement is not a risk waiver.
- S1: fixed.

## Inline support review

- Test edits are additive; no `.only`, `.skip`, disabled assertion, or unawaited asynchronous operation was introduced.
- The new race and deadline tests do not fully test the production/engine/entry boundaries their names and task plan claim; those gaps are B1 and W3.
- The source/destination test is valid for node but does not force CLI, which is part of W1.

## Routing

- B1, W1, and W3 are in-contract remediation and may be fixed without widening scope.
- W2 correctly routes to planning because reuse introduces a new snapshot-freshness/lifetime invariant owner. That owner must be a separate change, reviewed to APPROVE independently. Implementing it inside this change's next verification diff would trip the scope lock and supersede this cycle.
- This change must not archive while W2 remains present. After the separate reuse owner is approved and integrated, the current change's next user-initiated review is cycle 1 round 3 verification over the remaining fixes and the integration seam.

## Accepted risk

None.

## Audit backlog

None.
