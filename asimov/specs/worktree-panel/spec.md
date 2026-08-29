# worktree-panel Specification
## Requirements

### Requirement: Present the supplied worktree tree

Given a worktree tree, the view SHALL make every worktree of every repository in it reachable exactly once — directly, or through a disclosure or capping affordance that reveals it. A repository group header SHALL be rendered only when the tree carries more than one repository; with a single repository the view SHALL present its worktrees without a group header.

### Requirement: No row exposes a filesystem path

No row in the tree SHALL display a filesystem path as row content. A worktree's path SHALL remain reachable through the row's tooltip and through an explicit copy action. This holds at every width — the path SHALL NOT appear when the panel is widened.

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

### Requirement: No agent identity is claimed without evidence

An agent row SHALL show an agent icon only when the row's identity source proves the identity. A row whose identity source is `none` SHALL render as a plain terminal row with no icon, and the view SHALL NOT derive an identity from a row's title text.

### Requirement: Activity confidence is marked independently of identity

WHEN a row's activity is derived from a fallback source rather than an authoritative one, the row SHALL carry a quiet marker saying so. That marker SHALL be derived from the activity source alone, so a row may be certain of its identity and uncertain of its activity, or the reverse, and each SHALL be expressed separately.

### Requirement: An agent outside this window is labelled and never offered focus

A row representing an agent running outside this window SHALL be visibly labelled as such, and SHALL NOT be offered any action that claims to reveal a pane in this window — not by activation, and not in its context menu.

### Requirement: Subagents render as history

Subagent rows SHALL be rendered exactly one level under their parent, on expansion only, under a label identifying them as past delegations. They SHALL NOT reuse the live activity vocabulary, SHALL carry no agent icon, and SHALL take their freshness from the parent.

### Requirement: Degraded scope is named and honest emptiness is not

WHEN a repository's listing or a presence source is degraded, the view SHALL show an affordance on the affected scope naming both the failing source and its reason. A result that is genuinely empty SHALL NOT carry that affordance.

### Requirement: Each cause of emptiness reads differently

The view SHALL distinguish, in its rendered copy, a workspace with no folder, a workspace whose
folders hold no repository, an unavailable git, a repository whose only worktree is its main
checkout, and a filter that matched nothing. None of these SHALL be presented with error styling,
and a first load with no tree yet SHALL render placeholder rows rather than a spinner in an empty
panel. The unavailable-git copy SHALL be shown only when no listing is retained.

The unbranched-repository copy SHALL be shown only where the repository holds exactly one
worktree and it is the main checkout. A degraded listing, or rows withheld by a filter, a cap, or
a disclosure, SHALL NOT be described as unbranched.

#### Scenario: A repository that has not been branched out yet

- **WHEN** the only repository in the tree holds nothing but its main checkout
- **THEN** the view says what a worktree buys rather than repeating the no-repository copy

#### Scenario: A repository that could not be listed is not called unbranched

- **WHEN** a repository's listing failed, so it carries no worktrees and a degraded reason
- **THEN** the view states the degraded listing and does not describe the repository as unbranched

#### Scenario: Rows withheld by the view are not evidence about the repository

- **WHEN** a filter, a display cap, or a fold leaves a repository showing only its main checkout
- **THEN** the view does not describe that repository as unbranched

### Requirement: Two independent disclosure levels

Worktree-to-agents and agent-to-subagents SHALL be independently disclosable and independently persisted, so collapsing a worktree SHALL NOT clear any agent row's own expansion. Persisted state SHALL survive a reload, and an id that no longer exists in the tree SHALL be dropped rather than restored later against a reused path.

#### Scenario: An empty persisted set is not an absent one

- **WHEN** the persisted collapse set is empty because the user expanded everything
- **THEN** the view keeps everything expanded, rather than re-applying its first-run defaults

### Requirement: Keyboard traversal follows the declared hierarchy

