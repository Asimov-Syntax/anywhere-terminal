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

### D3: The pool owns disk, and disk is bounded by capacity as well as by age

A retained snapshot is a real file, and the pool is capped at both a snapshot COUNT and a total BYTE
budget. On admission, the pool evicts least-recently-used retained entries until the new snapshot
fits; if it still does not fit, the snapshot is returned as a one-shot lease and never retained.
Disk is therefore released five ways: superseded by a fresher snapshot for the same store, evicted to
make room, idle past an interval, disposed at shutdown, and — for anything unretained — released by
its last reader.

**Corrected premise (round-1 B2).** The first draft of this decision claimed the pool holds "at most
one snapshot per store, and there are at most a handful of stores (one per agent)", and dismissed byte
accounting on that basis. That is false: Cursor CLI gives every chat its own `store.db`
(`cursorPaths.ts:132`) and a list walks every candidate (`cursorReader.ts:407`). One snapshot per
store is thousands of snapshots, not a handful, and individual supported stores already exceed 1 GB.
An age-only bound limits how long a snapshot lives, never how much disk exists at once, so a burst
inside one idle window is unbounded. Capacity is the bound that matters; the idle interval only
reclaims a quiet pool.

A snapshot a caller is currently reading is never deleted underneath them, whichever path releases it:
entries are borrowed and released by refcount, and an entry removed from the pool for any reason is
deleted at its last release.

### D3a: Dispose is a barrier, not a sweep

Shutdown must leave nothing behind, so `dispose` is a closed state rather than a single pass over the
retained map. It rejects new borrows, awaits every in-flight production so a snapshot cannot be
created after the sweep that was supposed to remove it, refuses to retain anything once closed, and
awaits outstanding leases before deleting what they hold. A pass that only drains the map (round-1 B3)
leaves exactly the file the shutdown scenario is about: one whose production settled after disposal.

### D4: One in-flight snapshot per store, joined only on a matching generation

Concurrent reads of one store await the same promise rather than each running their own backup. Vault
list, detail and lookup routinely fire together on the same store, and before this change each paid a
full copy. The in-flight entry is keyed by store path and cleared when it settles, success or failure
— a failed snapshot must not be retained as a pending promise that later callers await forever.

**Joining is gated on the same stamp that gates reuse (round-1 B1).** The in-flight entry carries the
stamp its producer started from. A caller joins only when its own stamp equals that one; a caller that
has already observed a newer store waits for the flight to settle and then takes its own snapshot.
Without this gate the pool honours the stamp for a retained snapshot and ignores it for an in-flight
one, which serves a pre-write snapshot to a post-write reader — a false `absent` by the same mechanism
D1 exists to prevent, reached by a different door.

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
| What serializes concurrent access | D4's in-flight map serializes production per store, and joins it only on a matching generation. Borrow/release refcounts serialize deletion against readers, including under capacity eviction |
| Crash mid-write | A snapshot whose production threw is never retained (D2/D4), and its temp dir is removed by the same `finally` that removes an unpooled one |
| Failed or malformed read: open or closed | Closed, unchanged from the parent change: a snapshot that cannot be produced is `db-unreachable`/`query-error`, never `ok` with zero rows. A stamp that cannot be read (the `stat` fails) is treated as "changed", so it forces a fresh snapshot rather than reusing a possibly-stale one |
| Two racing hosts | Two extension hosts keep independent pools in independent temp dirs and never share a file. Neither can observe the other's snapshot |
| Crash of the whole process | Temp dirs are `mkdtemp` under the OS temp root, which the OS reclaims. Dispose deletes them on a clean shutdown (D3); an unclean kill leaves them for the OS, as it already does today |

## Risk Map

| Risk | Mitigation |
|---|---|
| A reused snapshot serves a stale answer, and `absent` deletes a live row | D1 gates on proven sameness, and the acceptance is behavioural: a session written between two reads must never be answered from the earlier snapshot |
| The double stamp still admits a write that lands inside one mtime tick | Inherited and stated (D1), not widened. Called out here so review can weigh it rather than discover it |
| Retained snapshots leak disk across a long session | D3's capacity bound (count + bytes, LRU) plus its release paths, each with its own test |
| A burst of per-chat stores fills the temp volume inside one idle window | D3's byte budget, admitted after round-1 B2 disproved the "handful of stores" premise |
| A snapshot outlives a clean shutdown | D3a makes dispose a barrier over in-flight productions and outstanding leases, not a single sweep |
| A snapshot is deleted while a reader is mid-query | Borrow/release refcounting, with the superseded entry deleted only after its last release |
| The win is assumed rather than measured | Acceptance includes a measured comparison: a second read of an unchanged large store must not repeat the snapshot cost |
