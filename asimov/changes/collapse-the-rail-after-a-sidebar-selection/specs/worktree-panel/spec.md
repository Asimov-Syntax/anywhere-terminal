# Spec Delta: worktree-panel — collapse-the-rail-after-a-sidebar-selection

## ADDED Requirements

### Requirement: A selection in the narrow layout hands the room back

WHERE the workbench setting is enabled and the panel is rendered in the stacked layout — the one
used where two columns do not fit — selecting a worktree SHALL collapse the rail to its header
strip, so the selection reads as "choose, then view".

The collapse SHALL be a consequence of the selection and of nothing else: no timer, no push, no
re-render, and no change of scope from any other source SHALL cause it.

#### Scenario: Choosing a worktree in the stacked layout

- **WHEN** the user selects a worktree while the panel is in the stacked layout
- **THEN** the rail collapses to its header strip and the selection takes effect

#### Scenario: Reopening after an automatic collapse

- **WHEN** the user reopens the rail the selection collapsed
- **THEN** it stays open through pushes, re-renders and scope changes, until the user selects
  another worktree

#### Scenario: The two-column layout keeps the rail

- **WHEN** the user selects a worktree while the rail and the terminal are shown side by side
- **THEN** the rail stays open — it is not taking the room the terminal needs

#### Scenario: The workbench setting is off

- **WHEN** the workbench setting is disabled and the user activates a worktree row
- **THEN** the rail's open state is whatever the user left it as, and nothing collapses it

### Requirement: A collapse the user did not ask for is not their choice

A rail collapsed on the user's behalf SHALL be reversible by the same control that collapses it,
and reopening it SHALL leave it open until the user selects again. Such a collapse SHALL NOT be
recorded as the user's own preference, so the panel they open next is the one they last chose.

#### Scenario: The next session opens on what the user chose

- **WHEN** the user leaves the rail open, selects a worktree so it collapses, and returns later
- **THEN** the panel opens with the rail open

### Requirement: A surface holding a scope keeps receiving presence

A surface that holds a scope SHALL continue to receive the presence evidence its scope affordances
are drawn from, whether or not the rail is showing. Collapsing the rail SHALL NOT be able to
suppress a count, a chip, or an escape control that a scope has put on screen.

#### Scenario: The rail is collapsed while a scope is set

- **WHEN** the rail is collapsed while a scope is set, and a pane that only presence knows to be
  waiting becomes hidden by that scope
- **THEN** the count on the escape control rises, exactly as it would with the rail open

#### Scenario: Clearing the scope while the rail is collapsed

- **WHEN** the last scope on a collapsed rail is cleared
- **THEN** the surface stops asking for presence it no longer draws anything from

### Requirement: Scope does not depend on the layout

The tab-bar scope a selection drives SHALL be identical in every layout: the same panes are
hidden, the same escape control is offered, and the same count is carried on it, whether the rail
is shown beside the terminal, stacked above it, or collapsed to its header strip.

#### Scenario: The rail is collapsed while a scope is set

- **WHEN** the rail is collapsed and a scope is set
- **THEN** the scope is still named on screen and the control that clears it is still reachable
