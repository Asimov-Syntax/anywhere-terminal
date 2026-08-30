## ADDED Requirements

### Requirement: One projection provokes a bounded number of transcript looks

A single presence projection SHALL permit no more than a fixed number of sessions to look at their
transcripts, however many rows it draws. The bound SHALL hold whether those rows sit in one worktree
or are spread across many.

#### Scenario: Many rows in one worktree

- **WHEN** a projection draws far more agent rows than the bound allows, all under one worktree
- **THEN** no more than the bound's worth of sessions look at their transcripts

#### Scenario: The same rows spread across worktrees

- **WHEN** the same rows are spread one per worktree instead
- **THEN** no more than the bound's worth of sessions look at their transcripts

### Requirement: A row the bound excludes keeps its line and is looked at later

A row the bound excludes SHALL still present the line it last read, and SHALL be permitted to look on
a later projection. No row SHALL be excluded on every projection while others are looked at
repeatedly.

#### Scenario: An excluded row still draws its line

- **WHEN** a row that has a previously read line falls outside a projection's bound
- **THEN** it draws that line, rather than losing its second line

#### Scenario: Every row gets its turn

- **WHEN** projections repeat over more rows than the bound allows
- **THEN** each row is permitted to look within a bounded number of projections
