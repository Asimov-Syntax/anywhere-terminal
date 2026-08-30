# Spec Delta: worktree-agent-presence

## MODIFIED Requirements

### Requirement: Attribute a pane to exactly one worktree

A terminal pane SHALL be attributed to the worktree whose path contains that pane's working
directory and is the longest such path, where containment is decided by where both paths RESOLVE
rather than by how either is spelled. A pane whose working directory is unknown, or that no
worktree contains, SHALL produce no row. A pane SHALL NOT appear under more than one worktree.

#### Scenario: A sibling worktree sharing a name prefix

- **WHEN** worktrees `/repo/feature-x` and `/repo/feature-x-old` both exist and a pane's working directory is `/repo/feature-x-old`
- **THEN** the pane appears under `/repo/feature-x-old` only

#### Scenario: A worktree nested inside another worktree

- **WHEN** a pane's working directory lies inside a worktree that is itself inside another worktree
- **THEN** the pane appears under the inner worktree only

#### Scenario: A pane moves between worktrees

- **WHEN** a pane's working directory changes from one worktree to another
- **THEN** the next projection shows one row, under the new worktree

#### Scenario: A pane whose shell reports a symlinked spelling of its worktree

- **WHEN** a pane's working directory is spelled through a symlink and resolves inside a worktree
  whose path is spelled differently
- **THEN** the pane appears under that worktree

#### Scenario: A pane spelled beneath a worktree that resolves elsewhere

- **WHEN** a pane's working directory is spelled beneath a worktree but resolves outside it
- **THEN** the pane does not appear under that worktree
