# agent-hook-installation — delta

## ADDED Requirements

### Requirement: A replacement is staged where nothing can be waiting for it

Staging a replacement SHALL use a name that cannot be derived from the time of the write or from the
file being replaced, and SHALL fail rather than write through an object already at that name.

- An object of any kind already at the staging name → the staged write fails and nothing outside the
  staging name is modified.

#### Scenario: A symlink is waiting at the staging name

- **WHEN** a symlink to another file already exists at the name a replacement would be staged under
- **THEN** the staged write fails and the file the symlink points at is unchanged

### Requirement: A release removes only the lock the operation still identifies

Releasing a lock SHALL remove the name only while that name still identifies the object the
operation acquired, and SHALL leave it in place and report the release as failed otherwise.

#### Scenario: The name now identifies another writer's lock

- **WHEN** the object at the lock's name is a different object from the one this operation acquired
- **THEN** the name is left in place and the operation reports the release as failed
