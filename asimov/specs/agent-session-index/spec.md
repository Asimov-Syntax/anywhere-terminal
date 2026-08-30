# agent-session-index Specification
## Requirements

### Requirement: Read Claude Code sessions

The system SHALL enumerate Claude sessions from `<root>/projects/<encoded-cwd>/*.jsonl`, where `root` is `$CLAUDE_CONFIG_DIR` when set else `~/.claude`, and `encoded-cwd` is the project cwd with every `/` replaced by `-`. For each file the session id SHALL be the filename without the `.jsonl` extension, and the entry SHALL carry `cwd`, `gitBranch`, `permissionMode`, `model` (from the first assistant message's `message.model`), a `title` preview (from the first user message), and `modified` (the file's mtime).

### Requirement: Read Codex sessions

The system SHALL read Codex sessions from the `threads` table of `<codexDir>/state_5.sqlite` (columns `id, rollout_path, cwd, title, model, git_branch, approval_mode, sandbox_policy, reasoning_effort, first_user_message, updated_at_ms`) filtered `WHERE archived = 0` and ordered `updated_at_ms DESC`, where `codexDir` is `$CODEX_HOME` when set else `~/.codex`, and the SQLite file MAY be relocated to `$CODEX_SQLITE_HOME` when set. When the SQLite store is absent or unreadable, the system SHALL fall back to scanning `<codexDir>/sessions/**/*.jsonl` (reading the first line's `session_meta.payload.cwd`).

The system SHALL exclude Codex subagent child threads from the top-level aggregate list. A Codex thread is a child when either `thread_spawn_edges` records it as `child_thread_id`, or its `threads.source` / first-line `session_meta.payload.source` parses as `subagent.thread_spawn` with a non-empty `parent_thread_id`. Excluding a child thread is a normal grouping decision and SHALL NOT increase the unreadable count. The root list limit SHALL be applied after child filtering, so a store with many recent child threads still returns up to the configured number of root sessions. Older Codex stores that lack `thread_spawn_edges`, `threads.source`, or first-line subagent metadata SHALL continue to list sessions using the existing root behavior rather than failing the aggregate list.

When SQLite exists but does not expose usable child metadata, the system MAY scan Codex rollout JSONL first lines to discover child parentage before returning the root list. That DB-present metadata scan SHALL read only first-line `session_meta` records and SHALL be skipped when the SQLite query itself returns `query-error`.

The persisted vault list cache SHALL be invalidated for this behavior change, either by bumping the cache schema version or by rejecting stale Codex `ReaderListCache` values before reuse, so previously cached child threads do not remain visible as root rows.

#### Scenario: Codex child thread is hidden from top-level list

- **WHEN** the Codex store contains a root thread and a child thread linked by `thread_spawn_edges`
- **THEN** the Codex index includes the root thread and omits the child thread without incrementing unreadable entries

#### Scenario: Root limit is applied after child filtering

- **WHEN** more recent Codex rows are child threads and older rows are root threads
- **THEN** the returned root list is filled from eligible root rows up to the configured limit instead of filtering a pre-limited child-heavy result to a short list

#### Scenario: JSONL fallback hides Codex child thread

- **WHEN** SQLite is unavailable and a rollout JSONL first line has `session_meta.payload.source.subagent.thread_spawn.parent_thread_id`
- **THEN** the JSONL fallback omits that child from the top-level Codex list

### Requirement: Read OpenCode sessions

The system SHALL read OpenCode sessions from the `session` table of `<dataDir>/opencode.db`, ordered `time_updated DESC`, mapping `session id = s.id`, `cwd = s.directory`, `title = s.title`, `modified = s.time_updated`, and deriving `model`/`agent` from the latest assistant `message` row for that session, where `dataDir` is `$XDG_DATA_HOME/opencode` when set else `~/.local/share/opencode` (the same location on every OS — OpenCode resolves it via the OS-agnostic `xdg-basedir`, NOT `%APPDATA%`). OpenCode has no fallback store; when the DB is absent, OpenCode contributes zero entries (not an error).

### Requirement: WAL-safe read-only SQLite access

For any SQLite-backed store, the system SHALL read a consistent snapshot without disturbing the live agent: snapshot the `.sqlite`/`.db` file plus its `-wal` and `-shm` sidecars (when present) into a temporary directory, query the snapshot in **read-only** mode, then delete the temporary directory. The system SHALL NOT query the live store in place (a read-only open of a live WAL store can return an empty result instead of an error, which is indistinguishable from a genuinely-empty session). To keep the snapshot cheap for large stores, the snapshot SHALL be created as a copy-on-write clone where the filesystem supports it (e.g. APFS/Btrfs reflink), falling back to a byte copy otherwise; both yield identical, independent snapshot semantics.

The system SHALL access SQLite preferring the built-in `node:sqlite` module (native row values), falling back to the host `sqlite3` binary in read-only JSON mode WHEN `node:sqlite` is unavailable — both without any new native dependency. (The `sqlite3 -json` formatter is pathologically slow for rows with large text/blob values, so it MUST NOT be the preferred engine where `node:sqlite` exists.) The SQLite read SHALL return a discriminated result distinguishing `ok` / `no-db` / `no-sqlite3` / `query-error` (not a bare empty array), so callers can tell "store absent" from "genuinely empty" from "tooling broken." WHEN neither SQLite engine is available, the read SHALL return `no-sqlite3` and SQLite-backed agents SHALL degrade to their fallback (Codex JSONL) or to zero entries (OpenCode) without raising an error; a `query-error` SHALL be counted as unreadable and surfaced, not silently dropped. Both engines SHALL query the temporary copy (never the live store); the `node:sqlite` engine SHALL be loaded inside a guard so an unsupported runtime degrades to `no-sqlite3` (then the CLI) rather than throwing.

### Requirement: Aggregate and sort sessions

The system SHALL merge entries from all enabled agents into a single list sorted by `modified` descending, each entry tagged with its agent `id`. Each entry id SHALL be namespaced by agent (e.g. `opencode:<sid>`) so ids never collide across agents.

### Requirement: Defensive, non-fatal parsing

The system SHALL skip any individual session entry that fails to parse without aborting the rest of the index, and SHALL report a count of unreadable entries. A missing store directory or file for an agent SHALL yield zero entries for that agent, never an error that breaks the aggregate list.

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

### Requirement: Surface workflow sub-agents

The system SHALL discover `/workflow` runs for a Claude session and surface each run as ONE nested group child in that session's detail timeline. Workflow run manifests live at `<projects>/<dir>/<parentId>/workflows/<wfId>.json` and the per-agent transcripts at `<projects>/<dir>/<parentId>/subagents/workflows/<wfId>/agent-*.jsonl` (each `isSidechain:true`). The group node's label SHALL come from the manifest (`workflowName`, `agentCount`, `status`) — NOT from the agents' `.meta.json`, which carries only `{agentType:"workflow-subagent"}`. Expanding the group SHALL render a manifest-backed `workflowBoard` built from the manifest's `workflowProgress` (phases + per-agent rows), and selecting an agent SHALL lazy-load that agent's transcript by its `:wfagent:` id. WHERE the manifest has no usable `workflowProgress` (absent, empty, or carrying no `workflow_agent` entries), the group SHALL fall back to listing its agents by first prompt (bounded). Because the parent's `Workflow` tool call carries no run id, group placement SHALL use the manifest's start time. A workflow agent is one-shot (no back-and-forth) and SHALL render as a single node, not segmented.

The entry-id contract for workflow children is: group `claude:<parentId>:workflow:<wfId>`, agent leaf `claude:<parentId>:wfagent:<wfId>:<stem>`. `<wfId>` SHALL match `wf_[A-Za-z0-9_-]+` and `<stem>` SHALL match `agent-[A-Za-z0-9]+`; the resolved transcript path SHALL be containment-checked under the Claude projects root (traversal rejected), never trusting any webview-supplied path.

### Requirement: Thread team-member turns into the leader timeline

A Claude session file whose first record carries BOTH a non-empty `agentName` and a non-empty `teamName` SHALL be treated as a non-lead team member (the exclusion predicate MUST match the grouping predicate, so an `agentName`-only session is never hidden). The system SHALL EXCLUDE non-lead members from the aggregated top-level session list — without counting them toward the unreadable tally (a skip is not a parse failure). The leader is the session that records that `teamName`; because the team episode may sit anywhere in a large transcript, the leader's `teamName`s SHALL be collected across the FULL streamed transcript (not only the bounded head+tail window). The live team config at `~/.claude/teams/<teamName>/config.json` MUST NOT be relied upon for linkage (it is deleted on teardown); the durable in-file `teamName`/`agentName` fields are the source of truth.

Instead of one collapsed group node, the system SHALL surface each member as a sequence of per-turn nodes threaded into the leader's detail timeline. A member's transcript is a sequence of turns; each turn begins at a `user` record whose text is `<teammate-message teammate_id="X">` (the incoming message) and runs until the next such record (or end of file). For each turn the system SHALL emit one `teammateTurn` timeline item carrying: the member's `agentName`, a `color` (from the leader file's `<teammate-message teammate_id color>` record for that member, else a fixed palette by index), the sender `from` (`"leader"` when `X` is `team-lead`, otherwise the peer member name), a bounded message preview, a `timestamp`, and the segment entry-id. Turns SHALL be merged into the leader's timeline by `timestamp`. Member-to-member (peer) messages SHALL be included, discovered by scanning each member file (a turn boundary whose `teammate_id` is not `team-lead` is a peer message); each message is recorded once in its recipient's file, so no turn is double-counted. Team-member discovery SHALL be scoped to the leader's own project directory and skipped entirely when the leader records no `teamName`.

