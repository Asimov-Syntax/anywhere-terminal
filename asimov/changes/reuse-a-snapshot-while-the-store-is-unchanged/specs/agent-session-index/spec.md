# Spec Delta: agent-session-index

Written against the requirement as `snapshot-a-live-store-atomically` leaves it — that change
archives first and this one depends on it.

## MODIFIED Requirements

### Requirement: WAL-safe read-only SQLite access

For any SQLite-backed store, the system SHALL read a point-in-time snapshot produced by a single
SQLite-engine operation that is atomic with respect to concurrent writers, checkpoints and vacuums,
SHALL query that snapshot in read-only mode, and SHALL then delete it. The system SHALL NOT assemble
a snapshot from separately-timed copies of the database file and its `-wal`/`-shm` sidecars, SHALL
NOT query the live store in place, and SHALL NOT open the live store for writing in order to
snapshot it.

A read MAY be served from a snapshot taken for an earlier read, but ONLY while the store is provably
unchanged since that snapshot was taken, established by the `(mtimeMs, size)` stamp of the database
file and its `-wal`. A read whose store's stamp differs from the retained snapshot's SHALL take a
fresh snapshot. Concurrent reads of the same unchanged store SHALL share one snapshot operation
rather than each taking their own.

#### Scenario: A session committed only to the WAL survives a concurrent checkpoint

- **WHEN** a store holds a committed row resident in its `-wal` and not yet in the base file, and the
  live agent checkpoints and vacuums that store while the snapshot is being taken
- **THEN** the snapshot SHALL either contain that row or report a failure status, and SHALL NOT
  return `ok` with the row missing

#### Scenario: A write between two reads is never served from the earlier snapshot

- **WHEN** a session is written to a store between one read and the next
- **THEN** the second read SHALL take a fresh snapshot, and SHALL NOT answer from the snapshot taken
  before that write

#### Scenario: A retained snapshot does not outlive the process that made it

- **WHEN** the extension shuts down while snapshots are retained
- **THEN** every retained snapshot file SHALL be deleted
