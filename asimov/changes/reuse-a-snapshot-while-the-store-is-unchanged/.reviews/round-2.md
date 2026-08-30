# Asimov Review Round 2

- Date: 2026-08-30
- Cycle: 2
- Round: 2
- Mode: discovery
- Requested mode: fastlane
- Scope: commit range `4e401984..2ef1fdbde07540eeb0a2bbf34801f1afd9a825e9`
- Head: `2ef1fdbde07540eeb0a2bbf34801f1afd9a825e9`
- Tree: dirty outside the explicit range at review start; current Asimov analytics/active-state updates, `skills-lock.json`, and unrelated audit/research documents were excluded from the review scope
- Reviewable lines: 2,100, including 1,698 lines of Asimov analytics/build metadata; 724 added test lines reviewed inline
- Size note: Large change — accuracy may decrease
- Agents spawned:
  - `asm-review-logic` — snapshot generation, async state, flights, leases, disposal — `gpt-5.6-sol[1M]`
  - `asm-review-data-security` — stale-answer safety, sensitive temp storage, cleanup — `gpt-5.6-terra[1M]`
  - `asm-review-performance` — retained count/bytes, LRU, production growth axes — `sonnet[1M]`
  - `asm-review-contracts` — D1-D5, entry-point statuses, process lifecycle — `gpt-5.6-terra[1M]`
  - `asm-review-reuse` — stamp/cache/disposable reuse and module cohesion — `gpt-5.6-luna[1M]`
  - `asm-finder` — caller, consumer, status, shutdown, and reuse inventory — support search
- Agents skipped:
  - `asm-review-frontend` — no frontend, rendering, event, or client-state changes
- Verification evidence: `bun run asm change verify-status reuse-a-snapshot-while-the-store-is-unchanged` records tasks 1_1 through 2_3 at exit 0. The caller brief and workflow record type check clean, 5,427 unit tests passing, I10 passing, and Biome `src` at its 4/14/3 baseline. Review did not rerun project verification.
- Targeted evidence: an isolated inline probe held the initial store-stamp await open, let `dispose()` resolve, then released the stamp; the pre-existing borrow succeeded afterwards and its snapshot file existed after disposal. A second probe tested concurrent capacity admission and retained the configured `maxEntries: 1`, refuting that suspected race. No scratch file was created.
- Verdict: BLOCK
- Counts: 2 BLOCK, 1 WARN, 0 SUGGEST
- Split over gating blockers: 2 feature / 0 machinery

## Risk map and full-flow trace

- Top-risk freshness flow: Codex/OpenCode point lookup and Cursor IDE lookup/identity → `readSqlite` or `withSqliteSnapshot` → presence proof → pool stamp → retained hit, generation-gated flight join, or fresh engine snapshot → query → status translation. A successful stale zero-row answer becomes `absent` in the point readers and can retire a live preview.
- Hot path: a retained entry and a joinable flight both trust one stamp returned for `.db` and `-wal`. The direct flight-generation comparison added for round-1 B1 is present, but an incomplete stamp can still falsely match (B4).
- Cold path: Node Online Backup API or CLI `VACUUM INTO` produces one atomic temp database. Before/after source stamps decide retention; count and byte admission evict LRU retained entries; oversized entries are one-shot leases.
- Failure/status path: snapshot and query failures still map to `db-unreachable` or `query-error`, not `ok` with zero rows. Codex, OpenCode, and Cursor IDE map only successful empty point queries to `absent`.
- Capacity path: Cursor CLI candidates are processed sequentially in the full-list loop. Retained count and retained bytes are capped, borrowed victims are deleted on last release, oversized entries do not evict useful entries, and idle eviction identity-checks its captured binding. No surviving B2 finding remains.
- Lifecycle path: direct calls after disposal are refused, the current joinable flights and outstanding leases are awaited, post-close retention is guarded, and `liveEntries` is swept. The barrier still omits borrows parked before flight registration and flights displaced from the per-store joinable map (B3).
- Cleanup path: every release/eviction/disposal funnels through `destroy`, but deletion failure is suppressed after ownership is dropped (W3).
- Reuse path: the change correctly reuses `stampStoreFiles`/`sameStamps`; no existing repository component owns this exact snapshot-file/refcount/LRU lifecycle.

## Cycle-1 finding verification

