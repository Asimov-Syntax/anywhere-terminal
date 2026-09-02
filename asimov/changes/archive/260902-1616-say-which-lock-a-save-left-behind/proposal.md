# Proposal: say-which-lock-a-save-left-behind

## Why

A save takes a lock beside the configuration file and removes it afterwards. When that removal fails,
the lock stays — and locks here are deliberately never reclaimed by age, so every later save of that
file waits for a holder that no longer exists and then times out. Nothing currently tells the user
this happened, or which file to remove.

The obvious fix was attempted inside WT-012.19 and reverted, because it was worse than the silence.
`LockedFile.releaseLock` answers a BOOLEAN, and `false` covers four different situations of which only
one is a leaked lock. Reporting the pathname for all four told the user to delete a lock that was
another writer's and still LIVE — destroying the mutual exclusion the lock exists to provide.

## Scope

- A typed release disposition on the primitive, replacing the boolean, so callers can tell the four
  situations apart.
- A user-facing report that names a lock ONLY when it is confirmed still present and still this
  save's own.
- A save that wrote and then failed to release is described as written, not as unsaved.

## Non-goals / must-not

- MUST NOT name a lock that is free, or one that belongs to another writer.
- MUST NOT reclaim, steal or break any lock — no age-based or staleness-based recovery. Refusing to
  act is the whole point of the current design.
- MUST NOT address the cause of `notOurs` — a name that now reaches a different writer's lock is a
  directory/leaf substitution, owned by WT-012.21.
- MUST NOT change what an ordinary save reports.

## Appetite

M. Four layers — primitive, writer, wire, renderer — but a narrow change in each.

## Risk

The wire gains a `reason` value, so every renderer that switches on it must be checked. The primitive
is shared by both config writers, so its disposition change must leave the installer's behaviour
identical.
