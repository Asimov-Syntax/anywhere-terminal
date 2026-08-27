# Design: upgrade-turn-state-presence

Blueprint WT-006.3. The accepted contracts live upstream and are not restated here:
the event→turn-state table and the turn→activity precedence table are
[agent-hook-server.md](../../../docs/design/agent-hook-server.md) § 4.4–4.6, the activity
rules are [worktree-agent-presence.md](../../../docs/design/worktree-agent-presence.md)
§ 3.3, the subagent rules are § 3.6, and the 60 s staleness window is
[DESIGN.md](../../../docs/DESIGN.md) § 15. What follows is only the mechanism those
contracts do not fix, and the evidence for each choice.

## Decisions

### D1: A content hash is not an event identity, so duplicate correlation is time-bounded

`install-claude-hooks` D21 accepts a `moving` window in which two managed hooks are installed at
once and the agent posts every event twice, and assigns the consequence here: "its turn-state
reducer must treat a duplicate post as idempotent rather than as two turns."

The transport already hashes the raw POST body (sha256, per agent-session) and drops a repeat
within 5 minutes. At that window it is not merely incomplete — it is wrong, because a Claude
hook body carries no event identity to hash. The base payload is `session_id`,
`transcript_path`, `cwd`, and optional mode/agent fields; `UserPromptSubmit` adds only `prompt`
(`claude-code/src/entrypoints/sdk/coreSchemas.ts:387,487`). There is no timestamp, no sequence,
and no occurrence id. So two **legitimate** events are byte-identical whenever:

- the same prompt is submitted twice in one session;
- two `PermissionRequest`s carry the same tool input — that payload has no `tool_use_id`;
- two `Stop`s carry the same `last_assistant_message`.

Dropping those produces exactly the failure this change exists to prevent: a resubmitted prompt
leaves the row authoritatively idle while Claude works.

**The window is therefore sized to what it correlates, not to a cache.** A D21 twin is two hooks
fired from one Claude event, and each post is bounded by the wrapper's `--max-time 1.5`
(`claudeConfigAdapter.ts:195`), so the pair lands milliseconds apart. Duplicate correlation uses
a **2 s** window. A legitimate repeat needs a human keystroke or a model turn, and clears it.

The residual, stated plainly: two genuinely distinct events with an identical body inside 2 s
collapse into one. For a human-submitted prompt that is not reachable. For two identical
permission requests it is indistinguishable from a twin on the evidence available — nothing in
the payload can tell them apart. That is a deliberate false-positive trade, and task 1_0 tests
both sides of it.

| Layer | Mechanism | Where |
|---|---|---|
| Transport | sha256 of the body, per agent-session, **2 s** correlation window | `AgentHookRuntime.deliver` — task 1_0 |
| Reducer | structural — the same event applied twice yields the same state | tasks 1_2, 1_3 |
| Publication | a repeat of the value just reduced is not republished | channel `publish` — **downstream of the reducer**, so it is a redundant-render guard, not duplicate containment |

The reducer does not lean on the transport. State is a pure function of `(event, current state)`;
the roster is a `Map` keyed by the reported child id, so a repeated start is one upsert and a
repeated stop one delete; `stateStartedAt` advances only when the state actually changes.

The TTL is an implementation constant, not an accepted contract — `agent-hook-server.md` does not
document deduplication — so narrowing it reopens nothing upstream.

Rejected: minting an event id in the wrapper and deduping on it. It is the textbook answer and
the research recommended it, but it would change the installed wrapper script and the ledger's
ownership comparison — both owned by an in-flight change in another session.

### D2: Turn state lives in the pane evidence store, and expires as authority rather than as a record

The projector does not read `SessionManager` or the hook runtime; it reads `PaneEvidenceStore`
through `presenceDeps` (`panes()` and `activityFor`), and a `Pane` is literally
`PaneEvidence & { paneId }`. Holding the reported turn as another evidence field therefore needs
no new plumbing to reach the row, and inherits eviction on every pane-destruction path, the
existing per-pane timer and announcement machinery, and the pane set itself — so a report for a
pane that no longer exists cannot resurrect a row.

**A turn has two lifetimes, and the store must keep them apart.** Its authority over activity
ends at the staleness window; the identity it carried (session, transcript path, agent) lives
until a newer report supersedes it or the pane is destroyed. So the timer announces a projection
change at expiry — it does not delete the record. Deleting at 60 s would discard the identity the
accepted spec requires be retained, and would take the row's fallback identity with it.

