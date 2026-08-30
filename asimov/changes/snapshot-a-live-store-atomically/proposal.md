# Proposal: snapshot-a-live-store-atomically

## Why

`src/vault/sqlite.ts` builds its "snapshot" of a live SQLite store by copying the base file and its
`-wal`/`-shm` sidecars as separate, independently-timed filesystem operations. That cannot be made
correct by ordering. Review reproduced a run where the sidecars are copied, the live store then
checkpoints and vacuums, the base is copied last, and the assembled result passes `integrity_check`
while silently missing a pre-existing row — a successful read of a state the store never held.

Two patches were attempted inside `tell-an-absent-session-from-an-unknown-one` (copy order both
ways) and each loses data on some interleaving; the ordering only selects which. That change's
review reached its cycle cap on this finding and handed the mechanism back.

It matters more now than when it shipped. Under the `VaultEntryLookup` contract that change
introduced, a false-empty read no longer stops at a missing row — it becomes a positive `absent`,
and the consumer waiting on it (`docs/PLAN.md` WT-011.5) retires a live session's preview on
`absent`. A silent snapshot gap turns into a deleted line for a session that is still running.

## Scope

- Replace multi-file copying with a single engine-atomic snapshot in both snapshot entry points
  (`readSqliteViaCopy`, `withSqliteSnapshot`), for both supported engines.
- Map every snapshot failure onto the existing status vocabulary, so a failure is never an empty
  result.
- Update the `agent-session-index` spec, which currently mandates the sidecar-copy mechanism by name.

## Non-goals / must-not

- **Must not** query the live store in place for data. The existing "never query live" promise stays;
  only snapshot *construction* reads the live store.
- **Must not** widen the status vocabulary. `ok` / `no-db` / `db-unreachable` / `no-sqlite3` /
  `query-error` already covers every outcome and its consumers are pinned by tests.
- **Must not** open the live store read-write. A snapshot is a read; the vault's write path
  (`writeSqlite`) is separate and out of scope.
- Not re-opening how readers *classify* results. `found`/`absent`/`unknown` is the parent change's
  work and is already reviewed; this change only stops feeding it a false empty.
- No new native dependency, and no change to which engine is preferred.

## Appetite

Small. One module, two call sites, one spec requirement. The mechanism is a drop-in replacement for
the body of an existing helper, and the evidence for it was gathered before planning.

## Risk

The snapshot now reads the live store through the SQLite engine rather than through `fs.copyFile`,
so a store that the engine refuses to open becomes a failure where it previously became a (wrong)
empty answer. That is the intended direction, but it converts some silent wrong answers into visible
`unknown`s, and any consumer that treated `ok`-with-zero-rows as normal will see `query-error`
instead. The list paths already count `query-error` as unreadable, so the visible effect is a
transient "unreadable" rather than a lost session.
