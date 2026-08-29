## MODIFIED Requirements

### Requirement: Tab-Bar-Rendering

The webview SHALL render a tab bar inside the `#tab-bar` element that displays all terminal tabs for the current view. Each tab element SHALL display the terminal name (e.g., "Terminal 1") and a close button ("×"). The tab bar SHALL include a "+" button as the last element to create new tabs.

The `renderTabBar()` function SHALL be called after every tab mutation: `handleInit`, `tabCreated` (after `createTerminal` + `switchTab`), `tabRemoved` (after `removeTerminal`), and `switchTab`.

#### Scenario: Initial render with single tab

- **WHEN** the webview receives an `init` message carrying one tab and renders the tab bar
- **THEN** the tab bar holds that tab marked active, and a "+" button

#### Scenario: Multiple tabs

- **WHEN** two or more terminal instances exist and the tab bar is rendered
- **THEN** each tab carries its name and a close button, and exactly one tab is marked active

## ADDED Requirements

### Requirement: The tab bar is presented whenever it is filtered

The tab bar SHALL be hidden while it holds fewer than two tabs and the surface is unscoped, and
SHALL be presented whatever the tab count while the surface is scoped.

#### Scenario: A scope that leaves one tab still shows the bar

- **WHEN** a scope is set and the tabs it does not hide number fewer than two
- **THEN** the tab bar is presented

#### Scenario: One tab and no scope

- **WHEN** one terminal instance exists and no scope is set
- **THEN** the tab bar is hidden

#### Scenario: Two or more tabs and no scope

- **WHEN** two or more terminal instances exist and no scope is set
- **THEN** the tab bar is presented, as it was before scoping existed

### Requirement: A scoped tab bar hides only what it can prove belongs elsewhere

A surface MAY be scoped to one worktree. While scoped, its tab bar SHALL hide a tab only where the
attribution evidence places that tab's pane in a different worktree. A tab whose pane the evidence
does not place at all SHALL be presented in every scope.

A tab that holds several panes SHALL be hidden only where every one of its panes is attributed to
a different worktree. Attribution that places one pane in more than one worktree SHALL leave that
pane unattributed.

#### Scenario: The three attribution outcomes

- **WHEN** a surface is scoped and its tabs include one pane attributed to the scoped worktree, one attributed to a different worktree, and one the evidence does not attribute at all
- **THEN** the first and the third are presented and the second is hidden

#### Scenario: A tab of several panes, one of them in scope

- **WHEN** a scoped surface holds a tab whose panes include one attributed to the scoped worktree and one attributed elsewhere
- **THEN** that tab is presented

#### Scenario: A tab of several panes, one of them unplaced

- **WHEN** a scoped surface holds a tab whose panes are all attributed elsewhere except one the evidence does not place
- **THEN** that tab is presented

#### Scenario: A tab of several panes, all elsewhere

- **WHEN** a scoped surface holds a tab every one of whose panes is attributed to a different worktree
- **THEN** that tab is hidden

### Requirement: Absence of attribution fails open

A pane the evidence does not place SHALL be presented whatever the cause of that absence — the
evidence cannot place it, no evidence has arrived for it yet, or its attribution conflicts.

#### Scenario: A scope set before any attribution has arrived

- **WHEN** a surface is scoped and no attribution evidence has arrived yet
- **THEN** every tab is presented

#### Scenario: One pane attributed to two worktrees

- **WHEN** the attribution evidence places one pane in more than one worktree
- **THEN** that pane is treated as unattributed and its tab is presented

### Requirement: Scope changes what is drawn and nothing else

Setting or clearing a scope SHALL start, stop, close, and detach no pane, and SHALL change no
other surface's tab bar. Two surfaces MAY hold different scopes, and neither SHALL follow the
other.

#### Scenario: A hidden pane is hidden, not stopped

- **WHEN** a scope hides the tab of a pane that is running
- **THEN** that pane keeps running and keeps its session, and clearing the scope presents its tab again

#### Scenario: One surface's scope is not another's

- **WHEN** two surfaces are open and one is scoped
- **THEN** the other surface's tab bar is unchanged

### Requirement: A scope is named wherever it is in force

While a surface is scoped, its tab bar SHALL carry a chip naming the scoped worktree and offering
a control that clears the scope. The chip SHALL be present exactly while the scope is. Clearing the
scope SHALL present every tab that scope was hiding.

#### Scenario: The chip is present exactly while the filter is

- **WHEN** a surface is scoped and then the scope is cleared
- **THEN** the chip is present while scoped, naming that worktree, and absent once cleared

#### Scenario: The escape survives a collapsed panel

- **WHEN** a surface is scoped and the panel that set the scope is collapsed or hidden
- **THEN** the clearing control is still reachable, and using it presents every tab the scope was hiding

### Requirement: A scope that loses its worktree is dropped and said

A scope naming a worktree that leaves the surface's tree SHALL be cleared, and the surface SHALL
state that it was cleared and why. A scope naming a worktree that is still registered but reported
as missing SHALL be kept.

#### Scenario: The scoped worktree is removed

- **WHEN** the scoped worktree is removed or pruned from the tree the surface holds
- **THEN** the scope is cleared, every tab it was hiding is presented, and the surface states why

#### Scenario: The scoped worktree goes missing

- **WHEN** the scoped worktree is reported missing but is still registered
- **THEN** the scope is kept

### Requirement: A push that moves no attribution redraws no tab bar

A change in the reported tree or presence that changes no tab's attribution and no scope SHALL
leave the rendered tab bar untouched.

#### Scenario: A fresh envelope carrying the same attribution

- **WHEN** a presence push arrives whose pane-to-worktree attribution is identical to the last
- **THEN** the tab bar performs no DOM work

### Requirement: A surface's scope survives a reload and never outlives its worktree

Scope SHALL be persisted per surface. A surface with no persisted scope SHALL be unscoped, which
SHALL be the first-run state and the state of anything written by a build that recorded none. A
persisted scope naming a worktree absent from the tree the surface now holds SHALL resolve to
unscoped.

#### Scenario: A persisted scope naming something absent

- **WHEN** a surface reloads with a persisted scope whose worktree is not in the tree it now holds
- **THEN** the surface is unscoped and its tab bar hides nothing

### Requirement: Scoping is offered only where it has been turned on

The scoped tab bar, the scope chip, and worktree selection SHALL be offered only while the
`anywhereTerminal.worktree.workbench` setting is enabled, and that setting SHALL default to
disabled. While it is disabled no tab SHALL be hidden, no chip SHALL be rendered, and no persisted
scope SHALL take effect.

#### Scenario: The setting is off

- **WHEN** the setting is disabled, including by default, and a surface holds a persisted scope
- **THEN** no tab is hidden, no chip is rendered, and selecting a worktree scopes nothing
