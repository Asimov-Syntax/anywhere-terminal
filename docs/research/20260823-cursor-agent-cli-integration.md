---
topic: cursor-agent-cli-integration
created-by: research for Asimov change integrate-cursor-agent
date: 2026-08-23
verified: 2026-08-23
libraries: [Cursor Agent CLI]
used-by: [integrate-cursor-agent]
---

# Research: Cursor Agent CLI integration

## Answers

### Official installation and executable names

- Current official installation:
  - macOS, Linux, WSL: `curl https://cursor.com/install -fsS | bash`
  - Native Windows PowerShell: `irm 'https://cursor.com/install?win32=true' | iex`
- The current primary executable is `agent`; `cursor-agent` remains a backward-compatible alias. Cursor announced that naming transition on 2026-01-08. Both names should be detected, with `agent` preferred. [Installation](https://prod.cursor.com/docs/cli/installation) [CLI changelog, 2026-01-08](https://cursor.com/changelog/cli-jan-08-2026)
- The official Unix installer currently supports Darwin/Linux on `x64` and `arm64`. It installs the versioned binary at `~/.local/share/cursor-agent/versions/<version>/cursor-agent`, then creates both `~/.local/bin/agent` and `~/.local/bin/cursor-agent` symlinks. The installer observed on 2026-08-23 selected `2026.08.11-e8db854` from `downloads.cursor.com`.
- The official Windows installer currently supports x64 and ARM64, installs under `%LOCALAPPDATA%\cursor-agent`, and creates `agent` aliases for the `cursor-agent` executable wrappers. WSL uses the Unix installer.
- Version/update commands: `agent --version`, `agent about --format json`, and `agent update`. Automatic updates are enabled by default according to the installation docs. No uninstall command, version-pinning interface, checksum, signature-verification step, or complete numbered release index is documented.
- Local verification on 2026-08-23 found both command aliases resolving to the same binary and reporting `2026.08.11-e8db854`. This is the installed version, not proof that it is the newest globally available release.

### Interactive and non-interactive invocation

- Interactive agent mode: `agent [prompt...]`; `agent` with no prompt starts the terminal UI. Tool operations can request approval.
- Read-only modes:
  - `agent --mode plan [prompt...]` or `agent --plan [prompt...]`
  - `agent --mode ask [prompt...]`
- Non-interactive/headless mode: `agent -p "<prompt>"` or `agent --print "<prompt>"`.
- `--print` exposes shell/write tools, but it does not by itself mean every mutation is approved. Official headless guidance uses `--force`/`--yolo` when unattended edits must be applied; without it, edits can remain proposed rather than written. Integration code should choose this explicitly rather than assume headless equals auto-approve. [Headless mode](https://prod.cursor.com/docs/cli/headless) [Parameters](https://prod.cursor.com/docs/cli/reference/parameters)
- Permission/security controls include `--force`, `--yolo`, `--auto-review`, `--sandbox enabled|disabled`, `--approve-mcps`, and headless-only `--trust`. Prefer the least-permissive mode compatible with the requested action.
- `--stream-partial-output` requires `--print --output-format stream-json`.

### Workspace and cwd behavior

- Without a workspace option, the CLI uses the process current working directory.
- `--workspace <path-or-name>` selects a workspace directory or saved workspace name. There is no separately documented `--cwd` flag; spawn the process with the intended cwd or use `--workspace`.
- Current installed help also exposes repeatable `--add-dir <path>` for additional workspace roots. This option was not found in the indexed official parameter page, so capability-detect it before use.
- `-w` / `--worktree [name]` creates an isolated Git worktree at `~/.cursor/worktrees/<reponame>/<name>`; an omitted name is generated. `--worktree-base <branch-or-ref>` defaults to current `HEAD`. `--skip-worktree-setup` bypasses `.cursor/worktrees.json` setup scripts. [Using Agent](https://prod.cursor.com/docs/cli/using)
- Cursor staff state that `agent ls` is workspace-scoped and shows chats created from the same working directory. The CLI persists a `cwd` field in per-chat `meta.json` in the locally observed format. Whether `--resume <chat-id>` restores the original cwd, rejects a different workspace, or adopts the new invocation workspace is not officially specified; pass the intended workspace explicitly.

### Session identifiers, history, and resume

- Supported session operations:
  - `agent ls` — interactive prior-chat picker/resume flow.
  - `agent resume` — resume the latest chat.
  - `agent --continue` — alias for the latest chat (`--resume=-1` in the reference).
  - `agent --resume <chat-id>` — resume a specific chat.
  - `agent create-chat` — create an empty chat and print its ID.
  - Interactive `/resume` — view/resume prior conversations; `/list` was removed in January 2026. [Parameters](https://prod.cursor.com/docs/cli/reference/parameters) [CLI changelog, 2026-01-16](https://cursor.com/changelog/cli-jan-16-2026)
- Official output documentation defines `session_id` as a UUID constant for one print-mode execution. The CLI reference calls the resume argument `chatId`/thread ID. No official contract found states that output `session_id`, `create-chat` output, on-disk chat UUID, and resume ID are always the same identifier. Treat each field according to its documented role and validate the mapping empirically for the detected CLI version.
- Cursor staff confirm there is no common stable session ID or resume bridge across IDE, CLI, and ACP stores. CLI history cannot be assumed to resume IDE or ACP conversations. [Cursor staff: separate session stores](https://forum.cursor.com/t/local-ide-agent-chats-and-the-agent-cli-still-use-separate-session-stores/165486)
- No supported non-interactive machine-readable `agent ls --json` interface was found. `agent ls` is an interactive picker. Do not scrape its terminal UI as a stable API.

### Output and stream formats

`--output-format` is valid with `--print`; supported values are `text`, `json`, and `stream-json`. Current official reference default: `text`. [Output format](https://prod.cursor.com/docs/cli/reference/output-format)

- `text`: final assistant message only.
- `json`: one newline-terminated terminal object on success:

```ts
{
  type: "result";
  subtype: "success";
  is_error: false;
  duration_ms: number;
  duration_api_ms: number;
  result: string;
  session_id: string;
  request_id?: string;
}
```

- `stream-json`: newline-delimited JSON. The documented event families are:
  - `system` / `init` with `apiKeySource`, absolute `cwd`, `session_id`, `model`, and `permissionMode`.
  - `user` with a role/content message.
  - `assistant` with role/content and optional `timestamp_ms` / `model_call_id`.
  - `tool_call` / `started` and `tool_call` / `completed`, including `call_id` and tool-specific payloads.
  - terminal `result` / `success`.
- `session_id` is constant during one execution. Consumers should tolerate additional/unknown fields because the official page says schemas may grow.
- Partial streaming has duplicate-flush rules:
  - `timestamp_ms` present and `model_call_id` absent: append as a text delta.
  - both present: buffered duplicate before a tool call; ignore.
  - both absent: duplicate final flush; ignore.
- Tool payloads are not a closed stable union. The docs show read-file, write-file, and generic function examples, but do not define every tool or a structured tool-failure schema. Parse envelopes defensively and retain unknown payloads.
- Print mode suppresses thinking events according to the official page, although the locally installed `2026.08.11-e8db854` emitted `thinking` delta/completed events during the hook probe. Treat undocumented event types as version-specific and never expose hidden reasoning.

### Configuration, authentication, and environment

- Browser authentication:
  - `agent login`
  - `agent status` / `agent whoami`
  - `agent logout`
  - `NO_OPEN_BROWSER=1 agent login` prints a URL instead of launching a browser.
- Automation authentication:
  - `CURSOR_API_KEY=<key>` environment variable, recommended for CI.
  - `agent --api-key <key> ...` flag alternative.
- `agent status --format json`, `agent whoami --format json`, and `agent about --format json` provide machine-readable status/system data. Do not log their full output because it can contain account identity or endpoint details. [Authentication](https://prod.cursor.com/docs/cli/reference/authentication)
- Official docs say browser credentials are stored securely on the local machine but do not document the credential file/keychain location or precedence among saved login, `CURSOR_API_KEY`, and `--api-key`.
- Configuration locations:
  - macOS/Linux global: `~/.cursor/cli-config.json`
  - Windows global: `$env:USERPROFILE\.cursor\cli-config.json`
  - Linux/BSD XDG: `$XDG_CONFIG_HOME/cursor/cli-config.json`
  - custom directory: `CURSOR_CONFIG_DIR`
  - project permissions only: `<project>/.cursor/cli.json`
- Proxy/TLS variables: `HTTP_PROXY`, `HTTPS_PROXY`, `NODE_USE_ENV_PROXY=1`, and `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`. `network.useHttp1ForAgent: true` enables the HTTP/1.1/SSE fallback where HTTP/2 streaming is unavailable. [Configuration](https://prod.cursor.com/docs/cli/reference/configuration)
- Current installed help exposes `--endpoint <url>` and `CURSOR_API_ENDPOINT`, defaulting to `https://api2.cursor.sh`; the indexed official docs do not document the environment variable. Treat custom-endpoint support as version-specific and avoid depending on it unless capability-detected and contractually authorized.

### Native hooks contract and current CLI parity

#### Official configuration, schema, and source precedence

- Cursor-native hooks use JSON schema version `1`:

```json
{
  "version": 1,
  "hooks": {
    "beforeShellExecution": [
      {
        "type": "command",
        "command": ".cursor/hooks/check-command.sh",
        "timeout": 30,
        "matcher": "curl|wget|nc",
        "failClosed": true
      }
    ]
  }
}
```

- Native hook sources, highest priority first: Enterprise-managed, Team, project `<project-root>/.cursor/hooks.json`, then user `~/.cursor/hooks.json`. Cursor then loads compatible Claude project-local, project, and user hook sources when third-party configuration support is enabled. Every matching hook runs; if outputs conflict, the higher-priority source wins. Exact same-priority ordering and field-by-field merge behavior are undocumented. [Hooks](https://prod.cursor.com/docs/hooks) [Third-party hooks](https://prod.cursor.com/docs/reference/third-party-hooks)
- Enterprise paths:
  - macOS: `/Library/Application Support/Cursor/hooks.json`
  - Linux/WSL: `/etc/cursor/hooks.json`
  - Windows: `C:\ProgramData\Cursor\hooks.json`
- Project hooks execute with the project root as process cwd; user hooks execute with `~/.cursor/` as process cwd; enterprise hooks execute from their config directory. Project hooks require a trusted workspace and reload automatically when changed.
- `CURSOR_CONFIG_DIR` is officially documented for `cli-config.json`, not `hooks.json`. A controlled macOS probe with CLI `2026.08.11-e8db854` placed `hooks.json` only in `$CURSOR_CONFIG_DIR`; no hook fired. Keep hook discovery fixed to the documented hook paths and do not relocate it with `CURSOR_CONFIG_DIR`.
- No explicit `enabled` field, `--disable-hooks` CLI flag, per-event disable list, or global native-hooks disable switch is documented. Safe disable mechanisms are removing/renaming the owned entry/file, disabling/uninstalling the owning plugin, or removing the managed source. An installer must not delete unrelated hooks.

#### Official supported events

- Agent events: `sessionStart`, `sessionEnd`, `preToolUse`, `postToolUse`, `postToolUseFailure`, `subagentStart`, `subagentStop`, `beforeShellExecution`, `afterShellExecution`, `beforeMCPExecution`, `afterMCPExecution`, `beforeReadFile`, `afterFileEdit`, `beforeSubmitPrompt`, `preCompact`, `stop`, `afterAgentResponse`, `afterAgentThought`.
- Tab-only: `beforeTabFileRead`, `afterTabFileEdit`.
- App lifecycle: `workspaceOpen`.
- Cloud Agents support a subset of command hooks from project/team/enterprise sources; they cannot load user `~/.cursor/hooks.json`, prompt hooks, `sessionStart`, `sessionEnd`, MCP hooks, Tab hooks, or `workspaceOpen`. [Cloud Agents](https://cursor.com/docs/cloud-agent)

#### Official common stdin payload

Except for `workspaceOpen`, documented event payloads include event-specific fields plus:

```ts
{
  conversation_id: string;
  generation_id: string;
  model: string;
  model_id?: string;
  model_params?: Array<{ id: string; value: string }>;
  hook_event_name: string;
  cursor_version: string;
  workspace_roots: string[];
  user_email: string | null;
  transcript_path: string | null;
}
```

- `conversation_id` is stable across turns; `generation_id` changes per user message.
- The official common schema does not document a process `pid`, parent PID, single `workspace`, or generic event `cwd`.
- Current installed CLI observation added `session_id`, equal to `conversation_id` in the probed shell events. That field is not part of the documented common schema and must not be required.
- Hook process PID/PPID exist only as ordinary OS process properties; they were not included in stdin.
- `workspace_roots` is the official multi-root workspace field.

#### Requested event-specific stdin/output contracts

`beforeSubmitPrompt` runs after submission but before the backend request:

```ts
// stdin additions
{
  prompt: string;
  attachments: Array<{
    type: "file" | "rule";
    file_path: string;
  }>;
}

// stdout
{
  continue: boolean;
  user_message?: string;
}
```

`continue: false` blocks submission. Modified-prompt fields are not documented/supported.

`stop` runs when the agent loop finishes:

```ts
// stdin additions
{
  status: "completed" | "aborted" | "error";
  loop_count: number;
}

// stdout
{
  followup_message?: string;
}
```

- A nonempty follow-up is automatically submitted. `loop_count` starts at zero and counts prior automatic follow-ups.
- Native `loop_limit` defaults to `5`; `null` removes the cap. Claude-compatible stop hooks default to no limit.

`afterAgentResponse` runs after a completed assistant message:

```ts
// stdin additions
{ text: string }
```

No output fields are documented.

`beforeShellExecution` runs before a shell command:

```ts
// stdin additions
{
  command: string;
  cwd: string;
  sandbox: boolean;
}

// stdout
{
  permission: "allow" | "deny" | "ask";
  user_message?: string;
  agent_message?: string;
}
```

The matcher applies to the complete command string.

`afterShellExecution` runs after command completion:

```ts
// stdin additions
{
  command: string;
  output: string;
  duration: number; // milliseconds, excluding approval wait
  sandbox: boolean;
}
```

No stdout fields are documented. The official event schema does not include `cwd` for this event.

#### Command execution, environment, timeout, and failure semantics

- Command hooks are spawned processes. Cursor writes one JSON payload to stdin and consumes JSON from stdout.
- Officially documented hook environment variables:
  - always: `CURSOR_PROJECT_DIR`, `CURSOR_VERSION`, `CLAUDE_PROJECT_DIR`
  - when logged in: `CURSOR_USER_EMAIL`
  - when transcripts are enabled: `CURSOR_TRANSCRIPT_PATH`
  - remote workspace: `CURSOR_CODE_REMOTE=true`
  - `sessionStart` may return an `env` object whose variables are passed to later hooks in that session.
- Current macOS observation additionally exposed `CURSOR_INVOKED_AS` and `CURSOR_RIPGREP_PATH`; these are undocumented and must not be depended on.
- Exact shell executable, quoting/parser rules, inherited environment, encoding, stderr handling, maximum stdout size, and whether hooks of equal priority run serially or concurrently are undocumented. Prefer an absolute executable/script path and emit exactly one JSON object on stdout.
- `timeout` is seconds. The default is platform-dependent; no numeric default or maximum is documented.
- Command exit semantics:
  - `0`: success; Cursor parses/applies stdout JSON.
  - `2`: block, equivalent to deny.
  - any other code: hook failure; default behavior is fail-open.
- Crashes, timeout, and invalid JSON are fail-open by default. `"failClosed": true` blocks the underlying action for security-sensitive pre-action hooks. Its effect on observational/post-action hooks is not specified.
- Prompt hooks (`"type": "prompt"`) use a fast model by default, accept optional `model`, substitute `$ARGUMENTS` with input JSON (or append it), and return `{ "ok": boolean, "reason"?: string }`. They are unsupported in Cloud Agents.

#### Current installed CLI behavior, 2026-08-23

A controlled project-hook probe on macOS with `agent 2026.08.11-e8db854`, `--workspace`, `--trust`, `--force`, and non-interactive `--print` configured all five requested events and made one shell call.

- Fired: `beforeShellExecution`, `afterShellExecution`.
- Did not fire: `beforeSubmitPrompt`, `afterAgentResponse`, `stop`.
- This matches Cursor staff’s current description of a known non-interactive CLI lifecycle gap; IDE/interactive parity is under consideration with no timeline. [CLI lifecycle gap](https://forum.cursor.com/t/cursor-cli-omits-beforesubmitprompt-afteragentresponse-and-stop-hooks-loses-token-usage-and-emits-inconsistent-generation-id-values/169059)
- Observed shell payload keys:
  - common-ish: `conversation_id`, `generation_id`, `model`, `session_id`, `hook_event_name`, `cursor_version`, `workspace_roots`, `user_email`, `transcript_path`.
  - before: `command`, `cwd`, `sandbox`.
  - after: `command`, `output`, `duration`, `sandbox`.
- In this `--workspace` probe, `beforeShellExecution.cwd` was the empty string even though `workspace_roots` and the hook process cwd identified the workspace. Therefore `cwd` must be treated as optional/possibly empty in CLI integrations despite the official type being a string.
- Observed `conversation_id`, `generation_id`, and `session_id` were equal for that single-turn run. Cursor staff report that CLI generation IDs are not consistently authoritative; correlate headless events by `conversation_id`, not by assuming ID equality.
- A separate Linux report for the same `2026.08.11-e8db854` version found no hooks firing at all on Ubuntu ARM64 while identical hooks worked on macOS. It is unconfirmed by staff but is a material platform regression to capability-test. [Linux hook regression report](https://forum.cursor.com/t/cursor-agent-cli-never-invokes-hooks-json-on-linux-2026-08-11-same-version-works-on-macos/168326)
- For headless integration, `stream-json` remains the authoritative response/tool completion channel. Hooks are optional augmentation and must not be required for assistant-response or stop detection.

#### Install, merge, update, and uninstall safety

- Never overwrite `~/.cursor/hooks.json` wholesale. Parse it, require top-level object/version compatibility, preserve unknown top-level keys, all unknown events, entry ordering, and every unrelated hook entry.
- Add a uniquely identifiable owned command entry only if an equivalent entry is absent. Because native entries have no ID field, use a stable absolute command path or uniquely named wrapper plus exact-field matching as ownership evidence.
- Preserve `version`; reject unsupported future versions rather than downgrading them. Official current/default version is `1`.
- Write atomically through a same-directory temporary file plus rename and preserve file permissions. Re-read immediately before commit to avoid clobbering concurrent edits; abort/merge again on change.
- Uninstall only the exact owned hook entries. Remove the event array only if empty and remove `hooks.json` only if the resulting object is otherwise semantically empty and the installer originally created it.
- Prefer project hooks when behavior belongs to one repository; prefer user hooks only for cross-project session observation. Project hooks require trust and may be committed, while user hooks affect every workspace.
- Do not set `failClosed` for an observational integration. A missing observer must never block prompts or shell commands.
- Because all matching sources run, installing the same observer at both user and project level can duplicate events. Deduplicate by `conversation_id` plus event-specific correlation fields and avoid dual installation by default.

#### Verification against cmux’s current Cursor implementation

Targeted review of the sibling `cmux` repository found the implementation in `CLI/CMUXCLI+AgentHookCatalog.swift`, `CLI/CMUXCLI+AgentHookDefinitions.swift`, `CLI/CMUXCLI+AgentHookPayload.swift`, and generated `CLI/cmux.swift`.

What matches the official contract:

- cmux writes native flat version-1 entries shaped as `{"hooks":{"event":[{"command":"..."}]},"version":1}` to `$HOME/.cursor/hooks.json`.
- It intentionally does not honor `CURSOR_CONFIG_DIR` for Cursor hooks. `resolvedConfigDir()` falls back to `$HOME/.cursor`, matching official hook discovery and the installed-CLI probe.
- It registers exactly the requested events: `beforeSubmitPrompt`, `stop`, `afterAgentResponse`, `beforeShellExecution`, and `afterShellExecution`.
- Its session extractor accepts `session_id` and `conversation_id`, so current Cursor shell payloads resolve to a usable session key.
- Its generated command emits `{}` on no-op/error and gates delivery with `CMUX_CURSOR_HOOKS_DISABLED=1`. This is a cmux-local per-process disable, not a Cursor-native hook disable feature.
- Install/uninstall preserve unrelated top-level JSON and non-cmux hook entries, remove only commands recognized as cmux-owned, avoid duplicate owned entries, preview changes unless `--yes`, and use atomic file writes.

Material gaps and risks:

- Current headless CLI `2026.08.11-e8db854` fires only cmux’s two shell hooks from this five-event set. `beforeSubmitPrompt`, `afterAgentResponse`, and `stop` cannot currently be relied on for headless session state. cmux maps `afterAgentResponse` to its stop action, but that fallback is absent when Cursor omits the event.
- cmux’s turn extractor recognizes only `turn_id` / `turnId`; it does not map official `generation_id`. Cursor turns therefore lack a parsed turn ID.
- cmux’s cwd fallback recognizes `workspacePaths` / `workspace_paths`, not official `workspace_roots`. The current CLI probe emitted `cwd: ""` plus a valid `workspace_roots`, so cmux can lose workspace/cwd association for shell events. It should accept the first nonempty `workspace_roots` entry.
- cmux’s compact retained-payload allowlist keeps `conversation_id` and transcript fields but omits `generation_id`, `session_id`, `workspace_roots`, and top-level shell `command`/`cwd`/`output`/`duration`/`sandbox`. This limits diagnostics and future correlation even though the raw parser can extract part of the data.
- The installer unconditionally writes top-level `version: 1`, including over an existing future version. It should reject or explicitly migrate unsupported versions rather than silently downgrade the schema marker.
- If an existing `hooks` value is not an object, cmux treats it as empty and replaces it. Unknown event entry shapes are preserved during iteration, but a malformed/future top-level hooks shape is not protected.
- The installer derives its new document from the initial read, can wait for interactive confirmation, then writes without re-reading. A concurrent edit during the prompt window can be clobbered despite atomic replacement.
- Cursor entries have no explicit `timeout` or `failClosed`, so they use Cursor’s undocumented platform-dependent timeout and default fail-open behavior. Fail-open is correct for cmux observation; an explicit bounded timeout would make latency behavior more predictable.
- The catalog’s detection binary remains `cursor-agent`. That alias is currently official and installed, but `agent` is now primary; detection should accept both names.
- The shell dispatcher depends on POSIX shell syntax. This fits current macOS/Linux/WSL execution but native-Windows shell behavior is not verified and may not support the generated command as written.

Safe contract for cmux/anywhere-terminal to consume:

- Use `conversation_id` as the hook correlation key and `stream-json.session_id` as the process-run key.
- Consume `hook_event_name`, `cursor_version`, `workspace_roots`, optional `transcript_path`, and documented event-specific fields.
- Do not assume generic `pid`, nonempty shell `cwd`, one workspace string, stable equality among `session_id`/`conversation_id`/`generation_id`, lifecycle hooks firing in headless CLI, or `CURSOR_CONFIG_DIR` relocating hooks.

### Model selection

- Invocation: `agent --model <model-id-or-expression> ...`.
- Interactive selection: `/model`; `/models` was removed in January 2026.
- Discovery: `agent models` or `agent --list-models`. Use discovery rather than hard-coding the account’s available models. [Parameters](https://prod.cursor.com/docs/cli/reference/parameters) [CLI changelog, 2026-01-16](https://cursor.com/changelog/cli-jan-16-2026)
- Current installed help accepts parameterized model expressions such as `'claude-opus-4-8[context=1m,effort=high,fast=false]'`; this syntax is version-specific and was not found as a stable official web contract. Pass through user-selected values and validate via the installed CLI.
- `/model auto` is documented. The exact automatic-selection policy and stable canonical list of model IDs are not documented; availability varies by account and time.

### Exit and error behavior

- Success exits zero and, in `json`/`stream-json`, emits the documented terminal success result.
- Failure exits nonzero and writes diagnostic text to stderr.
- `json` mode may emit no well-formed JSON object on failure.
- `stream-json` may end without a terminal `result` event on failure.
- No stable structured error event, error-code taxonomy, retry contract, timeout contract, or signal-handling contract is documented. Integrations must combine exit status, stderr, parser state, and whether a terminal result was observed. [Output format](https://prod.cursor.com/docs/cli/reference/output-format)
- Avoid treating EOF without a result as success. Preserve stderr separately from NDJSON stdout and impose caller-controlled cancellation/timeouts.

### Filesystem locations for sessions and transcripts

- Cursor staff-confirmed CLI layout: `~/.cursor/chats/<workspace-hash>/<chat-uuid>/`. Chats are local, workspace-scoped, not cloud-synced/backed up as local files, and separate from IDE and ACP stores. [Cursor staff: chat storage](https://forum.cursor.com/t/cursor-agent-create-chat-and-how-to-delete-old-chats/156640)
- Separate stores confirmed by Cursor staff:
  - CLI: `~/.cursor/chats/`
  - IDE: `~/.cursor/projects/<project>/agent-transcripts/` plus editor index data
  - ACP: `~/.cursor/acp-sessions/<id>/store.db`
  - No common stable ID or cross-store resume bridge. [Cursor staff: separate session stores](https://forum.cursor.com/t/local-ide-agent-chats-and-the-agent-cli-still-use-separate-session-stores/165486)
- Local inspection of CLI `2026.08.11-e8db854` on macOS found per-chat:
  - `meta.json` with `schemaVersion`, `createdAtMs`, `updatedAtMs`, `hasConversation`, `cwd`, and optional `title`.
  - optional `prompt_history.json`.
  - optional SQLite `store.db` with WAL/SHM sidecars; tables `meta(key TEXT PRIMARY KEY, value TEXT)` and `blobs(id TEXT PRIMARY KEY, data BLOB)`.
  - blob values include JSON user/assistant/tool-result messages as well as binary records. The `meta` value is not plain JSON.
- These per-chat filenames and schemas are observed implementation details, not an official public storage API. They may change without notice. Prefer CLI commands and prospective `stream-json` capture over direct DB parsing. If a vault/indexer must read them, gate by `meta.json.schemaVersion`, open SQLite read-only and WAL-aware, tolerate binary/unknown blobs, and degrade cleanly.
- The exact Windows chat-store path and filesystem format were not explicitly documented. `~/.cursor/chats` is staff-described generally, but Windows path expansion should be verified on native Windows rather than assumed.

### Platform differences

- Official installation supports macOS, Linux, WSL, and native Windows. Current installer artifacts cover x64 and ARM64.
- Unix command links live in `~/.local/bin`; native Windows installs beneath `%LOCALAPPDATA%\cursor-agent` and modifies user PATH.
- Global config paths differ as listed above; XDG config is documented for Linux/BSD.
- Worktrees are documented under `~/.cursor/worktrees/...`; the native-Windows path rendering and Git behavior are not specified.
- Advanced sandbox implementation documentation is strongest for macOS/Linux. Native Windows installation is official, but equivalent sandbox behavior should not be inferred. Capability-test sandbox use and provide a non-sandbox fallback or clear incompatibility result. [Run modes](https://prod.cursor.com/docs/agent/security/run-modes) [Agent sandboxing](https://cursor.com/blog/agent-sandboxing)
- Terminal key behavior differs: the January 2026 changelog names iTerm2, Ghostty, Kitty, Warp, and Zed as supporting `Shift+Enter`; Apple Terminal, Alacritty, and VS Code may need `/setup-terminal`; `Ctrl+J` and `\+Enter` are documented alternatives. This matters only when embedding interactive mode in a PTY. [CLI changelog, 2026-01-16](https://cursor.com/changelog/cli-jan-16-2026)

### Version and capability detection

- Resolve executable in order: configured path, `agent`, then `cursor-agent`.
- Run `<exe> --version` and preserve the opaque version string; current releases use date-plus-commit-like values such as `2026.08.11-e8db854`, not SemVer.
- Prefer `<exe> about --format json` for machine-readable CLI/system/account metadata, but treat fields as potentially sensitive and schema-evolving.
- Probe `<exe> --help` for optional flags such as `--add-dir`, `--auto-review`, `--stream-partial-output`, parameterized models, worktrees, plugins, and sandbox controls. Do not infer capability from version ordering because no public compatibility matrix exists.
- Probe model capability through `<exe> models` or `<exe> --list-models` under the active account.
- A minimal integration baseline is: executable found, `--version` succeeds, `--print`, `--output-format stream-json`, `--workspace`, and `--resume` appear in help. Refuse or downgrade unsupported features explicitly.
- Hook capability cannot be inferred from configuration acceptance. Use a non-blocking diagnostic hook/probe per platform/version if hook-driven behavior is required, then fall back to `stream-json` when expected lifecycle events do not arrive.
- `agent update` always targets the newest release; there is no documented stable channel, pin, rollback command, or installer argument for selecting an older version. Do not auto-update behind the user’s back.

### Licensing and distribution constraints

- The Cursor Agent CLI is proprietary; no public official CLI source repository was found. Cursor’s public `cursor/plugins` repository is for plugins, not the CLI implementation. DeepWiki source verification was therefore unavailable.
- Cursor’s Terms of Service (updated 2026-08-13) grant a limited right to access/use the service and prohibit reproducing, modifying, derivative works, reverse engineering, and renting/leasing/lending/selling the service. Cursor retains ownership and grants no implied licenses. [Terms of Service](https://cursor.com/en-US/terms-of-service)
- Cursor’s Acceptable Use Policy (updated 2026-08-11) more broadly prohibits modifying, copying, selling/reselling, distributing, or reverse engineering the service, subject to applicable-law exceptions. It also contains broad language against automated/non-human access. [Acceptable Use Policy](https://prod.cursor.com/en-US/acceptable-use-policy)
- Official CLI documentation simultaneously promotes `--print`, scripts, GitHub Actions, and CI automation. That creates an apparent scope tension with the AUP’s broad automation wording; the sources do not resolve it for embedding Cursor in a third-party product. Obtain written clarification for hosted/multi-user/backend use.
- No affirmative license to bundle, mirror, repackage, or redistribute the Cursor CLI binary was found. Recommended product integration: detect a user-installed CLI or direct the user/runner to Cursor’s official installer. Do not ship the binary inside the extension/package without written permission from Anysphere.
- The official installer currently performs no documented checksum/signature verification beyond HTTPS transport and download/extraction success. Organizations with supply-chain requirements should request an official verification/pinning mechanism rather than mirror the binary without permission.
- Cursor’s open-source license notice applies to listed third-party components, not to the proprietary CLI as a whole. [Open-source notices](https://cursor.com/licenses)

## Transcript preview follow-up, 2026-08-24

### Correct storage-domain model

Focused local-source research corrected the earlier assumption that project `agent-transcripts` JSONL is necessarily Cursor IDE history:

- Cursor Agent CLI canonical history: `~/.cursor/chats/<workspace-hash>/<chat-id>/store.db`.
- Cursor Agent/project transcript mirror: current nested `~/.cursor/projects/<project>/agent-transcripts/<id>/<id>.jsonl`, plus an older flat `<id>.jsonl` form.
- Cursor IDE Composer history: editor `globalStorage/state.vscdb`, with Composer and bubble JSON records.

A project JSONL file can mirror a CLI store. File location alone therefore cannot classify it as IDE or make it independently resumable. Cursor IDE Composer remains a separate identifier domain and MUST NOT be passed to Cursor Agent CLI Resume.

### Primary local OSS evidence

`botmux` (MIT, local HEAD 2026-08-23) uses an open `store.db` file descriptor only to bind the live process to an exact chat id, then incrementally tails the matching nested project JSONL by byte offset. It handles incomplete tails, missing newlines, malformed records, `fs.watch` gaps with a one-second poll fallback, and exact `cursor-agent --resume <id>`. Its relay parser intentionally drops tool-bearing assistant records and fabricates live timestamps, so those behaviors are unsuitable for historical preview.

`claude-code-history-viewer` (MIT, local HEAD 2026-08-19) has separate providers for project transcript JSONL and Cursor IDE `state.vscdb`. It demonstrates nested transcript discovery, Composer/bubble reconstruction, and rich history rendering, but its JSONL normalization is lossy, fully materializes sessions, has no incremental backend cache, and exposes neither Cursor Resume nor a CLI `store.db` codec.

Orca main provides append-aware project JSONL parsing and preview-first row activation. Its unmerged Cursor sidecar branch adds bounded no-follow CLI metadata reads, cwd/hash validation, source reconciliation, and LRU behavior without opening `store.db`. cmux provides Cursor hook/status/resume integration but no Cursor transcript reader.

### Installed CLI structural proof

Read-only, WAL-aware structural inspection of installed Cursor Agent `2026.08.11-e8db854` established a bounded CLI decoder without emitting transcript content:

- Seven chat databases used `meta(key,value)` and `blobs(id,data)`; one active store required WAL visibility.
- `meta['0']` was hex-encoded UTF-8 JSON.
- All seven chat-directory UUIDs matched stored `agentId` values.
- All 275 blob ids matched `SHA-256(data)` and all root references resolved.
- The canonical conversation root used protobuf field 1 for current JSON message references and field 13 for summary-archive references.
- Ninety-one reachable JSON message records decoded structurally with zero errors.
- Local project transcripts used nine nested `<id>/<id>.jsonl` files containing 47 role/message and seven `turn_ended` records with no malformed rows.

Cursor's bundled implementation also shows a 5 MiB blob bound, root-based hydration, summary archives, and project-JSONL export from the canonical store. A reader can therefore follow only reachable hash-verified blobs instead of scanning the database or decoding the larger tool-step protobuf graph.

### Safe implementation boundary

- Keep list indexing metadata-only.
- Read CLI detail through AnyWhere Terminal's existing WAL-aware SQLite snapshot abstraction and one bounded same-snapshot query.
- Require the supported SQLite schema/profile, validate `agentId`, verify blob hashes, follow only recognized root/archive protobuf fields, cap every blob and total decoded output, and fail closed to limited metadata.
- Use project JSONL as an append-friendly detail mirror/fallback; deduplicate it against a matching validated CLI store.
- Read Cursor IDE Composer through a separate source-qualified `state.vscdb` reader with no CLI Resume capability.
- Never log, persist, copy, or send raw blobs, protobuf envelopes, encryption keys, account identity, or unrelated database fields. Only normalized timeline records and explicitly sanitized message records may reach the requesting local preview.

## Recommended Approach

- Integrate as an external user-installed process: prefer `agent`, fall back to `cursor-agent`; detect capabilities from `--help`, `--version`, `about --format json`, and `--list-models` rather than assuming a release schema.
- Launch with an explicit cwd/`--workspace`, use `--print --output-format stream-json`, keep stdout NDJSON separate from stderr, require a zero exit plus terminal success result, and make `--force`, sandbox, trust, model, and resume choices explicit.
- Use Cursor hooks only as best-effort observability. Install/merge version-1 entries surgically, key events by `conversation_id`, and rely on `stream-json` for headless response/stop detection because current CLI lifecycle hook parity is incomplete.
- Keep `~/.cursor/chats` list indexing metadata-only, but permit explicit detail reads through a version-gated, root-reachable, hash-verified, bounded local decoder. Prefer the matching project JSONL for incremental tailing and fail closed to metadata when the private schema drifts; never expose raw database blobs as the integration contract.

## Gotchas & Constraints

- `agent` and `cursor-agent` naming changed; both must be supported.
- Session `chatId`, stream `session_id`, hook `conversation_id`/`generation_id`, request ID, IDE composer ID, ACP ID, and local directory UUID are not documented as interchangeable.
- `agent ls` is interactive and workspace-scoped; there is no verified headless JSON chat-list API.
- `stream-json` can terminate without a result on error; stdout alone is insufficient.
- Output/tool schemas are extensible and tool-specific; ignore unknown fields and avoid exhaustive enums.
- Current headless CLI does not reliably fire `beforeSubmitPrompt`, `afterAgentResponse`, or `stop`; Linux `2026.08.11-e8db854` also has an unconfirmed report of no hooks firing.
- Hook failures are fail-open unless `failClosed` is set; observational integrations should remain fail-open.
- Local chat storage is unsynced and can be deleted or schema-migrated independently of the integration.
- Automatic CLI updates can change capabilities and on-disk formats. Detect at launch and avoid silent forced updates.
- Official documentation pages have moved between `docs.cursor.com`, `prod.cursor.com`, and `cursor.com/docs`; URLs and indexed content are not fully consistent.

## Gaps

- No public official Cursor Agent CLI source repository was found; exact internal APIs and storage serialization could not be source-verified.
- No official schema or compatibility guarantee was found for `~/.cursor/chats`, `meta.json`, `store.db`, binary blobs, workspace hashes, or prompt history.
- No official non-interactive session-list/export API, structured failure schema, error-code taxonomy, timeout/retry policy, version manifest, release channel, rollback mechanism, or CLI SDK was found.
- Exact authentication credential storage and authentication-source precedence are undocumented.
- Hook shell selection, quoting, inherited environment, stdout/stderr limits, exact matcher regex semantics, default/max timeout, equal-priority ordering, and non-blocking `failClosed` behavior are undocumented.
- Exact native-Windows session paths, worktree paths, hook execution behavior, and sandbox parity remain unverified.
- The legal boundary for third-party product/backend automation is unclear because product docs promote automation while the AUP uses broad anti-automation language. Written clarification is needed for that downstream use.

## Confidence

Medium-High — invocation, parameters, output envelopes, installation, authentication, configuration, official hook schema, platform support, and legal terms are backed by current official Cursor documentation/installer content and the locally installed `2026.08.11-e8db854` CLI. The hook probe directly verified current macOS CLI behavior, but Linux and Windows parity remain uncertain. Session-store paths are confirmed by Cursor staff and local observation, but their schemas are undocumented implementation details. Licensing for embedded product automation remains materially ambiguous.
