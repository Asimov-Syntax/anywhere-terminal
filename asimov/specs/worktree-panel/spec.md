# worktree-panel Specification
## Requirements

### Requirement: Present the supplied worktree tree

Given a worktree tree, the view SHALL render every worktree of every repository in it exactly once, in the order the tree supplies. A repository group header SHALL be rendered only when the tree carries more than one repository; with a single repository the view SHALL present its worktrees without a group header.

### Requirement: No row exposes a filesystem path

No row in the tree SHALL display a filesystem path as row content. A worktree's path SHALL remain reachable through the row's tooltip and through an explicit copy action. This holds at every width — the path SHALL NOT appear when the panel is widened.

### Requirement: Strongest state wins and shape carries it

Each activity — `waiting`, `running`, `idle`, `exited` — SHALL be distinguishable by shape alone, so the vocabulary survives a monochrome theme, and the same shape SHALL be used on a worktree row and on an agent row. A worktree row SHALL reflect the strongest activity among its agents, in the precedence `waiting` > `running` > `idle` > `exited`.

#### Scenario: One waiting agent among several working ones

- **WHEN** a worktree holds one agent whose activity is `waiting` and four whose activity is `running`
- **THEN** the worktree row reads as `waiting`

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

The view SHALL distinguish, in its rendered copy, a workspace with no folder, a workspace whose folders hold no repository, an unavailable git, and a filter that matched nothing. None of these SHALL be presented with error styling, and a first load with no tree yet SHALL render placeholder rows rather than a spinner in an empty panel.

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

WHERE the create form offers permission postures, a posture that skips prompts SHALL be labelled as dangerous and SHALL NOT be the initial selection.

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

