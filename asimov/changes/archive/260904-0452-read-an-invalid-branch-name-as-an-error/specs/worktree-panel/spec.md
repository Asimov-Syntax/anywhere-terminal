## ADDED Requirements

### Requirement: A branch name git will not take is refused on the field

WHERE the create form would create a new branch, the extension SHALL ask git whether the typed name
is acceptable and SHALL state a refusal on the branch field itself, marked as an error, rather than
only as the disabled action's waiting reason. The extension SHALL NOT decide acceptability itself:
where git cannot be asked, the form SHALL state nothing and the create SHALL proceed to git as it
does today.

#### Scenario: The name contains a space

- **WHEN** the user types a branch name git refuses, and the form's answer arrives
- **THEN** the branch field is marked invalid and states the refusal
- **AND** Create is not offered

#### Scenario: The name becomes acceptable

- **WHEN** the user edits a refused name into one git accepts
- **THEN** the field's refusal is gone once the answer for the new name arrives

#### Scenario: A refusal is not asked for where no branch is created

- **WHEN** the form would detach, reuse or reattach rather than create a branch
- **THEN** no acceptability answer is given for it, exactly as no base verdict is

#### Scenario: git cannot be asked

- **WHEN** the acceptability of a name cannot be established
- **THEN** the field states no refusal, and the create is left to git to accept or refuse

## MODIFIED Requirements

### Requirement: A disabled create action states what it is waiting for

WHERE Create worktree is disabled, the form SHALL show one concise reason describing the first unmet
condition, a refusal it already holds ranking ahead of a pending assessment: a missing or invalid
branch/ref, an unresolved destination, a pending clearance assessment, an unavailable base, or an
unchosen permission posture. The reason SHALL be associated with the disabled button for assistive
technology and SHALL disappear when the action becomes available.

#### Scenario: A refused name is not reported as a pending check

- **WHEN** the form holds a refusal for the branch name the user has typed
- **THEN** the disabled action's reason is that refusal, not that the selection is still being checked
