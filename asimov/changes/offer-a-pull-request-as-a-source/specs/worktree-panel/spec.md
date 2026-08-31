# worktree-panel — delta

## ADDED Requirements

### Requirement: Pull requests are offered in the branch list, never in a second tab

The panel SHALL offer the repository's open pull requests as rows in the same list that offers local
refs and the create-new row, ordered after prefix matches and before create-new. The panel SHALL NOT
add a tab, a mode switch, or a second input to reach them.

#### Scenario: A PR is reachable without leaving the branch list

- **WHEN** the user types text matching an open pull request's number or title
- **THEN** that pull request appears as a row in the same list as the refs, below the ref matches and
  above the create-new row

#### Scenario: The list still ends with create-new

- **WHEN** pull requests are present in the list
- **THEN** the create-new row is still the last row and is still selectable

### Requirement: A pull request resolves to a deterministic branch and its base

Selecting a pull request SHALL resolve to the branch name `pr/<number>` and to the pull request's own
base ref. Selecting the same pull request a second time, once that branch exists, SHALL resolve as a
reuse of the existing branch rather than creating a second worktree.

#### Scenario: The same PR twice is a reuse

- **WHEN** a pull request whose `pr/<number>` branch already exists is selected
- **THEN** the create resolves as a reuse of that branch, not as a new branch and not as a second
  worktree

#### Scenario: The base comes from the pull request

- **WHEN** a pull request is selected
- **THEN** the base the create would use is the pull request's own base ref, not the repository's
  default branch chosen independently

### Requirement: A fork head states the remote before the action is authorized

Where a pull request's head branch lives on a fork rather than on the repository itself, the panel
SHALL state the remote that will be configured, and SHALL state it before the create is authorized
rather than reporting it afterwards.

#### Scenario: A fork PR names its remote up front

- **WHEN** the selected pull request's head is on a fork
- **THEN** the form states the remote that will be configured, and states it while the create can
  still be abandoned

### Requirement: An unavailable forge costs discovery, never the ability to create

Where the forge is unauthenticated, unreachable, or its client is not installed, the panel SHALL show
one quiet row saying so and SHALL leave local ref search, the create-new row, and the create itself
fully working. A slow pull-request lookup SHALL NOT delay the local ref list.

#### Scenario: An unauthenticated forge does not disable branch search

- **WHEN** the forge cannot be queried because no credential is available
- **THEN** one row states that pull requests are unavailable, and every local ref and the create-new
  row remain offered and selectable

#### Scenario: A slow forge does not hold up the refs

- **WHEN** the pull-request lookup has not yet answered
- **THEN** the local refs are already listed and selectable, and the pull-request rows arrive when
  the lookup lands

#### Scenario: A missing client is not an error the user must clear

- **WHEN** the forge client is not installed on the machine
- **THEN** the same single quiet row is shown and no error dialog, notification, or blocking state is
  produced
