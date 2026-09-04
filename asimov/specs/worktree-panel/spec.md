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

The branch name SHALL be the form's first input, with no other control above it, and it SHALL hold initial focus. That input SHALL be a combobox over the repository's branches and an always-available create-new entry, and the choice between a new and an existing branch SHALL be made there and nowhere else — no separate branch-source control SHALL offer it. Submission SHALL stay unavailable until the value the chosen branch source requires is supplied and valid — the branch name for a new or existing branch, the base ref when detaching, which is the one case the lead input is not the value being validated. Keyboard traversal SHALL reach every entry in the branch list, including entries that cannot be selected, and the form SHALL retain its existing focus order, focus trap, and dismissal behaviour.

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

The panel SHALL let the user select one worktree, and SHALL treat selection as a deliberate act:
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

### Requirement: Each of an agent row's lines truncates on its own

Neither of an agent row's lines SHALL wrap, and each SHALL truncate independently with an
ellipsis. The preview SHALL consume none of the first line's width, and the age and the leading
glyphs SHALL NOT truncate at any width.

### Requirement: A list row does not name the model

No row in the panel's list SHALL display the agent's model identifier, and no placeholder SHALL
stand in for one that is unknown. The model is presented where there is room to present it, not
in the width the row's own last activity needs.

### Requirement: The control that swaps the body is separate from the one that groups a body

The panel SHALL present one control whose values are the two bodies it can show, and SHALL present
the control that chooses a grouping only while the sessions body is showing. Both values of the
body control SHALL be named on screen at every panel width, so it answers "which body am I in"
without a hover, a focus, or a widening.

#### Scenario: The grouping control is not offered where it would group nothing

- **WHEN** the Worktree body is showing
- **THEN** the grouping control is absent from the toolbar rather than present and inert, and the
  body control still names both of its values

#### Scenario: Returning to the sessions body

- **WHEN** the user switches from the Worktree body back to the sessions body
- **THEN** the grouping control is presented again, showing the grouping that was in effect before
  the user left — the choice is not reset by having been away

#### Scenario: No second presentation of the same controls remains

- **WHEN** the panel builds its toolbar
- **THEN** a single flat control naming all four values is not built under any configuration

### Requirement: A control that chooses among values says so and is reachable by keyboard

Neither the body control nor the grouping control SHALL be presented as a plain button that merely
looks selected. Each SHALL declare, to assistive technology, that it is one choice among a set and
which of its values is currently chosen, and each SHALL be operable from the keyboard alone.

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

### Requirement: A surface subscribes to presence for what it draws, not for the rail

A surface SHALL keep receiving presence for as long as anything it shows is drawn from presence,
and SHALL stop when nothing is. Whether the rail itself is shown SHALL NOT be able to end that
subscription on its own.

Where a surface is subscribed but is drawing no agent rows, the window SHALL NOT do per-row work
that only rows consume. Presence a subscriber can see SHALL be identical either way.

#### Scenario: A scope outlives the rail

- **WHEN** the rail is collapsed while a scope is set, and a pane that only presence knows to be
  waiting becomes hidden by that scope
- **THEN** the count on the escape control rises, exactly as it would with the rail open

#### Scenario: Nothing is left to draw for

- **WHEN** the last scope on a collapsed rail is cleared
- **THEN** the surface stops asking for presence

#### Scenario: The rail comes back

- **WHEN** the rail is reopened while its scope is still set
- **THEN** the rows are drawn with their titles and previews, without the user asking again

### Requirement: A selection in the narrow layout hands the room back

WHERE the panel is rendered in the stacked layout — the one used where two columns do not fit —
selecting a worktree SHALL collapse the rail to its header strip, so the selection reads as
"choose, then view".

The collapse SHALL be a consequence of the selection and of nothing else: no timer, no push, no
re-render, and no change of scope from any other source SHALL cause it.

#### Scenario: Choosing a worktree in the stacked layout

- **WHEN** the user selects a worktree while the panel is in the stacked layout
- **THEN** the rail collapses to its header strip and the selection takes effect

#### Scenario: Reopening after an automatic collapse

- **WHEN** the user reopens the rail the selection collapsed
- **THEN** it stays open through pushes, re-renders and scope changes, until the user selects
  another worktree

#### Scenario: The two-column layout keeps the rail

- **WHEN** the user selects a worktree while the rail and the terminal are shown side by side
- **THEN** the rail stays open — it is not taking the room the terminal needs

### Requirement: A collapse the user did not ask for is not their choice

A rail collapsed on the user's behalf SHALL be reversible by the same control that collapses it,
and reopening it SHALL leave it open until the user selects again. Such a collapse SHALL NOT be
recorded as the user's own preference, so the panel they open next is the one they last chose.

#### Scenario: The next session opens on what the user chose

- **WHEN** the user leaves the rail open, selects a worktree so it collapses, and returns later
- **THEN** the panel opens with the rail open

### Requirement: Scope does not depend on the layout

The tab-bar scope a selection drives SHALL be identical in every layout: the same panes are
hidden, the same escape control is offered, and the same count is carried on it, whether the rail
is shown beside the terminal, stacked above it, or collapsed to its header strip.

#### Scenario: The rail is collapsed while a scope is set

- **WHEN** the rail is collapsed and a scope is set
- **THEN** the scope is still named on screen and the control that clears it is still reachable

### Requirement: Selecting a worktree opens an inspector under the tree

Selecting a worktree SHALL open an inspector region **below** the tree rather than in place of it.
Selecting a different worktree SHALL replace that region's contents rather than adding a second
region.

#### Scenario: A second selection replaces the first

- **WHEN** the user selects one worktree and then another
- **THEN** exactly one inspector region is present, and it describes the second worktree

### Requirement: The inspector is bounded so the tree stays scannable

The inspector region SHALL be bounded to at most half the panel body and SHALL scroll within that
bound. The tree above it SHALL remain scrollable at any inspector content height, rather than
growing to its own content height and being clipped by the panel.

#### Scenario: The tree survives the selection

- **WHEN** the inspector is open on a worktree whose contents exceed the bound
- **THEN** the tree is still rendered above it and is still scrollable

### Requirement: The inspector states the full path and rows still state none

The inspector SHALL display the selected worktree's filesystem path in full. Opening it SHALL NOT
cause any list row to display a path.

#### Scenario: The path moves nowhere else

- **WHEN** the inspector is open on a worktree
- **THEN** its full path is readable in the inspector, and no row in the list displays a path

### Requirement: The inspector names the model that no row names

For each agent it presents, the inspector SHALL display that agent's model identifier when one is
known, and SHALL display nothing in its place when none is. No list row SHALL display a model
identifier whether or not the inspector is open.

#### Scenario: An agent whose model is unknown

- **WHEN** the inspector presents an agent for which no model was reported
- **THEN** no model identifier and no placeholder for one is displayed for that agent

### Requirement: A push that changes nothing changes no pixel of the inspector

While the inspector is open, a push SHALL leave the inspector's rendered nodes in place, and SHALL
NOT move focus that is inside it, unless it changed the selected worktree itself or an agent the
inspector presents. A change to another worktree, to repository-level information, or to the
health of the listing as a whole SHALL NOT rebuild it.

#### Scenario: A poll arrives while the user is in the inspector

- **WHEN** focus is on a control inside the open inspector and a push arrives that changed neither the selected worktree nor its agents
- **THEN** that same node still exists and still holds focus

### Requirement: The inspector keeps its own claims current without a push

Where a claim the inspector presents changes with the passage of time rather than with a push, the
inspector SHALL update that claim at the moment it changes, and SHALL agree with the tree's
rendering of the same claim at every moment.

#### Scenario: A running claim outlives its evidence while the inspector is open

- **WHEN** an agent the inspector presents crosses the confirmation ceiling with no push arriving
- **THEN** the inspector presents the same qualified state the tree presents for that agent

### Requirement: The inspector offers only actions it can perform on this worktree

An action that cannot be performed on the selected worktree SHALL be absent from the inspector
rather than present and inert, under the same conditions that withhold it from the context menu.
An action whose target is the repository rather than the worktree SHALL NOT be offered here.

#### Scenario: A worktree whose directory is gone

- **WHEN** the inspector is open on a worktree marked missing
- **THEN** the actions that require the directory to exist are absent, and copying its path is still offered

#### Scenario: The main worktree

- **WHEN** the inspector is open on the main worktree
- **THEN** no removal action is offered

### Requirement: An inspector action performs what its menu equivalent performs

Every action the inspector offers SHALL be resolved by the host from the worktree's identifier
rather than from a path the view supplied, and SHALL perform the same operation as the equivalent
context-menu item.

#### Scenario: A removal raised from the inspector

- **WHEN** the user raises the removal action from the inspector
- **THEN** the same confirmation of what would be destroyed is required as when it is raised from the context menu

### Requirement: The inspector carries the delegation history of each agent it presents

For each agent it presents, the inspector SHALL show that agent's delegation history without
requiring a further disclosure, and SHALL distinguish a history not yet read, one that could not
be read, one read as empty, one read as incomplete, and an agent with no session to read a history
from — never presenting any of them as an agent that delegated nothing.

An agent presented outside this window SHALL NOT be offered focus in the inspector.

#### Scenario: The history has not arrived yet

- **WHEN** the inspector opens on a worktree whose agent's delegations have not been read
- **THEN** that agent's section says the history is being read, rather than that there is none

#### Scenario: An agent with no session to read

- **WHEN** the inspector presents an agent whose session was never resolved
- **THEN** that agent's section says the history cannot be read, rather than waiting on a read that was never asked for

### Requirement: A history is requested once per session, and again if that session returns

A delegation history SHALL be requested at most once for a given agent row and session across
every surface that presents it, and SHALL be requestable again after that row has left and
returned.

#### Scenario: The same agent is presented twice at once

- **WHEN** an agent is presented in both the tree and the inspector and its history has not been read
- **THEN** exactly one request for that history is made

### Requirement: Dismissing the inspector leaves the selection and the scope alone

The inspector SHALL offer an explicit control that closes it, and SHALL close on the Escape key
while focus is within the panel body it occupies and no overlay above it is open. Closing it SHALL
NOT change which worktree is selected and SHALL NOT change the surface's tab-bar scope.

Activating the already-selected worktree again SHALL reopen a closed inspector. Clearing the
selection SHALL close it.

#### Scenario: Closing keeps the scope

- **WHEN** the user closes the inspector while a scope is held
- **THEN** the scope is unchanged and the worktree stays selected

#### Scenario: Reopening after a dismissal

- **WHEN** the user closes the inspector and then activates the same worktree row again
- **THEN** the inspector is open again on that worktree

#### Scenario: An overlay is open above it

- **WHEN** the user presses Escape with a session preview open over the panel
- **THEN** the preview closes and the inspector stays open

### Requirement: The inspector does not take focus and gives it back

Opening the inspector SHALL leave focus where it was, and every control and row it presents SHALL
be reachable by keyboard. Where focus is inside the inspector when it closes, focus SHALL return
to the row that opened it, or to the tree itself where that row is no longer rendered.

#### Scenario: Opening does not move focus

- **WHEN** the user selects a worktree row by keyboard
- **THEN** focus is still on that row after the inspector opens

#### Scenario: Closing from inside returns focus

- **WHEN** the user activates the inspector's close control
- **THEN** focus is on the worktree row the inspector was describing

### Requirement: A setting the panel no longer reads decides nothing

The panel SHALL present the workbench composition regardless of any
`anywhereTerminal.worktree.workbench` value a user's configuration still holds, and SHALL NOT read
that value.

#### Scenario: A configuration that still turns the rollout off

- **WHEN** the user's settings hold `anywhereTerminal.worktree.workbench` set to `false` and the
  panel opens
- **THEN** the panel presents the workbench composition, and a worktree can be selected

#### Scenario: A configuration that never mentioned it

- **WHEN** the user has never configured the setting and the panel opens
- **THEN** the panel presents the workbench composition

### Requirement: A row draws its preview only when it adds something

An agent row SHALL withhold its preview — from its second line and from any hover text repeating it
— WHEN that preview is blank, or equals the row's title after the decoration the title's own
presentation removes is taken off **the title alone**.

Every other preview SHALL be drawn verbatim, however slightly it differs, and no similarity, prefix,
or truncated comparison SHALL suppress one.

#### Scenario: A session whose only message is its title

- **WHEN** a row's title and its preview are the same sentence
- **THEN** the row renders as one line, and its hover text names that sentence once

#### Scenario: A session that gains a second message

