# worktree-panel Specification Delta

## ADDED Requirements

### Requirement: A selection resolves to what the create would actually do, before submit

The create dialog SHALL resolve the typed selection against the repository before submission, and
SHALL state which of create-a-new-branch, check-out-an-existing-branch, or repair-a-stale-
registration the create would perform. A state git can distinguish SHALL NOT be reported to the user
only as a failure after the create was attempted.

#### Scenario: An existing branch is reused rather than duplicated

- **WHEN** the user selects a branch that already exists and no worktree holds it
- **THEN** the create checks that branch out into the new worktree, and does not create a
  near-duplicate branch under a suffixed name

### Requirement: The whole selection is resolved, in every mode

The selection is the branch or ref named, the base the create would start from, and any destination
the user supplied. A create SHALL NOT be offered until the resolution answering that exact selection
has arrived, in every mode the dialog offers, a detached create included.

#### Scenario: A create is not offered against an unresolved selection

- **WHEN** any part of the selection changes and the resolution for it has not arrived
- **THEN** the create is not offered, in every mode including a detached create

### Requirement: The resolution names both the path the create will take and the one it skipped

The resolution SHALL state the free path the create would use, and WHERE the derived candidate was
occupied and a suffix was applied, SHALL also state the skipped candidate and whether what occupies
it is a worktree or a directory that is not one.

#### Scenario: An occupied candidate is reported alongside the free path

- **WHEN** the derived destination is occupied and the create resolves to a suffixed path
- **THEN** the resolution names the suffixed path it will use and the occupied path it skipped, with
  what was found there

### Requirement: A supplied destination is a candidate the resolution answers, not the path submitted

WHERE the user supplies a destination, what the form states and the create submits SHALL be the path
the resolution names for it. A supplied destination that is occupied, or that the create root does
not contain, SHALL NOT be stated as the destination nor submitted as one.

#### Scenario: A supplied destination that is occupied is not the one submitted

- **WHEN** the user supplies a destination that is already occupied
- **THEN** the form states the path the resolution named instead, and the create submits that path

### Requirement: A mode that fixes its own target refuses the destination control

WHERE the resolved mode acts on a directory of its own — a repair acts on the registration's — the
destination control SHALL be refused with its reason rather than accepted and ignored, on the same
rule the base ref already follows.

#### Scenario: A repair keeps the directory it is repairing

- **WHEN** the selection resolves to a repair and the user had supplied a destination
- **THEN** the destination control is refused with its reason, and the form states and submits the
  directory being repaired

### Requirement: Reporting an occupied destination does not authorize removing it

A resolution SHALL NOT carry authorization to delete anything it reports. Removing what occupies a
destination SHALL require an explicit, separately confirmed authorization.

### Requirement: A stale registration is repaired in place, and only while git can repair it

WHERE git reports a worktree as prunable, its branch is the selected one, its directory holds a git
link naming an administrative directory that still exists, and that directory's HEAD matches the
branch's current commit, the create SHALL repair the registration in place rather than creating a
new worktree. WHERE any of those does not hold, repair SHALL NOT be offered.

#### Scenario: A registration whose administrative entry is gone is not offered as a repair

- **WHEN** the surviving directory's git link names an administrative directory that no longer
  exists
- **THEN** repair is not offered, and the surviving directory is neither deleted nor overwritten

#### Scenario: A repair does not rewrite the working tree

- **WHEN** a stale registration is repaired
- **THEN** the files in the worktree directory are unchanged

#### Scenario: A checkout that moved after the resolution is not repaired

- **WHEN** the directory's HEAD no longer matches the commit recorded when the selection resolved
- **THEN** the repair is refused rather than applied against the changed checkout

### Requirement: The base ref is refused where the mode cannot apply it

WHERE the resolved mode takes its starting point from something that already exists — an existing
branch, or a stale registration being repaired — the base ref SHALL be unavailable with a stated
reason rather than accepted and ignored. WHERE the mode creates a new branch, the base ref SHALL be
validated before submission and SHALL be reported as unresolvable before the create is attempted.

#### Scenario: Base is refused, not silently dropped

- **WHEN** the selection resolves to reusing an existing branch
- **THEN** the base ref control is unavailable and states why

#### Scenario: An occupied destination does not disable the base ref

- **WHEN** the destination is occupied and the branch mode creates a new branch
- **THEN** the base ref remains available, because clearing the ground does not change where the new
  branch starts

### Requirement: A resolution belonging to a previous opening of the dialog is discarded

WHERE the create dialog is closed and opened again, a resolution answering the earlier opening SHALL
NOT be applied to the later one, even when both name the same repository and the same query.