The tree SHALL expose a single tab stop, with arrows moving within it. Up and Down SHALL move
through visible rows and Home and End SHALL reach the first and last. Right SHALL open a closed
node, then move to its first child, and SHALL do nothing on a row with no children. Left SHALL
close an open node, then move to its parent rather than to the previous visible row. Focus SHALL
remain on the row the user acted on across the re-render that disclosure causes.

WHERE a row carries its own action control, that control SHALL join the tab order only while its
row holds focus. Arrow traversal SHALL keep moving between rows while such a control holds focus.

#### Scenario: A row's action is reachable by tabbing from that row

- **WHEN** a row carrying an action control holds focus and the user tabs
- **THEN** focus moves to that row's action control, and tabbing again leaves the tree

#### Scenario: Another row's action is not a tab stop

- **WHEN** a row carrying an action control does not hold focus
- **THEN** its action control is not in the tab order

#### Scenario: Arrows still move between rows from an action control

- **WHEN** an action control holds focus and the user presses Up or Down
- **THEN** focus moves to the row before or after the control's own row

### Requirement: Filtering keeps the ancestors of a match

The view SHALL filter on branch, path, and agent row text, and a worktree matched only through one of its agents SHALL remain visible so the match can be reached.

### Requirement: A push that changed nothing changes no pixels

WHEN new data arrives that differs from the rendered data only in decorative title animation frames, the view SHALL perform no DOM work, so scroll position, focus, and expansion state survive it. Decorative frames SHALL be stripped before the comparison is made.

### Requirement: A row is never offered an action it cannot perform

An action the view cannot perform SHALL be absent from the surface that would offer it — a row's context menu, or a control in the panel toolbar — rather than present and disabled, because a disabled control claims the action exists here and is merely unavailable. A control SHALL NOT present evidence about a real worktree that the view did not obtain for it.

### Requirement: A destructive confirmation names the whole risk

A remove confirmation SHALL name every blocker that applies, SHALL state what the removal destroys and what it leaves alone, and SHALL carry the identity of the blocker set the user was shown. WHEN removal is refused outright, the view SHALL offer no confirmation control at all rather than a disabled one, and SHALL name what blocks it.

#### Scenario: A mid-turn agent leaves no way to confirm

- **WHEN** a worktree holds an agent whose activity is `running` or `waiting`
- **THEN** the removal is presented as refused, the blocking agent is named, and no confirm control exists in the dialog

### Requirement: A dangerous posture is offered but never preselected

WHEREVER the panel offers permission postures — in the create form or when starting an agent
in an existing worktree — a posture that skips prompts SHALL be labelled as dangerous and
SHALL NOT be the initial selection.

### Requirement: A destination is named only once it is known

WHEN the derived create path is already taken, the form SHALL say so, and SHALL name a final destination only when one has been resolved. It SHALL NOT present the taken path as the path that will be created. The collision SHALL be stated in one line that names the result, and SHALL NOT restate a full path a second time.

#### Scenario: A collision names the result without a second full path

- **WHEN** the derived path is taken and the host has resolved a free suffixed path
- **THEN** the form states the collision and names the suffixed result
- **AND** no second full path is displayed alongside it

### Requirement: A capped listing says it is capped

WHEN a repository holds more worktrees than the view renders at once, it SHALL render an affordance stating the full count and revealing the remainder on request, rather than truncating silently.

### Requirement: The panel shows the workspace's own worktrees

The Worktree view SHALL present the worktrees of the repositories the workspace holds, not sample data, and SHALL reflect a worktree added or removed on disk without the user reloading the window.

- Refresh requested from the panel → the listing is rebuilt before the view is updated, rather than re-shown from what was already held.

### Requirement: The panel opens on the view the workspace earns

WHEN no view choice has been recorded, the panel SHALL open on the Worktree body if the workspace holds at least one git repository, and on the sessions body if it holds none.