Rejected: a separate turn-state store beside it. It would need its own teardown hooks on the same
four paths, and two stores keyed by pane id that must agree about which panes exist is the shape
that produces a row whose activity and identity disagree about which pane it is.

### D3: The channel publishes a value, not a string, and Cursor's meaning is unchanged

`AgentHookChannel.publish(state: string | null)` carries Cursor's whole vocabulary because
Cursor's whole vocabulary is two words. A turn carries a roster, an interactive prompt, and the
anti-lying flags, none of which fit a string.

`publish` widens to accept either the string Cursor already sends or a structured turn, and the
"drops a repeat of the current value" rule widens with it to a structural comparison. Cursor's
call sites do not change and its published values compare exactly as before.

Rejected: a second `publishTurn` method beside it. Two publication paths mean two places the
revocation check (`state.active`) must be right, and that check is what stops a module retaining
its channel past teardown.

### D4: Both timestamps are minted here, because the payload carries none

A Claude hook payload has no `updatedAt`, no `stateStartedAt`, no sequence number and no event
time — the base schema is identity and location only. So there is no agent clock to prefer or
discard: receipt time is the only clock available, and staleness is computed from it.

This lands where orca's experience points anyway — it measures freshness from the reporting
host's timestamp and documents in its own source that mirrored rows then decay incorrectly under
skew — but the reason here is availability, not skew.

What receipt time cannot do is order two reports that arrive out of order, and no agent
timestamp would have fixed that either, because none is sent. Correctness comes from making the
concurrent operations commute instead: a lead `Stop` and a child `Stop` reach the same state in
either order (task 1_3).

### D5: The wiring seam is the last task, and it is small but not a single line

Everything above lands in files this session owns — `src/agentHooks/agents/claude.ts`,
`src/agentHooks/AgentHookRuntime.ts`, `src/session/PaneEvidenceStore.ts`,
`src/worktree/presenceProjector.ts`, `src/worktree/presenceDeps.ts`,
`src/worktree/presenceTypes.ts`, `src/providers/WorktreeHost.ts`.

Two edits fall outside them, both in `src/extension.ts`: the runtime's `onStatus` callback
returns early for every agent that is not Cursor, so a published turn currently reaches nothing;
and `createPresenceProjectorDeps` gains the session-resolution dependency task 3_3 needs. That
file is being rewritten by another session's in-flight task (activation wiring), so the wiring is
sequenced last: that task lands, this branch rebases, then both edits go in. Agreed with that
session; it is a coordination constraint, not a design one, and nothing else in this change waits
on it.

### D6: Interrupt detection is not built, because the event that would prove it is not sent

`agent-hook-server.md` § 4.4 maps `Stop` / `StopFailure` with `is_interrupt` → `interrupted`.
That premise is wrong against the installed CLI: `is_interrupt` is a field of
`PostToolUseFailure` (`coreSchemas.ts:451-456`), and neither `Stop` (`:516`) nor `StopFailure`
(`:532`) carries it. `PostToolUseFailure` is not a registered event, and registering it would
edit the installer's event list, which another session owns. A generic Ctrl+C has no hook signal
at all, and keystroke inference is out of scope upstream.

So no requirement in this change promises interrupt detection. The reducer decodes `interrupted`
when a payload happens to carry it and never synthesises it, an interrupted turn reads as an
ordinary finished turn, and § 4.4's row is corrected at Blueprint Sync rather than implemented
against a field that does not exist.

The same evidence splits `/compact` in two. `SessionStart` already carries
`source: "compact"` (`:496`) and is already registered, so the post-compact boundary is free and
task 1_3 handles it as the session boundary it is. `PreCompact` → `working` needs that event
registered, which is the installer's file and its tests — deferred, with the consequence bounded:
a pane reads idle while compacting rather than showing a stuck spinner.

## Interfaces

```ts
/** agent-hook-server.md § 3. Carried as pane evidence (D2). */
interface PaneTurnEvidence {
  state: "working" | "waiting" | "done";
  /** Local receipt time. The only clock available (D4); what staleness measures. */
  receivedAt: number;
  /** Minted here when the state changes, never read from the payload (D4). */
  stateStartedAt: number;
  agent: VaultAgentId;
  sessionId?: string;
  transcriptPath?: string;
  toolName?: string;
  interactivePrompt?: string;
  /** Decoded when present; never synthesised, and no requirement depends on it (D6). */
  interrupted?: boolean;
  sessionBoundary?: boolean;
  subagents: readonly PaneTurnSubagent[];
}

interface PaneTurnSubagent {
  id: string;
  name?: string;
  state: "working" | "idle" | "done";
  startedAt: number;
}
```
