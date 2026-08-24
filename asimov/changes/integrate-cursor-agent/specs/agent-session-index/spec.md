## ADDED Requirements

### Requirement: Discover Cursor Agent CLI chats

The system SHALL enumerate Cursor Agent CLI metadata at `~/.cursor/chats/<workspace-bucket>/<chat-id>/meta.json` and use the validated `<chat-id>` as the CLI storage and Resume identity.

A missing Cursor chat root SHALL contribute zero entries without failing the aggregate list.

### Requirement: Cursor metadata compatibility profile

The CLI compatibility profile SHALL accept only `schemaVersion: 1`, metadata files no larger than 64 KiB, and chat ids matching `^[A-Za-z0-9._-]{1,200}$` without `..`.

The cwd MUST be absolute, control-character-free, and no longer than 16 KiB; timestamps MUST be finite non-negative safe integers or fall back to filesystem time.

### Requirement: Cursor CLI chat eligibility

A Cursor CLI chat SHALL be listed only when `hasConversation` is `true`, `isSubagent` is not `true`, a sibling `store.db` exists, and its safe directory name is unique across the bounded CLI roots.

Eligible entries SHALL carry a newline-free title capped at 120 characters, validated cwd and modified time, CLI source identity, and Resume source capability.

#### Scenario: Cursor chat without conversation data is excluded

- **WHEN** a Cursor CLI chat has no conversation, is a subagent, lacks `store.db`, or has an ambiguous directory identity
- **THEN** it does not appear as a resumable top-level Vault session

### Requirement: Cursor deferred store identity proof

Because supported schema-1 `meta.json` omits the stored agent identity, listing SHALL use the unique safe directory name as a candidate identity without opening `store.db`.

Detail, Resume, and Copy Resume Command SHALL prove the bounded store identity before decoding content or performing the requested action.

#### Scenario: Explicit action finds a mismatched store identity

- **WHEN** the bounded store identity differs from the candidate chat-directory name
- **THEN** transcript decoding and the requested action fail closed without substituting another identifier

### Requirement: Discover Cursor project transcripts

The system SHALL recognize current nested and legacy flat Cursor project transcript JSONL layouts under `~/.cursor/projects/*/agent-transcripts/` as read-only transcript sources.

Project transcripts SHALL NOT appear as standalone Vault rows and MAY be used only as exact same-project CLI mirrors or exact child detail referenced by a recognized parent `Task` or `Agent` result.

### Requirement: Discover Cursor IDE Composer sessions

The system SHALL enumerate supported Cursor IDE Composer history from the local Cursor `globalStorage/state.vscdb` store without requiring Cursor Agent CLI to be installed.

Cursor IDE entries SHALL use a source-qualified identity and SHALL NOT claim CLI Resume or Fork capability.

A missing, locked, unsupported, or malformed IDE store SHALL degrade without failing Cursor CLI or other Vault providers.

### Requirement: Cursor source identity and deduplication

Cursor Agent CLI, project transcript, and Cursor IDE Composer identifiers SHALL remain distinct storage domains.

A same-project CLI mirror SHALL remain detail-only, and Cursor IDE or project identifiers SHALL NOT be passed to `agent --resume`.

### Requirement: Cursor child transcript identity

A child transcript SHALL be addressed only through a source-qualified project identity derived from the validated parent project and a bounded child Agent ID.

The system SHALL NOT globally match child ids across project buckets or pass them to `agent --resume`.

### Requirement: Safe Cursor session lookup

Malformed, unsupported, unsafe, or ambiguous Cursor sessions SHALL be skipped and counted unreadable without failing other providers.

Before emitting CLI entries, the reader SHALL group candidates by chat id and omit every duplicate-id group from both list and point lookup.

#### Scenario: Duplicate CLI chat id is ambiguous

- **WHEN** one CLI chat id exists under multiple Cursor workspace buckets without a unique validated storage context
- **THEN** every ambiguous candidate is omitted and counted unreadable

### Requirement: Cursor indexing is metadata-only

Session listing SHALL NOT decode transcript message bodies, raw database blobs, database secrets, prompt history, or tool output.

Only bounded entry metadata permitted for other Vault agents MAY leave the index reader; transcript content MAY be decoded only by an explicit detail request under the preview contract.
