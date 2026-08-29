# Spec Delta: tab-bar-component — surface-what-the-scope-hides

## ADDED Requirements

### Requirement: A hidden tab that needs a human is counted

While a surface is scoped, its scope-clearing control SHALL carry a count of the tabs that scope is
hiding which hold a pane whose state is `waiting`. A count of zero SHALL render no mark at all, not
a zero. The mark SHALL use the same attention treatment a waiting tab already uses, SHALL NOT be an
error treatment, and SHALL NOT animate. Clearing the scope from the marked control SHALL present
every tab the count named.

#### Scenario: Something hidden is waiting

- **WHEN** a scope hides two tabs, each holding a waiting pane
- **THEN** the clearing control carries an attention mark counting two

#### Scenario: Nothing hidden is waiting

- **WHEN** a scope hides tabs and none of them holds a waiting pane
- **THEN** the clearing control carries no mark

#### Scenario: A split tab is one hidden thing

- **WHEN** a scope hides one split tab holding two waiting panes
- **THEN** the count is one — the unit is the tab that was hidden, not the panes inside it

#### Scenario: A pane the evidence cannot place is never counted

- **WHEN** a scope is set and a waiting pane has no attribution
- **THEN** that pane's tab is presented, and it raises no count — it was never hidden

#### Scenario: The count and what clearing produces agree

- **WHEN** the clearing control carries a count and is used
- **THEN** every tab that count named is presented

### Requirement: The count reads every source that can say a pane is waiting

A pane SHALL be counted as waiting when either the surface's own tracked pane status or the
presence row for that pane says so. Neither source alone SHALL be able to suppress the count.

#### Scenario: Only presence knows

- **WHEN** a hidden tab's pane has a presence row saying waiting and the surface's own status does not
- **THEN** the tab is counted

#### Scenario: Only the surface's own status knows

- **WHEN** a hidden tab's pane has its own tracked status saying waiting and no presence row says so
- **THEN** the tab is counted

### Requirement: Selecting a worktree goes to a pane of that worktree

Selecting a worktree SHALL make the first presented pane of that worktree the active pane, and
SHALL leave the active pane alone when that pane is itself in scope. The unit is the pane: a split
tab MAY be presented because one of its panes is in scope while the pane active inside it is not,
and selecting SHALL then move to the in-scope pane rather than only to the tab.

#### Scenario: The active pane belongs elsewhere

- **WHEN** a worktree holding panes is selected while a pane of another worktree is active
- **THEN** the first presented pane of the selected worktree becomes the active pane

#### Scenario: The active pane is already in scope

- **WHEN** a worktree is selected and the active pane is one of its own
- **THEN** the active pane does not change

#### Scenario: A split whose visible tab holds the wrong active pane

- **WHEN** a split tab is presented because one pane is in scope, while the pane active inside it is attributed elsewhere
- **THEN** selecting that worktree makes the in-scope pane the active one inside that tab

### Requirement: A scope holding no pane says so and offers what is worth doing

When a scope holds no pane, the surface SHALL present a region that offers opening a terminal in
the scoped worktree and launching an agent there, states that other worktrees' panes are hidden,
and offers the scope-clearing control. The terminal region SHALL NOT continue to present a pane the
scope hides. The region SHALL carry no error treatment, and SHALL NOT clear the scope on its own.

#### Scenario: A worktree with nothing running in it

- **WHEN** a worktree holding no pane is selected
- **THEN** the region is presented with both offers and a reachable clearing control, and the scope is unchanged

#### Scenario: The hidden pane is not still on screen behind it

- **WHEN** the region is presented while a pane of another worktree was active
- **THEN** that pane is no longer presented, and it is presented again with its session intact once the scope is cleared

#### Scenario: The terminal offer opens in the scoped worktree

- **WHEN** the region's terminal offer is used
- **THEN** the terminal opened is one whose working directory is the scoped worktree

#### Scenario: The region is not a failure

- **WHEN** the region is presented
- **THEN** it carries no error treatment, and the scope the user chose is still in force

## MODIFIED Requirements

### Requirement: A push that moves no attribution redraws no tab bar

A change in the reported tree or presence that changes no tab's attribution, no scope, and nothing
the tab bar presents about hidden waiting tabs SHALL leave the rendered tab bar untouched.

#### Scenario: A fresh envelope carrying the same attribution

- **WHEN** a presence push arrives whose pane-to-worktree attribution is identical to the last
- **THEN** the tab bar performs no DOM work

#### Scenario: A waiting change the surface does not present

- **WHEN** a presence push changes a pane's waiting state, and that pane is presented rather than
  hidden, or the surface is unscoped
- **THEN** the tab bar performs no DOM work — nothing it draws depends on that change
