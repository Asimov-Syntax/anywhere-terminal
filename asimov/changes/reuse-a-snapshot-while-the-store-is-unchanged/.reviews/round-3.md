# Asimov Review Round 3

- Date: 2026-08-30
- Cycle: 3
- Round: 3
- Mode: discovery
- Requested mode: fastlane
- Scope: commit range `4e401984..76d6e9aa6425e795c285620c36958df2703a1a02`
- Head: `76d6e9aa6425e795c285620c36958df2703a1a02`
- Tree: dirty outside the explicit range at review start; current Asimov analytics/active-state updates, `skills-lock.json`, and unrelated audit/research documents were excluded from review scope
- Reviewable lines: 2,366, including 1,793 lines of generated Asimov analytics/build metadata; 940 changed test lines reviewed inline
- Size note: Large change — accuracy may decrease
- Agents spawned:
  - `asm-review-logic` — coherent generation, flights, leases, disposal, concurrent capacity — `gpt-5.6-sol[1M]`
  - `asm-review-data-security` — stale-answer boundary, strict stat failures, sensitive temp cleanup — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — D1-D5, entry-point statuses, generation and lifecycle contracts — `sonnet[1M]`
  - `asm-review-performance` — retained/live growth axes, LRU, hot-path bounds — `gpt-5.6-terra[1M]`
  - `asm-review-reuse` — store-path and lease-lifecycle unification, pool cohesion — `gpt-5.6-luna[1M]`
  - `asm-finder` — caller, consumer, status, concurrency, and shutdown flow inventory — support search
- Agents skipped:
  - `asm-review-frontend` — no frontend, rendering, event, or client-state changes
- Verification evidence: `bun run asm change verify-status reuse-a-snapshot-while-the-store-is-unchanged` records tasks 1_1 through 3_4 at exit 0. The caller brief records type check clean, 5,438 unit tests passing, I10 passing, and Biome `src` at its 4/14/3 baseline. Review did not rerun project verification.
- Targeted evidence: an isolated inline Bun probe synchronized nine distinct-store admissions at the `sizeOf` await using the production `SnapshotPool` and its default `maxEntries: 8`; all nine were retained (`retainedCount: 9`). A second one-entry probe retained two. Both probes created temp directories and removed them in the same command.
- Verdict: BLOCK
- Counts: 1 BLOCK, 1 WARN, 0 SUGGEST
- Split over gating blockers: 1 feature / 0 machinery

## Risk map and full-flow trace

- Top-risk freshness flow: Codex/OpenCode/Cursor point lookup or detail → `readSqlite` / `withSqliteSnapshot` → presence proof → coherent generation → retained hit, same-generation flight join, or fresh engine snapshot → query → status translation. Successful stale emptiness becomes `absent` in point readers and can retire a live preview.
- Generation proof: `readStoreGeneration` performs `db,wal,db,wal`, treats only ENOENT/ENOTDIR as absence, requires both passes to agree, and requires the database stamp. Without an ABA of a component value, the database-stability interval and WAL-stability interval overlap between the first WAL observation and second database observation, so the tuple existed at a real instant. The B5 checkpoint/delete interleaving is therefore closed.
- Hot path: a retained hit pays four ordered stats and a query against the retained engine snapshot; the measured 164 MB path improves from about 200 ms production to about 1 ms reuse. Unusable generations never hit or join.
- Cold path: Node Online Backup API or CLI `VACUUM INTO` takes one atomic snapshot. Before/after usable generations must agree for retention; otherwise the snapshot is one-shot and deleted at last release.
- Concurrency path: `VaultService.readAll` starts agent readers with `Promise.allSettled`, while public detail and lookup calls are independently callable. The process-wide pool therefore admits distinct-store productions concurrently. Per-store flights do not serialize the global count/byte transaction, and the accepted hard capacity invariant fails under that reachable concurrency (B6).
- Lifecycle path: every borrow is admitted before its first await, disposal closes the pool and waits admitted operations plus leases, and release wakes disposal only after deletion finishes. The round-2 hidden-work boundary is closed.
- Cleanup path: entries remain in `liveEntries` until deletion succeeds; disposal retries and reports failures. Successful deletion is owned correctly. Repeated pre-disposal deletion failures, however, accumulate outside retained accounting until shutdown (W6).
- Reuse path: one `storeFilePaths` helper now defines db+WAL for generation and both persisted-cache readers; one `withPooledSnapshot` helper owns borrow/use/release for both SQLite entry points. No repository component already owns the snapshot/refcount/LRU lifecycle.

## Cycle-2 finding verification