- A view derived this way SHALL NOT be recorded as a choice, so a workspace that later gains a repository opens on the Worktree body without the user having to ask for it.

### Requirement: A chosen view survives a reload

A view the user selected SHALL be restored the next time the panel opens, and SHALL take precedence over the view the workspace would otherwise earn.

### Requirement: A retained listing is shown rather than replaced by an empty state

When git is unavailable and a listing is retained, the view SHALL render that listing and SHALL
show a whole-tree affordance naming the cause, rather than an empty state. That affordance SHALL be
announced as a status rather than an alert.

#### Scenario: Git becomes unavailable while the panel shows worktrees

- **WHEN** git becomes unavailable while the panel is showing a repository's worktrees
- **THEN** those worktrees stay on screen under an affordance naming the cause

### Requirement: The panel's read-only actions perform what they offer

Activating a row, or choosing a read-only item from its context menu, SHALL perform that action:
focusing a window-scope agent's pane, opening an agent row's session preview, opening a worktree
as a folder in a new window or as an added workspace folder, revealing a worktree in the OS file
manager, copying a worktree's path, opening a terminal whose working directory is the worktree,
revealing or copying an agent's working directory, or copying an agent row's resume command.

#### Scenario: An offered action works from every surface that shows the panel

- **WHEN** any of these actions is raised from the sidebar, the panel, or an editor surface
- **THEN** the action happens

### Requirement: An action acts on the target the user saw, or on nothing

An action SHALL act on the target the row identified when it was displayed. WHEN that target no
longer exists, or no longer belongs to the row the action came from, the action SHALL do nothing
and SHALL NOT act on any other target in its place.

#### Scenario: A target that went stale performs nothing

- **WHEN** an action names a worktree that has since been removed, or an agent row whose session has since changed
- **THEN** nothing is opened, revealed, copied, or focused, and no other worktree or row is acted on

### Requirement: Row activation is configurable, and external rows are never focused

Activating a window-scope agent row SHALL do what the user's row-activation setting says —
focus that row's pane, or open its session preview — and SHALL default to focusing the pane.
A change to that setting SHALL take effect in views that are already open.

Activating an agent row whose scope is external SHALL open its session preview whatever the
setting says, because no pane of that row exists in this window to focus.

#### Scenario: The setting cannot make an external row focusable

- **WHEN** the row-activation setting is `focus` and an external agent row is activated
- **THEN** its session preview opens and no focus is attempted

#### Scenario: The setting changes while a view is open

- **WHEN** the row-activation setting changes and a panel showing agent rows is already open
- **THEN** the next activation follows the new setting without the view being reopened

### Requirement: A focused pane is revealed where it actually lives

WHEN a pane is focused from the panel, the surface that HOLDS that pane SHALL be revealed and
the pane SHALL become the active one within it. The surface that raised the action SHALL NOT be
revealed in its place when it is not the one holding the pane.

#### Scenario: The pane lives in a surface other than the one asking

- **WHEN** the panel is open in two surfaces and a row is focused whose pane belongs to the other one
- **THEN** the surface holding the pane is revealed and that pane becomes active

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

### Requirement: A launch is submitted as the offer it was shown

WHERE the panel collects a launch in a dialog, the values it submits SHALL be the ones the
dialog was opened against — the offered agents, and the worktree registration — rather than
whatever the panel holds when the dialog is submitted.

#### Scenario: A refresh under an open dialog does not relabel the choice

- **WHEN** a launch dialog is open and the host publishes a new set of launch targets before the
  dialog is submitted
- **THEN** the submission is refused rather than admitted as a choice made from the new set

### Requirement: A control is offered only in the body it acts on

