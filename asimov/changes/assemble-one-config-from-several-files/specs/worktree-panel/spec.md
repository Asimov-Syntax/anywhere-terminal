# Spec Delta: worktree-panel — assemble-one-config-from-several-files

## MODIFIED Requirements

### Requirement: Exactly one detected source supplies the offer

WHEN more than one provisioning source is detected, the create form SHALL populate its section from
exactly one of them, chosen by a fixed order that does not depend on filesystem enumeration or
timing, EXCEPT where the repository's own configuration names a source to build on. No row from a
source that was neither chosen nor named SHALL appear among the offered entries.

#### Scenario: Two sources in one repository

- **WHEN** a repository carries both of two detected provisioning sources and names neither
- **THEN** the section shows the rows of exactly one of them, and none of the other's

#### Scenario: The repository names the source to build on

- **WHEN** the repository's own configuration names one of two other detected sources to build on
- **THEN** the section shows the named source's rows together with the repository's own, and none
  from the third

## ADDED Requirements

### Requirement: A repository can build on a source instead of replacing it

The repository's own configuration SHALL be able to name another provisioning source to build on.
WHERE it does, the section SHALL list the named source's declared material together with the
repository's own, and every row SHALL name the file that declared it.

WHERE the repository's own configuration names no source to build on, its declared material SHALL
be the whole of the section, and every other detected source SHALL remain unchosen — inheriting
SHALL NOT happen unless it was asked for.

#### Scenario: Building on another source

- **WHEN** the repository's own configuration names another source to build on, and both declare
  material
- **THEN** every declared item from both appears as its own row, and each row names its own
  declaring file rather than a single combined origin

#### Scenario: Declaring without naming a source to build on

- **WHEN** the repository's own configuration declares material and names no source to build on,
  in a repository that also carries another detected source
- **THEN** the section shows only the repository's own material, and the other source appears as a
  row offering to switch

### Requirement: The repository's own declaration wins the path it shares

WHERE the repository's own configuration declares material at a path also declared by the source it
builds on, exactly one row SHALL be offered for that path, and it SHALL be the repository's own —
including how that material is brought over, so a path the named source links MAY become a path the
repository copies.

The surviving row SHALL name the file that declared it.

#### Scenario: The same path declared by both

- **WHEN** the source being built on declares a path as linked, and the repository's own
  configuration declares the same path as copied
- **THEN** one row is offered for that path, it is copied rather than linked, and it names the
  repository's own configuration as its source

### Requirement: A path the repository removed is shown as deliberate

The repository's own configuration SHALL be able to remove material inherited from the source it
builds on. A removed path SHALL be shown as deliberately excluded rather than omitted, SHALL keep
the name of the file that originally declared it, and SHALL NOT be counted among the material the
section says will be brought over.

Removing a path the repository itself declared SHALL be reported as a problem naming that path,
and SHALL NOT remove the row.

#### Scenario: An inherited path removed

- **WHEN** the repository's own configuration removes a path the source it builds on declared
- **THEN** that path is shown as deliberately excluded, still naming the file that declared it, and
  the section's count of what will be brought over does not include it

#### Scenario: Removing a path the repository itself declared

- **WHEN** the repository's own configuration both declares a path and removes it
- **THEN** the row remains offered and the section reports a problem naming that path

### Requirement: Setup commands from two sources run as both files wrote them

WHERE the section carries setup commands from more than one file, every command SHALL be offered,
in the order the files declare them, with the source being built on before the repository's own.
Two identical commands from two files SHALL both be offered.

#### Scenario: The same command declared twice

- **WHEN** the source being built on and the repository's own configuration each declare the same
  setup command
- **THEN** both are offered as separate rows, each naming its own file, and neither is dropped

### Requirement: One unreadable part never discards the rest of a configuration

A configuration that is malformed, that holds a key the system does not read, that names a source
to build on which is not there, or that names one which is there and could not be read SHALL each
be reported as a distinct problem naming the file and what was lost. None of them SHALL discard the
rest of the file.

WHERE the named source to build on is not there, the repository's own declared material SHALL still
be offered.

### Requirement: A source that could not be read is not a source that is absent

A named source to build on that was found and could not be read SHALL be reported as unreadable and
SHALL NOT be reported as one that is not there.

#### Scenario: Naming a source that is there and cannot be read

- **WHEN** the repository's own configuration names a source to build on which the repository does
  carry, and that file cannot be read
- **THEN** the section reports that the file could not be read, not that it is missing, and still
  offers the repository's own declared material

#### Scenario: Naming a source that is not there

- **WHEN** the repository's own configuration names a source to build on which the repository does
  not carry, and also declares its own material
- **THEN** the section reports that the named source is missing, offers the repository's own
  declared material, and leaves the create available

#### Scenario: A key the system does not read

- **WHEN** the repository's own configuration holds one key the system does not read alongside keys
  it does
- **THEN** the section reports that one key and offers every row the other keys declared

### Requirement: Every key a configuration declares is judged as a key of that file

Every key a configuration file declares SHALL be judged as a key of that file, whatever the key is
named. A name the configuration format's host language gives a meaning of its own SHALL NOT thereby
supply a value the system reads.

#### Scenario: A key named for a host-language member

- **WHEN** the repository's own configuration declares a key whose name the configuration format's
  host language gives its own meaning to, and that key holds values the system would otherwise read
- **THEN** the section reports it as a key the system does not read, and none of the values under it
  is used to name a source to build on, to remove a row, or to declare one
