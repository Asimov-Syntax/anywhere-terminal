## ADDED Requirements

### Requirement: A destination can be chosen with the system folder picker

The create form SHALL offer an action, unavailable wherever the destination override is unavailable,
that opens the system folder picker. The chosen folder SHALL become the folder the worktree is created
IN, keeping the name the form derives from its branch and resolving a collision inside that folder the
way one is resolved inside the configured create root.

### Requirement: An opened picker holds the form until it is answered

From the moment the picker is opened until that request is answered, the create form SHALL NOT offer
to create. Every opened picker SHALL be answered unless the form that opened it is gone.

#### Scenario: A folder is chosen

- **WHEN** the user opens the picker from the create form and confirms a folder
- **THEN** the form states a destination inside that folder, named after the branch
- **AND** the worktree is created at that destination

#### Scenario: The chosen folder already holds that name

- **WHEN** the folder the user chose already contains a directory of the derived name
- **THEN** the form states the free name the host chose inside that same folder
- **AND** the form names the directory that was skipped, as it does for the configured root

#### Scenario: A create is not offered while the folder is still being resolved

- **WHEN** the user has opened the picker and the request has not been answered
- **THEN** the form does not offer to create, and states that it is waiting on the folder

#### Scenario: The picker is dismissed

- **WHEN** the user opens the picker and cancels it, or the picker fails
- **THEN** the form's destination and its ability to create are what they were before

#### Scenario: An answer arrives after the user has moved on

- **WHEN** the user opens the picker and then types a destination, clears it, or switches repository
  before the answer arrives
- **THEN** the answer does not change the destination the user moved to

#### Scenario: A typed destination replaces a chosen folder

- **WHEN** the user chooses a folder and then types a destination
- **THEN** the typed destination is answered exactly as it is when no folder was chosen

### Requirement: Only a folder this extension offered is derived under

A destination SHALL be resolved inside a folder outside the configured create root only when the
extension itself offered that folder to that create form, for that repository. In every other case the
destination SHALL be resolved under the configured create root, and no occupancy SHALL be read inside
the folder that was not offered.

#### Scenario: An answer arrives for a form that did not ask

- **WHEN** a picker answer names a different create form than the open one
- **THEN** the open form's destination is unchanged

#### Scenario: A form that was never offered a folder

- **WHEN** a create form asks to use a chosen folder without one having been offered to it
- **THEN** the destination is resolved under the configured create root
- **AND** no occupancy is read outside that root

#### Scenario: A chosen folder does not outlive its form

- **WHEN** the create form that chose a folder is closed, superseded or detached, and a later form
  asks to use a chosen folder
- **THEN** the destination is resolved under the configured create root

#### Scenario: A chosen folder belongs to one repository

- **WHEN** a folder is chosen for one repository and the form switches to another
- **THEN** the destination for the other repository is resolved under its configured create root

#### Scenario: The folder is the one the user saw

- **WHEN** the folder chosen in the dialog resolves elsewhere by the time the destination is resolved
- **THEN** the destination is resolved inside the folder as it resolved when it was chosen
