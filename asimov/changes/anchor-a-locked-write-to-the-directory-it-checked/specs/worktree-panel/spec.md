# worktree-panel — delta

## ADDED Requirements

### Requirement: A locked write decides ownership on identities that cannot round

A write that removes or replaces a file it believes it created SHALL decide that belief on filesystem
identities compared without loss of precision, so that a different file cannot be mistaken for the
one it owns.

### Requirement: A save that left its lock behind says so, whatever else it did

WHERE a save takes a lock and cannot release it, the outcome reported to the user SHALL name the
lock that is still there, WHETHER OR NOT the save wrote anything and whether or not it refused. What
the outcome says about the WRITE SHALL remain what actually happened: a save that wrote nothing
SHALL NOT be described as saved, and a refusal SHALL keep its own reason. A save that releases its
lock normally SHALL report exactly as it does today.

#### Scenario: The lock cannot be removed after the write lands

- **WHEN** the user saves, the write lands, and removing the lock afterwards is refused by the
  filesystem
- **THEN** the save reports that the write landed AND names the lock that is still there

#### Scenario: A refused save leaves its lock behind

- **WHEN** the user saves, the save is refused for its own reason, and removing the lock afterwards
  is refused by the filesystem
- **THEN** the save reports that refusal AND names the lock that is still there

### Requirement: An ordinary save is unaffected

WHERE the filesystem is quiescent, saving SHALL read, write and report exactly as it does today.
