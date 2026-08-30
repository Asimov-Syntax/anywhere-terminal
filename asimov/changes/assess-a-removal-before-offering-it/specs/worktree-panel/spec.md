# Spec Delta — worktree-panel

## ADDED Requirements

### Requirement: A removal refuses when it cannot establish that nothing is using the worktree

WHEN an agent session rooted in the worktree reports activity of running or waiting, or its activity cannot be determined — in this window or in the session registry — the removal SHALL be refused and no confirmation control SHALL be offered. A typed confirmation SHALL NOT authorize such a removal. An agent session that is provably idle SHALL be reported as a confirmable risk rather than a refusal.

#### Scenario: A registry session whose activity cannot be read

- **WHEN** the session registry names a session rooted in the worktree and its activity cannot be determined
- **THEN** the removal is refused and no confirmation is offered

#### Scenario: The registry itself cannot be read

- **WHEN** the session registry cannot be read at all
- **THEN** the agent checks are reported as unproven rather than passed, and the removal is not offered as unconditionally safe

### Requirement: A removal reports the ignored material it will delete

The removal assessment SHALL report ignored content in the worktree as a confirmable risk, with the number of entries and their total size. The measurement SHALL be bounded by a maximum entry count and a maximum elapsed time, and WHEN either bound is reached, or the content cannot be read, the check SHALL be reported as unproven rather than reporting a partial measurement as a total. An unproven ignored-material check SHALL remain confirmable and SHALL NOT refuse the removal.

#### Scenario: Ignored content exceeds the measurement budget

- **WHEN** the ignored content in the worktree exceeds the entry or time bound
- **THEN** the check is reported as unproven and the removal remains offered with a confirmation

### Requirement: Material this extension provisioned is named only from a record of provisioning it

WHEN a readable record of what the worktree was provisioned with is present, the assessment SHALL report the provisioned material separately from the undifferentiated ignored total. WHEN that record is absent, unreadable, or of an unrecognized version, the assessment SHALL report the undifferentiated total and SHALL state that provisioned material was not distinguished. The assessment SHALL NOT infer that a file was provisioned from its name or location.

### Requirement: A check that did not apply is distinguishable from one that passed

Every check the removal assessment reports SHALL carry an outcome that distinguishes passing, failing, being unproven, and not applying. A check whose question does not arise for this worktree SHALL be reported as not applicable, and SHALL NOT be reported as passed.

### Requirement: A confirmation authorizes only the risks it was shown

Before performing a removal the system SHALL re-evaluate the checks. WHEN a check that was not failing at the time of confirmation is failing at execution time, the removal SHALL NOT proceed and a fresh confirmation SHALL be requested. A check that was already failing when the user confirmed SHALL NOT cause a fresh confirmation to be requested. WHEN re-evaluation establishes a refusal, the removal SHALL be refused rather than re-confirmed.

#### Scenario: A live agent appears after the user confirmed dirty files

- **WHEN** the user confirms a removal reporting uncommitted changes, and an agent session becomes active before the removal runs
- **THEN** the removal does not proceed and is refused
