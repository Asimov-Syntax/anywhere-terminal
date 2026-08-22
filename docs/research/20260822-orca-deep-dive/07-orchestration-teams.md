# Orca deep-dive 7/7 — Inter-session communication & Claude agent teams

Source repo: `/Users/huybuidac/Projects/ai-oss/orca`. How orca routes messages between agent sessions/workers, and how it hosts Claude Code's agent-teams feature inside its own panes.

## 1. Orchestration architecture

**Model.** A *run* has a coordinator handle; *tasks* form a DAG; a *dispatch* binds one task to one worker terminal. A **mailbox** is not an object — it is a *handle string* in one of three namespaces resolved dynamically per pane: `run:<id>`, `dispatch:<id>`, or a bare terminal handle (direct mail). `orchestration/mailbox-owner.ts:41-89` resolves pane→mailbox by asking the DB in priority order: current run for paneKey → active dispatch for `(terminalHandle, paneKey)` → remote federated attachment → raw terminal handle.

**Message schema** (`orchestration/db/schema/create-core-tables-sql.ts:17-44`): `id, run_id, delivery_contract('legacy_direct'|'current_delivery'|'audit_only'), from_handle, to_handle, subject, body, type, priority, thread_id, payload, read, sequence INTEGER PRIMARY KEY AUTOINCREMENT, created_at, delivered_at, sender_pane_key`. Types are a closed set of 9: `status, dispatch, worker_done, merge_ready, escalation, handoff, decision_gate, question, heartbeat` (`orchestration/types.ts:2-12`). `sequence` is the global monotonic ordering used for watermarks.

**Delivery identity.** A terminal's identity is a tuple, not a name: `paneKey` (`tabId:leafId`), `launchTokenHash` = sha256 of `ORCA_AGENT_LAUNCH_TOKEN` injected at spawn (`orca-runtime.ts:28110-28115`), `processIncarnation`, `hostScope` (`local | wsl+distro | ssh targetId`), and a pre-allocated `ORCA_TERMINAL_HANDLE` (`orca-runtime.ts:10602-10613`). Attestation comes from the agent-hook server, not from the caller (`orchestration-compatibility-authority.test.ts:22-54`); a restored receipt from a different WSL distro/SSH target is rejected (`:194`), and a fresh launch-token mismatch does not fall back to a restored receipt (`:229`). Agents self-identify only via `--from <handle>` + `--dispatch-capability` (`orchestration/preamble.ts:82-87`); the runtime revalidates.

**Delivery mechanics — the key idea.** Orca never pushes message bodies into a PTY. It writes a one-line **pointer**: `"\nYou have N orchestration messages. Run \`orca orchestration check --run <id>\`.\n"` (`orchestration/formatter.ts:112-117`), then 500 ms later a bare `\r` to submit (`mailbox-pointer-submit.ts:70`; timer `mailbox-pointer-delivery.ts:253-271`). Preconditions: the pane's agent must be `idle` **and** `lastAgentStatusObservedLive` (`mailbox-pointer-delivery.ts:46`, `mailbox-pointer-submit.ts:57-59`). The agent then pulls the payload itself via CLI — agents that reformat pasted text can't corrupt it.

**Race/settlement machinery** (`mailbox-pointer-state.ts`, `-submit.ts`, `-delivery.ts`):

- **Flight** per ptyId — one in-flight pointer at a time; concurrent deliveries parked per mailbox, replayed on settle (`mailbox-pointer-state.ts:53-71`, `mailbox-pointer-delivery.ts:280-297`).
- **Watermark** per mailbox = `{ptyId, sequence, leafKey, active}` — newer `sequence` supersedes; a stale non-active watermark owned by another leaf is force-released (`mailbox-pointer-state.ts:77-123`).
- **Transport settlement**: the write returns `Promise<boolean>` (`writeWithSettlement`, `pty-provider-contract.ts:140`; SSH impl `ssh-pty-provider.ts:200`). `delivered_at` stamped only after the transport confirms; a rejected settle leaves the row undelivered so a later runtime redelivers (`mailbox-pointer-delivery.ts:226-243`; pinned by `orchestration-mailbox-transport-settlement.test.ts:29-65`).
- **Absence probe**: before staging, the pty is probed for *proven* absence; a live-but-unknown pty defers and redelivers (`mailbox-delivery-target.ts:37-66`).
- **Rollback**: `markAsUndelivered` on lost ownership, non-writable leaf, or pty retirement (`mailbox-pointer-submit.ts:79`, `mailbox-pointer-delivery.ts:142-153`).
- **Waiters**: a blocked `orchestration check --wait` suppresses the pointer entirely and is woken instead (`mailbox-pointer-eligibility.ts:28-49`, `mailbox-notification-coordinator.ts:42-88`).

