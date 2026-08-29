# worktree-panel Specification Delta

## ADDED Requirements

### Requirement: A control is offered only in the body it acts on

A toolbar control SHALL be presented only while the body it acts on is showing, and SHALL occupy no space in the toolbar otherwise. The session-scope filter SHALL NOT be presented while the Worktree body is showing, because the worktree tree is already scoped to the workspace and the filter has nothing to scope there. The create-worktree control SHALL NOT be presented while a sessions body is showing.

#### Scenario: Switching between the sessions body and the Worktree body

- **WHEN** the user switches the panel from a sessions body to the Worktree body
- **THEN** the session-scope filter is no longer presented and the create-worktree control is

### Requirement: An open worktree is marked without claiming exclusivity

A worktree that the workspace holds open as a folder SHALL carry a mark saying so, and every worktree the workspace holds open SHALL carry it, so more than one mark can be present at once. The mark SHALL carry a hint stating that the worktree is open as a workspace folder, so the mark cannot be read as naming the single worktree the user is working in.

#### Scenario: Two workspace folders lie in different worktrees

- **WHEN** the workspace holds two folders that are, or lie inside, two different worktrees of one repository
- **THEN** both worktree rows carry the mark, and each mark's hint says the worktree is open as a workspace folder
