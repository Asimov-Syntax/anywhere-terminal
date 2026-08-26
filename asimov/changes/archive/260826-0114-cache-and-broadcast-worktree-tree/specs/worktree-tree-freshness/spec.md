## ADDED Requirements

### Requirement: Rebuild only on a structural change

The system SHALL rebuild a repository's worktree listing only when a signal shows that
repository's worktree membership or a checked-out HEAD changed, when the workspace's folder or
repository set changed, or when the user forced a refresh. The system SHALL NOT rebuild a
listing on a timer, and ordinary work inside a worktree — writes to its index, logs, refs, or
any file other than its HEAD — SHALL NOT cause a rebuild.

#### Scenario: An agent working inside a worktree drives no rebuild

- **WHEN** a sustained stream of writes lands on files inside a linked worktree's git directory
  other than its HEAD
- **THEN** no rebuild occurs

#### Scenario: A branch switch drives exactly one rebuild

- **WHEN** a linked worktree's HEAD is rewritten in place
- **THEN** that repository is rebuilt exactly once

### Requirement: Confine a rebuild to the repository that changed

A signal scoped to one repository SHALL rebuild only that repository's listing, and SHALL leave
every other repository's listing untouched and un-re-read. A rebuild SHALL cost at most two git
invocations for the repository it affects, independent of how many worktrees that repository
has.

### Requirement: Bound the sustained rebuild rate

Signal-driven rebuilds SHALL be limited to at most one per second per repository, so a
sustained stream of signals collapses to that rate rather than one rebuild per signal. A
refresh the user forced, and a rebuild that follows a mutation the system itself performed,
SHALL NOT be delayed by that limit.

#### Scenario: A forced refresh is not delayed by the rate limit

- **WHEN** the user forces a refresh less than one second after a signal-driven rebuild of the
  same repository
- **THEN** the forced rebuild runs immediately

### Requirement: Own freshness once per window

The git invocations and filesystem watchers backing the worktree tree SHALL NOT grow with the
number of surfaces displaying it. Freshness SHALL be established once per window and shared.

#### Scenario: A second surface adds no work

- **WHEN** a second surface begins displaying the worktree view while a first surface already
  displays it
- **THEN** no additional git command runs and no additional watcher is created

### Requirement: Never present a stale listing as current

When a rebuild fails for a repository, the system SHALL retain that repository's last good
listing unchanged, SHALL mark that repository degraded with a reason, and SHALL NOT empty it or
alter its worktree count. A repository that has never listed successfully SHALL appear with no
worktrees and a reason. Every other repository SHALL be unaffected.

#### Scenario: A listing that fails after a good read keeps its worktrees

- **WHEN** a repository lists three worktrees and its next listing fails
- **THEN** it still reports those three worktrees, marked degraded with a reason

### Requirement: Report a watch that was never established

When the system cannot establish the watch that would keep a repository's listing fresh, that
repository SHALL be marked degraded with a reason rather than presented as watched, and the
listing SHALL remain reachable by a forced refresh.