- B3 — fixed: every borrow increments `admitted` before its first await; disposal drains admitted operations and outstanding leases rather than a joinable-flight map. Parked generation reads and displaced producers remain counted.
- B4 — fixed: `readOnce` delegates absence proof to `provesAbsence`; every other stat failure makes the generation unusable, disabling retained hits, joins, and retention.
- B5 — fixed for the reported mixed-time mechanism: two same-order passes establish an overlapping real-state interval, and the test seam invokes the same stat order and error path as production. See rejected candidate R3 for the adjudicated late-write argument.
- W3 — fixed for ownership/reporting: `destroy` removes an entry from `liveEntries` only after `rmrf` succeeds; disposal retries owned entries and rejects with their paths when deletion still fails. W6 is a different growth mechanism: failed deletions are not retried or budgeted during the remaining host lifetime.
- W4 — fixed: `storeFilePaths` is the single db+WAL path-set owner used by the pool, Codex cache, and OpenCode cache.
- W5 — fixed: both SQLite entry points use `withPooledSnapshot` while preserving their distinct result shapes and open-failure mappings.

## Findings

### B6

- ID: B6
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `chair` (corroborated by `asm-review-logic`)
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/snapshotPool.ts:198-215,244-264`
- Title: Concurrent admissions exceed the pool's hard count and byte budgets
- Evidence: `admit()` reads shared `retained`/`retainedBytes`, awaits `sizeOf` and potentially `discard`, then returns `true`; only afterwards does `produce()` insert the entry and add its bytes. Multiple distinct-store producers can therefore all evaluate capacity before any of them publishes its reservation. The targeted default-config probe synchronized nine `sizeOf` calls and observed `retainedCount: 9` with `DEFAULT_MAX_ENTRIES = 8`; a one-entry configuration retained two. A second reachable interleaving starts with a victim: producer B removes and awaits deletion of A, producer C admits and inserts while B is suspended, then B resumes and inserts without rechecking. `VaultService.readAll` dispatches agent readers concurrently, and detail/lookup calls add independently reachable distinct-store admissions; per-store `inFlight` does not serialize them.
- Invariant: retained snapshot count and retained bytes must never exceed their configured hard caps. Boundary inventory searched: initial empty admission, admission with a retained victim, count budget, byte budget, oversized and unknown-size one-shots, same-store flight joining, distinct-store production, cross-agent full-list dispatch, public detail/lookup calls, superseding replacement, idle eviction, failed deletion, and disposal. Affected: concurrent distinct-store admissions both with and without victim deletion. Verified safe: sequential admissions; oversized/unknown-size candidates; borrowed victim lifetime; per-store same-generation coalescing.
- Impact: the production pool can retain more than eight snapshots and more than 1 GiB, so disk grows with concurrent distinct-store completions rather than the structural cap D3 and task 2_2 promise. The existing capacity tests are sequential and do not exercise the race.
- SuggestedFix: serialize the complete global capacity transaction, including reservation/insertion, victim accounting, and any awaited deletion, or reserve count/bytes atomically before awaiting cleanup and revalidate/roll back before publishing. Add deterministic concurrent tests at both the count and byte limits, including a victim deletion held open while another candidate admits.
- Status: new
- Triage: pending

### W6

- ID: W6
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-performance`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/snapshotPool.ts:255-263,346-361`
- Title: Failed eviction deletions accumulate outside the runtime capacity budget until shutdown
- Evidence: eviction removes a victim from `retained` and subtracts its bytes before `discard()`. If `destroy()` cannot remove the directory, it correctly keeps ownership in `liveEntries`, but no later admission or idle sweep retries or budgets that unretained entry; only `dispose()` walks it again. Growth axis: distinct SQLite stores evicted during a long-lived extension host while deletion failures persist. Each failed eviction can leave another full-store snapshot on disk while retained count/bytes still appear within limits.
- Invariant: every owned live snapshot, including deletion failures, needs a structural disk bound or a runtime retry/backpressure path. Boundary inventory searched: release, supersede, capacity eviction, idle eviction, production failure, retained accounting, live ownership, periodic sweeper, later admissions, and disposal. Affected: pre-disposal failed deletions. Verified safe: successful deletion; ownership preservation; disposal retry and error reporting.
- Impact: repeated EBUSY/EIO-style cleanup failures can consume disk proportional to stores visited and snapshot size, including multi-GB stores, for the remainder of the host lifetime despite the stated pool budget.
- SuggestedFix: maintain a retryable failed-cleanup queue that later admissions/sweeps drain with bounded backoff, and include owned failed-deletion entries in a live-entry/live-byte budget that backpressures new retention or production when exhausted.
- Status: new
- Triage: pending

## Inline support review

- Changed production behavior has focused generation, pool, and SQLite integration tests; no `.only` or `.skip` was introduced.
- The B3/B4/B5/W3/W4/W5 remediation tests discriminate the reported regressions and use real filesystem observations where the claim requires them.
- The generation `stat` injection is a faithful minimum seam: both injected and default paths execute the same two `readOnce` calls, path order, equality rule, and `provesAbsence` classification. The injected callback only schedules a real mutation between real stats.
- Missing discriminating coverage corresponds to B6: capacity tests cover sequential admissions and one mid-eviction replacement, but not two or more candidates concurrently completing global admission.

## Rejected specialist candidates

### R3

- ID: R3
- Severity: BLOCK (proposed)
- Confidence: HIGH (proposed)
- Priority: P1 (proposed)
- Agent: `asm-review-logic`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/storeStamp.ts:92-99`
- Title: A commit after the second database stat allegedly validates a stale generation
- Evidence: the proposed interleaving reads database A, absent WAL, database A, then completes a commit/checkpoint/WAL deletion before the final WAL stat. Both passes return `{db:A}`. However, unlike B5, this tuple is not assembled from states that never coexisted: absent WAL and database A both held throughout the overlap between the first WAL stat and second database stat. The generation read can linearize in that interval, before the concurrent write. The accepted scenario requires a fresh snapshot when the write occurs between completed reads; it does not require a read already in progress to observe a write that completes after its coherent linearization point, and the underlying atomic engine snapshot has the same concurrent-read semantics.
- Impact: no contract violation or stale proof established. The explicitly inherited same-mtime/same-size ABA risk remains separate.
- SuggestedFix: none. A test for this late interval would correctly permit the pre-write generation; requiring completion-time freshness would be a new, stronger contract and invariant owner rather than a fix to B5.
- Status: rejected
- Triage: chair refuted the causal claim by identifying the real-state overlap and valid linearization point

