# Asimov Review Round 3

- Date: 2026-08-30
- Cycle: 1
- Round: 3
- Mode: verification
- Requested mode: fastlane
- Scope: commit range `92e078e4860d2575b529abc8b4348114dd301b91..9d3b00efdbca8155d88dbea906072563427afb39`
- Head: `9d3b00efdbca8155d88dbea906072563427afb39`
- Parent / prior reviewed Head: `92e078e4860d2575b529abc8b4348114dd301b91`
- Tree: dirty outside the explicit range; current analytics, `skills-lock.json`, and unrelated audit/research documents were excluded
- Scope lock: passed — only B1/W1/W3 remediation, additive/replacement tests, and review/build metadata changed; snapshot reuse remains unimplemented
- Reviewable lines: 1,222, including generated Asimov analytics/build metadata; 131 added / 52 removed test lines reviewed inline
- Size note: Large change — accuracy may decrease
- Agents spawned:
  - `asm-review-logic` — production race witness and deadline guard — `gpt-5.6-sol[1M]`
  - `asm-review-data-security` — final CLI source/destination attribution — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — optional timeout seam and accepted task contract — `sonnet[1M]`
- Agents skipped:
  - `asm-review-performance` — W2 is unchanged and its separate-owner route was already adjudicated
  - `asm-review-frontend` — no frontend cone
  - `asm-review-reuse` — no reuse implementation is present in this diff
- Verification evidence: `bun run asm change verify-status snapshot-a-live-store-atomically` records task 2_2 at exit 0 and assertions +8. The coordinator brief reports type check clean, 5,399 unit tests passing, I10 passing, and Biome `src` at its 4/14/3 baseline. Review did not rerun project verification.
- Verdict: BLOCK
- Counts: 1 BLOCK, 1 WARN, 1 SUGGEST
- Cycle cap: reached — cycle 1 has used discovery round 1 and verification rounds 2 and 3. No round 4 belongs in this cycle.

## Verification scope and adjudication

- B1: verify temporal overlap, not merely eventual completion, across the production in-process, callback-entry, and CLI race tests.
- W1: verify the CLI distinguishes a readable source plus failed destination from genuine source refusal.
- W3: verify the test reaches the shipped node backup progress/deadline path and discriminates its removal.
- W2: carry forward unchanged and confirm the separate snapshot-freshness owner remains the correct route.

The `whole OR failure` assertion is the correct contract: SQLite may either complete a coherent snapshot or fail closed under churn. Requiring `ok` would strengthen the test beyond the accepted requirement and invite timing-dependent failures. The missing evidence is not that disjunction; it is the absence of a signal proving churn occurred after snapshot work began and before it settled.

The node and CLI post-failure source proofs are conservative rather than causal because source state can change between the original error and the probe. That does not reopen W1: both outcomes remain non-`ok`, a pre-operation probe has the inverse time-of-check gap and would add cost to every healthy CLI snapshot, and a targeted WAL/missing-SHM probe confirmed `sqlite3 -readonly <db> "SELECT 1"` fails for the source-refusal case this classifier owns.

`SqliteDeps.snapshotTimeoutMs` is acceptable on this explicitly injectable dependency surface. It is optional, production callers omit it, and the shipped default remains 30 seconds for both engines. No public caller-controlled timeout contract was introduced.

## Findings

### B1 — persists from rounds 1 and 2

- ID: B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic` (corroborated by chair)
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/sqlite.test.ts:589-656`
- Title: The race witness still does not prove snapshot overlap
- Evidence: `raceAgainst` calls `start()`, waits one `setImmediate`, completes checkpoint plus `VACUUM`, and then awaits both promises. `raced = true` proves the churn operations completed before the helper returned, but establishes neither side of the required ordering: the snapshot may still be suspended in engine probing, presence checking, or `mkdtemp` when churn runs, or may already have completed before the `setImmediate`. All three tests can therefore pass when snapshot and churn are serialized rather than overlapping. The production paths are now used and the witness is set after churn completes, fixing round 2's wiring objections, but no `snapshotStarted < churnCompleted < snapshotSettled` evidence exists.
- Invariant: every successful snapshot used to prove absence must correspond to one source state and preserve pre-snapshot rows across concurrent checkpoint/VACUUM activity. Boundary inventory searched: production node/CLI mechanisms; `readSqlite`/`withSqliteSnapshot`; start/settle ordering; completed churn witness; whole/failure status. Affected/unverified: actual temporal overlap in all three race tests. Verified safe: the shipped mechanisms are invoked; checkpoint and `VACUUM` complete; non-race node and CLI reads succeed; failures remain non-`ok`; the whole-or-failure assertion matches the accepted contract.
- Impact: a non-atomic implementation that snapshots only after churn, or completes before churn, can return all 20,001 rows and leave the suite green. The exact concurrency invariant that motivated the change therefore remains without a discriminating automated guard after two verification patches.
- SuggestedFix: Synchronize on the shipped snapshot lifecycle. Do not begin churn until the snapshot operation has positively entered and remains unsettled; record ordering and require `snapshotStarted < churnCompleted < snapshotSettled`. For node, a narrow progress-observer/barrier test seam can run the synchronous checkpoint/VACUUM between real backup steps without replacing the backup. For CLI, wrap the existing injectable `exec` to signal after the `VACUUM INTO` child is spawned and before its promise settles, then run churn. Mutation-check against a serialized/non-atomic snapshot implementation, not only removal of the function.
- Status: persists
- Triage: accepted in rounds 1 and 2; two remediation tests still fail to witness the invariant

