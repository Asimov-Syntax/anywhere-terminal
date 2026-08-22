# Orca deep-dive 2/7 — Hook-based agent state tracking

Source repo: `/Users/huybuidac/Projects/ai-oss/orca`. This is the flagship architecture: agent status comes from **agent-emitted hooks**, never inferred from output parsing (titles are fallback/veto only). See also doc 06 (how status is projected to UI truthfully).

## 1. End-to-end architecture

**Transport: loopback HTTP + shared-secret token.** Main process runs `AgentHookServer` (`src/main/agent-hooks/server.ts:693`), a Node `http` server bound to `127.0.0.1` on an ephemeral port (`server.ts:2528`), with a per-launch `randomUUID()` token (`server.ts:2417`). Every request must be a POST with header `X-Orca-Agent-Hook-Token` (`server.ts:2432`), routed by pathname `/hook/<source>` → `HOOK_SOURCE_BY_PATHNAME` (`src/shared/agent-hook-listener.ts:4656-4675`). Responses are always 204 — **fail-open**: malformed payloads never block the agent (`server.ts:2499`).

**Coordinates reach the agent two ways:**

1. **PTY env at spawn**: `buildPtyEnv()` (`server.ts:2877-2893`) injects `ORCA_AGENT_HOOK_PORT/TOKEN/ENV/VERSION` plus `ORCA_AGENT_HOOK_ENDPOINT` (path to endpoint file); the runtime adds `ORCA_PANE_KEY`, `ORCA_TAB_ID`, `ORCA_WORKTREE_ID` per pane (`orca-runtime.ts:31316-31321`).
2. **Endpoint file** (survives Orca restart while PTYs live on): `writeEndpointFile` (`agent-hook-listener.ts:4703-4756`) atomically writes `endpoint.env` (POSIX) / `endpoint.cmd` (Windows) — plain `KEY=VALUE` lines, dir `0o700`, file `0o600`, values validated shell-safe (`:4688`). The managed hook script re-sources this file on every invocation, picking up the *new* port/token after restart (`src/main/claude/hook-service.ts:112-116`). On `stop()` the file is deliberately **not** unlinked (stale file = fail-open, avoids TOCTOU; `server.ts:2550`).

**Hook install (Claude):** `ClaudeHookService.install()` writes a managed script to `~/.orca/agent-hooks/claude-hook.sh` and registers it in `~/.claude/settings.json` under 11 events: SessionStart, UserPromptSubmit, Stop, StopFailure, SubagentStart, SubagentStop, TeammateIdle, PreToolUse(`*`), PostToolUse(`*`), PostToolUseFailure(`*`), PermissionRequest(`*`) (`src/main/claude/hook-settings.ts:36-92`). Install is idempotent: managed entries matched by script filename, removed and re-appended, user hooks preserved (`hook-settings.ts:187-206`). The script itself (`claude/hook-service.ts:94-135`):

- prints `{}` first (permission hooks fail closed on empty stdout),
- captures stdin, skips if `$CLAUDE_JOB_DIR` set (background worker inherited wrong pane env),
- sources endpoint file,
- `curl -sS --connect-timeout 0.5 --max-time 1.5` a **form-encoded** POST: `paneKey`, `tabId`, `launchToken`, `worktreeId`, `env`, `version`, `payload@-` (raw hook JSON piped to curl).

**Ingest pipeline** (`server.ts:2425-2503`): auth → slowloris timer (5s, `agent-hook-listener.ts:103`) → `readRequestBody` → `resolveHookSource` → `normalizeHookPayload` (shared, transport-agnostic) → disposition guards (closed-tab suppression, retired-pane fences, authority checks) → `applyNormalizedStatus` → fan-out to listeners + debounced persist to a `last-status` file on disk (hydrated on next launch, `server.ts:2421`). The same shared listener runs inside an SSH/WSL **relay** process, forwarding pre-normalized envelopes to main via JSON-RPC `agent.hook` (`src/shared/agent-hook-relay.ts:70-120`); main re-normalizes at the SSH trust boundary. Oversized frames shed `subagents` with a sha256 digest so truncation ≠ "roster cleared" (`agent-hook-relay.ts:125-196`).

**Lifecycle/cleanup**: per-pane caches cleared on PTY teardown (`clearPaneCacheState`, `agent-hook-listener.ts:191`), moved on pane-key rename (`:231`), whole listener cleared on stop (`:281`).

## 2. Turn-state machine

Canonical states: `working | blocked | waiting | done` (`src/shared/agent-status-types.ts:19`); staleness TTL 30 min (`:281`).

**Claude event→state map** (`agent-hook-listener.ts:2986-2998`):

