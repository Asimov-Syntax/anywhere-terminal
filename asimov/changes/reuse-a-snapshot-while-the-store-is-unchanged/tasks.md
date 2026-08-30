# Tasks: reuse-a-snapshot-while-the-store-is-unchanged

## 1. A pool that reuses only what it can prove is current

- [x] 1_1 Reuse a snapshot while the store's stamp is unchanged — verified: pnpm exec vitest run 'src/vault/snapshotPool.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Refs**: specs/agent-session-index/spec.md#wal-safe-read-only-sqlite-access; design.md#d1-reuse-is-gated-on-proven-sameness-never-on-elapsed-time; design.md#d2-the-stamp-is-taken-twice-and-only-a-stable-snapshot-is-retained
  - **Acceptance**:
    - Outcome: a second read of an unchanged store takes no new snapshot; a write between reads forces one
    - Verify: unit src/vault/snapshotPool.test.ts
  - **Plan**:
    1. Add `src/vault/snapshotPool.ts` owning one retained snapshot per store, reusing it when `sameStamps` holds over the store's `.db` and `-wal` and taking a fresh one otherwise.
    2. Stamp before and after production, and retain only when the two agree; a snapshot taken across a write is returned once and dropped.
    3. Treat a stamp that cannot be read as changed, so a failed `stat` forces a fresh snapshot rather than reusing a possibly-stale one.
    4. Cover in `src/vault/snapshotPool.test.ts`: an unchanged store reuses, a store written between reads does not, a store written *during* production is not retained, and an unreadable stamp forces a fresh snapshot.

- [x] 1_2 Make concurrent readers of one store share a single snapshot — verified: pnpm exec vitest run 'src/vault/snapshotPool.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md#d4-one-in-flight-snapshot-per-store
  - **Acceptance**:
    - Outcome: concurrent reads of one store produce one snapshot between them, and a failed one is not awaited by later readers
    - Verify: unit src/vault/snapshotPool.test.ts
  - **Plan**:
    1. In `src/vault/snapshotPool.ts`, key an in-flight promise by store path, join concurrent callers onto it, and clear it when it settles either way.
    2. Cover concurrent borrows counting one production, and a failed production leaving the next caller free to retry rather than awaiting a settled rejection.

- [x] 1_3 Give retained snapshots a lifetime and an end — verified: pnpm exec vitest run 'src/vault/snapshotPool.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/agent-session-index/spec.md#wal-safe-read-only-sqlite-access; design.md#d3-the-pool-owns-disk-and-disk-is-released-three-ways
  - **Acceptance**:
    - Outcome: no retained snapshot file outlives its last reader
    - Verify: unit src/vault/snapshotPool.test.ts
  - **Plan**:
    1. In `src/vault/snapshotPool.ts`, borrow and release entries by refcount, deleting a superseded entry after its last release, and add an idle interval and a `dispose` that deletes everything retained.
    2. Cover each release path, plus the case where a superseded entry is still borrowed when it is replaced.

- [x] 1_4 Read through the pool at both entry points — verified: pnpm exec vitest run 'src/vault/sqlite.test.ts' && pnpm run check-types && pnpm run test:unit && pnpm run gate:fs-deletion exit 0
  - **Deps**: 1_2, 1_3
  - **Refs**: design.md#d5-the-pool-sits-behind-the-existing-entry-points-not-beside-them
  - **Acceptance**:
    - Outcome: a repeated read of an unchanged large store costs materially less than the first
    - Verify: unit src/vault/sqlite.test.ts
  - **Plan**:
    1. In `src/vault/sqlite.ts`, borrow the snapshot from the pool in `readSqlite` and `withSqliteSnapshot` instead of always producing one, releasing it when the query or callback completes, and expose the pool as an optional dep with one process-wide default.
    2. In `src/extension.ts`, dispose the pool on deactivate so retained snapshots do not outlive the host.
    3. Cover in `src/vault/sqlite.test.ts` that a second read of an unchanged store performs no further snapshot production, and that the atomicity and failure-status guarantees the parent change pinned still hold when reads are served from the pool.

## 2. Round-1 review fixes

- [x] 2_1 Join an in-flight snapshot only when it started from the caller's store — verified: pnpm exec vitest run 'src/vault/snapshotPool.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Refs**: .reviews/round-1.md; design.md#d4-one-in-flight-snapshot-per-store-joined-only-on-a-matching-generation
  - **Acceptance**:
    - Outcome: a reader that has observed a write is never served the snapshot that was already in flight before it
    - Verify: unit src/vault/snapshotPool.test.ts
  - **Plan**:
    1. In `src/vault/snapshotPool.ts`, carry the producer's stamp on the in-flight entry and join only when the caller's stamp matches it; a caller whose stamp differs awaits the flight, then takes its own snapshot.
    2. Cover a late joiner that writes to the store after production began: it must produce a second snapshot and see its own write, while two callers at the same generation still share one.

