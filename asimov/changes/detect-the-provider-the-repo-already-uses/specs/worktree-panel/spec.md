# Spec Delta: worktree-panel

## ADDED Requirements

### Requirement: A repository is read through whichever provisioning file it already keeps

WHERE a repository declares what a new worktree needs in a file it already maintains for another
tool, the create form SHALL populate its bring-over section from that file, with each row naming
the file it came from. Beyond the file this extension defines for itself, the files read SHALL
include the orca configuration pair and the VS Code task file.

#### Scenario: A repository whose only configuration is orca's

- **WHEN** the create form opens for a repository carrying an orca configuration that names shared
  directories, an include list, and a setup script
- **THEN** the shared directories are offered as links, the included paths as copies, and the setup
  script as one step with its lines intact, every row naming the file it came from

#### Scenario: A repository whose only configuration is a task

- **WHEN** the create form opens for a repository whose task file declares a task to be run when a
  worktree is created
- **THEN** that task's command is offered as a setup step, and tasks not so declared are not

### Requirement: A source is reported as it reads, not as it would resolve

A row SHALL carry the mode the source itself gives the path — shared means link, included means
copy. A source naming material that does not exist SHALL still be offered, with what the material
turns out to be reported when it is applied. Keys a source uses for purposes other than
provisioning SHALL be ignored without the repository being reported as misconfigured.

#### Scenario: A shared directory that is not there

- **WHEN** a source names a shared directory the repository does not currently contain
- **THEN** the row is offered as a link, and no problem is reported against the file

### Requirement: A task file is read on the terms its own format defines

WHERE the VS Code task file is read, comments and trailing commas SHALL parse rather than be
reported as malformed, because the format the file is written in permits both. A declared command
containing an unresolved placeholder SHALL be offered with the repository reported as carrying that
problem, naming the task, rather than being completed with a value the extension chose.

#### Scenario: A task file written with comments

- **WHEN** the task file contains line comments, block comments and a trailing comma
- **THEN** its tasks are offered, and no problem is reported against the file

### Requirement: Exactly one detected source supplies the offer

WHEN more than one provisioning source is detected, the create form SHALL populate its section from
exactly one of them, chosen by a fixed order that does not depend on filesystem enumeration or
timing. No row from an unchosen source SHALL appear among the offered entries.


#### Scenario: Two sources in one repository

- **WHEN** a repository carries both of two detected provisioning sources
- **THEN** the section shows the rows of exactly one of them, and none of the other's

### Requirement: A present source answers, even when its answer is nothing

A source SHALL count as detected when any file it reads is present, whatever that file then yields.
A present source declaring nothing SHALL supply the offer as an empty section, and one that cannot
be read SHALL supply it as the problem it is; neither SHALL be passed over for a later source.

#### Scenario: The first source declares nothing

- **WHEN** a repository carries a first-order source whose file declares nothing, and a later source
  that declares rows
- **THEN** the section is empty, the later source appears as a row offering to switch, and none of
  its rows are offered until that is taken

### Requirement: A source that did not supply the offer stays visible and selectable

Each detected source that did not supply the offer SHALL appear as a single row naming the files it
reads and
offering to populate the section from it instead. WHEN the user takes that offer, the section SHALL
be populated from the chosen source alone, nothing SHALL be submitted or created, and the source it
replaced SHALL itself become one of the rows offering to switch.

#### Scenario: Switching to the other source

- **WHEN** the user takes the offer to populate the section from the other source
- **THEN** the section shows that source's rows, nothing is submitted, and the previously shown
  source becomes the row offering to switch back
