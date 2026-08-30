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

Proving it means OPENING the file for reading — `fs.open(p, "r")`, then close. An open is what
consults an ACL, so this covers Windows where `access` cannot, and it covers the file set because the
stamps already name it.

**One pass, beside the two stat passes rather than inside them.** The first attempt replaced the stat
in each ordered pass with an `open` + `fstat` + `close`, which is the arrangement this section
originally described, and it broke `snapshotPool.test.ts` — "keeps a shared unretained snapshot alive
until its last reader is done". The cost of proving readability is latency, not only syscalls, and
that latency widened `readGeneration` enough that a second borrower missed the in-flight join window
and produced a redundant snapshot.

The two ordered passes exist for STAMP coherence: they defeat a checkpoint landing between the `.db`
and `-wal` reads. Readability is not part of that claim — it is a gate on the result — so it does not
need the ordered repetition. The stamps are read as before, and the paths the stamps name are opened
once afterwards.

**The check/use boundary this leaves.** Readability is proven after the stamps, so a permission change
between the two is observable, and one after the proof is observable too. That is the ordinary
check-then-use race the presence check already had and cannot be closed by a predicate: only the
eventual open inside SQLite is authoritative. What matters is that no caller ACTS on a stale
`usable` beyond re-asking — an unusable generation fails the reuse gate and produces a fresh
snapshot, which fails or succeeds on its own evidence.

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
decision recorded**" — so this records it, at the cost the shipped arrangement actually has rather
than the one first designed.

The two ordered stat passes are unchanged: 4 stats for a store with a `-wal`. Added on top is one
`open` + `close` per STAMPED path, once — so at most 2 opens and 2 closes, and only for paths the
stamps proved exist. A store with no `-wal` costs one.

The rejected arrangement — proving it inside both passes — would have been 4 opens, 4 fstats and 4
closes, and its latency is what broke in-flight joining. That is the concrete reason the cheaper
placement is also the correct one, and it is worth stating because the expensive one reads as the more
careful choice.

Either way this is on the cheap side of what it guards: the alternative branch produces a snapshot,
which copies the whole store. It buys the acceptance the stat-based gate cannot give at any price.

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
| The store's `.db` and `-wal` on disk | Opened READ-ONLY and closed immediately; never written. Owned by a running agent. A handle leak would hold a descriptor against a file the agent is writing, so every open closes in a `finally`, and a close that itself fails makes the generation unusable rather than escaping as an error (round-2 W1). Readability is proven AFTER the stamps, so a permission change in between — or after — is an ordinary check-then-use race no predicate can close; nothing acts on a stale verdict beyond re-asking, and the eventual open inside SQLite is what is authoritative |
| The retained snapshot pool | Unchanged in structure. An unusable generation already fails the reuse gate at `snapshotPool.ts:141` and falls through to production; this change only makes an unreadable store produce that answer. n/a for crash — process-local, disposed with the host |
| File descriptors | The only new durable resource. Bounded by one at a time per path within a sequential loop, released before the next path. n/a for two hosts — read-only opens do not exclude each other |

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| The readability pass | A descriptor leaks on the error path, exhausting the process's limit under repeated polling | Open and close in the same `try`/`finally`; unit test asserts the descriptor count does not grow across many generation reads against an unreadable store |
| A failing `close` | The rejection escapes the verdict, so `readStoreGeneration` throws, the pool never reaches fresh production, and the caller sees a misclassified `query-error` | Round-2 W1 — a close failure makes the generation unusable and is not propagated; unit test drives a rejecting `close` and asserts the generation is unusable rather than the call rejecting |
| `stampStoreFiles` | The shared loop tightens the list cache's invalidation as a side effect | D4 — the probe is a parameter; unit test asserts an unreadable path is still omitted rather than making the stamp set unusable |
| Write path | `no-db` keeps its widened meaning and a write to an unreadable store reports absence | D2 — `defaultAccess` returns to `fs.access(p)`; unit test asserts an existing unreadable store reaches SQLite and answers `write-error`, not `no-db` |
| Reuse gate | An unreadable `-wal` still reuses, so the divergence survives again | Unit test revokes read on the `-wal` ALONE, leaving the `.db` readable, and asserts the reused and fresh paths agree — the exact shape of the reviewer's probe |
| Test honesty | The case passes vacuously where permissions do not bite, or compares against a pooled read that is not cold | Round-1 W2 — a second store key for the fresh path, and Vitest's runtime skip rather than a warning and an early return |
| Cost | The added opens show up on a hot poll | D3 — bounded and recorded; unit test counts opens per reuse and pins the number |
