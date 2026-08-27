# worktree-panel — delta

## ADDED Requirements

### Requirement: The panel's mutating actions perform what they offer

Creating, removing, locking, unlocking, and pruning from the panel SHALL each carry out the operation it names on the target the user selected. An action the surface cannot perform, or that the repository's state makes impossible, SHALL be absent rather than offered.

#### Scenario: Prune is offered only when there is something to prune

- **WHEN** a repository has no prunable worktree registration
- **THEN** the panel offers no prune action for that repository

### Requirement: A removal states what it destroys and what it spares

A removal confirmation SHALL state that the directory and its contents are deleted irrevocably, SHALL state that the branch is kept, and SHALL state that panes running inside the worktree are left running rather than closed. It SHALL NOT describe a forced removal as having reviewed the losses, because the contents may change between the check and the deletion.

### Requirement: A created worktree names the destination it will actually use

The create form SHALL present the path the host has resolved and will use, derived from the repository's own worktree layout where it has one and from an explicitly configured root where the user has set one. WHEN the derived path is already taken, the presented destination SHALL be the free path that will be created, not the taken one.

#### Scenario: An explicit setting outranks the repository's layout

- **WHEN** a root is explicitly configured and the repository's existing worktrees live somewhere else
- **THEN** the presented destination is derived from the configured root

### Requirement: A mutation that fails leaves the panel showing reality

WHEN a mutating action fails, times out, or leaves git and the filesystem disagreeing, the panel SHALL show the tree as it actually is afterwards and SHALL surface the failure text git produced, bounded. The panel SHALL NOT retry a partially applied mutation.

### Requirement: A refusal names the reason it actually has

WHEN a removal is refused, the panel SHALL state the reason that applies to that target. It SHALL NOT present the explanation for one refusal reason when a different one is what refused the removal.

#### Scenario: A containment refusal is not explained as a busy agent

- **WHEN** a removal is refused because the target contains another registered worktree
- **THEN** the panel names the contained worktrees, and does not tell the user that an agent is mid-turn

### Requirement: Prune names how many registrations it drops

The panel SHALL confirm a prune before it runs, and the confirmation SHALL state the number of registrations that will be dropped, as counted by the host. A prune offered as recovery from an indeterminate result is exempt, because the observation report it accompanies already states what was found.

### Requirement: A deferred mode is absent from the create form

The create form SHALL NOT offer an after-creation mode the host will reject. WHEN starting an agent is not yet supported, that option SHALL be absent from the form rather than present and refused on submit.

#### Scenario: No agent option is offered even where agents resolve

- **WHEN** the create form is opened for a repository whose agents resolve
- **THEN** the form offers no option to start an agent


### The panel states the outcome of every mutation it started

Each create, removal, lock, unlock and prune reports back to the surface that started it, as one
of: succeeded, failed with git's own message, unclear, or could not be checked. "Unclear" and
"could not be checked" are distinct from failure, and only the latter offers a retry.

### A create that asked for a terminal gets one

When a create requests a terminal and succeeds, a terminal opens in the new worktree on the
surface that asked for it.
