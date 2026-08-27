# worktree-agent-presence Specification
## Requirements

### Requirement: Attribute a pane to exactly one worktree

A terminal pane SHALL be attributed to the worktree whose path contains that pane's working
directory and is the longest such path. A pane whose working directory is unknown, or that no
worktree contains, SHALL produce no row. A pane SHALL NOT appear under more than one worktree.

#### Scenario: A sibling worktree sharing a name prefix

- **WHEN** worktrees `/repo/feature-x` and `/repo/feature-x-old` both exist and a pane's working directory is `/repo/feature-x-old`
- **THEN** the pane appears under `/repo/feature-x-old` only

#### Scenario: A worktree nested inside another worktree

- **WHEN** a pane's working directory lies inside a worktree that is itself inside another worktree
- **THEN** the pane appears under the inner worktree only

#### Scenario: A pane moves between worktrees

- **WHEN** a pane's working directory changes from one worktree to another
- **THEN** the next projection shows one row, under the new worktree

### Requirement: Claim agent identity only from evidence that proves it

Every agent row SHALL carry the source that proved its identity, resolved in the precedence launch
record, then live session registry, then process recognition, then a committed title. A row SHALL
report `none` and claim no agent when no source proved one.

#### Scenario: A pane no surface has reported

- **WHEN** no surface has reported a pane's title
- **THEN** identity resolves by a source ranked above the title, and reaching none of them reports `none` rather than treating the missing title as proof of absence

### Requirement: A title proves identity only as a whole token from a curated set

A name test against a title SHALL match on token boundaries only, never as a substring, and the set
of names admitted SHALL be narrower than the set the product can launch. A title made only of
decorative animation frames SHALL NOT establish an identity.

#### Scenario: A title that merely contains an agent name

- **WHEN** a pane's reported title is `openclaude`
- **THEN** no agent is claimed and the row's identity source is not the title

#### Scenario: A title made only of animation frames

- **WHEN** a pane's reported title carries decoration and nothing else
- **THEN** no agent is claimed for that pane

### Requirement: An inconclusive identity read retains the last proven identity

WHEN resolving a pane's identity fails, times out, or is otherwise inconclusive, that pane's row
SHALL keep the identity and identity source it last proved, and SHALL NOT be downgraded to a weaker
source or to `none`. A read that succeeds and conclusively finds no agent SHALL clear the identity.

#### Scenario: A process-table read fails for a proven agent pane

- **WHEN** a pane's agent was proved from the session registry and the next rebuild's process-table read fails
- **THEN** the row still names that agent, with the same identity source

#### Scenario: An agent genuinely exits

- **WHEN** the read succeeds and the pane has no agent session
- **THEN** the row no longer claims an agent

### Requirement: Qualify identity and activity independently

Every agent row SHALL carry its identity source and its activity source as separate values, and
neither SHALL be derived from the other. A row MAY be authoritative for one and fallback for the
other in either combination.

#### Scenario: An authoritatively identified pane with only output evidence

- **WHEN** a pane's agent was proved by its launch record and its activity is known only from output
- **THEN** the row reports an authoritative identity source and a fallback activity source

### Requirement: Reflect a pane's lifecycle without leaving a row behind

A pane that has closed SHALL have no row in the next projection. A pane whose process exited while
the pane is still open SHALL keep a row reporting `exited`, whether or not the pane's session is
still registered anywhere else.

#### Scenario: A process exits and the pane is then closed

- **WHEN** a pane's process exits while its tab remains open, and the tab is closed afterwards
- **THEN** the row reads `exited` first, and is absent after the close

### Requirement: A pane's activity expires without further evidence

WHEN a pane's activity would change solely through the passage of time, presence SHALL be
republished so the row reflects it. A row SHALL NOT continue to report `running` after the evidence
that justified it has aged out.

#### Scenario: Output stops and nothing else happens

- **WHEN** a pane produces output, then produces nothing further and no other evidence arrives
- **THEN** the row reports `idle` once the output evidence has aged out, without any further input

