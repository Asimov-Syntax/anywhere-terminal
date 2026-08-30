# Design: snapshot-a-live-store-atomically

## Decisions

### D1: The engine takes the snapshot, not the filesystem

A snapshot is produced by one SQLite-engine operation that holds a read transaction for its whole
duration, so writers, checkpoints and vacuums during it are either included or excluded as a unit.

- **`node:sqlite`** (preferred engine): the module-level `backup(sourceDb, destPath)` — SQLite's
  Online Backup API. Verified on the installed runtime (Node v24.7.0) against a live WAL store with
  a second connection holding a WAL-resident row: the snapshot contained 1001 of 1001 rows including
  the WAL-resident one, passed `integrity_check`, and was unaffected by a `wal_checkpoint(TRUNCATE)`
  plus `VACUUM` executed afterwards.
- **`sqlite3` CLI** (fallback engine): `VACUUM INTO '<dest>'` run under `-readonly`. Verified to exit
  0 and produce a queryable snapshot. Chosen over `.backup` because `.backup` opens the source
  read-write, and D3 forbids that.

The source connection is opened **read-only**. Verified that this works even when the store's
directory is not writable and even while another process holds the store open.

**Rejected**: a stability protocol around the existing copies — observe sidecar presence, copy,
re-observe, retry or fail on a change. It shrinks the window instead of removing it: the
copy-then-checkpoint-then-VACUUM interleaving review reproduced changes no observable sidecar state,
so the protocol would report `ok` for exactly the case that motivated the change.

**Rejected**: querying the live store read-only with no snapshot at all, as `orca` does
(`src/main/sqlite/sync-database.ts`). It is simpler and correct for one query, but
`withSqliteSnapshot` exists so that several queries see ONE state — Cursor's IDE reader queries a
header, then composer data, then bubbles, and a reader that saw them from three different instants
could assemble a session that never existed. Only a real snapshot keeps that promise.

### D2: Every snapshot failure is a status, never an empty result

The engine reports failure by throwing. Both entry points already wrap their body in a `try` that
maps a throw to `query-error`, so the new failure modes land in the existing vocabulary with no new
status and no new branch:

| Condition | Status |
|---|---|
| Store file confirmed missing | `no-db` (unchanged — the presence check runs first) |
| Store present, engine cannot open it (directory denies the WAL index it needs) | `db-unreachable` |
| Snapshot operation throws for any other reason | `query-error` |
| Snapshot produced | `ok` |

This is the whole safety property, and it is what the old mechanism could not offer: a failed
sidecar copy left a *queryable* base file, so failure and emptiness were the same observation. A
failed `backup` leaves no snapshot to query at all.

The premise the spec used to justify file-copying — that "a read-only open of a live WAL store can
return an empty result instead of an error" — was tested directly and does not hold on this runtime.
A WAL store whose `-shm` must be created in a directory that denies it throws
`ERR_SQLITE_ERROR: unable to open database file`. That is a loud failure, which D2 routes to
`db-unreachable`; the silent empty the spec feared is the one thing it does not do.

### D3: The snapshot never opens the live store read-write

The source connection is opened with `readOnly: true`, and the CLI form runs under `-readonly`.
`.backup` in the CLI opens the source read-write and is therefore not used. The vault reads stores
owned by other running agents; acquiring a write lock on Cursor's or Codex's live database to take a
read snapshot would be a defect of its own, and `writeSqlite` remains the only path that opens a
store for writing.

### D4: The temp-directory lifecycle and the callback contract are unchanged

`mkdtemp` → produce the snapshot → run the caller's query or callback against it → `rmrf` in a
`finally`. Only the middle step changes. `SqliteSnapshot`, `SqliteResult`, `SqliteSnapshotResult`,
`SqliteDeps` and every reader's call shape stay as they are, so the four readers and their pinned
tests are untouched by this change.

`SqliteDeps` gains one optional dependency for the snapshot operation so tests can drive its failure
modes, following the pattern `access` already established in D6 of the parent change: supplied → used;
absent → the real engine. The `copy` dep stays, since `writeSqlite` and the CLI path still use it.

## Failure-surface inventory

The change reads a mutable resource owned by other processes (each agent's live SQLite store) and
writes only to a private temp directory.

| Resource | Answer |
|---|---|
| Who owns writes to the live store | The agent process (Cursor, Codex, OpenCode). This change never writes to it — D3 — and takes no lock a writer can block on |
| What serializes concurrent access | SQLite's own WAL protocol. The Online Backup API and `VACUUM INTO` both run inside a read transaction, which is what makes the result atomic; a concurrent writer proceeds and its post-snapshot commits are simply not in the snapshot |
| Crash mid-write | n/a for the live store (never written). For the snapshot: a partial temp file is unreachable — it is never queried, because the throw that produced it short-circuits to a status, and the `finally` deletes the temp dir |
| Failed or malformed read: open or closed | **Closed, and that is the change.** A snapshot that cannot be produced yields `db-unreachable`/`query-error`, never `ok` with zero rows. Failing open here is precisely the defect being removed |
| Two racing hosts | Two vault processes snapshotting the same store concurrently do not interact: each opens read-only and writes to its own `mkdtemp` directory |

## Risk Map

| Risk | Mitigation |
|---|---|
| The backup API behaves differently on a store held open by a foreign process than in a probe | Acceptance is a test against a real WAL store with a second live connection holding a WAL-resident row, plus the checkpoint-and-VACUUM interleaving that defeated both previous patches |
| The CLI fallback diverges from the in-process engine | Both engines are covered by the same acceptance: the fallback's task asserts the same WAL-resident row survives the same interleaving |
| A store the old mechanism read (badly) now fails to open, turning sessions unreadable | The direction is deliberate (D2), but the blast radius is checked: the list paths already treat `query-error` as unreadable and retry, so the visible effect is a transient unreadable row, not a lost session |
| `node:sqlite` is experimental and `backup` may move | It is loaded through the same guard as the rest of the module, so an unsupported runtime degrades to the CLI rather than throwing — the existing `no-sqlite3` path |
