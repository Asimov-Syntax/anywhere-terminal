// src/webview/worktree/worktreeViewTypes.ts — The data the Worktree view renders.
//
// `WorktreeTree` / `WorktreeRepo` / `WorktreeInfo` are already host-owned
// (src/worktree/types.ts) and imported verbatim. Everything else here is
// transcribed from the design docs so the view can be built and tested before the
// host side exists:
//
//   WorktreePresence / WorktreeAgentRow / WorktreeSubagentRow / PresenceDegradation
//     → docs/design/worktree-agent-presence.md § 2
//   WorktreeActionResult / WorktreeRemoveBlocker
//     → docs/design/worktree-rpc.md § 2, § 3.1
//   WorktreeCreateDefaults / WorktreeCreateDraft
//     → docs/design/worktree-actions.md § 3.2
//
// When the host modules land these move to src/worktree/ and this file re-exports
// them; the view code does not change, which is the point of transcribing the
// field names exactly rather than inventing view-local ones.

import type { VaultAgentId } from "../../vault/types";

export type { WorktreeInfo, WorktreeRepo, WorktreeTree } from "../../worktree/types";

/** Live activity of one agent row. Mirrors the webview terminal tracker, plus `exited`. */
export type WorktreeActivity = "running" | "waiting" | "idle" | "exited";

/** Where the row's agent IDENTITY came from. `title` / `none` are fallbacks. */
export type WorktreeAgentSource = "launch" | "process" | "registry" | "title" | "none";

/** Where the row's ACTIVITY came from. `output` / `title` / `none` are fallbacks. */
export type WorktreeActivitySource = "hook" | "output" | "title" | "registry" | "none";

/** A source that failed, named on the scope it affects. Never a silent staleness. */
export interface PresenceDegradation {
  source: "panes" | "registry" | "vault" | "hook";
  /** Shown verbatim in the stale affordance. */
  reason: string;
  /** Epoch ms of the first consecutive failure. */
  since: number;
}

/**
 * Delegated work, derived post-hoc from a transcript — history, not a live roster.
 * `live` stays `false` until the hook phase lands, and the view must not draw these
 * with the live dot vocabulary while it is.
 */
export interface WorktreeSubagentRow {
  /** Agent type, or the invoking tool when undeclared. */
  name: string;
  title?: string;
  status: "running" | "completed" | "failed" | "unknown";
  live: false;
  entryId?: string;
}

export interface WorktreeAgentRow {
  /** Stable across rebuilds. */
  rowId: string;
  scope: "window" | "external";
  /** AT session id; present iff `scope === "window"`. */
  paneId?: string;
  viewId?: string;
  /** Pane title, already decoration-stripped by the host. */
  title?: string;
  /** Last meaningful line; rendered after the title. */
  preview?: string;
  model?: string;
  /** Omitted when identity is unproven — the view never guesses an icon. */
  agent?: VaultAgentId;
  agentSource: WorktreeAgentSource;
  activity: WorktreeActivity;
  activitySource: WorktreeActivitySource;
  entryId?: string;
  startedAt?: number;
  /** When the current `activity` began — the age clock for a working row. */
  stateStartedAt?: number;
  /** When the last turn ended — the age clock for a finished row. */
  finishedAt?: number;
  lastActivityAt?: number;
  /** External rows only. */
  pid?: number;
  subagents?: WorktreeSubagentRow[];
}

export interface WorktreePresence {
  /** Key = `WorktreeInfo.id`. */
  rowsByWorktreeId: Record<string, WorktreeAgentRow[]>;
  scannedAt: number;
  /** Empty when every source succeeded — an honest empty is NOT a degradation. */
  degradedSources: PresenceDegradation[];
}

/** Every non-zero field is named in the remove confirmation. */
export interface WorktreeRemoveBlocker {
  /** Identifies THIS blocker set; the confirmation is bound to it. */
  fingerprint: string;
  dirty: boolean;
  untracked: number;
  idlePanes: number;
  /** Rows here whose activity is running or waiting — refused, never confirmable. */
  busyAgents: number;
  externalAgents: number;
  locked: boolean;
  /** Main worktree — never removable; no confirm can override it. */
  isMain: boolean;
}

export type WorktreeActionKind = "create" | "remove" | "lock" | "unlock" | "prune" | "launch";

export interface WorktreeActionResult {
  action: WorktreeActionKind;
  /** The row the notice attaches to. */
  worktreeId?: string;
  /** The repo the notice attaches to, when no single worktree owns it. */
  repoId?: string;
  outcome: "ok" | "error" | "indeterminate";
  /** Git's stderr, bounded and trimmed. Shown verbatim. */
  error?: string;
  /** What the forced rebuild actually observed. Shown verbatim. */
  observed?: string;
  needsConfirm?: WorktreeRemoveBlocker;
}

/** Host-computed seed for the create form (`requestWorktreeCreateDefaults`). */
export interface WorktreeCreateDefaults {
  repoId: string;
  repoLabel: string;
  /** Absolute path of the repo's main worktree, shown under the repo picker. */
  mainPath: string;
  /** Directory the default path is derived in, e.g. `…/ai-oss`. */
  pathParent: string;
  /** Base name the branch is appended to, e.g. `anywhere-terminal`. */
  pathPrefix: string;
  /** Set when the computed default path collided and gained a `-2` / `-3` suffix. */
  collidedWith?: string;
  /**
   * The free path the host resolved after the collision. Only the host can know
   * it, so the form names a final destination only when this is present — the
   * derived path IS the occupied one, and claiming it would be false.
   */
  resolvedPath?: string;
  /** Only agents whose executable resolves. */
  agents: { id: string; label: string }[];
}

export type WorktreeBranchMode = "new" | "existing" | "detached";

export type WorktreeOpenAfter = "none" | "terminal" | "agent" | "newWindow" | "addToWorkspace";

/** What the create form currently holds. Rendered, never posted, in this phase. */
export interface WorktreeCreateDraft {
  repoId: string;
  branchMode: WorktreeBranchMode;
  branchName: string;
  baseRef: string;
  path: string;
  openAfter: WorktreeOpenAfter;
  agentId?: string;
  permissionMode?: string;
  firstPrompt?: string;
  /** `git check-ref-format` said no; the message is shown under the field. */
  branchError?: string;
  pathError?: string;
}