- **WHEN** a row whose preview was withheld for repeating its title reports different activity
- **THEN** the row draws its preview line again

#### Scenario: A preview that differs from the title only slightly

- **WHEN** a row's preview and title differ by a single trailing word
- **THEN** the preview is drawn in full

#### Scenario: A preview whose marker the title's stripper would eat

- **WHEN** a row's preview is a lone `*` or `- ` marker, or opens with one, and its title is that
  same text without the marker
- **THEN** the preview is drawn in full, because only the title was normalized

### Requirement: A create says which kind of branch it wants

The create form SHALL state, as part of the request, which of its branch choices the user made,
and the host SHALL NOT infer that choice from which optional fields happen to be filled in.

A create on a new branch SHALL succeed whether or not the user supplied a base ref; where none was
supplied the new branch SHALL start from the repository's current `HEAD`. A create on an existing
branch SHALL check that branch out and SHALL NOT attempt to create it.

#### Scenario: A new branch with no base ref

- **WHEN** the user chooses the new-branch mode, names a branch that does not exist, and leaves the
  base ref empty
- **THEN** the worktree is created on that new branch, started from `HEAD`, and the panel reports a
  successful create

#### Scenario: An existing branch is checked out, not recreated

- **WHEN** the user chooses the existing-branch mode and names a branch that already exists
- **THEN** the worktree is created with that branch checked out, and the create does not fail on the
  branch already existing

### Requirement: A removal refuses when it cannot establish that nothing is using the worktree

WHEN an agent session rooted in the worktree reports activity of running or waiting, or its activity cannot be determined — in this window or in the session registry — the removal SHALL be refused and no confirmation control SHALL be offered. A typed confirmation SHALL NOT authorize such a removal. An agent session that is provably idle SHALL be reported as a confirmable risk rather than a refusal.

#### Scenario: A registry session whose activity cannot be read

- **WHEN** the session registry names a session rooted in the worktree and its activity cannot be determined
- **THEN** the removal is refused and no confirmation is offered

#### Scenario: The registry itself cannot be read

- **WHEN** the session registry cannot be read at all
- **THEN** the agent checks are reported as unproven rather than passed, and the removal is not offered as unconditionally safe

### Requirement: A removal reports the ignored material it will delete

The removal assessment SHALL report ignored content in the worktree as a confirmable risk, with the number of entries and their total size. The measurement SHALL be bounded by a maximum entry count and a maximum elapsed time, and WHEN either bound is reached, or the content cannot be read, the check SHALL be reported as unproven rather than reporting a partial measurement as a total. An unproven ignored-material check SHALL remain confirmable and SHALL NOT refuse the removal.

#### Scenario: Ignored content exceeds the measurement budget

- **WHEN** the ignored content in the worktree exceeds the entry or time bound
- **THEN** the check is reported as unproven and the removal remains offered with a confirmation

### Requirement: Material this extension provisioned is named only from a record of provisioning it

WHEN a readable record of what the worktree was provisioned with is present, the assessment SHALL report the provisioned material separately from the undifferentiated ignored total. WHEN that record is absent, unreadable, or of an unrecognized version, the assessment SHALL report the undifferentiated total and SHALL state that provisioned material was not distinguished. The assessment SHALL NOT infer that a file was provisioned from its name or location.

### Requirement: A check that did not apply is distinguishable from one that passed

Every check the removal assessment reports SHALL carry an outcome that distinguishes passing, failing, being unproven, and not applying. A check whose question does not arise for this worktree SHALL be reported as not applicable, and SHALL NOT be reported as passed.

### Requirement: A confirmation authorizes only the risks it was shown

Before performing a removal the system SHALL re-evaluate the checks. WHEN a check that was not failing at the time of confirmation is failing at execution time, the removal SHALL NOT proceed and a fresh confirmation SHALL be requested. A check that was already failing when the user confirmed SHALL NOT cause a fresh confirmation to be requested. WHEN re-evaluation establishes a refusal, the removal SHALL be refused rather than re-confirmed.

#### Scenario: A live agent appears after the user confirmed dirty files

- **WHEN** the user confirms a removal reporting uncommitted changes, and an agent session becomes active before the removal runs
- **THEN** the removal does not proceed and is refused

### Requirement: The removal assessment reports whether the worktree looks abandoned

The removal assessment SHALL report three orphan proofs — that the worktree's lock is older than a recorded threshold, that no process is recorded as owning it, and that its branch is merged — each carrying its own outcome from the same four-outcome vocabulary as every other check. Each proof SHALL be answered from a named existing source and SHALL NOT be inferred from any other proof's answer.

#### Scenario: A worktree that is not locked

- **WHEN** the assessment runs against a worktree git does not report as locked
- **THEN** the lock-age proof is reported as not applicable rather than as passed or failed

### Requirement: A proof never blocks the removal it accompanies

A proof SHALL NOT refuse a removal, SHALL NOT cause a typed confirmation to be required, and SHALL NOT cause a previously granted confirmation to be re-requested. WHEN a proof cannot be evaluated it SHALL be reported as unproven, and the removal SHALL remain exactly as available as it was without the proof.

#### Scenario: Every proof is unproven

- **WHEN** none of the three proofs can be evaluated and no confirmable risk is present
- **THEN** the removal is still offered without a typed confirmation

#### Scenario: A proof degrades between confirmation and execution

- **WHEN** the user confirms a removal and a proof that was passing is unproven at execution time
- **THEN** the removal proceeds on the confirmation already given, and only the option that proof gated is withdrawn

### Requirement: The merge proof reads local refs and never fetches

The merge proof SHALL be answered by comparing the worktree's branch against a default branch resolved from local references only. The system SHALL NOT contact a remote to answer it. WHEN the default branch cannot be resolved, or the comparison cannot be made, the proof SHALL be reported as unproven rather than as not merged. WHEN the worktree has no branch, the proof SHALL be reported as not applicable.

#### Scenario: A branch that is not an ancestor of the default branch

- **WHEN** the worktree's branch contains commits the resolved default branch does not
- **THEN** the merge proof is reported as failed rather than unproven

#### Scenario: The repository has no resolvable default branch

- **WHEN** no local reference identifies a default branch
- **THEN** the merge proof is reported as unproven and no removal behavior changes

### Requirement: The ownership proof distinguishes no record from a dead record

The ownership proof SHALL be answered from the session registry read in a way that preserves records whose process is gone. A registry that names no record for the worktree SHALL be reported as the proof passing; a registry that names a record whose process is gone SHALL also be reported as passing; a registry that names a record whose process is alive SHALL be reported as failing; and a registry that cannot be read SHALL be reported as unproven rather than as either.

#### Scenario: A crashed session left a record behind

- **WHEN** the registry holds a record rooted in the worktree whose process no longer exists
- **THEN** the ownership proof passes, and the record is not reported as a live agent

### Requirement: The create dialog offers branches and a create-new entry in one list

The create dialog SHALL present the repository's existing local branches and an always-available
"create new branch" entry in a single list attached to the lead input, with no tab bar and no
separate control for choosing between an existing branch and a new one.

### Requirement: The branch list is ordered by what the typed text most likely means

The list SHALL place a branch whose name exactly equals the typed text first, then branches whose
names begin with that text, then the create-new entry. With no text typed, every offered branch
SHALL be listed and the create-new entry SHALL remain present.

### Requirement: A branch can be created when the list is unavailable or incomplete

The create-new entry SHALL remain selectable when the branch list is unavailable, empty, or
incomplete, so a repository whose branches could not be enumerated can still be used to create a
worktree.

#### Scenario: A name that is not in the list is still creatable

- **WHEN** the user types a branch name that matches no offered branch
- **THEN** the create-new entry is the selectable result, and submission is permitted once the name
  validates

### Requirement: A branch another worktree holds is offered but not selectable

WHERE a local branch is checked out in another worktree of the same repository, the create dialog
SHALL offer that branch as a visible, non-selectable entry, and SHALL refuse to submit a create
naming that branch.

#### Scenario: The held branch cannot be submitted by any route

- **WHEN** a create is submitted naming a branch that another worktree holds
- **THEN** no worktree-create request is issued

### Requirement: A held branch names the directory holding it

A non-selectable branch entry SHALL be annotated with the name of the directory that holds it, and
that annotation SHALL name the directory only, never a full filesystem path.

### Requirement: An entry that cannot be selected stays reachable

An entry that cannot be selected SHALL remain reachable by keyboard and announced by assistive
technology rather than hidden, so the reason the branch is unavailable is available to the user.

### Requirement: An incomplete branch list is stated as incomplete

WHERE the offered branches are limited because the repository holds more than the dialog
enumerates, the create dialog SHALL state that the list is partial rather than presenting it as the
repository's complete set.

### Requirement: Escape closes the branch list before it dismisses the dialog

WHILE the branch list is open, the Escape key SHALL close the list and SHALL NOT dismiss the
dialog. WHILE the branch list is closed, the Escape key SHALL dismiss the dialog.

#### Scenario: Escape closes the list before it closes the dialog

- **WHEN** the branch list is open and the user presses Escape
- **THEN** the list closes and the dialog remains open
- **WHEN** the user presses Escape again
- **THEN** the dialog is dismissed

### Requirement: A selection resolves to what the create would actually do, before submit

The create dialog SHALL resolve the typed selection against the repository before submission, and
SHALL state which of create-a-new-branch, check-out-an-existing-branch, or repair-a-stale-
registration the create would perform. A state git can distinguish SHALL NOT be reported to the user
only as a failure after the create was attempted.

#### Scenario: An existing branch is reused rather than duplicated

- **WHEN** the user selects a branch that already exists and no worktree holds it
- **THEN** the create checks that branch out into the new worktree, and does not create a
  near-duplicate branch under a suffixed name

### Requirement: The whole selection is resolved, in every mode

The selection is the branch or ref named, the base the create would start from, and any destination
the user supplied. A create SHALL NOT be offered until the resolution answering that exact selection
has arrived, in every mode the dialog offers, a detached create included.

#### Scenario: A create is not offered against an unresolved selection

- **WHEN** any part of the selection changes and the resolution for it has not arrived
- **THEN** the create is not offered, in every mode including a detached create

### Requirement: The resolution names both the path the create will take and the one it skipped

The resolution SHALL state the free path the create would use, and WHERE the derived candidate was
occupied and a suffix was applied, SHALL also state the skipped candidate and whether what occupies
it is a worktree or a directory that is not one.

#### Scenario: An occupied candidate is reported alongside the free path

- **WHEN** the derived destination is occupied and the create resolves to a suffixed path
- **THEN** the resolution names the suffixed path it will use and the occupied path it skipped, with
  what was found there

### Requirement: A supplied destination is a candidate the resolution answers, not the path submitted

WHERE the user supplies a destination, what the form states and the create submits SHALL be the path
the resolution names for it. A supplied destination that is occupied, or that the create root does
not contain, SHALL NOT be stated as the destination nor submitted as one.

#### Scenario: A supplied destination that is occupied is not the one submitted

- **WHEN** the user supplies a destination that is already occupied
- **THEN** the form states the path the resolution named instead, and the create submits that path

### Requirement: A mode that fixes its own target refuses the destination control

WHERE the resolved mode acts on a directory of its own — a repair acts on the registration's, an
adoption on the surviving checkout's — the destination control SHALL be refused with its reason
rather than accepted and ignored, on the same rule the base ref already follows.

#### Scenario: A repair keeps the directory it is repairing

- **WHEN** the selection resolves to a repair and the user had supplied a destination
- **THEN** the destination control is refused with its reason, and the form states and submits the
  directory being repaired

#### Scenario: An adoption keeps the directory it is adopting

- **WHEN** the selection resolves to an adoption and the user had supplied a destination
- **THEN** the destination control is refused with its reason, and the form states and submits the
  directory being adopted

### Requirement: Reporting an occupied destination does not authorize removing it

A resolution SHALL NOT carry authorization to delete anything it reports. Removing what occupies a
destination SHALL require an explicit, separately confirmed authorization.

### Requirement: A stale registration is repaired in place, and only while git can repair it

WHERE git reports a worktree as prunable, its branch is the selected one, its directory holds a git
link naming an administrative directory that still exists, and that directory's HEAD matches the
branch's current commit, the create SHALL repair the registration in place rather than creating a
new worktree. WHERE any of those does not hold, repair SHALL NOT be offered.

#### Scenario: A registration whose administrative entry is gone is not offered as a repair

- **WHEN** the surviving directory's git link names an administrative directory that no longer
  exists
