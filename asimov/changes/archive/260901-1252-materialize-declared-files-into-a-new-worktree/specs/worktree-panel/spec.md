# Spec Delta: worktree-panel

## ADDED Requirements

### Requirement: The material a worktree was promised is actually put there

WHEN a worktree is created with provisioning entries the user left selected, the extension SHALL
materialize each of them into the new worktree — copying by default, linking where the entry says
link — and SHALL report the outcome of every entry it was given, including the ones it refused.
Copying SHALL happen before linking.

#### Scenario: The files the dialog listed are in the new worktree

- **WHEN** a create carries selected copy entries
- **THEN** each of those files exists in the new worktree, and each is reported as copied

#### Scenario: Only what was selected is materialized

- **WHEN** the user unticks an entry before creating
- **THEN** that entry is not written into the new worktree and is not reported as a step that ran

#### Scenario: The report arrives after the create's own result

- **WHEN** provisioning entries are applied
- **THEN** the create's success is reported first, and the per-entry outcomes follow it

### Requirement: Provisioning never costs the user the worktree

WHERE an entry cannot be materialized for any reason, the extension SHALL leave the new worktree and
every entry already materialized in place, and SHALL report that entry as failed with its reason.
A failed entry SHALL NOT fail the create, undo the create, or stop the user from using the worktree.

#### Scenario: One entry fails

- **WHEN** one of several entries cannot be written
- **THEN** the create is still reported as succeeded, the earlier entries remain, and the failed entry is named with its reason

#### Scenario: Every entry fails

- **WHEN** no entry can be materialized at all
- **THEN** the worktree still exists and is still usable

### Requirement: An entry that would write outside the new worktree is refused, not adjusted

WHERE a provisioning entry resolves outside the repository it was declared in, or outside the
worktree being created — whether by `..`, by an absolute path, or through a symlinked component —
the extension SHALL refuse that entry and report it, and SHALL NOT rewrite, trim, or otherwise
adjust it into a path that is inside.

#### Scenario: An entry climbs out with ..

- **WHEN** an entry's path resolves above the repository root
- **THEN** it is refused and reported, and nothing is written for it

#### Scenario: A symlinked component leads out of the repository

- **WHEN** a component of an entry's source resolves, through a symlink, to a location outside the repository
- **THEN** it is refused and reported rather than followed

#### Scenario: A symlink inside the repository is kept as a symlink

- **WHEN** a copied directory contains a symlink that resolves inside the repository
- **THEN** the copy contains a symlink, not a dereferenced copy of what it pointed at

### Requirement: Materializing never replaces anything that is already there

WHERE a destination already exists, the extension SHALL skip it and report it as skipped. This SHALL
hold for every file inside a copied directory, not only for the directory's own name.

#### Scenario: The destination file already exists

- **WHEN** an entry's destination already exists in the new worktree
- **THEN** it is left untouched and the entry is reported as skipped

#### Scenario: A file inside an existing destination directory already exists

- **WHEN** a directory entry is copied into a destination directory that already exists and already contains one of the files being copied
- **THEN** that file is left untouched and reported, and the files that did not already exist are still copied

### Requirement: Some material is refused however a repository asks for it

The extension SHALL refuse to copy or link a lockfile, and SHALL refuse to link `node_modules`,
however a repository asked for it, and SHALL report each refusal with the reason it was refused
rather than silently omitting the entry.

#### Scenario: A lockfile is asked for

- **WHEN** a lockfile is asked for, by copy or by link
- **THEN** the entry is reported as refused, naming that a worktree's own lockfile is the authoritative one

#### Scenario: node_modules is asked for as a link

- **WHEN** `node_modules` is asked for as a link
- **THEN** the entry is reported as refused, naming why a shared `node_modules` is not supported

### Requirement: A link the platform cannot make becomes a copy that says so

WHERE the platform cannot create a symlink, the extension SHALL copy the entry instead and SHALL
report that entry as having degraded to a copy, rather than failing it or reporting a link it did
not make.

#### Scenario: Symlinks are unavailable

- **WHEN** a link entry is applied on a platform that refuses the symlink
- **THEN** the entry's content is copied and the entry is reported as a copy that was asked to be a link