- B1 — fixed at the direct flight boundary: flights carry the producer stamp and matching callers alone join. B4 is a different mechanism: the stamp provider itself can return an incomplete proof.
- B2 — fixed for the accepted retained-capacity contract: entry and byte budgets, LRU admission, leased eviction, and oversized one-shot behavior are present. The specialist claim that a Cursor full list starts every per-chat production concurrently was rejected because that loop is sequential.
- B3 — persists from round 1: disposal now drains the states it can see, but not every admitted borrow or active production is represented in those states.
- W1 — fixed: idle eviction checks `this.retained.get(dbPath) === entry` before deleting the binding.
- W2 — fixed: `withSqliteSnapshot` now distinguishes callback lease lifetime from retained file lifetime and no longer promises sidecar copying or deletion before return.

## Findings

### B3

- ID: B3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic` (corroborated by `asm-review-contracts`, `asm-review-data-security`, and chair)
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/snapshotPool.ts:119-161,302-316`
- Title: Dispose still omits admitted work that is not currently represented by the joinable-flight map
- Evidence: `borrow()` checks `disposed` only at lines 120-122, then awaits the initial stamp at line 124. A caller can pass the check, park in that await, and remain absent from `inFlight`, `liveEntries`, and `outstandingLeases`; `dispose()` therefore sees nothing at lines 306-315 and resolves. When the stamp resumes, the caller reaches lines 150-161, starts production, and receives a lease. The targeted probe reproduced a successful post-dispose borrow whose snapshot file existed after `dispose()` had resolved. A second affected boundary is the `MAX_JOIN_WAITS` fallback: after two mismatched waits, lines 150-151 replace a still-active per-store flight with the caller's own flight. The displaced producer remains active, but disposal awaits only the flights still reachable from `inFlight`; the identity-checked finalizer deliberately leaves the displaced flight unrepresented.
- Invariant: every borrow admitted before shutdown and every production it starts must remain lifecycle-tracked until it rejects, settles, and releases its final lease. Boundary inventory searched: initial stamp, retained hit, matching flight join, mismatched-flight wait, max-wait fallback, mkdtemp/production, joinable-flight cleanup, lease creation/release, live-entry sweep, and extension deactivation. Affected: initial-stamp admission and displaced active flights. Verified safe: a call beginning after `disposed` is set; a mismatched waiter resuming before its wait bound; flights still present in the map; leases already counted before disposal checks quiescence.
- Impact: extension deactivation can resolve while sensitive SQLite snapshots are created or remain in use outside the barrier. A hidden producer may also have its directory swept while `take()` is still writing it. This violates D3a and the accepted shutdown scenario; the inventory has expanded again after a dispose-specific remediation, so the lifecycle registry rather than another single await site needs correction.
- SuggestedFix: register borrow attempts before their first await and keep every active flight in a separate identity-based lifecycle set until settlement. The per-store map may select the currently joinable flight, but replacing that binding must not hide the previous producer. Re-check closed state before leasing or starting production, and have `dispose()` drain the borrow/flight registry to quiescence before sweeping entries.
- Status: persists from round 1
- Triage: pending

### B4

