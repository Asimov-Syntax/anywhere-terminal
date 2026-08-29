# Spec Delta: agent-session-index — source-the-agent-row-preview

## MODIFIED Requirements

### Requirement: Metadata-only, bounded title preview, no egress

A listing SHALL read session metadata (id, cwd, timestamp, model/flags) plus a bounded title preview,
MAY additionally extract a bounded last-activity preview from a session whose transcript it already
has a path to, and SHALL NOT read message bodies beyond those two lines. Each preview SHALL be
truncated to ≤120 characters and newline-stripped **at the point it is read**. Previews and metadata
MAY be cached locally in an owner-only (`0o600`) store; no vault data SHALL be sent off the machine.

This governs the **listing** path only; detail reads are authorized separately.

#### Scenario: Only bounded previews leave the reader

- **WHEN** a session file contains full conversation message content
- **THEN** only the listed metadata fields plus one ≤120-char newline-stripped title preview and at
  most one ≤120-char newline-stripped last-activity preview are extracted; no further message body is
  stored, cached, or sent over IPC

#### Scenario: A preview is bounded before it travels

- **WHEN** a session's last activity is a message many kilobytes long spanning several lines
- **THEN** what crosses IPC is already one line of at most 120 characters — the full text is never
  held in the listing, sent to a view, or written to a cache

#### Scenario: A source a listing may not open stays unread

- **WHEN** a session's own requirements forbid a listing from opening its store
- **THEN** no last-activity preview is extracted for it, and its absence is not a failure
