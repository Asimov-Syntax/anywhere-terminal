# vault-session-preview Delta

## MODIFIED Requirements

### Requirement: Safe preview rendering

The preview overlay SHALL render all session-derived text as plain text (never as HTML), so transcript content cannot inject markup. Any wrapper token that survives classification and reaches the screen SHALL be shown literally as text, never interpreted as markup. Agent icons in the overlay SHALL come only from the static agent-icon map, never constructed from session data.

The overlay SHALL show a header and body sections for First prompt, Recent activity, and Latest message; a section with no data SHALL be omitted.

## ADDED Requirements

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
