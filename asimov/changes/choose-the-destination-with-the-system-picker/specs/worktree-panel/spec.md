## ADDED Requirements

### Requirement: A destination can be chosen with the system folder picker

The create form SHALL offer an action that opens the system folder picker, and the chosen folder
SHALL become the form's destination override. The chosen folder SHALL reach the create in the same
untrusted field a typed override uses, and SHALL face every check a typed destination faces.

#### Scenario: A folder is chosen

- **WHEN** the user opens the picker from the create form and confirms a folder
- **THEN** the form's destination becomes that folder
- **AND** the create it composes is indistinguishable from one composed by typing that folder

#### Scenario: The picker is dismissed

- **WHEN** the user opens the picker and cancels it, or the picker fails
- **THEN** the form's destination and its ability to create are what they were before

#### Scenario: An answer arrives for a form that did not ask

- **WHEN** a picker answer names a different create form than the open one
- **THEN** the open form's destination is unchanged
