// src/webview/worktree/worktreeViewTypes.ts — The data the Worktree view renders.
//
// `WorktreeTree` / `WorktreeRepo` / `WorktreeInfo` (src/worktree/types.ts) and
// `WorktreePresence` / `WorktreeAgentRow` / `WorktreeSubagentRow` /
// `PresenceDegradation` (src/worktree/presenceTypes.ts) are host-owned and
// re-exported below rather than declared here — the host module is the only
// declaration, so a field added there cannot silently render nowhere. The rest
// of this file — the view-local `WorktreeActivity` / `WorktreeAgentSource` /
// `WorktreeActivitySource` aliases and the RPC/action/create-form types — has no
// host counterpart and is transcribed from the design docs:
//
//   WorktreeActionResult / WorktreeRemoveBlocker
//     → docs/design/worktree-rpc.md § 2, § 3.1
//   WorktreeCreateDefaults / WorktreeCreateDraft
//     → docs/design/worktree-actions.md § 3.2

export type { WorktreeRowActivation } from "../../settings/SettingsReader";
export type {
  DelegationRoster,
  PresenceDegradation,
  WorktreeAgentRow,
  WorktreePresence,
  WorktreeSubagentRow,
} from "../../worktree/presenceTypes";
export type { WorktreeInfo, WorktreeRepo, WorktreeTree } from "../../worktree/types";

/** Live activity of one agent row. Mirrors the webview terminal tracker, plus `exited`. */
export type WorktreeActivity = "running" | "waiting" | "idle" | "exited";

/** Where the row's agent IDENTITY came from. `title` / `none` are fallbacks. */
export type WorktreeAgentSource = "launch" | "process" | "registry" | "title" | "none";

/** Where the row's ACTIVITY came from. `output` / `title` / `none` are fallbacks. */
export type WorktreeActivitySource = "hook" | "output" | "title" | "registry" | "none";

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
