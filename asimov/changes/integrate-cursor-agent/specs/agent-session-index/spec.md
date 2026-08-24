## ADDED Requirements

### Requirement: Discover Cursor Agent CLI chats

The system SHALL enumerate Cursor Agent CLI metadata at `~/.cursor/chats/<workspace-bucket>/<chat-id>/meta.json` and use the validated `<chat-id>` as the CLI storage and Resume identity.

A missing Cursor chat root SHALL contribute zero entries without failing the aggregate list.

### Requirement: Cursor metadata compatibility profile

The CLI compatibility profile SHALL accept only `schemaVersion: 1`, metadata files no larger than 64 KiB, and chat ids matching `^[A-Za-z0-9._-]{1,200}$` without `..`.

The cwd MUST be absolute, control-character-free, and no longer than 16 KiB; timestamps MUST be finite non-negative safe integers or fall back to filesystem time.

### Requirement: Cursor CLI chat eligibility

A Cursor CLI chat SHALL be listed only when `hasConversation` is `true`, `isSubagent` is not `true`, a sibling `store.db` exists, and the stored agent identity matches the safe chat-directory name.

Eligible entries SHALL carry a newline-free title capped at 120 characters, validated cwd, validated modified time, CLI source identity, and explicit Resume capability.

#### Scenario: Cursor chat without conversation data is excluded

- **WHEN** a Cursor CLI chat has no conversation, is a subagent, lacks `store.db`, or has a mismatched stored identity
- **THEN** it does not appear as a resumable top-level Vault session

### Requirement: Discover Cursor project transcripts

The system SHALL recognize current nested and legacy flat Cursor project transcript JSONL layouts under `~/.cursor/projects/*/agent-transcripts/` as read-only transcript sources.

A project transcript SHALL be emitted as a standalone non-resumable entry only when its source identity and cwd can be validated and it does not duplicate a validated Cursor CLI chat.

Subagent transcript files SHALL NOT appear as independent top-level sessions.

### Requirement: Discover Cursor IDE Composer sessions

The system SHALL enumerate supported Cursor IDE Composer history from the local Cursor `globalStorage/state.vscdb` store without requiring Cursor Agent CLI to be installed.

Cursor IDE entries SHALL use a source-qualified identity and SHALL NOT claim CLI Resume or Fork capability.

A missing, locked, unsupported, or malformed IDE store SHALL degrade without failing Cursor CLI or other Vault providers.

### Requirement: Cursor source identity and deduplication

Cursor Agent CLI, project transcript, and Cursor IDE Composer identifiers SHALL remain distinct storage domains.

When a project transcript and validated CLI store identify the same chat in the same storage context, the system SHALL emit one CLI entry and use the project transcript only as a detail source or fallback.

The system SHALL NOT pass Cursor IDE or unvalidated project-transcript identifiers to `agent --resume`.

### Requirement: Safe Cursor session lookup

Malformed, unsupported, unsafe, or ambiguous Cursor sessions SHALL be skipped and counted unreadable without failing other providers.

Before emitting CLI entries, the reader SHALL group candidates by chat id and omit every duplicate-id group from both list and point lookup.

#### Scenario: Duplicate CLI chat id is ambiguous

- **WHEN** one CLI chat id exists under multiple Cursor workspace buckets without a unique validated storage context
- **THEN** every ambiguous candidate is omitted and counted unreadable

### Requirement: Cursor indexing is metadata-only

Session listing SHALL NOT decode transcript message bodies, raw database blobs, database secrets, prompt history, or tool output.

Only bounded entry metadata permitted for other Vault agents MAY leave the index reader; transcript content MAY be decoded only by an explicit detail request under the preview contract.
