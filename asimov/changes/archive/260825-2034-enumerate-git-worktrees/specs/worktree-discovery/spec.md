## ADDED Requirements

### Requirement: Resolve workspace git repositories

The system SHALL resolve one git repository per workspace folder, keyed on that repository's
normalized absolute git common dir (`repoId`), and SHALL group the result in workspace-folder
order.

- Two workspace folders resolving to the same `repoId` → one group, never two.
- A workspace folder that is not a git repository → skipped, and not counted as unreadable.

#### Scenario: A linked worktree opened beside its parent repo is one group

- **WHEN** the workspace holds both a repository and one of that repository's own linked
  worktrees as separate folders
- **THEN** the tree contains a single group for that repository, listing every one of its
  worktrees

### Requirement: Enumerate every worktree of a repository exactly once

The system SHALL list every worktree of each resolved repository, and each worktree SHALL appear
exactly once in that repository's group.

- A worktree path containing a newline, a space, or non-ASCII characters SHALL be listed
  correctly or reported as unreadable — never mis-parsed into a different path.
- A listing record the system cannot parse → skipped, with one deduplicated reason added to the
  tree's `unreadable` reasons and `unreadable.count` incremented.

### Requirement: Normalize every path through one rule

The system SHALL pass every path that crosses a comparison boundary through a single
normalizer, and two spellings of the same directory SHALL produce equal results.

- A path that does not exist SHALL still normalize.
- An empty or non-absolute input → no result; it is never treated as an identity.
- A worktree's identity SHALL be its normalized path and nothing else, while the path exactly
  as git reported it SHALL remain available for display, copy, and reveal.

#### Scenario: A symlinked root reported two ways is one worktree

- **WHEN** git reports a worktree as `/var/folders/x/repo` and the operating system reports the
  same directory as `/private/var/folders/x/repo`
- **THEN** both normalize to the same identity

#### Scenario: A drive letter spelled two ways is one worktree

- **WHEN** the same Windows directory is reported as `c:\src\repo` and `C:\Src\Repo`
- **THEN** both normalize to the same identity

### Requirement: Report the worktree state git reports

The system SHALL carry through the state git reports for each worktree — main or linked, bare,
branch, head commit, detached, locked with its reason, and prunable — and SHALL NOT infer any of
them from the filesystem.

- Detached HEAD → no branch; an unborn branch → no head commit. Both still list.
- A worktree reported prunable SHALL be reported as missing when its directory is absent, except
  where it is locked or is the main worktree — neither is ever reported missing.

#### Scenario: A locked worktree whose directory is gone is not reported missing

- **WHEN** a worktree is locked and its directory does not exist
- **THEN** it is reported as locked and not as missing

### Requirement: Mark worktrees the workspace has open

The system SHALL mark a worktree as in-workspace when a workspace folder is that worktree's
path or lies inside it.

#### Scenario: A workspace folder inside a worktree marks that worktree open

- **WHEN** the only workspace folder is a subdirectory of a listed worktree
- **THEN** that worktree is marked in-workspace

### Requirement: Order worktrees deterministically

The system SHALL order the worktrees within a repository group as: the main worktree first; then
worktrees with observed agent activity, most recently active first; then the remainder by branch
name ascending, compared case-insensitively.

- Missing and prunable worktrees SHALL sort last within their bucket.
- Equal keys SHALL be broken by identity, so listing the same repository twice yields the same
  order regardless of filesystem enumeration order.

### Requirement: Report an unusable git

The system SHALL report git as unavailable, with no repositories and no error raised to the
caller, when no usable git executable is found.

- A git older than 2.31 SHALL be reported as unsupported rather than listed with silently absent
  locked and prunable state.

### Requirement: Confine a repository failure to that repository

The system SHALL narrow a failed listing to the repository it affects, recording a reason there,
and SHALL NOT empty the tree, drop an unaffected repository, or raise the failure to the caller.

- A git command that has not returned within 10 seconds → terminated and treated as a failure for
  that repository alone.

#### Scenario: One repository's listing failure leaves the others intact

- **WHEN** the workspace holds two repositories and the worktree listing fails for one of them
- **THEN** the failing repository carries a degradation reason and the other repository lists
  its worktrees normally