- **THEN** repair is not offered, and the surviving directory is neither deleted nor overwritten

#### Scenario: A repair does not rewrite the working tree

- **WHEN** a stale registration is repaired
- **THEN** the files in the worktree directory are unchanged

#### Scenario: A checkout that moved after the resolution is not repaired

- **WHEN** the directory's HEAD no longer matches the commit recorded when the selection resolved
- **THEN** the repair is refused rather than applied against the changed checkout

### Requirement: The base ref is refused where the mode cannot apply it

WHERE the resolved mode takes its starting point from something that already exists — an existing
branch, a stale registration being repaired, or a surviving checkout being adopted — the base ref
SHALL be unavailable with a stated reason rather than accepted and ignored. WHERE the mode creates a
new branch, the base ref SHALL be validated before submission and SHALL be reported as unresolvable
before the create is attempted.

#### Scenario: Base is refused, not silently dropped

- **WHEN** the selection resolves to reusing an existing branch
- **THEN** the base ref control is unavailable and states why

#### Scenario: An adoption refuses the base ref

- **WHEN** the selection resolves to adopting a surviving checkout
- **THEN** the base ref control is unavailable and states why

#### Scenario: An occupied destination does not disable the base ref

- **WHEN** the destination is occupied and the branch mode creates a new branch
- **THEN** the base ref remains available, because clearing the ground does not change where the new
  branch starts

### Requirement: A resolution belonging to a previous opening of the dialog is discarded

WHERE the create dialog is closed and opened again, a resolution answering the earlier opening SHALL
NOT be applied to the later one, even when both name the same repository and the same query.

### Requirement: A destination holding debris is offered as recover, not silently avoided

Where a create destination holds a directory that is not a git checkout, the panel SHALL report that
destination as debris and offer to clear it, naming the directory and what it holds. The offer SHALL
compose with any branch mode, so clearing debris and reusing an existing branch is expressible.
A destination holding a `.git` file or directory SHALL NOT be reported as debris.

#### Scenario: A non-git directory is offered rather than suffixed away

- **WHEN** the derived destination holds a directory with no `.git` entry
- **THEN** that destination is offered as recover, stating the path and what will be removed, instead
  of the create silently moving to a suffixed path

#### Scenario: A surviving checkout is not debris

- **WHEN** the derived destination holds a directory containing a `.git` file or directory
- **THEN** the destination is not offered as recover

### Requirement: Clearing debris happens only under an authorization bound to what was found

The panel SHALL NOT remove a debris directory unless the request carries a host-issued authorization
for that path whose evidence still covers what is present when the removal runs; otherwise the
removal SHALL be refused and the user re-prompted with the current contents. The panel SHALL refuse
the removal where any component of the path is a symbolic link, and SHALL refuse it where the
directory's identity differs from the identity recorded when the authorization was issued.

#### Scenario: An authorization does not cover content that appeared after it was issued

- **WHEN** the debris directory holds an entry that was not present when the authorization was issued
- **THEN** the removal is refused and the user is re-prompted, and no entry is removed

#### Scenario: The directory was replaced between authorization and removal

- **WHEN** the path resolves to a directory whose device and inode differ from those recorded at
  authorization
- **THEN** the removal is refused and nothing at that path is removed

### Requirement: A create never reports success for a clearance that did not complete

Where clearing a debris destination does not remove everything it named, the panel SHALL report what
remains and SHALL NOT report the create as successful. A create against a destination that is not
debris SHALL remove nothing.

#### Scenario: A partial clearance is reported as a failure

- **WHEN** removing the debris directory leaves entries behind
- **THEN** the outcome names what remains and the create is not reported as successful

#### Scenario: An ordinary create deletes nothing

- **WHEN** a create runs against a free destination
- **THEN** no filesystem entry is removed

### Requirement: An authorization to clear is issued only when it is asked for

The panel SHALL issue an authorization to clear a destination only in answer to a request naming that
destination, and SHALL NOT include one in the answer it gives while a destination is being resolved.
Where the named destination is not debris, or cannot be read, the panel SHALL answer with a refusal
stating which, and SHALL NOT issue an authorization.

#### Scenario: Resolving a destination mints no authorization

- **WHEN** a destination is resolved and reported as debris
- **THEN** the answer carries no authorization, and nothing at that path can be removed until one is
  requested

#### Scenario: A destination that is not debris is refused an authorization

- **WHEN** an authorization is requested for a destination holding a `.git` entry
- **THEN** the answer is a refusal naming that reason, and no authorization is issued

### Requirement: Pull requests are offered in the branch list, never in a second tab

The panel SHALL offer the repository's open pull requests as rows in the same list that offers local
refs and the create-new row, ordered after prefix matches and before create-new. The panel SHALL NOT
add a tab, a mode switch, or a second input to reach them.

#### Scenario: A PR is reachable without leaving the branch list

- **WHEN** the user types text matching an open pull request's number or title
- **THEN** that pull request appears as a row in the same list as the refs, below the ref matches and
  above the create-new row

#### Scenario: The list still ends with create-new

- **WHEN** pull requests are present in the list
- **THEN** the create-new row is still the last row and is still selectable

### Requirement: A pull request resolves to a deterministic branch and its base

Selecting a pull request SHALL resolve to the branch name `pr/<number>` and to the pull request's own
base ref. Selecting the same pull request a second time, once that branch exists, SHALL resolve as a
reuse of the existing branch rather than creating a second worktree.

#### Scenario: The same PR twice is a reuse

- **WHEN** a pull request whose `pr/<number>` branch already exists is selected
- **THEN** the create resolves as a reuse of that branch, not as a new branch and not as a second
  worktree

#### Scenario: The base comes from the pull request

- **WHEN** a pull request is selected
- **THEN** the base the create would use is the pull request's own base ref, not the repository's
  default branch chosen independently

### Requirement: A fork head states the remote before the action is authorized

Where a pull request's head branch lives on a fork rather than on the repository itself, the panel
SHALL state the remote that will be configured, and SHALL state it before the create is authorized
rather than reporting it afterwards.

#### Scenario: A fork PR names its remote up front

- **WHEN** the selected pull request's head is on a fork
- **THEN** the form states the remote that will be configured, and states it while the create can
  still be abandoned

### Requirement: An unavailable forge costs discovery, never the ability to create

Where the forge is unauthenticated, unreachable, or its client is not installed, the panel SHALL show
one quiet row saying so and SHALL leave local ref search, the create-new row, and the create itself
fully working. A slow pull-request lookup SHALL NOT delay the local ref list.

#### Scenario: An unauthenticated forge does not disable branch search

- **WHEN** the forge cannot be queried because no credential is available
- **THEN** one row states that pull requests are unavailable, and every local ref and the create-new
  row remain offered and selectable

#### Scenario: A slow forge does not hold up the refs

- **WHEN** the pull-request lookup has not yet answered
- **THEN** the local refs are already listed and selectable, and the pull-request rows arrive when
  the lookup lands

#### Scenario: A missing client is not an error the user must clear

- **WHEN** the forge client is not installed on the machine
- **THEN** the same single quiet row is shown and no error dialog, notification, or blocking state is
  produced

### Requirement: A create form's opening identity travels on every request and every reply

The create form SHALL carry an opening identity minted by the panel, sent on every request that
belongs to that opening, and echoed by the extension on every reply to one. The panel SHALL drop a
reply whose identity is not the live opening's, rather than caching or rendering it.

#### Scenario: A predecessor's answer reaches a form that has already been replaced

- **WHEN** a create form is reopened while the previous form's provisioning read is still in flight
- **THEN** nothing from that predecessor is rendered or cached, whether the read succeeds or fails

#### Scenario: A destination answer for a superseded opening is not applied

- **WHEN** a `worktreeCreateDefaults` reply arrives naming an opening that is no longer live
- **THEN** the form neither seeds nor updates from it

### Requirement: Closing a create form retires its opening

The panel SHALL tell the extension when a create form closes, whether it was cancelled or submitted.
The extension SHALL treat a retired opening as holding nothing: a result arriving for one SHALL mint
no authority, publish nothing, and leave no state behind.

#### Scenario: A cancelled form's read lands after the cancel

- **WHEN** a create form is cancelled while its provisioning read is still running
- **THEN** the read publishes no offer and leaves nothing the extension would later honour

#### Scenario: A submitted form does not keep an open conversation

- **WHEN** a create form is submitted
- **THEN** its opening is retired, and a later reply naming it changes nothing

### Requirement: A repeated request for one opening never starts a second read

Where the extension receives more than one opening request naming the same live opening, it SHALL
join or ignore the repeat rather than begin another read. A repeat SHALL NOT retire, supersede, or
suppress the answer the live opening is already owed.

#### Scenario: A duplicated opening request still yields the legitimate answer

- **WHEN** the same opening request is delivered twice
- **THEN** exactly one read runs and the form still receives its answer

#### Scenario: A request naming an opening the extension does not hold

- **WHEN** a request names an opening that was never live or has been retired
- **THEN** the extension answers nothing

### Requirement: The create form states what the new worktree will lack

The create form SHALL list configured provisioning material or fallback initialization suggestions.
WHERE neither exists, it SHALL state that no configured items or supported repository-root
suggestions were found, rather than presenting an empty list or claiming that an uninspected file is
absent.

### Requirement: A linked row says where its writes land

A row whose material is linked rather than copied SHALL state that writing through it changes the
main checkout. That statement SHALL NOT be suppressible by any setting or user action.

#### Scenario: A linked row is shown

- **WHEN** the section shows a row whose material is linked rather than copied
- **THEN** the row states that writing through it changes the main checkout, and no setting removes
  that statement

### Requirement: A provisioning file that cannot be read does not block a create

Where a provider file is present but cannot be read or understood, the form SHALL name that file in
the section and SHALL remain submittable.

#### Scenario: A provisioning file that is malformed

- **WHEN** the repository's provisioning file is present but malformed
- **THEN** the section names that file as a problem, and the create action remains available

### Requirement: An assessment the user moved on from does not delay what they do next

WHERE the user asks about removing several worktrees in succession, asks repeatedly, or asks from
more than one panel, the assessments they have moved on from SHALL NOT accumulate. An action the user
then takes on the same repository — a removal, a lock, an unlock, a prune or a create — SHALL wait
behind at most one assessment, whatever the number or pattern of requests and however many panels
have been opened or closed.

#### Scenario: The user asks about several worktrees before deciding

- **WHEN** the user asks to remove one worktree, then another, then the first again, and then confirms a removal
- **THEN** the confirmed removal waits behind at most one assessment, not behind the ones that were superseded

#### Scenario: Panels are opened and closed while asking

- **WHEN** a panel is opened, asks about a removal, and is closed, repeatedly
- **THEN** a removal asked for afterwards still waits behind at most one assessment

#### Scenario: Two panels ask at once

- **WHEN** two panels each ask about removing a worktree in the same repository
- **THEN** each panel is answered in turn, and neither is starved by the other continuing to ask

### Requirement: Asking to remove again always asks again

WHEN the user asks to remove a worktree, the panel SHALL put the question rather than suppress it,
whatever earlier assessment of that worktree is outstanding and whatever became of its answer. The
panel SHALL NOT reach a state in which asking to remove a worktree does nothing.

#### Scenario: The answer to the first request never arrives

- **WHEN** the reply to an assessment is lost before it reaches the panel
- **THEN** asking to remove that worktree again produces a report rather than nothing

#### Scenario: The same worktree is asked about twice

- **WHEN** the user asks to remove the same worktree twice in succession
- **THEN** exactly one report is shown, and it is the answer to the later request

### Requirement: A repository is read through whichever provisioning file it already keeps

WHERE a repository declares what a new worktree needs in a file it already maintains for another
tool, the create form SHALL populate its bring-over section from that file, with each row naming
the file it came from. Beyond the file this extension defines for itself, the files read SHALL
include the orca configuration pair and the VS Code task file.

#### Scenario: A repository whose only configuration is orca's

- **WHEN** the create form opens for a repository carrying an orca configuration that names shared
  directories, an include list, and a setup script
- **THEN** the shared directories are offered as links, the included paths as copies, and the setup
  script as one step with its lines intact, every row naming the file it came from

#### Scenario: A repository whose only configuration is a task

- **WHEN** the create form opens for a repository whose task file declares a task to be run when a
  worktree is created
- **THEN** that task's command is offered as a setup step, and tasks not so declared are not

### Requirement: A source is reported as it reads, not as it would resolve

