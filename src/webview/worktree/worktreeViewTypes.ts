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
import type {
  BranchDeleteOffer,
  DestinationDisposition,
  ProvisionModel,
  ProvisionPortResult,
  ProvisionPortWarning,
  ProvisionResultContest,
  ProvisionSetupResult,
  ProvisionStepResult,
  PullRequestOffer,
  RemovalCheck,
  ResolvedMode,
  WorktreeBranchDeleteOutcome,
} from "../../types/messages";
import type { WorktreeRef } from "../../worktree/repoRefs";

export type {
  BranchDeleteOffer,
  BranchDeleteRequest,
  DestinationDisposition,
  ProvisionEntry,
  ProvisionModel,
  ProvisionPort,
  ProvisionProblem,
  ProvisionSetupStep,
  ProvisionStepResult,
  RemovalCheck,
  RemovalCheckClass,
  RemovalCheckOutcome,
  WorktreeAfterCreate,
  WorktreeBranchDeleteOutcome,
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
  /**
   * Identifies THIS report; the confirmation is bound to it.
   *
   * `null` where the removal needs no force — a worktree with nothing at risk,
   * or a refusal, which has nothing to bind one to. Its PRESENCE is what makes a
   * forced removal possible, so the panel can neither invent one nor mistake a
   * report that authorizes nothing for a report that failed to say (design.md D7).
   */
  fingerprint: string | null;
  checks: readonly RemovalCheck[];
  /**
   * Present only when the merge proof passed; its PRESENCE is what gates the
   * branch-delete opt-in in `WorktreeRemoveDialog.ts` (design.md D1).
   */
  branchDelete?: BranchDeleteOffer;
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
  /**
   * The row this notice is about, kept across a re-scope.
   *
   * Separate from `orphanedLabel` because that is what the notice CALLS the row
   * — a human name when one is known — and a name cannot be read back as an id.
   * Identity and the render anchor are two facts, and a notice that loses the
   * first can never be reattached when the row it describes finally appears
   * (.reviews/round-5.md F017).
   */
  canonicalId?: string;
  /** The action succeeded; what it was asked to do next did not. */
  openFailed?: string;
  /**
   * The opted-in branch delete's own outcome, riding the removal's own
   * result rather than replacing it — a refused branch delete never turns a
   * successful removal into a failure (design.md D5).
   */
  branchDelete?: WorktreeBranchDeleteOutcome;
  /**
   * What provisioning did, on the create's OWN notice.
   *
   * Carried here rather than raised as a second notice: two notices for one
   * create compete for the same row, and the answer the user wants — the
   * worktree exists AND its files arrived — is one sentence, not two.
   */
  provisioned?: readonly ProvisionStepResult[];
  ports?: readonly ProvisionPortResult[];
  portWarnings?: readonly ProvisionPortWarning[];
  /**
   * Each contest's membership, once — referenced by a step's `contest` index.
   *
   * The reason on a refused row says what happened to that row; who else named
   * the destination lives here, so N members cost N declarations rather than
   * N² (`carry-a-contest-membership-once`).
   */
  provisionContests?: readonly ProvisionResultContest[];
  setup?: readonly ProvisionSetupResult[];
  setupOutputId?: string;
  setupRetryId?: string;
  manifestWarning?: string;
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
  /**
   * The repository's open pull requests, on the same terms as `refs` and for
   * the same reason: a separate message, absent until it lands.
   *
   * Absent is "not asked yet" and is NOT the unavailable state — the form must
   * not claim a forge state it has not been told. `available: false` is what
   * says the forge could not answer, and § 5 renders one quiet row for it.
   */
  pullRequests?: WorktreePullRequestOffer;
}

/**
 * The host's answer about pull requests, as the form holds it.
 *
 * A union for the reason the wire message is one (W2): a list and "the forge
 * could not answer" are different answers, and a shape that can carry both at
 * once makes the renderer pick.
 */
export type WorktreePullRequestOffer =
  | {
      readonly available: true;
      readonly list: readonly PullRequestOffer[];
      /** The enumeration hit its cap, so the form says the list is partial. */
      readonly truncated: boolean;
    }
  | {
      /** The ONE unavailable state: missing client, no auth, timeout, bad JSON. */
      readonly available: false;
    };

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

/**
 * `reattach` is a fourth MODE, not a flavour of `existing`.
 *
 * It takes its starting point from a checkout that is already on disk, so the
 * base ref cannot apply to it — and the create it submits is a repair rather
 * than a `git worktree add`, which is a different thing to say on the wire.
 */
export type WorktreeBranchMode = "new" | "existing" | "detached" | "reattach";

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
  /**
   * The classification the form was showing when this was submitted.
   *
   * Carried rather than looked up again, so the request is built from the same
   * answer the destination line and the stated action were built from. The
   * owner re-reading its own copy is a second interpretation of one answer, and
   * that is how a repair could act on a path other than the one on screen
   * (round-3 B3).
   */
  resolved?: ResolvedMode;
  /**
   * What the form settled on for the DESTINATION, carried for the same reason
   * `resolved` is: the owner builds the request from the answer this form was
   * showing. Absent means free — a `debris` disposition exists only where the
   * host issued an authorization for the path the form displayed.
   */
  disposition?: DestinationDisposition;
  /**
   * The offer this form was showing, and the rows ticked in it.
   *
   * Ids, never paths: the host holds the model it displayed and resolves ids
   * against THAT, so nothing the webview spells reaches the filesystem
   * (worktree-rpc.md § 2.4). Absent when no offer arrived — a form that was
   * never told what the repository needs asks for nothing.
   */
  provision?: { readonly offerId: string; readonly itemIds: readonly string[] };
  /**
   * Off by default: wait for every selected setup step to succeed before
   * starting the agent, rather than starting it alongside setup.
   *
   * Set only while the form is offering an agent launch — the control that
   * writes this is rendered beside the agent controls and disabled whenever
   * the current selection has no setup step ticked (design.md D6, D3).
   */
  waitForSetup?: boolean;
}

/** Re-exported so the view reads one module for the shapes it renders. */
export type { ProvisionResultContest };
