// src/vault/types.ts — Shared vault types (agent registry + session index).
// See: asimov/changes/add-ai-coding-vault/design.md Interfaces, D1, D4.

export type SessionStoreFormat = "jsonl" | "sqlite" | "metadata-json";

/**
 * The vault's agent ids, in stable list order. SINGLE source of truth: the
 * `VaultAgentId` union is derived from this array, and the registry record, the
 * host reader maps, and the webview icon map are all typed against it — so
 * adding an id here forces (at compile time) a registry entry, both readers, and
 * a webview icon/accent entry. Lives in types.ts (not registry.ts) so the
 * webview — which must NOT import the host's launch data — derives its
 * presentation types from the same source. Ids MUST NOT contain `:` (the
 * entryId separator); enforced by a test.
 *
 * Adding a vault agent (all compile-enforced EXCEPT the CSS step):
 *   1. add the id here;
 *   2. add its `AgentVaultDefinition` to `AGENT_RECORD` (registry.ts);
 *   3. add list + detail readers to VaultService's reader maps (+ a reader module);
 *   4. add an `AGENT_ICONS` entry — icon + accent + displayName (webview/agentIcons.ts);
 *   5. add `.vault-badge--<id>` / `.vault-row-dot--<id>` / `.vault-preview--<id>`
 *      accent CSS — NOT type-checkable (it's CSS); a manual step.
 *   6. if the CLI reads pasted images off a fixed Ctrl+V (not the OS-native
 *      signal), add its id to `CTRL_V_AGENTS` in shared/imagePasteTrigger.ts —
 *      also NOT compile-enforced; omitting it silently sends the wrong trigger.
 */
export const VAULT_AGENT_IDS = ["claude", "codex", "opencode", "cursor"] as const;
export type VaultAgentId = (typeof VAULT_AGENT_IDS)[number];

/**
 * A vault entry's globally-unique handle: `<agent>:<sessionId>`. The agent id
 * never contains a colon, so the FIRST colon is the separator and the session
 * id keeps any later colons (Claude's nested subagent token
 * `<parent>:subagent:<stem>` rides along intact). Centralized here so every
 * producer/consumer parses the handle identically (S1).
 */
export function formatEntryId(agent: VaultAgentId, sessionId: string): string {
  return `${agent}:${sessionId}`;
}

export function parseEntryId(entryId: string): { agent: string; sessionId: string } | null {
  const sep = entryId.indexOf(":");
  if (sep <= 0) {
    return null;
  }
  const sessionId = entryId.slice(sep + 1);
  if (!sessionId) {
    return null;
  }
  return { agent: entryId.slice(0, sep), sessionId };
}

export interface AgentDetectRule {
  /** Preferred executable basename used to detect / launch the agent. */
  executable: string;
  /** Ordered fallback executable basenames. */
  aliases?: string[];
  /** Optional argv needles that must all be present for a process to match. */
  argvContains?: string[];
  /** Help-output needles required to accept an executable with collision risk. */
  requiredHelpTokens?: string[];
}

export interface SessionStoreDescriptor {
  format: SessionStoreFormat;
  /**
   * Documents where this agent's sessions live. Actual path resolution +
   * parsing lives in the per-agent reader (D1): layout/schema differ per
   * agent even within a shared `format`, so this string anchors the reader
   * rather than driving it.
   */
  pathTemplate: string;
}

/** A captured per-session flag value, re-injected into a launch command. */
export interface VaultSessionFlags {
  model?: string;
  permissionMode?: string;
  approval?: string;
  sandbox?: string;
  reasoningEffort?: string;
  agent?: string;
  configDir?: string;
}

export interface FlagFragment {
  /** The CLI flag token, e.g. "--model" or "-m". */
  flag: string;
  /** Which captured flag value fills this fragment; skipped when absent. */
  from: keyof VaultSessionFlags;
  /**
   * Optional value shape; `{{value}}` is replaced by the captured value.
   * Defaults to the raw value. Used by codex's `-c model_reasoning_effort=<e>`.
   */
  valueTemplate?: string;
}

export interface CommandTemplate {
  executable: string;
  /**
   * Static argv tokens (may contain `{{sessionId}}` / `{{sessionPath}}` /
   * `{{executable}}`) interleaved with optional flag fragments that expand
   * only when the captured value is present.
   */
  args: Array<string | FlagFragment>;
}

/**
 * One selectable permission posture for a continuation (D11). Permission is
 * agent-shaped — Claude has one axis, Codex two, OpenCode none — so a choice
 * carries the argv it contributes rather than a shared enum.
 */
