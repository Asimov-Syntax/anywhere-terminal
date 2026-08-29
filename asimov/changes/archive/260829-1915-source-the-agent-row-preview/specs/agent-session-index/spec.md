# Spec Delta: agent-session-index — source-the-agent-row-preview

## MODIFIED Requirements

### Requirement: Metadata-only, bounded title preview, no egress

The system SHALL read session metadata (id, cwd, timestamp, model/flags) plus a single title preview,
and MAY additionally extract a single last-activity preview for a session whose transcript it can
locate by id. Each preview is transcript-derived and because it originates from message content MAY
contain sensitive material, so each SHALL be truncated to ≤120 characters and newline-stripped at read
time. The bounded metadata and previews MAY be cached on the local machine to accelerate display,
provided the cache is written owner-only (file mode `0o600`) under the extension's storage and is NEVER
transmitted off the machine. The system SHALL NOT read message bodies beyond those two preview lines,
SHALL NOT persist or cache any transcript content beyond the two bounded previews, and SHALL NOT send
any vault data off the machine.

#### Scenario: Only bounded previews leave the reader

- **WHEN** a session file contains full conversation message content
- **THEN** only the listed metadata fields plus one ≤120-char newline-stripped title preview and at
  most one ≤120-char newline-stripped last-activity preview are extracted; no further message body is
  stored, cached, or sent over IPC

#### Scenario: A preview is bounded before it travels

- **WHEN** a session's last activity is a message many kilobytes long spanning several lines
- **THEN** what crosses IPC is already one line of at most 120 characters — the full text is never
  held in the listing, sent to a view, or written to a cache

#### Scenario: A source whose store may not be opened stays unread

- **WHEN** a session's own requirements forbid opening its store for a listing, or no transcript can be
  located for it by id
- **THEN** no last-activity preview is extracted for it, and its absence is not a failure
