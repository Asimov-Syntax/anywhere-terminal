---
topic: turn-state-reducer-prior-art
created-by: upgrade-turn-state-presence
change-id: upgrade-turn-state-presence
date: 2026-08-27
verified: 2026-08-27
libraries: [orca, opencode, claude-code]
used-by: [upgrade-turn-state-presence]
---

# Research: turn-state-reducer-prior-art

## Scope and evidence

Local checkouts only. Revisions inspected: Orca `9062494f9b` (`1.4.178-rc.2`); OpenCode `d0c2b41adf`; Claude Code `a371abb`. Claude Code supplies the hook contract; Orca is the directly comparable per-pane hook reducer; OpenCode owns its agent runtime and therefore is not an at-least-once hook receiver.

## Answers

### 1. Event → state mapping

**Claude Code hook contract.** The source event vocabulary is `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`, `PermissionRequest`, `PermissionDenied`, `TeammateIdle`, and more. `agent_id` is explicitly the discriminator for a subagent event; it is absent on the main thread. `Stop` has no interrupt bit, while `PostToolUseFailure` can; therefore the reducer must treat the `Stop`/`StopFailure` boundary's `is_interrupt` payload where present rather than infer cancellation from an arbitrary failure. Contract: `../../claude-code/src/entrypoints/sdk/coreSchemas.ts:355-410, 413-589, 591-599, 747-797`.

**Orca's Claude reducer has four visible states:** `working`, `waiting`, `blocked`, `done` (`src/shared/agent-status-types.ts:23-25`). Its exact Claude fold is:

| Incoming evidence | Reducer result / rule | Evidence |
|---|---|---|
| `SessionStart` with source `startup`, `resume`, or `clear`, no `agent_id` | `done` with `sessionBoundary: true`; resets lead state, child roster, background-task and cron gates. It is explicitly *not* a completed turn. `compact` and unknown starts are ignored. | `orca/src/shared/agent-hook-listener/providers/claude-events.ts:43-70` |
| `UserPromptSubmit`, `PostToolUse`, `PostToolUseFailure`, ordinary `PreToolUse` | `working`. A new explicit user prompt is the turn boundary; tool events are activity inside that turn. | `claude-events.ts:72-113`; `orca/src/main/agent-hooks/server.ts:1397-1419` |
| `PermissionRequest`, or `PreToolUse` for `AskUserQuestion` | `waiting`, retaining the tool-use/child identity so only the owning child's continuation clears it. | `claude-events.ts:90-113, 137-195`; `claude-roster-state.ts:226-276` |
| Lead `Stop` or `StopFailure` | a *lead turn boundary*. Normally `done`; `is_interrupt: true` (or carried prior interrupt) yields `done, interrupted: true`. | `claude-events.ts:72-80, 207-280` |
| Lead boundary with a live working child | Records lead `done` but publishes `working` and stamps `turnCompletedAt`; when the roster drains, re-emits `done` carrying that same stamp. Thus completion notification can be paired to the lead turn while UI truth stays “children working.” | `claude-events.ts:256-314`; `claude-lifecycle-events.ts:109-143`; `claude-roster-state.ts:126-145` |
| Lead boundary with a running non-agent background task or session cron, and not interrupted | Publishes `working` with `workingMode: 'monitoring'`; interruption clears those gates, so a canceled lead does not falsely remain active. | `claude-events.ts:118-135, 235-238`; `claude-roster-state.ts:105-145` |
| Manual `PostCompact` | `done, sessionBoundary: true`; clears only a manually compacted idle boundary. Auto compact and `PreCompact` do not create a state transition. | `claude-events.ts:97-102, 240-254, 296-314`; `agent-hook-listener.ts:46-100` |
| Child `Pre/PostToolUse` | Updates child roster. It cannot overwrite the lead turn; it only re-emits cached lead state and applies the done gate. | `claude-events.ts:151-205`; `claude-lifecycle-events.ts:109-143` |

This is the defensible distinction requested: `done` is a lead fact, `working` can be an effective pane presentation caused by independently live child/background evidence, and `turnCompletedAt` preserves the earlier lead boundary. It is a good fit for an in-memory VS Code extension host: the maps are pane-local and do not require a database. The child/background inventory is provider-specific optional enrichment; implement it only when the hook payload actually supplies it.

**OpenCode's runtime-owned state machine is smaller.** It exposes `busy`, `retry`, and `idle`; `SessionRunState` maps runner `onBusy` → `busy` and `onIdle` → `idle`, deleting the in-memory map entry once idle. Cancel first recursively cancels running background jobs whose session or parent-session matches, then cancels the runner; no runner also becomes `idle`. `packages/opencode/src/session/run-state.ts:35-68, 77-85, 111-143`; `packages/opencode/src/session/status.ts:30-48`. The processing loop publishes `busy` before LLM work, `retry` for retryable provider failures, and `idle` on halt/error; `packages/opencode/src/session/prompt.ts:1081-1129`; `packages/opencode/src/session/processor.ts:599-677`.

