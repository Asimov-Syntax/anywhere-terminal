# vault-session-preview Specification
## Requirements

### Requirement: On-demand session detail read

The system SHALL, on request for a single session entry, read that session's content and return a bounded `VaultSessionDetail` carrying: `firstPrompt` (the first real user message text, truncated), `recentActivity` (an ordered list of the most-recent steps — each a tool **call** `{ kind: "tool", tool, detail?, diff? }` or a subagent invocation `{ kind: "subagent", name, prompt? }`), `latestMessage` (`{ role, text, timestamp }`), and `stats` (`{ messageCount, toolCount, subagentCount, tokenCount? }`).

The read SHALL be per-agent — Claude: stream the session `jsonl`; OpenCode: read `session`/`message`/`part` rows; Codex: parse the per-session rollout `jsonl` when present — SHALL skip malformed records and continue, and SHALL bound output (cap `recentActivity` to the most-recent steps and truncate each text field). `firstPrompt` and `latestMessage` SHALL be selected independently of the bounded `recentActivity` window (a long session MUST still surface its first prompt), and SHALL exclude synthetic, compaction, summary, and subagent-sidechain records. `recentActivity` SHALL record tool **calls** and subagent invocations only, never tool results as standalone steps. `tokenCount` SHALL be populated only when derivable from the agent's stored usage; otherwise it is omitted.

WHEN only an index is available for the session and no transcript can be read (e.g. a Codex session with no rollout file), the detail MAY be **partial** — omitting `recentActivity` and `latestMessage` — and SHALL set `partial: true` with a short `limitedReason`, which the preview surfaces so the session does not appear broken.

### Requirement: Session detail IPC

The webview SHALL request detail via a `requestVaultSessionDetail` message carrying the entry `id` only, and the host SHALL reply with `vaultSessionDetailResponse` carrying the same `entryId` plus either the `VaultSessionDetail` or an `error` marker. The host SHALL resolve the session's on-disk location itself from the session id within the agent's store (never from a webview-supplied path), holding no detail cache and not re-listing the full index.

### Requirement: Nested sub-sessions fold into the parent

WHERE an agent records a subagent or workflow sub-session as a distinct stored transcript linked to a parent (OpenCode: a `session` row with `session.parent_id`; Claude: an `agent-<id>.jsonl` under `<parentSessionId>/subagents/` with an `agent-<id>.meta.json` carrying `toolUseId`; Codex: a child `threads` row linked by `thread_spawn_edges`, child `source.subagent.thread_spawn.parent_thread_id`, or first-line `session_meta.payload.source.subagent.thread_spawn.parent_thread_id`), the system SHALL NOT list those children as standalone entries — the list SHALL show only top-level sessions. The parent's `VaultSessionDetail` SHALL embed each **direct** child as a `timeline` item of kind `subagentSession` (`{ entryId, title, firstMessage?, agent?, timestamp? }`), placed chronologically and bounded with the rest of the timeline.

For Claude, all subagents of a session are stored flat under `<parentSessionId>/subagents/` regardless of nesting depth, and each child's `agent-<id>.meta.json` carries the `toolUseId` of the `Agent`/`Task` `tool_use` that spawned it. A transcript's **direct** children are therefore exactly the subagents whose `meta.toolUseId` appears as a `tool_use` id within **that** transcript (the root session transcript, or a subagent's own transcript). The system SHALL scope each Claude transcript's embedded `subagentSession` items to its direct children only — a subagent spawned inside another subagent SHALL NOT appear under the root. Each `subagentSession` SHALL be placed at its spawning `tool_use` (matched by `toolUseId`). WHERE a child carries no `toolUseId` (legacy transcripts written before this field), the system SHALL fall back to matching by the spawning call's description and, if still unmatched, to chronological placement under the root — so existing sessions do not regress. `stats.subagentCount` SHALL count the direct children of the rendered transcript, not the whole subtree.

For Codex child placement, timestamp precedence SHALL be: matched parent `collab_agent_spawn_end.timestamp`, child first-line `session_meta.timestamp`, optional child `threads.created_at_ms`, then child `threads.updated_at_ms`. Codex child labels SHALL prefer the child thread title, then first user message, then parent spawn prompt, then `Subagent`. Codex child agent labels SHALL prefer `agent_nickname`, then `agent_role`, then a generic subagent label. OpenCode children SHALL be placed by the child's creation time.

The preview SHALL render each `subagentSession` as a collapsed block showing its title and first message. Expanding it SHALL fetch the child's detail on demand (reusing the standard detail request, resolving the child by its `entryId`) and render the child's transcript nested within the block. WHERE a Claude subagent transcript is stored as a sidechain file, the on-demand read SHALL include its `isSidechain` records (that file IS the subagent conversation) AND SHALL itself embed that subagent's own direct children as nested `subagentSession` items. WHERE a Codex child thread is expanded, the on-demand read SHALL resolve the child by its normal `codex:<childThreadId>` id and parse its own rollout or index row like any other Codex session. A nested child's own `subagentSession` items SHALL themselves be expandable, supporting arbitrary nesting depth (bounded by the agent runtime's own spawn-depth cap) without eagerly loading the whole tree. The host SHALL resolve every child transcript from its id within the agent's store (containment-checked), never from a webview-supplied path.

#### Scenario: Claude nested subagent nests under its real parent, not the root

- **WHEN** a Claude session's root agent spawns subagent A, and A spawns subagent B (B's `meta.toolUseId` appears in A's transcript, not the root's)
- **THEN** the root `VaultSessionDetail` timeline contains a `subagentSession` for A but NOT for B, and expanding A fetches A's detail whose timeline contains a `subagentSession` for B

#### Scenario: Codex child appears inside parent preview

- **WHEN** a Codex parent rollout contains `collab_agent_spawn_end.new_thread_id` for a child thread
- **THEN** the parent detail timeline contains one `subagentSession` item with `entryId` `codex:<childThreadId>` at that event timestamp

#### Scenario: Codex partial detail still shows known children

- **WHEN** a Codex parent has no readable rollout file but direct child metadata is available from SQLite
- **THEN** the parent detail MAY be partial and SHALL still include the direct child `subagentSession` stubs that can be discovered from the index

### Requirement: Safe preview rendering

The preview overlay SHALL render all session-derived text as plain text (never as HTML), so transcript content cannot inject markup. Wrapper tokens present in raw content (e.g. `<command-message>`) SHALL be displayed literally. Agent icons in the overlay SHALL come only from the static agent-icon map, never constructed from session data.

The overlay SHALL show a header and body sections for First prompt, Recent activity, and Latest message; a section with no data SHALL be omitted.

### Requirement: Bounded detail retains both transcript ends

WHEN a session's transcript exceeds the on-demand detail read window, the per-agent read SHALL retain both the **head** and the **tail** of the transcript — never the head alone — so that `firstPrompt` (selected from the head) and the final assistant message (surfaced as `latestMessage` and as the trailing `{ kind: "message", role: "assistant" }` timeline item, selected from the tail) BOTH survive, and SHALL set `truncated: true`. For OpenCode specifically the read SHALL retain both the earliest and the most-recent `message` and `part` rows (head ASC ∪ tail DESC), de-duplicated by row id, rather than only the earliest rows.

#### Scenario: Long OpenCode session surfaces both ends

- **WHEN** an OpenCode session's `message`/`part` rows exceed the read window
- **THEN** the detail's `firstPrompt` is still the first user message, `latestMessage` is the final assistant message text and the timeline includes its trailing assistant `message` item, and `truncated` is `true`

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

