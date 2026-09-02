# worktree-panel — delta

## ADDED Requirements

### Requirement: A configuration path that is not an ordinary file is refused

WHERE a path the repository names as its own configuration, or as a source to build on, does not
hold an ordinary file, the read SHALL refuse it without waiting for it to become readable, and
SHALL report it as unreadable rather than as absent, as empty, or as declaring nothing.

Storage that is merely slow behind an ordinary file is outside this requirement.

#### Scenario: A source to build on that nothing is writing to

- **WHEN** the repository's own configuration names a source to build on, and that path holds a
  named pipe with nothing writing to it
- **THEN** the section reports that the file could not be read, still offers the repository's own
  declared material, and answers rather than waiting

### Requirement: A refused save leaves the next save able to run

WHEN a save of the repository's own configuration is refused, the save SHALL report its refusal and
SHALL leave a later save of the same file able to run. A save that cannot complete SHALL NOT leave
the file reserved against every later attempt.

#### Scenario: Saving over a configuration that is not an ordinary file

- **WHEN** the user saves the section's choices and the repository's own configuration file is not
  an ordinary file
- **THEN** the save is refused and reported, and an immediately following save of the same file
  runs rather than failing because the file is still held

#### Scenario: The configuration stops being an ordinary file while the save is running

- **WHEN** the repository's own configuration file holds an ordinary file as the save begins and
  holds a named pipe by the time the save reads it
- **THEN** the save is refused and reported, and a following save of the same file still runs
