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

// The create request's own shapes. The dialog builds them and the host consumes
// them unflattened, so both sides read one declaration.
import type { ProvisionModel, RemovalCheck } from "../../types/messages";
import type { WorktreeRef } from "../../worktree/repoRefs";

export type {
  DestinationDisposition,
  ProvisionEntry,
  ProvisionModel,
  ProvisionPort,
  ProvisionProblem,
  ProvisionSetupStep,
  RemovalCheck,
  RemovalCheckClass,
  RemovalCheckOutcome,
  WorktreeAfterCreate,
  WorktreeCreateMode,
} from "../../types/messages";
export type {
  DelegationRoster,
  PresenceDegradation,
  WorktreeAgentRow,
  WorktreePresence,
  WorktreeSubagentRow,
} from "../../worktree/presenceTypes";
export type { WorktreeRef } from "../../worktree/repoRefs";
export type { WorktreeInfo, WorktreeRepo, WorktreeTree } from "../../worktree/types";

/** Live activity of one agent row. Mirrors the webview terminal tracker, plus `exited`. */
export type WorktreeActivity = "running" | "waiting" | "idle" | "exited";

/** Where the row's agent IDENTITY came from. `title` / `none` are fallbacks. */
export type WorktreeAgentSource = "launch" | "process" | "registry" | "title" | "none";

/** Where the row's ACTIVITY came from. `output` / `title` / `none` are fallbacks. */
export type WorktreeActivitySource = "hook" | "output" | "title" | "registry" | "none";

/**
 * The removal report the panel renders.
 *
 * `checks` replaced a record of booleans and counts. That record could not say
 * that a check did not RUN — an unreadable `git status` and a genuinely clean
 * worktree both arrived as `dirty: false` — on the one action that cannot be
 * undone (worktree-rpc.md § 2.5).
 */
export interface WorktreeRemoveReport {
  /** Identifies THIS report; the confirmation is bound to it. */
  fingerprint: string;
  checks: readonly RemovalCheck[];
  /**
   * Worktrees registered INSIDE this one. Refused, never confirmable: git's
   * `remove --force` treats a nested registered worktree as ordinary untracked
   * content, deleting the child's files and leaving a prunable child record,
   * and a confirmation about worktree A cannot honestly describe losing B.
   *
   * Beside the checks because the refusal NAMES them; a check carries an outcome
   * and a magnitude, not a row set.
   */
  contained: readonly { worktreeId: string; displayPath: string }[];
}

/**
 * `scope` is the odd one out and stays here anyway: it did nothing TO a worktree,
 * but the panel has exactly one place notices appear and a second channel would be
 * a second place to look (design.md D7).
 */
export type WorktreeActionKind = "create" | "remove" | "lock" | "unlock" | "prune" | "launch" | "scope";

export interface WorktreeActionResult {
  action: WorktreeActionKind;
  /** The row the notice attaches to. */
  worktreeId?: string;
  /** The repo the notice attaches to, when no single worktree owns it. */
  repoId?: string;
  outcome: "ok" | "error" | "indeterminate" | "unavailable";
  /** Git's stderr, bounded and trimmed. Shown verbatim. */
  error?: string;
  /** What the forced rebuild actually observed. Shown verbatim. */
  observed?: string;
  /**
   * Which reads failed, on an `unavailable` outcome. Never empty there: the
   * notice says what could not be checked, and "something" is not an answer.
   */
  unreadable?: readonly string[];
  needsConfirm?: WorktreeRemoveReport;
  /**
   * The row this notice was about, once that row has left the tree.
   *
   * Set only by reconciliation: a removal that SUCCEEDS deletes the row its own
   * result was hanging on, so the notice had nowhere left to render and the
   * user was told nothing (round-3 B1). Re-scoped to the repository, it needs
   * to name what it is reporting on.
   */
  orphanedLabel?: string;
  /** The action succeeded; what it was asked to do next did not. */
  openFailed?: string;
}

/**
 * The provisioning material the host resolved, and the id that names it.
 *
 * The model is display material; the id is what a submission quotes back. The
 * webview never receives a handle it could dereference into something
 * executable — the host holds the model it displayed and executes from THAT
 * (worktree-provisioning.md § 4.0).
 */
export interface WorktreeProvisionOffer {
  readonly offerId: string;
  readonly model: ProvisionModel;
}

/** Host-computed seed for the create form (`requestWorktreeCreateDefaults`). */
export interface WorktreeCreateDefaults {
  repoId: string;
  /** The branch this answer was computed for; absent when none was named. */
  answersBranch?: string;
  repoLabel: string;
  /** Absolute path of the repo's main worktree, shown under the repo picker. */
  mainPath: string;
  /** Directory the default path is derived in, e.g. `…/ai-oss`. */
  pathParent: string;
  /** Base name the branch is appended to, e.g. `anywhere-terminal`. */
  pathPrefix: string;
  /**
   * The taken directory's NAME, set when the computed default path collided and
   * gained a `-2` / `-3` suffix. Never a path — `pathParent` and the resolved
   * destination already state where the create lands.
   */
  collidedWith?: string;
  /**
   * The free path the host resolved after the collision. Only the host can know
   * it, so the form names a final destination only when this is present — the
   * derived path IS the occupied one, and claiming it would be false.
   */
  resolvedPath?: string;
  /**
   * Only agents the host reported as able to start a fresh session, each with
   * its OWN postures — permission is agent-shaped, so a shared list would offer
   * claude's postures for codex.
   */
  agents: WorktreeLaunchAgent[];
  /**
   * Absent until the host's offer arrives — which is a separate message from
   * this one, so the form opens without it and gains the section on the answer.
   * Absent is NOT "nothing to bring over": that is an offer carrying an empty
   * model, and the two say different things.
   */
  provisioning?: WorktreeProvisionOffer;
  /**
   * The repository's local branches, and whether the list is partial.
   *
   * Absent until the host's answer arrives — a separate message, like
   * `provisioning`, so the form opens without it. Absent is NOT "there are no
   * branches": a repository whose enumeration failed must not render as one
   * with none, and the create-new entry is never gated on this either way.
   */
  refs?: WorktreeRefOffer;
}

/** The host's answer to `requestWorktreeRefs`, as the form holds it. */
export interface WorktreeRefOffer {
  readonly list: readonly WorktreeRef[];
  /** The enumeration hit its cap, so the form says the list is partial. */
  readonly truncated: boolean;
}

/** One offerable agent, as the host reported it. */
export interface WorktreeLaunchAgent {
  id: string;
  label: string;
  permissionChoices: { id: string; label: string; dangerous?: boolean }[];
  /** False → this agent takes no seed prompt, so none is offered for it. */
  canSeedPrompt: boolean;
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
  /** The chosen agent's own posture id — never a shared enum. */
  permissionChoiceId?: string;
  prompt?: string;
  /** `git check-ref-format` said no; the message is shown under the field. */
  branchError?: string;
  pathError?: string;
}