A row SHALL carry the mode the source itself gives the path — shared means link, included means
copy. A source naming material that does not exist SHALL still be offered, with what the material
turns out to be reported when it is applied. Keys a source uses for purposes other than
provisioning SHALL be ignored without the repository being reported as misconfigured.

#### Scenario: A shared directory that is not there

- **WHEN** a source names a shared directory the repository does not currently contain
- **THEN** the row is offered as a link, and no problem is reported against the file

### Requirement: A task file is read on the terms its own format defines

WHERE the VS Code task file is read, comments and trailing commas SHALL parse rather than be
reported as malformed, because the format the file is written in permits both. A declared command
containing an unresolved placeholder SHALL be offered with the repository reported as carrying that
problem, naming the task, rather than being completed with a value the extension chose.

#### Scenario: A task file written with comments

- **WHEN** the task file contains line comments, block comments and a trailing comma
- **THEN** its tasks are offered, and no problem is reported against the file

### Requirement: Exactly one detected source supplies the offer

WHEN more than one provisioning source is detected, the create form SHALL populate its section from
exactly one of them, chosen by a fixed order that does not depend on filesystem enumeration or
timing, EXCEPT where the repository's own configuration names a source to build on. No row from a
source that was neither chosen nor named SHALL appear among the offered entries.

#### Scenario: Two sources in one repository

- **WHEN** a repository carries both of two detected provisioning sources and names neither
- **THEN** the section shows the rows of exactly one of them, and none of the other's

#### Scenario: The repository names the source to build on

- **WHEN** the repository's own configuration names one of two other detected sources to build on
- **THEN** the section shows the named source's rows together with the repository's own, and none
  from the third

### Requirement: A present source answers, even when its answer is nothing

A source SHALL count as detected when any file it reads is present, whatever that file then yields.
A present source declaring nothing SHALL supply the offer as an empty section, and one that cannot
be read SHALL supply it as the problem it is; neither SHALL be passed over for a later source.

#### Scenario: The first source declares nothing

- **WHEN** a repository carries a first-order source whose file declares nothing, and a later source
  that declares rows
- **THEN** the section is empty, the later source appears as a row offering to switch, and none of
  its rows are offered until that is taken

### Requirement: A source that did not supply the offer stays visible and selectable

Each detected source that did not supply the offer SHALL appear as a single row naming the files it
reads and
offering to populate the section from it instead. WHEN the user takes that offer, the section SHALL
be populated from the chosen source alone, nothing SHALL be submitted or created, and the source it
replaced SHALL itself become one of the rows offering to switch.

#### Scenario: Switching to the other source

- **WHEN** the user takes the offer to populate the section from the other source
- **THEN** the section shows that source's rows, nothing is submitted, and the previously shown
  source becomes the row offering to switch back

### Requirement: The material a worktree was promised is actually put there

WHEN a worktree is created with provisioning entries the user left selected, the extension SHALL
materialize each one it does not refuse into the new worktree — copying by default, linking where
the entry says link — and SHALL report the outcome of every entry it was given, refusals included.
Copying SHALL happen before linking, EXCEPT where declarations may name one destination, which the
two requirements above settle.

#### Scenario: The files the dialog listed are in the new worktree

- **WHEN** a create carries selected copy entries, none of which may name another's destination
- **THEN** each of those files exists in the new worktree, and each is reported as copied

#### Scenario: Only what was selected is materialized

- **WHEN** the user unticks an entry before creating
- **THEN** that entry is not written into the new worktree and is not reported as a step that ran

#### Scenario: The report arrives after the create's own result

- **WHEN** provisioning entries are applied
- **THEN** the create's success is reported first, and the per-entry outcomes follow it

### Requirement: Provisioning never costs the user the worktree

WHERE an entry cannot be materialized for any reason, the extension SHALL leave the new worktree and
every entry already materialized in place, and SHALL report that entry as failed with its reason.
A failed entry SHALL NOT fail the create, undo the create, or stop the user from using the worktree.

#### Scenario: One entry fails

- **WHEN** one of several entries cannot be written
- **THEN** the create is still reported as succeeded, the earlier entries remain, and the failed entry is named with its reason

#### Scenario: Every entry fails

- **WHEN** no entry can be materialized at all
- **THEN** the worktree still exists and is still usable

### Requirement: An entry that would write outside the new worktree is refused, not adjusted

WHERE a provisioning entry resolves outside the repository it was declared in, or outside the
worktree being created — whether by `..`, by an absolute path, or through a symlinked component —
the extension SHALL refuse that entry and report it, and SHALL NOT rewrite, trim, or otherwise
adjust it into a path that is inside.

#### Scenario: An entry climbs out with ..

- **WHEN** an entry's path resolves above the repository root
- **THEN** it is refused and reported, and nothing is written for it

#### Scenario: A symlinked component leads out of the repository

- **WHEN** a component of an entry's source resolves, through a symlink, to a location outside the repository
- **THEN** it is refused and reported rather than followed

#### Scenario: A symlink inside the repository is kept as a symlink

- **WHEN** a copied directory contains a symlink that resolves inside the repository
- **THEN** the copy contains a symlink, not a dereferenced copy of what it pointed at

### Requirement: Materializing never replaces anything that is already there

WHERE a destination already exists, the extension SHALL skip it and report it as skipped. This SHALL
hold for every file inside a copied directory, not only for the directory's own name.

#### Scenario: The destination file already exists

- **WHEN** an entry's destination already exists in the new worktree
- **THEN** it is left untouched and the entry is reported as skipped

#### Scenario: A file inside an existing destination directory already exists

- **WHEN** a directory entry is copied into a destination directory that already exists and already contains one of the files being copied
- **THEN** that file is left untouched and reported, and the files that did not already exist are still copied

### Requirement: Some material is refused however a repository asks for it

The extension SHALL refuse to copy or link a lockfile, and SHALL refuse to link `node_modules`,
however a repository asked for it, and SHALL report each refusal with the reason it was refused
rather than silently omitting the entry.

#### Scenario: A lockfile is asked for

- **WHEN** a lockfile is asked for, by copy or by link
- **THEN** the entry is reported as refused, naming that a worktree's own lockfile is the authoritative one

#### Scenario: node_modules is asked for as a link

- **WHEN** `node_modules` is asked for as a link
- **THEN** the entry is reported as refused, naming why a shared `node_modules` is not supported

### Requirement: A link the platform cannot make becomes a copy that says so

WHERE the platform cannot create a symlink, the extension SHALL copy the entry instead and SHALL
report that entry as having degraded to a copy, rather than failing it or reporting a link it did
not make.

#### Scenario: Symlinks are unavailable

- **WHEN** a link entry is applied on a platform that refuses the symlink
- **THEN** the entry's content is copied and the entry is reported as a copy that was asked to be a link

### Requirement: Selected post-create writes retain observed checkout identity

After Git creates a worktree, the extension SHALL freeze the first stable filesystem identities it observes for the source and destination of selected provisioning work.

- Stable identity unavailable → Git create remains successful and the affected selected work fails.
- Identity change observed before a selected write begins → that work fails and no write begins through the observed replacement.

### Requirement: Sibling claim reads sample stable listing-time identity

A sibling claim SHALL contribute to port allocation only when the sibling's listing-time identity matches immediately before and after its claim read.

- Stable identity unavailable or mismatched → fresh allocation fails rather than using an incomplete claimed set.
- A normalized listing row that identifies the new worktree SHALL be excluded from its sibling set by filesystem identity.

### Requirement: A dirty port-write timeout retains serialization

WHEN a port-claim deadline expires while lock acquisition or a protected mutation may still land, the selected uncommitted ports SHALL fail, the cross-process lock SHALL remain or become held, and the panel SHALL warn that cleanup is required.

### Requirement: A clean port-write timeout releases serialization

WHEN a port-claim deadline expires with no protected mutation in flight, the selected uncommitted ports SHALL fail and the cross-process lock SHALL be released.

### Requirement: An expired port write starts no later publication

After a port-claim deadline expires, the extension SHALL NOT begin another claim publication in that transaction. Inode-owned temporary and lock cleanup MAY still complete afterward when they cannot alter the committed target or release a successor.

### Requirement: Successful work remains successful when cleanup is late

WHERE a port claim committed before inode-owned temporary cleanup or lock release exceeded its bound, the committed outcome SHALL remain successful and the panel SHALL identify the incomplete cleanup.

### Requirement: A named port carries a numeric preview

The create form SHALL present each offered port as its configured name and a numeric preview, while keeping the file that declared it as the row's source. The preview SHALL be presented as provisional rather than as a reservation. WHEN a preview cannot be obtained, the row SHALL keep the configured name and state that no preview is available rather than inventing a number.

### Requirement: Successful port claims do not collide across sibling worktrees

A port value the extension successfully writes for one worktree SHALL differ from every port value already claimed by a sibling worktree of the same repository. Two creates the extension performs concurrently for one repository SHALL NOT successfully claim the same value.

#### Scenario: Two windows create worktrees together

- **WHEN** two extension windows create worktrees for the same repository at the same time and both allocate a port
- **THEN** each successful claim has a different value

### Requirement: The port claim file has one strict format

A valid `.env.worktree` SHALL contain only blank lines, comment lines, and assignments whose names match `[A-Za-z_][A-Za-z0-9_]*` and whose decimal values are from 1 through 65535. Repeating a name or a numeric value SHALL make the file invalid.

### Requirement: Port names are safe environment identifiers

A configured port name SHALL be written only when it matches `[A-Za-z_][A-Za-z0-9_]*`. A name outside that grammar SHALL be reported as failed without preventing valid names from being allocated.

### Requirement: Existing non-conflicting assignments are reused

WHERE the new checkout already carries a valid `.env.worktree`, the extension SHALL reuse each selected assignment whose value no sibling claims. Missing selected names whose allocation succeeds SHALL be appended without changing any existing assignment.

#### Scenario: The file already covers every selected name

- **WHEN** `.env.worktree` contains one valid, non-conflicting assignment for every selected configured name
- **THEN** those values are reused and no fresh value is allocated or written

### Requirement: A conflicting existing assignment is retained but not adopted

WHERE a sibling already claims a value in the new checkout's `.env.worktree`, the extension SHALL leave the assignment unchanged and report that configured name as failed.

#### Scenario: An existing value conflicts with a sibling

- **WHEN** `.env.worktree` and a sibling worktree both assign the same value
- **THEN** the existing assignment is left unchanged and that configured name is reported as failed

### Requirement: An unsupported existing claim file is left untouched

WHEN the new checkout's `.env.worktree` cannot be read, is not a regular file, or is invalid under the claim-file format, the extension SHALL write nothing to it and SHALL report every selected name as failed.

### Requirement: One configured name gets one claim

WHERE more than one selected row carries the same configured name, the extension SHALL allocate or reuse one value for that name, write at most one assignment, and report the same outcome against each selected row.

### Requirement: Unproven sibling claims prevent fresh allocation

WHEN the sibling listing is incomplete, or a registered sibling's present claim file cannot be read as valid port assignments, the extension SHALL fail fresh allocations rather than choose from an incomplete claimed set. The successful worktree create SHALL remain standing.

### Requirement: Every selected port gets its own outcome

After a create, the panel SHALL report the outcome of every selected port name. A name whose allocation fails SHALL NOT prevent another name from succeeding, and no port outcome SHALL change whether the worktree create is reported as successful.

### Requirement: A changed preview is reported by variable

WHERE the authoritative allocated or reused value for a configured name differs from the value previewed in the create form, the result on the created worktree SHALL name that variable, the authoritative value, and the preview it replaced. Names whose authoritative value equals their preview SHALL NOT appear in that change report.

### Requirement: The port claim file stays local to the repository

The extension SHALL add `.env.worktree` to the repository-local exclude file and SHALL NOT add it to `.gitignore`. A failed exclude update SHALL be reported and SHALL NOT change the worktree create or any port outcome.

### Requirement: A committed allocation stays successful when lock cleanup fails

WHERE port values were committed but releasing their allocation lock fails, those port outcomes SHALL remain successful and the panel SHALL warn that a later allocation may be blocked.

### Requirement: A claimed port is not described as reserved from other processes

The create form and its result SHALL NOT claim that a preview or written value prevents an unrelated process from binding that port before setup runs.
### Requirement: Two declarations are one path only when they are spelled alike

Two declared paths SHALL count as the same path only WHERE their written spellings match after the
extension's own normalization. A pair whose spellings differ SHALL NOT be treated as one path,
whatever relation a filesystem might hold between them.

#### Scenario: One path, declared twice, spelled the same

