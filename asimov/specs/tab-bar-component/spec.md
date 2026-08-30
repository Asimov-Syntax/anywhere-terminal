# tab-bar-component Specification

## Purpose
TBD
## Requirements

### Requirement: Tab-Bar-Rendering

The webview SHALL render a tab bar inside the `#tab-bar` element that displays all terminal tabs for the current view. Each tab element SHALL display the terminal name (e.g., "Terminal 1") and a close button ("×"). The tab bar SHALL include a "+" button as the last element to create new tabs.

The `renderTabBar()` function SHALL be called after every tab mutation: `handleInit`, `tabCreated` (after `createTerminal` + `switchTab`), `tabRemoved` (after `removeTerminal`), and `switchTab`.

#### Scenario: Initial render with single tab

- **WHEN** the webview receives an `init` message carrying one tab and renders the tab bar
- **THEN** the tab bar holds that tab marked active, and a "+" button

#### Scenario: Multiple tabs

- **WHEN** two or more terminal instances exist and the tab bar is rendered
- **THEN** each tab carries its name and a close button, and exactly one tab is marked active

### Requirement: Tab-Bar-Styling

The tab bar SHALL use VS Code CSS variables for all colors to ensure theme consistency. The tab bar SHALL have a horizontal layout with tabs arranged left-to-right. The active tab SHALL be visually distinguished from inactive tabs.

#### Scenario: Theme-consistent styling

- Given the webview is rendered in a VS Code dark theme
- When the tab bar renders
- Then tab background colors use `--vscode-tab-inactiveBackground` for inactive tabs and `--vscode-tab-activeBackground` for active tabs
- And tab text colors use `--vscode-tab-inactiveForeground` and `--vscode-tab-activeForeground`
- And the tab bar background uses `--vscode-editorGroupHeader-tabsBackground`

#### Scenario: Tab bar height

- Given the tab bar is visible
- Then the tab bar height SHALL be approximately 28-35px (compact, not stealing excessive terminal space)
- And the tab bar SHALL have `flex-shrink: 0` to prevent compression

### Requirement: Tab-Click-Handlers

The webview SHALL wire click handlers on tab elements to switch tabs, on close buttons to close tabs, and on the "+" button to create new tabs.

#### Scenario: Click tab to switch

- Given tabs "Terminal 1" (active) and "Terminal 2" (inactive) exist
- When the user clicks the "Terminal 2" tab element
- Then `switchTab("terminal-2-id")` is called
- And the tab bar re-renders with "Terminal 2" marked active

#### Scenario: Click close button

- Given tabs "Terminal 1" and "Terminal 2" exist
- When the user clicks the "×" button on "Terminal 1"
- Then `vscode.postMessage({ type: 'closeTab', tabId: 'terminal-1-id' })` is sent
- And the click event does NOT propagate to the tab element (no accidental switch)

#### Scenario: Click add button

- Given the tab bar is rendered
- When the user clicks the "+" button
- Then `vscode.postMessage({ type: 'createTab' })` is sent

#### Scenario: Close button on last remaining tab

- Given only one tab exists
- When the tab bar is hidden (single tab)
- Then there is no close button visible to click (tab bar is hidden)

### Requirement: Tab-Bar-Update-Integration

The webview message handler SHALL call `renderTabBar()` at the correct points to keep the tab bar synchronized with terminal state.

#### Scenario: Tab bar updates on tabCreated

- Given one tab exists and tab bar is hidden
- When a `tabCreated` message is received and processed
- Then `renderTabBar()` is called after `createTerminal()` and `switchTab()`
- And the tab bar becomes visible (now 2 tabs)

#### Scenario: Tab bar updates on tabRemoved

- Given three tabs exist
- When a `tabRemoved` message is received and processed
- Then `renderTabBar()` is called after `removeTerminal()`
- And the removed tab is no longer in the tab bar

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

A change in the reported tree or presence that changes no tab's attribution, no scope, and nothing
the tab bar presents about hidden waiting tabs SHALL leave the rendered tab bar untouched.

#### Scenario: A fresh envelope carrying the same attribution

- **WHEN** a presence push arrives whose pane-to-worktree attribution is identical to the last
- **THEN** the tab bar performs no DOM work

#### Scenario: A waiting change the surface does not present

- **WHEN** a presence push changes a pane's waiting state, and that pane is presented rather than
  hidden, or the surface is unscoped
- **THEN** the tab bar performs no DOM work — nothing it draws depends on that change

### Requirement: A surface's scope survives a reload and never outlives its worktree

Scope SHALL be persisted per surface. A surface with no persisted scope SHALL be unscoped, which
SHALL be the first-run state and the state of anything written by a build that recorded none. A
persisted scope naming a worktree absent from the tree the surface now holds SHALL resolve to
unscoped.

#### Scenario: A persisted scope naming something absent

- **WHEN** a surface reloads with a persisted scope whose worktree is not in the tree it now holds
- **THEN** the surface is unscoped and its tab bar hides nothing

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

