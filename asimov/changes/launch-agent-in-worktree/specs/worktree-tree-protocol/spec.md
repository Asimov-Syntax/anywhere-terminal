## ADDED Requirements

### Requirement: Report which agents can start a fresh session

The host SHALL answer a request for launch targets with the agents that are installed AND
declare a way to start a fresh session, each carrying its display name, its own permission
postures, and whether it can be seeded with a prompt.

- An agent that is declared but not installed SHALL be absent from the answer.
- The answer SHALL be the panel's only source of offerable agents.

#### Scenario: An answer states which question it answers

- **WHEN** launch targets are requested for starting a session and for continuing one
- **THEN** each answer names the capability it was asked about, and neither answer can be taken for the other

### Requirement: A launch resolves its own target

A launch request SHALL name a worktree by identifier, and the host SHALL resolve the directory
from its own current tree rather than from anything the request supplied.

#### Scenario: A stale worktree launches nothing

- **WHEN** a launch names a worktree that has since left the tree
- **THEN** no agent is started, and no other worktree is used in its place

### Requirement: A launch acts on the registration it was chosen against

The host SHALL publish, per repository, a token that changes whenever it can no longer prove
its worktree registrations are the ones it last reported. A launch SHALL quote the token its
row carried, and SHALL be refused unless that token is still current at handoff.

### Requirement: A repository whose listing failed authorizes nothing

WHERE a repository's listing failed and the host is showing what it previously held, that
repository SHALL publish no registration token, so a launch into it is refused whether it quotes
the previous token or none.

- A repository whose listing SUCCEEDED SHALL keep its token even where the host cannot watch it
  for later changes: the registrations were read, and refusing would withdraw the capability
  without making the reading fresher.

#### Scenario: A failed listing withdraws authority but not the display

- **WHEN** a repository's listing fails and its previously reported worktrees are still shown
- **THEN** launching into one of them is refused

#### Scenario: An unwatched repository still launches

- **WHEN** a repository was listed successfully but cannot be watched for changes
- **THEN** launching into its worktrees still works

### Requirement: The registration token is not derived from git state

The token SHALL NOT be derived from the branch or commit a worktree is on, and SHALL be scoped
to one repository so an unrelated repository moving refuses nothing.

- WHERE a create is followed by a launch, no token SHALL be required: the worktree is the one
  the create just made, handed over in the same operation.

#### Scenario: A worktree recreated at the same identifier launches nothing

- **WHEN** a launch is requested, and before the session is handed over the worktree is removed
  and recreated at the same path, on the same branch, at the same commit
- **THEN** no agent is started

#### Scenario: An unrelated repository moving does not refuse a launch

- **WHEN** a launch is requested and another repository in the tree rebuilds before the session
  is handed over
- **THEN** the agent is started as asked

### Requirement: A launch is admitted only on values the host declared

The host SHALL reject an agent absent from its own launch-target answer, a permission posture
the chosen agent does not declare, and a prompt beyond the bound it publishes.

### Requirement: Resuming a session into a worktree runs it there

Resuming SHALL use the session the displayed row identified, and SHALL run it in the resolved
worktree rather than the session's recorded directory.

### Requirement: A launch that was asked for on its own reports its own failure

WHEN a launch requested directly on a worktree fails, the failure SHALL be reported to the
surface that asked for it.

#### Scenario: A missing executable is not silent

- **WHEN** a launch is requested for an agent whose executable cannot be run
- **THEN** the asking surface is told the launch failed, rather than the request ending with nothing shown

### Requirement: Launch details belong to the agent mode alone

A create SHALL require an agent, and admit a permission posture and a prompt, exactly when it
asks for an agent, and SHALL reject any of the three on every other mode.

#### Scenario: Launch details on the wrong mode are refused

- **WHEN** a create that does not ask for an agent carries an agent, a posture, or a prompt
- **THEN** the create is rejected rather than the extra details being ignored

### Requirement: A create launches its agent only after the create succeeded

WHERE a create asks for an agent, the launch SHALL run only after the create has succeeded, and
a create that failed SHALL launch nothing.

### Requirement: A failed launch never undoes its worktree

WHEN a create succeeds and the launch that followed it fails, the created worktree SHALL remain
and the outcome SHALL be reported as a success carrying the reason the agent did not start.
