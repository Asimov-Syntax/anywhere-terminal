## MODIFIED Requirements

### Requirement: Every initialization suggestion is explicit and explained

An environment-file suggestion and a package-manager setup suggestion SHALL start unchecked. Each
suggested ROW SHALL name the root file that caused it to be offered. An environment-file suggestion SHALL warn that
the file may contain secrets. A suggestion SHALL NOT restate its own label, its own path, or what its
mode does.

#### Scenario: A pnpm lockfile is found

- **WHEN** `pnpm-lock.yaml` is an ordinary file at the repository root and no provisioning source exists
- **THEN** `pnpm install` is offered unchecked as setup
- **AND** the row names `pnpm-lock.yaml` as the reason for the suggestion

#### Scenario: More than one package manager is represented

- **WHEN** supported lockfiles for two package managers are present
- **THEN** each manager's static install command is offered separately and unchecked
- **AND** the extension does not select a package manager on the user's behalf

#### Scenario: A suggested environment file is offered

- **WHEN** the form offers an environment file the extension found rather than one a provider declared
- **THEN** the row is unselected, names that file once, and warns that it may contain secrets
- **AND** the row does not describe what copying does

### Requirement: The provisioning save action names what it persists

The action that writes the current Bring over selection into repository configuration SHALL be
labelled as saving the current choices as repository defaults, not as configuring an unspecified
thing. It SHALL state that ports and setup steps apply only to the current create, and that statement
SHALL be reachable as the action's own description for assistive technology. It SHALL NOT imply that
pressing it opens a second configuration interface.

#### Scenario: The action is reached without sight of the form

- **WHEN** assistive technology announces the save action
- **THEN** what the save does not cover is announced with it

## ADDED Requirements

### Requirement: A setup gate states the resulting order as its own line

WHERE the form offers to wait for setup before starting the agent, the resulting order SHALL be shown
as its own line rather than continuing the checkbox's label.

#### Scenario: The gate is offered

- **WHEN** the form shows the wait-for-setup choice
- **THEN** the order it produces reads as a separate line from the choice itself
