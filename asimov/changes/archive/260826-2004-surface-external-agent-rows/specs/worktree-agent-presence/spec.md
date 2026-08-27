# worktree-agent-presence Specification

## ADDED Requirements

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
