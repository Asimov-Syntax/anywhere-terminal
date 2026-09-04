## MODIFIED Requirements

### Requirement: A repository without provisioning configuration gets bounded initialization suggestions

WHERE no provisioning source is present, the create form SHALL inspect a fixed set of supported
environment filenames at the repository root and one level inside each workspace directory the
repository itself declares, together with the repository-root package-manager lockfiles. A present
source that is empty or unreadable SHALL remain the source's answer and SHALL suppress fallback
suggestions.

#### Scenario: An environment file exists without provisioning configuration

- **WHEN** the repository root contains an ordinary `.env.local` file and no provisioning source
- **THEN** `.env.local` is offered as a copy suggestion
- **AND** no byte of `.env.local` is read to produce the offer

#### Scenario: A provisioning source is present but empty

- **WHEN** the repository has an empty supported provisioning file and also has `.env`
- **THEN** the source supplies the empty offer and `.env` is not suggested

## ADDED Requirements

### Requirement: A workspace repository's package environment files are found

WHERE the repository declares workspace packages, each declared directory SHALL be examined one level
deep for the same supported environment filenames, and each found file SHALL be offered by its
repo-relative path. The extension SHALL NOT scan a directory the repository did not declare, expand a
pattern it does not implement, read an environment file's contents, offer anything that resolves
outside the repository, or exceed the existing scan and row budgets however many patterns are
declared.

#### Scenario: A monorepo keeps its environment files in its packages

- **WHEN** the repository declares `apps/*` as workspaces, has no root environment file, and
  `apps/web/.env` and `apps/server/.env` are ordinary files
- **THEN** both are offered as unchecked copy suggestions named `apps/web/.env` and `apps/server/.env`

#### Scenario: A declared pattern points outside the repository

- **WHEN** the repository declares a workspace pattern that resolves outside the checkout
- **THEN** no suggestion from outside the repository is offered

#### Scenario: The repository declares no workspaces

- **WHEN** the repository has no workspace declaration
- **THEN** only repository-root suggestions are offered