A toolbar control SHALL be presented only while the body it acts on is showing, and SHALL occupy no space in the toolbar otherwise. The session-scope filter SHALL NOT be presented while the Worktree body is showing, because the worktree tree is already scoped to the workspace and the filter has nothing to scope there. The create-worktree control SHALL NOT be presented while a sessions body is showing, and SHALL NOT be presented while the Worktree body holds no repository to create in. The control that chooses a grouping SHALL NOT be presented while the Worktree body is showing, because it groups sessions and the Worktree body holds none.

The control that chooses which body is showing is not a control of either body, and SHALL be
presented in both.

#### Scenario: Switching between the sessions body and the Worktree body

- **WHEN** the user switches the panel from a sessions body to the Worktree body
- **THEN** the session-scope filter is no longer presented and the create-worktree control is presented

#### Scenario: Nothing to create in

- **WHEN** the Worktree body is showing and the tree holds no repository
- **THEN** the create-worktree control is absent rather than present and inert

### Requirement: An open worktree is marked without claiming exclusivity

A worktree that the workspace holds open as a folder SHALL carry a mark saying so, and every worktree the workspace holds open SHALL carry it, so more than one mark can be present at once. The mark SHALL carry a hint stating that the worktree is open as a workspace folder, so the mark cannot be read as naming the single worktree the user is working in.

#### Scenario: Two workspace folders lie in different worktrees

- **WHEN** the workspace holds two folders that are, or lie inside, two different worktrees of one repository
- **THEN** both worktree rows carry the mark, and each mark's hint says the worktree is open as a workspace folder

### Requirement: A summary counts every state it is summarising

Any collapsed summary of a worktree's agents SHALL group them by exact presented state, so a row presented as `running (unconfirmed)` is counted as that state and never omitted from the summary.

#### Scenario: A collapsed worktree holding an unconfirmed run

- **WHEN** a collapsed worktree holds one agent presented as `running (unconfirmed)` and one whose activity is `idle`
- **THEN** its summary accounts for both, the unconfirmed one under its own state

### Requirement: A claim that outlived its evidence says how long and on what

WHEN a row's claim has outlived what its evidence can support, the row SHALL say how long it has stood unchanged and on what evidence it rests, without adding a field to any row or message.

That statement SHALL remain true for as long as it is displayed: a hint read later than it was written SHALL NOT understate the elapsed time.

#### Scenario: An inferred claim that has outlived its evidence

- **WHEN** a row presented as `running (unconfirmed)` is inspected
- **THEN** it states how long the activity has stood unchanged and that it was inferred from terminal output rather than reported

#### Scenario: The hint is read long after it was written

- **WHEN** a hint written at the moment a row crossed the ceiling is read an hour later, no repaint having occurred
- **THEN** what it says about the elapsed time is still true

### Requirement: An inferred running claim stops animating once it outlives its evidence

WHEN a row's activity is `running`, its activity source is terminal output, and that activity has stood unchanged for at least the confirmation ceiling, the view SHALL present the row as `running (unconfirmed)`, whose shape is static where the confirmed one animates.

The row's activity value, its activity source, and every message shape SHALL be unchanged by this. The row SHALL NOT be presented as `idle`: the pane is producing output, and replacing an overstatement with a different false claim is not a correction.

#### Scenario: An inferred run outlives the ceiling

- **WHEN** a row's activity is `running`, its source is terminal output, and the activity has stood unchanged for longer than the confirmation ceiling
- **THEN** the row is presented as `running (unconfirmed)`, with a static shape
- **AND** the row's activity value and activity source are unchanged

#### Scenario: An inferred run just under the ceiling

- **WHEN** the same row's activity has stood unchanged for less than the confirmation ceiling
- **THEN** the row is presented as `running`, with the confirmed running treatment

#### Scenario: The source behind a stale claim has also failed

- **WHEN** a row past the confirmation ceiling is one whose deciding source the presence data reports as failed
- **THEN** the row is presented as `unknown`, not as `running (unconfirmed)`
- **AND** when that failure clears, the row is presented as `running (unconfirmed)` on that same update, its elapsed measurement never having paused