### Requirement: A failed presence source degrades its scope rather than clearing it

WHEN a presence source fails, the projection SHALL retain the rows it last produced, SHALL name the
failing source with a reason and the epoch of its first consecutive failure, and SHALL NOT rewrite
any row to a less active state on the strength of that failure. WHEN that source succeeds again the
projection SHALL drop its entry. A source that succeeded and found nothing SHALL NOT be named.

#### Scenario: A source fails twice in a row

- **WHEN** a presence source fails, then fails again
- **THEN** the reported first-failure epoch is that of the first failure, not the latest

### Requirement: Presence is published with the tree it describes

Every push carrying presence SHALL carry the tree of the same projection, and every worktree
identifier presence names SHALL exist in that tree.

### Requirement: Worktrees rank by their newest agent activity

A repository group's activity ranking SHALL use, per worktree, the newest activity timestamp across
that worktree's agent rows, and SHALL treat a worktree with no rows as having no ranking. Before any
presence has been projected, every worktree SHALL rank as having none.

### Requirement: An agent row's age describes its agent, not its pane

A row's start, state-start, and finish timestamps SHALL describe the agent currently identified in
that pane. WHEN the identified agent or session changes, those timestamps SHALL be restarted; WHEN
only the identity source changes for the same agent, they SHALL be preserved.

#### Scenario: A second agent runs in a pane that already hosted one

- **WHEN** an agent finishes in a pane and a different agent session is later identified in it
- **THEN** the row's start timestamp is that of the second agent, and it reports no finish time from the first

### Requirement: A presence rebuild reads each shared source once

A single presence rebuild SHALL issue at most one process-table read and at most one running-session
registry read, regardless of how many panes it projects and regardless of how long the rebuild takes.
A rebuild SHALL reuse a pane's previously proven agent session while that pane's identifier, process
identifier, and working directory are all unchanged.

#### Scenario: A rebuild outlives its own caching window

- **WHEN** a rebuild resolves several panes and more time passes between two of them than any internal caching window
- **THEN** the rebuild has still issued one process-table read and one registry read

#### Scenario: An agent starts in a pane already resolved as having none

- **WHEN** a pane resolved to no agent session, and an agent is then started in it without its identifier, process identifier, or working directory changing
- **THEN** a later rebuild identifies that agent

### Requirement: Surface agents running outside this window

Presence SHALL include, under each worktree, one row per live agent session whose recorded
working directory that worktree contains, marked as belonging outside this window. Such a row
SHALL name the registry as the source of both its identity and its activity, SHALL report the
agent as running while its process is live, and SHALL carry that process identifier.

### Requirement: A registry session this window already accounts for produces no row

A live agent session SHALL produce no outside-this-window row when a row of this window's own
panes already represents it, when it is a one-shot non-interactive run, or when no worktree
contains its recorded working directory.

#### Scenario: The same session is both a window pane and a registry entry

- **WHEN** a session already identified in one of this window's panes also appears in the running-session registry
- **THEN** exactly one row exists for it, and that row is the window pane's

#### Scenario: A one-shot run is registered under a worktree

- **WHEN** the registry holds a live headless one-shot session whose working directory is inside a worktree
- **THEN** no row is produced for it

### Requirement: Scan for outside-this-window agents only while the view is shown

The running-session registry SHALL be polled for these rows at a fixed 5-second cadence for
as long as at least one surface reports that it is showing the worktree view, and SHALL NOT be
polled at all while no surface reports that.

#### Scenario: Every surface stops showing the view

- **WHEN** the last surface showing the worktree view stops showing it
- **THEN** no further polled scan is issued until some surface shows it again

### Requirement: An unreadable registry is not an empty one

WHEN the running-session registry cannot be read, presence SHALL retain the outside-this-window
rows it last produced and SHALL name the registry as a degraded source. WHEN the registry is
read successfully and holds no qualifying session, those rows SHALL be removed and the registry
SHALL NOT be named as degraded.

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