**Detached / offline workers.** If the recipient handle has no live terminal, `resolveDetachedMailbox` routes its backlog into whatever mailbox now *owns* it (`mailbox-notification-coordinator.ts:121-138` → `mailbox-owner.ts:122-130`). Routing is **paged** (batch 50, `db/messages/mailbox-routing-page.ts:3`) with `hasMore` → `setImmediate` reconciliation loop (`mailbox-owner.ts:203-244`). Cross-machine workers use a federation relay with per-direction sequence numbers and ack checkpoints (`orchestration/federation-sync.ts:19-21`, `types.ts:213-225`).

## 2. Claude agent teams — the tmux shim

Orca **impersonates tmux**. Claude Code's agent-teams pane backend shells out to `tmux`; orca puts a fake `tmux` on PATH.

- **Launch** (`claude-agent-teams-service.ts:25-80`): mints `teamId = team-<uuid>` + 32-byte `token`, leader pane `%1`; injects `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, `TMUX=/tmp/orca-claude-agent-teams/<teamId>,0,1`, `TMUX_PANE=%1`, `TERM=screen-256color`, `COLORTERM`, plus `ORCA_AGENT_TEAMS_{TEAM_ID,TOKEN,LEADER_PANE,SHIM_DIR,SHIM_BIN}` and PATH prepended with the shim dir (Windows `Path` key `:36`).
- **Shim** (`claude-agent-teams-shim-env.ts:135-170`): writes `~/.orca/claude-agent-teams-bin/tmux` (+ `tmux.cmd`) — a 10-line `sh` script `exec "$ORCA_AGENT_TEAMS_SHIM_BIN" agent-teams-tmux "$@"`. **Refuses a non-absolute shim bin** (`:141-146`): a relative `orca` would resolve against the agent's cwd and run with the team token — real privilege-escalation guard. `TERM_PROGRAM` deleted (`:58`).
- **Transport**: shim → unix socket / named pipe RPC `agentTeams.tmuxCompat` carrying `{teamId, token, envPane, cwd, argv}` (`cli/index.ts:183-206`; `cli/runtime/transport.ts:23-33`). Auth = `teamId+token+known pane` (`claude-agent-teams-service.ts:109-118`).
- **Dispatcher** (`claude-agent-teams-tmux-dispatcher.ts:19-82`): ~20 tmux verbs onto 6 terminal ops (`AgentTeamsTerminalApi`, `claude-agent-teams-types.ts:32-51`): `split-window`→`splitTerminal`, `send-keys`→`sendTerminal`, `capture-pane`→`readTerminal` (tail 1000), `select-pane`→`focusTerminal`, `kill-pane`→`closeTerminal`, `display-message`/`list-panes`→synthesized tmux format strings (`claude-agent-teams-pane-layout.ts:44-63`).
- **`respawn-pane`** is the hard case: Claude splits a `cat` holding pane then respawns it; a PTY can't swap programs, so orca closes and re-splits from the same origin while keeping the fake pane id stable (`:140-187`), refusing if the close was not confirmed (`describeUnconfirmedAgentStop`, `pty-liveness-verdict.ts:25-34`).
- **Layout**: tmux `-h` remapped to orca's `vertical` naming; `main-vertical` tracks `{mainPane, lastColumnPane}` so subsequent splits stack in the last column (`claude-agent-teams-pane-layout.ts:13-42`).
- **Modes**: `off | in-process | native-panes-shim` (`claude-agent-teams-tmux-compat.ts:1`); Windows and un-qualifiable shim bins degrade to `--teammate-mode in-process` (`claude-agent-teams-shim-env.ts:39-52`). Mode re-inferred from a captured `--teammate-mode` in a resumed launch (`orca-runtime.ts:1690-1707`).
- **Lifecycle leak fix**: teams were only evicted on explicit close; `claude-agent-teams-pty-exit-leak.test.ts:39-90` pins eviction on `onPtyExit` and `dropDisconnectedPtyRecord` too.

## 3. Persistence / replay / UI

SQLite in main only: `messages`, `deliveries` (`outstanding|acknowledged|fenced` with `consumer_generation` fencing, `types.ts:55-65`), `worker_terminal_archives`, `tasks`, `dispatch_contexts`. Replay = an outstanding `deliveries` row survives restart and re-pointers exactly once (`orchestration-message-delivery-identity.test.ts:264`).

**There is no mailbox UI.** Messages are visible only as terminal text in the recipient pane. The renderer projects `AgentStatusOrchestrationContext` (`agent-status-types.ts:65-76`) onto sidebar/dashboard rows to draw coordinator→worker lineage (`agent-row-lineage-model.ts:21-129`, `worktree-agent-rows.ts:50-92`); in-process teammates become indented child rows. Renderer uses just two orchestration RPCs — `dispatchShow` (makes `task_*` tokens in terminal output clickable, `terminal-orchestration-task-links.ts:61`) and `workerTerminalUserInput`.

## 4. Claude-specific vs generic

**Generic**: the whole mailbox/orchestration layer. Agent coupling is only (a) idle-gating via agent hooks (works for claude/codex/opencode/gemini…), and (b) the CLI text protocol shipped as a *skill* installable per agent (`skills/orchestration/SKILL.md`, `skills-cli-agent-keys.ts:14-41`). Codex/OpenCode can already be dispatched as workers (`tui-agent.ts:7,9`; `orchestration-worker-launch-preferences.ts:51-75`). One quirk: Cursor panes get the pointer but **no** `\r` auto-submit (`mailbox-pointer-delivery.ts:244-252`).

**Claude-only**: everything `claude-agent-teams-*` — exists solely because Claude Code's teams feature drives real tmux. Gated by `isDirectClaudeCommand` (`claude-agent-teams-tmux-compat.ts:169-179`).

## 5. Top 5 to port into anywhere-terminal

1. **Pointer-not-payload delivery, gated on observed-idle** (`mailbox-pointer-delivery.ts:46`, `formatter.ts:112-117`). Never paste a message body into an agent's TTY; write one line telling it to run a CLI, only when idle was observed *live*. Cheap, survives agents that reformat pasted text.
2. **Transport-settled writes + watermark/flight state** (`pty-provider-contract.ts:140`, `mailbox-pointer-state.ts:73-123`). Don't mark delivered until the pty layer confirms; one in-flight write per pty; park and replay the rest. AT's `pty.write` currently returns void — same gap.
3. **The tmux-shim pattern** (`claude-agent-teams-shim-env.ts:20-60`, dispatcher). AT owns multiple ptys + a split model (`src/webview/SplitModel.ts`) — it could host Claude agent teams as native VS Code splits by shipping a PATH-shadowing `tmux` that RPCs back to the extension host. Copy the absolute-path guard (`:135-149`).
4. **Identity tuple + launch-token attestation** (`orca-runtime.ts:28110-28115`, `orchestration-compatibility-authority.test.ts:22-54`). Inject `AT_LAUNCH_TOKEN`/`AT_PANE_KEY`/handle at spawn, hash-verify on every mutation, keyed to host scope + process incarnation. Solves "which pane is this CLI call really from" after reload/resume — a problem AT's vault panel already has.
5. **A single liveness vocabulary** (`pty-liveness-verdict.ts:9-34`): `exited | live | unverifiable` — losing contact is never a death certificate. Plus eviction on *every* teardown path (`claude-agent-teams-pty-exit-leak.test.ts:39-90`) — same bug class as AT's body-overlay disposal lesson.