export interface AgentPermissionChoice {
  /** Stable id, matched against the entry's captured posture to preselect one. */
  id: string;
  label: string;
  /** True when the choice bypasses the agent's permission checks — shown as such,
   *  never inherited silently. */
  dangerous?: boolean;
  /** Argv tokens this choice contributes, ahead of the prompt. */
  args: string[];
}

export interface AgentVaultDefinition {
  id: VaultAgentId;
  displayName: string;
  detect: AgentDetectRule;
  sessionStore: SessionStoreDescriptor;
  /** How the session id is derived from the store (per-reader, D1). */
  sessionIdSource: string;
  /** Tokens: `{{sessionId}}` `{{sessionPath}}` `{{executable}}`. */
  resumeCommand: CommandTemplate;
  forkCommand?: CommandTemplate;
  /** Starts a NEW session seeded with `{{prompt}}` (Continue in New Session).
   *  Absent → the action is unavailable for that agent. */
  continueCommand?: CommandTemplate;
  /** Minimum agent `--version` for fork support (e.g. opencode "1.1.54"). */
  forkMinVersion?: string;
  /** MVP: always launch in the session's recorded cwd. */
  cwdPolicy: "preserve";
  /** Env var names propagated to the spawned process (claude auth/config). */
  authEnvAllowlist?: string[];
  /** Permission postures offerable when continuing into this agent (D11).
   *  Absent → the agent exposes none and no control is shown. */
  permissionChoices?: AgentPermissionChoice[];
}

/** One agent the reader may continue into, as the host reports it (D11). */
export interface VaultLaunchTarget {
  agent: VaultAgentId;
  displayName: string;
  permissionChoices: AgentPermissionChoice[];
}

export interface VaultSessionEntry {
  /** "<agent>:<sessionId>", globally unique. */
  id: string;
  /**
   * Producing readers SHOULD emit a `VaultAgentId` (and build `id` via
   * `formatEntryId`, whose agent param IS typed). Kept `string` — not narrowed —
   * because this crosses the host→webview IPC boundary where types are erased,
   * so the webview MUST treat it as untrusted and resolve icon/accent/label
   * defensively (unknown → fallback). Narrowing here would be a false guarantee.
   */
  agent: string;
  sessionId: string;
  /** Bounded title preview only (D4). */
  title: string;
  cwd: string;
  /** epoch ms; list sorted desc. */
  modified: number;
  flags: VaultSessionFlags;
  /** Resolved against `forkMinVersion` at list time. */
  canFork: boolean;
  /** False only when the reader has not proven this entry's id works with selected Resume. */
  canResume?: boolean;
  /** Cursor storage domain; omitted for providers and legacy cached entries without source variants. */
  source?: "cli" | "ide";
  /**
   * UI hint ONLY (redesign-vault-panel-ui D9): present iff the session is
   * backed by an on-disk file (Claude always; Codex when a rollout jsonl
   * exists). Its presence tells the webview whether to render the
   * file-targeting context-menu items — it is NEVER used as an action's path
   * input. The host re-derives any path from `sessionId` server-side.
   * DB-backed sessions (OpenCode) leave it undefined.
   */
  sessionPath?: string;
  /**
   * Session's git branch when the agent records it (Claude top-level `gitBranch`,
   * Codex `git_branch`). Undefined for OpenCode (no branch recorded) — the
   * webview omits the branch chip rather than deriving one (enhance-vault-sessions D2).
   */
  gitBranch?: string;
  /**
   * User-supplied custom name, overlaid at serve time from `VaultCustomNameRegistry`
   * (enhance-vault-sessions D1). NOT persisted into the vault list cache — the cache
   * stays agent-derived. When present the webview renders `customName ?? title`.
   */
  customName?: string;
}

/**
 * Per-message token usage attached to an assistant message (enhance-vault-sessions
 * D3/D6). "context" is rendered as token usage: `input` is the prompt/context size
 * (input + cache read/creation), `output` the generated tokens (reasoning tokens
 * are folded into `output` across all agents for a single consistent semantic).
 * `input`/`output` are always co-emitted — a message with no usage carries no
 * `tokens` at all (the whole object is absent), so both are required. `contextWindow`
 * is only set when the agent records it (Codex `model_context_window`); absent otherwise.
 */
export interface VaultMessageTokens {
  input: number;
  output: number;
  contextWindow?: number;
}

