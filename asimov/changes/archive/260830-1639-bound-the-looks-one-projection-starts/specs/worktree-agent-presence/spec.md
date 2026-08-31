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

### Requirement: A row the bound excludes keeps its line

A row the bound excludes SHALL still present the line the preview service holds for it, rather than
losing its second line. A session the window has stopped drawing is not covered.

#### Scenario: An excluded row still draws its line

- **WHEN** a row that has a previously read line falls outside a projection's bound
- **THEN** it draws that line, rather than losing its second line

### Requirement: A row drawn on every projection is looked at within a bounded number of them

A row drawn on every projection SHALL be permitted to look within a bounded number of projections. A
row that stops being drawn takes its turn afresh when it returns.

#### Scenario: Every continuously drawn row gets its turn

- **WHEN** projections repeat over more rows than the bound allows
- **AND** one row is drawn on every one of them
- **THEN** it is permitted to look within a bounded number of projections

#### Scenario: A returning row takes a fresh turn

- **WHEN** a row is absent from one projection and drawn again on the next
- **THEN** it is permitted to look on a later projection rather than being dropped
