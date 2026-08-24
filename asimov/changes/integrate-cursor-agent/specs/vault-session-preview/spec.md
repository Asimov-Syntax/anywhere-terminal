## ADDED Requirements

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

Calls naming the same bounded agent identity SHALL render as one card at the first invocation's position, carrying that agent's declared type, opening description, and newest correlated result.

A continuation SHALL take its agent identity from the invocation's own bounded `resume` argument rather than the invoking tool's name.

Sub-agent counts SHALL report distinct agents rather than invocations.

#### Scenario: User previews a sub-agent that was resumed twice

- **WHEN** one background launch declares a subagent type and two later calls carry only that agent's `resume` id
- **THEN** the preview shows a single card labelled with the declared type
- **AND** expanding it opens that agent's own saved transcript covering every turn

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
