# Spec Delta: worktree-panel — default-the-workbench-on

## ADDED Requirements

### Requirement: A setting the panel no longer reads decides nothing

The panel SHALL present the workbench composition regardless of any
`anywhereTerminal.worktree.workbench` value a user's configuration still holds, and SHALL NOT read
that value.

#### Scenario: A configuration that still turns the rollout off

- **WHEN** the user's settings hold `anywhereTerminal.worktree.workbench` set to `false` and the
  panel opens
- **THEN** the panel presents the workbench composition, and a worktree can be selected

#### Scenario: A configuration that never mentioned it

- **WHEN** the user has never configured the setting and the panel opens
- **THEN** the panel presents the workbench composition

## MODIFIED Requirements

### Requirement: A worktree can be selected, and selection is an explicit act

The panel SHALL let the user select one worktree, and SHALL treat selection as a deliberate act:
no worktree SHALL be selected on the user's behalf at first render, on a reload, or on any push
that changes the tree. At most one worktree SHALL be selected at a time, and selecting another
SHALL replace the first rather than adding to it.

Selection SHALL be reachable by keyboard as well as by pointer.

#### Scenario: Nothing is selected until the user selects it

- **WHEN** the panel renders a tree for the first time, or re-renders after a push
- **THEN** no worktree is marked as selected

#### Scenario: Selecting replaces rather than accumulates

- **WHEN** the user selects one worktree and then another
- **THEN** only the second is marked as selected

### Requirement: The control that swaps the body is separate from the one that groups a body

The panel SHALL present one control whose values are the two bodies it can show, and SHALL present
the control that chooses a grouping only while the sessions body is showing. Both values of the
body control SHALL be named on screen at every panel width, so it answers "which body am I in"
without a hover, a focus, or a widening.

#### Scenario: The grouping control is not offered where it would group nothing

- **WHEN** the Worktree body is showing
- **THEN** the grouping control is absent from the toolbar rather than present and inert, and the
  body control still names both of its values

#### Scenario: Returning to the sessions body

- **WHEN** the user switches from the Worktree body back to the sessions body
- **THEN** the grouping control is presented again, showing the grouping that was in effect before
  the user left — the choice is not reset by having been away

#### Scenario: No second presentation of the same controls remains

- **WHEN** the panel builds its toolbar
- **THEN** a single flat control naming all four values is not built under any configuration

### Requirement: A selection in the narrow layout hands the room back

WHERE the panel is rendered in the stacked layout — the one used where two columns do not fit —
selecting a worktree SHALL collapse the rail to its header strip, so the selection reads as
"choose, then view".

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

### Requirement: Selecting a worktree opens an inspector under the tree

Selecting a worktree SHALL open an inspector region **below** the tree rather than in place of it.
Selecting a different worktree SHALL replace that region's contents rather than adding a second
region.

#### Scenario: A second selection replaces the first

- **WHEN** the user selects one worktree and then another
- **THEN** exactly one inspector region is present, and it describes the second worktree

### Requirement: A control that chooses among values says so and is reachable by keyboard

Neither the body control nor the grouping control SHALL be presented as a plain button that merely
looks selected. Each SHALL declare, to assistive technology, that it is one choice among a set and
which of its values is currently chosen, and each SHALL be operable from the keyboard alone.

#### Scenario: Moving through a control's values without a pointer

- **WHEN** a control has keyboard focus and the user presses the arrow keys
- **THEN** focus moves between that control's own values and the value it lands on becomes the
  chosen one
