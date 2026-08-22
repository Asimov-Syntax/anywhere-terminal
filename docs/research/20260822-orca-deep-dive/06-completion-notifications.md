# Orca deep-dive 6/7 — Completion, notifications, status projection

Source repo: `/Users/huybuidac/Projects/ai-oss/orca`. Maps to AT's tab running indicators (split tab lighting), OS notifications, and status shown in the vault panel.

## 1. Sources of truth, ranked

`agent-status-observation.ts:12-25` enumerates origins in descending trust: `hook` → `osc` (OSC 9999 payload in PTY bytes) → `title` ("the weakest evidence Orca acts on") → `process` → `launch` → `orchestration`. Header rule (`agent-status-types.ts:1-3`): status comes from hooks, **never** inferred from titles; titles are fallback or veto only.

Merge point: `resolvePaneAgentActivity` (`pane-agent-evidence.ts:80-117`). It deliberately does **not** collapse to one status — returns `hookState` + `titleStatus` + `source` (`hook|title|none`) + `confidence` (`authoritative|fallback`) + `livePtyRequired`, because consumers legitimately combine them differently (`:52-58`). Fresh hook row wins outright; a title-only claim is `fallback` and carries `livePtyRequired: true` when there's no live PTY.

Title identity has two facets (`pane-agent-evidence.ts:36-50`): *activity label* accepts Claude's bare prefixes (`✳`, `. `, `* `, braille spinner) as "something is running"; *committed identity* (`terminal-title-agent-type.ts:281-287`) rejects them — activity is not proof of *who*.

Process liveness is a backstop, polled at tiered cadence (`agent-completion-coordinator.ts:58-80`): active 750ms / idle 2s / hidden 3s / no-evidence 15s, jittered ±10% (`:828`), exponential backoff on inspection errors (`:820-830`).

## 2. Completion detection

Only `state === 'done'` ends a turn (`agent-completion-coordinator.ts:86-94`); `waiting`/`blocked` are *attention*, never completion. Three completion sources with distinct authority (`:25`): `hook`, `title`, `process-exit`.

Quiet vs real completion:

- **Hook `done` quiet window** — `HOOK_DONE_QUIET_MS = 1_500` (`:70`), `scheduleHookDoneCompletion` (`:517-547`). A later `working` title/hook cancels the pending done (`:876-894`, `:1046`) → milestone-`done` agents (Pi/OMP) never raise a false banner (`:318-321`).
- **Attention debounce** — `CODEX_ATTENTION_QUIET_MS = 1_500` (`:72`, `:500-514`): a Codex "Approve for me" pause that self-resolves cancels its own notification.
- **Title fallback held pending** — a generic spinner→cwd transition is provisional; `holdTitleCompletionPending` (`:602-615`) waits for a process probe to prove agent ownership, TTL 15.5s / max 30s (`:66-68`).
- **Process exit needs two consecutive idle samples** plus `hasChildProcesses === false` (`:670-698`); an `unavailable` inspection breaks the proof rather than erasing evidence (`:652-657`).
- **Session-boundary `done` is not a completion** (`:1064-1070`) — resume/clear landing idle (`sessionBoundary`, `agent-status-types.ts:186-188`) records evidence but never completes.
- **Claude background inventory** — pane stays `working` after the lead turn ends; hook stamps `turnCompletedAt` (`agent-status-types.ts:190-192`). Coordinator announces on that stamp with `notifyWithoutLifecycle: true` (`:1003-1028`) and suppresses the later all-clear `done` as duplicate (`:1096-1106`).

`agentEntryCompletionAt` (`agent-completion-time.ts:35-43`) is the single clock for "finished at": null unless non-interrupted `done`; for a session-boundary `done` it digs the last real completed turn out of `stateHistory` (`:9-24`). One clock for displayed age AND sort eligibility → a row can't rank "freshly done" while showing a stale age.

## 3. Truthfulness invariants

From `orca-runtime-hook-agent-status-projection.test.ts` and `orca-runtime-mobile-agent-status-title-truthfulness.test.ts`:

