## ADDED Requirements

### Requirement: A worktree offers to start an agent in it

The panel SHALL offer, on a worktree, an action that starts a chosen agent in that worktree,
and SHALL offer, on an agent row that has a session, an action that resumes that session in
that worktree.

- Both SHALL be absent on a surface that cannot start a terminal session, rather than present
  and inert.
- The agents offered SHALL be only those the host reported as able to start a fresh session.

#### Scenario: Nothing to launch means nothing to offer

- **WHEN** the host reports no agent able to start a fresh session
- **THEN** the worktree offers no start-an-agent action

### Requirement: A launch is described by the agent it will run

WHERE the panel collects a launch, the permission postures it offers SHALL be the chosen
agent's own, and changing the chosen agent SHALL change them.

- An agent that declares no postures SHALL be offered without a posture control.
- A prompt SHALL be offered only for an agent the host reported as seedable, and SHALL be
  optional for those — a launch SHALL be offerable with the prompt left empty.

### Requirement: A launch that fails after a create says the worktree was made

WHEN a create succeeds and the agent it asked for does not start, the panel SHALL report the
worktree as created and the agent as not started, and the worktree SHALL remain.

## MODIFIED Requirements

### Requirement: A dangerous posture is offered but never preselected

WHEREVER the panel offers permission postures — in the create form or when starting an agent
in an existing worktree — a posture that skips prompts SHALL be labelled as dangerous and
SHALL NOT be the initial selection.

## REMOVED Requirements

### Requirement: A deferred mode is absent from the create form

**Reason**: Starting an agent after a create is now supported, so the requirement's condition
("WHEN starting an agent is not yet supported") no longer holds and its scenario asserts the
opposite of the shipped behavior.

**Migration**: The general rule it stood in for — the form offers no mode the host would
reject — is already carried by "A row is never offered an action it cannot perform", and the
agents offered are now bounded by "A worktree offers to start an agent in it".

### Requirement: A launch is submitted as the offer it was shown

WHERE the panel collects a launch in a dialog, the values it submits SHALL be the ones the
dialog was opened against — the offered agents, and the worktree registration — rather than
whatever the panel holds when the dialog is submitted.

#### Scenario: A refresh under an open dialog does not relabel the choice

- **WHEN** a launch dialog is open and the host publishes a new set of launch targets before the
  dialog is submitted
- **THEN** the submission is refused rather than admitted as a choice made from the new set