| Event | State |
|---|---|
| UserPromptSubmit, PreToolUse (non-AskUserQuestion), PostToolUse(-Failure), PreCompact, auto-PostCompact | working |
| PermissionRequest, PreToolUse with AskUserQuestion tool | waiting |
| Stop/StopFailure, manual PostCompact | done |

`SessionStart` (source ∈ startup/resume/clear, no `agent_id`) lands a `done` row flagged `sessionBoundary`, wiping stale rosters/tasks (`:2930-2957`). `is_interrupt: true` on Stop marks `interrupted` (`:2962-2967`).

**Lead vs children**: lead events carry no `agent_id`; subagent events do (`:3036`). Pane state = lead state, but `done` is gated back to `working` while any roster child works, or `background_tasks`/`session_crons` inventories show running non-agent work (`resolveClaudePaneState`, `:2641-2656`). `turnCompletedAt` stamps the moment the lead finished while children keep the pane working (`:3130-3137`).

**Subagents** (`:2659-2747`): SubagentStart upserts a working roster entry; SubagentStop stops it (one-shot → removed; teammate-shaped → parked idle, revivable); TeammateIdle parks turn-based teammates. Roster changes re-emit the *cached* lead state with a fresh child list — never fabricating lead completion. On Stop, an authoritative `background_tasks` inventory is folded into the roster (`:3092-3103`).

**Waits**: a child-induced `waiting` stashes the displaced lead state in `stateBeforeWait` (restored on clear; `:3104-3117`). Only the wait-owning child's next tool event, its Stop/Idle, or a keystroke-inferred answer clears it; parallel-sibling tool completions with a different `tool_use_id` re-emit cached state instead of dismissing the card (`:3024-3070`). AskUserQuestion answering emits **no hook** — the server infers it from the submit keystroke (`clearClaudeAnsweredQuestionWait`, `:2848-2876`; `inferQuestionAnswered`, `server.ts:999`).

**Startless children / restart**: fresh listener + child event with no cached lead → SubagentStop/TeammateIdle for an unknown child make **no status claim**, but a startless SubagentStart proves activity → working (`agent-hook-listener-startless-child-lifecycle.test.ts:23-51`). Persisted rosters re-seed only `working` snapshots, flagged `restoredFromSnapshot` + `backgroundTasksAuthoritative` so a later inventory or a dead-pane liveness sweep can reap phantoms (`:2756-2826`); resulting statuses are `restoredUnconfirmed` and refuse interrupt inference (`server.ts:918`).

**Interrupt inference** (`server.ts:901-996`): Ctrl+C / double-Esc with no Stop hook synthesizes `done+interrupted` — only if the cached row is `working`, matches the caller's exact baseline (prompt, receivedAt, stateStartedAt), is <30 min old, has no non-idle subagents, no background tasks/crons. Per-agent quirks: Droid Ctrl+C = CLI exit, never turn interrupt; OpenCode/Copilot need Escape ×2. Syncs the listener's lead record (`markClaudeLeadTurnInterrupted`, `:2750`) so later child events can't resurrect the pane.

**Interactive prompts** (`:918-951`): AskUserQuestion tool input → `interactivePrompt = JSON {questions}`; `PermissionRequest` for any other tool → `{approval: {tool, summary}}` (`:902-916`). `interactivePrompt` is never inherited across events (`:709-710`) → stale cards can't linger.

## 3. Per-agent compatibility

- **Claude/OpenClaude/Kimi/Devin**: native hooks in settings.json; richest signal (subagents, teammates, compact, interrupt flag, background_tasks/session_crons, prompt_id, transcript_path). Kimi = Claude events verbatim; Devin = Claude payloads + own lifecycle names (`:3211`).
- **Codex**: Claude-compatible `hooks.json` written into the Orca-managed CODEX_HOME (`src/main/codex/hook-service.ts:87-105`). Shims: `request_user_input` auto-allowed so its PreToolUse maps to waiting (`agent-hook-listener.ts:3826-3829`); child rosters also reconstructed from the transcript because 0.144 can omit child Stop hooks (`:3865-3876`); the PermissionRequest hook exits with no decision so Codex still shows its own approval UI (`codex/hook-service.ts:86`).
- **OpenCode**: no hooks — an **injected JS plugin** (`src/main/opencode/hook-service.ts`, inline source) subscribes to the event bus (`session.idle`, `permission.asked/replied`, `question.asked`, `message.updated`, message parts) and POSTs synthetic events `SessionBusy/SessionIdle/MessagePart/PermissionRequest/AskUserQuestion` (`agent-hook-listener.ts:3894-3933`). Prompt comes from `MessagePart` with `role:'user'` (`:620-626`), capped at 8000 chars against O(n²) re-posting (`:105-112`).
- **Droid**: Claude-shaped hooks in `~/.factory/settings.json`. Shims: no Stop on interrupt — idle `Notification` maps to done; permission `Notification`s / high-risk PreToolUse map to waiting; SessionStart fires idle so it's dropped (`:4112-4175`).
- **Grok**: managed `$GROK_HOME/hooks/orca-status.json`; snake_case events; prompt wrapped in `<user_query>` (stripped, `:630`); final assistant text read from Grok's chat-history files on disk (`:1399`).
- **Pi/omp/prime-agent**: snake_case (`before_agent_start`, `tool_call`, `agent_end`); ask tool → **blocked**; `session_start` drops but carries resume identity via `providerSessionOnly` rows (`:4054-4110`).
- **command-code**: hooks give only Pre/PostToolUse/Stop; prompt + assistant text read from transcript with bounded backward chunk scanning (64KB chunks, 4MB cap; `:1006-1290`).

