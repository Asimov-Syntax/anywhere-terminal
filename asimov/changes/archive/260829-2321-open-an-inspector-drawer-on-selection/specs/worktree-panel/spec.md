# Spec Delta: worktree-panel — open-an-inspector-drawer-on-selection

## ADDED Requirements

### Requirement: Selecting a worktree opens an inspector under the tree

WHERE the workbench setting is enabled, selecting a worktree SHALL open an inspector region
**below** the tree rather than in place of it. Selecting a different worktree SHALL replace that
region's contents rather than adding a second region.

#### Scenario: A second selection replaces the first

- **WHEN** the user selects one worktree and then another
- **THEN** exactly one inspector region is present, and it describes the second worktree

#### Scenario: The rollout setting is off

- **WHEN** the workbench setting is disabled and the user activates a worktree row
- **THEN** no inspector region is shown

#### Scenario: The rollout setting is turned off while the inspector is open

- **WHEN** the workbench setting changes to disabled with the inspector open
- **THEN** the inspector is no longer shown

### Requirement: The inspector is bounded so the tree stays scannable

The inspector region SHALL be bounded to at most half the panel body and SHALL scroll within that
bound. The tree above it SHALL remain scrollable at any inspector content height, rather than
growing to its own content height and being clipped by the panel.

#### Scenario: The tree survives the selection

- **WHEN** the inspector is open on a worktree whose contents exceed the bound
- **THEN** the tree is still rendered above it and is still scrollable

### Requirement: The inspector states the full path and rows still state none

The inspector SHALL display the selected worktree's filesystem path in full. Opening it SHALL NOT
cause any list row to display a path.

#### Scenario: The path moves nowhere else

- **WHEN** the inspector is open on a worktree
- **THEN** its full path is readable in the inspector, and no row in the list displays a path

### Requirement: The inspector names the model that no row names

For each agent it presents, the inspector SHALL display that agent's model identifier when one is
known, and SHALL display nothing in its place when none is. No list row SHALL display a model
identifier whether or not the inspector is open.

#### Scenario: An agent whose model is unknown

- **WHEN** the inspector presents an agent for which no model was reported
- **THEN** no model identifier and no placeholder for one is displayed for that agent

### Requirement: A push that changes nothing changes no pixel of the inspector

While the inspector is open, a push SHALL leave the inspector's rendered nodes in place, and SHALL
NOT move focus that is inside it, unless it changed the selected worktree itself or an agent the
inspector presents. A change to another worktree, to repository-level information, or to the
health of the listing as a whole SHALL NOT rebuild it.

#### Scenario: A poll arrives while the user is in the inspector

- **WHEN** focus is on a control inside the open inspector and a push arrives that changed neither the selected worktree nor its agents
- **THEN** that same node still exists and still holds focus

### Requirement: The inspector keeps its own claims current without a push

Where a claim the inspector presents changes with the passage of time rather than with a push, the
inspector SHALL update that claim at the moment it changes, and SHALL agree with the tree's
rendering of the same claim at every moment.

#### Scenario: A running claim outlives its evidence while the inspector is open

- **WHEN** an agent the inspector presents crosses the confirmation ceiling with no push arriving
- **THEN** the inspector presents the same qualified state the tree presents for that agent

### Requirement: The inspector offers only actions it can perform on this worktree

An action that cannot be performed on the selected worktree SHALL be absent from the inspector
rather than present and inert, under the same conditions that withhold it from the context menu.
An action whose target is the repository rather than the worktree SHALL NOT be offered here.

#### Scenario: A worktree whose directory is gone

- **WHEN** the inspector is open on a worktree marked missing
- **THEN** the actions that require the directory to exist are absent, and copying its path is still offered

#### Scenario: The main worktree

- **WHEN** the inspector is open on the main worktree
- **THEN** no removal action is offered

### Requirement: An inspector action performs what its menu equivalent performs

Every action the inspector offers SHALL be resolved by the host from the worktree's identifier
rather than from a path the view supplied, and SHALL perform the same operation as the equivalent
context-menu item.

#### Scenario: A removal raised from the inspector

- **WHEN** the user raises the removal action from the inspector
- **THEN** the same confirmation of what would be destroyed is required as when it is raised from the context menu

### Requirement: The inspector carries the delegation history of each agent it presents

For each agent it presents, the inspector SHALL show that agent's delegation history without
requiring a further disclosure, and SHALL distinguish a history not yet read, one that could not
be read, one read as empty, one read as incomplete, and an agent with no session to read a history
from — never presenting any of them as an agent that delegated nothing.

An agent presented outside this window SHALL NOT be offered focus in the inspector.

#### Scenario: The history has not arrived yet

- **WHEN** the inspector opens on a worktree whose agent's delegations have not been read
- **THEN** that agent's section says the history is being read, rather than that there is none

#### Scenario: An agent with no session to read

- **WHEN** the inspector presents an agent whose session was never resolved
- **THEN** that agent's section says the history cannot be read, rather than waiting on a read that was never asked for

### Requirement: A history is requested once per session, and again if that session returns

A delegation history SHALL be requested at most once for a given agent row and session across
every surface that presents it, and SHALL be requestable again after that row has left and
returned.

#### Scenario: The same agent is presented twice at once

- **WHEN** an agent is presented in both the tree and the inspector and its history has not been read
- **THEN** exactly one request for that history is made

### Requirement: Dismissing the inspector leaves the selection and the scope alone

The inspector SHALL offer an explicit control that closes it, and SHALL close on the Escape key
while focus is within the panel body it occupies and no overlay above it is open. Closing it SHALL
NOT change which worktree is selected and SHALL NOT change the surface's tab-bar scope.

Activating the already-selected worktree again SHALL reopen a closed inspector. Clearing the
selection SHALL close it.

#### Scenario: Closing keeps the scope

- **WHEN** the user closes the inspector while a scope is held
- **THEN** the scope is unchanged and the worktree stays selected

#### Scenario: Reopening after a dismissal

- **WHEN** the user closes the inspector and then activates the same worktree row again
- **THEN** the inspector is open again on that worktree

#### Scenario: An overlay is open above it

- **WHEN** the user presses Escape with a session preview open over the panel
- **THEN** the preview closes and the inspector stays open

### Requirement: The inspector does not take focus and gives it back

Opening the inspector SHALL leave focus where it was, and every control and row it presents SHALL
be reachable by keyboard. Where focus is inside the inspector when it closes, focus SHALL return
to the row that opened it, or to the tree itself where that row is no longer rendered.

#### Scenario: Opening does not move focus

- **WHEN** the user selects a worktree row by keyboard
- **THEN** focus is still on that row after the inspector opens

#### Scenario: Closing from inside returns focus

- **WHEN** the user activates the inspector's close control
- **THEN** focus is on the worktree row the inspector was describing
