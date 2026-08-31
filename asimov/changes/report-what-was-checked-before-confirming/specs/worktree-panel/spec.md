# Spec Delta: worktree-panel

## ADDED Requirements

### Requirement: A removal is reported before anything is deleted

WHEN the user asks to remove a worktree, the panel SHALL present the removal assessment and SHALL
NOT delete anything until the user acts on it. This SHALL hold for a removal with nothing to
confirm as well as for one carrying a risk: an assessment in which every check passed SHALL still
be presented, with an ordinary confirmation.

- Asking for the assessment SHALL NOT itself remove, modify, or delete anything.

#### Scenario: A worktree with nothing wrong with it

- **WHEN** the user asks to remove a worktree whose every confirmable-risk check passed
- **THEN** the report is presented with an ordinary confirmation, and the worktree is removed only after the user confirms

### Requirement: The report shows every check, not only the failing ones

The removal report SHALL render every check the assessment carries, each with its own outcome —
passed, failed, unproven, or not applicable — including the orphan proofs. A passed check SHALL be
visible as passed rather than omitted, and a check that did not apply SHALL render as neither passed
nor failed.

- The report SHALL state that panes running inside the worktree are left running rather than closed.

#### Scenario: One risk among many passed checks

- **WHEN** the assessment reports uncommitted changes and every other check passed
- **THEN** the report names the uncommitted changes and also shows the checks that passed

### Requirement: A typed confirmation is required only where one was earned

The panel SHALL require the user to retype the worktree's name ONLY WHEN a confirmable-risk check
failed or could not be evaluated. WHEN every confirmable-risk check passed, an ordinary confirmation
SHALL be used instead.

- A withheld proof-gated option SHALL NOT cause a typed confirmation to be required.

#### Scenario: Only a proof could not be evaluated

- **WHEN** every confirmable-risk check passed and a proof is unproven
- **THEN** the removal is offered with an ordinary confirmation and no name needs to be retyped

#### Scenario: The confirmation names what earned it

- **WHEN** more than one confirmable-risk check failed
- **THEN** the confirmation names all of them at once rather than one at a time

### Requirement: The panel takes a check's class from the assessment

Whether a check is a hard refusal, a confirmable risk, or a proof SHALL be taken from the assessment
rather than decided by the panel. A typed confirmation SHALL NOT unlock any option that requires a
proof.

#### Scenario: A refusal leaves no way through

- **WHEN** the assessment reports a check the removal is refused on
- **THEN** no confirmation control is present at all, rather than one that is shown disabled
