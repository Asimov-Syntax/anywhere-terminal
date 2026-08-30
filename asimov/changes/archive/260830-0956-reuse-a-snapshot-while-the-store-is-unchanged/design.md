# Design: reuse-a-snapshot-while-the-store-is-unchanged

## Decisions

### D1: Reuse is gated on proven sameness, never on elapsed time

A retained snapshot is reused only when the store's GENERATION is provably equal to the one the
snapshot was taken under. A generation is the `(mtimeMs, size)` of the `.db` and its `-wal` — `-shm`
excluded, per `storeStamp.ts`, as volatile wal-index state that causes false invalidations.

Any commit rewrites the `-wal` mtime and any checkpoint rewrites the `.db`, so an equal generation
means no write landed, and a snapshot taken under it answers what a fresh one would — including about
absence, which a TTL could never establish. There is no time-based expiry for correctness; the idle
timer exists only to release disk (D3).

**A generation must be read coherently, or it proves nothing (round-2 B5).** The first draft of this
decision called two sequential `stat` calls a proof. They are not: `.db` observed at one instant and
`-wal` at another is a mixed-time reading, and a retained `{db:S0}` with no WAL can be matched by a
read that sees `.db` before a checkpoint and `-wal` after that checkpoint's close removed it — equal
values spanning a completed write, which is a false `absent`. So a generation is read TWICE in a fixed
`db, wal, db, wal` order and is usable only when both readings agree. That is sufficient rather than
merely safer: the bad interleaving needs both `.db` reads before the checkpoint and both `-wal` reads
after the deletion, yet the second `.db` read falls after the first `-wal` read and would observe the
checkpointed file. The interleaving contradicts itself.

**Only proven absence may be read as "no WAL" (round-2 B4).** A `stat` that fails for any reason other
than ENOENT/ENOTDIR says the process could not find out, and must make the generation unusable rather
than silently reading as a WAL-free store. This is the repository's existing rule, not a new one:
`provesAbsence` in `src/utils/fsPresence.ts` already owns it for exactly this reason.

An unusable generation is never a reason to serve a stale answer: the read produces a fresh snapshot
and retains nothing.

**The premise is sourced, not assumed** (`docs/research/20260830-opencode-orca-sqlite-idle-cadence.md`).
Reuse only pays if the files sit still between reads, so OpenCode's own writer was read: WAL,
`synchronous=NORMAL`, one long-lived connection, and no `wal_autocheckpoint` setting — with no idle
timer that writes or checkpoints. Its only checkpoint is one PASSIVE call at startup, and SQLite's
automatic checkpoints are commit-driven, not clock-driven. An idle store therefore does not churn
its own generation. Measured against the live 1.5 GB `opencode.db`: 2.4–3.0 s per read without
retention, 1 ms with.

The same research shows Orca solving the neighbouring problem with a WEAKER key — its OpenCode usage
cache compares `(mtimeMs,size)` of the `.db` alone. A commit still resident in the WAL leaves the
`.db` untouched, so that key reuses across a completed write. That is the false-`absent` failure this
chain exists to close, which is why `-wal` is in the key and `-shm` is not.

**Rejected**: `PRAGMA data_version` as the generation. It is strictly better than mtime on
granularity — it moves only when ANOTHER connection commits — but it is comparable only between two
reads on the SAME connection. Using it would mean holding a long-lived read-only handle open on
every agent's store for the life of the host, which is a new resource the pool would own on the live
store, against a risk (two writes inside one mtime tick at an identical size) the list cache already
accepts.

**Rejected**: a short TTL (1–2 s) instead of a generation. It would answer `absent` for a session written
during the window, which is the precise failure the whole parent chain exists to remove, and it would
buy nothing a stamp does not — the stamp is two `stat` calls.

**Inherited risk, stated**: two writes inside one mtime tick at an identical size are invisible to the
generation. This is the shipped list-cache exposure (`vault-list-cache` § *Incremental refresh of
changed sources only*), not a new one, and it is not widened here. Note the distinction from B5: that
risk is about the RESOLUTION of the values, this decision is about reading them COHERENTLY, and only
the second was a defect in the argument.

**One owner for the store's file set.** The `.db`-plus-`-wal` path set is built in the pool and in both
persisted-cache readers. It becomes one exported helper, so the reuse gate and the list cache cannot
answer the same freshness question from separately-authored path sets (round-2 W4).

### D2: The stamp is taken twice, and only a stable snapshot is retained

```
stamp_before → take snapshot → stamp_after
   equal?  → retain, keyed by that stamp
   differ? → return the snapshot, retain nothing
```

The snapshot is atomic either way, so the caller's answer is correct either way. But a snapshot taken
while the store was being written cannot be attributed to either stamp, so it is used once and
dropped. Retaining it under `stamp_before` would be a lie the next reader would believe.

### D3: Retention is bounded by construction, not by enforcement

Retention is opt-in per call site, and only the readers of an agent's ONE primary store ask for it.
The retained set is therefore keyed by a fixed, small set of paths computed from fixed locations —
one per agent — and needs no LRU, no byte budget, no capacity eviction and no reservation. The bound
is a property of what can be a key, not of a policy that has to be enforced correctly under
concurrency.

