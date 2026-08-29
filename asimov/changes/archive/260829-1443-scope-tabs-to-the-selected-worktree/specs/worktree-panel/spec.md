## ADDED Requirements

### Requirement: A worktree can be selected, and selection is an explicit act

WHERE the workbench setting is enabled, the panel SHALL let the user select one worktree, and
SHALL treat selection as a deliberate act:
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

#### Scenario: The workbench setting is off

- **WHEN** the workbench setting is disabled and the user activates a worktree row
- **THEN** no worktree becomes selected, and the panel marks what it marked before selection existed

### Requirement: The selected worktree is the only one marked as selected

The treatment that marks the selected worktree SHALL be carried by that worktree and by no other,
and SHALL NOT be carried by a worktree that is merely expanded, merely open as a workspace folder,
or merely holding the strongest activity in the tree. Where no worktree is selected, no worktree
SHALL carry it.

#### Scenario: Expansion is not selection

- **WHEN** several worktrees are expanded and one of them — or none of them — is selected
- **THEN** the selection treatment is carried by the selected worktree alone, and by nothing at all when none is selected

#### Scenario: Selection does not displace the open-folder mark

- **WHEN** the selected worktree is not one the workspace holds open as a folder
- **THEN** the open-folder mark stays on the worktrees that earn it, and the selection treatment stays on the selected one
