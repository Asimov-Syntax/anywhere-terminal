// src/worktree/presenceTypes.ts — Agent presence attached to worktree rows.
// See: docs/design/worktree-agent-presence.md § 2,
//      asimov/changes/cache-and-broadcast-worktree-tree/design.md D6
//
// Declared here so `worktreeTreeResponse` carries its final shape from the
// first push. WT-004 owns populating these; until then the host emits an empty
// projection and no field below is ever written.

import type { VaultAgentId } from "../vault/types";

/** One evidence source that failed, kept until it succeeds again. */
export interface PresenceDegradation {
  source: "panes" | "registry" | "vault" | "hook";
  /** Shown verbatim in the stale affordance. */
  reason: string;
  /** Epoch ms of the first consecutive failure. */
  since: number;
}

/**
 * A child agent invoked by a row's agent. `live` is always false until the hook
 * phase lands — see worktree-agent-presence.md § 3.6.
 */
export interface WorktreeSubagentRow {
  /** Agent type, or the invoking tool when the type is undeclared. */
  name: string;
  title?: string;
  status: "running" | "completed" | "failed" | "unknown";
  live: false;
  /** Drill-down into the vault detail. */
  entryId?: string;
}

/**
 * One agent working inside a worktree.
 *
 * `agentSource` and `activitySource` travel intact rather than collapsing into
 * one confidence field: a pane can have authoritative identity and fallback
 * activity, or the reverse, and a single field forces a lossy choice between
 * them (worktree-agent-presence.md § 2).
 */
export interface WorktreeAgentRow {
  /** Stable across rebuilds — see worktree-agent-presence.md § 3.5. */
  rowId: string;
  scope: "window" | "external";
  /** AT session id; present iff `scope === "window"`. */
  paneId?: string;
  /** Which webview hosts the pane; window scope only. */
  viewId?: string;
  /** Pane title, decoration-stripped (§ 3.4). */
  title?: string;
  /** Last meaningful line; rendered after the title. */
  preview?: string;
  /** Agent-reported model label, when known. */
  model?: string;
  /** Omitted when identity is unproven; presence never invents an agent id. */
  agent?: VaultAgentId;
  agentSource: "launch" | "process" | "registry" | "title" | "none";
  activity: "running" | "waiting" | "idle" | "exited";
  activitySource: "hook" | "output" | "title" | "registry" | "none";
  /** Vault `<agent>:<sessionId>` once resolved. */
  entryId?: string;
  /** When this row's agent was first seen. */
  startedAt?: number;
  /** When the current `activity` began — drives the age column. */
  stateStartedAt?: number;
  /** When the last turn ended; set only while `idle` after work. */
  finishedAt?: number;
  /** Newest evidence timestamp — the worktree ordering key. */
  lastActivityAt?: number;
  /** External rows only. */
  pid?: number;
  subagents?: WorktreeSubagentRow[];
}

/**
 * Every agent row in the window, keyed by `WorktreeInfo.id`.
 *
 * Kept separate from `WorktreeTree` because presence has a different freshness
 * model; merging them would let one stale git read erase live agent evidence
 * (worktree-model.md § 2).
 */
export interface WorktreePresence {
  rowsByWorktreeId: Record<string, WorktreeAgentRow[]>;
  /** Epoch ms of the scan that produced these rows. */
  scannedAt: number;
  /** Empty when every source succeeded. */
  degradedSources: PresenceDegradation[];
}
