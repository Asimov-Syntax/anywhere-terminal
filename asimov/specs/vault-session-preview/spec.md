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

The preview overlay SHALL render all session-derived text as plain text (never as HTML), so transcript content cannot inject markup. Any wrapper token that survives classification and reaches the screen SHALL be shown literally as text, never interpreted as markup. Agent icons in the overlay SHALL come only from the static agent-icon map, never constructed from session data.

The overlay SHALL show a header and body sections for First prompt, Recent activity, and Latest message; a section with no data SHALL be omitted.

### Requirement: Bounded detail retains both transcript ends

WHEN a session's transcript exceeds the on-demand detail read window, the per-agent read SHALL retain both the **head** and the **tail** of the transcript — never the head alone — so that `firstPrompt` (selected from the head) and the final assistant message (surfaced as `latestMessage` and as the trailing `{ kind: "message", role: "assistant" }` timeline item, selected from the tail) BOTH survive, and SHALL set `partial: true` with a short `limitedReason` — the omitted middle is not recoverable by requesting a larger limit. For OpenCode specifically the read SHALL retain both the earliest and the most-recent `message` and `part` rows (head ASC ∪ tail DESC), de-duplicated by row id, rather than only the earliest rows.

Whether such a read ALSO reports `truncated` SHALL depend only on whether a larger requested limit would return more of what it retained.

#### Scenario: Long OpenCode session surfaces both ends

- **WHEN** an OpenCode session's `message`/`part` rows exceed the read window
- **THEN** the detail's `firstPrompt` is still the first user message, `latestMessage` is the final assistant message text and the timeline includes its trailing assistant `message` item, and `partial` is `true`

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

### Requirement: Injected records are classified, never shown as user prompts

A transcript carries records the human never typed but that the agent stores in the user role. The system SHALL classify each user-role record as exactly one of the following, and SHALL NOT emit any but the first as a `{ kind: "message", role: "user" }` timeline item:

- **prompt** — human-typed text, emitted as a user message. A slash-command wrapper carrying arguments surfaces those arguments as the prompt.
- **plumbing** — a record the agent marks as injected/meta, a local-command caveat banner, command stdout, a bare slash-command wrapper with no arguments, or a tool-result-only record. Dropped entirely, with no timeline item.
- **notification** — a task-notification envelope or a user-interruption marker. Emitted as a `{ kind: "notice" }` item carrying the event's one-line summary, plus terminal status and result body where present.
- **compaction** — a record the agent flags as a compaction summary. Emitted as a `{ kind: "compaction" }` item carrying the summary text.

#### Scenario: A background command finishes

- **WHEN** a session's transcript contains a task-notification record for a completed background command
- **THEN** the timeline shows a notice item carrying that notification's summary and status — not a user message containing the envelope's markup

#### Scenario: The reader interrupts a response

- **WHEN** Claude stores `[Request interrupted by user]` in a user-role record carrying `interruptedMessageId`
- **THEN** the timeline shows an interruption notice, not a user message

#### Scenario: A session is continued after compaction

- **WHEN** a session's transcript contains a record the agent flags as a compaction summary
- **THEN** the timeline shows a compaction item, and no user message carrying the summary text

### Requirement: Injected blocks are excised from human messages

WHERE the agent appends an injected block inside an otherwise-human message (e.g. a system-reminder envelope), the system SHALL remove that block from the message's text and preserve the human-typed remainder as the user message; WHERE nothing remains, the record SHALL be treated as plumbing.

Classification SHALL be anchored on the record's own flags and on an envelope occupying a whole text block — never on a loose substring search — so a human prompt that quotes or discusses one of these envelopes is preserved verbatim.

#### Scenario: A human prompt quotes an envelope

- **WHEN** a human-typed prompt contains the text of a task-notification or command wrapper as quoted content
- **THEN** that prompt is still shown as a user message, with its text intact

### Requirement: Session titles use the same classification

