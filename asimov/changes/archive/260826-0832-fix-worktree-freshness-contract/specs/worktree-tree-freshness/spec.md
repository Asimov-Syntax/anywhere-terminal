# worktree-tree-freshness Specification

## MODIFIED Requirements

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

## ADDED Requirements

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
