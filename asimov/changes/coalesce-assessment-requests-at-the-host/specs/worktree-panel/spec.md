# Spec Delta: worktree-panel

## ADDED Requirements

### Requirement: An assessment the user moved on from does not delay what they do next

WHERE the user asks about removing several worktrees in succession, asks repeatedly, or asks from
more than one panel, the assessments they have moved on from SHALL NOT accumulate. An action the user
then takes on the same repository — a removal, a lock, an unlock, a prune or a create — SHALL wait
behind at most one assessment, whatever the number or pattern of requests and however many panels
have been opened or closed.

#### Scenario: The user asks about several worktrees before deciding

- **WHEN** the user asks to remove one worktree, then another, then the first again, and then confirms a removal
- **THEN** the confirmed removal waits behind at most one assessment, not behind the ones that were superseded

#### Scenario: Panels are opened and closed while asking

- **WHEN** a panel is opened, asks about a removal, and is closed, repeatedly
- **THEN** a removal asked for afterwards still waits behind at most one assessment

#### Scenario: Two panels ask at once

- **WHEN** two panels each ask about removing a worktree in the same repository
- **THEN** each panel is answered in turn, and neither is starved by the other continuing to ask

### Requirement: Asking to remove again always asks again

WHEN the user asks to remove a worktree, the panel SHALL put the question rather than suppress it,
whatever earlier assessment of that worktree is outstanding and whatever became of its answer. The
panel SHALL NOT reach a state in which asking to remove a worktree does nothing.

#### Scenario: The answer to the first request never arrives

- **WHEN** the reply to an assessment is lost before it reaches the panel
- **THEN** asking to remove that worktree again produces a report rather than nothing

#### Scenario: The same worktree is asked about twice

- **WHEN** the user asks to remove the same worktree twice in succession
- **THEN** exactly one report is shown, and it is the answer to the later request
