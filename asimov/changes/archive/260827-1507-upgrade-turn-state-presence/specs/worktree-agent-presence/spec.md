## ADDED Requirements

### Requirement: A reported turn outranks inferred activity while it is fresh

WHERE a pane's agent reports its own turn, presence SHALL report that turn's activity and name the
report as the deciding source, in preference to output, title, or process evidence. A report SHALL
stop deciding activity once it is older than the staleness window, after which the identity it
carried is retained and the pane's activity falls back to inference.

#### Scenario: A report contradicts the output evidence

- **WHEN** a pane reports that its agent is working while no output has been seen recently
- **THEN** the row reports running, and names the report rather than output as what decided it

#### Scenario: A report ages out

- **WHEN** a pane's most recent report is older than the staleness window
- **THEN** the row's activity is decided by inference again, its interactive prompt is cleared, and
  the identity the report established is kept

### Requirement: The same turn reported twice is one turn

WHERE the same report reaches the window more than once, presence SHALL report exactly what one
copy would have produced. A repeat SHALL NOT extend how long the report counts as fresh, SHALL NOT
restart the age of the state it describes, and SHALL NOT add a second entry to what the session
delegated.

#### Scenario: A duplicate arrives while the first is still fresh

- **WHEN** an identical report for a pane arrives a second time
- **THEN** the row's activity, its age, and its delegated work are unchanged by the second copy

### Requirement: A repeated action is not one action

Presence SHALL treat two reports as copies of one event only while they arrive close enough
together to have come from one event, and never on the strength of matching content alone.

#### Scenario: The user submits the same prompt again

- **WHEN** a pane reports an identical turn again, long enough after the first that it cannot have
  come from the same event
- **THEN** the row reports the new turn rather than holding what the first one left

#### Scenario: A duplicate start and a duplicate stop for one delegation

- **WHEN** the start of one delegation is reported twice and its end is reported twice
- **THEN** the row reports that delegation once while it runs and none of it afterwards

### Requirement: A turn a delegation is still working on is not a finished turn

WHERE an agent reports its own turn finished while work it delegated is still reported as running,
presence SHALL continue to report the pane as working until no delegated work remains.

#### Scenario: The agent finishes before its delegation does

- **WHEN** a pane reports its turn finished and one delegation is still reported running
- **THEN** the row still reports running

#### Scenario: The last delegation ends

- **WHEN** the final still-running delegation is reported finished after its agent's turn ended
- **THEN** the row reports idle

### Requirement: A session that resumes or clears has not completed a turn

WHERE a report describes a session starting, resuming, being cleared, or returning from compaction
rather than a turn ending, presence SHALL NOT report it as a completed turn, and SHALL discard
whatever the previous session reported as delegated.

#### Scenario: A resumed session lands idle

- **WHEN** a pane reports a session start that lands idle
- **THEN** no turn is reported as having just completed

#### Scenario: A session returns from compaction

- **WHEN** a pane reports a session start whose stated cause is compaction
- **THEN** no turn is reported as having just completed, and the delegations the previous session
  reported are gone

### Requirement: What the process is doing overrides what the agent reported

WHERE a pane's process contradicts its agent's most recent report, presence SHALL report the
process. A pane whose pty has exited SHALL report exited whatever it last reported, and a pane whose
title shows a shell has reclaimed it SHALL report idle whatever it last reported.

#### Scenario: The pty exits mid-turn

- **WHEN** a pane's pty exits while its last report said the agent was working
- **THEN** the row reports exited

#### Scenario: A shell reclaims the pane

- **WHEN** a pane's title reports a shell while its last report said the agent was working
- **THEN** the row reports idle

### Requirement: A reported session identity is a lookup key and a reported path is never opened

WHERE an agent reports which session it is and where its transcript lives, presence SHALL use the
reported session only to look up an entry that already exists, and SHALL NOT create one. A reported
transcript path SHALL be used only when it matches the path already recorded for that session, and
SHALL NOT be opened on the report's authority.

#### Scenario: A reported session nothing knows about

- **WHEN** a pane reports a session id that matches no stored entry
- **THEN** no entry is created and the pane's identity falls back to the other evidence

#### Scenario: A reported transcript path that disagrees with the stored one

- **WHEN** a pane reports a transcript path different from the one stored for that session
- **THEN** the reported path is discarded and nothing at it is read

### Requirement: A pane that is gone leaves no report behind

WHEN a pane is destroyed, by any route, presence SHALL retain neither its last report nor the
delegations that report described.

#### Scenario: A pane closes mid-turn

- **WHEN** a pane is destroyed while its agent's last report said it was working with a delegation
  running
- **THEN** no row, reported turn, or delegation for that pane survives

#### Scenario: The window is reloaded

- **WHEN** the window is reloaded while a pane's agent had reported it working
- **THEN** the restored pane carries no reported turn and its activity is decided by inference
  until its new process reports one

## MODIFIED Requirements

### Requirement: Delegated work is reported as history, never as live work

A reported delegation SHALL be marked as not live for as long as its evidence is a session
transcript, and SHALL be marked live only where its evidence is its own agent's fresh report of
starting and finishing it. Each SHALL carry the delegated agent's name, the outcome its evidence
recorded, and no pane identity of its own. A delegation's freshness SHALL be its parent row's.

#### Scenario: A transcript records a delegation still marked running

- **WHEN** the transcript's record for a delegation says it was running
- **THEN** the reported row is still marked not live

#### Scenario: The parent row's evidence is no longer fresh

- **WHEN** a delegation recorded as running belongs to an agent row that is no longer working, or whose evidence source is degraded
- **THEN** that delegation is no longer reported as running

#### Scenario: An agent reports its own delegation while it runs

- **WHEN** a pane with a fresh report has reported starting a delegation it has not reported finishing
- **THEN** that delegation is reported live, in preference to what the transcript records for the
  same session
