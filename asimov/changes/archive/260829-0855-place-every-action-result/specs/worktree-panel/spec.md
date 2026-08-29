## ADDED Requirements

### Requirement: Every action result is rendered, whatever the tree chose to draw

Every action result the panel holds SHALL be rendered exactly once. Display decisions — a cap, an idle fold, a collapsed repository, an active filter, or a tree that could not be listed at all — SHALL govern which worktrees are listed and SHALL NOT govern which results are reported.

#### Scenario: A result on a worktree the cap excluded

- **WHEN** a repository holds more worktrees than the display cap admits, and an action on one of the excluded worktrees returns a result
- **THEN** that result is rendered exactly once, and the excluded worktree's row is still absent

#### Scenario: A result on a worktree hidden behind a fold

- **WHEN** an action on an agentless worktree returns a result while that worktree sits in a folded idle tail
- **THEN** that result is rendered exactly once, and the fold does not open

#### Scenario: A result on a worktree an active filter excluded

- **WHEN** a filter is active and an action returns a result for a worktree the filter excludes
- **THEN** that result is rendered exactly once

#### Scenario: A repository-scoped result on a collapsed repository

- **WHEN** a repository is collapsed and holds a result scoped to the repository rather than to one worktree
- **THEN** that result is rendered exactly once, and the repository stays collapsed

#### Scenario: A result outlives the listing entirely

- **WHEN** the panel holds a result and the tree cannot be listed, so no repository is drawn
- **THEN** that result is still rendered

#### Scenario: A result is not duplicated when the listing changes around it

- **WHEN** the same result is held across a push that moves its worktree from drawn to undrawn, and across a push that moves it back
- **THEN** exactly one notice for that result is present after each render

### Requirement: A result whose row is not on screen says which worktree it is about

WHERE the row a result concerns was not rendered, the notice SHALL name that worktree. WHERE the row was rendered, the notice SHALL NOT restate what the row already carries.

#### Scenario: A listed worktree's result does not repeat its branch

- **WHEN** a result concerns a worktree the view rendered
- **THEN** the notice for it is present, and does not restate that worktree's row label

#### Scenario: A worktree the tree no longer carries is still named

- **WHEN** a result concerns a worktree that has left the tree
- **THEN** the notice names it from what the panel last knew of it

### Requirement: A name in a notice identifies one worktree

A worktree named in a notice SHALL be identified unambiguously. WHERE a row label alone would not separate it from another worktree the panel holds, the name SHALL be qualified until it does.

#### Scenario: Two failures on unlisted worktrees are told apart

- **WHEN** two worktrees that were not rendered each return a failure, and both carry the same row label
- **THEN** each notice names its own worktree, and the two names differ
