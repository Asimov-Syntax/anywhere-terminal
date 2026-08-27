# Spec Delta: worktree-panel

## ADDED Requirements

### Requirement: The panel's read-only actions perform what they offer

Activating a row, or choosing a read-only item from its context menu, SHALL perform that action:
focusing a window-scope agent's pane, opening an agent row's session preview, opening a worktree
as a folder in a new window or as an added workspace folder, revealing a worktree in the OS file
manager, copying a worktree's path, opening a terminal whose working directory is the worktree,
revealing or copying an agent's working directory, or copying an agent row's resume command.

#### Scenario: An offered action works from every surface that shows the panel

- **WHEN** any of these actions is raised from the sidebar, the panel, or an editor surface
- **THEN** the action happens

### Requirement: An action acts on the target the user saw, or on nothing

An action SHALL act on the target the row identified when it was displayed. WHEN that target no
longer exists, or no longer belongs to the row the action came from, the action SHALL do nothing
and SHALL NOT act on any other target in its place.

#### Scenario: A target that went stale performs nothing

- **WHEN** an action names a worktree that has since been removed, or an agent row whose session has since changed
- **THEN** nothing is opened, revealed, copied, or focused, and no other worktree or row is acted on

### Requirement: Row activation is configurable, and external rows are never focused

Activating a window-scope agent row SHALL do what the user's row-activation setting says —
focus that row's pane, or open its session preview — and SHALL default to focusing the pane.
A change to that setting SHALL take effect in views that are already open.

Activating an agent row whose scope is external SHALL open its session preview whatever the
setting says, because no pane of that row exists in this window to focus.

#### Scenario: The setting cannot make an external row focusable

- **WHEN** the row-activation setting is `focus` and an external agent row is activated
- **THEN** its session preview opens and no focus is attempted

#### Scenario: The setting changes while a view is open

- **WHEN** the row-activation setting changes and a panel showing agent rows is already open
- **THEN** the next activation follows the new setting without the view being reopened

### Requirement: A focused pane is revealed where it actually lives

WHEN a pane is focused from the panel, the surface that HOLDS that pane SHALL be revealed and
the pane SHALL become the active one within it. The surface that raised the action SHALL NOT be
revealed in its place when it is not the one holding the pane.

#### Scenario: The pane lives in a surface other than the one asking

- **WHEN** the panel is open in two surfaces and a row is focused whose pane belongs to the other one
- **THEN** the surface holding the pane is revealed and that pane becomes active
