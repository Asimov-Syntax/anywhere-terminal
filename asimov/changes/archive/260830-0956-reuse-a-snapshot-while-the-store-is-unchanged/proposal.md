# Proposal: reuse-a-snapshot-while-the-store-is-unchanged

## Why

`snapshot-a-live-store-atomically` made vault reads correct and made them expensive. Its review
measured the cost rather than estimating it: a 522 MB store snapshots in 951 ms via the engine where
the old file-copy took 5 ms as an APFS clone — roughly 190×, linear in pages, against an OpenCode
store known to exceed 1 GB. That is about 2.5 s added to every list, detail, lookup and resume
identity check on the primary platform, and concurrent callers each pay it in full.

The old mechanism was cheap because a copy-on-write clone is O(1); it was also wrong, which is why it
went. The cost is not recoverable by picking a different engine operation — the Online Backup API and
`VACUUM INTO` are both O(live pages). It is recoverable by not taking a new snapshot for a store
nobody has written to.

That is a strong condition, not a heuristic: the repo already stamps a store as `(mtimeMs, size)` over
its `.db` and `-wal` (`storeStamp.ts`, shipped for the list cache). Any commit changes the `-wal`
mtime; a checkpoint changes the `.db`. So an equal stamp means no write landed, and a snapshot taken
under that stamp answers exactly what a fresh one would — including about absence, which is what the
`VaultEntryLookup` consumer depends on.

`snapshot-a-live-store-atomically` is blocked from archiving until this lands.

## Scope

- Retain a snapshot per store and reuse it while the store's stamp is unchanged.
- Coalesce concurrent reads of one store onto a single in-flight snapshot.
- Own the retained snapshots' lifetime: eviction when stale or idle, deletion on process shutdown.
- Wire both entry points (`readSqlite`, `withSqliteSnapshot`) through it.

## Non-goals / must-not

- **Must not** weaken the atomicity contract. A reused snapshot is a snapshot that was taken
  atomically; reuse changes when it was taken, never how.
- **Must not** serve a read from a snapshot whose store has changed. Reuse is gated on proven
  sameness, never on a timer alone.
- **Must not** invent a second freshness notion. `storeStamp.ts` is the shipped one and its risk
  profile — two writes inside one mtime tick at identical size — is already accepted by the list
  cache; this change inherits it rather than defining a stricter or looser rule.
- Not a query cache. Rows are not retained, only the snapshot file they would be read from.
- Not a cross-process cache. Retained snapshots are private to this extension host.

## Appetite

Small-to-medium. One new module owning the pool, plus wiring at the two existing entry points. The
invalidation key and the atomic snapshot it reuses both already exist.

## Risk

The failure mode this introduces is serving a stale answer, which under the `VaultEntryLookup`
contract could mean a false `absent` — the exact failure the parent chain exists to remove. The
mitigation is that the gate is proven sameness rather than elapsed time: if a session was written,
the store changed, the stamp changed, and no reuse happens. The residual is the stamp's own
granularity, which is shipped and already relied upon elsewhere in this subsystem.

Second risk: retained snapshot files are real disk. A pool that evicts badly could hold several
gigabytes, or leak them past shutdown.
