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

- [ ] 1_3 Give retained snapshots a lifetime and an end
  - **Deps**: 1_2
  - **Refs**: specs/agent-session-index/spec.md#wal-safe-read-only-sqlite-access; design.md#d3-the-pool-owns-disk-and-disk-is-released-three-ways
  - **Acceptance**:
    - Outcome: no retained snapshot file outlives its last reader
    - Verify: unit src/vault/snapshotPool.test.ts
  - **Plan**:
    1. In `src/vault/snapshotPool.ts`, borrow and release entries by refcount, deleting a superseded entry after its last release, and add an idle interval and a `dispose` that deletes everything retained.
    2. Cover each release path, plus the case where a superseded entry is still borrowed when it is replaced.

- [ ] 1_4 Read through the pool at both entry points
  - **Deps**: 1_2, 1_3
  - **Refs**: design.md#d5-the-pool-sits-behind-the-existing-entry-points-not-beside-them
  - **Acceptance**:
    - Outcome: a repeated read of an unchanged large store costs materially less than the first
    - Verify: unit src/vault/sqlite.test.ts
  - **Plan**:
    1. In `src/vault/sqlite.ts`, borrow the snapshot from the pool in `readSqlite` and `withSqliteSnapshot` instead of always producing one, releasing it when the query or callback completes, and expose the pool as an optional dep with one process-wide default.
    2. In `src/extension.ts`, dispose the pool on deactivate so retained snapshots do not outlive the host.
    3. Cover in `src/vault/sqlite.test.ts` that a second read of an unchanged store performs no further snapshot production, and that the atomicity and failure-status guarantees the parent change pinned still hold when reads are served from the pool.
