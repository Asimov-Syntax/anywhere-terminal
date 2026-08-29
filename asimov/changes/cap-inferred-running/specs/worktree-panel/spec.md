## MODIFIED Requirements

### Requirement: Strongest state wins and shape carries it

Each presented activity — `waiting`, `running`, `running (unconfirmed)`, `unknown`, `idle`, `exited` — SHALL be distinguishable from every other by shape alone, without colour or motion. The same shape SHALL be used on a worktree row and on an agent row.

A worktree row SHALL reflect the strongest presented activity among its agents, in the precedence `waiting` > `running` > `unknown` > `idle` > `exited`, where `running (unconfirmed)` ranks as `running` and loses to it.

#### Scenario: One waiting agent among several running ones

- **WHEN** a worktree holds one agent whose activity is `waiting` and four whose activity is `running`
- **THEN** the worktree row reads as `waiting`

#### Scenario: Motion is removed

- **WHEN** the viewer has asked for reduced motion, so no state animates
- **THEN** `running`, `running (unconfirmed)` and `idle` remain distinguishable from each other by shape

#### Scenario: An unknown agent outranks an idle one

- **WHEN** a worktree holds one agent presented as `unknown` and one whose activity is `idle`
- **THEN** the worktree row reads as `unknown`

#### Scenario: A worktree whose only running agent is unconfirmed

- **WHEN** a worktree holds one agent presented as `running (unconfirmed)` and one whose activity is `idle`
- **THEN** the worktree row reads as `running (unconfirmed)`
- **AND** adding one agent whose activity is `waiting` makes the worktree row read as `waiting`

#### Scenario: A worktree holding both a confirmed and an unconfirmed run

- **WHEN** a worktree holds one agent presented as `running` and one presented as `running (unconfirmed)`
- **THEN** the worktree row reads as `running`, in any order — a worktree reads as unconfirmed only when every running claim it holds is

## ADDED Requirements

### Requirement: A summary counts every state it is summarising

Any collapsed summary of a worktree's agents SHALL group them by exact presented state, so a row presented as `running (unconfirmed)` is counted as that state and never omitted from the summary.

#### Scenario: A collapsed worktree holding an unconfirmed run

- **WHEN** a collapsed worktree holds one agent presented as `running (unconfirmed)` and one whose activity is `idle`
- **THEN** its summary accounts for both, the unconfirmed one under its own state

### Requirement: A claim that outlived its evidence says how long and on what

WHEN a row's claim has outlived what its evidence can support, the row SHALL say how long it has stood unchanged and on what evidence it rests, without adding a field to any row or message.

That statement SHALL remain true for as long as it is displayed: a hint read later than it was written SHALL NOT understate the elapsed time.

#### Scenario: An inferred claim that has outlived its evidence

- **WHEN** a row presented as `running (unconfirmed)` is inspected
- **THEN** it states how long the activity has stood unchanged and that it was inferred from terminal output rather than reported

#### Scenario: The hint is read long after it was written

- **WHEN** a hint written at the moment a row crossed the ceiling is read an hour later, no repaint having occurred
- **THEN** what it says about the elapsed time is still true

### Requirement: An inferred running claim stops animating once it outlives its evidence

WHEN a row's activity is `running`, its activity source is terminal output, and that activity has stood unchanged for at least the confirmation ceiling, the view SHALL present the row as `running (unconfirmed)`, whose shape is static where the confirmed one animates.

The row's activity value, its activity source, and every message shape SHALL be unchanged by this. The row SHALL NOT be presented as `idle`: the pane is producing output, and replacing an overstatement with a different false claim is not a correction.

#### Scenario: An inferred run outlives the ceiling

- **WHEN** a row's activity is `running`, its source is terminal output, and the activity has stood unchanged for longer than the confirmation ceiling
- **THEN** the row is presented as `running (unconfirmed)`, with a static shape
- **AND** the row's activity value and activity source are unchanged

#### Scenario: An inferred run just under the ceiling

