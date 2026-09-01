# Spec Delta: worktree-panel — merge-only-the-declarations-proven-to-be-one

## MODIFIED Requirements

### Requirement: A repository's own declaration wins the path it shares

WHERE the repository's own configuration and a source it builds on declare the same path, the
section SHALL show one row carrying the repository's own mode and its own declaring file. Two
declarations are the same path only WHERE their written spellings match after normalization.

#### Scenario: One path, declared twice, spelled the same

- **WHEN** the repository's own configuration and the source it builds on declare the same path with
  the same spelling, and the two ask for different modes
- **THEN** the section shows one row for that path, carrying the repository's own mode, and naming
  the repository's own file as its source

#### Scenario: The same file, declared under two spellings

- **WHEN** two declarations differ only in letter case, or in another form a filesystem might treat
  as equivalent
- **THEN** neither is discarded, neither is merged into the other, and each keeps the spelling its
  own file wrote

## ADDED Requirements

### Requirement: Declarations that may name one destination are offered together, favouring the repository's own

WHERE two declarations differ in spelling but may name one destination, the section SHALL show and
offer both, each with its own spelling and declaring file, and SHALL record the repository's own as
the one the merge rule favours. Neither SHALL be withheld because the pair could not be told apart.

#### Scenario: Two spellings of one name, one destination

- **WHEN** a repository declares a path in one letter case with one mode, the source it builds on
  declares the same path in another letter case with a different mode, and the two names turn out to
  be one destination
- **THEN** the destination holds the repository's own material in the repository's own mode, and the
  other declaration is reported as skipped rather than silently dropped

#### Scenario: Two spellings, two destinations

- **WHEN** the same pair turns out to name two distinct destinations
- **THEN** both are materialized, each in the mode its own file asked for

#### Scenario: Both spellings are visible before the worktree exists

- **WHEN** the section holds such a pair
- **THEN** both rows are shown, each naming its own declaring file, and both can be selected

### Requirement: The extension never asks a filesystem which spellings are one file

The extension SHALL NOT consult any filesystem to decide whether two declared spellings name one
file, on any platform. Creating the worktree SHALL remain available whatever the section holds.

#### Scenario: A model built from declarations alone

- **WHEN** a section is populated from a repository's declarations
- **THEN** no declared path and no exclusion spelling is resolved, inspected or opened in order to
  decide which rows the section shows

### Requirement: An exclusion matches on the same rule the merge uses

`exclude` SHALL match a declared path under exactly the rule that decides whether two declarations
are the same path. An exclusion that matches nothing SHALL be reported rather than dropped.

#### Scenario: An exclusion spelled differently from the entry

- **WHEN** an `exclude` rule names a path in a different letter case from the entry it was meant to
  remove
- **THEN** the entry is not excluded, and the exclusion is reported as having matched nothing