/**
 * One step in a session's recent-activity timeline (redesign-vault-panel-ui
 * D6). Records tool **calls** and subagent invocations only — never tool
 * results as standalone steps.
 */
export type VaultActivityStep =
  | { kind: "tool"; tool: string; detail?: string; diff?: { added: number; removed: number } }
  | {
      kind: "subagent";
      /** Agent type, rendered as the `@agent` chip. */
      name: string;
      /** Short delegated-task label shown while collapsed. */
      title?: string;
      /** Bounded delegated prompt revealed on expand. */
      prompt?: string;
      /** Bounded final result revealed on expand when the source records one. */
      result?: string;
      background?: boolean;
      status?: "running" | "completed" | "failed";
      /** A re-invocation of an agent launched earlier in this session. */
      continuation?: boolean;
      /** The source never declared this agent's type, so `name` is the invoking
       *  tool's own name — render the step without an `@agent` chip. */
      undeclared?: boolean;
    };

/**
 * One entry in the preview's full conversation timeline: a user/assistant
 * message, or a tool/subagent step (reusing {@link VaultActivityStep}). Ordered
 * chronologically by the readers.
 */
export type VaultTimelineItem =
  | {
      kind: "message";
      role: "user" | "assistant";
      text: string;
      timestamp?: number;
      /** Assistant model id, when the transcript records it (enhance-vault-sessions D3). */
      model?: string;
      /** Per-message token usage; present only when recorded (enhance-vault-sessions D3/D6). */
      tokens?: VaultMessageTokens;
      /** Opaque reader-owned locator for the source record; absent when the reader cannot address one. */
      msgRef?: string;
    }
  | { kind: "thinking"; text: string; timestamp?: number }
  /**
   * A background-task notification the agent injected as a user-role record
   * (Claude's `<task-notification>` envelope). `summary` is the one line the
   * collapsed item shows, `body` the optional result the reader can expand —
   * both bounded. Not a conversation turn: it never becomes `latestMessage`
   * and never counts toward `messageCount` (improve-vault-transcript-messages D1).
   */
  | { kind: "notice"; summary: string; status?: string; body?: string; timestamp?: number; msgRef?: string }
  /**
   * A context-compaction summary the agent wrote into the user role
   * (`isCompactSummary`). Bounded and rendered collapsed — left as a plain user
   * message it dominates the transcript with tens of KB the human never typed.
   */
  | { kind: "compaction"; text: string; timestamp?: number; msgRef?: string }
  /** A discontinuity where a bounded reader omitted source records. */
  | { kind: "gap" }
  /**
   * An AskUserQuestion turn — a user decision point. Each pair is a question the
   * agent asked plus the option label(s) the user picked; `answer` is absent while
   * the call is still pending (or the session ended on the prompt). `options`, when
   * present, is the full choice list (with descriptions, the picked one flagged
   * `chosen`) the preview reveals on demand. Rendered as a first-class block that
   * breaks the surrounding AI run so it never hides behind a "Show N more" cap.
   */
  | {
      kind: "question";
      questions: {
        prompt: string;
        answer?: string;
        options?: { label: string; description?: string; chosen?: boolean }[];
      }[];
      timestamp?: number;
    }
  /**
   * A nested sub-session (a subagent / workflow child). A lazy stub: `title` +
   * `firstMessage` render the collapsed block; the full transcript is fetched on
   * demand via `entryId` (the resolvable `<agent>:<id>` — OpenCode children by
   * `parent_id`, Claude subagents by their `<sessionId>:subagent:<file>` token).
   * (redesign-vault-panel-ui — fold subagents into the parent preview.)
   */
  | {
      kind: "subagentSession";
      entryId: string;
      title: string;
      firstMessage?: string;
      agent?: string;
      /** Bounded invocation prompt retained when the lazy child detail is unavailable. */
      prompt?: string;
      /** Bounded invocation result retained when the lazy child detail is unavailable. */
      result?: string;
      status?: "running" | "completed" | "failed";
      /** Render subordinate to the launch card addressing the same `entryId`. */
      continuation?: boolean;
      /** The source never declared an agent type — render no `@agent` chip, and
       *  keep that true when a failed nested load falls back to the bounded card. */
      undeclared?: boolean;
      timestamp?: number;
    }
  /**
   * One communication turn of a team member, threaded into the leader's timeline
   * (nest-workflow-team-sessions D13). Unlike a one-shot `subagentSession`, a
   * teammate recurs once per turn and carries direction + color: `from` is
   * `"leader"` or a peer member name, `color` drives a highlighted accent, and
   * `entryId` is the view-only `claude:<memberId>:turn:<n>` segment opened on
   * click. `preview` is the bounded incoming-message text. Structured-clone-safe
   * across postMessage; the webview renders it via a dedicated highlighted node.
   */
  | {
      kind: "teammateTurn";
      entryId: string;
      agentName: string;
      color?: string;
      from: string;
      preview: string;
      timestamp: number;
    }
  /**
   * An inline teammate communication appearing in THIS transcript: an incoming
   * `<teammate-message …>` record (a member's reply delivered to the leader, or
   * the leader's request shown in a member transcript). Stored on disk as a plain
   * `user` record, so without this it renders as a raw, mislabeled "USER" bubble
   * showing the literal tag (nest-workflow-team-sessions D16). Unlike the
   * collapsible `teammateTurn` node, this carries the FULL body inline (bounded) —
   * `agentName` is the sender, `from` (`"leader"`/`"peer"`) the direction, `color`
   * the accent. View-only: no `entryId`, never launchable.
   */
  | {
      kind: "teammateMessage";
      agentName: string;
      color?: string;
      from: string;
      text: string;
      timestamp?: number;
    }
  /**
   * A Claude `/workflow` run, rebuilt from the run manifest's `workflowProgress`
   * (render-vault-workflow-board D1). The sole representation of a run in the
   * timeline — the raw `Workflow` tool call is suppressed (D5). Scalars/ids pass
   * through raw (the webview formats them); each agent's `entryId` is a `:wfagent:`
   * drill-down id, present ONLY when that agent's transcript file exists, and the
   * board reuses the shared nested-detail path to render it (D3). No per-agent
   * run-state / per-phase done-total: sessions are post-hoc, not live (D6).
   */
  | {
      kind: "workflowBoard";
      /** The run id (`wf_*`) — a stable key the webview uses to persist this board's
       *  ephemeral selection (open phases + open agent) across a preview re-render. */
      wfId: string;
      workflowName: string;
      summary?: string;
      status?: string;
      agentCount?: number;
      durationMs?: number;
      totalTokens?: number;
      totalToolCalls?: number;
      model?: string;
      phases: { index: number; title: string; detail?: string }[];
      agents: {
        label: string;
        phaseIndex: number;
        entryId?: string;
        model?: string;
        tokens?: number;
        toolCalls?: number;
        durationMs?: number;
      }[];
      timestamp?: number;
    }
  | VaultActivityStep;

