# Spec Delta: worktree-panel — split-the-view-toggle-from-grouping

## ADDED Requirements

### Requirement: The control that swaps the body is separate from the one that groups a body

WHERE the workbench setting is enabled, the panel SHALL present one control whose values are the
two bodies it can show, and SHALL present the control that chooses a grouping only while the
sessions body is showing. Both values of the body control SHALL be named on screen at every panel
width, so it answers "which body am I in" without a hover, a focus, or a widening.

#### Scenario: The grouping control is not offered where it would group nothing

- **WHEN** the Worktree body is showing
- **THEN** the grouping control is absent from the toolbar rather than present and inert, and the
  body control still names both of its values

#### Scenario: Returning to the sessions body

- **WHEN** the user switches from the Worktree body back to the sessions body
- **THEN** the grouping control is presented again, showing the grouping that was in effect before
  the user left — the choice is not reset by having been away

#### Scenario: The workbench setting is off

- **WHEN** the workbench setting is disabled
- **THEN** the panel presents the control it shipped with, unchanged, and none of the two-level
  presentation appears

### Requirement: A control that chooses among values says so and is reachable by keyboard

WHERE the workbench setting is enabled, neither the body control nor the grouping control SHALL be
presented as a plain button that merely looks selected. Each SHALL declare, to assistive
technology, that it is one choice among a set and which of its values is currently chosen, and each
SHALL be operable from the keyboard alone.

#### Scenario: Moving through a control's values without a pointer

- **WHEN** a control has keyboard focus and the user presses the arrow keys
- **THEN** focus moves between that control's own values and the value it lands on becomes the
  chosen one

### Requirement: A view recorded by an older build keeps its meaning

A body choice or a grouping choice recorded before the two controls were separated SHALL be
honoured with the meaning it was recorded with, and SHALL NOT require the user to choose again.

#### Scenario: State written before the split

- **WHEN** the panel opens on state that recorded a body of `worktree` and a grouping of `folder`
- **THEN** the Worktree body is showing, and switching to the sessions body shows it grouped by
  folder

## MODIFIED Requirements

### Requirement: A control is offered only in the body it acts on

A toolbar control SHALL be presented only while the body it acts on is showing, and SHALL occupy no space in the toolbar otherwise. The session-scope filter SHALL NOT be presented while the Worktree body is showing, because the worktree tree is already scoped to the workspace and the filter has nothing to scope there. The create-worktree control SHALL NOT be presented while a sessions body is showing, and SHALL NOT be presented while the Worktree body holds no repository to create in. The control that chooses a grouping SHALL NOT be presented while the Worktree body is showing, because it groups sessions and the Worktree body holds none.

The control that chooses which body is showing is not a control of either body, and SHALL be
presented in both.

#### Scenario: Switching between the sessions body and the Worktree body

- **WHEN** the user switches the panel from a sessions body to the Worktree body
- **THEN** the session-scope filter is no longer presented and the create-worktree control is presented

#### Scenario: Nothing to create in

- **WHEN** the Worktree body is showing and the tree holds no repository
- **THEN** the create-worktree control is absent rather than present and inert
