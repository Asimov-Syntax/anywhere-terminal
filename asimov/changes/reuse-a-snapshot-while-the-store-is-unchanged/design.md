# Design: reuse-a-snapshot-while-the-store-is-unchanged

## Decisions

### D1: Reuse is gated on proven sameness, never on elapsed time

A retained snapshot is reused only when `sameStamps(stampStoreFiles([db, db+"-wal"]), retained.stamp)`
holds. `storeStamp.ts` is the shipped stamp the list cache already trusts, and its comment records why
`-shm` is excluded (volatile wal-index state; stamping it causes false invalidations).

This is what makes reuse safe for `absent`. Any commit rewrites the `-wal` mtime and any checkpoint
rewrites the `.db`, so an equal stamp means no write landed — and a snapshot taken under that stamp
answers what a fresh one would, including about a session's absence. A TTL alone could not say that.

There is no time-based expiry for correctness. An idle timer exists only to release disk (D3).

**Rejected**: a short TTL (1–2 s) instead of a stamp. It would answer `absent` for a session written
during the window, which is the precise failure the whole parent chain exists to remove, and it would
buy nothing a stamp does not — the stamp is two `stat` calls.

**Inherited risk, stated**: two writes inside one mtime tick at an identical size are invisible to the
stamp. This is the shipped list-cache exposure (`vault-list-cache` § *Incremental refresh of changed
sources only*), not a new one, and it is not widened here.

### D2: The stamp is taken twice, and only a stable snapshot is retained

```
stamp_before → take snapshot → stamp_after
   equal?  → retain, keyed by that stamp
   differ? → return the snapshot, retain nothing
```

The snapshot is atomic either way, so the caller's answer is correct either way. But a snapshot taken
while the store was being written cannot be attributed to either stamp, so it is used once and
dropped. Retaining it under `stamp_before` would be a lie the next reader would believe.

### D3: The pool owns disk, and disk is released three ways

A retained snapshot is a real file. It is deleted when it is superseded by a fresher one for the same
store, when it has gone unused for an idle interval, and when the pool is disposed at extension
shutdown. A snapshot that a caller is currently reading is never deleted underneath them: entries are
borrowed and released, and a superseded entry is deleted after its last release.

Bounded by count and by an idle interval rather than by bytes: the pool holds at most one snapshot per
store, and there are at most a handful of stores (one per agent). Byte accounting would add machinery
without changing the bound.

### D4: One in-flight snapshot per store

Concurrent reads of one store await the same promise rather than each running their own backup. Vault
list, detail and lookup routinely fire together on the same store, and before this change each paid a
full copy. The in-flight entry is keyed by store path and cleared when it settles, success or failure
— a failed snapshot must not be retained as a pending promise that later callers await forever.

### D5: The pool sits behind the existing entry points, not beside them

`readSqlite` and `withSqliteSnapshot` keep their signatures, statuses and callback contract. Only the
step that produces `dbCopy` changes: instead of always calling `takeSnapshot`, they borrow from the
pool and release when done. Every reader, and both engines, are unaffected by construction.

`SqliteDeps` gains the pool as an optional dependency so tests can drive it; production uses one
process-wide instance.

## Failure-surface inventory

| Resource | Answer |
|---|---|
| Who owns writes to the live store | The agent process, as before. This change adds no write and takes no lock on it |
| Who owns writes to retained snapshots | The pool alone. Each snapshot is written once by the engine into a `mkdtemp` directory, then read-only in effect |
| What serializes concurrent access | D4's in-flight map serializes production per store. Borrow/release refcounts serialize deletion against readers |
| Crash mid-write | A snapshot whose production threw is never retained (D2/D4), and its temp dir is removed by the same `finally` that removes an unpooled one |
| Failed or malformed read: open or closed | Closed, unchanged from the parent change: a snapshot that cannot be produced is `db-unreachable`/`query-error`, never `ok` with zero rows. A stamp that cannot be read (the `stat` fails) is treated as "changed", so it forces a fresh snapshot rather than reusing a possibly-stale one |
| Two racing hosts | Two extension hosts keep independent pools in independent temp dirs and never share a file. Neither can observe the other's snapshot |
| Crash of the whole process | Temp dirs are `mkdtemp` under the OS temp root, which the OS reclaims. Dispose deletes them on a clean shutdown (D3); an unclean kill leaves them for the OS, as it already does today |

## Risk Map

| Risk | Mitigation |
|---|---|
| A reused snapshot serves a stale answer, and `absent` deletes a live row | D1 gates on proven sameness, and the acceptance is behavioural: a session written between two reads must never be answered from the earlier snapshot |
| The double stamp still admits a write that lands inside one mtime tick | Inherited and stated (D1), not widened. Called out here so review can weigh it rather than discover it |
| Retained snapshots leak disk across a long session | D3's three release paths, each with its own test; the pool is bounded at one entry per store |
| A snapshot is deleted while a reader is mid-query | Borrow/release refcounting, with the superseded entry deleted only after its last release |
| The win is assumed rather than measured | Acceptance includes a measured comparison: a second read of an unchanged large store must not repeat the snapshot cost |
