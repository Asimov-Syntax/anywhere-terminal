# Spec Delta: worktree-panel

## ADDED Requirements

### Requirement: A surface subscribes to presence for what it draws, not for the rail

A surface SHALL keep receiving presence for as long as anything it shows is drawn from presence,
and SHALL stop when nothing is. Whether the rail itself is shown SHALL NOT be able to end that
subscription on its own.

Where a surface is subscribed but is drawing no agent rows, the window SHALL NOT do per-row work
that only rows consume. Presence a subscriber can see SHALL be identical either way.

#### Scenario: A scope outlives the rail

- **WHEN** the rail is collapsed while a scope is set, and a pane that only presence knows to be
  waiting becomes hidden by that scope
- **THEN** the count on the escape control rises, exactly as it would with the rail open

#### Scenario: Nothing is left to draw for

- **WHEN** the last scope on a collapsed rail is cleared
- **THEN** the surface stops asking for presence

#### Scenario: The rail comes back

- **WHEN** the rail is reopened while its scope is still set
- **THEN** the rows are drawn with their titles and previews, without the user asking again
