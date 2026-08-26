# vault-panel Specification
## Requirements

### Requirement: Searchable vault panel

The system SHALL present the aggregated session list in a webview panel. Each row SHALL show, on a single line: the agent badge rendering the agent's **real brand icon** (inline SVG themed via the agent's accent color), the title preview, a `cwd` chip (folder icon + leaf segment), a relative timestamp, and an **icon-only Resume action revealed on row hover/focus**. Rows SHALL NOT render a fork action.

### Requirement: In-panel client-side search

The panel SHALL provide a search box that filters the body currently shown. In the sessions body it SHALL match the typed query against the entry's title, cwd, and agent. Filtering SHALL be client-side over the already-loaded data (no per-keystroke host round-trip), and the placeholder SHALL name what is being searched.

### Requirement: Open command

The system SHALL register a command that opens (expands) and focuses the vault section.

### Requirement: Stacked collapsible vault section

The vault SHALL be a persistent collapsible section stacked directly above the file tree in a shared sidebar region; both SHALL be visible at the same time (no panel exclusivity). The vault SHALL collapse to a header strip and expand to share the region with the file tree, toggled by its own header control AND a button in the file-tree header toolbar. The collapsed/expanded state SHALL persist across reloads, defaulting to collapsed. Collapsing or expanding the vault SHALL NOT disturb the file tree's own state (position/size/expansion).

#### Scenario: Toggling the vault leaves the file tree intact

- **WHEN** the file tree is visible (with a chosen position/size) and the user expands the vault via the header toolbar button
- **THEN** the vault section opens directly above the file tree (both visible), the file tree keeps its position/size, and the expanded state is persisted so a reload restores it

### Requirement: Active-folder scope filter

The vault SHALL provide a "This folder only" toggle that, when enabled, scopes the visible list to sessions whose cwd equals or is within the active terminal pane's working directory. The toggle state SHALL persist across reloads (default off). The scope SHALL update when the user selects a different pane or switches tabs. When enabled with no resolvable active-pane cwd, the vault SHALL fall back to showing all sessions. Additionally, the vault SHALL re-read its list whenever it becomes visible (expand/open) and whenever the active pane changes while expanded, since the agents' on-disk files are the source of truth.

#### Scenario: Folder scope follows the focused pane

- **WHEN** "This folder only" is enabled and the user focuses a terminal pane whose cwd is `/work/repo`
- **THEN** the vault lists only sessions whose cwd is `/work/repo` or a subdirectory of it, and re-scopes when a pane with a different cwd is focused

### Requirement: Refresh on open

The panel SHALL re-request the session index from the host each time it is opened/focused. The host MAY
serve a persisted cache immediately for instant display, but SHALL always follow with a refresh that
re-reads the agents' on-disk stores (the source of truth) and sends the reconciled list. The host SHALL
treat the persisted cache as a non-authoritative accelerator only: it is rebuilt from the on-disk stores on
every open and discarded when missing, unreadable, or of an unrecognized version.

### Requirement: Empty and partial-failure states

WHEN the aggregated index is empty, the panel SHALL render an empty-state message. WHEN a search or filter yields no matching rows, the panel SHALL render a **distinct no-match state** (not the empty state). WHEN the index reports N unreadable entries, the panel SHALL show a non-blocking inline notice with the count and a **"Details" affordance that, when activated, reveals the per-source reasons** those entries were skipped, without hiding the entries that did load.

### Requirement: Grouping modes

The panel SHALL offer exactly three grouping modes — **Recent**, **Agent**, **Folder** — applied client-side over the already-loaded session list (no host round-trip), and the selected mode SHALL persist across reloads (default: Recent). Recent SHALL render a flat list ordered by modified time descending. Agent SHALL group rows by agent under a header showing the agent accent dot, display name, and entry count. Folder SHALL group rows by session `cwd` under collapsible headers and SHALL omit the per-row `cwd` chip.

### Requirement: Row context menu

Right-clicking a row SHALL open a context menu offering: Resume in New Tab, Open, Reveal in Finder, Copy File Path, Copy Resume Command, Open Working Directory. The file-targeting items (Open, Reveal in Finder, Copy File Path) SHALL be shown only when the session is backed by an on-disk file; for sessions stored only in a database they SHALL be omitted. Each item SHALL act by sending the entry `id` to the host (which derives any path itself); the webview SHALL NOT send a file path as the action target. There SHALL be no separate "⋯" trigger — the menu is reached only by right-click.

#### Scenario: Database-backed session hides file actions

- **WHEN** the user right-clicks a row whose agent stores sessions in a database (no session file path)
- **THEN** the context menu omits Open, Reveal in Finder, and Copy File Path, while Resume in New Tab, Copy Resume Command, and Open Working Directory remain

### Requirement: Folder-scope filter ("This folder only")

The panel SHALL provide a "This folder only" checkbox that, when checked, restricts the list to sessions whose `cwd` is equal to or inside the focused terminal pane's current working directory. The scoping cwd SHALL be the pane's REAL cwd as resolved by the host (the pane's live process cwd, else its shell-integration-tracked cwd, else its spawn cwd) — it SHALL NOT depend on the webview observing an OSC 7 sequence, so the filter works without shell integration. The panel SHALL re-scope when the focused pane changes and SHALL reflect a `cd` within the focused pane (the scoping cwd is re-resolved when the active pane emits output). The checkbox state SHALL persist across reloads (default: off). WHEN no cwd can be resolved for the pane, the filter SHALL fall back to the workspace root, and WHEN neither resolves it SHALL show all sessions rather than hiding everything.

#### Scenario: Switching the focused pane re-scopes the list

- **WHEN** "This folder only" is on and the user focuses a different terminal pane whose working directory differs
- **THEN** the list re-scopes to the newly focused pane's folder, even when neither pane emits OSC 7

#### Scenario: `cd` in the focused pane updates the scope

- **WHEN** "This folder only" is on and the user changes directory in the focused terminal
- **THEN** the list re-scopes to the new folder shortly after the prompt returns, without requiring shell integration

### Requirement: Session preview activation

Activating a row (click, Enter, or Space) SHALL open a floating session-preview overlay anchored near the activated row within the panel; pressing Esc or clicking outside SHALL close it. Opening the preview SHALL request the session's detail on demand (see the `vault-session-preview` capability). At most one preview SHALL be open at a time, and a detail response for a session that is no longer the active preview SHALL be ignored (no stale render).

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

