# Spec Delta: worktree-panel

## ADDED Requirements

### Requirement: The create form states what the new worktree will lack

The create form SHALL show a section listing the material the new worktree will not inherit from
the checkout it is made from, one row per declared item, each row naming the file that declared it.

Where the repository declares no such material, the section SHALL still appear and SHALL say the
worktree will have no `.env` and no `node_modules`.

#### Scenario: A repository that declares copy, link, port and setup material

- **WHEN** the user opens the create form for a repository whose provisioning file declares files
  to copy, files to link, named ports, and setup commands
- **THEN** each declared item appears as its own row, and each row names the file that declared it

#### Scenario: A repository that declares nothing

- **WHEN** the user opens the create form for a repository with no provisioning file
- **THEN** the section still appears and says the new worktree will have no `.env` and no
  `node_modules`

#### Scenario: A declared pattern that matches nothing

- **WHEN** the provisioning file declares a pattern for which the checkout holds no matching file
- **THEN** the section shows no row for it and reports no problem

### Requirement: A linked row says where its writes land

A row whose material is linked rather than copied SHALL state that writing through it changes the
main checkout. That statement SHALL NOT be suppressible by any setting or user action.

#### Scenario: A linked row is shown

- **WHEN** the section shows a row whose material is linked rather than copied
- **THEN** the row states that writing through it changes the main checkout, and no setting removes
  that statement

### Requirement: A provisioning file that cannot be read does not block a create

Where a provider file is present but cannot be read or understood, the form SHALL name that file in
the section and SHALL remain submittable.

#### Scenario: A provisioning file that is malformed

- **WHEN** the repository's provisioning file is present but malformed
- **THEN** the section names that file as a problem, and the create action remains available
