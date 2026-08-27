// src/worktree/presenceTypes.ts — Agent presence attached to worktree rows.
// See: docs/design/worktree-agent-presence.md § 2,
//      asimov/changes/cache-and-broadcast-worktree-tree/design.md D6
//
// Declared here so `worktreeTreeResponse` carries its final shape from the
// first push. WT-004 owns populating these; until then the host emits an empty
// projection and no field below is ever written.

import type { VaultAgentId } from "../vault/types";

/** One evidence source that failed, named on the scope it affects. Never a silent staleness. */
export interface PresenceDegradation {
  source: "panes" | "registry" | "vault" | "hook";
  /** Shown verbatim in the stale affordance. */
  reason: string;
  /** Epoch ms of the first consecutive failure. */
  since: number;
}

/**
 * Delegated work.
 *
 * `live` separates the two things that produce one of these: `false` means it
 * was read post-hoc from a transcript — history, which consumers must not draw
 * with the live-dot vocabulary — and `true` means the agent reported starting it
 * and has not reported finishing it (worktree-agent-presence.md § 3.6).
 */
export interface WorktreeSubagentRow {
  /** Agent type, or the invoking tool when the type is undeclared. */
  name: string;
  title?: string;
  status: "running" | "completed" | "failed" | "unknown";
  live: boolean;
  /** Drill-down into the vault detail. Never set for a reported row: it has no vault entry. */
  entryId?: string;
}

/**
 * The outcome of one delegation read, never an array that means three things.
 *
 * An optional array cannot separate "not asked yet" from "asked, none found"
 * from "could not be read", and collapsing the last into the second states
 * something the view does not know (design.md D4). `incomplete` is the reader's
 * own admission that records were dropped: nothing here ever proves the roster
 * is the whole of what the session delegated (D5).
 */
export type DelegationRoster =
  | {
      kind: "ok";
      rows: WorktreeSubagentRow[];
      incomplete?: boolean;
      /**
       * The agent's own fresh report rather than a transcript read.
       *
       * The host's delegation pass leaves a reported roster alone: it is not a
       * cached claim that could have gone stale behind the row it belongs to.
       */
      reported?: true;
    }
  | { kind: "failed"; reason: string };

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
  /**
   * What the row is called: the session's registry name, else the vault's title
   * for it, else the pane's decoration-stripped terminal title (§ 3.4).
   *
   * The terminal title is last, not first, because an agent CLI is not obliged
   * to set one — claude sets none at all — so the pane title is whatever the
   * shell happened to leave behind.
   */
  title?: string;
  /** Last meaningful line; rendered after the title. */
  preview?: string;
  /** Agent-reported model label, when known. */
  model?: string;
  /** Omitted when identity is unproven; presence never invents an agent id. */
  agent?: VaultAgentId;
  agentSource: "launch" | "process" | "registry" | "title" | "hook" | "none";
  activity: "running" | "waiting" | "idle" | "exited";
  activitySource: "hook" | "output" | "title" | "registry" | "none";
  /**
   * What the agent is waiting on, as it reported it — a question or a permission
   * request, carried as one JSON string (agent-hook-server.md § 4.4).
   *
   * Present only while the report deciding this row is fresh. A prompt that
   * outlives its report is a card the user can no longer answer.
   */
  interactivePrompt?: string;
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
  /**
   * What this row's session delegated — read on expansion, never on a routine
   * presence update. Absent means never read; `ok` with no rows means read and
   * none found; `failed` says why.
   */
  delegations?: DelegationRoster;
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
  /** Empty when every source succeeded — an honest empty is NOT a degradation. */
  degradedSources: PresenceDegradation[];
}