/**
 * On-demand, bounded per-session detail for the preview overlay
 * (redesign-vault-panel-ui D4/D5). Read fresh per row activation — never cached.
 */
export interface VaultSessionDetail {
  /** Echoes the requesting entry id (`<agent>:<sessionId>`). */
  entryId: string;
  /** Explicitly distinguishes decoded timelines from limited metadata detail. */
  contentKind?: "timeline" | "metadata-only";
  /** First real user prompt, truncated (≤ ~600 chars); independent of the tail. */
  firstPrompt?: string;
  /** Most-recent-last, capped to 12, calls + subagents only. */
  recentActivity: VaultActivityStep[];
  /** Last non-sidechain message; independent of the bounded tail. */
  latestMessage?: { role: "user" | "assistant"; text: string; timestamp: number };
  /**
   * Full chronological conversation: user/assistant messages interleaved with
   * tool/subagent steps. Bounded to the most-recent {@link MAX_TIMELINE_ITEMS};
   * `truncated` flags when older items were dropped. Drives the scrollable
   * preview transcript (redesign-vault-panel-ui — full transcript view).
   */
  timeline: VaultTimelineItem[];
  /** True when older timeline items were dropped to stay within the bound. */
  truncated?: boolean;
  stats: { messageCount: number; toolCount: number; subagentCount: number; tokenCount?: number };
  /**
   * True when the detail is a limited view, not the full transcript: either an
   * index-only fallback (Codex without a rollout) OR a transcript too large to
   * read whole (bounded head+tail read — the middle is omitted). `limitedReason`
   * carries the specific cause for the preview's notice.
   */
  partial?: boolean;
  /** Short reason surfaced in the preview when `partial`. */
  limitedReason?: string;
}

export interface VaultListResult {
  entries: VaultSessionEntry[];
  /**
   * Sessions that failed to parse (D8) — `count` drives the inline notice,
   * `reasons` (deduped, per-source) backs its "Details" affordance
   * (redesign-vault-panel-ui).
   */
  unreadable: { count: number; reasons: string[] };
}
