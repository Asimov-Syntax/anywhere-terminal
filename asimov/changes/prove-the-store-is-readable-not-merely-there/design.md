# Design: prove-the-store-is-readable-not-merely-there

## Decisions

### D1: The proof belongs in the generation read, which already owns the store's file set

> **Supersedes the first D1 (round-1 B1), which put the proof in the presence check.** That answer is
> refuted, not merely incomplete: `fs.access(p, R_OK)` on `dbPath` says nothing about the `-wal`
> sidecar a WAL-mode store also needs, and `fs.access` does not consult Windows ACLs, which this
> project supports. The reviewer's probe demonstrated the divergence surviving the fix — base file
> readable, `-wal` not, fresh query failing with errcode 14 while the retained generation stayed
> reusable. No choice of `mode` flag closes either gap.

`readStoreGeneration` (`src/vault/storeStamp.ts:89`) is already the right owner and already has
almost the right rule. It walks `storeFilePaths(dbPath)` — the `.db` AND the `-wal` — and `readOnce`
already refuses to call a generation usable when a path's state could not be determined, with the
comment saying exactly why: "an EACCES on the `-wal` must never read as a WAL-free store."

The one thing wrong is what it asks. `fs.stat` needs search permission on the directory, not read
permission on the file, so it succeeds on a store this process cannot read — the stamps come back
unchanged, `usable` stays true, and `snapshotPool.ts:141` reuses the retained snapshot. Prove
readability in that probe instead and every consequence is already wired: an unreadable path makes
the generation unusable, the reuse gate fails, the pool falls through to producing a fresh snapshot,
and that fails exactly as a cold read does. The two paths converge without a new branch anywhere.

Proving it means OPENING the file for reading — `fs.open(p, "r")`, stat through the handle, close.
An open is what consults an ACL, so this covers Windows where `access` cannot, and it covers the file
set because the loop already does. Stat-through-the-handle also makes each stamp describe the file
the pass actually opened.

### D2: The presence check goes back to proving existence

With D1 owning readability, the presence check has no reason to ask for more, and two reasons not to.

It is shared with the write path: `defaultWriteDeps` is `{ exists: defaultDeps.exists }`
(`src/vault/sqlite.ts:614`), so strengthening it made an existing but unreadable store answer `no-db`
— documented as ABSENT — instead of reaching SQLite and returning `write-error` (round-1 W1). That
was a regression on a path this task never intended to touch.

And it is the wrong place on its own terms: a presence check that proves readability still proves it
for one file at one instant, which is the gap D1 exists to close.

So `defaultAccess` returns to `fs.access(p)`, and `no-db` keeps meaning what it documented.

### D3: The reuse path gains work per hit, and that is the recorded decision

The proposal's Must-not said "add a syscall per pool hit", written when the fix looked free. It is not
free, and nothing that actually proves readability can be: proving a file can be read means attempting
to read it.

The PLAN row anticipated this — "the reuse path does not gain a syscall per hit **unless that is the
decision recorded**" — so this records it. Per path per pass, one `stat` becomes an `open` + an
`fstat` + a `close`. `readStoreGeneration` makes two ordered passes over two paths, so a reuse goes
from 4 stats to 4 opens, 4 fstats and 4 closes.

That is bounded, proportionate, and on the cheap side of what it guards: the alternative branch
produces a snapshot, which copies the whole store. It buys the acceptance the stat-based gate cannot
give at any price.

### D4: `stampStoreFiles` keeps asking `stat`

`readOnce` is shared with `stampStoreFiles`, whose own comment records a deliberate difference: "this
caller has always treated any unreadable path as omit, and tightening that is a cache-invalidation
change, not a de-duplication."

That warning stands and this change honours it. The probe is a parameter of `readOnce`, so
`readStoreGeneration` passes the readability-proving one and `stampStoreFiles` passes plain `stat`.
The list cache's invalidation behaviour does not move.

## Failure-surface inventory

| Resource | Answer |
|---|---|
| The store's `.db` and `-wal` on disk | Opened READ-ONLY and closed immediately; never written. Owned by a running agent. A handle leak would hold a descriptor against a file the agent is writing, so every open closes in a `finally`. A permission change between the two ordered passes is the case under test: the passes disagree, the generation is unusable, and the caller re-asks |
| The retained snapshot pool | Unchanged in structure. An unusable generation already fails the reuse gate at `snapshotPool.ts:141` and falls through to production; this change only makes an unreadable store produce that answer. n/a for crash — process-local, disposed with the host |
| File descriptors | The only new durable resource. Bounded by one at a time per path within a sequential loop, released before the next path. n/a for two hosts — read-only opens do not exclude each other |

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `readOnce` probe | A descriptor leaks on the error path, exhausting the process's limit under repeated polling | Open and close in the same `try`/`finally`; unit test asserts the descriptor count does not grow across many generation reads against an unreadable store |
| `stampStoreFiles` | The shared loop tightens the list cache's invalidation as a side effect | D4 — the probe is a parameter; unit test asserts an unreadable path is still omitted rather than making the stamp set unusable |
| Write path | `no-db` keeps its widened meaning and a write to an unreadable store reports absence | D2 — `defaultAccess` returns to `fs.access(p)`; unit test asserts an existing unreadable store reaches SQLite and answers `write-error`, not `no-db` |
| Reuse gate | An unreadable `-wal` still reuses, so the divergence survives again | Unit test revokes read on the `-wal` ALONE, leaving the `.db` readable, and asserts the reused and fresh paths agree — the exact shape of the reviewer's probe |
| Test honesty | The case passes vacuously where permissions do not bite, or compares against a pooled read that is not cold | Round-1 W2 — a second store key for the fresh path, and Vitest's runtime skip rather than a warning and an early return |
| Cost | The added opens show up on a hot poll | D3 — bounded and recorded; unit test counts opens per reuse and pins the number |
