# Spec Delta: worktree-panel

## ADDED Requirements

### Requirement: A destination two declarations may both name is held by the repository's own

WHERE two selected declarations may name one destination and one of them is the repository's own,
the extension SHALL materialize the repository's own declaration before the other, so that the
material and the `mode` at that destination are the repository's own declaration's.

#### Scenario: Both spellings resolve to one file

- **WHEN** two selected declarations differ only in a form the worktree's filesystem folds, and one
  of them is the repository's own
- **THEN** the worktree holds the repository's own declaration's material under its own `mode`

#### Scenario: The two spellings may be two files here

- **WHEN** two such declarations name destinations this filesystem may keep apart
- **THEN** only the repository's own is materialized, and the other is refused naming both
  declarations, because nothing available can establish that the second destination is a different
  slot rather than the first one having been removed

### Requirement: A collision the extension cannot attribute to its own write is refused

WHERE a destination two selected declarations may both name is already present when the apply
begins, or is present after the repository's own declaration ran without the extension being able
to establish that this apply's own write put it there, the extension SHALL report a refusal naming
both declarations, SHALL NOT resolve the destination in favour of the inherited declaration, and
SHALL NOT write into it.

#### Scenario: The destination was already in the worktree

- **WHEN** the destination already exists when the apply begins
- **THEN** neither declaration's material is written into it and both are named in the refusal

#### Scenario: The repository's own declaration failed first

- **WHEN** the repository's own declaration is refused or fails before it claims the destination
- **THEN** the other declaration is refused rather than applied in its place

#### Scenario: The repository's own declaration claimed it

- **WHEN** the repository's own declaration has materialized the destination
- **THEN** the other declaration is refused rather than written, whatever its own destination reads

#### Scenario: More than two declarations may name one destination

- **WHEN** three or more selected declarations may name one destination
- **THEN** every refusal names every one of them, by path and declaring file, its own included

### Requirement: A symlink that would resolve to itself is never created

WHERE recreating a symlink in the new worktree would produce a link whose target resolves to that
link's own destination, the extension SHALL refuse it and report why, rather than creating a link
that resolves to itself.

## MODIFIED Requirements

### Requirement: The material a worktree was promised is actually put there

WHEN a worktree is created with provisioning entries the user left selected, the extension SHALL
materialize each one it does not refuse into the new worktree — copying by default, linking where
the entry says link — and SHALL report the outcome of every entry it was given, refusals included.
Copying SHALL happen before linking, EXCEPT that where declarations may name one destination, the
repository's own is materialized first and the others are refused.

#### Scenario: The files the dialog listed are in the new worktree

- **WHEN** a create carries selected copy entries, none of which may name another's destination
- **THEN** each of those files exists in the new worktree, and each is reported as copied

#### Scenario: Only what was selected is materialized

- **WHEN** the user unticks an entry before creating
- **THEN** that entry is not written into the new worktree and is not reported as a step that ran

#### Scenario: The report arrives after the create's own result

- **WHEN** provisioning entries are applied
- **THEN** the create's success is reported first, and the per-entry outcomes follow it
