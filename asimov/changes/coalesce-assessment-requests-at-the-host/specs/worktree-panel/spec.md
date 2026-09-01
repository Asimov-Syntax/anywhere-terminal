# Spec Delta: worktree-panel

## ADDED Requirements

### Requirement: An assessment the user moved on from does not delay what they do next

WHERE the user asks about removing several worktrees in succession, asks repeatedly, or asks from
more than one panel, the assessments they have moved on from SHALL NOT accumulate. An action the user
then takes on the same repository — a removal, a lock, an unlock, a prune or a create — SHALL wait
behind at most a bounded amount of assessment work, whatever the number or pattern of requests.

#### Scenario: The user asks about several worktrees before deciding

- **WHEN** the user asks to remove one worktree, then another, then the first again, and then confirms a removal
- **THEN** the confirmed removal is not delayed by the assessments that were superseded before they ran

#### Scenario: Two panels ask at once

- **WHEN** two panels each ask about removing a worktree in the same repository
- **THEN** each panel receives the answer to its own latest question, and neither panel's superseded requests delay the other

### Requirement: Asking to remove again replaces the question rather than being ignored

WHEN the user asks to remove a worktree while an earlier assessment of that same worktree is
outstanding, the panel SHALL replace the earlier question with the new one and answer the new one. It
SHALL NOT ignore the request, and SHALL NOT be left without a response because an earlier answer
never arrived.

#### Scenario: The answer to the first request never arrives

- **WHEN** the reply to an assessment is lost before it reaches the panel
- **THEN** asking to remove that worktree again produces a report rather than nothing

#### Scenario: The same worktree is asked about twice

- **WHEN** the user asks to remove the same worktree twice in succession
- **THEN** exactly one report is shown, and it is the answer to the later request