- **WHEN** two sources declare the same path with the same spelling and ask for different modes
- **THEN** the section shows one row for that path

#### Scenario: The same file, declared under two spellings

- **WHEN** two declarations differ only in letter case, or in another form a filesystem might treat
  as equivalent
- **THEN** neither is discarded, neither is merged into the other, and each keeps the spelling its
  own file wrote

### Requirement: Declarations that may name one destination are offered together, favouring the repository's own

WHERE two declarations differ in spelling but may name one destination, the section SHALL show and
offer both, each with its own spelling and declaring file, and SHALL record the repository's own as
the one the merge rule favours. Neither SHALL be withheld because the pair could not be told apart.

#### Scenario: Both spellings are visible before the worktree exists

- **WHEN** the section holds such a pair
- **THEN** both rows are shown, each naming its own declaring file, and both can be selected

### Requirement: The extension never asks a filesystem which spellings are one file

The extension SHALL NOT consult any filesystem to decide whether two declared spellings name one
file, on any platform. Creating the worktree SHALL remain available whatever the section holds.

#### Scenario: A model built from declarations alone

- **WHEN** a section is populated from a repository's declarations
- **THEN** no declared path and no exclusion spelling is resolved, inspected or opened in order to
  decide which rows the section shows

### Requirement: An exclusion matches on the same rule the merge uses

`exclude` SHALL match a declared path under exactly the rule that decides whether two declarations
are the same path. An exclusion that matches nothing SHALL be reported rather than dropped.

#### Scenario: An exclusion spelled differently from the entry

- **WHEN** an `exclude` rule names a path in a different letter case from the entry it was meant to
  remove
- **THEN** the entry is not excluded, and the exclusion is reported as having matched nothing
### Requirement: The removal report shows every check it ran, with its own outcome

The remove dialog SHALL render every check the assessment reported — the ones that passed included, the ordinary checks and the orphan proofs alike — each with its own outcome. A check reported as unproven SHALL NOT be rendered as passed, and a check reported as not applicable SHALL be rendered as neither.

#### Scenario: Nothing is wrong with the worktree

- **WHEN** every check the assessment ran passed
- **THEN** the dialog still lists those checks with their outcomes rather than presenting an empty report

#### Scenario: A check could not be evaluated

- **WHEN** a check is reported as unproven
- **THEN** it is rendered as a check that could not be evaluated, distinct from both a passing and a failing one

### Requirement: A typed confirmation is required only where a confirmable risk earned one

Given an assessment, the dialog SHALL decide its control from the classes and outcomes reported: a refusal-class check that is failing or unproven leaves no confirmation control, a confirmable one requires the worktree's name to be typed, and anything else takes an ordinary confirmation. A proof that is unproven or withheld SHALL NOT require a typed confirmation. Every removal SHALL cross this assessment and control selection before it can execute.

#### Scenario: Only a proof is unproven

- **WHEN** no confirmable check is failing or unproven and one or more proofs cannot be evaluated
- **THEN** the removal is offered with an ordinary confirmation and no typed confirmation is asked for

#### Scenario: A confirmable risk could not be evaluated

- **WHEN** a confirmable check is reported as unproven
- **THEN** the removal is offered behind a typed confirmation rather than withheld

#### Scenario: A refusal-class check could not be evaluated

- **WHEN** a refusal-class check is reported as unproven
- **THEN** no confirmation is offered, the same as if that check had failed

### Requirement: A removal is reported before anything is deleted

WHEN the user asks to remove a worktree shown by the panel, the panel SHALL present the removal
report and SHALL NOT delete anything until the user answers it. A removal request for that target
carrying no report fingerprint SHALL return assessment state rather than execute. Asking for the
report SHALL NOT itself remove, modify, or delete anything.

#### Scenario: A worktree with nothing wrong with it

- **WHEN** the user asks to remove a worktree whose every confirmable check passed
- **THEN** the report is presented with an ordinary confirmation, and the worktree is removed only after the user answers it

#### Scenario: A worktree that is no longer there

- **WHEN** the checks that inspect the worktree's contents report not applicable because it is gone
- **THEN** the report is offered with an ordinary confirmation, the same as one whose checks passed

### Requirement: A confirmation carries only the authority its report was granted

Every report that offers confirmation SHALL carry a fingerprint bound to what it reported, and the
confirmation SHALL return that fingerprint. A fingerprint authorizes one confirmed removal attempt;
it SHALL NOT itself decide whether Git is invoked with force. After re-evaluating the worktree, the
host SHALL choose ordinary or forced execution from the current evidence. A refusal or unavailable
assessment SHALL carry no executable authority.

#### Scenario: Confirming a clean report

- **WHEN** the user confirms a report whose confirmable checks passed
- **THEN** the fingerprint is redeemed and the host takes the ordinary removal path if the fresh evidence is still clean

#### Scenario: Confirming a risky report

- **WHEN** the user confirms a report whose confirmable risk failed or was unproven
- **THEN** the fingerprint is redeemed and only the host may select the forced removal the fresh evidence requires

### Requirement: A report that could not be produced is not a refusal

WHEN the worktree could not be assessed at all, the panel SHALL say the assessment could not be made
and offer to ask again. It SHALL NOT render that state as a report, and SHALL NOT present it as a
refusal to remove.

#### Scenario: The worktree could not be read

- **WHEN** the assessment cannot be produced because what it would inspect could not be read
- **THEN** the panel says so and offers a retry, rather than showing a report with every check unproven

### Requirement: A report describes the worktree the confirmation will act on

The report the user reads and the removal their confirmation authorizes SHALL be the same worktree
registration. WHERE the registration a report identified has been replaced by another at the same
location, the confirmation SHALL NOT be honoured against the replacement.

#### Scenario: A worktree is replaced at the same path before the report is produced

- **WHEN** the worktree is removed and a different one is created at the same location outside the panel, and the user then asks to remove it
- **THEN** the report describes whichever worktree is registered at that location when the report is produced, and confirming it acts on that same one

### Requirement: A report is shown only while it still answers what the user asked

An assessment answered late SHALL NOT replace what the user is looking at now. WHERE the user has
since asked for something else, cancelled, or moved to another worktree, the late report SHALL be
discarded. A retry SHALL be offered only where it could still act.

#### Scenario: The user moves on before the report arrives

- **WHEN** an assessment for one worktree is answered after the user has asked to remove a different worktree, or has opened another dialog
- **THEN** the late report is discarded and what the user is looking at is left alone

#### Scenario: The worktree left the tree before the failure was reported

- **WHEN** an assessment that could not be made is reported after its worktree is no longer listed
- **THEN** no retry is offered, because there is nothing left for it to ask about

### Requirement: An assessment that fails outright is reported, not swallowed

WHERE the assessment cannot be completed at all, the panel SHALL tell the user it could not be made
and offer to ask again. Asking to remove a worktree SHALL NOT leave the user with no response.

#### Scenario: The assessment fails rather than reporting what it could not read

- **WHEN** producing the assessment fails outright
- **THEN** the panel says the assessment could not be made and offers a retry, exactly as it does for one that reported which reads failed

### Requirement: A declaration that will yield is offered as yielding

WHERE declared entries may name one destination, what the dialog says will be brought over SHALL
follow from the selection it currently holds, under the rule the apply uses to decide that group. A
row that selection would have refused SHALL say so and SHALL NOT be counted, and where unselecting
it is what lets the group succeed, it SHALL be offered unselected.

#### Scenario: The inherited spelling is offered beside the repository's own

- **WHEN** the offer contains two declarations that may name one destination and exactly one of them
  is the repository's own
- **THEN** the repository's own is selected and the other is not, and the other says it will be
  refused while its counterpart stays selected

#### Scenario: The summary counts only what will arrive

- **WHEN** such a pair is offered
- **THEN** the summary counts the repository's own declaration and not the one that will yield

#### Scenario: Nothing is favoured

- **WHEN** two declarations may name one destination and neither is the repository's own
- **THEN** both stay selected, because nothing decides between them and unselecting either would
  pick a winner the apply does not

#### Scenario: More than one of the repository's own declarations names a destination

- **WHEN** the offer contains two declarations from the repository's own file that may name one
  destination, beside an inherited declaration that may name it too
- **THEN** all three are offered selected, each says the create will refuse it because more than one
  of the repository's own declarations names this destination, and none is counted — there is no
  selection the dialog could offer that makes this group succeed, and unselecting one of the
  repository's own on the user's behalf would pick the winner the apply refuses to pick

#### Scenario: The user unselects one of the repository's own

- **WHEN** the user leaves exactly one of the repository's own declarations in that group selected
- **THEN** the remaining one stops saying it will be refused and is counted, and the inherited
  declaration says it will yield to it

#### Scenario: The user selects the second one again

- **WHEN** a second of the repository's own declarations is selected again
- **THEN** every row in the group returns to saying it will be refused, and none is counted

#### Scenario: Only the inherited declaration is left selected

- **WHEN** the user unselects both of the repository's own declarations and leaves the inherited one
- **THEN** it stops saying it will be refused and is counted, because the selection it holds names
  one declaration for that destination

### Requirement: A destination two declarations may both name is held by the repository's own

WHERE two selected declarations may name one destination and one of them is the repository's own,
the extension SHALL materialize the repository's own declaration before the other, so that the
material and the `mode` at that destination are the repository's own declaration's.

#### Scenario: Both spellings resolve to one file

- **WHEN** two selected declarations differ only in a form the worktree's filesystem folds, and one
  of them is the repository's own
- **THEN** the worktree holds the repository's own declaration's material under its own `mode`

#### Scenario: The two spellings may be two files here

- **WHEN** two such declarations name destinations this filesystem may keep apart
- **THEN** only the repository's own is materialized, and the other is refused naming both
  declarations, because nothing available can establish that the second destination is a different
  slot rather than the first one having been removed

### Requirement: A collision the extension cannot attribute to its own write is refused

WHERE a destination two selected declarations may both name is already present when the apply
begins, or is present after the repository's own declaration ran without the extension being able
to establish that this apply's own write put it there, the extension SHALL report a refusal naming
both declarations, SHALL NOT resolve the destination in favour of the inherited declaration, and
SHALL NOT write into it.

#### Scenario: The destination was already in the worktree

- **WHEN** the destination already exists when the apply begins
- **THEN** neither declaration's material is written into it and both are named in the refusal

#### Scenario: The repository's own declaration failed first

- **WHEN** the repository's own declaration is refused or fails before it claims the destination
- **THEN** the other declaration is refused rather than applied in its place

#### Scenario: The repository's own declaration claimed it

- **WHEN** the repository's own declaration has materialized the destination
- **THEN** the other declaration is refused rather than written, whatever its own destination reads

#### Scenario: More than two declarations may name one destination

- **WHEN** three or more selected declarations may name one destination
- **THEN** every refusal names every one of them, by path and declaring file, its own included

### Requirement: A destination more than one of the repository's own declarations name is refused entire

WHERE more than one selected declaration naming a destination is the repository's own, the extension
SHALL materialize none of them, SHALL report a refusal naming every declaration in the group by path
and declaring file, and SHALL NOT resolve the destination in favour of any of them.

Nothing available decides between two of the repository's own declarations: their order inside one
file is not a precedence anything here grants, and choosing by it would settle a user's config
silently.

#### Scenario: Two of the repository's own declarations name one destination

- **WHEN** two selected declarations from the repository's own file may name one destination, beside
  an inherited declaration that may name it too
- **THEN** nothing is written at that destination, and every one of the three is refused naming the
  others

#### Scenario: The user leaves only one of them selected

- **WHEN** the user unselects all but one of the repository's own declarations for that destination
- **THEN** the remaining one is the repository's own declaration for the group and is materialized,
  because the question the refusal could not answer is no longer being asked

### Requirement: A symlink that would resolve to itself is never created

WHERE recreating a symlink in the new worktree would produce a link whose target resolves to that
link's own destination, the extension SHALL refuse it and report why, rather than creating a link
that resolves to itself.

### Requirement: A repository can build on a source instead of replacing it

The repository's own configuration SHALL be able to name another provisioning source to build on.
WHERE it does, the section SHALL list the named source's declared material together with the
repository's own, and every row SHALL name the file that declared it.

WHERE the repository's own configuration names no source to build on, its declared material SHALL
be the whole of the section, and every other detected source SHALL remain unchosen — inheriting
SHALL NOT happen unless it was asked for.

#### Scenario: Building on another source

- **WHEN** the repository's own configuration names another source to build on, and both declare
  material
