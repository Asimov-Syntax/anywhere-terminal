# Proposal: prove-the-store-is-readable-not-merely-there

## Why

The vault's two SQLite entry points answer one question — what is the status of this store — and
disagree once a store exists but cannot be read. The presence check proves the file is THERE
(`fs.access` in its default mode, F_OK) and the snapshot pool's reuse gate proves its
`(mtimeMs, size)` is unchanged. Neither proves the process can still READ it, so revoking read
permission on the database file leaves a retained snapshot serving `ok` while a cold read of the same
store returns `db-unreachable`.

The bytes behind a retained snapshot were read lawfully when it was taken, so this is a
status-contract divergence rather than a disclosure. But two paths answering one question differently
is exactly what a discriminated status vocabulary exists to prevent, and a caller cannot tell which
answer it is holding.

Raised as W4 in `snapshot-a-live-store-atomically` cycle 2 round 4 and parked there as a decision
rather than a patch.

## Appetite

S (≤1d)

## Scope

### In scope

- A store that exists but cannot be read reporting the same status through a reused snapshot as
  through a fresh one
- File-level read-permission revocation covered for both entry points

### Out of scope

- Directory search permission, which fails earlier and never reaches this boundary — already covered
- What the snapshot pool retains, how long it retains it, and the `(mtimeMs, size)` reuse gate itself
- Any change to the status vocabulary's members

### Must not

- Add a syscall per pool hit
- Let an unreadable store report `no-db` — absence and unreachability are different answers, and
  `fsPresence` already owns which failures prove which
- Split the proof across two owners, so that one entry point proves readability and the other does not

## Risk Level

LOW — one predicate, already on both entry points, made to prove what its callers already assume. The
failure it guards against is a wrong status, not a wrong read.
