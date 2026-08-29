## MODIFIED Requirements

### Requirement: Each cause of emptiness reads differently

The view SHALL distinguish, in its rendered copy, a workspace with no folder, a workspace whose
folders hold no repository, an unavailable git, a repository whose only worktree is its main
checkout, and a filter that matched nothing. None of these SHALL be presented with error styling,
and a first load with no tree yet SHALL render placeholder rows rather than a spinner in an empty
panel. The unavailable-git copy SHALL be shown only when no listing is retained.

The unbranched-repository copy SHALL be shown only where the repository holds exactly one
worktree and it is the main checkout. A degraded listing, or rows withheld by a filter, a cap, or
a disclosure, SHALL NOT be described as unbranched.

#### Scenario: A repository that has not been branched out yet

- **WHEN** the only repository in the tree holds nothing but its main checkout
- **THEN** the view says what a worktree buys rather than repeating the no-repository copy

#### Scenario: A repository that could not be listed is not called unbranched

- **WHEN** a repository's listing failed, so it carries no worktrees and a degraded reason
- **THEN** the view states the degraded listing and does not describe the repository as unbranched

#### Scenario: Rows withheld by the view are not evidence about the repository

- **WHEN** a filter, a display cap, or a fold leaves a repository showing only its main checkout
- **THEN** the view does not describe that repository as unbranched

### Requirement: Keyboard traversal follows the declared hierarchy

The tree SHALL expose a single tab stop, with arrows moving within it. Up and Down SHALL move
through visible rows and Home and End SHALL reach the first and last. Right SHALL open a closed
node, then move to its first child, and SHALL do nothing on a row with no children. Left SHALL
close an open node, then move to its parent rather than to the previous visible row. Focus SHALL
remain on the row the user acted on across the re-render that disclosure causes.

WHERE a row carries its own action control, that control SHALL join the tab order only while its
row holds focus. Arrow traversal SHALL keep moving between rows while such a control holds focus.

#### Scenario: A row's action is reachable by tabbing from that row

- **WHEN** a row carrying an action control holds focus and the user tabs
- **THEN** focus moves to that row's action control, and tabbing again leaves the tree

#### Scenario: Another row's action is not a tab stop

- **WHEN** a row carrying an action control does not hold focus
- **THEN** its action control is not in the tab order

#### Scenario: Arrows still move between rows from an action control

- **WHEN** an action control holds focus and the user presses Up or Down
- **THEN** focus moves to the row before or after the control's own row

### Requirement: A control is offered only in the body it acts on

A toolbar control SHALL be presented only while the body it acts on is showing, and SHALL occupy no space in the toolbar otherwise. The session-scope filter SHALL NOT be presented while the Worktree body is showing, because the worktree tree is already scoped to the workspace and the filter has nothing to scope there. The create-worktree control SHALL NOT be presented while a sessions body is showing, and SHALL NOT be presented while the Worktree body holds no repository to create in.

#### Scenario: Switching between the sessions body and the Worktree body

- **WHEN** the user switches the panel from a sessions body to the Worktree body
- **THEN** the session-scope filter is no longer presented and the create-worktree control is presented

#### Scenario: Nothing to create in

- **WHEN** the Worktree body is showing and the tree holds no repository
- **THEN** the create-worktree control is absent rather than present and inert

## ADDED Requirements

### Requirement: The unbranched-repository state offers the create it describes

The state describing a repository that holds only its main checkout SHALL offer, in its body, a
create control that opens the create form on that repository. It SHALL be presented alongside that
repository's main worktree row, which keeps the actions it already offers.

#### Scenario: The state offers the create it is describing

- **WHEN** the view renders the state for a repository holding only its main checkout
- **THEN** a create control is present in the body of that state and opens the create form on that repository
- **AND** that repository's main worktree row is still rendered and still offers its own actions

### Requirement: A state describing nothing to create in offers no create

The states describing a missing folder, a missing repository, an unavailable git, and a filter
that matched nothing SHALL offer no create control.

#### Scenario: A state the panel cannot resolve offers nothing

- **WHEN** the view renders the no-folder, no-repository, unavailable-git, or no-match state
- **THEN** no create control is offered

### Requirement: A repo group header offers create for its own repository

WHERE repo group headers are rendered, each SHALL offer a create control that opens the create
form already scoped to that repository. The control SHALL be reachable by keyboard, not by pointer
hover alone. Activating it SHALL start exactly one create and SHALL NOT also collapse or expand the
header it sits on. It SHALL NOT be rendered where group headers are not.

#### Scenario: Create from the group header opens on that repository

- **WHEN** the user activates the create control on a repo group header
- **THEN** the create form opens with that repository as its selected repository

#### Scenario: Activating the action does not act on the row

- **WHEN** the user activates a header's create control by pointer or by keyboard
- **THEN** exactly one create is started and the header's own expansion is unchanged

#### Scenario: No group headers, no header control

- **WHEN** the tree holds one repository, so no group header is rendered
- **THEN** no header create control exists in the view

### Requirement: Every create entry point opens the same offer

Every offered path to creating a worktree SHALL open the same form and submit the same request
shape, differing only in which repository the form opens on. A path that names no repository SHALL
open a form offering every repository the tree holds, and SHALL NOT narrow the offer to one.

#### Scenario: The header, the empty state, the toolbar, and the menu agree

- **WHEN** a create is started from a group header, the unbranched-repository control, the toolbar control, or a row context menu
- **THEN** each opens the same form and submits the same request shape, differing only in the repository it opens on

#### Scenario: An unscoped create offers every repository

- **WHEN** a create is started from the toolbar, which names no repository
- **THEN** the form offers every repository in the tree