- **THEN** every declared item from both appears as its own row, and each row names its own
  declaring file rather than a single combined origin

#### Scenario: Declaring without naming a source to build on

- **WHEN** the repository's own configuration declares material and names no source to build on,
  in a repository that also carries another detected source
- **THEN** the section shows only the repository's own material, and the other source appears as a
  row offering to switch

### Requirement: The repository's own declaration wins the path it shares

WHERE the repository's own configuration declares material at a path also declared by the source it
builds on, exactly one row SHALL be offered for that path, and it SHALL be the repository's own —
including how that material is brought over, so a path the named source links MAY become a path the
repository copies.

The surviving row SHALL name the file that declared it.

#### Scenario: The same path declared by both

- **WHEN** the source being built on declares a path as linked, and the repository's own
  configuration declares the same path as copied
- **THEN** one row is offered for that path, it is copied rather than linked, and it names the
  repository's own configuration as its source

### Requirement: A path the repository removed is shown as deliberate

The repository's own configuration SHALL be able to remove material inherited from the source it
builds on. A removed path SHALL be shown as deliberately excluded rather than omitted, SHALL keep
the name of the file that originally declared it, and SHALL NOT be counted among the material the
section says will be brought over.

Removing a path the repository itself declared SHALL be reported as a problem naming that path,
and SHALL NOT remove the row.

#### Scenario: An inherited path removed

- **WHEN** the repository's own configuration removes a path the source it builds on declared
- **THEN** that path is shown as deliberately excluded, still naming the file that declared it, and
  the section's count of what will be brought over does not include it

#### Scenario: Removing a path the repository itself declared

- **WHEN** the repository's own configuration both declares a path and removes it
- **THEN** the row remains offered and the section reports a problem naming that path

### Requirement: Setup commands from two sources run as both files wrote them

WHERE the section carries setup commands from more than one file, every command SHALL be offered,
in the order the files declare them, with the source being built on before the repository's own.
Two identical commands from two files SHALL both be offered.

#### Scenario: The same command declared twice

- **WHEN** the source being built on and the repository's own configuration each declare the same
  setup command
- **THEN** both are offered as separate rows, each naming its own file, and neither is dropped

### Requirement: One unreadable part never discards the rest of a configuration

A configuration that is malformed, that holds a key the system does not read, that names a source
to build on which is not there, or that names one which is there and could not be read SHALL each
be reported as a distinct problem naming the file and what was lost. None of them SHALL discard the
rest of the file.

WHERE the named source to build on is not there, the repository's own declared material SHALL still
be offered.

### Requirement: A source that could not be read is not a source that is absent

A named source to build on that was found and could not be read SHALL be reported as unreadable and
SHALL NOT be reported as one that is not there.

#### Scenario: Naming a source that is there and cannot be read

- **WHEN** the repository's own configuration names a source to build on which the repository does
  carry, and that file cannot be read
- **THEN** the section reports that the file could not be read, not that it is missing, and still
  offers the repository's own declared material

#### Scenario: Naming a source that is not there

- **WHEN** the repository's own configuration names a source to build on which the repository does
  not carry, and also declares its own material
- **THEN** the section reports that the named source is missing, offers the repository's own
  declared material, and leaves the create available

#### Scenario: A key the system does not read

- **WHEN** the repository's own configuration holds one key the system does not read alongside keys
  it does
- **THEN** the section reports that one key and offers every row the other keys declared

### Requirement: Every key a configuration declares is judged as a key of that file

Every key a configuration file declares SHALL be judged as a key of that file, whatever the key is
named. A name the configuration format's host language gives a meaning of its own SHALL NOT thereby
supply a value the system reads. WHERE the configuration is one that reports keys the system does
not read, such a key SHALL be reported among them.

#### Scenario: A key named for a host-language member

- **WHEN** the repository's own configuration declares a key whose name the configuration format's
  host language gives its own meaning to, and that key holds values the system would otherwise read
- **THEN** the section reports it as a key the system does not read, and none of the values under it
  is used to name a source to build on, to remove a row, or to declare one

#### Scenario: The same key in a configuration that reports no keys

- **WHEN** a detected source that does not report unrecognized keys declares such a key, holding
  values the system would otherwise read
- **THEN** no row and no setup step is taken from it

### Requirement: Deleting the branch is a separate opt-in, offered only on a proven merge

WHERE a pre-removal report establishes that the worktree's branch is merged, the extension SHALL
offer deleting that branch as a control that is off by default. WHERE the merge is not established —
whether it was disproven, could not be established, or does not apply — the extension SHALL NOT offer
the control at all, rather than offering it disabled.

Removing the worktree SHALL NOT imply deleting the branch, and any typed confirmation the removal
itself requires SHALL NOT enable the control.

#### Scenario: The branch is proven merged

- **WHEN** the report establishes the branch is merged
- **THEN** the control is offered, and it is off

#### Scenario: The merge could not be established

- **WHEN** the merge is disproven, unestablished, or does not apply
- **THEN** no branch-deletion control appears in the report

#### Scenario: The removal is confirmed but the branch was not opted into

- **WHEN** the user confirms the removal without turning the control on
- **THEN** the worktree is removed and no branch is deleted

### Requirement: The branch is deleted only if nothing it was proven against has moved

WHERE the user opted in, the extension SHALL verify — as one indivisible step with the deletion —
that the branch and the default branch still point at the commits the merge was proven from. WHERE
either has moved, the extension SHALL NOT delete the branch and SHALL report that it did not.

#### Scenario: The branch advanced after the proof

- **WHEN** the branch has moved since the report was built
- **THEN** the branch is not deleted and the user is told it was not

#### Scenario: The default branch moved after the proof

- **WHEN** the default branch has moved since the report was built
- **THEN** the branch is not deleted and the user is told it was not

### Requirement: A branch in use, or the default branch, is never deleted

The extension SHALL NOT delete the default branch, and SHALL NOT delete a branch it observes to be
in use by another worktree — whether checked out, held by a rebase, held by a bisect, or named by a
sequencer operation. Both SHALL be established immediately before deleting rather than when the
report was built, and the extension SHALL refuse the deletion where it cannot establish either.

#### Scenario: The branch was checked out elsewhere in the meantime

- **WHEN** the branch is observed in use by another worktree when the deletion is attempted
- **THEN** the branch is not deleted and the user is told it was not

#### Scenario: The state that would answer cannot be read

- **WHEN** the extension cannot establish whether the branch is in use
- **THEN** the branch is not deleted and the user is told it was not

#### Scenario: The target is the default branch

- **WHEN** the branch named for deletion is the default branch
- **THEN** it is not deleted

### Requirement: The branch deletion is reported apart from the removal

WHEN the user opted in, the extension SHALL delete the branch only after the worktree removal has
succeeded, and SHALL report the removal and the branch deletion as separate outcomes. A failed branch
deletion SHALL NOT be reported as a failed removal.

#### Scenario: The removal succeeds and the deletion fails

- **WHEN** the worktree is removed and the branch deletion then fails
- **THEN** the removal is reported as having succeeded and the branch failure is reported separately

#### Scenario: The removal fails

- **WHEN** the worktree removal fails
- **THEN** no branch deletion is attempted

### Requirement: A configuration path that is not an ordinary file is refused

WHERE a path the repository names as its own configuration, or as a source to build on, does not
hold an ordinary file, the read SHALL refuse it without waiting for it to become readable, and
SHALL report it as unreadable rather than as absent, as empty, or as declaring nothing.

Storage that is merely slow behind an ordinary file is outside this requirement.

#### Scenario: A source to build on that nothing is writing to

- **WHEN** the repository's own configuration names a source to build on, and that path holds a
  named pipe with nothing writing to it
- **THEN** the section reports that the file could not be read, still offers the repository's own
  declared material, and answers rather than waiting

### Requirement: A refused save leaves the next save able to run

WHEN a save of the repository's own configuration is refused, the save SHALL report its refusal and
SHALL leave a later save of the same file able to run. A save that cannot complete SHALL NOT leave
the file reserved against every later attempt.

#### Scenario: Saving over a configuration that is not an ordinary file

- **WHEN** the user saves the section's choices and the repository's own configuration file is not
  an ordinary file
- **THEN** the save is refused and reported, and an immediately following save of the same file
  runs rather than failing because the file is still held

#### Scenario: The configuration stops being an ordinary file while the save is running

- **WHEN** the repository's own configuration file holds an ordinary file as the save begins and
  holds a named pipe by the time the save reads it
- **THEN** the save is refused and reported, and a following save of the same file still runs

### Requirement: A choice the repository's own configuration can express is recorded there

WHERE the create form offers to save what the user has chosen, the extension SHALL record in the
repository's own provisioning configuration every chosen state that configuration is able to
express, and SHALL express a change to an inherited declaration as an entry in that file rather
than as an edit to the file that declared it.

#### Scenario: An inherited entry the user does not want

- **WHEN** the user clears an entry that came from another tool's configuration and saves
- **THEN** the repository's own configuration excludes that path
- **AND** the file that declared the entry is unchanged

#### Scenario: An entry the repository declared itself

- **WHEN** the user clears an entry the repository's own configuration declared inline and saves
- **THEN** that path is no longer declared by the repository's own configuration
- **AND** no exclusion is recorded for it

### Requirement: A choice that configuration cannot express is stated, not silently dropped

WHERE a chosen state has no expression in the repository's own provisioning configuration, the
create form SHALL state before the save that the choice applies to this create only, and the
extension SHALL leave that choice unrecorded rather than approximating it.

#### Scenario: A setup command the user chose to run

- **WHEN** the user checks a setup command and saves
- **THEN** the saved configuration grants that command no standing consent
- **AND** the command is offered unchecked the next time the form is opened

### Requirement: No configuration file another tool defined is ever written

The extension SHALL write exactly one provisioning file — the repository's own — and SHALL leave
every other detected provisioning file byte-identical across every operation this control offers.

#### Scenario: A framework's file after a save

- **WHEN** any save this control offers completes, whatever the user chose
- **THEN** every provisioning file the extension did not define holds the same bytes it held before

### Requirement: A configuration that cannot be edited safely is refused rather than rewritten

WHERE the repository's own provisioning configuration cannot be parsed, or declares a key this
control writes with a different shape than that key requires, the extension SHALL refuse the save,
leave the file unchanged, and report why.

#### Scenario: A configuration with a syntax error

- **WHEN** a save is attempted against a configuration that does not parse
- **THEN** the file is byte-identical afterwards
- **AND** the form reports that the configuration could not be edited

### Requirement: An existing configuration keeps the formatting and comments it had

WHERE the repository already has its own provisioning configuration, a save SHALL preserve the
comments and formatting of every part of that file it did not change, and SHALL preserve the file's
existing permissions.

#### Scenario: A commented configuration gains an exclusion

- **WHEN** a save adds an exclusion to a configuration carrying comments and its own indentation
- **THEN** the comments and the indentation of the untouched parts survive the save

### Requirement: A configuration written for the first time names a source that exists

WHERE the first save records a choice inherited from another provisioning source, the new native
configuration SHALL name a present source file. WHERE the first save records a selected fallback file
suggestion, it SHALL record that copy inline and SHALL NOT invent an `extends` source.

### Requirement: Choosing a different source changes only which source is named

WHEN the user selects a detected source other than the one supplying the offer and saves, the
extension SHALL change only which source the repository's own configuration builds on, leaving
every other declaration in that file as it was.

### Requirement: A save answers for the form that is still open

WHERE a save and a source change are both in flight for one form, the extension SHALL leave the
form describing the later of the two choices, and SHALL publish nothing into a form that has since
closed.

### Requirement: A refusal to save says a save was refused

WHERE a save is refused for any reason other than the configuration's own content, the extension
SHALL report it as a save that did not happen, and SHALL NOT report it as a failure to read a file
it read successfully.

#### Scenario: The configuration is held by another window

- **WHEN** a save is refused because the file is locked elsewhere
- **THEN** the form states that the configuration was not saved
- **AND** the form does not state that the configuration could not be read

#### Scenario: The configuration itself is at fault

- **WHEN** a save is refused because the configuration does not parse
- **THEN** the form states that the configuration could not be edited, which is a statement about
  the file rather than about the save

### Requirement: A save that has nothing to record writes nothing

An offered but unselected fallback suggestion is not a changed preference. WHERE no suggested file is
selected, no configured expressible choice changed, and no different source was chosen, Save SHALL
leave the native configuration exactly as found and create no file.

### Requirement: No save is offered against a source change still in progress

