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

Every agent row SHALL carry the source that proved its identity, resolved in the precedence a report
from the agent itself, then launch record, then live session registry, then process recognition, then
a committed title. A row SHALL report `none` and claim no agent when no source proved one.

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

### Requirement: Name a resolved row from its session

A row with a resolved session SHALL prefer the vault title describing what the session is about over
a registry-derived name or terminal title. A proven agent with no PID registry MAY take the newest
session recorded for that agent under the pane's directory. Title reads SHALL be bounded and SHALL
refresh so a generated title or rename becomes visible; a failed refresh SHALL retain the previous
successful title.

#### Scenario: A registry name is a directory-derived slug

- **WHEN** the vault titles a resolved session and the registry also publishes a derived name
- **THEN** the row carries the vault title

#### Scenario: An agent has no PID registry

- **WHEN** a pane is independently proved to run an agent and the vault records that agent's newest session under its directory
- **THEN** the row carries that session and its title

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

WHERE an agent reports which session it is, presence SHALL treat the identifier as a lookup key and
SHALL NOT create a vault entry. For a dialect that also reports a transcript path, the session SHALL
identify the pane only after an existing entry resolves, and the reported path SHALL be used only
when it matches the path already recorded for that session; it SHALL NOT be opened on the report's
authority. An ID-only terminal-bound report MAY prove the pane before the vault can title the handle.

#### Scenario: A reported session nothing knows about

- **WHEN** a pane reports a session id that matches no stored entry
- **THEN** no entry is created and the pane's identity falls back to the other evidence

#### Scenario: A reported transcript path that disagrees with the stored one

- **WHEN** a pane reports a transcript path different from the one stored for that session
- **THEN** the reported path is discarded and nothing at it is read

### Requirement: One session belongs to one pane

When more than one pane resolves to the same session, the session SHALL be claimed by the pane whose
evidence ranks strictly highest, and by no pane at all when the strongest evidence is shared. The
rank SHALL be report, then process subtree, then directory match, then newest recorded session.

A pane that loses a contested session SHALL fall back to its own reported title, and SHALL claim no
agent when that session was the only source that proved one.

#### Scenario: Two panes in one directory, one of them running the agent

- **WHEN** a pane running an agent and a pane running a shell resolve to the same session by sharing a directory
- **THEN** only the pane whose evidence proves the agent is in it carries that session

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

### Requirement: An agent row's preview line says what its session last did

An agent row whose session the reader covers SHALL carry a preview line holding that session's last
activity. A row the reader does not cover — no resolved session, a source it has no transcript path
for, or a transcript it cannot read — SHALL carry no preview line at all, and SHALL NOT carry a
placeholder in its place.

#### Scenario: A working session says what it is working on

- **WHEN** a row's session has recorded activity and its transcript is readable
- **THEN** the row carries a preview line holding that session's last activity

#### Scenario: A row the reader does not cover

- **WHEN** a row has no resolved session, or its session's content is not in a transcript the reader
  has a path to, or that transcript cannot be read
- **THEN** the row carries no preview line, no placeholder stands in for one, and the scan reports no
  degraded source on that account

### Requirement: A missing preview is a normal row, not a degraded scan

Carrying no preview SHALL NOT mark a presence scan or any of its sources as degraded. A preview is
optional row enrichment, never an authoritative presence source: no row's identity, activity,
ranking, or freshness SHALL be derived from it.

#### Scenario: A scan over rows the reader does not cover

- **WHEN** every row in a scan comes from a source the preview reader has no transcript path for
- **THEN** the scan reports no degraded source, and each row renders normally without a second line

### Requirement: A preview is bounded and single-line before it travels

A preview SHALL be reduced to a single line of at most 120 characters at the point it is read, before
it is placed on a row. No unbounded or multi-line preview text SHALL cross the host/webview boundary
or enter any comparison the view uses to decide whether to redraw.

#### Scenario: A long multi-line last activity

- **WHEN** a session's last activity spans several lines and many hundreds of characters
- **THEN** the row carries one line of at most 120 characters, and the untruncated text is never sent

### Requirement: A scan that finds no new activity reads no transcript

A presence scan SHALL read a session's transcript only when that transcript's own freshness stamp has
moved since the preview it already holds was read. A scan over sessions whose stamps have not moved
SHALL perform no transcript read at all, however often it runs, and the number of filesystem calls
the previews cost SHALL NOT grow with the rate at which presence rebuilds.

#### Scenario: Repeated scans over quiet sessions

- **WHEN** presence scans repeatedly while no session's transcript has changed
- **THEN** no transcript is read after the first, and every row keeps the preview it already carried

#### Scenario: A session that has moved on

- **WHEN** a session's transcript stamp has moved since its preview was read
- **THEN** that session's transcript is read again and its row's preview is replaced

#### Scenario: Presence rebuilding faster than previews change

- **WHEN** presence rebuilds repeatedly within a short interval
- **THEN** a session is re-examined at most once per interval, so the filesystem cost of the previews
  is set by that interval and not by the rebuild rate

### Requirement: A preview is message text, not a pane title

A preview SHALL NOT be treated as a pane title for the purposes of stripping decorative animation
frames. Text that a title's stripper would treat as a leading spinner frame — a lone `-`, `*`, `/`,
`\` or `|` followed by whitespace — SHALL survive intact in a preview, because in message text it is
ordinary content.

#### Scenario: A preview that opens with a bullet

- **WHEN** a session's last activity begins with `- ` or `* ` followed by ordinary prose
- **THEN** the preview shows that text with its leading marker intact, and a preview consisting only
  of such a marker still renders as itself rather than as an empty line

### Requirement: A window that begins drawing rows gets enriched rows without waiting for a scan

WHEN a window gains its first surface that is drawing agent rows, and the presence envelope it
currently holds was built without row enrichment, presence SHALL be rebuilt and published with
enrichment applied on the terms the existing naming and preview requirements already set, rather
than the window waiting for the next polled scan. This SHALL hold however the surface reaches that
state, and whether or not a presence rebuild is already in flight when it does.

#### Scenario: A retained rail is displayed again

- **WHEN** a surface that was already visible and drawing rows becomes displayed, against an
  envelope built without enrichment
- **THEN** its eligible rows are enriched without waiting for the next scan

#### Scenario: The promotion lands during a rebuild

- **WHEN** a window gains its first row-drawing surface while a presence rebuild that is not
  enriching is already in flight
- **THEN** the window does not end up holding that unenriched result