## Accepted risk

None.

## Audit backlog

None.

---

## Author triage — cycle 3 / round 3

**[B6] Concurrent admissions exceed the hard count and byte budgets** — Status: accepted
Triage: correct, and reproducible by inspection. `admit` suspends twice inside what has to be one
decision — at `sizeOf`, and at each victim's `discard` — and its caller then awaits `admit` before
inserting. Every suspension is a point where another producer can pass the same capacity check against
the same pre-insert state. The reviewer's reachability is right too: `VaultService.readAll` dispatches
agent readers concurrently, so this is not confined to the sequential Cursor candidate loop.
The root cause is that the accounting is not a transaction, not that it lacks a lock. JavaScript runs
one turn at a time, so an accounting block containing NO await is atomic by construction: size the
snapshot before the block, mutate the map and the byte total inside it, and delete evicted victims
after it. That removes the interleaving rather than guarding it, and needs no mutex or rollback.

**[W6] Failed eviction deletions accumulate outside the runtime budget** — Status: accepted
Triage: correct, and it is the gap my own W3 fix opened. W3 made a failed deletion keep its owner,
which was right, but nothing retries it before shutdown and its bytes stop counting the moment it
leaves the retained map. Persistent failures therefore accumulate real disk that the budget cannot
see. Undeleted entries must count against a live budget and be retried on later admissions and sweeps
with bounded backoff.

**Confirmed fixed by this round**: B5 (the coherent double read, with the chair also rejecting a
specialist's attempt to defeat the proof), B3, B4, W3, W4, W5. The injectable `stat` seam was
examined and judged faithful to the production path.

### Premise audit (mandatory at a third cycle)

Shipped baseline re-verified: nothing in this change has shipped, and the parent
`snapshot-a-live-store-atomically` remains unarchived behind it.
Split across all three cycles, by what each finding was about:
- **Correctness core** (reuse must never answer a stale `absent`): B1, B4, B5. All fixed, all
  confirmed, each pinned by a mutation that reproduces the reported bug.
- **Capacity and lifetime machinery** (D3/D3a): B2, B3, W3, B6, W6. Five of the eight findings, and
  every finding still open.
This is the audit's actual result: the value of the change was correct two cycles ago; the machinery
around it is what keeps failing. So the question the audit demands is whether that machinery is
required by an evidenced state, and it is — B2's premise was verified in code (one `store.db` per
Cursor chat, thousands of them, individual stores over 1 GB), so an unbounded pool is not an option
and neither budget can simply be cut.
What CAN be cut is the machinery's complexity, and B6 shows how: the race exists only because
admission spans awaits. Making the accounting a synchronous transaction deletes the entire class of
concurrent-admission defect instead of adding a lock to it. That is a scope reduction in mechanism,
not in guarantee, and it is the fix I am taking.

### Disposition — mandatory handback taken

Third cycle, so no further fix loop is opened here regardless of how small the fixes look. The change
hands back to `asimov-plan`: D3 gains the transaction rule and the live-budget/retry rule, and the
work lands as new tasks under a re-earned Gate 2. Risk acceptance is not available to me — no human
has been asked — and an over-budget pool of multi-gigabyte snapshots is not a residual I would offer
for acceptance anyway.