### Requirement: Only an output-inferred running claim is ever unconfirmed

An activity other than `running`, and an activity from any source other than terminal output, SHALL each be presented as confirmed at any age. A row with no start time for its current activity, or one in the future, SHALL also be confirmed: an absent or impossible clock SHALL NOT manufacture staleness.

#### Scenario: A reported row of any age

- **WHEN** a row's activity is `running` and its source is an agent's own report, at any age
- **THEN** the row is presented as `running`, with the confirmed running treatment

#### Scenario: An external row of any age

- **WHEN** a row's activity is `running` and its source is the session registry, at any age
- **THEN** the row is presented as `running`, with the confirmed running treatment

#### Scenario: A waiting or exited row of any age

- **WHEN** a row's activity is `waiting` or `exited`, at any age
- **THEN** the row is never presented as unconfirmed

#### Scenario: No start time, or one in the future

- **WHEN** a row's activity is `running` from terminal output and it carries no start time for that activity, or a start time later than now
- **THEN** the row is presented as `running`, with the confirmed running treatment

### Requirement: Confidence returns with evidence, and the clock restarts only on the claim

WHEN a row presented as unconfirmed is next reported by an agent, the view SHALL present it as confirmed on that same update, with no cooldown.

The elapsed measurement SHALL restart when a row's activity changes, and SHALL NOT restart when only its source changes — so a claim already past the ceiling is unconfirmed as soon as nothing is reporting it.

#### Scenario: A report arrives on an unconfirmed row

- **WHEN** a row presented as `running (unconfirmed)` is next reported by its agent
- **THEN** the row is presented as `running` on that same update

#### Scenario: A report ages out on a claim already past the ceiling

- **WHEN** a row whose activity has stood unchanged for longer than the ceiling was confirmed by an agent report, and that report is no longer fresh, so the source returns to terminal output
- **THEN** the row is presented as `running (unconfirmed)` on the next update, with no grace period

### Requirement: A claim that outlives its evidence stops animating without being told

WHEN no new data arrives but a row's claim crosses the confirmation ceiling, the view SHALL re-present that row, so a claim does not keep animating merely because nothing else changed.

That re-presentation SHALL be scheduled for the moment the earliest claim crosses rather than polled, re-scheduled both when new data arrives and after it runs, and cancelled when the view is discarded. One that changes nothing SHALL perform no DOM work.

#### Scenario: A row crosses the ceiling with no update

- **WHEN** a row presented as `running` crosses the confirmation ceiling and no new data has arrived
- **THEN** the row is re-presented as `running (unconfirmed)`

#### Scenario: A re-presentation that changes nothing

- **WHEN** the view re-presents its rows and no row has crossed the ceiling
- **THEN** no DOM work is performed

### Requirement: One reading of the clock serves the whole cycle

A single reading of the clock SHALL serve a re-presentation, what it renders, and the scheduling of the next one, so no row is drawn against one moment and scheduled against another.

#### Scenario: A row drawn and scheduled in one cycle

- **WHEN** the view re-presents its rows and schedules the next crossing
- **THEN** both used the same reading of the clock

#### Scenario: A second crossing follows the first

- **WHEN** two rows will cross the ceiling at different times and the earlier one has just been re-presented
- **THEN** the later crossing is still re-presented when it arrives

#### Scenario: The view is discarded while a crossing is pending

- **WHEN** the view is discarded before a scheduled crossing arrives
- **THEN** nothing is scheduled to run afterwards

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

### Requirement: The display cap is resolved before the idle fold

WHERE a display cap also applies to a repository, the cap SHALL be resolved before the fold, and the idle disclosure SHALL count only rows the cap admitted. What the capping affordance itself states is unchanged and remains owned by [A capped listing says it is capped](../../../../specs/worktree-panel/spec.md). Revealing the capped remainder SHALL expose every excluded row exactly once.

