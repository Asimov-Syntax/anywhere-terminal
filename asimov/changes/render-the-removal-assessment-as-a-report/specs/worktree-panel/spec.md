# Spec Delta: worktree-panel

## ADDED Requirements

### Requirement: The removal report shows every check it ran, with its own outcome

The remove dialog SHALL render every check the assessment reported — the ones that passed included, the ordinary checks and the orphan proofs alike — each with its own outcome. A check reported as unproven SHALL NOT be rendered as passed, and a check reported as not applicable SHALL be rendered as neither.

#### Scenario: Nothing is wrong with the worktree

- **WHEN** every check the assessment ran passed
- **THEN** the dialog still lists those checks with their outcomes rather than presenting an empty report

#### Scenario: A check could not be evaluated

- **WHEN** a check is reported as unproven
- **THEN** it is rendered as a check that could not be evaluated, distinct from both a passing and a failing one

### Requirement: A typed confirmation is required only where a confirmable risk earned one

Given an assessment, the dialog SHALL decide its control from the classes and outcomes reported: a refusal-class check that is failing or unproven leaves no confirmation control, a confirmable one requires the worktree's name to be typed, and anything else takes an ordinary confirmation. A proof that is unproven or withheld SHALL NOT require a typed confirmation. Which removals are assessed at all is the host's policy, not this contract's.

#### Scenario: Only a proof is unproven

- **WHEN** no confirmable check is failing or unproven and one or more proofs cannot be evaluated
- **THEN** the removal is offered with an ordinary confirmation and no typed confirmation is asked for

#### Scenario: A confirmable risk could not be evaluated

- **WHEN** a confirmable check is reported as unproven
- **THEN** the removal is offered behind a typed confirmation rather than withheld

#### Scenario: A refusal-class check could not be evaluated

- **WHEN** a refusal-class check is reported as unproven
- **THEN** no confirmation is offered, the same as if that check had failed
