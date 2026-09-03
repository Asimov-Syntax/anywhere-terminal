## ADDED Requirements

### Requirement: A repository without provisioning configuration gets bounded initialization suggestions

WHERE no provisioning source is present, the create form SHALL inspect only a fixed set of supported
repository-root environment filenames and package-manager lockfiles. It SHALL NOT recursively scan,
expand a wildcard, or read an environment file's contents to decide whether to suggest it. A present
source that is empty or unreadable SHALL remain the source's answer and SHALL suppress fallback
suggestions.

#### Scenario: An environment file exists without provisioning configuration

- **WHEN** the repository root contains an ordinary `.env.local` file and no provisioning source
- **THEN** `.env.local` is offered as a copy suggestion
- **AND** no byte of `.env.local` is read to produce the offer

#### Scenario: A provisioning source is present but empty

- **WHEN** the repository has an empty supported provisioning file and also has `.env`
- **THEN** the source supplies the empty offer and `.env` is not suggested

### Requirement: Every initialization suggestion is explicit and explained

An environment-file suggestion and a package-manager setup suggestion SHALL start unchecked. Each
SHALL name the root file that caused it to be offered and explain what selecting it does. An
environment-file suggestion SHALL state that the file may contain secrets and that copy creates an
independent file in the worktree. A setup suggestion SHALL state that its command runs in the
worktree after file provisioning.

#### Scenario: A pnpm lockfile is found

- **WHEN** `pnpm-lock.yaml` is an ordinary file at the repository root and no provisioning source exists
- **THEN** `pnpm install` is offered unchecked as setup
- **AND** the row names `pnpm-lock.yaml` as the reason for the suggestion

#### Scenario: More than one package manager is represented

- **WHEN** supported lockfiles for two package managers are present
- **THEN** each manager's static install command is offered separately and unchecked
- **AND** the extension does not select a package manager on the user's behalf

### Requirement: Suggestions spend only the host-held offer the user selected

Selecting suggestions SHALL apply only to the current create unless an expressible file choice is
saved. Create SHALL carry only the current host-issued offer id and selected opaque item ids; no path
or command text supplied by the form SHALL become copy or execution authority. A stale, foreign, or
superseded suggestion id SHALL authorize neither create nor setup.

### Requirement: Saving suggestions records positive file consent but never setup consent

WHEN a user explicitly saves selected environment-file suggestions, the repository's native worktree
configuration SHALL record those files as copies for future creates. An unselected suggestion SHALL
record no exclusion or other preference. Suggested setup commands SHALL remain current-create-only.

#### Scenario: An untouched suggestion set is saved

- **WHEN** environment and setup suggestions are offered, none is selected, and Save defaults is pressed
- **THEN** no configuration file is created

#### Scenario: One environment suggestion is selected and saved

- **WHEN** `.env.local` is selected, the setup suggestion is not selected, and Save defaults is pressed
- **THEN** the native configuration records `.env.local` under `copy`
- **AND** it records no setup command

### Requirement: A saved configuration replaces fallback suggestions

WHILE no provisioning source exists, an unsaved suggestion SHALL be offered unchecked again on a
later form. WHEN a save creates the native configuration, later forms SHALL present the saved
configuration as the provisioning source and SHALL offer no fallback suggestions.

#### Scenario: The saved copy becomes the provisioning source

- **WHEN** a save recorded `.env.local` and a later create form opens with `pnpm-lock.yaml` still present
- **THEN** the form offers `.env.local` as a configured native copy
- **AND** no fallback suggestion, including the `pnpm install` setup command, is offered

## MODIFIED Requirements

### Requirement: The create form states what the new worktree will lack

The create form SHALL list configured provisioning material or fallback initialization suggestions.
WHERE neither exists, it SHALL state that no configured items or supported repository-root
suggestions were found, rather than presenting an empty list or claiming that an uninspected file is
absent.

### Requirement: A configuration written for the first time names a source that exists

WHERE the first save records a choice inherited from another provisioning source, the new native
configuration SHALL name a present source file. WHERE the first save records a selected fallback file
suggestion, it SHALL record that copy inline and SHALL NOT invent an `extends` source.

### Requirement: A save that has nothing to record writes nothing

An offered but unselected fallback suggestion is not a changed preference. WHERE no suggested file is
selected, no configured expressible choice changed, and no different source was chosen, Save SHALL
leave the native configuration exactly as found and create no file.
