# Proposal: open-a-provider-file-without-waiting-on-it

## Why

`readBounded` advertises a bound and enforces it on the READ, never on the OPEN. `open(p, "r")` on a
POSIX named pipe with no writer waits forever, so a repository can make the provisioning section
stop answering; and since `write-only-the-native-config-file` moved base validation under the
native-config lock, the same wait now strands the lock and turns every later save into
`unavailable`. Both reproduce on this host today.

## Appetite

S

## Scope

### In scope

- The provider read every adapter shares (`readBounded`), so no read of a repository-named
  configuration can wait on an object that will not answer.
- `LockedFile.readText`, the second place a repository-controlled path is opened for reading while
  a lock is held. Its other caller, the Claude hook installer, inherits the bound.

### Out of scope

- Reads that materialize a worktree's files (`applyEntries`, `copyFileNoFollow`). Same class of
  object, different owner and different change (WT-012.2).
- A timeout, deadline, or cancellation facility. This change refuses an object it can identify; it
  does not bound a slow or hung filesystem, which no `O_NONBLOCK` closes either.

### Must not

- Add any file rule to `writeNativeConfig`. Round-6 F025 spent four review rounds refuting a writer
  that reconstructs a rule, and the plan attack refuted this change's own first attempt to give the
  writer a target-type check: `lstat` then a path-based read is a race the check cannot close.
- Let a writerless pipe read as an empty configuration. `O_NONBLOCK` alone opens it and returns
  zero bytes, which would silently replace "unreadable" with "declares nothing".

## Risk Level

MEDIUM — the changed line is the single read behind every provider adapter, so a mistake in the
flag composition or the file-type test degrades every ordinary read rather than only the hostile
case.