#### Scenario: A capped listing that also has an idle tail

- **WHEN** a repository holds more worktrees than the cap admits, and the admitted ones include enough agentless worktrees to fold
- **THEN** the idle disclosure counts only the agentless rows the cap admitted, and the capping affordance states the repository's full count

#### Scenario: Revealing the remainder admits the rows the cap withheld

- **WHEN** the user reveals the capped remainder on a repository that also folds an idle tail
- **THEN** every worktree of that repository is reachable exactly once, and the idle disclosure now counts every agentless row among them

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

### Requirement: The create form leads with the branch name

The branch name SHALL be the form's first input, with no other control above it, and it SHALL hold initial focus. Submission SHALL stay unavailable until the value the chosen branch source requires is supplied and valid — the branch name for a new or existing branch, the base ref when detaching, which is the one case the lead input is not the value being validated.

#### Scenario: The branch field is what the form opens on

- **WHEN** the create form opens
- **THEN** the branch name input is the first control in the form and holds focus

#### Scenario: An invalid branch name is not submittable

- **WHEN** the branch name fails validation
- **THEN** submission is unavailable

#### Scenario: Detaching validates the ref it detaches at

- **WHEN** the branch source is detached and no base ref is supplied
- **THEN** submission is unavailable, and the empty branch name does not make it available

### Requirement: The destination is stated once, and its exact value stays reachable

The form SHALL state the resolved destination exactly once, shortened for reading. The exact value SHALL be reachable without leaving the dialog. A shortened statement SHALL NOT be shown for a destination the host has not resolved.

The stated destination SHALL be the path the submission carries. WHEN the user overrides the destination, the statement SHALL follow the override, and any collision message SHALL be withdrawn — it described a derived path the create will no longer take.

#### Scenario: One shortened statement, exact value reachable

- **WHEN** the host has resolved a destination for the named branch
- **THEN** exactly one element states it, shortened
- **AND** the exact value is obtainable from within the dialog

#### Scenario: An override is what the form states and what it submits

- **WHEN** the user overrides the destination after the host resolved one
- **THEN** the stated destination is the overridden value, and it is the value submitted
- **AND** a collision message about the derived path is no longer shown

### Requirement: The agent block is revealed only when an agent was asked for

Agent, permission posture, and first prompt SHALL be absent from the form unless the user chose to start an agent after creating, and SHALL be present when they do. While absent they SHALL NOT take part in the dialog's focus order, and the submitted draft SHALL carry no agent details.

#### Scenario: Nothing to start, nothing to fill in

- **WHEN** "After creating" is any choice other than starting an agent
- **THEN** no agent, posture, or prompt control is reachable in the dialog

#### Scenario: Choosing an agent reveals what starting one needs

- **WHEN** the user chooses to start an agent after creating
- **THEN** the agent, posture, and prompt controls become present and reachable

### Requirement: Every open-after mode is reachable from the offered choices

The form SHALL offer opening the created worktree's folder as a single choice, with the window-or-workspace destination selected by a secondary control on that choice. Every open-after mode the panel supports SHALL be reachable from the form.

#### Scenario: The folder choice reaches both of its modes

- **WHEN** the user chooses to open the folder after creating
- **THEN** a secondary control selects between opening a new window and adding to the workspace
- **AND** the submitted draft carries whichever of the two was selected

### Requirement: Derived and overriding inputs sit behind one disclosure

Base ref, branch source, and the destination override SHALL sit inside a disclosure that is collapsed when the form opens. While collapsed, none of them SHALL take part in the dialog's focus order. Opening it SHALL make the destination editable as an override.

#### Scenario: The form opens without its advanced inputs in the way

- **WHEN** the create form opens
- **THEN** the base ref, branch source, and destination override are not reachable by tabbing

#### Scenario: The override is offered where the advanced inputs are

- **WHEN** the user opens the disclosure and edits the destination
- **THEN** the edited value is what the submitted draft carries

