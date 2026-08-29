## MODIFIED Requirements

### Requirement: Strongest state wins and shape carries it

Each presented activity — `waiting`, `running`, `unknown`, `idle`, `exited` — SHALL be distinguishable from every other by shape alone, without relying on colour or on motion, so the vocabulary survives a monochrome theme and a reduced-motion setting. The same shape SHALL be used on a worktree row and on an agent row. A worktree row SHALL reflect the strongest presented activity among its agents, in the precedence `waiting` > `running` > `unknown` > `idle` > `exited`.

#### Scenario: One waiting agent among several running ones

- **WHEN** a worktree holds one agent whose activity is `waiting` and four whose activity is `running`
- **THEN** the worktree row reads as `waiting`

#### Scenario: Motion is removed

- **WHEN** the viewer has asked for reduced motion, so no state animates
- **THEN** `running` and `idle` remain distinguishable from each other by shape

#### Scenario: An unknown agent outranks an idle one

- **WHEN** a worktree holds one agent presented as `unknown` and one whose activity is `idle`
- **THEN** the worktree row reads as `unknown`

## ADDED Requirements

### Requirement: An activity no source could determine is not presented as idle

WHEN a row's activity has no source, or the presence data reports that the source which would have determined that row's activity failed, the view SHALL present that row's activity as `unknown` rather than as `idle`. `idle` SHALL NOT be presented from an absence of evidence.

#### Scenario: The source behind a row failed

- **WHEN** the presence data reports a failure of the source that determined an agent row's activity, and that row's activity is `idle`
- **THEN** the row is presented as `unknown`

### Requirement: A failed worktree listing does not make any activity unknown

A repository whose worktree listing failed SHALL NOT by itself cause any row under it to be presented as `unknown`. That failure concerns which worktrees exist, not what any agent is doing.

#### Scenario: Only the worktree listing failed

- **WHEN** a repository reports that its worktree listing failed, and no presence source is reported as failed
- **THEN** every row under it keeps the activity it was given, and none is presented as `unknown`
