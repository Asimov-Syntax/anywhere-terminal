# Spec Delta: agent-session-index

The existing requirement fused two contracts: how a snapshot is taken, and which engine takes it
plus what it returns. Only the first changes here, so it is split — the snapshot contract is
rewritten below, and the engine/result contract moves to its own requirement unchanged in substance.

## MODIFIED Requirements

### Requirement: WAL-safe read-only SQLite access

For any SQLite-backed store, the system SHALL read a point-in-time snapshot produced by a single
SQLite-engine operation that is atomic with respect to concurrent writers, checkpoints and vacuums,
SHALL query that snapshot in read-only mode, and SHALL then delete it. The system SHALL NOT assemble
a snapshot from separately-timed copies of the database file and its `-wal`/`-shm` sidecars, SHALL
NOT query the live store in place, and SHALL NOT open the live store for writing in order to
snapshot it.

#### Scenario: A session committed only to the WAL survives a concurrent checkpoint

- **WHEN** a store holds a committed row resident in its `-wal` and not yet in the base file, and the
  live agent checkpoints and vacuums that store while the snapshot is being taken
- **THEN** the snapshot SHALL either contain that row or report a failure status, and SHALL NOT
  return `ok` with the row missing

## ADDED Requirements

### Requirement: SQLite engine selection and result discrimination

The system SHALL access SQLite preferring the built-in `node:sqlite` module, falling back to the host
`sqlite3` binary in read-only mode WHEN `node:sqlite` is unavailable, without any new native
dependency. The read SHALL return a discriminated result distinguishing `ok` / `no-db` /
`db-unreachable` / `no-sqlite3` / `query-error`, never a bare empty array, and a failure to produce a
snapshot SHALL surface as `db-unreachable` or `query-error` rather than as `ok` with zero rows.

WHEN neither engine is available the read SHALL return `no-sqlite3` and SQLite-backed agents SHALL
degrade to their fallback without raising; a `query-error` SHALL be counted as unreadable and
surfaced, not silently dropped.

#### Scenario: A store that cannot be opened for snapshotting is not an empty store

- **WHEN** the snapshot cannot be produced because the store's directory denies the access the engine
  needs to open a WAL database
- **THEN** the read SHALL report `db-unreachable` or `query-error`, and SHALL NOT report `ok` with
  zero rows