### Requirement: A posture list with no safe choice preselects nothing

WHERE every permission posture an agent offers is dangerous, the form SHALL preselect none of them and SHALL NOT submit one that was never chosen. Submission SHALL stay unavailable until the user selects a posture.

#### Scenario: All choices dangerous

- **WHEN** the chosen agent offers only dangerous postures
- **THEN** no posture is selected when the block is revealed
- **AND** submission is unavailable until the user selects one

### Requirement: The unbranched-repository state offers the create it describes

The state describing a repository that holds only its main checkout SHALL offer, in its body, a
create control that opens the create form on that repository. It SHALL be presented alongside that
repository's main worktree row, which keeps the actions it already offers.

#### Scenario: The state offers the create it is describing

- **WHEN** the view renders the state for a repository holding only its main checkout
- **THEN** a create control is present in the body of that state and opens the create form on that repository
- **AND** that repository's main worktree row is still rendered and still offers its own actions

### Requirement: A state describing nothing to create in offers no create

The states describing a missing folder, a missing repository, an unavailable git, and a filter
that matched nothing SHALL offer no create control.

#### Scenario: A state the panel cannot resolve offers nothing

- **WHEN** the view renders the no-folder, no-repository, unavailable-git, or no-match state
- **THEN** no create control is offered

### Requirement: A repo group header offers create for its own repository

WHERE repo group headers are rendered, each SHALL offer a create control that opens the create
form already scoped to that repository. The control SHALL be reachable by keyboard, not by pointer
hover alone. Activating it SHALL start exactly one create and SHALL NOT also collapse or expand the
header it sits on. It SHALL NOT be rendered where group headers are not.

#### Scenario: Create from the group header opens on that repository

- **WHEN** the user activates the create control on a repo group header
- **THEN** the create form opens with that repository as its selected repository

#### Scenario: Activating the action does not act on the row

- **WHEN** the user activates a header's create control by pointer or by keyboard
- **THEN** exactly one create is started and the header's own expansion is unchanged

#### Scenario: No group headers, no header control

- **WHEN** the tree holds one repository, so no group header is rendered
- **THEN** no header create control exists in the view

### Requirement: Every create entry point opens the same offer

Every offered path to creating a worktree SHALL open the same form and submit the same request
shape, differing only in which repository the form opens on. A path that names no repository SHALL
open a form offering every repository the tree holds, and SHALL NOT narrow the offer to one.

#### Scenario: The header, the empty state, the toolbar, and the menu agree

- **WHEN** a create is started from a group header, the unbranched-repository control, the toolbar control, or a row context menu
- **THEN** each opens the same form and submits the same request shape, differing only in the repository it opens on

#### Scenario: An unscoped create offers every repository

- **WHEN** a create is started from the toolbar, which names no repository
- **THEN** the form offers every repository in the tree

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

### Requirement: A worktree can be selected, and selection is an explicit act

WHERE the workbench setting is enabled, the panel SHALL let the user select one worktree, and
SHALL treat selection as a deliberate act:
no worktree SHALL be selected on the user's behalf at first render, on a reload, or on any push
that changes the tree. At most one worktree SHALL be selected at a time, and selecting another
SHALL replace the first rather than adding to it.

Selection SHALL be reachable by keyboard as well as by pointer.

#### Scenario: Nothing is selected until the user selects it

- **WHEN** the panel renders a tree for the first time, or re-renders after a push
- **THEN** no worktree is marked as selected

#### Scenario: Selecting replaces rather than accumulates

- **WHEN** the user selects one worktree and then another
- **THEN** only the second is marked as selected

#### Scenario: The workbench setting is off

- **WHEN** the workbench setting is disabled and the user activates a worktree row
- **THEN** no worktree becomes selected, and the panel marks what it marked before selection existed

### Requirement: The selected worktree is the only one marked as selected

