# Spec Delta: vault-session-preview — resolve-containment-through-symlinks

## ADDED Requirements

### Requirement: A transcript is located inside the store it resolves into, not the one it spells

Before reading any session transcript, the system SHALL decide containment against the store root
on **resolved** paths — both the candidate and the root followed through symlinks — and SHALL NOT
read a candidate that resolves outside the root, whatever its literal form suggests. A candidate
whose own file does not exist yet SHALL be judged by the location it would occupy. A candidate the
system cannot resolve for any reason other than that absence SHALL NOT be read.

#### Scenario: A link inside the store pointing out of it

- **WHEN** a session's transcript path lies within the store root only by spelling, and resolves
  through a symlink to a file outside that root
- **THEN** the transcript is not read, and the session presents as one whose transcript cannot be
  located rather than as an error

#### Scenario: A store the user keeps behind a link

- **WHEN** the store root itself is reached through a symlink — a vault directory on another
  volume — and a session's transcript is genuinely inside it
- **THEN** the transcript is read exactly as it would be were the root a real directory

#### Scenario: A session whose transcript has not been written yet

- **WHEN** a session's transcript is inside the store root but does not exist on disk
- **THEN** containment is decided on where the file would be, and the read is attempted and reports
  the file as absent rather than as being outside the store

#### Scenario: A link the system cannot follow

- **WHEN** a component of a session's transcript path is a symlink whose own target cannot be
  resolved, or the path cannot be resolved for any reason other than the file simply not being
  there
- **THEN** the transcript is not read, and the session presents as one whose transcript cannot be
  located — the literal spelling does not stand in for an answer the filesystem declined to give