- [x] 2_2 Bound the pool by capacity, not only by age — verified: pnpm exec vitest run 'src/vault/snapshotPool.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: .reviews/round-1.md; design.md#d3-the-pool-owns-disk-and-disk-is-bounded-by-capacity-as-well-as-by-age
  - **Acceptance**:
    - Outcome: retained snapshots never exceed the pool's entry and byte budget, whatever a list touches
    - Verify: unit src/vault/snapshotPool.test.ts
  - **Plan**:
    1. In `src/vault/snapshotPool.ts`, measure each snapshot on retention and evict least-recently-used entries until it fits an entry-count and byte budget; a snapshot that cannot fit is leased once and never retained.
    2. Make `evictIdle` delete a binding only when the map still holds the entry it captured, so a concurrently replaced snapshot is not orphaned (W1).
    3. Cover: a budget-exceeding sequence retains only what fits, the evicted file is gone, an entry still borrowed survives its eviction until released, an oversized snapshot is never retained, and a two-store interleaving does not orphan a replacement.

- [x] 2_3 Make dispose a barrier and correct the lifetime the entry points promise — verified: pnpm exec vitest run 'src/vault/snapshotPool.test.ts' && pnpm run check-types && pnpm run test:unit && pnpm run gate:fs-deletion exit 0
  - **Deps**: 2_2
  - **Refs**: .reviews/round-1.md; design.md#d3a-dispose-is-a-barrier-not-a-sweep
  - **Acceptance**:
    - Outcome: after dispose resolves, no snapshot file remains and none can be created
    - Verify: unit src/vault/snapshotPool.test.ts
  - **Plan**:
    1. In `src/vault/snapshotPool.ts`, make `dispose` reject new borrows, await in-flight productions, refuse post-close retention, and await outstanding leases before deleting what they hold.
    2. In `src/vault/sqlite.ts`, correct `withSqliteSnapshot`'s doc comment, which still promises a sidecar copy and deletion before return (W2).
    3. Cover a production in flight across a dispose, a lease outstanding across a dispose, and a borrow attempted after dispose.

## 3. Round-2 review fixes

- [x] 3_1 Prove the generation coherently, or refuse to reuse — verified: pnpm exec vitest run 'src/vault/snapshotPool.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Refs**: .reviews/round-2.md; design.md#d1-reuse-is-gated-on-proven-sameness-never-on-elapsed-time
  - **Acceptance**:
    - Outcome: a write that completes between the two halves of a generation read never reads as unchanged
    - Verify: unit src/vault/snapshotPool.test.ts
  - **Plan**:
    0. Cover the generation read itself in `src/vault/storeStamp.test.ts`.
    1. In `src/vault/storeStamp.ts`, export the store's file set once and add a generation read that stats in a fixed order, distinguishes proven absence from any other stat failure via `provesAbsence`, and reports a generation as unusable when a path could not be determined.
    2. Read the generation twice in that fixed order and treat it as usable only when both readings agree, so a write spanning the read cannot present as unchanged.
    3. In `src/vault/snapshotPool.ts`, gate reuse, joining and retention on a usable generation; an unusable one produces a fresh snapshot and retains nothing.
    4. Adopt the exported file set in `src/vault/readers/codexReader.ts` and `src/vault/readers/opencodeReader.ts` so the reuse gate and the persisted list cache cannot disagree about which files define freshness.
    5. Cover: a checkpoint-and-delete landing between the two halves of the read, an unreadable `-wal` never reading as a WAL-free store, and a genuinely WAL-free store still reusing.

- [x] 3_2 Drain admitted work at shutdown, not the states it can see — verified: pnpm exec vitest run 'src/vault/snapshotPool.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: .reviews/round-2.md; design.md#d3a-dispose-is-a-barrier-not-a-sweep
  - **Acceptance**:
    - Outcome: dispose outlives every outstanding borrow and production
    - Verify: unit src/vault/snapshotPool.test.ts
  - **Plan**:
    1. In `src/vault/snapshotPool.ts`, admit every borrow to a registry before its first await and remove it when it settles; drain that registry to quiescence in `dispose` instead of the joinable-flight map.
    2. Cover a borrow parked on its first stamp across a dispose, and a producer displaced from the per-store binding by a waiting caller.

- [x] 3_3 Give up a snapshot's ownership only once its disk is gone — verified: pnpm exec vitest run 'src/vault/snapshotPool.test.ts' && pnpm run check-types && pnpm run test:unit && pnpm run gate:fs-deletion exit 0
  - **Deps**: 3_2
  - **Refs**: .reviews/round-2.md; design.md#d3-the-pool-owns-disk-and-disk-is-bounded-by-capacity-as-well-as-by-age
  - **Acceptance**:
    - Outcome: a deletion that fails leaves the snapshot owned and reported, never silently abandoned
    - Verify: unit src/vault/snapshotPool.test.ts
  - **Plan**:
    1. In `src/vault/snapshotPool.ts`, untrack an entry only after its directory is deleted, keep failures for retry, and have `dispose` surface what it could not remove rather than resolving over it.
    2. Cover a failing deletion at release and at disposal.