OpenCode’s run-stream waits for an `idle` event and polls `/session/status` as a fallback, which is a useful “terminal fact plus current snapshot” pattern, not a turn reducer: `packages/opencode/src/cli/cmd/run/stream.transport.ts:802-871`. It has no equivalent pane/PTY authority or held-open parent status. Do not adopt it as the host reducer.

### 2. Idempotency and duplicate events

**Answer: neither system supplies the needed duplicate-hook semantic deduplication.**

* Orca accepts same-millisecond writes (`updatedAt < existing.updatedAt` is the only timestamp rejection) and increments `acceptedStatusSeq` for **every accepted write**. Consequently two identical managed-hook POSTs refresh `receivedAt`, increment the sequence, and can extend the 30-minute freshness lease. This is intentionally an ordering/tie-break design, not deduplication. `orca/src/renderer/src/store/slices/agent-status.ts:2118-2140, 2320-2390`; `orca/src/main/agent-hooks/server.ts:1422-1460, 1579-1606`.
* Orca has narrow, semantic guards only: manual compact is consumed once per `(paneKey, prompt_id)` (`agent-hook-listener.ts:65-100`, `listener-state.ts:26-31`); identical roster snapshots are structurally equal so the renderer reuses the array (`agent-status-types.ts:327-354`); and a 15-second anti-resurrection guard suppresses delayed tool/replay activity after an inferred interrupt (`server.ts:1546-1572`). None identifies two copies of arbitrary `UserPromptSubmit`, tool activity, `Stop`, or child lifecycle events.
* Orca’s `AgentStatusObservationSequencer` assigns an authority-local monotonic revision and pane incarnation, but it assigns a new revision to every accepted observation; it orders accepted observations and does not dedupe them. `agent-status-observation.ts:112-183`.
* OpenCode publishes every `SessionStatus.set`, including repeated status writes; `session/status.ts:39-48`. Durable sync metadata carries an event id and sequence (`event-v2-bridge.ts:35-60`), but the inspected status consumer has no event-id/sequence no-op gate. It is not evidence that clients tolerate duplicate status transitions.

**Recommendation for WT-006.3:** add an extension-host ingress dedupe layer; do not copy Orca’s timestamp rule. Give every managed hook event a stable `eventId` generated before either installation posts it, then retain a bounded LRU/TTL `Set` keyed by `(pane identity/incarnation, eventId)`. If changing the hook body is impossible, derive a canonical event key from the stable fields: provider, `session_id`, hook event name, `agent_id`, `tool_use_id`, `prompt_id`, compact trigger, and a canonical payload hash; retain it only for the overlap window. Do not use receive time, a monotonic clock, or state equality as the duplicate key: two legitimate same-state tool events must remain activity and a duplicate must not refresh freshness.

### 3. Freshness and decay

Orca defines `AGENT_STATUS_STALE_AFTER_MS = 30 minutes`. A non-`done` row is fresh only if it is not `restoredUnconfirmed` and `now - updatedAt <= TTL`; `done` is never “fresh non-done.” `orca/src/shared/agent-status-types.ts:245-262`. It **keeps** stale rows in the status map but freshness-aware presentation drops hook authority and may fall back to a live terminal title; the result distinguishes “no fresh hook claim” from an idle/done hook claim. `orca/src/renderer/src/lib/pane-agent-evidence.ts:12-24, 80-116`. The scheduler wakes at expiry to rerender; it does not delete on expiry. `renderer/src/store/slices/agent-status-freshness-scheduler.ts:34-91`.

This is a good fit for an extension host, with a correction: decay by local receipt time (or an authority-provided expiry), not the remote host timestamp. Orca itself documents that host-clock `updatedAt` makes mirrored remote rows decay incorrectly under clock skew: `orca/src/shared/agent-status-observation.ts:83-96`.

OpenCode does not implement status TTL/decay. `idle` is an asserted current runtime fact and removes the status map entry, after publishing `session.status` and `session.idle`; absence defaults to idle. `opencode/packages/opencode/src/session/status.ts:30-48`. That conflates “there is no in-memory active runner” with idle and is only defensible because the owner controls runner lifecycle. It is not safe for a hook-fed extension host after a transport failure.

### 4. Process reality overriding reports

Orca is explicit that PTY/pane lifecycle wins over a hook claim:

