# Asimov Review Round 1

- Date: 2026-08-30
- Cycle: 1
- Round: 1
- Mode: discovery
- Requested mode: fastlane
- Scope: commit range `4e401984..13d0c1d42777482ae35bb0791f4b28e92a06a4d7`
- Head: `13d0c1d42777482ae35bb0791f4b28e92a06a4d7`
- Tree: dirty outside the explicit range; current Asimov analytics/active-state updates, `skills-lock.json`, and unrelated audit/research documents were excluded
- Reviewable lines: 1,752, including 1,480 lines of generated Asimov analytics/build metadata; 400 added test lines reviewed inline
- Size note: Large change — accuracy may decrease
- Agents spawned:
  - `asm-review-logic` — coalescing freshness, async state, leases, eviction, disposal — `opus[1M]`
  - `asm-review-data-security` — stale-answer safety, sensitive temp storage, shutdown cleanup — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — approved D1-D5, entry-point/status/lifecycle contracts — `sonnet[1M]`
  - `asm-review-performance` — retained count/bytes, hot-path deduplication, cleanup bounds — `gpt-5.6-terra[1M]`
  - `asm-review-reuse` — stamp/cache/in-flight/disposable reuse and cohesion — `gpt-5.6-luna[1M]`
  - `asm-finder` — caller, consumer, stamp, and shutdown flow inventory — support search
- Agents skipped:
  - `asm-review-frontend` — no frontend, rendering, event, or client-state changes
- Verification evidence: `bun run asm change verify-status reuse-a-snapshot-while-the-store-is-unchanged` records tasks 1_1 through 1_4 at exit 0. The caller brief records type check clean, 5,416 unit tests passing, I10 passing, and Biome `src` at its 4/14/3 baseline. Review did not rerun project verification.
- Targeted evidence: an isolated scratch probe confirmed that a caller whose stamp had advanced joined an older in-flight snapshot, and that a snapshot completing after `dispose()` remained on disk even after its lease released. The scratch file and temp data were removed in the same command.
- Verdict: REJECT
- Counts: 3 BLOCK, 2 WARN, 0 SUGGEST
- Split over gating blockers: 3 feature / 0 machinery

## Risk map and full-flow trace

- Top-risk freshness flow: Codex/OpenCode point lookup and Cursor IDE lookup/identity → `readSqlite` or `withSqliteSnapshot` → presence proof → pool stamp → retained hit or in-flight join or fresh engine snapshot → query → status translation. A successful stale zero-row answer becomes `absent` in OpenCode/Cursor and can remove a live vault preview.
- Cold paths: node Online Backup API or CLI `VACUUM INTO` produces one atomic temp database; before/after source stamps decide retention; callers receive a lease and release it in `finally`.
- Hot paths: retained entries compare current `.db`/`-wal` stamps before reuse. This boundary is sound for the accepted stamp model. The in-flight join bypasses that comparison against the producer's generation and is not sound (B1).
- Consumer inventory: list failures remain unreadable; point-lookup failures remain unknown except confirmed missing stores; no changed catch maps a snapshot throw to `ok`. The stale-join path instead returns a successful query against an older atomic snapshot, so downstream conservative status handling cannot detect it.
- Storage inventory: one retained entry per path, one in-flight promise per path, refcounted leases, idle sweep, and shutdown disposal. Cursor CLI owns one `store.db` per chat, so the pool's store axis is not “one per agent”; multiple large snapshots can be retained together without a byte or entry budget (B2).
- Lifecycle inventory: existing retained entries are removed or marked unretained by `dispose`, but active leases are not awaited, in-flight producers are not drained, and new/post-dispose retention is still permitted. Clean shutdown is therefore not a cleanup barrier (B3).
- Reuse inventory: the implementation correctly reuses the shipped `stampStoreFiles`/`sameStamps` freshness key. No existing repository helper fully owns this pool's snapshot-file/refcount lifecycle; the reuse specialist found no separate duplication finding.

## Findings

### B1

