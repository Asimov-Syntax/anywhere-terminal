# Spec Delta: worktree-panel

## ADDED Requirements

### Requirement: A create says which kind of branch it wants

The create form SHALL state, as part of the request, which of its branch choices the user made,
and the host SHALL NOT infer that choice from which optional fields happen to be filled in.

A create on a new branch SHALL succeed whether or not the user supplied a base ref; where none was
supplied the new branch SHALL start from the repository's current `HEAD`. A create on an existing
branch SHALL check that branch out and SHALL NOT attempt to create it.

#### Scenario: A new branch with no base ref

- **WHEN** the user chooses the new-branch mode, names a branch that does not exist, and leaves the
  base ref empty
- **THEN** the worktree is created on that new branch, started from `HEAD`, and the panel reports a
  successful create

#### Scenario: An existing branch is checked out, not recreated

- **WHEN** the user chooses the existing-branch mode and names a branch that already exists
- **THEN** the worktree is created with that branch checked out, and the create does not fail on the
  branch already existing