- ID: B4
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/snapshotPool.ts:124-127`
- Title: A failed WAL stat can be mistaken for an unchanged WAL-free store
- Evidence: the changed hot path accepts a stamp whenever the database key is present and `sameStamps` matches. Its shipped provider, `storeStamp.ts:15-25`, catches every `fs.stat` error and omits the path, although its comment describes only a missing file. Start with a retained WAL-free stamp `{db: S0}`. After a committed WAL-only write, if the database stat succeeds unchanged but the `-wal` stat fails with a non-absence error, the provider again returns `{db: S0}`; `stampable` is true and `sameStamps` is true, so lines 125-127 serve the pre-write snapshot. The accepted task explicitly required any unreadable stamp to force a fresh snapshot, but the test covers only an entirely empty stamp, not a readable database plus an unreadable WAL.
- Invariant: reuse and flight joining require a complete, trustworthy generation proof; a failed observation of any durability-bearing file must fail closed. Boundary inventory searched: database present/absent/error, WAL present/absent/error, retained hot hit, matching flight join, cold production before/after stamps, Node and CLI readers, and successful-empty point consumers. Affected: retained hit and flight join when the WAL observation fails but the database observation matches. Verified safe: database observation failure produces an unstampable empty record; a normally observed WAL appearance/disappearance or mtime/size change mismatches; cold snapshot failures retain conservative statuses.
- Impact: Codex, OpenCode, and Cursor IDE point lookups can run successfully against the older snapshot, return zero rows, and classify a live session as `absent`. That is the security/privacy failure D1 exists to prevent.
- SuggestedFix: give the pool a strict stamp result that distinguishes `ENOENT` from every other stat failure. Missing WAL may remain a valid absent member; any other failure makes the whole generation unstampable and forces a fresh snapshot. Add a test with a stable database stamp and a WAL stat failure after a retained WAL-free snapshot, asserting a second production and no stale rows.
- Status: new
- Triage: pending

### W3

- ID: W3
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-data-security` (corroborated by `asm-review-logic`; severity adjudicated by chair)
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/snapshotPool.ts:320-322`
- Title: Cleanup failure silently abandons a sensitive snapshot outside pool ownership
- Evidence: `destroy()` removes the entry from `liveEntries` before invoking `rmrf`, then suppresses every deletion failure. The same path serves production failure, eviction, lease release, and disposal. Once `rmrf` fails, later disposal cannot retry the directory and the extension's `disposeSnapshotPool()` error handling cannot observe the failure. The data-security specialist proposed BLOCK; this is adjudicated WARN because it requires an external filesystem cleanup failure and the parent implementation already treated temp cleanup as best-effort, while the new owner-tracking loss remains a should-fix lifecycle defect.
- Impact: a temp database containing third-party agent data may remain on disk while release or shutdown reports success, with no retry owner.
- SuggestedFix: remove an entry from `liveEntries` only after successful deletion. Retain failed deletions in a retryable cleanup set and aggregate/propagate failures from `dispose()` so extension shutdown can report that files remain.
- Status: new
- Triage: pending

## Inline support review

- The changed production behavior has focused pool tests and SQLite integration tests; no `.only`, `.skip`, unawaited lease release, secret-bearing fixture, or destructive seed was introduced.
- The new tests discriminate direct generation-gated joins, LRU/count/byte admission, oversized one-shot behavior, borrowed eviction, idle-binding identity, current-flight disposal, outstanding leases, direct post-dispose calls, and one mismatched waiter.
- Missing discriminating cases correspond to findings: a borrow parked in its initial stamp and a producer displaced after `MAX_JOIN_WAITS` (B3), plus a database stamp that succeeds while the WAL stat fails (B4).
- The analytics email is the same identity already present in reviewed Git metadata and was not re-reported as a new privacy finding.

## Rejected specialist candidates

### R1

- ID: R1
- Severity: BLOCK (proposed)
- Confidence: HIGH (proposed)
- Priority: P1 (proposed)
- Agent: `asm-review-performance`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/snapshotPool.ts:119-211`
- Title: Aggregate live disk is unbounded across concurrent distinct-store productions
- Evidence: the specialist asserted that a Cursor list starts one concurrent production per chat. The actual full-list path in `cursorReader.ts:407-418` uses a sequential `for` loop with an awaited `readCandidate`. The accepted D3/task contract caps retained entries and bytes and deliberately permits an oversized one-shot lease; no concrete behaviorally reachable unbounded concurrent-distinct-store caller path was supplied. The separate same-store hidden-flight defect survives as B3 because it has direct code evidence.
- Impact: not established at BLOCK confidence for the accepted contract.
- SuggestedFix: none required from this candidate; retain B3's active-flight tracking fix.
- Status: rejected
- Triage: chair refuted the concrete caller premise and contract scope

### R2