- ID: B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic` (corroborated by `asm-review-data-security` and chair)
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/snapshotPool.ts:89-91`
- Title: A later reader can join a snapshot from before its observed write
- Evidence: every borrower stamps the store at line 83, but when `inFlight` exists lines 89-91 ignore that stamp and lease the producer's entry unconditionally. If the first snapshot fixed its SQLite read point at state S0, a writer commits S1, and a second read starts after that commit while production is still pending, the second read observes S1 and still receives the S0 snapshot. The producer's after-stamp prevents retention but does not protect the joined caller. An isolated probe reproduced `sharedFile: true` with the second caller reading `snapshot-state-0` after its stamp advanced to state 1.
- Invariant: a reader whose observed store generation differs from a snapshot producer's generation must never receive that snapshot. Boundary inventory searched: retained hot hit, cold production, in-flight join, unstampable source, before/after retention, Node and CLI producers, list/detail/point-lookup/identity consumers. Affected: in-flight join across a write. Verified safe: retained hits compare stamps; unstable productions are not retained; stable cold snapshots remain atomic.
- Impact: OpenCode and Cursor point lookups can return a successful zero-row result from before a committed session, classify the live session as `absent`, and delete its preview. This violates D1, D4, and the accepted “write between reads” scenario.
- SuggestedFix: store the producer's before-generation with the in-flight entry. Join only when the caller's current stamp matches it; on mismatch, await/ignore that flight and retry the borrow loop against a fresh stamp, then add a deterministic test where the write completes before the second caller starts.
- Status: new
- Triage: pending

### B2

- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-performance` (corroborated by chair)
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/snapshotPool.ts:60,130-136`
- Title: Retained snapshot disk has no safe count or byte budget
- Evidence: every stable store path is inserted into `retained`; only replacement of the same path or 60-second idleness removes it. There is no global entry count or retained-byte limit. Production does not have only one store per agent: Cursor CLI defines a separate `<bucket>/<chatId>/store.db` for each chat and can expose up to 4,096 indexed chat ids; opening detail or verifying identity for several distinct chats within one idle window retains every full snapshot. Individual supported stores already exceed 1 GB.
- Invariant: retained disk must be structurally bounded independently of user access rate and source-store size. Boundary inventory searched: retained map, in-flight map, idle timer, leases, per-deps pools, Codex/OpenCode shared stores, Cursor IDE shared store, Cursor CLI per-chat stores. Affected: aggregate retained count and bytes across distinct paths. Verified safe: one entry per exact path, one timer per pool, and idle eviction after the window when no race interferes.
- Impact: a burst of detail/resume actions can duplicate many large stores into the temp volume, exhaust disk, and then make future snapshots or unrelated host operations fail. The 60-second timer bounds age, not peak disk.
- SuggestedFix: add a pool-level max-entry and/or retained-byte budget with LRU eviction of unleased entries; when the budget cannot safely retain a new snapshot, return it as an unretained one-shot lease. Cover multiple per-chat paths and an entry larger than the budget.
- Status: new
- Triage: pending

### B3

- ID: B3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security` (corroborated by `asm-review-contracts`, `asm-review-logic`, `asm-review-performance`, and chair)
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/snapshotPool.ts:181-188`
- Title: Dispose is not a cleanup barrier for active or in-flight snapshots
- Evidence: `dispose()` snapshots and clears only the current `retained` map. It neither waits for active leases nor drains `inFlight`. A leased entry is merely marked unretained and remains on disk until a later release; an in-flight production can finish after disposal, pass the stable-stamp check, insert itself back into `retained`, and never get a sweeper because `disposed` suppresses `startSweeping`. `borrow()` also remains callable after disposal. An isolated probe disposed during production and confirmed the produced snapshot still existed after the resulting lease released.
- Invariant: shutdown must close snapshot admission and retain ownership of every temp directory until its last producer/lease is either drained or conservatively failed. Boundary inventory searched: current retained entries with zero/positive leases, in-flight success/failure, post-dispose borrow, idle sweep, extension deactivate. Affected: active leases, in-flight producers, and post-dispose borrows. Verified safe: idle retained entries present in the map at disposal are deleted.
- Impact: clean extension shutdown can leave sensitive session snapshots in the OS temp directory, violating D3 and the accepted shutdown scenario. Post-dispose entries can leak permanently for the process lifetime.
- SuggestedFix: make disposal a closed-state completion barrier: reject new borrows, prevent any producer from retaining after closure, track/drain in-flight production and outstanding leases, and await their cleanup before `dispose()` resolves without deleting a file under an active reader. Add tests for dispose during production, dispose with an active lease, and borrow after dispose.
- Status: new
- Triage: pending

### W1