- **WHEN** the same row's activity has stood unchanged for less than the confirmation ceiling
- **THEN** the row is presented as `running`, with the confirmed running treatment

#### Scenario: The source behind a stale claim has also failed

- **WHEN** a row past the confirmation ceiling is one whose deciding source the presence data reports as failed
- **THEN** the row is presented as `unknown`, not as `running (unconfirmed)`
- **AND** when that failure clears, the row is presented as `running (unconfirmed)` on that same update, its elapsed measurement never having paused

### Requirement: Only an output-inferred running claim is ever unconfirmed

An activity other than `running`, and an activity from any source other than terminal output, SHALL each be presented as confirmed at any age. A row with no start time for its current activity, or one in the future, SHALL also be confirmed: an absent or impossible clock SHALL NOT manufacture staleness.

#### Scenario: A reported row of any age

- **WHEN** a row's activity is `running` and its source is an agent's own report, at any age
- **THEN** the row is presented as `running`, with the confirmed running treatment

#### Scenario: An external row of any age

- **WHEN** a row's activity is `running` and its source is the session registry, at any age
- **THEN** the row is presented as `running`, with the confirmed running treatment

#### Scenario: A waiting or exited row of any age

- **WHEN** a row's activity is `waiting` or `exited`, at any age
- **THEN** the row is never presented as unconfirmed

#### Scenario: No start time, or one in the future

- **WHEN** a row's activity is `running` from terminal output and it carries no start time for that activity, or a start time later than now
- **THEN** the row is presented as `running`, with the confirmed running treatment

### Requirement: Confidence returns with evidence, and the clock restarts only on the claim

WHEN a row presented as unconfirmed is next reported by an agent, the view SHALL present it as confirmed on that same update, with no cooldown.

The elapsed measurement SHALL restart when a row's activity changes, and SHALL NOT restart when only its source changes — so a claim already past the ceiling is unconfirmed as soon as nothing is reporting it.

#### Scenario: A report arrives on an unconfirmed row

- **WHEN** a row presented as `running (unconfirmed)` is next reported by its agent
- **THEN** the row is presented as `running` on that same update

#### Scenario: A report ages out on a claim already past the ceiling

- **WHEN** a row whose activity has stood unchanged for longer than the ceiling was confirmed by an agent report, and that report is no longer fresh, so the source returns to terminal output
- **THEN** the row is presented as `running (unconfirmed)` on the next update, with no grace period

### Requirement: A claim that outlives its evidence stops animating without being told

WHEN no new data arrives but a row's claim crosses the confirmation ceiling, the view SHALL re-present that row, so a claim does not keep animating merely because nothing else changed.

That re-presentation SHALL be scheduled for the moment the earliest claim crosses rather than polled, re-scheduled both when new data arrives and after it runs, and cancelled when the view is discarded. One that changes nothing SHALL perform no DOM work.

#### Scenario: A row crosses the ceiling with no update

- **WHEN** a row presented as `running` crosses the confirmation ceiling and no new data has arrived
- **THEN** the row is re-presented as `running (unconfirmed)`

#### Scenario: A re-presentation that changes nothing

- **WHEN** the view re-presents its rows and no row has crossed the ceiling
- **THEN** no DOM work is performed

### Requirement: One reading of the clock serves the whole cycle

A single reading of the clock SHALL serve a re-presentation, what it renders, and the scheduling of the next one, so no row is drawn against one moment and scheduled against another.

#### Scenario: A row drawn and scheduled in one cycle

- **WHEN** the view re-presents its rows and schedules the next crossing
- **THEN** both used the same reading of the clock

#### Scenario: A second crossing follows the first

- **WHEN** two rows will cross the ceiling at different times and the earlier one has just been re-presented
- **THEN** the later crossing is still re-presented when it arrives

#### Scenario: The view is discarded while a crossing is pending

- **WHEN** the view is discarded before a scheduled crossing arrives
- **THEN** nothing is scheduled to run afterwards