### W2 — persists unchanged from rounds 1 and 2

- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-performance` (carried forward; corroborated by chair)
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/sqlite.ts:287-358,461-493`
- Title: Every bounded read still materializes the whole uncapped store
- Evidence: This diff deliberately does not add reuse or coalescing. The measured cost remains approximately 951 ms for 522 MB versus 5 ms for an APFS clone, about 190x, projecting to roughly 2.5 seconds per snapshot for the known 1.4 GB store. Concurrent list, detail, lookup, and identity requests still independently materialize the same live pages.
- Impact: Correctness is restored at the cost of universal O(database pages × concurrent calls) latency, I/O, and temp-space work. The 30-second deadline bounds individual duration but not duplicate work or total per-store load.
- SuggestedFix: Extract snapshot freshness/reuse into its own Asimov change owning DB/WAL stamp keys, in-flight sharing, lifetime, invalidation, failure, and cleanup. Review that invariant owner independently before this change archives.
- Status: persists
- Triage: accepted in round 1; not risk-accepted and still archive-gating

### S2 — new inside the test-remediation cone

- ID: S2
- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P4
- Agent: `asm-review-logic` (adjudicated down by chair)
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/sqlite.test.ts:658-667`
- Title: The zero-budget deadline test depends on millisecond clock advancement
- Evidence: Production aborts on `Date.now() > deadline`; with a zero budget, the initial deadline and first progress callback can theoretically observe the same millisecond. The large fixture and worker scheduling make advancement likely, and mutation checks show the test now reaches the production callback, so round-2 W3 is fixed; the remaining issue is deterministic test timing, not missing production coverage.
- Impact: The focused test can be timing-sensitive on an unusually fast or coarse-clock environment.
- SuggestedFix: Use a deterministically expired test budget, such as `-1`, or inject/mock the clock so the callback is guaranteed to observe a time after the deadline.
- Status: new
- Triage: pending

## Prior finding disposition

- B1: persists; production mechanisms and all requested entry paths are exercised, but temporal overlap is still unproven.
- B2: fixed since round 2.
- W1: fixed. Both node and forced-CLI destination failures remain `query-error`; genuine stable source refusal maps `db-unreachable`.
- W2: persists and remains archive-gating; acknowledgement is not a risk waiver.
- S1: fixed since round 2.
- W3: fixed. The test now reaches and mutation-discriminates the production progress/deadline block; S2 records only residual clock determinism.

## Inline support review

- The replacement tests now use the shipped snapshot implementations and cover `readSqlite`, `withSqliteSnapshot`, and real CLI execution.
- No `.only`, `.skip`, disabled assertion, unawaited operation, or weakened production-status assertion was introduced.
- The race tests' remaining defect is temporal evidence, not the accepted whole-or-failure outcome.

## Route after cycle cap

- Cycle 1 is exhausted. Do not run a fourth patch-verification round.
- B1's next fix needs an explicit in-flight lifecycle witness. The next user-initiated review of this change starts cycle 2 round 1 in discovery mode and rechecks the full invariant plus its integration cone.
- W2 still correctly routes to a separate `asimov-plan` change because reuse mints the snapshot-freshness/lifetime invariant owner. Review that change independently to APPROVE; implementing the owner directly inside this change would violate the scope boundary.
- This change must not archive while B1 or W2 remains open.

## Accepted risk

None.

## Audit backlog

None.

## Author triage

### B1 — accepted, fixed in 2_3
Right for the third time on this finding, and the objection was precise: my witness proved the churn COMPLETED, which a serialized implementation that never overlapped would also satisfy. Replaced with three ordered timestamps — snapshot started, churn completed, snapshot settled. The churn now runs inside a real backup step through a narrow optional progress observer that production omits, and for the CLI between process spawn and promise settlement, since a subprocess cannot be stepped. Mutation-checked: removing the production progress report fails the two in-process race tests. The `whole OR failure` assertion was kept, per your ruling that requiring `ok` would exceed the accepted contract.

### S2 — accepted, fixed in 2_3
Budget is `-1` rather than `0`, so `Date.now() > deadline` cannot be satisfied-by-tie inside one millisecond.

### W2 — accepted, routed, NOT fixed here
Agreed and unchanged: reuse owns freshness, invalidation, in-flight sharing, lifetime and cleanup, so it is a separate change reviewed on its own. Scaffolded as `reuse-a-snapshot-while-the-store-is-unchanged`, which this change depends on. This change does not archive while it is open — recorded in workflow.md, not just here.

### Cycle cap
Accepted. No round 4 in cycle 1. The next review of this change is cycle 2, round 1, discovery mode, and it should cover 2_3 plus the integration seam with the reuse change once that lands.

