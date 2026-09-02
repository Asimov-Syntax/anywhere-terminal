# worktree-panel — delta

## ADDED Requirements

### Requirement: A save that wrote is never presented as unsaved

WHERE a save wrote the file and then could not release its lock, what the user is shown SHALL say the
file was written — in the summary as well as in the detail — and SHALL say that saving it again may
not work until the lock clears. A save that wrote NOTHING SHALL NOT be described as written.

#### Scenario: The write lands and the lock cannot be removed

- **WHEN** the user saves, the write lands, and removing the lock afterwards is refused
- **THEN** the panel says the file was saved and may still be locked, and does not summarise it as
  not saved

#### Scenario: There was nothing to write, and the lock cannot be removed

- **WHEN** the file already holds what the user asked for, so the save writes nothing, and removing
  the lock afterwards is refused
- **THEN** the panel says the file is already up to date and may still be locked, and does not claim
  it was saved

### Requirement: No lock is offered to the user as a file to delete

A report about a lock SHALL NOT give the user a pathname to remove, in the panel or in any warning.

#### Scenario: The lock's name has been taken by another writer

- **WHEN** a save cannot release its lock because that name now identifies a different writer's lock
- **THEN** nothing names that pathname to the user

#### Scenario: The lock was never acquired at all

- **WHEN** an operation is abandoned because the lock could not be taken, so this process never held
  it and has the least standing of all to vouch for that name
- **THEN** nothing names that pathname to the user either

### Requirement: A lock left behind survives a failed refresh

WHERE a save leaves a lock behind and rebuilding the panel's view of the file afterwards fails, the
report SHALL still reach the user.