The treatment that marks the selected worktree SHALL be carried by that worktree and by no other,
and SHALL NOT be carried by a worktree that is merely expanded, merely open as a workspace folder,
or merely holding the strongest activity in the tree. Where no worktree is selected, no worktree
SHALL carry it.

#### Scenario: Expansion is not selection

- **WHEN** several worktrees are expanded and one of them — or none of them — is selected
- **THEN** the selection treatment is carried by the selected worktree alone, and by nothing at all when none is selected

#### Scenario: Selection does not displace the open-folder mark

- **WHEN** the selected worktree is not one the workspace holds open as a folder
- **THEN** the open-folder mark stays on the worktrees that earn it, and the selection treatment stays on the selected one

### Requirement: An agent row gives its last activity a line of its own

An agent row SHALL render at most two lines: identity, marks and age on the first, its
last-activity preview on the second. A row with no preview SHALL render exactly one line, costing
no vertical space and offering no placeholder in the preview's stead.

#### Scenario: A preview that is only decoration

- **WHEN** a row's preview consists only of decorative animation frames or whitespace
- **THEN** the row renders as one line, exactly as a row carrying no preview at all does

### Requirement: Each of an agent row's lines truncates on its own

Neither of an agent row's lines SHALL wrap, and each SHALL truncate independently with an
ellipsis. The preview SHALL consume none of the first line's width, and the age and the leading
glyphs SHALL NOT truncate at any width.

### Requirement: A decorative frame is neither shown in a preview nor a reason to repaint

Decorative animation frames SHALL be stripped from a preview wherever it is presented — the line
itself, and any hover or focus text that repeats it — and a preview that differs from what is
already rendered only in those frames SHALL cause no rendering work.

### Requirement: A list row does not name the model

No row in the panel's list SHALL display the agent's model identifier, and no placeholder SHALL
stand in for one that is unknown. The model is presented where there is room to present it, not
in the width the row's own last activity needs.

### Requirement: The control that swaps the body is separate from the one that groups a body

WHERE the workbench setting is enabled, the panel SHALL present one control whose values are the
two bodies it can show, and SHALL present the control that chooses a grouping only while the
sessions body is showing. Both values of the body control SHALL be named on screen at every panel
width, so it answers "which body am I in" without a hover, a focus, or a widening.

#### Scenario: The grouping control is not offered where it would group nothing

- **WHEN** the Worktree body is showing
- **THEN** the grouping control is absent from the toolbar rather than present and inert, and the
  body control still names both of its values

#### Scenario: Returning to the sessions body

- **WHEN** the user switches from the Worktree body back to the sessions body
- **THEN** the grouping control is presented again, showing the grouping that was in effect before
  the user left — the choice is not reset by having been away

#### Scenario: The workbench setting is off

- **WHEN** the workbench setting is disabled
- **THEN** the panel presents the control it shipped with, unchanged, and none of the two-level
  presentation appears

### Requirement: A control that chooses among values says so and is reachable by keyboard

WHERE the workbench setting is enabled, neither the body control nor the grouping control SHALL be
presented as a plain button that merely looks selected. Each SHALL declare, to assistive
technology, that it is one choice among a set and which of its values is currently chosen, and each
SHALL be operable from the keyboard alone.

#### Scenario: Moving through a control's values without a pointer

- **WHEN** a control has keyboard focus and the user presses the arrow keys
- **THEN** focus moves between that control's own values and the value it lands on becomes the
  chosen one

### Requirement: A view recorded by an older build keeps its meaning

A body choice or a grouping choice recorded before the two controls were separated SHALL be
honoured with the meaning it was recorded with, and SHALL NOT require the user to choose again.

#### Scenario: State written before the split

- **WHEN** the panel opens on state that recorded a body of `worktree` and a grouping of `folder`
- **THEN** the Worktree body is showing, and switching to the sessions body shows it grouped by
  folder

