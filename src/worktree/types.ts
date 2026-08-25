// src/worktree/types.ts — Host-owned worktree tree model.
// See: docs/design/worktree-model.md § 2
//
// Mirrored to the webview verbatim over postMessage. No datastore — the tree is
// derived state, rebuilt from git on invalidation.

/** A single worktree of one repository, as git reports it. */
export interface WorktreeInfo {
  /** Normalized absolute worktree path — the identity. See normalizePath.ts. */
  id: string;
  /** Path exactly as git reported it. Copy / reveal use this, never `id`. */
  displayPath: string;
  kind: "main" | "linked";
  bare: boolean;
  /** Short name; absent when detached or bare. */
  branch?: string;
  /** 40-char sha; absent when the worktree has no commit (unborn branch). */
  head?: string;
  detached: boolean;
  locked: boolean;
  lockReason?: string;
  /** Registration is stale — git said so, or the existence probe proved it. */
  prunable: boolean;
  /** Path does not exist on disk. Never set for a locked or main worktree. */
  missing: boolean;
  /** A workspace folder is this path, or lies inside it. */
  inWorkspace: boolean;
}

/** One git repository, keyed on the git common dir it shares with its worktrees. */
export interface WorktreeRepo {
  /** Normalized absolute git common dir. */
  repoId: string;
  /** Basename of the main worktree path. */
  label: string;
  /** Normalized path of the main worktree. */
  mainPath: string;
  worktrees: WorktreeInfo[];
  /** This repo's listing failed; the reason is surfaced on the group. */
  degraded?: string;
}

export interface WorktreeTree {
  /** Workspace-folder order, deduped by `repoId`. */
  repos: WorktreeRepo[];
  /** Same shape as `VaultListResult.unreadable` (src/vault/types.ts:467). */
  unreadable: { count: number; reasons: string[] };
  /** False when no usable `git` executable was found, or it is below 2.31. */
  gitAvailable: boolean;
}