WHERE the user has chosen a different source and the extension has not yet answered with what that
source declares, the extension SHALL NOT offer to record the selection, and SHALL offer it again
once the answer arrives.

#### Scenario: Saving between choosing a source and seeing it

- **WHEN** a different source is chosen
- **THEN** the control that records the selection is not offered
- **AND** it is offered again when the new selection is shown
- **AND** the source change is never abandoned in favour of the save

#### Scenario: The chosen source cannot be read

- **WHEN** a different source is chosen and reading it fails
- **THEN** the failure is reported
- **AND** the control that records the selection is offered again

### Requirement: A locked write decides ownership on identities that cannot round

A write that removes or replaces a file it believes it created SHALL decide that belief on filesystem
identities compared without loss of precision, so that a different file cannot be mistaken for the
one it owns.

#### Scenario: Two files whose identities differ only beyond a double's precision

- **WHEN** the file a save holds and the file its pathname now names differ only in a part of their
  identity a double cannot represent
- **THEN** the save treats them as different files and removes neither

### Requirement: A write that edits a file in place does not follow a link at its name

WHERE a save edits the configuration file in place, it SHALL read the file at that name rather than
one a link at that name points to, and SHALL refuse when the name is a link. Reading a file the user
merely NAMES as a source SHALL continue to follow links.

### Requirement: An ordinary save is unaffected

WHERE the filesystem is quiescent and the configuration file is an ordinary file, saving SHALL read,
write and report exactly as it does today.

### Requirement: A save that wrote is never presented as unsaved

WHERE a save wrote the file and then could not release its lock, what the user is shown SHALL say the
file was written — in the summary as well as in the detail — and SHALL say that saving it again may
not work until the lock clears. A save that wrote NOTHING SHALL NOT be described as written.

#### Scenario: The write lands and the lock cannot be removed

- **WHEN** the user saves, the write lands, and removing the lock afterwards is refused
- **THEN** the panel says the file was saved and may still be locked, and does not summarise it as
  not saved

#### Scenario: There was nothing to write, and the lock cannot be removed

- **WHEN** the file already holds what the user asked for, so the save writes nothing, and removing
  the lock afterwards is refused
- **THEN** the panel says the file is already up to date and may still be locked, and does not claim
  it was saved

### Requirement: No lock is offered to the user as a file to delete

A report about a lock SHALL NOT give the user a pathname to remove, in the panel or in any warning.

#### Scenario: The lock's name has been taken by another writer

- **WHEN** a save cannot release its lock because that name now identifies a different writer's lock
- **THEN** nothing names that pathname to the user

#### Scenario: The lock was never acquired at all

- **WHEN** an operation is abandoned because the lock could not be taken, so this process never held
  it and has the least standing of all to vouch for that name
- **THEN** nothing names that pathname to the user either

### Requirement: A lock left behind survives a failed refresh

WHERE a save leaves a lock behind and rebuilding the panel's view of the file afterwards fails, the
report SHALL still reach the user.

### Requirement: A surviving checkout is offered as adopt, not skipped

WHERE the destination a create would take holds a directory whose `.git` entry names an
administrative directory that no longer exists, and the selected branch already exists, the panel
SHALL resolve the selection to adopt at that directory rather than to a suffixed fresh path or to
debris. WHERE the selected branch does not exist, adopt SHALL NOT be offered and the suffixed fresh
path SHALL stand.

#### Scenario: A pruned checkout at the derived destination

- **WHEN** the derived destination holds a checkout whose administrative entry is gone and the typed
  branch exists
- **THEN** the resolution names adopt and the directory it would re-register, and the create does not
  offer a suffixed near-duplicate beside it

#### Scenario: A checkout is never offered for deletion

- **WHEN** that same destination is resolved
- **THEN** it is not reported as debris and no authorization to clear it is issued

### Requirement: Adoption re-registers a directory without changing what is in it

WHERE an adoption is authorized, the panel SHALL attach the surviving directory to the selected
branch so that it is listed by git, holds that branch, survives a prune, and can commit into the
repository; and SHALL report only the directory's genuine working-tree state rather than every
tracked file as deleted. No file inside the adopted directory SHALL be created, modified, or removed
by the adoption. The directory's `.git` entry is the one path the adoption replaces.

#### Scenario: The adopted checkout is a worktree again

- **WHEN** an adoption completes
- **THEN** the directory is listed as a worktree of the repository on the selected branch, and its
  reported status names only changes that were already on disk

#### Scenario: The content is untouched

- **WHEN** an adoption completes
- **THEN** every path under the adopted directory other than its `.git` entry has the content and the
  modification time it had before the adoption

### Requirement: A branch a live worktree holds is never adopted onto

WHERE any live worktree of the repository holds the selected branch, the panel SHALL refuse the
adoption before writing anything, with no confirmation path past the refusal. The check SHALL be made
against git's own listing at the moment of the write, not against the listing the resolution was
built from, and SHALL be made again after the registration is written — where a second holder is found
then, the adoption SHALL be undone and reported as refused rather than as a create.

#### Scenario: The branch is claimed while the user decides

- **WHEN** another worktree takes the selected branch between the resolution and the authorization
- **THEN** the adoption is refused, nothing is written, and the refusal names the directory holding
  the branch

#### Scenario: The branch is claimed while the adoption runs

- **WHEN** another worktree takes the selected branch after the adoption's own check and before it
  finishes
- **THEN** the registration the adoption wrote is withdrawn — emptied and unlocked, so git's own
  collection takes it — and the result is reported as a refusal

### Requirement: An adoption attaches the branch at the tip it promised

WHERE the branch moves between the offer and the write, the panel SHALL undo the adoption and report a
refusal rather than attaching the checkout to a commit the user was not shown. The tip SHALL be read
from the adopted worktree after its registration is written.

#### Scenario: The branch moves during the adoption

- **WHEN** the selected branch is updated while the adoption is running
- **THEN** the registration is withdrawn for git's own collection and the result names the tip
  mismatch

### Requirement: An adoption re-establishes what it was offered on

WHERE the directory's administrative entry exists again at the moment of the write, the panel SHALL
refuse the adoption rather than overwrite the registration, whatever branch that registration names.

#### Scenario: The registration comes back during the pause

- **WHEN** the surviving directory's administrative entry is restored between the resolution and the
  authorization
- **THEN** the adoption is refused and the directory's `.git` entry is left as it was found

### Requirement: Adoption states what it cannot restore before it is authorized

The panel SHALL state, before an adoption is authorized, the directory it will re-register, the
branch it will be attached to, and that staged changes, an in-progress rebase, merge, bisect or
cherry-pick, the worktree's own refs and reflog, its per-worktree configuration, and its locked state
did not survive and are not recovered. These SHALL be stated rather than probed.

#### Scenario: The confirmation names the loss

- **WHEN** an adoption is offered
- **THEN** the offer names the directory, the branch, and each thing the adoption does not restore

### Requirement: An adoption that does not complete leaves the destination as it found it

WHERE any step of an adoption fails, the panel SHALL leave the directory in a state it offers as
adopt again, reporting the failure rather than a create. It SHALL NOT delete any directory to do so:
the administrative entry it created is left in the state git's own collection takes it from, and
hidden from the repository's worktree listing meanwhile. It SHALL name that entry only where it could
not hand it over — an entry git will collect needs nothing from the user.

#### Scenario: A withdrawn adoption is offered again rather than left behind

- **WHEN** an adoption fails at any step and is withdrawn
- **THEN** the same directory is offered as adopt on a retry, the repository lists no worktree from
  the failed attempt, and a routine `git worktree prune` collects what the attempt created

#### Scenario: A withdrawal does not delete what another process put there

- **WHEN** another process replaces the administrative entry while an adoption is withdrawing
- **THEN** that process's files are left intact, because the withdrawal removes no directory at all

#### Scenario: A failed reconstruction is not a half-registration

- **WHEN** a write or a git step of the adoption fails
- **THEN** the repository lists no worktree at that directory, the directory's `.git` entry holds
  what it held before, and the result is reported as a failure

### Requirement: A withdrawal states what it could not put back

WHERE the directory's `.git` entry could not be restored to the bytes it held, or the undo itself
could not complete, the panel SHALL report what was left behind and where, rather than reporting
either a create or a clean failure.

#### Scenario: An undo that cannot finish says so

- **WHEN** the adoption fails and its own undo cannot empty or unlock the entry, or cannot restore
  the `.git` entry
- **THEN** the result names the entry directory and the state the `.git` entry was left in

### Requirement: An undo restores only the `.git` entry the adoption itself replaced

WHERE the entry at that path is no longer the file the adoption wrote, or no longer names the
administrative entry the adoption created, the panel SHALL leave it untouched and report it as left
as found.

#### Scenario: Another process's registration is not withdrawn by our undo

- **WHEN** the adoption fails after something else has replaced the directory's `.git` entry
- **THEN** that entry keeps the bytes that other writer put there, and the result reports it as left
  as found rather than as restored

### Requirement: An adoption that cannot establish the `.git` entry says so rather than reporting a clean failure

WHERE the write of the directory's `.git` entry BEGINS and does not complete, the panel SHALL report
the entry's state as unestablished and name the directory, rather than reporting a failure whose
stated effect is that nothing was changed. WHERE the write is refused before it changes anything, the
panel SHALL report a failure that changed nothing and SHALL withdraw the administrative entry it had
created — an unbegun write is not an unestablished one.

#### Scenario: The link write fails partway

- **WHEN** the write that re-points the directory's `.git` entry begins and does not complete
- **THEN** the result names that directory and states that its `.git` entry could not be left in a
  known state, and the administrative entry has been handed to git's collection

### Requirement: Adoption is offered only where the reconstruction has been verified

WHERE the reconstruction has not been executed and recorded on the running platform, the panel SHALL
NOT offer adopt there, and SHALL state that the platform is unverified rather than that the
reconstruction fails.

#### Scenario: An unverified platform withholds the mode

- **WHEN** a surviving checkout is resolved on a platform the reconstruction has not been recorded on
- **THEN** adopt is not offered, the reason given is that the platform is not yet verified, and the
  resolution falls back to the suffixed fresh path
### Requirement: A move offer requires an identified source worktree

WHERE a create action came from a specific worktree row, that source has work the host can count
completely, and the editor can migrate it, the form SHALL offer to move the work. A create opened
without a unique source row, or against an unavailable source or integration, SHALL NOT offer it.

#### Scenario: There is work to move

- **WHEN** a worktree row opens create and that worktree has movable changes
- **THEN** the form offers to move them

#### Scenario: The create has no source row

- **WHEN** the create form was opened from a repository-level or toolbar action
- **THEN** no move option is offered

#### Scenario: Nothing can be offered

- **WHEN** the source has no changes, has an unresolved merge, cannot be read completely, or migration is unavailable
- **THEN** the form does not offer to move anything and create remains available

### Requirement: The move offer states one complete distinct-path count

The offer SHALL state the number of distinct movable paths Git reports as staged, changed in the
working tree, or untracked. A path in more than one state and a renamed path SHALL each count once;
a changed path set SHALL withdraw the earlier consent.

#### Scenario: A path is both staged and edited

- **WHEN** one path is staged and also changed in the working tree
- **THEN** the form states it as one change

#### Scenario: The count changes before create

- **WHEN** the user selected the move at one count and the host observes a changed snapshot while redeeming consent
- **THEN** no worktree is created and the earlier selection authorizes no move

#### Scenario: The count changes after create

- **WHEN** git created the destination but the final pre-migration snapshot no longer matches
- **THEN** the checkout remains created, no move or later step runs, and migration is reported indeterminate

### Requirement: Move consent applies to execution-time source work

The row SHALL identify its number as the current snapshot and SHALL state that Git moves the source's
uncommitted work present when the operation runs. A change after the final host check MAY enter the
Git operation; observable divergence SHALL make the result indeterminate.

#### Scenario: Work changes after the final check

- **WHEN** another process changes the source after the host's final snapshot and before Git stashes it
- **THEN** the operation may include that work and any observed mismatch is reported as indeterminate

### Requirement: The work moves between a new checkout and every later step

For a fresh, detached, or reused-branch create, migration SHALL run after git creates the checkout and
before any provisioning authorization, materialization, allocation, opening, or launch in it. Reattach and adopt
SHALL NOT offer or perform migration because they act on surviving directories.

#### Scenario: A setup command sees the moved work

- **WHEN** a create carries both migration and provisioning entries
- **THEN** migration completes before the first provisioning entry is materialized

#### Scenario: The move is uncertain