* A physical PTY exit unconditionally calls `removeAgentStatus`; it clears the pane’s title/cache marker as well. `orca/src/renderer/src/components/terminal-pane/pty-connection/pty-exit-hibernate.ts:203-235`.
* Main-process pane retirement clears every pane-scoped listener cache, rosters, latches, timers, prompt dedupe state, authority observation, and marks a fence so late posts are suppressed. A live reattach lifts the fence, but never over a closed tab. `orca/src/main/agent-hooks/server.ts:1958-2051`; the actual cache inventory is `src/shared/agent-hook-listener/listener-state.ts:80-115, 198-216`.
* A terminal/tab close remains a bounded closed-tab/pane tombstone, so late IPC/hook replay is rejected by both main and renderer. Renderer rejection: `renderer/src/store/slices/agent-status.ts:2118-2130`; main disposition begins at `main/agent-hooks/server.ts:1164-1200`. Explicit renderer teardown is propagated back to main to prevent cache hydration resurrection: `renderer/src/store/slices/agent-status.ts:2819-2904`.
* SSH transport loss is a reversible clear with a monotonically advanced connection watermark. It removes only rows belonging to the lost connection; renderer discards queued events at or before that watermark and prevents an old remote report from recreating them. `main/agent-hooks/server.ts:2811-2860`; `renderer/src/hooks/ipc-events/agent-status-listeners.ts:35-89`; `renderer/src/store/slices/agent-status.ts:2768-2817`.

This is the strongest prior-art match. Adopt the precedence rule: **known pane/process exit or tab disposal > connection-loss watermark > hook report > stale-cache/hydration.** Store an incarnation/token with the pane and reject reports that belong to retired incarnations. The full Orca implementation depends on Electron PTY and SSH relay infrastructure; the principle and in-memory tombstone/epoch maps do not.

OpenCode instead owns the process/runner. It cancels running background jobs before runner cancellation (`run-state.ts:77-85, 111-143`) and recursively cancels jobs when deleting a session (`session/session.ts:608-629, 940-955`). This is appropriate only where the reducer owns all child processes; a VS Code extension observing external CLIs cannot honestly copy that authority.

### 5. Subagent rosters

Orca’s per-pane `Map<agent_id, TrackedClaudeSubagent>` is the usable model. `SubagentStart` upserts `working`; one-shot `SubagentStop` removes, whereas teammate-shaped IDs become `idle` because their stop is a turn boundary, not process death; `TeammateIdle` confirms and parks a resumable teammate. Only `working` roster entries gate parent `done` to effective `working`. `orca/src/shared/claude-subagent-roster.ts:9-18, 63-97, 115-132, 285-317`; lifecycle fold: `agent-hook-listener/providers/claude-lifecycle-events.ts:19-107`.

Leak prevention is deliberately multi-source:

1. A complete lead `Stop` inventory (`background_tasks`) reconciles/clears one-shot and workflow children, recreates a missed running child, and only preserves teammate-shaped rows when the inventory gives enough evidence. `claude-subagent-roster.ts:134-248`.
2. Snapshot-restored children are marked unconfirmed and may be reaped by a complete inventory or local process-liveness check; `claude-roster-state.ts:154-180, 207-223`; `claude-subagent-roster.ts:250-259`.
3. A different lead `session_id` voids prior-session unconfirmed rows, while keeping only confirmed in-process teammates and independently evidenced background processes. `claude-roster-state.ts:15-90`.
4. PTY/pane/tab teardown clears the entire listener state, not just the visible row. `listener-state.ts:80-115, 198-216`; `main/agent-hooks/server.ts:1958-1986, 2971-3006`.

This is a good fit with caveats: track a child only when it has a provider-assigned stable ID; enforce a hard size cap; retain an `evidence`/`confirmed` bit; and never let a persisted roster alone hold a pane working. The `background_tasks` reconciliation and local process liveness are optional provider-/host-specific infrastructure, not prerequisites for the basic Map and lifecycle events.

## Recommended Approach

- Model `leadState` separately from `effectivePaneState`; make only a lead `Stop`/`StopFailure` a completed-turn boundary, retain `interrupted`, and gate a lead `done` to `working` only while live child evidence exists. Carry a stable `turnCompletedAt` through the child-drain all-clear.
- Install a bounded ingress event-id/canonical-event-key dedupe window before all state mutation. This is a requirement absent from both prior-art implementations; duplicates must not mutate receipt time, freshness, history, or child roster.
- Maintain per-pane incarnation/tombstone and local-receipt freshness. Process/pane disposal and transport-clear watermarks evict reports; stale reports become “unknown/no current claim,” not `idle` or `done`.

## Gotchas & Constraints

- `SessionStart` and manual compact completion are idle session boundaries, not completed turns; do not trigger completion UI from them.
- `TeammateIdle` is not necessarily child termination. Park it as `idle` only if the provider contract proves a resumable teammate; otherwise remove it on stop.
- A child’s tool activity must not reset or overwrite the parent’s prompt/tool/turn fields.
- Orca’s broad cache persistence (seven-day hydration horizon) is Electron-specific continuity behavior; the extension’s per-window in-memory state should instead clear on extension-host reload unless a separately authenticated process snapshot exists.
- OpenCode durable-event id/sequence metadata is transport infrastructure, not proof that status clients dedupe state events.

## Confidence

High — direct local source inspection supplied the Claude hook schema, Orca reducer/roster/eviction paths, and OpenCode runtime status owner. The duplicate-event conclusion is negative but grounded in the actual acceptance paths: no generic event id, sequence, content hash, or dedupe window is consulted before their status writes.
