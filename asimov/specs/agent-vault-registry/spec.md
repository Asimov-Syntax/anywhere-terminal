# agent-vault-registry Specification
## Requirements

### Requirement: Data-driven agent definitions

The system SHALL represent each supported AI CLI agent as a data record carrying identity, ordered executable detection, session-store metadata, session-id source, launch templates, cwd policy, and optional auth environment rules.

The supported session-store formats SHALL include `jsonl`, `sqlite`, and `metadata-json`.

### Requirement: Resume and fork command templates

The system SHALL store launch command shapes as templates with `{{sessionId}}`, `{{sessionPath}}`, and `{{executable}}` substitution tokens plus optional captured-value flag fragments.

### Requirement: Built-in agent records

The registry MUST ship definitions for `claude`, `codex`, `opencode`, and `cursor`.

### Requirement: Registry-driven launch extension

Adding an agent's resume, fork, or continuation behavior SHALL require registry data rather than launcher control-flow edits.

A new history format MAY additionally require a small reader using the shared defensive file or SQLite substrate.

#### Scenario: New agent launch needs only a record

- **WHEN** a maintainer adds valid launch templates for a new agent
- **THEN** the generic launcher uses them without agent-specific launcher branches

### Requirement: Claude launch templates

Claude resume SHALL use `claude --resume {{sessionId}} [--model <m>] [--permission-mode <p>]`; fork SHALL use `claude --resume {{sessionId}} --fork-session`.

### Requirement: Codex launch templates

Codex resume SHALL use `codex resume {{sessionId}} [-m <m>] [-a <approval>] [-s <sandbox>] [-c model_reasoning_effort=<e>]`; fork SHALL use `codex fork {{sessionId}}`.

### Requirement: OpenCode launch templates

OpenCode resume SHALL use `opencode --session {{sessionId}} [-m <model>] [--agent <agent>]`; fork SHALL use `opencode --session {{sessionId}} --fork` only at version 1.1.54 or newer.

### Requirement: Cursor launch template

Cursor resume SHALL use `{{executable}} --resume {{sessionId}}`; Cursor SHALL expose no fork template in this compatibility target.

