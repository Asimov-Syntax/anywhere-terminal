## ADDED Requirements

### Requirement: A preview does not outlive the session it describes

WHEN the session a row's preview was read from no longer exists in its agent's store, the row SHALL
stop carrying that preview within a bounded time — whether or not the transcript file it was read
from is still on disk. The bound SHALL default to 30 seconds.

A transcript that has become unreadable, and a read that exceeded its own deadline, SHALL NOT be
treated as the session ceasing to exist.

#### Scenario: A session is deleted while its transcript file remains

- **WHEN** a row's session is removed from its agent's store and the transcript it was read from is
  still present on disk
- **THEN** the row stops carrying its preview line within the bound, and asks nothing further of the
  file

#### Scenario: A session that comes back

- **WHEN** a session that had stopped existing is present in its agent's store again
- **THEN** the row carries a preview line again

#### Scenario: A slow read is not a deleted session

- **WHEN** a row's transcript read exceeds its deadline while the session still exists
- **THEN** the row keeps the line it last read, and the session is not treated as gone