1. **Stale hook row → identity-only `done`, empty prompt, no `interactivePrompt`** (projection `:173-183`; `AGENT_STATUS_STALE_AFTER_MS = 30min`).
2. **Hydrated-but-unconfirmed rows are never fresh** — `restoredUnconfirmed` (`agent-status-types.ts:153`, `:283-295`); otherwise a persisted `last-status.json` resurrects an unanswerable question card on every restart (`:200-207`).
3. **Resume-identity rows never fabricate live state** (`providerSessionOnly`, `:187-195`).
4. **Shell title reclaims the pane** — `zsh`/`bash`/`pwsh` force `done` even against a published `working` (truthfulness `:194-214`); but a *neutral* title (`Terminal`) is **not** proof of completion (`:182-192`).
5. **A pending question survives a non-agent title** (`:240-248`) yet must not carry into the next working interval (`:250-280`) or across a provider generation reset (`:282-294`).
6. **Newest evidence wins by timestamp, both directions**: older hook `done` can't erase a newer spinner title (`:310-329`); newer hook row publishes with its own `updatedAt` (`:333-355`).
7. **Identity-only fallback dates itself by title evidence, not output bytes** (`:227-265`) — else the host frame is perpetually newer than the client's and the pane flaps.
8. **No transport identity leaks to clients** — exact key allowlist (`:150-171`; `pickParsedAgentStatusPayload`, `agent-status-types.ts:210-229`).
9. Dispatch-side: no notification without a live PTY *or* a fresh accepted hook snapshot (`use-notification-dispatch.ts:137-140`); stale split-leaf completions dropped (`:150-156`); a snapshot superseded by a newer turn dropped (`agent-completion-snapshot-staleness.ts:4-27`); a process-exit completion never borrows a stale active prompt (`:110-116`).

## 4. Notification pipeline

- **ID** = `agent:<worktreeId>:<paneKey>:<trunc(stateStartedAt)>`, null if any part missing (`agent-notification-id.ts:7-25`). Derivable from state alone → reconstructable at ack time: focusing a pane recomputes the same id and calls `notifications.dismiss` (`ui.ts:355-368`, `:1215-1245`), closing both desktop and mobile notifications (`notifications.ts:88-104`).
- **In-coordinator dedup**, layered: `completionToken` (`:195-203`) + 1s replay guard (`:69`, `:433`) + cross-remount `lastCompletionIdentityByPaneKey` module map (`:39`) so a worktree switch remounting the pane can't replay; cross-source dedup on `agentIdentity` (`:403-408`).
- **Burst cooldown**: 5s, keyed by *worktree* not source, so agent-finish + BEL in one chunk surface once (`notification-burst-cooldown.ts:1,23-37`).
- **Mobile replay**: 256-entry ring, monotonic `notificationSeq` + per-process `notificationEpoch` UUID so a restarted counter isn't read as "nothing missed"; `getMissedSince(seq, epoch)` is an exact idempotent cut (`mobile-notification-replay.ts:38-88`).
- **Heartbeat**: interval = STALE_AFTER/2 (15 min), 50ms global spacing (`mobile-session-tabs-agent-status-heartbeat.ts:4-5`) — republishes so a decorative-spinner-only pane's status lease can't silently expire; a *semantic* title observation cancels the pending heartbeat (`:68-78`).
- **Coalescing**: 50ms trailing / 250ms max per worktree (`mobile-session-tabs-notify-coalescer.ts:12-13`).
- **Spinner-frame suppression**: `isDecorativeAgentTitleFrameChange` (`agent-decorative-title-signature.ts:20-23`) strips braille `U+2800–28FF` and Claude 2.1's quarter circles `U+25D0–25D3` (`:50-52`), normalizes whitespace → `⠋ Fix tests` and `⠙ Fix tests` are one state, not two renders.

## 5. Worth porting to anywhere-terminal

1. **Split evidence, don't merge** — copy `resolvePaneAgentActivity`'s shape so tab indicator, hover card, and notifier each pick their own rule. Cheapest high-value change.
2. **Decorative-frame signature** — drop-in for xterm `onTitleChange`; kills per-frame tab re-renders from spinner titles.
3. **Two title facets** — committed identity for the tab's agent badge; activity label for the running dot.
4. **1.5s quiet window on `done` + cancel-on-`working`** — single biggest false-positive killer for OpenCode/Codex milestone dones. Directly relevant to AT's split-tab lighting (recent fix "light a split tab when any background pane is running").
5. **Two-consecutive-idle-sample process exit with `hasChildProcesses` guard** — pty-liveness backstop without the handoff blip.
6. **Reconstructable notification id + dismiss-on-focus** — OS-notification withdrawal for free, no id registry.
7. **Freshness scheduler** (`agent-status-freshness-scheduler.ts:34-92`) — one timer at the next expiry (+1ms), independent expiries for hook-freshness and completion-age; "running" dot decays without a polling loop.
8. **`restoredUnconfirmed`** — AT persists sessions across VS Code reloads (`src/session/SnapshotPersistence.ts`): mark rehydrated non-`done` rows unconfirmed or every reload shows phantom running tabs.
9. **Worktree/window-keyed 5s burst cooldown** so BEL + done in one chunk is one toast.
10. **`sessionBoundary` semantics** — a resumed/cleared session landing idle must not fire "done"; likely a live bug source in AT's resume paths (`VaultLauncher` resume into terminal).
