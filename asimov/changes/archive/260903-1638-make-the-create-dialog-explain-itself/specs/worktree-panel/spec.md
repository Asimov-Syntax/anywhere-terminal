## ADDED Requirements

### Requirement: The create form opens on a safe useful after-create action

WHERE a launchable agent has an explicitly non-dangerous permission choice, the form SHALL open
with **Start an agent** and that safe posture selected. WHERE none does, it SHALL open on **Open a
terminal here**. An agent with no permission axis is not evidence of a safe posture, and a dangerous
permission choice SHALL NOT be preselected.

### Requirement: Repository changes preserve the chosen after-create action

A repository change SHALL preserve the user's after-create action while that action remains
available. WHERE the chosen agent action becomes unavailable, the form SHALL select **Open a
terminal here** rather than silently selecting Nothing.

#### Scenario: A safe agent is available

- **WHEN** the form opens with a resolvable agent that offers `Ask for permission`
- **THEN** Start an agent and that non-dangerous permission choice are selected

#### Scenario: Only dangerous agents are available

- **WHEN** every available agent requires an explicitly dangerous permission choice
- **THEN** the form opens on Open a terminal here, and no dangerous permission is selected

### Requirement: Each after-create action states its consequence

The create form SHALL show a concise visible explanation of the selected after-create action. The
explanation SHALL distinguish doing nothing, opening a terminal, starting the selected agent, and
opening or adding the folder. Changing the selection SHALL change the explanation in the same turn.

### Requirement: The provisioning save action names what it persists

The action that writes the current Bring over selection into repository configuration SHALL be
labelled as saving the current choices as repository defaults, not as configuring an unspecified
thing. Its adjacent explanation SHALL state that the active source and selected copy/link choices
affect future creates, while ports and setup steps apply only to the current create. It SHALL NOT
imply that pressing it opens a second configuration interface.

### Requirement: Clearing an occupied destination is named as deletion

The user-facing action for a non-git directory at the intended destination SHALL say that it clears
the existing folder and creates there. It SHALL remain unchecked by default and SHALL NOT call the
action “Recover”. Before Create becomes available, the assessment SHALL name the exact path and the
entries that will be removed.

### Requirement: A disabled create action states what it is waiting for

WHERE Create worktree is disabled, the form SHALL show one concise reason describing the first
unmet condition: a missing or invalid branch/ref, an unresolved destination, a pending clearance
assessment, an unavailable base, or an unchosen permission posture. The reason SHALL be associated
with the disabled button for assistive technology and SHALL disappear when the action becomes
available.

## MODIFIED Requirements

### Requirement: The agent block is revealed only when an agent was asked for

Agent, permission posture, and first prompt SHALL be absent while **After creating** is any choice
other than **Start an agent**, and SHALL be present while Start an agent is selected — including
where the form selected it as the safe initial action. While absent they SHALL NOT take part in the
dialog's focus order, and the submitted draft SHALL carry no agent details.

#### Scenario: Nothing to start, nothing to fill in

- **WHEN** After creating is any choice other than Start an agent
- **THEN** no agent, posture, or prompt control is reachable in the dialog

#### Scenario: Starting an agent reveals what it needs

- **WHEN** Start an agent is selected by the initial safe default or by the user
- **THEN** the agent, posture, and prompt controls are present and reachable

### Requirement: A save that has nothing to record writes nothing

WHERE the user has changed nothing the configuration can express and has not chosen a different
source, the extension SHALL leave the repository's configuration exactly as it found it, creating
no file.

#### Scenario: Save defaults pressed on an untouched form

- **WHEN** a save is made with every offered item still as it arrived and no source taken
- **THEN** no configuration file is created
- **AND** the repository has nothing new to commit

#### Scenario: A source taken and nothing else changed

- **WHEN** a save is made after choosing a different source, with every offered item unchanged
- **THEN** the configuration records that source and nothing else