## 4. Failure handling

- **Transport interference** (`agent-hook-transport-interference.ts`): enterprise IDS/AV resetting loopback POSTs mid-body fingerprinted by `bytesRead < Content-Length` (`:30`); counted, reported once at threshold 3 (`:64-105`). Slowloris destroys excluded (`server.ts:2440-2444`).
- **Request-body memory** (`readRequestBody`, `agent-hook-listener.ts:468-558`): 1MB byte cap, single geometric-growth buffer, JSON structural limits (128K tokens / depth 64, `:85`), BOM strip, settles on data/end/error/close.
- **Status cache** (`agent-hook-status-cache.ts`): bound of 500 panes; eviction prefers `done` or stale entries; eviction clears all pane-scoped caches (`:15-60`).
- **Roster retention**: malformed/unknown child events retain nothing; paneKey ≤200 chars; warn-once sets bounded at 32 keys.
- **Cross-build hygiene**: `version`/`env` mismatch warn-once (`:300-327`); wrong tabId inside a valid paneKey → dropped (`:4404`).

## 5. Porting plan for anywhere-terminal (claude + codex + opencode)

AT spawns the pty itself, so the env-injection point is already ours. Minimal subset:

1. **Server**: one loopback `http` server in the extension host; ephemeral port, `randomUUID()` token, POST-only, token-header check, always 204, 1MB cap, 5s timeout. ~100 lines. Skip for v1: relay/SSH, persistence, authority fences.
2. **Env injection at pty spawn** (in `src/pty/PtyManager.ts`): `AT_HOOK_PORT/TOKEN`, `AT_PANE_KEY` (our session id), plus endpoint-file + `AT_HOOK_ENDPOINT` so status survives a VS Code reload while daemonized ptys persist — copy `writeEndpointFile` + the script's re-source line.
3. **Claude**: managed `claude-hook.sh` + idempotent registration in `~/.claude/settings.json`, minimal event set `SessionStart, UserPromptSubmit, Stop, StopFailure, PreToolUse(*), PermissionRequest(*)` (Post/Subagent events later). Copy verbatim ideas: `printf "{}\n"` first, `$CLAUDE_JOB_DIR` guard, endpoint re-source, form-encoded curl with 1.5s max-time.
4. **Codex**: same Claude-shaped events into `hooks.json` in a CODEX_HOME we control at launch (Orca uses a managed home to avoid touching `~/.codex`). Map `request_user_input` PreToolUse → waiting.
5. **OpenCode**: port the plugin approach — drop a plugin JS into the opencode plugin dir (or `OPENCODE_CONFIG` overlay) that posts `SessionBusy/SessionIdle/PermissionRequest/AskUserQuestion` + user `MessagePart`.
6. **State machine v1**: per-pane `{state, prompt, toolName, interactivePrompt}`; the three per-agent event→state tables (Claude `:2986`, Codex `:3831`, OpenCode `:3902`); prompt cache reset on new-turn events (`isNewTurnEvent`, `:2479`); ignore `agent_id`-bearing Claude events at first (treat as keep-alive working).
7. **Two day-one inference fallbacks**: keystroke interrupt inference (Ctrl+C/double-Esc → done+interrupted, baseline-guarded) and AskUserQuestion answer clearing on Enter — both cover hooks Claude genuinely never sends.
8. **Vault synergy**: hook payloads carry `transcript_path`/`session_id` (`extractAgentProviderSession`) — link live status rows to vault timelines (`src/vault/VaultService.ts`) instead of directory scanning / PID registry (`src/vault/readers/runningSessions.ts`).

Test-encoded caveats to respect: compact-continuation UserPromptSubmit must not resurrect working (`:2973`); PreCompact→working / PostCompact→done (else `/compact` leaves a sticky spinner); empty-stdout permission hooks hard-deny (always echo `{}`); fail-open everywhere.
