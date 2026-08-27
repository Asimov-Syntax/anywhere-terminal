# worktree-tree-freshness Specification
## Requirements

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

When the system cannot produce a current listing for a repository, it SHALL retain that
repository's last good listing, mark it degraded with a reason naming the cause, and SHALL NOT
alter its worktree count.

- Cause → a failed rebuild, a repository unresolvable from a still-open folder, or an unavailable git.
- Never listed successfully → no worktrees and a reason.
- Workspace folder removed → dropped rather than retained.
- Every other repository → unaffected.

#### Scenario: A listing that fails after a good read keeps its worktrees

- **WHEN** a repository lists three worktrees and its next listing fails
- **THEN** it still reports those three worktrees, marked degraded with a reason

#### Scenario: An unresolvable repository is retained rather than deleted

- **WHEN** resolving a still-open workspace folder to its repository fails
- **THEN** that repository still reports its worktrees, marked degraded with a reason

#### Scenario: An unavailable git retains every repository

- **WHEN** git becomes unavailable after every repository has listed successfully
- **THEN** each repository still reports its worktrees, marked degraded with a reason

### Requirement: Report a watch that was never established

When the system cannot establish the watch that would keep a repository's listing fresh, that
repository SHALL be marked degraded with a reason rather than presented as watched, and the
listing SHALL remain reachable by a forced refresh.

### Requirement: A signal that arrives during a rebuild is not lost

When a structural signal for a repository arrives while a rebuild of that repository is already
running, the system SHALL rebuild that repository again after the running rebuild finishes. Every
signal arriving during one rebuild SHALL collapse into exactly one further rebuild, and that
rebuild SHALL remain subject to the sustained rate limit.

#### Scenario: A worktree created mid-rebuild still appears

- **WHEN** a worktree is created while a rebuild of that repository is already running
- **THEN** the tree the system reports comes to include it without any further signal

### Requirement: Watch a repository without recursively watching its git directory

Establishing a repository's watch SHALL NOT create any watcher that recursively monitors that
repository's git directory. At most one watcher MAY recursively monitor the linked-worktree
metadata directory alone; every other watcher SHALL monitor a single directory level.

#### Scenario: A repository with no linked worktrees is still watched

- **WHEN** a repository that has never had a linked worktree gains one
- **THEN** that repository is rebuilt without any further signal

