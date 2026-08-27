# worktree-agent-presence Specification

## ADDED Requirements

### Requirement: Show what an agent's session delegated

WHEN a user expands an agent row that has a resolved session, presence SHALL report the
subagents that session delegated, one row each, at exactly one level below the agent row. The
report SHALL be produced only in response to that expansion, never as part of a routine
presence update.

#### Scenario: A row is expanded for the first time

- **WHEN** a user expands an agent row whose session is resolved and which delegated work
- **THEN** one row per delegated subagent appears beneath it

#### Scenario: Presence updates while nothing is expanded

- **WHEN** presence is recomputed and no agent row is expanded
- **THEN** no session transcript is read for delegated work

#### Scenario: The agent row has no resolved session

- **WHEN** a user expands an agent row whose session is not resolved
- **THEN** no delegated rows are reported and nothing claims the session has none

### Requirement: Delegated work is reported as history, never as live work

A reported delegation SHALL be marked as not live for as long as its evidence is a session
transcript. Each SHALL carry the delegated agent's name, the outcome the transcript recorded,
and no pane identity of its own. A delegation's freshness SHALL be its parent row's.

#### Scenario: A transcript records a delegation still marked running

- **WHEN** the transcript's record for a delegation says it was running
- **THEN** the reported row is still marked not live

#### Scenario: The parent row's evidence is no longer fresh

- **WHEN** a delegation recorded as running belongs to an agent row that is no longer working, or whose evidence source is degraded
- **THEN** that delegation is no longer reported as running

### Requirement: A delegation roster that could not be read is not an empty one

WHEN the session transcript cannot be read, presence SHALL report that failure for that agent
row alone, with a reason, and SHALL NOT report an empty roster. A failure SHALL NOT degrade the
worktree, the tree, or any other row. WHEN the transcript is read but the source dropped
records no larger read can recover, presence SHALL report the roster as incomplete rather than
as the whole of what the session delegated.

#### Scenario: The transcript cannot be read

- **WHEN** a delegation read fails for one agent row
- **THEN** that row reports the failure with a reason, every other row is unaffected, and no row reports having delegated nothing

#### Scenario: The source counted delegations it did not hand over

- **WHEN** a transcript read reports fewer delegations than the source counted, or reports that records were dropped
- **THEN** the roster is reported as incomplete rather than as the whole of what the session delegated

#### Scenario: The session delegated nothing

- **WHEN** a session's transcript is read successfully and records no delegation
- **THEN** that row reports an empty roster, distinguishable from a row whose roster was never read

#### Scenario: Nothing readable is not nothing delegated

- **WHEN** a roster is reported incomplete and carries no rows at all
- **THEN** the row states that the delegations could not be read, and SHALL NOT state that the session delegated nothing

### Requirement: One delegation is one row

A delegation SHALL be reported once. WHEN a source records the same delegated invocation both
as an invocation step and as a child session, presence SHALL report the one delegation, not two,
and SHALL prefer the record that can be opened.

#### Scenario: A source records one delegation two ways

- **WHEN** a session delegated once and its source holds both an invocation record and a child session for it
- **THEN** the roster carries one row for that delegation, offering drill-down into the child session

#### Scenario: A delegation with no child session is still reported

- **WHEN** a session's source holds an invocation record for which no child session exists
- **THEN** the roster carries a row for it, offering no drill-down