- **WHEN** the integration does not establish that the work moved
- **THEN** no provisioning or after-create action runs in the created checkout

#### Scenario: Untracked files move too

- **WHEN** the moved work includes a file git is not tracking
- **THEN** the integration is asked to include that file with the rest

#### Scenario: A surviving checkout is repaired

- **WHEN** the create mode is reattach or adopt
- **THEN** no move option is offered and no migration is attempted

### Requirement: Migration uncertainty does not undo a successful create

WHERE migration is not established, the extension SHALL keep and report the created worktree rather
than reporting a failed create or rolling it back. No later create step SHALL run.

#### Scenario: The move rejects

- **WHEN** the migration promise rejects after the worktree was created
- **THEN** the create remains successful and later steps do not run

### Requirement: An uncertain migration report claims only proven state

The report SHALL call migration potentially partial, direct inspection of both worktrees and Git
stashes, and SHALL NOT claim source restoration or single-location ownership. Because the integration
exposes no report-ownership signal, the contract SHALL NOT promise exactly one report.

#### Scenario: The integration resolves without moving everything

- **WHEN** the migration promise resolves but the source still reports uncommitted work
- **THEN** the notice makes no claim about where every change now resides

#### Scenario: The integration already warned

- **WHEN** the integration warns and then rejects during its own recovery
- **THEN** the extension may also report uncertainty rather than suppressing an unclassified rejection

### Requirement: Declining to move performs no migration

WHERE the user does not select the move offer, the extension SHALL NOT invoke migration and the source
worktree's changes SHALL remain untouched by this option.

#### Scenario: The offer is declined

- **WHEN** the user creates a worktree without selecting the move
- **THEN** no migration is attempted
### Requirement: Only setup the user selected runs

After a worktree is created, the extension SHALL run only the setup steps selected from the provisioning offer shown in that create form.

- Setup steps start unselected on every opening.
- A stale, unknown, or replaced offer runs nothing and requires a fresh offer and submission.
- Selected steps run in offer order after selected material and named ports have been applied.

#### Scenario: A checked-in command was not selected

- **WHEN** a provisioning offer contains a setup command and the user creates the worktree without selecting it
- **THEN** the worktree is created and that command does not run

### Requirement: Setup runs in the created worktree through one shell argument

Each selected setup step SHALL run sequentially in the created worktree, carrying the displayed script in one non-concatenated shell payload argument.

- An encoded payload decodes to the exact displayed script.
- Scripts are not interpolated into a command line.

#### Scenario: A script contains shell operators and line breaks

- **WHEN** a selected script contains quotes, operators, or line breaks
- **THEN** one shell payload produces that complete script rather than text assembled into a command line

### Requirement: Task-file setup does not use the task system

A selected setup step originating in `.vscode/tasks.json` SHALL run through the setup shell and SHALL NOT be dispatched through the VS Code task system.

### Requirement: Setup receives the worktree paths and branch

Every setup process SHALL inherit the extension-host environment and receive `ANYWHERE_TERMINAL_WORKTREE_PATH`, `ANYWHERE_TERMINAL_MAIN_PATH`, and `ANYWHERE_TERMINAL_BRANCH` for its create.

### Requirement: Setup receives authoritative named ports

A provider port name SHALL be offerable only when it is a portable environment identifier and is outside the case-insensitive `ANYWHERE_TERMINAL_` and `ASIMOV_` namespaces. Each successfully allocated or reused offerable port SHALL be set in setup under its configured environment-variable name with its authoritative value; host-owned setup variables SHALL win any later collision.

#### Scenario: A provider declares a reserved setup variable

- **WHEN** a provider declares `ANYWHERE_TERMINAL_WORKTREE_PATH`, `ASIMOV_CHANGE_ID`, or a case variant as a port name
- **THEN** the declaration is reported as malformed and is not offered or applied

### Requirement: Asimov setup receives its compatibility environment

WHERE the selected model was supplied by the asimov adapter, setup SHALL receive `ASIMOV_WORKTREE_PATH`, `ASIMOV_MAIN_ROOT`, and `ASIMOV_BRANCH` matching the Anywhere Terminal values. The extension SHALL NOT set `ASIMOV_CHANGE_ID`.

### Requirement: Setup failure leaves the successful create standing

WHERE a setup step exits non-zero, times out, or cannot start, the extension SHALL stop later setup steps, keep the worktree and earlier provisioning results, and report the setup failure on that worktree's row.

- The failure offers its captured output and a retry.
- Retry runs setup only and does not repeat materialization or port allocation.
- Retry is unavailable after the extension can no longer prove the row names the worktree for which the steps were selected.

#### Scenario: The second selected step fails

- **WHEN** the first selected step succeeds and the second exits non-zero
- **THEN** later steps do not run, the worktree and first step remain standing, and the row offers setup-only retry

### Requirement: Agent startup honours the setup wait choice

WHERE a create will start an agent and at least one setup step is selected, the form SHALL offer the
choice to wait for setup, recommended and selected by default, and SHALL state the order it produces.

- With the choice off, agent startup begins after materialization and port allocation without waiting for setup to exit.
- With the choice on, the agent starts only after every selected setup step succeeds.
- A failed gated setup starts no agent and reports the failure.
- Where no setup step is selected, the wait control remains visible but disabled.

#### Scenario: Setup is selected for an agent create

- **WHEN** an agent create is chosen and a setup step is selected
- **THEN** the wait choice is enabled and selected
- **AND** the form states that the agent starts after the selected setup finishes

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
thing. It SHALL state that ports and setup steps apply only to the current create, and that statement
SHALL be reachable as the action's own description for assistive technology. It SHALL NOT imply that
pressing it opens a second configuration interface.

#### Scenario: The action is reached without sight of the form

- **WHEN** assistive technology announces the save action
- **THEN** what the save does not cover is announced with it

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

### Requirement: A repository without provisioning configuration gets bounded initialization suggestions

WHERE no provisioning source is present, the create form SHALL inspect a fixed set of supported
environment filenames at the repository root and one level inside each workspace directory the
repository itself declares, together with the repository-root package-manager lockfiles. A present
source that is empty or unreadable SHALL remain the source's answer and SHALL suppress fallback
suggestions.

#### Scenario: An environment file exists without provisioning configuration

- **WHEN** the repository root contains an ordinary `.env.local` file and no provisioning source
- **THEN** `.env.local` is offered as a copy suggestion
- **AND** no byte of `.env.local` is read to produce the offer

#### Scenario: A provisioning source is present but empty

- **WHEN** the repository has an empty supported provisioning file and also has `.env`
- **THEN** the source supplies the empty offer and `.env` is not suggested

### Requirement: Every initialization suggestion is explicit and explained

An environment-file suggestion and a package-manager setup suggestion SHALL start unchecked. Each
suggested ROW SHALL name the root file that caused it to be offered. An environment-file suggestion SHALL warn that
the file may contain secrets. A suggestion SHALL NOT restate its own label, its own path, or what its
mode does.

#### Scenario: A pnpm lockfile is found

- **WHEN** `pnpm-lock.yaml` is an ordinary file at the repository root and no provisioning source exists
- **THEN** `pnpm install` is offered unchecked as setup
- **AND** the row names `pnpm-lock.yaml` as the reason for the suggestion

#### Scenario: More than one package manager is represented

- **WHEN** supported lockfiles for two package managers are present
- **THEN** each manager's static install command is offered separately and unchecked
- **AND** the extension does not select a package manager on the user's behalf

#### Scenario: A suggested environment file is offered

- **WHEN** the form offers an environment file the extension found rather than one a provider declared
- **THEN** the row is unselected, names that file once, and warns that it may contain secrets
- **AND** the row does not describe what copying does

### Requirement: Suggestions spend only the host-held offer the user selected

Selecting suggestions SHALL apply only to the current create unless an expressible file choice is
saved. Create SHALL carry only the current host-issued offer id and selected opaque item ids; no path
or command text supplied by the form SHALL become copy or execution authority. A stale, foreign, or
superseded suggestion id SHALL authorize neither create nor setup.

### Requirement: Saving suggestions records positive file consent but never setup consent

WHEN a user explicitly saves selected environment-file suggestions, the repository's native worktree
configuration SHALL record those files as copies for future creates. An unselected suggestion SHALL
record no exclusion or other preference. Suggested setup commands SHALL remain current-create-only.

#### Scenario: An untouched suggestion set is saved

- **WHEN** environment and setup suggestions are offered, none is selected, and Save defaults is pressed
- **THEN** no configuration file is created

#### Scenario: One environment suggestion is selected and saved

- **WHEN** `.env.local` is selected, the setup suggestion is not selected, and Save defaults is pressed
- **THEN** the native configuration records `.env.local` under `copy`
- **AND** it records no setup command

### Requirement: A saved configuration replaces fallback suggestions

WHILE no provisioning source exists, an unsaved suggestion SHALL be offered unchecked again on a
later form. WHEN a save creates the native configuration, later forms SHALL present the saved
configuration as the provisioning source and SHALL offer no fallback suggestions.

#### Scenario: The saved copy becomes the provisioning source

- **WHEN** a save recorded `.env.local` and a later create form opens with `pnpm-lock.yaml` still present
- **THEN** the form offers `.env.local` as a configured native copy
- **AND** no fallback suggestion, including the `pnpm install` setup command, is offered

### Requirement: An explicit overlap choice is never silently reversed

WHERE the user has set the setup wait choice themselves, that choice SHALL survive any later change
to the setup selection. Only an untouched choice follows the recommended default.

#### Scenario: The user asks for overlap

- **WHEN** the user clears the wait choice and then selects a further setup step
- **THEN** the wait choice remains cleared

#### Scenario: The setup selection is emptied and refilled

- **WHEN** the user clears every setup step and then selects one again
- **THEN** an untouched wait choice is selected again, and a cleared one stays cleared

### Requirement: A secondary action does not carry a primary action's weight

An action that is not the surface's decision SHALL be presented as secondary. The panel's
inline empty state and the provisioning save action are both secondary, and neither SHALL
be styled as the surface's primary button.

#### Scenario: The tree offers a create for a repository with no worktrees

- **WHEN** the inline empty state offers to create a worktree
- **THEN** its action is presented as a secondary action

#### Scenario: The create form offers to save provisioning defaults

- **WHEN** the provisioning section offers to save the current choices
- **THEN** the save action is presented as secondary, and its explanation sits below it rather than wrapping around it

### Requirement: A disclosure names what it hides

A collapsed region in the create form SHALL name the choices it contains, so a user can tell
whether to open it without opening it.

#### Scenario: The advanced region is collapsed

- **WHEN** the create form is opened
- **THEN** the collapsed region names the inputs it holds

### Requirement: A term of art carries its own explanation

WHERE the create form labels a control with a git term of art, that label SHALL carry a
hover and assistive-technology explanation of what the term means for this create. The
explanation SHALL be available without changing any choice.

#### Scenario: The base ref input is offered

- **WHEN** the advanced region is opened
- **THEN** the base ref control carries an explanation of what a base ref is

#### Scenario: The detached checkout choice is offered

- **WHEN** the detached-checkout choice is shown
- **THEN** it carries an explanation of what detaching at a ref produces

### Requirement: A workspace repository's package environment files are found

WHERE the repository declares workspace packages, each declared directory SHALL be examined one level
deep for the same supported environment filenames, and each found file SHALL be offered by its
repo-relative path. The extension SHALL NOT scan a directory the repository did not declare, expand a
pattern it does not implement, read an environment file's contents, offer anything that resolves
outside the repository, or exceed the existing scan and row budgets however many patterns are
declared.

#### Scenario: A monorepo keeps its environment files in its packages

- **WHEN** the repository declares `apps/*` as workspaces, has no root environment file, and
  `apps/web/.env` and `apps/server/.env` are ordinary files
- **THEN** both are offered as unchecked copy suggestions named `apps/web/.env` and `apps/server/.env`

#### Scenario: A declared pattern points outside the repository

- **WHEN** the repository declares a workspace pattern that resolves outside the checkout
- **THEN** no suggestion from outside the repository is offered

#### Scenario: The repository declares no workspaces

- **WHEN** the repository has no workspace declaration
- **THEN** only repository-root suggestions are offered

### Requirement: A setup gate states the resulting order as its own line

WHERE the form offers to wait for setup before starting the agent, the resulting order SHALL be shown
as its own line rather than continuing the checkbox's label.

#### Scenario: The gate is offered

- **WHEN** the form shows the wait-for-setup choice
- **THEN** the order it produces reads as a separate line from the choice itself

