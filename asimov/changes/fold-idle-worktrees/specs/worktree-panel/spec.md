## MODIFIED Requirements

### Requirement: Present the supplied worktree tree

Given a worktree tree, the view SHALL make every worktree of every repository in it reachable exactly once — directly, or through a disclosure or capping affordance that reveals it. A repository group header SHALL be rendered only when the tree carries more than one repository; with a single repository the view SHALL present its worktrees without a group header.

## ADDED Requirements

### Requirement: Worktrees known to be agentless are ordered last

Worktrees positively determined to hold no agents SHALL be ordered after all others. Every worktree not so determined, including one whose presence cannot be read, SHALL stay in the leading part. Within each part the view SHALL preserve the order the tree supplies.

#### Scenario: Agent-holding worktrees lead, and supplied order survives inside each part

- **WHEN** a repository supplies worktrees in the order A, B, C, D, and only B and D hold agents
- **THEN** they render as B, D, A, C

#### Scenario: A worktree of unknown presence leads with the agent-holding ones

- **WHEN** a repository supplies A, B, C where B holds an agent, C is known agentless, and A's presence cannot be read
- **THEN** A and B render ahead of C, in the supplied order

### Requirement: A worktree with no agents renders as one dim line

A worktree the view can positively determine holds no agents SHALL render as a single de-emphasised line carrying its branch and its marks, with no presence block. It SHALL remain a worktree row for every other purpose: keyboard traversal, activation, and its context menu SHALL be unchanged.

#### Scenario: An agentless worktree keeps its row duties

- **WHEN** a worktree holds no agents and the presence data is intact
- **THEN** it renders as one line with no presence block, and is still reachable by keyboard and still offers its context menu

### Requirement: The idle tail folds once it is long enough to bury the rest

WHEN the number of agentless worktrees a repository renders reaches the folding threshold owned by [worktree-panel-ui.md](../../../../docs/design/worktree-panel-ui.md) § 3.6, the view SHALL collapse them under a single disclosure row stating an exact count of the rows it hides. Below that threshold each SHALL stay visible.

#### Scenario: Four agentless worktrees fold

- **WHEN** a repository holds four agentless worktrees and one that holds an agent
- **THEN** the agent-holding one renders in full, and one disclosure row states that it hides four

#### Scenario: Three stay visible

- **WHEN** a repository holds three agentless worktrees
- **THEN** each renders as its own line and no disclosure row is rendered

### Requirement: The idle fold and the display cap never describe the same rows

WHERE a display cap also applies to a repository, the cap SHALL be resolved before the fold. The capping affordance SHALL report only what the cap excludes, and the idle disclosure SHALL count only rows the cap admitted.

#### Scenario: A capped listing that also has an idle tail

- **WHEN** a repository holds more worktrees than the cap admits, and the admitted ones include enough agentless worktrees to fold
- **THEN** the idle disclosure counts only the agentless rows the cap admitted, and the capping affordance separately reports the worktrees the cap excluded

### Requirement: A worktree whose presence cannot be read is never folded away

An absence of agent rows SHALL move a worktree into the idle tail only when the view can positively attribute that absence to there being no agents. WHEN presence has not been loaded, or any presence source is reported as degraded, a worktree with no rows SHALL render in full and SHALL NOT be counted into the tail or its disclosure.

#### Scenario: A degraded source keeps every worktree visible

- **WHEN** four worktrees carry no agent rows and a presence source is reported as degraded
- **THEN** all four render in full and no disclosure row is rendered

#### Scenario: Presence has not arrived yet

- **WHEN** a tree renders before any presence data has been received
- **THEN** no worktree is folded into the tail

### Requirement: A search match inside the tail opens it

WHEN a filter is active and any worktree in the idle tail matches it, the view SHALL reveal that tail rather than leave the match hidden. Revealing it this way SHALL NOT overwrite the fold state the user chose, so clearing the filter SHALL return the tail to that state.

#### Scenario: A match behind a closed fold

- **WHEN** the idle tail is folded and the user filters on a branch that only an agentless worktree carries
- **THEN** that worktree is visible
- **AND** clearing the filter folds the tail again

### Requirement: The idle disclosure is a first-class row of the tree

The idle disclosure SHALL participate in keyboard traversal as its own row: it SHALL carry the tree's item role and its expanded state, take part in the single tab stop, open on Right and close on Left, and retain focus across the re-render its toggling causes.

#### Scenario: The disclosure is reachable and operable by keyboard alone

- **WHEN** the user arrows onto the idle disclosure and presses Right
- **THEN** the tail opens, its worktrees become reachable by further arrowing, and focus stays on the disclosure

### Requirement: The tail's fold state persists, and defaults to folded exactly once

The idle tail's fold state SHALL survive a reload and a push that changed nothing, and SHALL be dropped rather than restored against a repository that no longer exists.

A tail the view has not previously presented for a repository SHALL default to folded. A tail the user has since opened SHALL stay open. These two SHALL be distinguishable from each other after a reload, including for a user whose persisted state predates this capability.

#### Scenario: The fold survives a push

- **WHEN** the user opens the idle tail and a push arrives carrying identical data
- **THEN** the tail is still open

#### Scenario: An opened tail is not re-folded by a reload

- **WHEN** the user opens the idle tail and then reloads
- **THEN** the tail is still open, rather than defaulting closed again

#### Scenario: A first encounter on existing persisted state

- **WHEN** a user whose persisted disclosure state predates this capability first renders a repository with enough agentless worktrees to fold
- **THEN** the tail is folded
