# worktree-panel — delta

## ADDED Requirements

### Requirement: A locked write decides ownership on identities that cannot round

A write that removes or replaces a file it believes it created SHALL decide that belief on filesystem
identities compared without loss of precision, so that a different file cannot be mistaken for the
one it owns.

### Requirement: A save whose lock could not be released says so

WHERE a save completes its write but cannot release the lock it took, the outcome reported to the
user SHALL say that the file may stay locked, rather than reporting an ordinary success. A save that
takes and releases its lock normally SHALL continue to report ordinary success.

#### Scenario: The lock is gone when the save tries to release it

- **WHEN** the user saves and the lock the save holds is removed by something else before the save
  releases it
- **THEN** the save reports that the write landed but the file may stay locked

### Requirement: An ordinary save is unaffected

WHERE the filesystem is quiescent, saving SHALL read, write and report exactly as it does today.