- ID: W1
- Severity: WARN
- Confidence: MEDIUM
- Priority: P3
- Agent: `asm-review-logic`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/snapshotPool.ts:169-172`
- Title: Idle eviction can orphan a concurrently replaced snapshot
- Evidence: `evictIdle()` iterates a copied `[dbPath, entry]` list and awaits deletion for each entry. While it is suspended deleting one store, another store can be replaced. When the loop reaches the stale captured pair it calls `this.retained.delete(dbPath)` without checking that the map still points to that captured entry, removing the newer entry while discarding only the old one. The newer entry remains marked retained but is no longer reachable by reuse, dispose, or later sweeps.
- Impact: a retained snapshot can leak sensitive temp disk and every later read of that store resumes full snapshot production. This needs at least two store paths and a replacement during an awaited sweep deletion, so it is less frequent than the gating lifecycle defects.
- SuggestedFix: before deleting, require `this.retained.get(dbPath) === entry`; otherwise skip the captured stale entry. Add a controlled two-store interleaving test.
- Status: new
- Triage: pending

### W2

- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-contracts`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/sqlite.ts:466-469,489`
- Title: Public snapshot lifecycle documentation now promises immediate deletion
- Evidence: the exported `withSqliteSnapshot` documentation still says it copies WAL/SHM sidecars and that “the snapshot is deleted before this function returns.” The changed implementation borrows a retained engine snapshot at line 489; release normally leaves that file on disk for reuse. The module-level mechanism intentionally no longer copies sidecars.
- Impact: callers and reviewers are told the opposite resource/privacy lifetime from the new public behavior, making later cleanup or callback-lifetime changes likely to rely on a false contract.
- SuggestedFix: document that the callback's lease ends before return, while the pool may retain the engine-produced snapshot until superseded, idle eviction, or disposal; remove the obsolete sidecar-copy claim.
- Status: new
- Triage: pending

## Inline support review

- Changed production behavior has corresponding focused pool and SQLite integration tests; no `.only`, `.skip`, disabled case, unawaited async assertion, secret-bearing fixture, or destructive seed was introduced.
- Existing tests cover unchanged reuse, writes between completed reads, unstable before/after stamps, coalescing, supersede, idle eviction, and disposal of already-retained idle entries.
- Missing discriminating cases are part of the findings: write-before-late-join (B1), multi-store/byte budget (B2), dispose during production/active lease/post-dispose borrow (B3), and replacement during an awaited idle sweep (W1).
- The committed analytics email duplicates the same email already present in the reviewed Git commit metadata, so it creates no additional privacy exposure and was not reported.

## Accepted risk

None.

## Audit backlog

None.

---

## Author triage — cycle 1 / round 1

**[B1] A later reader can join a snapshot from before its observed write** — Status: accepted
Triage: correct, and it is my error rather than the reviewer's reading. `borrow` gates a RETAINED
snapshot on the caller's own stamp but joins an IN-FLIGHT one on nothing at all, so a caller that has
already observed a write can be served the producer's older generation. The accepted spec delta
already says "Concurrent reads of the same **unchanged** store SHALL share one snapshot operation" —
the code implements the first half of that sentence and not the second. Fixing it means carrying the
producer's stamp on the flight and joining only on a generation match, which is remediation inside
the accepted contract, not a new decision.

**[B2] Retained snapshot disk has no safe count or byte budget** — Status: accepted, and it invalidates D3
Triage: verified against the code before accepting. `cursorPaths.ts:132` gives every Cursor CLI chat
its own `store.db` under `<root>/<bucket>/<chatId>/`, and `cursorReader.ts:407` walks every candidate
per list. So D3's stated premise — "the pool holds at most one snapshot per store, and there are at
most a handful of stores (one per agent)" — is factually wrong, and the sentence that follows it
("byte accounting would add machinery without changing the bound") rests on it. This is not a defect
in the implementation of D3; it is a defect in D3. Per the remediation boundary it cannot be landed
as a fix commit.

**[B3] Dispose is not a cleanup barrier for active or in-flight snapshots** — Status: accepted
Triage: correct. `dispose()` drains only the `retained` map; a production already in flight can settle
afterwards, retain itself, and never be swept, because `disposed` suppresses the sweeper it would
need. The spec delta's third scenario ("every retained snapshot file SHALL be deleted" at shutdown) is
therefore not met on the one interleaving that matters. Grouped with B2 because both are D3's
disk-ownership story and rewriting it piecemeal would leave the two halves inconsistent.

**[W1] Idle eviction can orphan a concurrently replaced snapshot** — Status: accepted
Triage: correct. `evictIdle` iterates a captured copy and deletes the map binding after an await, so a
binding replaced during that await is dropped while the old entry is the one discarded. Identity check
before delete, plus the two-store interleaving test.

**[W2] Public lifecycle documentation promises immediate deletion** — Status: accepted
Triage: correct, and it is a privacy contract, not a comment tidy. `withSqliteSnapshot`'s doc still
describes copying WAL/SHM sidecars and deleting the snapshot before returning — the first half was
already false after the parent change, the second half became false here.

### Disposition

Cycle 1 closes as **superseded**, not as a fix loop. B2 requires a changed `D3` and B3 rewrites the
same decision, so under the remediation boundary the fixes are parked and the change hands back to
`asimov-plan`. The next review is cycle 2's discovery round.

No finding was rejected and none was risk-accepted — no human has been asked to accept any residual.
