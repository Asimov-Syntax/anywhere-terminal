# Tasks: snapshot-a-live-store-atomically

## 1. One atomic snapshot, both engines

- [ ] 1_1 Take the snapshot with the engine instead of the filesystem
  - **Refs**: specs/agent-session-index/spec.md#wal-safe-read-only-sqlite-access; design.md#d1-the-engine-takes-the-snapshot-not-the-filesystem; design.md#d3-the-snapshot-never-opens-the-live-store-read-write; design.md#d4-the-temp-directory-lifecycle-and-the-callback-contract-are-unchanged
  - **Acceptance**:
    - Outcome: a WAL-resident row is in the snapshot even when the store checkpoints during it
    - Verify: unit src/vault/sqlite.test.ts
  - **Plan**:
    1. In `src/vault/sqlite.ts`, replace the base-plus-sidecar copy sequence in both `readSqliteViaCopy` and `withSqliteSnapshot` with one snapshot call against a read-only source connection, keeping the surrounding `mkdtemp`/`finally rmrf` lifecycle and the existing return shapes.
    2. Add the optional snapshot dependency to `SqliteDeps` beside `access`, defaulting to the real engine, so failure modes are drivable from tests.
    3. Delete `copySidecars` and the tests that pin copy ordering rather than status, since this task removes the mechanism they describe.
    4. Cover in `src/vault/sqlite.test.ts` with a real WAL store plus a second live connection: the row survives, and the checkpoint-and-vacuum interleaving that defeated both prior patches either contains the row or reports a failure status.

- [ ] 1_2 Give the CLI fallback the same guarantee
  - **Deps**: 1_1
  - **Refs**: specs/agent-session-index/spec.md#sqlite-engine-selection-and-result-discrimination; design.md#d1-the-engine-takes-the-snapshot-not-the-filesystem; design.md#d3-the-snapshot-never-opens-the-live-store-read-write
  - **Acceptance**:
    - Outcome: with `node:sqlite` unavailable, a WAL-resident row still reaches the snapshot
    - Verify: unit src/vault/sqlite.test.ts
  - **Plan**:
    1. In `src/vault/sqlite.ts`, have the CLI engine produce its snapshot with a read-only `VACUUM INTO`, not `.backup`, so the source is never opened read-write.
    2. Cover the same WAL-resident-row acceptance as 1_1 with the CLI engine forced, and assert a snapshot failure surfaces as a status.

- [ ] 1_3 Route every snapshot failure to a status, never an empty result
  - **Deps**: 1_2
  - **Refs**: specs/agent-session-index/spec.md#sqlite-engine-selection-and-result-discrimination; design.md#d2-every-snapshot-failure-is-a-status-never-an-empty-result
  - **Acceptance**:
    - Outcome: a store that cannot be opened for snapshotting reports a failure status, never zero rows
    - Verify: unit src/vault/sqlite.test.ts
  - **Plan**:
    1. In `src/vault/sqlite.ts`, map an open failure to `db-unreachable` and any other snapshot throw to `query-error`, keeping the existing confirmed-missing `no-db` check ahead of both.
    2. Cover a store whose directory denies the access a WAL open needs, asserting the status and that no rows are returned.

- [ ] 1_4 Retire the sidecar-copy mechanism from the documents that mandate it
  - **Deps**: 1_1, 1_2, 1_3
  - **Refs**: specs/agent-session-index/spec.md#wal-safe-read-only-sqlite-access
  - **Acceptance**:
    - Outcome: no repository document instructs a reader to assemble a snapshot from copied sidecars
    - Verify: command rg -n 'sidecar' asimov/specs/ docs/ src/
  - **Plan**:
    1. Grep `asimov/specs/`, `docs/DESIGN.md`, `docs/design/` and `src/` for the sidecar-copy mechanism and its D13 rationale, and update the owning sections to the atomic-snapshot contract the delta states.
