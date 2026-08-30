## ADDED Requirements

### Requirement: A preview does not outlive the session it describes

WHEN a row's session is proven no longer present in its agent's store, the row SHALL stop carrying
that preview — whether or not its transcript file is still on disk — and SHALL ask nothing further
of that file while the session stays gone. A session present again SHALL carry a preview line again.

#### Scenario: A session is deleted while its transcript file remains

- **WHEN** a row's session is proven removed from its agent's store and the transcript it was read
  from is still present on disk
- **THEN** the row stops carrying its preview line, and asks nothing further of the file

#### Scenario: A session that comes back

- **WHEN** a session that had stopped existing is present in its agent's store again
- **THEN** the row carries a preview line again

### Requirement: A store is re-consulted on its own interval

A row's session SHALL be looked up in its agent's store no more often than once per re-confirmation
interval, defaulting to 30 seconds. The first look eligible after that interval SHALL consult it.

#### Scenario: Repeated looks inside one interval

- **WHEN** a row is asked for its preview many times within one re-confirmation interval
- **THEN** its agent's store is consulted at most once

### Requirement: Only a proven absence retires a preview

A lookup that could not establish whether the session exists, a transcript that has become
unreadable, and a read that exceeded its own deadline SHALL NOT be treated as the session ceasing to
exist, and SHALL NOT by themselves remove a line the row already carries.

#### Scenario: A store that cannot answer is not a deleted session

- **WHEN** the store cannot establish whether a row's session exists
- **THEN** the row keeps the line it last read, and the session is not treated as gone

#### Scenario: A slow read is not a deleted session

- **WHEN** a row's transcript read exceeds its deadline while the session still exists
- **THEN** the row keeps the line it last read, and the session is not treated as gone