Disk is released three ways: superseded by a fresher snapshot for the same store, unused past an idle
interval, and disposed at shutdown. A snapshot nobody asked to retain — the per-chat Cursor path — is
deleted by its last reader, exactly as an unretained one always was.

**Why this is the right bound (round-4 B8, measured).** Cursor CLI gives every chat its own
`store.db`: on the development machine, 72 of them at 60 KB each, about 4 MB in total. The stores that
are expensive to snapshot are a fixed set — `opencode.db` at 1.4 GB, Cursor IDE's `state.vscdb` at
122 MB, Codex's `state_5.sqlite` at 400 KB — one per agent. The earlier design put both classes in one
pool and then needed LRU and byte accounting to referee them. That contest was never real: the
unbounded-count axis is entirely files too small to be worth retaining, and the costly files cannot
grow in number. Removing the contest removes the machinery.

**Rejected**: keeping the byte budget and fixing its accounting. Three cycles of local counters
(B2 → B6 → B8) failed to make "live bytes" a hard cap, because bytes are subtracted from victims
before their disk is releasable and newcomers are published before deletions complete. A cap that
must be maintained correctly across suspension points is a weaker guarantee than a key space that
cannot grow.

**A lease is taken at publication (round-4 B7).** An entry becomes visible to the pool only once its
producing borrow holds a lease on it, so it can never be superseded and deleted in the window before
its own reader receives it. With cross-store eviction gone there is no foreign victim at all; this
closes the remaining same-store case.

**Ownership ends when the disk does (round-2 W3, round-4 W7).** An entry is dropped only after its
directory is actually gone; a failed deletion keeps its entry and is retried, and the cleanup sweeper
stays alive while anything retry-eligible remains, rather than stopping because no snapshot is
currently retained.

### D3a: Dispose is a barrier, not a sweep

Shutdown must leave nothing behind, so `dispose` is a closed state rather than a single pass over the
retained map. It rejects new borrows, awaits every in-flight production so a snapshot cannot be
created after the sweep that was supposed to remove it, refuses to retain anything once closed, and
awaits outstanding leases before deleting what they hold. A pass that only drains the map (round-1 B3)
leaves exactly the file the shutdown scenario is about: one whose production settled after disposal.

**The barrier drains a registry of admitted work, not the states it can see (round-2 B3).** Draining
the joinable-flight map misses two real cases: a borrow that passed its disposal check and is parked on
its first stamp, and a producer displaced from the per-store binding when a waiting caller replaced it.
Both are live work invisible to that map. So every borrow is admitted to a registry before its first
await and leaves it when it settles, and disposal drains THAT to quiescence — a disposal that resolves
while any admitted operation is outstanding is the bug, whatever map the operation is or is not in.

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
| What serializes concurrent access | D4's in-flight map serializes production per store, and joins it only on a matching generation. Borrow/release refcounts serialize deletion against readers, and the producing borrow holds its lease from publication |
| Crash mid-write | A snapshot whose production threw is never retained (D2/D4), and its temp dir is removed by the same `finally` that removes an unpooled one |
| Failed or malformed read: open or closed | Closed, unchanged from the parent change: a snapshot that cannot be produced is `db-unreachable`/`query-error`, never `ok` with zero rows. A stamp that cannot be read (the `stat` fails) is treated as "changed", so it forces a fresh snapshot rather than reusing a possibly-stale one |
| Two racing hosts | Two extension hosts keep independent pools in independent temp dirs and never share a file. Neither can observe the other's snapshot |
| Crash of the whole process | Temp dirs are `mkdtemp` under the OS temp root, which the OS reclaims. Dispose deletes them on a clean shutdown (D3); an unclean kill leaves them for the OS, as it already does today |

## Risk Map

| Risk | Mitigation |
|---|---|
| A reused snapshot serves a stale answer, and `absent` deletes a live row | D1 gates on proven sameness, and the acceptance is behavioural: a session written between two reads must never be answered from the earlier snapshot |
| The double stamp still admits a write that lands inside one mtime tick | Inherited and stated (D1), not widened. Called out here so review can weigh it rather than discover it |
| Retained snapshots leak disk across a long session | D3's fixed key space — one snapshot per agent, not per read — plus its three release paths, each with its own test |
| A burst of per-chat stores fills the temp volume inside one idle window | Those stores retain nothing (D3): each is deleted by its own last reader, as an unretained snapshot always was |
| A snapshot outlives a clean shutdown | D3a makes dispose a barrier over in-flight productions and outstanding leases, not a single sweep |
| A snapshot is deleted while a reader is mid-query | Borrow/release refcounting, with the superseded entry deleted only after its last release |
| The win is assumed rather than measured | Measured on the live 1.5 GB `opencode.db`: 2.4–3.0 s per read unretained, 1 ms reused, and a write correctly forces a fresh snapshot |
| The win is real but never realised, because the store never sits still | Read from OpenCode's source rather than assumed: no idle write or checkpoint timer exists (D1) |
| A generation is read across a write and looks unchanged | D1's coherent double read in fixed order, whose failing interleaving is self-contradictory; acceptance drives the interleaving rather than arguing it |
| A stat failure is read as "no WAL" | D1 defers to `provesAbsence`: only ENOENT/ENOTDIR reads as absence, everything else makes the generation unusable |
| Shutdown races work the barrier cannot see | D3a's admitted-work registry, entered before the first await |
