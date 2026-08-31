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

### Requirement: A removal is reported before anything is deleted

WHEN the user asks to remove a worktree, the panel SHALL present the removal report and SHALL NOT
delete anything until the user answers it. Asking for the report SHALL NOT itself remove, modify, or
delete anything.

#### Scenario: A worktree with nothing wrong with it

- **WHEN** the user asks to remove a worktree whose every confirmable check passed
- **THEN** the report is presented with an ordinary confirmation, and the worktree is removed only after the user answers it

#### Scenario: A worktree that is no longer there

- **WHEN** the checks that inspect the worktree's contents report not applicable because it is gone
- **THEN** the report is offered with an ordinary confirmation, the same as one whose checks passed

### Requirement: A confirmation carries only the authority its report was granted

A confirmation SHALL authorize a forced removal ONLY where the report it answers was itself granted
that authority. Where it was not, the confirmation SHALL take the ordinary removal path.

#### Scenario: Confirming a report that was granted nothing

- **WHEN** the user confirms a report that carries no authority to force
- **THEN** the ordinary removal is requested, and it is the removal itself that re-checks the worktree

### Requirement: A report that could not be produced is not a refusal

WHEN the worktree could not be assessed at all, the panel SHALL say the assessment could not be made
and offer to ask again. It SHALL NOT render that state as a report, and SHALL NOT present it as a
refusal to remove.

#### Scenario: The worktree could not be read

- **WHEN** the assessment cannot be produced because what it would inspect could not be read
- **THEN** the panel says so and offers a retry, rather than showing a report with every check unproven

### Requirement: A report describes the worktree the confirmation will act on

The report the user reads and the removal their confirmation authorizes SHALL be the same worktree
registration. WHERE the registration a report identified has been replaced by another at the same
location, the confirmation SHALL NOT be honoured against the replacement.

#### Scenario: A worktree is replaced at the same path before the report is produced

- **WHEN** the worktree is removed and a different one is created at the same location outside the panel, and the user then asks to remove it
- **THEN** the report describes whichever worktree is registered at that location when the report is produced, and confirming it acts on that same one

### Requirement: A report is shown only while it still answers what the user asked

An assessment answered late SHALL NOT replace what the user is looking at now. WHERE the user has
since asked for something else, cancelled, or moved to another worktree, the late report SHALL be
discarded. A retry SHALL be offered only where it could still act.

#### Scenario: The user moves on before the report arrives

- **WHEN** an assessment for one worktree is answered after the user has asked to remove a different worktree, or has opened another dialog
- **THEN** the late report is discarded and what the user is looking at is left alone

#### Scenario: The worktree left the tree before the failure was reported

- **WHEN** an assessment that could not be made is reported after its worktree is no longer listed
- **THEN** no retry is offered, because there is nothing left for it to ask about

### Requirement: An assessment that fails outright is reported, not swallowed

WHERE the assessment cannot be completed at all, the panel SHALL tell the user it could not be made
and offer to ask again. Asking to remove a worktree SHALL NOT leave the user with no response.

#### Scenario: The assessment fails rather than reporting what it could not read

- **WHEN** producing the assessment fails outright
- **THEN** the panel says the assessment could not be made and offers a retry, exactly as it does for one that reported which reads failed
