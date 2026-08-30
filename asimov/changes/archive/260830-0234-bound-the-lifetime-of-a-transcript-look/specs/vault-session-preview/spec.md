## ADDED Requirements

### Requirement: A transcript look abandons a slow read rather than waiting on it

Every attempt to locate and read a session's transcript SHALL be given a deadline covering locating
the transcript as well as reading it, and the row SHALL be answered at the first opportunity after
that deadline elapses rather than held until the filesystem responds. The deadline SHALL default to
5 seconds, measured from the start of the attempt.

#### Scenario: A transcript on a stalled volume

- **WHEN** a row's transcript is on a filesystem that does not respond
- **THEN** the row is answered once the deadline elapses, with the line it last read, and its next
  attempt is scheduled further out rather than immediately

### Requirement: An abandoned look is scored as no progress and commits nothing

An abandoned attempt SHALL NOT be recorded as a resolution, and SHALL widen the retry interval by the
same rule an unproductive attempt widens it.

Whatever it observes after abandonment SHALL NOT reach the session: it SHALL neither retire the row's
line nor establish where the transcript was found. That leaves it distinguishable from a read failing
outright, which does retire the line.

#### Scenario: A read that fails is not treated as slow

- **WHEN** a row's transcript read fails outright rather than hanging
- **THEN** the row stops presenting a preview line

#### Scenario: An abandoned read finds the transcript gone

- **WHEN** a read that was already abandoned for exceeding its deadline goes on to discover that the
  transcript is missing
- **THEN** the row still presents the line it last read, and the session is not recorded as one whose
  transcript could not be located

### Requirement: Outstanding transcript work does not grow with the rows that ask

At most one transcript attempt SHALL be outstanding per session, and the number outstanding SHALL NOT
exceed the number of sessions the preview retains — whatever the elapsed cadence ticks, and whatever
earlier attempts were abandoned without settling.

A row whose session already has one outstanding SHALL be answered from what was last known, and
retiring a session from that retention SHALL NOT license a second attempt against it.

#### Scenario: More sessions asked for than the preview retains, none of them responding

- **WHEN** rows ask for more distinct sessions than the preview retains, and none of their
  transcripts respond
- **THEN** the count of outstanding reads stays at or below that retention rather than growing with
  each cadence tick