#### Scenario: A teammate is threaded, not listed top-level

- **WHEN** a session file's first record has both an `agentName` and a `teamName` (a non-lead team member)
- **THEN** it does not appear in the top-level list (and is not counted unreadable), and each of its communication turns appears as a color-highlighted `teammateTurn` node — labelled with the member name and sender (leader or peer) — interleaved by time in the detail of the leader that recorded the same `teamName`

### Requirement: Open a single teammate turn

The system SHALL resolve a view-only segment id `claude:<memberId>:turn:<n>` to a detail containing ONLY the records of the n-th turn of that member's transcript (from the n-th incoming `<teammate-message>` boundary up to the next boundary, or end of file) — i.e. from receiving the request through the member's response. `<memberId>` SHALL satisfy the existing session-id safety check and `<n>` SHALL be a non-negative integer; the member transcript SHALL be located under the Claude projects root with the existing containment check, never trusting a webview-supplied path or record range. An out-of-range `<n>` or unsafe id SHALL resolve to null. The id is view-only (it contains `:` and therefore is rejected by the launch entry resolver); the member session itself remains independently launchable by its plain `claude:<memberId>`.

### Requirement: Nested and teammate nodes are always visible and visually distinct

When the detail view renders a session's timeline, a nested node — a one-shot subagent, a workflow group, or a `teammateTurn` — SHALL be rendered directly and SHALL NOT be hidden behind the per-run "Show N more steps" step-collapse, regardless of how many ordinary steps surround it (it breaks the run). Runs of ordinary assistant/thinking/tool steps MAY remain capped, at no more than THREE items before "Show N more". A `teammateTurn` node SHALL be visually distinct from ordinary transcript steps using an explicit accent (a colored bar/dot keyed to the member `color`) and MUST NOT rely on a subtle theme border that can resolve to near-invisible under a real color theme.

