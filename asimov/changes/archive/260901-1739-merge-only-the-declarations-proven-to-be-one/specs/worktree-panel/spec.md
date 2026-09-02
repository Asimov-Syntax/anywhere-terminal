# Spec Delta: worktree-panel — merge-only-the-declarations-proven-to-be-one

## ADDED Requirements

### Requirement: Two declarations are one path only when they are spelled alike

Two declared paths SHALL count as the same path only WHERE their written spellings match after the
extension's own normalization. A pair whose spellings differ SHALL NOT be treated as one path,
whatever relation a filesystem might hold between them.

#### Scenario: One path, declared twice, spelled the same

- **WHEN** two sources declare the same path with the same spelling and ask for different modes
- **THEN** the section shows one row for that path

#### Scenario: The same file, declared under two spellings

- **WHEN** two declarations differ only in letter case, or in another form a filesystem might treat
  as equivalent
- **THEN** neither is discarded, neither is merged into the other, and each keeps the spelling its
  own file wrote

### Requirement: Declarations that may name one destination are offered together, favouring the repository's own

WHERE two declarations differ in spelling but may name one destination, the section SHALL show and
offer both, each with its own spelling and declaring file, and SHALL record the repository's own as
the one the merge rule favours. Neither SHALL be withheld because the pair could not be told apart.

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
