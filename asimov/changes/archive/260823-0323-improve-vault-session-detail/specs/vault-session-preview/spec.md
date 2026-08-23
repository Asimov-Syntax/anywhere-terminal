# vault-session-preview Spec Delta

## MODIFIED Requirements

### Requirement: Safe preview rendering

The preview overlay SHALL render all session-derived text as plain text (never as HTML), so transcript content cannot inject markup. Wrapper tokens present in raw content (e.g. `<command-message>`) SHALL be displayed literally. Agent icons in the overlay SHALL come only from the static agent-icon map, never constructed from session data.

The overlay SHALL show a header and body sections for First prompt, Recent activity, and Latest message; a section with no data SHALL be omitted.

## ADDED Requirements

### Requirement: Session detail header composition

The header's title row SHALL carry the agent badge, the session title, and the Resume, Expand and Close actions only — no per-message navigation controls and no git branch.

Below the title row the header SHALL show a meta block of at most three labelled rows: **Folder** (the working directory's last path segment, followed by the session's git branch WHERE the agent recorded one), **Session** (the session id, followed by the transcript path WHERE the session is file-backed), and **Activity** (the session's age relative to now, followed by the activity summary once the detail has been read). Each WHERE-guarded segment SHALL be omitted entirely rather than shown empty.

#### Scenario: Age is shown before the detail arrives

- **WHEN** the overlay opens and the session detail has not yet been read
- **THEN** the Activity row already shows the session's relative age, and gains the activity summary in place when the detail arrives

#### Scenario: Session without a stored transcript shows the id alone

- **WHEN** the overlay opens for a session that is not file-backed
- **THEN** the Session row shows the session id with no path segment

### Requirement: Copying session paths and ids from the preview

The working directory, the git branch, the session id, and the transcript path SHALL each be individually copyable from the meta block: a value SHALL reveal a copy affordance on hover, SHALL disclose its untruncated text on hover, and activating it SHALL place that full untruncated text on the system clipboard and confirm the copy in place.

The copy SHALL be confirmed only once it has actually been placed on the clipboard, and concurrent copies SHALL resolve in the order they were activated, so the clipboard always holds the value of the most recently activated affordance.

The overlay SHALL NOT ask the host to act on any path it supplies.

#### Scenario: Two copies activated in quick succession

- **WHEN** the folder value is activated and the session id is activated immediately afterwards
- **THEN** the clipboard holds the session id, not the working directory

#### Scenario: The clipboard rejects the write

- **WHEN** activating a copy affordance fails to reach the clipboard
- **THEN** the affordance does not confirm a copy

### Requirement: Keyboard navigation between user messages

WHILE the overlay is open and no text input has focus, `Alt+ArrowUp` and `Alt+ArrowDown` SHALL scroll the transcript to the previous and next user message respectively, and SHALL NOT be delivered to the terminal. While the session context menu is open they SHALL NOT navigate, but SHALL still be withheld from the terminal.

#### Scenario: The context menu is open

- **WHEN** `Alt+ArrowUp` is pressed while the row context menu is open
- **THEN** the transcript does not scroll and the terminal does not receive the key

### Requirement: Renaming a session from the preview title

Double-clicking the preview title SHALL open an inline editor seeded with the session's current display name, applying the same rename as the session list's own rename affordance. `Enter` or losing focus SHALL commit; `Escape` SHALL cancel and restore the previous title, and SHALL NOT close the overlay. Single-clicking or dragging the title SHALL continue to move the card.

An open editor SHALL survive a live transcript update, so a repaint can never discard what the user has typed. A committed rename SHALL be reflected in the title still on screen. Closing the overlay SHALL end any open editor, and a subsequently opened session SHALL NOT present the previous session's title, actions or metadata.

#### Scenario: A live update arrives mid-edit

- **GIVEN** the title editor is open with unsaved text
- **WHEN** the session's transcript grows and the preview repaints
- **THEN** the editor is still open and still holds that text