- [x] 3_4 Write the borrow-and-release lifecycle once — verified: pnpm exec vitest run 'src/vault/sqlite.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Refs**: .reviews/round-2.md; design.md#d5-the-pool-sits-behind-the-existing-entry-points-not-beside-them
  - **Acceptance**:
    - Outcome: both entry points share one lease lifecycle and keep their own result and status mapping
    - Verify: unit src/vault/sqlite.test.ts
  - **Plan**:
    1. In `src/vault/sqlite.ts`, factor the borrow / use / release-in-finally lifecycle into one internal helper both entry points call, leaving each wrapper's distinct result shape and status mapping where they are.
    2. Cover that both entry points still map an open failure to `db-unreachable` and any other snapshot failure to `query-error`.

## 4. Round-3 review fixes

- [x] 4_1 Make admission a transaction that cannot interleave — verified: pnpm exec vitest run 'src/vault/snapshotPool.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Refs**: .reviews/round-3.md; design.md#d3-the-pool-owns-disk-and-disk-is-bounded-by-capacity-as-well-as-by-age
  - **Acceptance**:
    - Outcome: concurrent admissions never exceed the pool's budgets
    - Verify: unit src/vault/snapshotPool.test.ts
  - **Plan**:
    1. In `src/vault/snapshotPool.ts`, size the snapshot before the accounting and delete evicted victims after it, so the block that checks the budget, evicts and inserts contains no await.
    2. Cover concurrent admissions of distinct stores against a one-entry and a byte budget, asserting the pool never exceeds either.

- [x] 4_2 Budget and retry the disk a failed deletion left behind — verified: pnpm exec vitest run 'src/vault/snapshotPool.test.ts' && pnpm run check-types && pnpm run test:unit && pnpm run gate:fs-deletion exit 0
  - **Deps**: 4_1
  - **Refs**: .reviews/round-3.md; design.md#d3-the-pool-owns-disk-and-disk-is-bounded-by-capacity-as-well-as-by-age
  - **Acceptance**:
    - Outcome: a snapshot whose deletion failed still counts against the budget and is retried
    - Verify: unit src/vault/snapshotPool.test.ts
  - **Plan**:
    1. In `src/vault/snapshotPool.ts`, keep undeleted entries in a retry set that counts against the pool's live byte total and is retried on admission and on idle sweeps with bounded backoff.
    2. Cover that repeated deletion failures apply backpressure rather than accumulating unbudgeted, and that a later successful retry releases the budget.

## 5. Round-4 review fixes

- [x] 5_1 Retain only what a fixed set of stores asks to retain — verified: pnpm exec vitest run 'src/vault/snapshotPool.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Refs**: .reviews/round-4.md; design.md#d3-retention-is-bounded-by-construction-not-by-enforcement
  - **Acceptance**:
    - Outcome: a store nobody asked to retain leaves nothing behind after its last reader
    - Verify: unit src/vault/snapshotPool.test.ts
  - **Plan**:
    1. In `src/vault/snapshotPool.ts`, make retention opt-in per borrow and delete the LRU, byte-budget, capacity-eviction and live-byte accounting that existed to referee an unbounded retained set.
    2. Take the producing borrow's lease at publication, so an entry is never visible to the pool before its own reader holds it.
    3. In `src/vault/sqlite.ts`, pass the opt-in through from the entry points so a caller can say whether this store is one worth retaining.
    4. Opt in explicitly at the three primary-store readers (`src/vault/readers/codexReader.ts`, `src/vault/readers/opencodeReader.ts`, `src/vault/readers/cursorIdeReader.ts`) and leave `src/vault/readers/cursorStore.ts` — the per-chat path — retaining nothing, so the retained key space is the fixed set by construction rather than by default.
    5. Cover: an unretained borrow leaves no file after release, a retained store still reuses, concurrent borrows of distinct stores each keep a readable lease until their own release, and the retained set never exceeds the stores that asked for it.

- [ ] 5_2 Keep retrying cleanup while anything is still on disk
  - **Deps**: 5_1
  - **Refs**: .reviews/round-4.md; design.md#d3-retention-is-bounded-by-construction-not-by-enforcement
  - **Acceptance**:
    - Outcome: a failed deletion is retried even when nothing is retained
    - Verify: unit src/vault/snapshotPool.test.ts
  - **Plan**:
    1. In `src/vault/snapshotPool.ts`, keep the cleanup sweeper alive while retry-eligible undeleted entries remain, and start one after a failed release, rather than stopping because the retained set is empty.
    2. Cover a failed deletion of the last retained entry being retried by a later sweep with nothing retained.

