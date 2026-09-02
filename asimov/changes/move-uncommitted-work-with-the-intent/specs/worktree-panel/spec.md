# Spec Delta: worktree-panel

## ADDED Requirements

### Requirement: A move offer requires an identified source worktree

WHERE a create action came from a specific worktree row, that source has work the host can count
completely, and the editor can migrate it, the form SHALL offer to move the work. A create opened
without a unique source row, or against an unavailable source or integration, SHALL NOT offer it.

#### Scenario: There is work to move

- **WHEN** a worktree row opens create and that worktree has movable changes
- **THEN** the form offers to move them

#### Scenario: The create has no source row

- **WHEN** the create form was opened from a repository-level or toolbar action
- **THEN** no move option is offered

#### Scenario: Nothing can be offered

- **WHEN** the source has no changes, has an unresolved merge, cannot be read completely, or migration is unavailable
- **THEN** the form does not offer to move anything and create remains available

### Requirement: The move offer states one complete distinct-path count

The offer SHALL state the number of distinct movable paths Git reports as staged, changed in the
working tree, or untracked. A path in more than one state and a renamed path SHALL each count once;
a changed path set SHALL withdraw the earlier consent.

#### Scenario: A path is both staged and edited

- **WHEN** one path is staged and also changed in the working tree
- **THEN** the form states it as one change

#### Scenario: The count changes after consent

- **WHEN** the user selected the move at one count and the host observes a changed snapshot before execution
- **THEN** no worktree is created and the earlier selection authorizes no move

### Requirement: Move consent applies to execution-time source work

The row SHALL identify its number as the current snapshot and SHALL state that Git moves the source's
uncommitted work present when the operation runs. A change after the final host check MAY enter the
Git operation; observable divergence SHALL make the result indeterminate.

#### Scenario: Work changes after the final check

- **WHEN** another process changes the source after the host's final snapshot and before Git stashes it
- **THEN** the operation may include that work and any observed mismatch is reported as indeterminate

### Requirement: The work moves between a new checkout and every later step

For a fresh, detached, or reused-branch create, migration SHALL run after git creates the checkout and
before any authorization, materialization, allocation, opening, or launch in it. Reattach and adopt
SHALL NOT offer or perform migration because they act on surviving directories.

#### Scenario: A setup command sees the moved work

- **WHEN** a create carries both migration and provisioning entries
- **THEN** migration completes before the first provisioning entry is materialized

#### Scenario: The move is uncertain

- **WHEN** the integration does not establish that the work moved
- **THEN** no provisioning or after-create action runs in the created checkout

#### Scenario: Untracked files move too

- **WHEN** the moved work includes a file git is not tracking
- **THEN** the integration is asked to include that file with the rest

#### Scenario: A surviving checkout is repaired

- **WHEN** the create mode is reattach or adopt
- **THEN** no move option is offered and no migration is attempted

### Requirement: Migration uncertainty does not undo a successful create

WHERE migration is not established, the extension SHALL keep and report the created worktree rather
than reporting a failed create or rolling it back. No later create step SHALL run.

#### Scenario: The move rejects

- **WHEN** the migration promise rejects after the worktree was created
- **THEN** the create remains successful and later steps do not run

### Requirement: An uncertain migration report claims only proven state

The report SHALL call migration potentially partial, direct inspection of both worktrees and Git
stashes, and SHALL NOT claim source restoration or single-location ownership. Because the integration
exposes no report-ownership signal, the contract SHALL NOT promise exactly one report.

#### Scenario: The integration resolves without moving everything

- **WHEN** the migration promise resolves but the source still reports uncommitted work
- **THEN** the notice makes no claim about where every change now resides

#### Scenario: The integration already warned

- **WHEN** the integration warns and then rejects during its own recovery
- **THEN** the extension may also report uncertainty rather than suppressing an unclassified rejection

### Requirement: Declining to move performs no migration

WHERE the user does not select the move offer, the extension SHALL NOT invoke migration and the source
worktree's changes SHALL remain untouched by this option.

#### Scenario: The offer is declined

- **WHEN** the user creates a worktree without selecting the move
- **THEN** no migration is attempted
