# vault-panel Specification

## MODIFIED Requirements

### Requirement: In-panel client-side search

The panel SHALL provide a search box that filters the body currently shown. In the sessions body it SHALL match the typed query against the entry's title, cwd, and agent. Filtering SHALL be client-side over the already-loaded data (no per-keystroke host round-trip), and the placeholder SHALL name what is being searched.

### Requirement: Grouping modes

The panel SHALL offer exactly three grouping modes — **Recent**, **Agent**, **Folder** — applied client-side over the already-loaded session list (no host round-trip), and the selected mode SHALL persist across reloads (default: Recent). Recent SHALL render a flat list ordered by modified time descending. Agent SHALL group rows by agent under a header showing the agent accent dot, display name, and entry count. Folder SHALL group rows by session `cwd` under collapsible headers and SHALL omit the per-row `cwd` chip.

## ADDED Requirements

### Requirement: Worktree view segment

The panel's segmented control SHALL carry the three grouping modes and a Worktree segment together, and selecting Worktree SHALL replace the panel body rather than regroup the session list. Grouping SHALL apply only within the sessions body, and exactly one segment SHALL read as selected at a time.

### Requirement: Switching bodies preserves what the other body held

Selecting a body SHALL leave the other body's own state — grouping mode, folder scope, scroll position, and search query — undisturbed, and returning SHALL restore it. The selected body SHALL persist across reloads.

#### Scenario: Grouping survives a round trip through the worktree body

- **WHEN** the user selects a non-default grouping mode, switches to the Worktree segment, then switches back
- **THEN** the previously selected grouping mode is still applied and still reads as selected

### Requirement: View-scoped panel controls

Every control in the panel header and toolbar SHALL act on the body currently shown, or SHALL be absent. A control whose action has no meaning in the active body SHALL be hidden rather than left able to act on the other body's data, and a control whose label names the inactive body SHALL be relabelled. No control SHALL initiate a host request scoped to a body the user is not looking at.

#### Scenario: Refresh cannot reach the session protocol from the worktree body

- **WHEN** the user activates the refresh control while the Worktree body is shown
- **THEN** no session-index request is sent to the host
