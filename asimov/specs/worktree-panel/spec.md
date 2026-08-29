# worktree-panel Specification
## Requirements

### Requirement: Present the supplied worktree tree

Given a worktree tree, the view SHALL render every worktree of every repository in it exactly once, in the order the tree supplies. A repository group header SHALL be rendered only when the tree carries more than one repository; with a single repository the view SHALL present its worktrees without a group header.

### Requirement: No row exposes a filesystem path

No row in the tree SHALL display a filesystem path as row content. A worktree's path SHALL remain reachable through the row's tooltip and through an explicit copy action. This holds at every width — the path SHALL NOT appear when the panel is widened.

### Requirement: Strongest state wins and shape carries it

Each presented activity — `waiting`, `running`, `running (unconfirmed)`, `unknown`, `idle`, `exited` — SHALL be distinguishable from every other by shape alone, without colour or motion. The same shape SHALL be used on a worktree row and on an agent row.

A worktree row SHALL reflect the strongest presented activity among its agents, in the precedence `waiting` > `running` > `unknown` > `idle` > `exited`, where `running (unconfirmed)` ranks as `running` and loses to it.

#### Scenario: One waiting agent among several running ones

- **WHEN** a worktree holds one agent whose activity is `waiting` and four whose activity is `running`
- **THEN** the worktree row reads as `waiting`

#### Scenario: Motion is removed

- **WHEN** the viewer has asked for reduced motion, so no state animates
- **THEN** `running`, `running (unconfirmed)` and `idle` remain distinguishable from each other by shape

#### Scenario: An unknown agent outranks an idle one

- **WHEN** a worktree holds one agent presented as `unknown` and one whose activity is `idle`
- **THEN** the worktree row reads as `unknown`

#### Scenario: A worktree whose only running agent is unconfirmed

- **WHEN** a worktree holds one agent presented as `running (unconfirmed)` and one whose activity is `idle`
- **THEN** the worktree row reads as `running (unconfirmed)`
- **AND** adding one agent whose activity is `waiting` makes the worktree row read as `waiting`

#### Scenario: A worktree holding both a confirmed and an unconfirmed run

- **WHEN** a worktree holds one agent presented as `running` and one presented as `running (unconfirmed)`
- **THEN** the worktree row reads as `running`, in any order — a worktree reads as unconfirmed only when every running claim it holds is

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
folders hold no repository, an unavailable git, and a filter that matched nothing. None of these
SHALL be presented with error styling, and a first load with no tree yet SHALL render placeholder
rows rather than a spinner in an empty panel. The unavailable-git copy SHALL be shown only when no
listing is retained.

### Requirement: Two independent disclosure levels

Worktree-to-agents and agent-to-subagents SHALL be independently disclosable and independently persisted, so collapsing a worktree SHALL NOT clear any agent row's own expansion. Persisted state SHALL survive a reload, and an id that no longer exists in the tree SHALL be dropped rather than restored later against a reused path.

#### Scenario: An empty persisted set is not an absent one

- **WHEN** the persisted collapse set is empty because the user expanded everything
- **THEN** the view keeps everything expanded, rather than re-applying its first-run defaults

### Requirement: Keyboard traversal follows the declared hierarchy

The tree SHALL expose a single tab stop, with arrows moving within it. Up and Down SHALL move through visible rows and Home and End SHALL reach the first and last. Right SHALL open a closed node, then move to its first child, and SHALL do nothing on a row with no children. Left SHALL close an open node, then move to its parent rather than to the previous visible row. Focus SHALL remain on the row the user acted on across the re-render that disclosure causes.

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

WHEN the derived create path is already taken, the form SHALL say so, and SHALL name a final destination only when one has been resolved. It SHALL NOT present the taken path as the path that will be created.

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

A toolbar control SHALL be presented only while the body it acts on is showing, and SHALL occupy no space in the toolbar otherwise. The session-scope filter SHALL NOT be presented while the Worktree body is showing, because the worktree tree is already scoped to the workspace and the filter has nothing to scope there. The create-worktree control SHALL NOT be presented while a sessions body is showing.

#### Scenario: Switching between the sessions body and the Worktree body

- **WHEN** the user switches the panel from a sessions body to the Worktree body
- **THEN** the session-scope filter is no longer presented and the create-worktree control is

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