The session's displayed title and its `firstPrompt` SHALL be selected using the same classification as the timeline, so a session whose newest or earliest activity is an injected record is never titled with that record's content.

### Requirement: Notices and compaction summaries render collapsed

The preview SHALL render a notice item and a compaction item as a single collapsed line identifying what happened, revealing the full body only on expansion, and SHALL exempt both from the run cap that hides low-signal steps behind "Show N more".

WHERE such an item carries no body beyond its one-line summary, it SHALL render as that line alone with no expand affordance.

#### Scenario: A notification carries an agent's full report

- **WHEN** a task-notification's result body is a multi-paragraph report
- **THEN** the transcript shows one line until the reader expands it, and the expanded body is rendered as prose rather than as raw markup

### Requirement: Copying a single message from the transcript

Each message in the preview transcript SHALL offer a copy affordance, revealed on hover or keyboard focus, offering three formats: **Markdown** (the body as prose, prefixed with the message's role and, where recorded, its timestamp), **JSON** (the message's structured timeline representation), and **Raw** (the message's original, untruncated record as stored by the agent).

Markdown and JSON SHALL be produced from data the preview already holds. Raw SHALL be resolved by the host from the agent's own store, keyed by the message's reader-assigned locator, and SHALL return the complete record even where the transcript view truncated that message's text. WHERE a message carries no locator, Raw SHALL be unavailable for that message rather than returning approximate content.

#### Scenario: Copying a user prompt longer than the transcript cap

- **WHEN** the reader copies a user message whose stored text exceeds the transcript's per-message length cap, as Raw
- **THEN** the clipboard holds the complete original text, not the ellipsized text on screen

#### Scenario: The host cannot resolve the record

- **WHEN** a Raw copy is requested for a message whose record can no longer be found in the agent's store
- **THEN** the affordance reports that the record is unavailable and does not confirm a copy

### Requirement: Cursor row activation opens preview

Activating a Cursor Vault row by pointer, Enter, or Space SHALL open that session's detail preview.

Resume SHALL remain a separate button, preview-header action, or context-menu action and SHALL NOT replace row activation.

#### Scenario: User activates a resumable Cursor CLI row

- **WHEN** the user clicks the row rather than its Resume action
- **THEN** the existing Vault preview opens and no terminal is launched

### Requirement: Cursor Agent CLI transcript preview

A compatible Cursor Agent CLI detail request SHALL render a bounded chronological timeline from the validated local chat store, including recognized user and assistant messages, tool activity, and available summary archives.

The reader SHALL use the canonical CLI store when compatible and MAY use the matching project transcript JSONL as an incremental mirror or fallback without emitting a duplicate session row.

The mirror SHALL NOT be read when the canonical store is readable and claims a different agent identity.

### Requirement: Cursor IDE Composer transcript preview

A compatible Cursor IDE detail request SHALL render its local Composer conversation through the same bounded Vault timeline used by other providers.

The preview SHALL identify the source as Cursor IDE and SHALL NOT expose Resume, Copy Resume Command, or Fork actions.

### Requirement: Cursor transcript capability fallback

Unsupported schema versions, missing roots, hash mismatches, oversized records, malformed data, unavailable SQLite support, and incomplete source mappings SHALL fail closed to an explicit metadata-only partial detail.

A limited detail SHALL NOT fabricate transcript messages, tool activity, token usage, model state, timestamps, cwd, sub-sessions, or message-level actions.

### Requirement: Cursor subagent run preview

Cursor Agent `Task` and `Agent` calls SHALL use the same collapsible `AGENT` card presentation as other Vault providers.

A correlated bounded result SHALL remain attached to its invocation without becoming another tool or conversation message.

### Requirement: Cursor subagent continuation identity

A continuation SHALL take its agent identity from the invocation's own bounded `resume` argument
rather than the invoking tool's name.

Sub-agent counts SHALL report distinct agents rather than invocations.

### Requirement: Cursor saved child transcript drill-down

A bounded agent identity from a recognized invocation or its correlated result SHALL open a saved child transcript only when exactly one matching file exists in the validated parent project bucket.

The child SHALL be non-resumable and addressable only through a host-issued locator the parent detail emitted.

An unissued locator SHALL be refused.

### Requirement: Cursor subagent result fallback

A missing, unsafe, absent, ambiguous, or limited child transcript SHALL leave the card on its bounded Prompt and Result without fabricating content.

Background launch and completion records MAY supply the child Agent ID only through their existing safe task correlation.

### Requirement: Cursor transcript privacy

Cursor transcript decoding SHALL remain local to the extension and SHALL be read-only, bounded, containment-checked, and WAL-aware.

Raw SQLite blobs, protobuf envelopes, encryption keys, database secrets, account identity, raw hook payloads, and unrelated database fields MUST NOT be logged, persisted in the Vault cache, copied to the clipboard, or sent over IPC.

Only normalized timeline records and explicitly sanitized recognized message records MAY be returned to the requesting Vault preview.

### Requirement: Cursor preview action parity

Decoded Cursor timeline records SHALL support the existing provider-neutral preview navigation, text copy, sanitized raw-record copy where available, and Continue in New Session flow.

Cursor Agent CLI Resume SHALL target the whole validated chat, never a message anchor; Cursor IDE and project-transcript detail identities SHALL remain non-resumable.

### Requirement: Cursor subagent continuation placement

Calls naming the same bounded agent identity SHALL render as one launch card at the first
decoded invocation's position, followed by one continuation entry at each later invocation's own
position.

Every entry SHALL carry that invocation's own bounded description and correlated result, and
SHALL open the same saved child transcript.

#### Scenario: User previews a sub-agent that was resumed twice

- **WHEN** one background launch declares a subagent type and two later calls carry only that agent's `resume` id
- **THEN** the preview shows a launch card plus two continuation entries at the positions the resumes occurred
- **AND** opening any of the three shows that agent's own saved transcript covering every turn

### Requirement: Cursor subagent declared type resolution

An invocation's declared agent type SHALL be resolved from every invocation decoded for the
session, including invocations the bounded preview window excludes from display.

When no decoded invocation declares a type for that agent, the preview SHALL omit the agent type
rather than show the invoking tool's name.

#### Scenario: The launch invocation falls outside the displayed window

- **WHEN** the bounded preview window retains a resumed agent's continuations but not its declaring launch
- **THEN** those continuations remain visible and stay labelled with the agent's declared type

### Requirement: Nested invocation turn focus

Expanding an invocation that records a bounded prompt SHALL reveal the turn that prompt began
within the fetched child transcript, scrolled into view and visually marked.

When no turn in the fetched transcript matches, the preview SHALL render the transcript
unfocused rather than mark an unrelated turn.

#### Scenario: User expands the third invocation of one agent

- **WHEN** an agent addressed by three invocations has its third expanded
- **THEN** the child transcript opens with that invocation's own turn revealed and marked, not the transcript's first turn

### Requirement: Source omission and pageability are distinct signals

`truncated` SHALL be set if and only if a larger requested detail limit would return additional timeline items. `partial`, with a short `limitedReason`, SHALL be set WHEN the read omitted source records that no larger limit can recover.

Both MAY hold at once, and the system SHALL NOT derive either signal from the other.

#### Scenario: A read that dropped source records still pages within what it retained

- **WHEN** a session's read omitted source records AND the retained items exceed the requested limit
- **THEN** the detail reports both `partial` true with a `limitedReason` and `truncated` true

### Requirement: Load-more is offered only while more transcript exists

The preview SHALL offer its load-older-messages affordance only WHILE the detail reports `truncated`, so a reader that can supply nothing further never offers to.

#### Scenario: A session whose source read dropped records is paged to its end

- **WHEN** the reader has returned every timeline item it can decode for a session whose source read omitted records
- **THEN** the detail reports `partial` true and `truncated` false, and the preview offers no load-older-messages affordance

