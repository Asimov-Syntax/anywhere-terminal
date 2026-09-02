# Discovery: never-release-a-lock-a-pending-write-still-owns

## Evidence

- Round-3 F003 injected a target staged writer that never resolves; a 10 ms allocation remained pending after 100 ms while holding the common lock.
- `LockedFile.withLock()` awaits work and then releases before returning. A caller cannot return early while keeping serialization under the current contract.
- Node offers no safe cancellation for `open`, `mkdir`, `link`, `rename`, `chmod`, `stat`, or `unlink`; aborting `writeFile` does not cancel an operating-system request already in flight.
- A child process cannot satisfy both absolute bounds on an uninterruptible syscall and proof that no mutation occurs after timeout.
- The repository already accepts unreclaimed crash locks as fail-closed administrative locks rather than stealing them by age.

## Options

| Option | Result bound | Late-mutation safety | Disposition |
|---|---|---|---|
| Retain lock when deadline catches a mutation in flight | Bounded result | Late mutation remains serialized | Selected by user |
| Wait indefinitely | Unbounded | Safe serialization | Rejected |
| Worker process and kill | Best effort | Cannot guarantee an uninterruptible syscall stops | Rejected |
| Race mutation then release lock | Bounded | Unsafe late publication | Rejected |

## Accepted direction

The user selected **Retain lock fail-closed** on 2026-09-02. A clean timeout releases normally; only a timeout with a mutation in flight retains the lock and requires explicit cleanup.
