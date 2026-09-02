# worktree-panel — delta

## ADDED Requirements

### Requirement: A locked write decides ownership on identities that cannot round

A write that removes or replaces a file it believes it created SHALL decide that belief on filesystem
identities compared without loss of precision, so that a different file cannot be mistaken for the
one it owns.

#### Scenario: Two files whose identities differ only beyond a double's precision

- **WHEN** the file a save holds and the file its pathname now names differ only in a part of their
  identity a double cannot represent
- **THEN** the save treats them as different files and removes neither

### Requirement: A write that edits a file in place does not follow a link at its name

WHERE a save edits the configuration file in place, it SHALL read the file at that name rather than
one a link at that name points to, and SHALL refuse when the name is a link. Reading a file the user
merely NAMES as a source SHALL continue to follow links.

### Requirement: An ordinary save is unaffected

WHERE the filesystem is quiescent and the configuration file is an ordinary file, saving SHALL read,
write and report exactly as it does today.
