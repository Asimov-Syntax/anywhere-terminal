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
 * Delegated work, derived post-hoc from a transcript — history, not a live roster.
 * `live` stays `false` until the hook phase lands (worktree-agent-presence.md § 3.6),
 * and consumers must not draw these with the live-dot vocabulary while it is.
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
 * The outcome of one delegation read, never an array that means three things.
 *
 * An optional array cannot separate "not asked yet" from "asked, none found"
 * from "could not be read", and collapsing the last into the second states
 * something the view does not know (design.md D4). `incomplete` is the reader's
 * own admission that records were dropped: nothing here ever proves the roster
 * is the whole of what the session delegated (D5).
 */
export type DelegationRoster =
  | { kind: "ok"; rows: WorktreeSubagentRow[]; incomplete?: boolean }
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
   * What the row is called: the vault's title for the session, else the name
   * the pid registry published for it, else the pane's decoration-stripped
   * terminal title (§ 3.4).
   *
   * The vault leads because its title is what the session is ABOUT — claude's
   * own precedence of user name, generated title, last prompt. The other two
   * are what is available when there is no transcript to read: a registry name
   * is usually a slug off the directory, identical for every session in one
   * repo, and a pane title is whatever the shell left behind, since an agent
   * CLI is not obliged to set one and claude sets none at all.
   */
  title?: string;
  /** Last meaningful line; rendered after the title. */
  preview?: string;
  /** Agent-reported model label, when known. */
  model?: string;
  /** Omitted when identity is unproven; presence never invents an agent id. */
  agent?: VaultAgentId;
  agentSource: "launch" | "process" | "registry" | "report" | "title" | "none";
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
