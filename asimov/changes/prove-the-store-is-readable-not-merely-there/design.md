# Design: prove-the-store-is-readable-not-merely-there

## Decisions

### D1: The presence check proves readability, because it already runs on both paths

The blueprint framed this as a three-way fork — prove it in the presence check, fold access state into
the reuse generation, or prove it at the pool boundary — and warned that each moves an accepted
contract. Read against current code, two of the three are unnecessary and the third is a
one-line change.

`presence()` (`src/vault/sqlite.ts:299`) is already the single answer for both entry points, and both
call it BEFORE any pool work: `readSqlite` at `:463` and `withSqliteSnapshot` at `:527`, which returns
`no-db`/`db-unreachable` and only then reaches `withPooledSnapshot`. So the reuse path is not a second
path that skips the check — it is the same check, asking a question too weak to separate the two
cases.

`defaultAccess` calls `fs.access(p)`, which is `F_OK`: the file exists. Asking `R_OK` instead proves
what every caller of this predicate goes on to assume. The syscall count does not change — one
`fs.access` either way — so the appetite's "no syscall per pool hit" holds by construction rather than
by a second rule.

The other two candidates are rejected on that basis. Folding access state into the generation adds a
third input to a two-input proof AND a syscall per reuse, to reach an answer the existing call can
already give. Proving it at the pool boundary would give one entry point a proof the other lacks,
which is the divergence restated rather than closed.

### D2: This does not move the line between absent and unreachable

The blueprint's stated objection — that proving `R_OK` "changes what separates `no-db` from
`db-unreachable`" — does not survive contact with `presenceFromAccessError`
(`src/utils/fsPresence.ts`), which is the sole owner of that line: `ENOENT`/`ENOTDIR` prove absence,
and everything else, `EACCES` included, is `unreachable`.

A failed `R_OK` on a file that exists raises `EACCES`, not `ENOENT`, so it maps to `unreachable`
through the rule that is already there. Nothing about absence changes, and the vocabulary keeps its
members. What changes is only that a store the process cannot read stops being called `present`.

An unreadable store already answered `db-unreachable` on a cold read, because the copy or query that
followed the presence check failed. This makes the presence check agree with the outcome the rest of
the path was always going to produce, one step earlier and on both paths.

## Failure-surface inventory

| Resource | Answer |
|---|---|
| The store file on disk | Read-only, and this change strictly narrows what the vault will attempt to open. Owned by a running agent; the vault never writes it. A concurrent permission change is the case under test — the answer is a status, not an error, and the next call re-asks |
| The retained snapshot pool | Unchanged by this task: the presence check runs before it on both entry points, so an unreadable store no longer reaches it. Nothing about retention, eviction, or the `(mtimeMs, size)` gate moves. n/a for crash — the pool is process-local and disposed with the host |
| The temporary snapshot directory | Untouched: a store that fails the presence check never gets as far as taking one, so this change creates strictly fewer of them |

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `defaultAccess` | A store that IS readable starts reporting unreachable — every vault read breaks at once | `R_OK` is what the subsequent copy/open needs; the existing suite reads real stores end to end on both entry points and would fail wholesale |
| Status vocabulary | An unreadable store reports `no-db`, so a caller renders "no sessions" for a store that is there | D2 — `presenceFromAccessError` maps `EACCES` to `unreachable`; unit test asserts the status for a present-but-unreadable file on both entry points |
| Reuse path | The fix lands on the cold path only, leaving the divergence open | Unit test revokes read permission AFTER a snapshot has been retained and asserts the reused path agrees with a cold read |
| Root and CI | A process running as root can read a `0o000` file, so the test proves nothing where it matters | The test skips when it can still read the file after revoking permission, and says so, rather than passing vacuously |