#### Scenario: A teammate turn deep in a long run is still visible and highlighted

- **WHEN** a `teammateTurn` node sits among more than three non-user timeline items (e.g. between many tool steps with no intervening user message)
- **THEN** it renders directly with its color accent and message preview, while the ordinary steps on either side stay independently capped at three behind "Show N more"

### Requirement: Claude permission mode is the latest recorded mode

A Claude session's permission mode is session **state** — a transcript records it repeatedly and re-records it on every change — so the entry's `permissionMode` SHALL be the **most recently recorded** mode in the transcript, never the first one encountered.

Deriving it SHALL NOT require reading the whole transcript: bounded scans of the transcript's head and tail are sufficient, and WHERE neither contains a mode, `permissionMode` SHALL be omitted rather than guessed, so the resumed session falls back to the agent's own default.

WHEN this derivation changes, any persisted session-list cache holding entries derived under the previous rule SHALL be invalidated, so a cached entry cannot keep serving a stale or absent mode.

#### Scenario: Mode changed mid-session resumes under the latest mode

- **WHEN** a Claude transcript records `bypassPermissions` on an early record and later records `{"type":"permission-mode","permissionMode":"default"}`
- **THEN** the entry's `permissionMode` is `default`, and the resume command built from that entry carries `--permission-mode default`

#### Scenario: Mode first appears after the metadata head

- **WHEN** a Claude transcript's only `permissionMode` sits past the head scan bound but within the tail scan bound
- **THEN** the entry carries that mode instead of omitting `permissionMode`

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

A child transcript SHALL be addressed only through a host-issued locator that a parent detail emitted for a bounded child agent identity resolved inside the validated parent project.

The locator SHALL be opaque to its requester, SHALL remain stable while the parent detail is re-read, and SHALL be honoured only while the issuing registry still holds it.

The system SHALL NOT globally match child ids across project buckets, serve an unissued locator, or pass either to `agent --resume`.

### Requirement: Safe Cursor session lookup

Malformed, unsupported, unsafe, or ambiguous Cursor sessions SHALL be skipped and counted unreadable without failing other providers.

Before emitting CLI entries, the reader SHALL group candidates by chat id and omit every duplicate-id group from both list and point lookup.

#### Scenario: Duplicate CLI chat id is ambiguous

- **WHEN** one CLI chat id exists under multiple Cursor workspace buckets without a unique validated storage context
- **THEN** every ambiguous candidate is omitted and counted unreadable

### Requirement: Cursor indexing is metadata-only

Session listing SHALL NOT decode transcript message bodies, raw database blobs, database secrets, prompt history, or tool output.

Only bounded entry metadata permitted for other Vault agents MAY leave the index reader; transcript content MAY be decoded only by an explicit detail request under the preview contract.

### Requirement: Enumeration is not exempt from containment

A transcript reached by **enumerating** a directory beneath a store root SHALL be containment-checked
on the same terms as one reached by resolving an id. Being listed under the root is not evidence of
being inside it, and an entry that fails the check SHALL be skipped without failing its siblings.

#### Scenario: A listed entry that leaves the root

- **WHEN** a session file enumerated beneath the Claude projects root is a symlink resolving to a
  file outside that root
- **THEN** it does not become an index entry, and the remaining entries in that directory are
  indexed normally

