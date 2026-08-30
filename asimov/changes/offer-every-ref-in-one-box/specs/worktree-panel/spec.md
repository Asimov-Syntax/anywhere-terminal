# worktree-panel Specification Delta

## ADDED Requirements

### Requirement: The create dialog offers branches and a create-new entry in one list

The create dialog SHALL present the repository's existing local branches and an always-available
"create new branch" entry in a single list attached to the lead input, with no tab bar and no
separate control for choosing between an existing branch and a new one.

### Requirement: The branch list is ordered by what the typed text most likely means

The list SHALL place a branch whose name exactly equals the typed text first, then branches whose
names begin with that text, then the create-new entry. With no text typed, every offered branch
SHALL be listed and the create-new entry SHALL remain present.

### Requirement: A branch can be created when the list is unavailable or incomplete

The create-new entry SHALL remain selectable when the branch list is unavailable, empty, or
incomplete, so a repository whose branches could not be enumerated can still be used to create a
worktree.

#### Scenario: A name that is not in the list is still creatable

- **WHEN** the user types a branch name that matches no offered branch
- **THEN** the create-new entry is the selectable result, and submission is permitted once the name
  validates

### Requirement: A branch another worktree holds is offered but not selectable

WHERE a local branch is checked out in another worktree of the same repository, the create dialog
SHALL offer that branch as a visible, non-selectable entry, and SHALL refuse to submit a create
naming that branch.

#### Scenario: The held branch cannot be submitted by any route

- **WHEN** a create is submitted naming a branch that another worktree holds
- **THEN** no worktree-create request is issued

### Requirement: A held branch names the directory holding it

A non-selectable branch entry SHALL be annotated with the name of the directory that holds it, and
that annotation SHALL name the directory only, never a full filesystem path.

### Requirement: An entry that cannot be selected stays reachable

An entry that cannot be selected SHALL remain reachable by keyboard and announced by assistive
technology rather than hidden, so the reason the branch is unavailable is available to the user.

### Requirement: An incomplete branch list is stated as incomplete

WHERE the offered branches are limited because the repository holds more than the dialog
enumerates, the create dialog SHALL state that the list is partial rather than presenting it as the
repository's complete set.

## MODIFIED Requirements

### Requirement: Create dialog keyboard and dismissal behaviour

The create dialog SHALL keep the branch entry as its lead input with no control above it, SHALL
block submission until the value the chosen mode requires validates, and SHALL retain its existing
focus order, focus trap, and dismissal behaviour. Keyboard traversal SHALL reach every entry in the
branch list, including entries that cannot be selected.

### Requirement: Escape closes the branch list before it dismisses the dialog

WHILE the branch list is open, the Escape key SHALL close the list and SHALL NOT dismiss the
dialog. WHILE the branch list is closed, the Escape key SHALL dismiss the dialog.

#### Scenario: Escape closes the list before it closes the dialog

- **WHEN** the branch list is open and the user presses Escape
- **THEN** the list closes and the dialog remains open
- **WHEN** the user presses Escape again
- **THEN** the dialog is dismissed