- ID: R2
- Severity: WARN (proposed)
- Confidence: MEDIUM
- Priority: P3
- Agent: `asm-review-reuse`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/sqlite.ts:491-505,521-532`
- Title: Extract the repeated borrow/file/release sequence
- Evidence: two local entry points repeat the short lease sequence, but their callback shape and result/error contracts differ and no current behavioral divergence was demonstrated. Extraction is a maintainability preference rather than a defect under the review checklist.
- Impact: speculative future drift only.
- SuggestedFix: none required; a private helper remains optional if the integration grows.
- Status: rejected
- Triage: no concrete defect

## Accepted risk

None.

## Audit backlog

None.

---

## Author triage — cycle 2 / round 2

**[B3] Dispose still omits work outside the joinable-flight map** — Status: accepted
Triage: correct on both halves, and the second half is one I introduced while fixing round-1 B3.
`borrow` checks `disposed` before awaiting its first stamp, so a disposal that resolves during that
await is followed by a fresh production; and after `MAX_JOIN_WAITS` a caller replaces the per-store
binding, leaving the displaced producer invisible to the map `dispose` snapshots. Both mean the
barrier drains what it can see rather than what exists. The fix — a registry of every admitted
operation, drained to quiescence — is a change to D3a's mechanism, not a patch inside it.

**[B4] A failed WAL stat can look like an unchanged WAL-free store** — Status: accepted
Triage: correct. `stampStoreFiles` omits a path on ANY `fs.stat` rejection, and `stampable` only
proves the database key is present, so an EACCES/EIO on `-wal` is indistinguishable from a store that
genuinely has none.

**[B5] The stamp is not a coherent read of the store** — Status: accepted — RAISED BY A SPECIALIST, ABSENT FROM THIS REPORT
Triage: the data-security specialist sent this to me directly, at BLOCK/HIGH, and it did not survive
into the chair's report; B4 occupies adjacent ground but is a strictly narrower bug with a fix that
does not close this one. Recording it here so it is triaged rather than lost.
`stampStoreFiles` stats `.db` then `-wal` sequentially (`storeStamp.ts:15-25`). A retained `{db:S0}`
with no WAL can be matched by a read that observes `.db` before a checkpoint and `-wal` after that
checkpoint's close deleted it: equal stamps spanning a completed write, i.e. a false `absent`.
This invalidates D1's PROOF, not merely its implementation — "an equal stamp means no write landed"
holds only if both files are observed at one instant, and they are not. Classifying stat errors (B4)
leaves it untouched.
Fix: two complete stamps in a fixed `db,wal,db,wal` order, reused only when equal. That is sufficient,
not merely better: for the bad case both `.db` reads must precede the checkpoint and both `-wal` reads
must follow the deletion, yet the second `.db` read falls after the first `-wal` read and would
observe the checkpointed `.db`. The interleaving is self-contradictory.

**[W3] Cleanup failure abandons the snapshot outside pool ownership** — Status: accepted
Triage: correct. `destroy` removes the entry from `liveEntries` before `rmrf` and swallows the
failure, so a delete that fails leaves a real file with no owner while release and disposal both
report success. Untrack only after a successful delete; keep failures for retry; surface them at
disposal rather than discarding them.

**[W4] One store-path set, authored three times** — Status: accepted — RAISED BY A SPECIALIST, ABSENT FROM THIS REPORT
Triage: verified. `[dbPath, `${dbPath}-wal`]` is built at `snapshotPool.ts:72`, `codexReader.ts:513`
and `opencodeReader.ts:241`. Above SUGGEST on consequence rather than size: the pool's reuse gate and
the persisted list cache answer the same freshness question from separately-authored path sets, and
both decide whether a session reads as present. Folds into B5 — one helper should own the path set AND
the coherent read for all three callers.

**[W5] The borrow/lease lifecycle is written twice** — Status: accepted — RAISED BY A SPECIALIST, ABSENT FROM THIS REPORT
Triage: verified at `sqlite.ts:491-505` and `:521-535` — identical scaffolding differing only in each
wrapper's result shape. Context, not a rebuttal: both entry points already duplicated the
mkdtemp/takeSnapshot/rmrf lifecycle before this change, so the diff swapped two copies of one
lifecycle for two copies of another rather than splitting something unified.

### Disposition — thrash stop reached, handback taken

Two independent triggers: B3 is the same invariant surviving two fix attempts, and B5 requires a
changed D1 while B3 requires a changed D3a. The remediation boundary and the thrash stop both point
at the same exit, so this cycle closes as superseded and the change hands back to `asimov-plan`.
Option 2 (risk acceptance) is not available to me — no human has been asked, and a false `absent` that
deletes a live row is not a residual I would put forward for acceptance anyway. Option 3 (a bounded
extension round) would be a third attempt at a lifecycle whose design is what keeps failing.

No finding was rejected. Three of the six were carried in from specialists rather than from the
report; the report's own B3/B4/W3 are accepted as written.
