# Spec Delta: worktree-panel — write-only-the-native-config-file

## ADDED Requirements

### Requirement: A choice the repository's own configuration can express is recorded there

WHERE the create form offers to save what the user has chosen, the extension SHALL record in the
repository's own provisioning configuration every chosen state that configuration is able to
express, and SHALL express a change to an inherited declaration as an entry in that file rather
than as an edit to the file that declared it.

#### Scenario: An inherited entry the user does not want

- **WHEN** the user clears an entry that came from another tool's configuration and saves
- **THEN** the repository's own configuration excludes that path
- **AND** the file that declared the entry is unchanged

#### Scenario: An entry the repository declared itself

- **WHEN** the user clears an entry the repository's own configuration declared inline and saves
- **THEN** that path is no longer declared by the repository's own configuration
- **AND** no exclusion is recorded for it

### Requirement: A choice that configuration cannot express is stated, not silently dropped

WHERE a chosen state has no expression in the repository's own provisioning configuration, the
create form SHALL state before the save that the choice applies to this create only, and the
extension SHALL leave that choice unrecorded rather than approximating it.

#### Scenario: A setup command the user chose to run

- **WHEN** the user checks a setup command and saves
- **THEN** the saved configuration grants that command no standing consent
- **AND** the command is offered unchecked the next time the form is opened

### Requirement: No configuration file another tool defined is ever written

The extension SHALL write exactly one provisioning file — the repository's own — and SHALL leave
every other detected provisioning file byte-identical across every operation this control offers.

#### Scenario: A framework's file after a save

- **WHEN** any save this control offers completes, whatever the user chose
- **THEN** every provisioning file the extension did not define holds the same bytes it held before

### Requirement: A configuration that cannot be edited safely is refused rather than rewritten

WHERE the repository's own provisioning configuration cannot be parsed, or declares a key this
control writes with a different shape than that key requires, the extension SHALL refuse the save,
leave the file unchanged, and report why.

#### Scenario: A configuration with a syntax error

- **WHEN** a save is attempted against a configuration that does not parse
- **THEN** the file is byte-identical afterwards
- **AND** the form reports that the configuration could not be edited

### Requirement: An existing configuration keeps the formatting and comments it had

WHERE the repository already has its own provisioning configuration, a save SHALL preserve the
comments and formatting of every part of that file it did not change, and SHALL preserve the file's
existing permissions.

#### Scenario: A commented configuration gains an exclusion

- **WHEN** a save adds an exclusion to a configuration carrying comments and its own indentation
- **THEN** the comments and the indentation of the untouched parts survive the save

### Requirement: A configuration written for the first time names a source that exists

WHERE the repository has no configuration of its own, the first save SHALL record as the source to
build on a file that the detected source actually supplied, rather than the entries that source
resolved to and rather than a filename that source is merely able to read.

#### Scenario: A tool detected by one of the several files it accepts

- **WHEN** the first save happens in a repository where the active source was detected through only
  one of the files it accepts
- **THEN** the configuration written names a file that is present
- **AND** it does not restate the entries that file declared

### Requirement: Choosing a different source changes only which source is named

WHEN the user selects a detected source other than the one supplying the offer and saves, the
extension SHALL change only which source the repository's own configuration builds on, leaving
every other declaration in that file as it was.

### Requirement: A save answers for the form that is still open

WHERE a save and a source change are both in flight for one form, the extension SHALL leave the
form describing the later of the two choices, and SHALL publish nothing into a form that has since
closed.

### Requirement: A refusal to save says a save was refused

WHERE a save is refused for any reason other than the configuration's own content, the extension
SHALL report it as a save that did not happen, and SHALL NOT report it as a failure to read a file
it read successfully.

#### Scenario: The configuration is held by another window

- **WHEN** a save is refused because the file is locked elsewhere
- **THEN** the form states that the configuration was not saved
- **AND** the form does not state that the configuration could not be read

#### Scenario: The configuration itself is at fault

- **WHEN** a save is refused because the configuration does not parse
- **THEN** the form states that the configuration could not be edited, which is a statement about
  the file rather than about the save

### Requirement: A save that has nothing to record writes nothing

WHERE the user has changed nothing the configuration can express and has not chosen a different
source, the extension SHALL leave the repository's configuration exactly as it found it, creating
no file.

#### Scenario: Configure pressed on an untouched form

- **WHEN** a save is made with every offered item still as it arrived and no source taken
- **THEN** no configuration file is created
- **AND** the repository has nothing new to commit

#### Scenario: A source taken and nothing else changed

- **WHEN** a save is made after choosing a different source, with every offered item unchanged
- **THEN** the configuration records that source and nothing else

### Requirement: No save is offered against a source change still in progress

WHERE the user has chosen a different source and the extension has not yet answered with what that
source declares, the extension SHALL NOT offer to record the selection, and SHALL offer it again
once the answer arrives.

#### Scenario: Saving between choosing a source and seeing it

- **WHEN** a different source is chosen
- **THEN** the control that records the selection is not offered
- **AND** it is offered again when the new selection is shown
- **AND** the source change is never abandoned in favour of the save

#### Scenario: The chosen source cannot be read

- **WHEN** a different source is chosen and reading it fails
- **THEN** the failure is reported
- **AND** the control that records the selection is offered again

