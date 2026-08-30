## ADDED Requirements

### Requirement: A store that cannot be read reports the same status on every path

A store that exists but whose contents this process cannot read SHALL report the same status whether
it is read cold or through a snapshot the vault has retained. That status SHALL be the one meaning
unreachable, never the one meaning absent.

#### Scenario: A retained snapshot does not outlive the permission that earned it

- **WHEN** read permission on a store file is revoked after a snapshot of it has been retained
- **AND** the store is read again through the snapshot path
- **THEN** it reports the store unreachable, as a cold read of the same store does

#### Scenario: An unreadable store is not reported as missing

- **WHEN** a store file is present but unreadable by this process
- **THEN** it reports the store unreachable rather than reporting no store at all
