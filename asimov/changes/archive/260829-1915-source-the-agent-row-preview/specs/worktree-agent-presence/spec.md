# Spec Delta: worktree-agent-presence — source-the-agent-row-preview

## ADDED Requirements

### Requirement: An agent row's preview line says what its session last did

An agent row whose session the reader covers SHALL carry a preview line holding that session's last
activity. A row the reader does not cover — no resolved session, a source it has no transcript path
for, or a transcript it cannot read — SHALL carry no preview line at all, and SHALL NOT carry a
placeholder in its place.

#### Scenario: A working session says what it is working on

- **WHEN** a row's session has recorded activity and its transcript is readable
- **THEN** the row carries a preview line holding that session's last activity

#### Scenario: A row the reader does not cover

- **WHEN** a row has no resolved session, or its session's content is not in a transcript the reader
  has a path to, or that transcript cannot be read
- **THEN** the row carries no preview line, no placeholder stands in for one, and the scan reports no
  degraded source on that account

### Requirement: A missing preview is a normal row, not a degraded scan

Carrying no preview SHALL NOT mark a presence scan or any of its sources as degraded. A preview is
optional row enrichment, never an authoritative presence source: no row's identity, activity,
ranking, or freshness SHALL be derived from it.

#### Scenario: A scan over rows the reader does not cover

- **WHEN** every row in a scan comes from a source the preview reader has no transcript path for
- **THEN** the scan reports no degraded source, and each row renders normally without a second line

### Requirement: A preview is bounded and single-line before it travels

A preview SHALL be reduced to a single line of at most 120 characters at the point it is read, before
it is placed on a row. No unbounded or multi-line preview text SHALL cross the host/webview boundary
or enter any comparison the view uses to decide whether to redraw.

#### Scenario: A long multi-line last activity

- **WHEN** a session's last activity spans several lines and many hundreds of characters
- **THEN** the row carries one line of at most 120 characters, and the untruncated text is never sent

### Requirement: A scan that finds no new activity reads no transcript

A presence scan SHALL read a session's transcript only when that transcript's own freshness stamp has
moved since the preview it already holds was read. A scan over sessions whose stamps have not moved
SHALL perform no transcript read at all, however often it runs, and the number of filesystem calls
the previews cost SHALL NOT grow with the rate at which presence rebuilds.

#### Scenario: Repeated scans over quiet sessions

- **WHEN** presence scans repeatedly while no session's transcript has changed
- **THEN** no transcript is read after the first, and every row keeps the preview it already carried

#### Scenario: A session that has moved on

- **WHEN** a session's transcript stamp has moved since its preview was read
- **THEN** that session's transcript is read again and its row's preview is replaced

#### Scenario: Presence rebuilding faster than previews change

- **WHEN** presence rebuilds repeatedly within a short interval
- **THEN** a session is re-examined at most once per interval, so the filesystem cost of the previews
  is set by that interval and not by the rebuild rate

### Requirement: A preview is message text, not a pane title

A preview SHALL NOT be treated as a pane title for the purposes of stripping decorative animation
frames. Text that a title's stripper would treat as a leading spinner frame — a lone `-`, `*`, `/`,
`\` or `|` followed by whitespace — SHALL survive intact in a preview, because in message text it is
ordinary content.

#### Scenario: A preview that opens with a bullet

- **WHEN** a session's last activity begins with `- ` or `* ` followed by ordinary prose
- **THEN** the preview shows that text with its leading marker intact, and a preview consisting only
  of such a marker still renders as itself rather than as an empty line
