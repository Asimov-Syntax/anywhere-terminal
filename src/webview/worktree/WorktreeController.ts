// src/webview/worktree/WorktreeController.ts — The Worktree view's message seam.
// See: docs/design/worktree-rpc.md § 1, § 2;
//      asimov/changes/wire-live-worktree-tree/design.md D2, D3, D4, D5
//
// Owns everything between the host's `worktreeTreeResponse` and `WorktreeView`:
// the visibility declaration that gates every push to this surface, the tree
// request, and the three render states the view cannot derive for itself.
// `main.ts` keeps only the mount call — feature wiring lives with the feature,
// as it does for FileTreeController.

import type {
  ResolvedMode,
  VaultLaunchTargetsMessage,
  WebViewToExtensionMessage,
  WorktreeCreateDefaultsMessage,
  WorktreeCreateResolutionMessage,
  WorktreeDebrisAuthorizedMessage,
  WorktreeMigrationOfferMessage,
  WorktreeMutationResultMessage,
  WorktreeProvisionOfferMessage,
  WorktreeProvisionResultMessage,
  WorktreePullRequestsMessage,
  WorktreeRefsMessage,
  WorktreeRemoveAssessmentMessage,
  WorktreeSubscriptionLevel,
  WorktreeTreeResponseMessage,
} from "../../types/messages";
import { attributionKey, type PaneReport, waitingKey } from "../paneAttribution";
import type { WebviewState } from "../state/WebviewState";
import type { VaultView } from "../vault/VaultPanel";
import type { WorktreeMenuActions } from "./WorktreeContextMenu";
import { WorktreeInspector } from "./WorktreeInspector";
import { WorktreeView } from "./WorktreeView";
import type {
  WorktreeActionResult,
  WorktreeAgentRow,
  WorktreeCreateDefaults,
  WorktreeCreateMode,
  WorktreeInfo,
  WorktreeLaunchAgent,
  WorktreeMigrationOffer,
  WorktreeOpenAfter,
  WorktreePresence,
  WorktreeProvisionOffer,
  WorktreePullRequestOffer,
  WorktreeRefOffer,
  WorktreeRowActivation,
  WorktreeTree,
} from "./worktreeViewTypes";

/**
 * The wire answer as the form holds it (W2).
 *
 * One conversion, used by both the live route and the snapshot the form is
 * opened from. Two copies of it were what let the two disagree about what
 * `available: false` carries.
 */
function pullRequestOffer(msg: WorktreePullRequestsMessage): WorktreePullRequestOffer {
  return msg.available ? { available: true, list: msg.pullRequests, truncated: msg.truncated } : { available: false };
}

/** The persisted-state reads and writes the view's two disclosure levels need. */
export interface WorktreeStateStore {
  getState(): WebviewState;
  updateState(patch: Partial<WebviewState>): void;
}

export interface WorktreeControllerDeps {
  /** Panel element dialogs and menus would position within. */
  host: HTMLElement;
  postMessage(msg: WebViewToExtensionMessage): void;
  store: WorktreeStateStore;
  /** Init fields this controller boots from. */
  init: { workspaceRoot: string | null; rowActivation: WorktreeRowActivation };
  /**
   * The user selected a worktree, or `null` when the selected one left the tree.
   * The scope consumer subscribes here; the controller only relays and holds.
   */
  onSelectWorktree?: (worktreeId: string | null) => void;
  /**
   * Whether an overlay above this panel currently owns Escape. True → the panel
   * body leaves the key alone, so the overlay closes first rather than the
   * drawer stealing the dismissal out from under it (design.md D9).
   */
  overlayOpen?: () => boolean;
  /**
   * Which worktree each of this window's panes is running in. Emitted on every
   * push whose attribution moved, and never otherwise.
   */
  onAttribution?: (report: PaneReport) => void;
  /**
   * Whether this surface still draws something from presence other than the rail
   * — a scope's chip, its escape control and its hidden-waiting count all
   * outlive a collapsed rail. Absent → the rail alone decides.
   */
  presenceNeeded?: () => boolean;
  /**
   * Open the session-preview overlay for a host-resolved entry. Returns false
   * when this surface holds no such entry — the host resolved against presence,
   * which can name a session this webview's own list does not have.
   */
  showPreview?(entryId: string): boolean;
  /** Activate a pane this surface holds. False when it holds no such pane. */
  activatePane?(paneId: string): boolean;
  /**
   * Whether the tree holds any repository a create could act in. Reported on
   * every tree, because the toolbar control it gates must be absent — not
   * present and inert — when there is nothing to create in.
   */
  onCreateAvailability?(available: boolean): void;
  /** Injected in tests so ages are deterministic. */
  now?(): number;
}

/**
 * Which body the panel opens on (§ 2.2). A recorded choice always wins; with
 * none, a workspace holding no repository would open on a permanently empty
 * view, which reads as a broken panel rather than a default.
 *
 * The derived answer is never written back, so a workspace that later gains a
 * repository opens on the Worktree body without the user having to ask.
 */
export function resolveInitialView(persisted: VaultView | undefined, hasRepo: boolean): VaultView {
  return persisted ?? (hasRepo ? "worktree" : "sessions");
}

/**
 * The menu's callbacks, each posting the request its label names and nothing
 * else. Ids only: the host re-resolves them against its own tree and presence,
 * so a path the view carried could never become the path an action ran on (D2).
 *
 * Every launch capability is conditional on the host having reported something
 * to launch: `undefined` makes the item absent, which is the truthful rendering
 * of "no agent here can start a session".
 */
export function worktreeMenuActions(
  post: (msg: WebViewToExtensionMessage) => void,
  /**
   * Which repository a worktree belongs to, and how many of its registrations
   * git already flagged prunable. Only the view holds the tree that answers
   * this. Without it the prune item is ABSENT rather than posting a repo id the
   * webview guessed — a prune against the wrong repository is not recoverable
   * by re-confirming.
   */
  repoFor?: (info: WorktreeInfo) => { repoId: string; prunableCount: number } | undefined,
  /**
   * Open the create form for the repo `info` belongs to. Absent → no item: the
   * form cannot open on a destination the host has not resolved yet.
   */
  onCreate?: (info: WorktreeInfo) => void,
  /**
   * Open prune's confirmation for a repo. Absent → no prune item: the count is
   * the whole content of that confirmation, so an unconfirmed prune is not a
   * cheaper version of this action, it is a different one.
   */
  confirmPrune?: (repoId: string) => void,
  /**
   * Open the launch dialog for a worktree. Absent → no item, which is how the
   * panel says "no agent on this host can start a fresh session" rather than
   * offering a picker with nothing in it.
   */
  onLaunch?: (info: WorktreeInfo) => void,
  /**
   * Resume an agent row's session in ITS worktree. Absent for the same reason,
   * and additionally per-row: a row with no session is never offered it.
   */
  onResumeHere?: (row: WorktreeAgentRow) => void,
  /**
   * Mint the token this request will be answered under (D11). Absent → a bare
   * token that no controller is ordering answers against, which is the right
   * shape for a menu built with no controller behind it.
   */
  beginAssess?: (worktreeId: string) => string,
): WorktreeMenuActions {
  return {
    ...(onCreate === undefined ? {} : { createWorktree: onCreate }),
    ...(onLaunch === undefined ? {} : { launchAgentHere: onLaunch }),
    ...(onResumeHere === undefined ? {} : { resumeHere: onResumeHere }),
    openFolderInNewWindow: (info) => post({ type: "worktreeOpenFolder", worktreeId: info.id, mode: "newWindow" }),
    addFolderToWorkspace: (info) => post({ type: "worktreeOpenFolder", worktreeId: info.id, mode: "addToWorkspace" }),
    openTerminalHere: (info) => post({ type: "worktreeOpenTerminal", worktreeId: info.id }),
    revealWorktree: (info) => post({ type: "worktreeRevealInOS", worktreeId: info.id }),
    copyWorktreePath: (info) => post({ type: "worktreeCopyPath", worktreeId: info.id }),
    toggleLock: (info) =>
      post(
        info.locked ? { type: "worktreeUnlock", worktreeId: info.id } : { type: "worktreeLock", worktreeId: info.id },
      ),
    // Unforced, deliberately: the host answers with the blocker set rather than
    // acting, and the confirmation the user then sees is bound to that set's
    // fingerprint. The webview never decides a removal is safe.
    // ASKS what the removal would cost; it removes nothing. The unforced
    // `worktreeRemove` this used to post deleted a clean worktree outright,
    // because the host reports only from the path that already attempted the
    // deletion — the whole of round-3 B1 (design.md D6).
    removeWorktree: (info) =>
      post({
        type: "worktreeRemoveAssess",
        worktreeId: info.id,
        token: beginAssess === undefined ? "" : beginAssess(info.id),
      }),
    // Repo-scoped: a prune drops stale REGISTRATIONS, which belong to the
    // repository rather than to the worktree the menu was opened on. The count
    // is the one the confirmation named, and the host abandons the prune if it
    // has moved since (design.md D13).
    ...(repoFor === undefined || confirmPrune === undefined
      ? {}
      : {
          pruneRepo: (info: WorktreeInfo) => {
            const repo = repoFor(info);
            if (repo === undefined || repo.prunableCount <= 0) {
              return;
            }
            // Confirmed, never posted straight from the click: D13 exists so the
            // user sees the NUMBER before a repository mutation starts.
            confirmPrune(repo.repoId);
          },
        }),

    focusPane: (row) => {
      if (row.paneId !== undefined) {
        post({ type: "worktreeFocusPane", rowId: row.rowId, paneId: row.paneId });
      }
    },
    openPreview: (row) => {
      if (row.entryId !== undefined) {
        post({ type: "worktreeOpenPreview", rowId: row.rowId, entryId: row.entryId });
      }
    },
    copyResumeCommand: (row) => {
      if (row.entryId !== undefined) {
        post({ type: "worktreeCopyResumeCommand", rowId: row.rowId, entryId: row.entryId });
      }
    },
    revealAgentCwd: (row) => {
      if (row.entryId !== undefined) {
        post({ type: "worktreeRevealAgentCwd", rowId: row.rowId, entryId: row.entryId });
      }
    },
    copyAgentPath: (row) => {
      if (row.entryId !== undefined) {
        post({ type: "worktreeCopyAgentPath", rowId: row.rowId, entryId: row.entryId });
      }
    },
  };
}

/** Enough to explain a burst of removals; never a session-long history (W6). */
const MAX_ORPHAN_NOTICES = 4;
const MAX_DEPARTED = 64;

/** Drop the oldest entries until `map` fits. Insertion order is age. */
function trim(map: Map<string, string>, limit: number): void {
  for (const key of map.keys()) {
    if (map.size <= limit) {
      return;
    }
    map.delete(key);
  }
}

/** The repair the form resolved, or nothing when it resolved something else. */
function repairOf(resolved: ResolvedMode | undefined, branch: string): WorktreeCreateMode | undefined {
  return resolved?.kind === "reattach"
    ? { kind: "reattach", branch, repairPath: resolved.repairPath, expectedOid: resolved.expectedOid }
    : undefined;
}

export class WorktreeController {
  /** The tree element — goes into `VaultPanel`'s `worktreeBody`. */
  readonly element: HTMLElement;

  private readonly deps: WorktreeControllerDeps;
  private readonly view: WorktreeView;
  /**
   * The detail drawer under the tree. Always mounted — hidden while closed, so
   * the rollout being off costs a `hidden` attribute rather than a second
   * mounting path to keep right (design.md D12).
   */
  private readonly inspector: WorktreeInspector;
  /**
   * The level last posted, or null while unsubscribed. The effective state, not
   * a request — `applySubscription` derives it.
   */
  private subscribed: WorktreeSubscriptionLevel | null = null;
  /**
   * What the PANEL asked for: is the rail showing this body? Everything that
   * acts on the body keys on this falling to false, never on the subscription
   * ending — a scope can hold the subscription open long after the panel left
   * (design.md D4).
   */
  private bodyShown = false;
  private tree: WorktreeTree | null = null;
  private presence: WorktreePresence | null = null;
  private loading: boolean;
  private refreshing = false;
  private rowActivation: WorktreeRowActivation;
  /** The last attribution reported, keyed for comparison. `null` → none yet. */
  private lastAttribution: string | null = null;
  /** The host's resolved create destination, per repo. Only it can know one. */
  private readonly createDefaults = new Map<string, WorktreeCreateDefaultsMessage>();
  /**
   * The host's provisioning offer, per repo.
   *
   * Held apart from `createDefaults` because the host issues ONE offer per form
   * and answers the defaults per keystroke — folding the offer into that reply
   * would either re-mint it on every character or drop it on the second answer.
   */
  private readonly provisionOffers = new Map<string, WorktreeProvisionOfferMessage>();
  /** The source snapshot move offer, held separately from per-keystroke defaults. */
  private readonly migrationOffers = new Map<string, WorktreeMigrationOfferMessage>();
  /**
   * The repository's local branches, per repo.
   *
   * Held apart from `createDefaults` for the same reason the offer is: the host
   * answers this once per form and the destination per settled edit, so folding
   * it in would either re-ship the whole list per keystroke or drop it on the
   * second answer.
   */
  private readonly repoRefs = new Map<string, WorktreeRefsMessage>();
  /**
   * The forge's answer per repository, held on the same terms as `repoRefs`.
   *
   * Its own map rather than a field on that one: the two answers arrive
   * independently and either can be absent while the other is present, which is
   * the property the separate message exists to give the form.
   */
  private readonly repoPullRequests = new Map<string, WorktreePullRequestsMessage>();
  /**
   * The host's answer to the last settled selection, per repository.
   *
   * Kept beside `repoRefs` and cleared on the same terms: a resolution seeded
   * from the previous form describes a repository state that may have moved.
   */
  private readonly createResolutions = new Map<string, WorktreeCreateResolutionMessage>();
  /**
   * Minted per probe, so two asks for one query inside one opening can be told
   * apart. `token` separates openings; nothing else separates these (D1).
   */
  private probeSeq = 0;
  /**
   * Which opening of the create dialog the refs conversation belongs to.
   *
   * Bumped per open, echoed by the host, and compared on the way back — the
   * only thing that tells a reopening's answer from its predecessor's, since
   * `repoId` is the same on both (round-2 W2).
   */
  private refsToken = 0;
  /** The row source for the live create opening, absent for repository and toolbar doors. */
  private createSource: { repoId: string; worktreeId: string } | null = null;
  /**
   * The create waiting on the host, and the repositories it has yet to hear
   * from. A set rather than one id because an unscoped create asks every
   * repository: the form builds its picker once, from the seed it opened with,
   * so opening on the first reply would offer one repository as the workspace.
   */
  private pendingCreate: { asked: string[]; outstanding: Set<string>; initialRepoId?: string } | null = null;
  /** Push a fresh host answer into the open form. Null when none is open. */
  private applyCreateDefaults: ((next: WorktreeCreateDefaults) => void) | null = null;
  /**
   * Push a fresh provisioning offer into the open form.
   *
   * Its own channel, not `applyCreateDefaults`. That callback carries the
   * DESTINATION, and the form clears its pending gate on any answer through it —
   * so routing provisioning there enabled Create on a stale path
   * (.reviews/round-1.md B4).
   */
  private applyProvisionOffer: ((repoId: string, offer: WorktreeProvisionOffer) => void) | null = null;
  private applyMigrationOffer: ((repoId: string, offer: WorktreeMigrationOffer | undefined) => void) | null = null;
  /**
   * Push the repository's branch list into the open form. Null when none is
   * open — which is what drops an answer that outlived its dialog.
   */
  private applyRefs: ((repoId: string, refs: WorktreeRefOffer) => void) | null = null;
  private applyPullRequests: ((repoId: string, offer: WorktreePullRequestOffer) => void) | null = null;
  private applyResolution: ((resolution: WorktreeCreateResolutionMessage) => void) | null = null;
  private applyDebrisAuthorization: ((answer: WorktreeDebrisAuthorizedMessage) => void) | null = null;
  /** Notices the panel is showing, newest last, one per scope+verb. */
  private actionResults: WorktreeActionResult[] = [];
  /**
   * Agents the host said can start a fresh session. Empty until it answers, and
   * empty is meaningful: no launch item is offered, rather than one that opens a
   * picker with nothing in it.
   */
  private launchAgents: WorktreeLaunchAgent[] = [];

  /** Held rather than passed: the two launch items appear only once one can act. */
  private readonly menuActions: WorktreeMenuActions;

  /**
   * The assess this surface is still waiting on, if any. At most one: a second
   * request for the same worktree is dropped rather than queued, because each
   * one holds the host's per-repo mutation queue across two forced rebuilds and
   * the reads between them (D10).
   */
  private liveAssess: { token: string; worktreeId: string } | null = null;

  private assessSeq = 0;

  /** True between asking which agents can start a session and being told. */
  private awaitingLaunchTargets = false;

  /** Which answer `launchAgents` came from. Never read at submit — see `frozen`. */
  private launchOfferId: string | undefined;
  /**
   * What the open dialog was RENDERED against, frozen when it opened.
   *
   * A dialog shows one offer and one worktree, and the user answers it minutes
   * later. Reading the panel's current offer at submit — which is what this
   * used to do — lets an answer that arrived under the open dialog relabel that
   * old choice as a choice made from the new list (round-4 B1). Frozen here,
   * a superseded choice is refused by the host instead of admitted.
   */
  private frozenLaunch: { worktreeId: string; offerId?: string; generation?: number } | null = null;
  /** The offer the open create form was rendered against. Same rule. */
  private frozenCreateOffer: { offerId?: string } | null = null;
  /**
   * What the open agent menu was BUILT against, by row.
   *
   * Not read from the tree when the item is clicked: a generation-only update
   * replaces the tree without repainting — that is D10's deliberate choice —
   * so at click time the tree and the menu on screen disagree, and the tree is
   * the wrong one of the two to believe (round-7 B5).
   */
  private frozenMenuTarget: { rowId: string; worktreeId: string; generation?: number } | null = null;
  /**
   * Display paths of rows that have LEFT the tree, so a result arriving after
   * the rebuild that removed its row can still say what it was about.
   *
   * This exists because of the order production actually produces: the
   * coordinator awaits its rebuild in a `finally`, so the tree without the row
   * reaches the surface before the outcome does (round-4 B1).
   */
  private readonly departed = new Map<string, string>();

  /**
   * The repository holding `info`, from the tree this controller last rendered.
   *
   * `prunableCount` is the host's number, carried on the repo. Absent until the
   * host sends one, and a prune with no count is not offered at all — the
   * confirmation exists to name a number, so there is nothing to confirm.
   */
  private repoFor(info: WorktreeInfo): { repoId: string; prunableCount: number } | undefined {
    const repo = this.tree?.repos.find((r) => r.worktrees.some((w) => w.id === info.id));
    if (repo === undefined) {
      return undefined;
    }
    // Counted from the tree the panel is already rendering: git's own
    // `prunable` flag rides on every worktree, so this needs no protocol of its
    // own (design.md D14). The host re-counts authoritatively before it acts.
    return { repoId: repo.repoId, prunableCount: repo.worktrees.filter((w) => w.prunable).length };
  }

  static mount(deps: WorktreeControllerDeps): WorktreeController {
    return new WorktreeController(deps);
  }

  private constructor(deps: WorktreeControllerDeps) {
    this.deps = deps;
    this.menuActions = worktreeMenuActions(
      (msg) => deps.postMessage(msg),
      (info) => this.repoFor(info),
      (info) => this.openCreateFor(info),
      (repoId) => this.confirmPrune(repoId),
      undefined,
      undefined,
      (worktreeId) => this.beginAssess(worktreeId),
    );
    // Always wired, unlike `resumeHere`: the capture is what makes the menu's
    // own view of the tree authoritative, and it must happen even on an open
    // that offers no resume, so a later one cannot inherit an older capture.
    this.menuActions.captureTarget = (row) => this.captureMenuTarget(row);
    // No folder means no tree is ever coming, so the skeleton would be a promise
    // the workspace cannot keep.
    this.loading = deps.init.workspaceRoot !== null;
    this.rowActivation = deps.init.rowActivation;
    this.view = new WorktreeView({
      host: deps.host,
      // Both launch items start absent: nothing here can launch until the host
      // has answered which agents can, and an item that opens an empty picker
      // is the inert rendering the panel spec forbids.
      actions: this.menuActions,
      // The header door. Supplied unconditionally: unlike the launch items, a
      // create is always performable where a repository exists, and the header
      // it hangs on is only rendered where one does.
      onCreateForRepo: (repoId) => this.openCreateForRepo(repoId),
      // The form's seed is the HOST's answer, never a path derived here: the
      // spec says a create names the destination it will actually use, and only
      // the host knows the configured root and which candidates are free.
      createDialogDeps: () => ({
        repos: this.createRepos(),
        // The destination depends on the branch, so every settled branch edit
        // re-asks and the answer replaces the seed in place (round-3 B12).
        onSelectionChange: (selection) => {
          const source = this.createSource;
          deps.postMessage({
            type: "requestWorktreeCreateDefaults",
            repoId: selection.repoId,
            opening: this.refsToken,
            branch: selection.branch,
            ...(source?.repoId === selection.repoId ? { sourceWorktreeId: source.worktreeId } : {}),
          });
          // The same settled edit, asked as the other question: the defaults
          // answer where a create would GO, and this one answers what it would
          // DO. Both ride the opening's token, because `repoId` names a
          // repository and not an opening (design.md D1).
          //
          // The WHOLE selection, forwarded field for field. A base or a
          // destination the form holds but never posts is a field the host's
          // answer cannot be about, and `baseValid` would then only ever exist
          // in tests that inject it (round-3 B4).
          this.probeSeq += 1;
          deps.postMessage({
            type: "worktreeCreateProbe",
            repoId: selection.repoId,
            token: this.refsToken,
            seq: this.probeSeq,
            query: selection.branch,
            ...(selection.base === undefined ? {} : { base: selection.base }),
            ...(selection.candidatePath === undefined ? {} : { candidatePath: selection.candidatePath }),
          });
        },
        bindDefaults: (apply) => {
          this.applyCreateDefaults = apply;
        },
        bindProvisioning: (apply) => {
          this.applyProvisionOffer = apply;
        },
        bindMigration: (apply) => {
          this.applyMigrationOffer = apply;
        },
        // A source the HOST detected, named by id. The message carries no file,
        // no path and no model — the host re-resolves that provider itself, and
        // the fresh offer comes back through `bindProvisioning` (design.md D5).
        onProvisionSwitch: (request) => {
          deps.postMessage({
            type: "worktreeProvisionSwitch",
            repoId: request.repoId,
            // The opening this form was composed in, the same one every other
            // request from it rides. A switch naming a retired opening is not
            // honoured, which is what stops a dismissed form redrawing.
            opening: this.refsToken,
            switch: request.switch,
            provider: request.provider as WorktreeProvisionOffer["model"]["providers"][number]["id"],
          });
        },
        // The user's selection, named by the host's own ids against the offer
        // that issued them. No path and no key: the host derives the file it
        // writes and the root it writes under from its own cache, and the
        // message's `repoId` selects a record rather than becoming a
        // destination (design.md D1).
        onProvisionSave: (request) => {
          deps.postMessage({
            type: "worktreeProvisionSave",
            repoId: request.repoId,
            // The opening this form was composed in, like every other request
            // from it. A save naming a retired opening is not honoured, which
            // is what stops a dismissed form writing.
            opening: this.refsToken,
            switch: request.switch,
            offerId: request.offerId,
            kept: request.kept,
          });
        },
        bindPullRequests: (apply) => {
          this.applyPullRequests = apply;
        },
        bindRefs: (apply) => {
          this.applyRefs = apply;
        },
        bindResolution: (apply) => {
          this.applyResolution = apply;
        },
        // Its own request, sent only when the user accepts the recover offer —
        // the probe is answered per settled edit, so a token riding it would be
        // one nobody asked for (design.md D6).
        onAuthorizeDebris: ({ repoId, ask, path }) => {
          deps.postMessage({ type: "worktreeAuthorizeDebris", repoId, token: this.refsToken, ask, path });
        },
        bindDebrisAuthorization: (apply) => {
          this.applyDebrisAuthorization = apply;
        },
      }),
      onLaunchSubmit: (request) => {
        const frozen = this.frozenLaunch;
        if (frozen === null) {
          return;
        }
        deps.postMessage({
          type: "worktreeLaunchAgent",
          worktreeId: frozen.worktreeId,
          ...request,
          ...(frozen.offerId === undefined ? {} : { offerId: frozen.offerId }),
          ...(frozen.generation === undefined ? {} : { generation: frozen.generation }),
        });
        this.frozenLaunch = null;
      },
      onDismissActionResult: (result) => {
        this.actionResults = this.actionResults.filter((r) => r !== result);
        this.push();
      },
      onForceRemove: (info, fingerprint, deleteBranch) => {
        deps.postMessage({
          type: "worktreeRemove",
          worktreeId: info.id,
          fingerprint,
          ...(deleteBranch === undefined ? {} : { deleteBranch }),
        });
      },
      onPrune: (repoId) => this.confirmPrune(repoId),
      // Only `unavailable` reaches here — the read failed, so asking again is
      // the whole remedy. It re-ASKS: retrying with a removal would be a second
      // door onto the very deletion D6 closed, reached from the one outcome
      // where nothing about the worktree's risk is known at all.
      onRetryAction: (result) => {
        if (result.worktreeId !== undefined) {
          this.askRemoval(result.worktreeId);
        }
      },
      // Any dialog opening retires the outstanding assess: what the user is
      // looking at now is the answer to a newer question, and the view's own
      // blocked-notice opener is why this cannot be a controller-local guard
      // (D11).
      onDialogOpened: () => {
        this.liveAssess = null;
      },
      /** The opening the form being opened right now will ride (D1). */
      createOpening: () => this.refsToken,
      // Every door of the create form, and the only signal the host has that
      // the conversation ended. The opening comes from the view, which captured
      // it when the form opened — reading `refsToken` here instead named
      // whatever opening had been asked for most recently, which during the
      // window between asking for a new form and that form arriving is the
      // SUCCESSOR (round-1 B3).
      onCreateClosed: (opening: number) => {
        this.deps.postMessage({ type: "worktreeCreateClosed", opening });
        // Posting the retirement is not the same as ceasing to honour the
        // opening. A reply the host had already sent when the close reached it
        // still carries the retired number, and a token comparison alone let it
        // into a cache for a form that no longer exists (.reviews/round-1.md
        // B6). Advancing the counter is what makes every EXISTING guard reject
        // it — refs, resolutions, probe and debris as well as the two this
        // change added, which is the panel's half of D5's one-token-one-
        // retirement rule. No second predicate to keep in step, and the number
        // stays monotonic, which is what the host's high-water mark relies on.
        //
        // Only when the form that closed is the one still being served. A
        // superseded form is torn down AFTER its successor's requests have gone
        // out — the panel asks for the new opening, and the old dialog is
        // replaced when the answer arrives — so advancing on its teardown would
        // retire the successor and drop the live form's replies. The same guard
        // the host applies to a close naming an opening it no longer holds.
        if (opening === this.refsToken) {
          this.refsToken += 1;
        }
      },
      // Create's shipped entry path. The dialog has existed since WT-002.1 and
      // nothing ever submitted it anywhere (round-1 B1); this is where the
      // draft becomes the request the host validates.
      onCreateSubmit: (draft) => {
        // An agent mode with nothing behind it would ask the host for a launch
        // it must refuse, so the mode is dropped rather than posted.
        if (draft.openAfter === "agent" && draft.agentId === undefined) {
          return;
        }
        // An OPTIONAL field left blank must be absent, not empty: git reads an
        // explicit "" as a ref and fails with `fatal: invalid reference:`, so
        // the ordinary new-branch create would never have worked (round-3 B11).
        const baseRef = draft.baseRef.trim();
        const branch = draft.branchName.trim();
        if (draft.branchMode !== "detached" && branch.length === 0) {
          return;
        }
        // The form has always known which of its three branch modes the user
        // picked; until the mode union it had nowhere on the wire to say so,
        // and the host inferred it from which optional fields were filled in.
        const mode: WorktreeCreateMode =
          draft.branchMode === "detached"
            ? // `fresh-detached` requires the ref, so the default lands here
              // rather than in the host — the type is what insists on it.
              { kind: "fresh-detached", baseRef: baseRef.length > 0 ? baseRef : "HEAD" }
            : draft.branchMode === "new"
              ? { kind: "fresh", branch, ...(baseRef.length > 0 ? { baseRef } : {}) }
              : // The classification the FORM was showing, carried on the draft.
                // Re-reading this controller's own map was a second
                // interpretation of one answer, and the two could name
                // different paths (round-3 B3).
                (repairOf(draft.resolved, branch) ?? { kind: "reuse", branch });
        deps.postMessage({
          type: "worktreeCreate",
          repoId: draft.repoId,
          // The opening this form was composed in. Posted BEFORE the retirement
          // that `onCreateClosed` sends, on the same ordered channel, so the one
          // legitimate submit still passes the host's equality check.
          opening: this.refsToken,
          path: draft.path,
          mode,
          // The disposition the FORM settled on, carried on the draft for the
          // same reason the mode is: re-deriving it here would be a second
          // interpretation of one answer, and this one authorizes a delete.
          // Absent means free — a recover the user never accepted is not one.
          disposition: draft.disposition ?? { kind: "free" },
          // Ids only, resolved host-side against the model it displayed.
          ...(draft.provision === undefined ? {} : { provision: draft.provision }),
          // The launch details travel with the agent variant and with no other —
          // the union is what makes any other pairing unrepresentable.
          afterCreate:
            draft.openAfter === "agent" && draft.agentId !== undefined
              ? {
                  kind: "agent",
                  waitForSetup: false,
                  agent: draft.agentId,
                  ...(draft.permissionChoiceId === undefined ? {} : { permissionChoiceId: draft.permissionChoiceId }),
                  ...(draft.prompt === undefined ? {} : { prompt: draft.prompt }),
                  ...(this.frozenCreateOffer?.offerId === undefined ? {} : { offerId: this.frozenCreateOffer.offerId }),
                }
              : { kind: draft.openAfter as Exclude<WorktreeOpenAfter, "agent"> },
        });
      },
      getInitialCollapsed: () => deps.store.getState().worktreeCollapsed,
      persistCollapsed: (ids) => deps.store.updateState({ worktreeCollapsed: ids }),
      getInitialExpandedRows: () => deps.store.getState().worktreeExpandedRows ?? [],
      persistExpandedRows: (ids) => deps.store.updateState({ worktreeExpandedRows: ids }),
      getInitialIdleSeeded: () => deps.store.getState().worktreeIdleTailSeeded ?? [],
      persistIdleSeeded: (ids) => deps.store.updateState({ worktreeIdleTailSeeded: ids }),
      // The reply is the next tree+presence envelope, carrying the roster on the
      // row itself — there is no response message to correlate here.
      onRequestSubagents: (row) => this.requestRoster(row),
      // Ids only — the host resolves them against its own tree and presence, so
      // a path or session the view guessed can never reach an action (D2).
      onActivateAgent: (row, activation) => this.activateAgent(row, activation),
      // A subagent has no pane of its own, so its activation is the PARENT's —
      // sending the user anywhere else would be a dead click (design.md D9).
      onActivateSubagent: (_subagent, parent) => this.activateSubagentParent(parent),
      // A getter, not a value: the setting is live, and re-reading it at the
      // click is what lets an update reach a view already painted.
      rowActivation: () => this.rowActivation,
      // Forwarded, not mirrored: the view owns the selection because the view is
      // what marks it, and a second copy here is a second thing to keep right.
      onSelectWorktree: (worktreeId) => {
        if (worktreeId === null) {
          // The chip cleared the scope, or the selected worktree left the tree:
          // either way there is no selection left for the drawer to describe.
          this.inspector.close();
        }
        this.deps.onSelectWorktree?.(worktreeId);
      },
      onInspect: (worktreeId) => this.inspector.open(worktreeId),
      // The tree's one deadline timer drives both surfaces, so they cannot
      // disagree about a row's confidence at any moment (design.md D7).
      onCeilingTick: () => this.inspector.refresh(),
      now: deps.now,
    });
    this.inspector = WorktreeInspector.mount({
      actions: this.menuActions,
      // The view's set, not a second one: the window asks once per row and
      // session, whichever surface wants it first (design.md D6).
      rosters: this.view.rosterRequests(),
      onRequestSubagents: (row) => this.requestRoster(row),
      onActivateAgent: (row, activation) => this.activateAgent(row, activation),
      onActivateSubagent: (_subagent, parent) => this.activateSubagentParent(parent),
      rowActivation: () => this.rowActivation,
      // Only the drawer knows whether focus was inside; only the tree can find
      // the row it belongs back on.
      onClosed: (worktreeId, focusWasInside) => {
        if (focusWasInside) {
          this.view.focusWorktree(worktreeId);
        }
      },
      now: deps.now,
    });
    this.element = document.createElement("div");
    this.element.className = "wt-body";
    this.element.append(this.view.element, this.inspector.element);
    // Bubbling, and only while the drawer is open: an overlay above it owns
    // Escape first, and swallowing the key here would leave that overlay unable
    // to close (design.md D9).
    this.element.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape" || !this.inspector.isOpen() || this.deps.overlayOpen?.() === true) {
        return;
      }
      ev.stopPropagation();
      this.inspector.close();
    });
    this.push();
  }

  /**
   * Declare whether this surface is showing the view, and ask for the tree on the
   * way in. The host sends nothing to a surface that has not declared it visible,
   * so this is what starts and stops the flow — nothing polls.
   */
  setVisible(visible: boolean): void {
    if (visible !== this.bodyShown) {
      this.bodyShown = visible;
      if (!visible) {
        // A create resolved after the panel left this body would mount a form
        // over a body it does not act in (round-1 W6). Keyed on the PANEL's
        // request, not on the subscription: a scope keeps the subscription open,
        // and this cleanup has nothing to do with presence. Putting it behind the
        // effective value is exactly the regression the earlier attempt shipped
        // (collapse-the-rail-after-a-sidebar-selection/.reviews/round-1.md B2).
        this.pendingCreate = null;
      }
    }
    this.applySubscription();
  }

  /**
   * Recompute the subscription from the panel's request and the current scope.
   * For the edge the panel cannot see: a scope set or cleared while the rail's
   * own state has not moved.
   */
  revalidateVisibility(): void {
    this.applySubscription();
  }

  private applySubscription(): void {
    // Two questions, two answers. The rail decides whether rows are drawn; a
    // scope decides whether anything is drawn from presence at all. Its chip,
    // escape control and hidden-waiting count all survive a collapsed rail
    // (worktree-panel-ui.md § 7.1), and going quiet under one freezes the
    // presence half of that count, which `tab-bar-component` § "The count reads
    // every source that can say a pane is waiting" forbids.
    const level: WorktreeSubscriptionLevel | null = this.bodyShown
      ? "rows"
      : this.deps.presenceNeeded?.() === true
        ? "presence"
        : null;
    if (level === this.subscribed) {
      return;
    }
    const wasSubscribed = this.subscribed !== null;
    this.subscribed = level;
    const visible = level !== null;
    this.deps.postMessage({ type: "worktreeViewVisibility", visible, ...(level ? { level } : {}) });
    if (visible) {
      // A level change on a standing subscription re-requests nothing. Promotion
      // does need the bare envelope redone, but asking for a tree only
      // rebroadcasts what is published — the host owns whether the published
      // envelope was enriched, and it re-projects on promotion itself
      // (round-2 W1).
      if (wasSubscribed) {
        return;
      }
      this.deps.postMessage({ type: "requestWorktreeTree" });
      // Asked on the way in rather than once at mount: which agents resolve is a
      // property of the machine, and one installed since the last look should
      // appear without reloading the window. One at a time, though — the reply
      // says which capability it answers and not which ASK, so two in flight can
      // land in either order and the older one would win.
      if (!this.awaitingLaunchTargets) {
        this.awaitingLaunchTargets = true;
        this.deps.postMessage({ type: "requestVaultLaunchTargets", capability: "start" });
      }
      return;
    }
    // A force in flight across this transition is never answered — the host skips
    // pushes to a surface that stopped showing the view.
    if (this.refreshing) {
      this.refreshing = false;
      this.push();
    }
  }

  /** Toolbar refresh: rebuild the listings rather than re-serve the cache. */
  requestRefresh(): void {
    // `bodyShown`, not the subscription: the toolbar this serves is in the body,
    // so a scope holding presence open is not a reason to accept one (D4).
    if (!this.bodyShown || this.refreshing) {
      return;
    }
    this.refreshing = true;
    this.deps.postMessage({ type: "requestWorktreeTree", force: true });
    this.push();
  }

  /** Filter the tree by branch, path, and agent title. */
  setQuery(query: string): void {
    this.view.setQuery(query);
  }

  /**
   * Ask the host where a create would go, then open the form on its answer.
   * Nothing opens until the answer arrives: a form seeded with a guess would
   * name a destination the create could refuse.
   */
  private openCreateFor(info: WorktreeInfo): void {
    const repo = this.repoFor(info);
    if (repo === undefined) {
      return;
    }
    this.openCreateForRepo(repo.repoId, info.id);
  }

  /**
   * Ask where a create would go, then open the form on the answer. With a
   * repository, that one; without, every repository in the tree — a door that
   * names none must offer them all rather than pick one for the user.
   */
  openCreateForRepo(repoId?: string, sourceWorktreeId?: string): void {
    // EVERY door asks every repository. The picker is built from the answers the
    // seed holds, so a door that asked about one would offer one — and the doors
    // are required to differ only in which repository the form opens ON.
    const repos = this.tree?.repos ?? [];
    const targets = repos.map((repo) => repo.repoId);
    if (targets.length === 0 || (repoId !== undefined && !targets.includes(repoId))) {
      return;
    }
    const source =
      sourceWorktreeId === undefined
        ? null
        : repoId !== undefined &&
            repos.find((repo) => repo.repoId === repoId)?.worktrees.some((row) => row.id === sourceWorktreeId)
          ? { repoId, worktreeId: sourceWorktreeId }
          : undefined;
    if (source === undefined) {
      return;
    }
    this.createSource = source;
    // A new form starts with no provisioning. Seeding it from the previous
    // form's offer meant a fresh read that FAILED left the old model on screen,
    // still resolvable, attributed to a form that had closed
    // (.reviews/round-2.md B6). Absent renders as "not told yet", which is the
    // honest state until the host answers.
    this.provisionOffers.clear();
    for (const migrationRepoId of this.migrationOffers.keys()) {
      this.applyMigrationOffer?.(migrationRepoId, undefined);
    }
    this.migrationOffers.clear();
    // Cleared on the same terms as the offer: a list seeded from the previous
    // form describes a repository state that may have moved, and the honest
    // opening state is "not told yet".
    this.repoRefs.clear();
    this.repoPullRequests.clear();
    this.createResolutions.clear();
    this.probeSeq = 0;
    this.refsToken += 1;
    this.pendingCreate = {
      // Kept so a create that cannot open can name what it was waiting on: the
      // outstanding set is empty by the time that is known.
      asked: [...targets],
      outstanding: new Set(targets),
      ...(repoId === undefined ? {} : { initialRepoId: repoId }),
    };
    for (const target of targets) {
      this.deps.postMessage({
        type: "requestWorktreeCreateDefaults",
        repoId: target,
        opening: this.refsToken,
        ...(source?.repoId === target ? { sourceWorktreeId: source.worktreeId } : {}),
      });
      // Not awaited by `pendingCreate`: the form opens on the destination alone
      // and gains the list when it lands, so a repository whose enumeration is
      // slow or fails never holds the dialog shut.
      this.deps.postMessage({ type: "requestWorktreeRefs", repoId: target, token: this.refsToken });
    }
  }

  /** The toolbar door, which names no repository. */
  openCreate(): void {
    this.openCreateForRepo();
  }

  /**
   * Open prune's confirmation, and post only what the user confirmed there.
   *
   * The count is re-read from the tree at the moment the dialog opens, and the
   * host re-counts authoritatively inside its queue: this number's job is to be
   * the one the user SAW, so a prune that would drop a different number is
   * abandoned rather than silently widened (D13).
   */
  private confirmPrune(repoId: string): void {
    const repo = this.tree?.repos.find((r) => r.repoId === repoId);
    if (repo === undefined) {
      return;
    }
    const count = repo.worktrees.filter((w) => w.prunable).length;
    if (count <= 0) {
      return;
    }
    this.view.openPruneDialog({ repoLabel: repo.label, count }, (confirmed) => {
      this.deps.postMessage({ type: "worktreePrune", repoId, confirmedCount: confirmed });
    });
  }

  /** Every repo the host has answered for, as the form's seed. */
  /**
   * Open the launch dialog for one worktree.
   *
   * The worktree is remembered rather than threaded through the dialog: the
   * dialog collects WHAT to launch, and the panel already knows WHERE, so a
   * mismatch between the two is not representable.
   */
  private openLaunchFor(info: WorktreeInfo): void {
    // Captured together with the list the dialog is about to render: the offer,
    // the worktree, and the registration of that worktree are one answer to one
    // question, and reading any of them again later would be reading a
    // different question's answer (design.md D10).
    this.frozenLaunch = {
      worktreeId: info.id,
      ...(this.launchOfferId === undefined ? {} : { offerId: this.launchOfferId }),
      ...(this.generationOf(info.id) === undefined ? {} : { generation: this.generationOf(info.id) }),
    };
    this.view.openLaunchDialog(info.branch ?? info.displayPath, this.launchAgents);
  }

  /**
   * The launch offer for one worktree, or `undefined` when there is none to make.
   *
   * Gate and action are one value on purpose: a caller that has to ask whether
   * launching is possible before offering it can render the offer inert, which is
   * the one thing `syncLaunchActions` already refuses to do (design.md D4).
   */
  launchOfferFor(worktreeId: string): (() => void) | undefined {
    if (this.launchAgents.length === 0 || this.infoOf(worktreeId) === undefined) {
      return undefined;
    }
    // Re-resolved when the offer is TAKEN, not when the region was built: the
    // region outlives several tree pushes, and the dialog would otherwise be
    // titled with a branch the worktree has since been renamed off
    // (round-1 suggestion).
    return () => {
      const info = this.infoOf(worktreeId);
      if (info !== undefined) {
        this.openLaunchFor(info);
      }
    };
  }

  private infoOf(worktreeId: string): WorktreeInfo | undefined {
    return this.tree?.repos.flatMap((repo) => repo.worktrees).find((wt) => wt.id === worktreeId);
  }

  /** The registration token the tree currently publishes for this worktree. */
  private generationOf(worktreeId: string): number | undefined {
    return this.tree?.repos.find((repo) => repo.worktrees.some((wt) => wt.id === worktreeId))?.generation;
  }

  /** Capture what an agent row's menu is being built against. */
  private captureMenuTarget(row: WorktreeAgentRow): void {
    const worktreeId = this.worktreeIdOf(row);
    this.frozenMenuTarget =
      worktreeId === undefined
        ? null
        : {
            rowId: row.rowId,
            worktreeId,
            ...(this.generationOf(worktreeId) === undefined ? {} : { generation: this.generationOf(worktreeId) }),
          };
  }

  /** Resume a row's session in the worktree that row is published under. */
  private resumeHere(row: WorktreeAgentRow): void {
    const frozen = this.frozenMenuTarget;
    // The menu this item belongs to must be the one that was captured. A row
    // that never went through a menu open, or one from an earlier menu, has no
    // authority here — refusing is the safe direction, and the item cannot be
    // reached any other way.
    if (row.entryId === undefined || frozen === null || frozen.rowId !== row.rowId) {
      return;
    }
    this.deps.postMessage({
      type: "worktreeResumeHere",
      worktreeId: frozen.worktreeId,
      rowId: row.rowId,
      entryId: row.entryId,
      ...(frozen.generation === undefined ? {} : { generation: frozen.generation }),
    });
    this.frozenMenuTarget = null;
  }

  /**
   * Which worktree each of this window's panes is running in, read off the
   * envelope that already carries presence — the only attribution path there is
   * (design.md D2). An absent key means "not placed", which is why no sentinel
   * value exists for it: a third value would invite a fourth outcome.
   *
   * A pane published under more than one worktree is OMITTED, not resolved by
   * last-write-wins. Two answers to a question the evidence did not settle is not
   * proof, and the consumer hides only what it can prove belongs elsewhere.
   */
  /**
   * Where presence puts each pane, and which panes it says are waiting — from ONE
   * walk, reported together (design.md D1). The two halves answer different
   * questions and neither gates the other: a contested pane is dropped from the
   * placement but keeps whatever it said about waiting, because "we cannot say
   * which worktree this is in" is not a claim about whether it needs a human.
   */
  private buildAttribution(): PaneReport {
    const map = new Map<string, string>();
    const waiting = new Set<string>();
    const contested = new Set<string>();
    for (const [worktreeId, rows] of Object.entries(this.presence?.rowsByWorktreeId ?? {})) {
      // External rows name agents this window does not host — they carry no pane
      // of ours and so say nothing about where any of our tabs belongs. Dropped
      // in one pass rather than tested twice inside the loop below.
      for (const row of rows.filter((r) => r.scope === "window")) {
        if (row.paneId === undefined) {
          continue;
        }
        if (row.activity === "waiting") {
          waiting.add(row.paneId);
        }
        const held = map.get(row.paneId);
        if (held !== undefined && held !== worktreeId) {
          contested.add(row.paneId);
        }
        map.set(row.paneId, worktreeId);
      }
    }
    for (const paneId of contested) {
      map.delete(paneId);
    }
    return { placement: map, waiting };
  }

  /**
   * Report attribution, but only where it moved. A presence scan lands on its own
   * cadence and most of them carry the same placement — reporting each one would
   * make every scan a reason to redraw the tab bar.
   */
  private emitAttribution(): void {
    const next = this.buildAttribution();
    // The SAME canonicalisers the render signature uses. Both suppress a duplicate
    // on the same question and were byte-identical copies of this encoding, which
    // is one edit away from disagreeing about it (round-1 W3). BOTH halves are in
    // the key: either moving is a report, and neither moving is silence.
    const key = `${attributionKey(next.placement)}\u0002${waitingKey(next.waiting)}`;
    if (key === this.lastAttribution) {
      return;
    }
    this.lastAttribution = key;
    this.deps.onAttribution?.(next);
  }

  /** Which worktree the presence envelope published this row under. */
  private worktreeIdOf(row: WorktreeAgentRow): string | undefined {
    for (const [worktreeId, rows] of Object.entries(this.presence?.rowsByWorktreeId ?? {})) {
      if (rows.some((r) => r.rowId === row.rowId)) {
        return worktreeId;
      }
    }
    return undefined;
  }

  /** The host's answer to "which agents can start a fresh session here". */
  handleLaunchTargets(msg: VaultLaunchTargetsMessage): void {
    // Only the start answer is ours: the continuation dialog asks the same
    // question with the other capability and gets a different set back.
    if (msg.capability !== "start") {
      return;
    }
    this.awaitingLaunchTargets = false;
    // Kept with the list it came with: the host admits a launch only against the
    // answer this panel actually received, and quoting it is the proof.
    this.launchOfferId = msg.offerId;
    this.launchAgents = msg.targets.map((t) => ({
      id: t.agent,
      label: t.displayName,
      permissionChoices: t.permissionChoices,
      canSeedPrompt: t.canSeedPrompt,
    }));
    this.syncLaunchActions();
    this.push();
  }

  /**
   * Both launch items ride on the same host capability, so the host's own answer
   * gates them together: no agent can start a session here means neither item is
   * offered, rather than offered and refused.
   */
  private syncLaunchActions(): void {
    // Both directions: the drawer must gain the item when a target arrives and
    // lose it when the last one goes, and neither moves any field in its guard
    // (.reviews/round-1.md B3). The tree rebuilds its menu at click time, so it
    // has never needed this.
    this.inspector.invalidate();
    if (this.launchAgents.length === 0) {
      delete this.menuActions.launchAgentHere;
      delete this.menuActions.resumeHere;
      return;
    }
    this.menuActions.launchAgentHere = (info) => this.openLaunchFor(info);
    this.menuActions.resumeHere = (row) => this.resumeHere(row);
  }

  private createRepos(): WorktreeCreateDefaults[] {
    const repos: WorktreeCreateDefaults[] = [];
    for (const repo of this.tree?.repos ?? []) {
      const answer = this.createDefaults.get(repo.repoId);
      if (answer === undefined) {
        continue;
      }
      const offer = this.provisionOffers.get(repo.repoId);
      const migration = this.migrationOffers.get(repo.repoId);
      const refs = this.repoRefs.get(repo.repoId);
      const prs = this.repoPullRequests.get(repo.repoId);
      repos.push({
        repoId: repo.repoId,
        repoLabel: repo.label,
        mainPath: repo.mainPath,
        pathParent: answer.root,
        pathPrefix: answer.prefix,
        // ALWAYS the host's path: it is the destination the create will take,
        // and the form is required to name that one rather than its own guess.
        // `collidedWith` is narrower — it marks the candidate that was occupied,
        // so the hint can say why the destination is not the obvious name.
        resolvedPath: answer.path,
        ...(answer.branch === undefined ? {} : { answersBranch: answer.branch }),
        ...(answer.collidedWith === undefined ? {} : { collidedWith: answer.collidedWith }),
        // WT-005.3 owns launches; an option that resolves to nothing is worse
        // than no option at all.
        agents: this.launchAgents,
        // Absent until the offer arrives, which the form renders as "not told
        // yet" rather than as "nothing to bring over".
        ...(offer === undefined ? {} : { provisioning: { offerId: offer.offerId, model: offer.model } }),
        ...(migration === undefined ? {} : { migration: { offerId: migration.offerId, count: migration.count } }),
        // Same terms as the offer: absent renders as "not told yet", never as
        // "this repository has no branches".
        ...(refs === undefined ? {} : { refs: { list: refs.refs, truncated: refs.truncated } }),
        // Absent stays absent: "not asked yet" is not the unavailable row, and
        // the form is what decides how each of those reads.
        ...(prs === undefined ? {} : { pullRequests: pullRequestOffer(prs) }),
      });
    }
    return repos;
  }

  handleMigrationOffer(msg: WorktreeMigrationOfferMessage): void {
    const source = this.createSource;
    if (
      msg.opening !== this.refsToken ||
      source === null ||
      source.repoId !== msg.repoId ||
      source.worktreeId !== msg.sourceWorktreeId ||
      msg.offerId.length === 0 ||
      !Number.isSafeInteger(msg.count) ||
      msg.count <= 0
    ) {
      return;
    }
    this.migrationOffers.set(msg.repoId, msg);
    this.applyMigrationOffer?.(msg.repoId, { offerId: msg.offerId, count: msg.count });
  }

  /**
   * The host's provisioning offer for one repo.
   *
   * Stored and pushed into an open form. Superseding is the HOST's decision —
   * it issues one offer per form and evicts the previous id when it does — so
   * this simply takes the latest, and never keeps two.
   */
  handleProvisionOffer(msg: WorktreeProvisionOfferMessage): void {
    // The rule `handleRefs` already applies, at the site that had none. Without
    // it this cached whatever arrived, so a predecessor's read landing after a
    // reopening published its model into a form that never asked for it
    // (design.md D2).
    if (msg.opening !== this.refsToken) {
      return;
    }
    this.provisionOffers.set(msg.repoId, msg);
    // Only the repository that changed, and only the offer. Rebuilding every
    // repository's record to update one was O(repos²) across a workspace's
    // replies (round-1 S1), and sending it down the destination's channel is
    // what B4 was.
    this.applyProvisionOffer?.(msg.repoId, { offerId: msg.offerId, model: msg.model });
  }

  /**
   * The host's branch list for one repo.
   *
   * Stored and pushed into an open form. An answer that outlived its OPENING is
   * dropped on the token, which `repoId` alone cannot do: a reopening on the
   * same repository is asking the same question twice (round-2 W2).
   */
  handleRefs(msg: WorktreeRefsMessage): void {
    if (msg.token !== this.refsToken) {
      // An answer to a PREVIOUS opening. Dropped rather than applied: the form
      // it was asked for is gone, and its successor's list would otherwise be
      // overwritten with a predecessor's — permanently, if the successor's own
      // read fails (round-2 W2).
      return;
    }
    this.repoRefs.set(msg.repoId, msg);
    this.applyRefs?.(msg.repoId, { list: msg.refs, truncated: msg.truncated });
  }

  /**
   * The host's pull-request answer for one repo.
   *
   * Dropped on the same token as `handleRefs`, and for the same reason: both
   * are answers to one opening's `requestWorktreeRefs`, so an answer that
   * outlived its opening would otherwise seed a successor form with rows read
   * for a form the user has already closed.
   */
  handlePullRequests(msg: WorktreePullRequestsMessage): void {
    if (msg.token !== this.refsToken) {
      return;
    }
    this.repoPullRequests.set(msg.repoId, msg);
    this.applyPullRequests?.(msg.repoId, pullRequestOffer(msg));
  }

  /**
   * What the host says a create against the settled selection would do.
   *
   * Dropped on the token for the same reason `handleRefs` drops on it: a dialog
   * reopened on the same repository has the same `repoId` and may have the same
   * `query` on the wire twice, so neither can separate two openings. `query`
   * echoes for staleness WITHIN one opening, which the form applies.
   */
  handleCreateResolution(msg: WorktreeCreateResolutionMessage): void {
    if (msg.token !== this.refsToken) {
      return;
    }
    // `token` separates two OPENINGS and `query` separates two edits, but an
    // A → B → A edit sequence puts two answers on the wire identical in both.
    //
    // Against the latest QUESTION, not the latest answer. `appliedSeq` alone
    // let an answer for base A land after base B had been asked — newer than
    // anything applied, older than the question on screen — and clear the gate
    // with A's verdict on B, which the form cannot detect because the branch is
    // identical (round-4 B9).
    if (msg.seq !== this.probeSeq) {
      return;
    }
    this.createResolutions.set(msg.repoId, msg);
    this.applyResolution?.(msg);
  }

  /**
   * The host's answer to the form's request to clear a directory.
   *
   * Dropped on the token like every other create-dialog answer: an answer to a
   * PREVIOUS opening authorizes nothing in this one. Not stored — an
   * authorization is spent by the create that redeems it, so keeping a copy
   * here would outlive the form that asked for it.
   */
  handleDebrisAuthorized(msg: WorktreeDebrisAuthorizedMessage): void {
    if (msg.token !== this.refsToken) {
      return;
    }
    this.applyDebrisAuthorization?.(msg);
  }

  /**
   * The resolution currently held for a repository, if one has landed.
   *
   * Held for the ANSWER's own lifecycle — supersession and the reopen that
   * clears it — and read by nothing that builds a request: the submission
   * carries the classification the form was showing (round-3 B3).
   */
  resolutionFor(repoId: string): WorktreeCreateResolutionMessage | undefined {
    return this.createResolutions.get(repoId);
  }

  /** The host's create destination for one repo, and the form it was asked for. */
  handleCreateDefaults(msg: WorktreeCreateDefaultsMessage): void {
    // Before the branch-versus-branch-less distinction below, because that one
    // tells a superseded ask's leftovers from a current answer WITHIN one
    // opening. It cannot tell two openings apart at all: both ask branch-less
    // first, so a predecessor's opening answer is shaped exactly like the live
    // one's (design.md D2).
    if (msg.opening !== this.refsToken) {
      return;
    }
    this.createDefaults.set(msg.repoId, msg);
    const pending = this.pendingCreate;
    if (pending === null || !pending.outstanding.has(msg.repoId)) {
      // The two conversations are told apart by what they carry, not by what is
      // outstanding: an OPEN form always asks with a branch and an opening ask
      // never does, and the host echoes the branch it was given. A superseded
      // ask's leftovers are therefore branch-less, and the form's own staleness
      // guard compares branches — so it could not have caught them, and one
      // cleared the wait for a branch the user had already typed (round-1 B1).
      if (msg.branch !== undefined) {
        const seed = this.createRepos().find((r) => r.repoId === msg.repoId);
        if (seed !== undefined) {
          this.applyCreateDefaults?.(seed);
        }
      }
      return;
    }
    pending.outstanding.delete(msg.repoId);
    if (pending.outstanding.size > 0) {
      return;
    }
    this.openPendingCreate(pending);
  }

  /**
   * Open the form the completed ask was for. Both completion paths end here —
   * the last answer, and a reconcile that dropped the last repository still
   * outstanding.
   */
  /** A repo's label if the tree still holds it, else the id it was asked under. */
  private labelForRepo(repoId: string): string {
    return this.tree?.repos.find((r) => r.repoId === repoId)?.label ?? repoId;
  }

  private openPendingCreate(pending: { asked: string[]; outstanding: Set<string>; initialRepoId?: string }): void {
    this.pendingCreate = null;
    // Frozen only for a form that actually opens: `openCreateDialog` returns on
    // an empty seed, and a standing offer for a form that never opened is a
    // claim about a dialog that is not there (round-1 S2).
    if (this.createRepos().length === 0) {
      // And SAID, not merely skipped (round-2 W10). Nothing was attempted
      // because what the create would have acted in could no longer be read —
      // the repositories it asked about are not the ones the tree now holds.
      // Silence here is a "+" that does nothing when pressed.
      this.actionResults = [
        ...this.actionResults.filter((r) => r.action !== "create" || r.outcome !== "unavailable"),
        {
          action: "create",
          outcome: "unavailable",
          unreadable: pending.asked.map((repoId) => this.labelForRepo(repoId)),
        },
      ];
      this.push();
      return;
    }
    this.frozenCreateOffer = { ...(this.launchOfferId === undefined ? {} : { offerId: this.launchOfferId }) };
    this.view.openCreateDialog(pending.initialRepoId);
  }

  /**
   * What a mutation this surface started actually did. One notice per scope and
   * verb: a second attempt replaces the first rather than stacking, because the
   * older result no longer describes the tree.
   */
  handleMutationResult(msg: WorktreeMutationResultMessage): void {
    this.showActionResult(toActionResult(msg));
  }

  /**
   * What provisioning did, folded onto the create notice that is already there.
   *
   * The host posts this immediately after the create's own result on one
   * ordered channel, so the notice exists by the time this lands. Merged rather
   * than raised separately: `showActionResult` keys notices by action, worktree
   * and repo, so a second one would REPLACE the create's rather than sit beside
   * it. If the create notice is somehow gone, this reports on its own rather
   * than being dropped — a user who is told nothing cannot tell "nothing was
   * brought over" from "nobody looked".
   */
  handleProvisionResult(msg: WorktreeProvisionResultMessage): void {
    // Matched on the id the create ARRIVED under. `rescope` drops a `worktreeId`
    // the tree does not carry yet and keeps it as the orphaned label, and a
    // worktree made a moment ago is precisely that until the next rebuild lands
    // — so the id-only key missed on every real create, which is what made the
    // service supplying an id (round-2 F017) only half the fix.
    const existing = this.actionResults.find(
      (r) => r.action === "create" && (r.worktreeId ?? r.orphanedLabel) === msg.worktreeId,
    );
    this.showActionResult({
      ...(existing ?? { action: "create", worktreeId: msg.worktreeId, outcome: "ok" as const }),
      provisioned: msg.steps,
      ports: msg.ports,
      ...(msg.portWarnings === undefined ? {} : { portWarnings: msg.portWarnings }),
      provisionContests: msg.contests,
    });
  }

  /**
   * Mint the token this request will be answered under, replacing whatever was
   * live (design.md D4).
   *
   * It REFUSES NOTHING. A same-worktree repeat used to be dropped here, as the
   * bound on host work; the panel could never be that bound — it sees one
   * surface and one worktree id, so alternating rows walked past it (round-6
   * B5) — and refusing the repeat is what made a dropped reply permanent,
   * because the re-ask that would recover the row was the thing suppressed
   * (round-6 W6). Admission is the host's, per repository.
   *
   * The token orders answers and authorizes nothing: a reply carrying a stale
   * one is discarded rather than trusted for any part of itself (D11), and
   * `liveAssess` is one field, so at most one is ever live.
   */
  private beginAssess(worktreeId: string): string {
    this.assessSeq += 1;
    const token = `assess-${this.assessSeq}`;
    this.liveAssess = { token, worktreeId };
    return token;
  }

  /** Ask what a removal would cost, under a token this surface can recognise. */
  private askRemoval(worktreeId: string): void {
    this.deps.postMessage({ type: "worktreeRemoveAssess", worktreeId, token: this.beginAssess(worktreeId) });
  }

  /** One notice per scope and verb, wherever the outcome came from. */
  private showActionResult(raw: WorktreeActionResult): void {
    const result = this.rescope(raw);
    // Keyed on the CANONICAL identity, not on the field that happens to hold it.
    // `rescope` moves a `worktreeId` the tree has not seen yet into
    // `orphanedLabel`, and a worktree made a moment ago is exactly that — so two
    // creates in one repository both keyed as `undefined` and the second ate the
    // first (.reviews/round-4.md F017).
    const identity = (r: WorktreeActionResult): string | undefined => r.worktreeId ?? r.orphanedLabel;
    this.actionResults = [
      ...this.actionResults.filter(
        (r) => !(r.action === result.action && identity(r) === identity(result) && r.repoId === result.repoId),
      ),
      result,
    ];
    this.push();
  }

  /**
   * What the removal WOULD cost, answered before anything is deleted (D6).
   *
   * The two arms are different questions and the discriminant is what keeps them
   * apart. `checksFor` marks the whole catalogue `unproven` for an assessment it
   * could not make, refusal-class checks included, so rendering that as a report
   * would show a worktree the host merely could not READ as a hard refusal with
   * no control at all (D8). It goes to the retry surface instead, which is where
   * the host's own `unavailable` already goes.
   */
  handleRemoveAssessment(msg: WorktreeRemoveAssessmentMessage): void {
    // Whatever its worktreeId. An id-only guard cannot order two requests for
    // the SAME worktree, and reply 1 landing after request 2 would still open
    // (D11).
    if (this.liveAssess === null || this.liveAssess.token !== msg.token) {
      return;
    }
    this.liveAssess = null;
    const info = this.infoOf(msg.worktreeId);
    if (msg.result.kind === "unavailable") {
      const repoId = info === undefined ? undefined : this.repoFor(info)?.repoId;
      this.showActionResult({
        action: "remove",
        worktreeId: msg.worktreeId,
        ...(repoId === undefined ? {} : { repoId }),
        outcome: "unavailable",
        unreadable: msg.result.unreadable,
      });
      return;
    }
    if (info === undefined) {
      // The row left the tree while the host was reading it. Opening a report
      // about a worktree the panel no longer shows would ask the user to
      // authorize a deletion they cannot see the target of.
      return;
    }
    this.view.openRemoveReport(info, { ...msg.result.assessment, fingerprint: msg.result.fingerprint });
  }

  /** A reply and an unsolicited push are the same message, handled the same way. */
  handleTreeResponse(msg: WorktreeTreeResponseMessage): void {
    this.reconcile(msg.tree);
    this.tree = msg.tree;
    this.presence = msg.presence;
    this.emitAttribution();
    this.loading = false;
    this.refreshing = false;
    this.deps.onCreateAvailability?.(msg.tree.repos.length > 0);
    this.push();
  }

  /**
   * The halves of an action the extension cannot perform, answered back here
   * (D2). Neither is a request the view raised on its own behalf: the host
   * resolved the id first, and a surface that does not hold it does nothing —
   * silently, because the surface that DOES hold it was sent the same message.
   */
  showPreview(entryId: string): void {
    this.deps.showPreview?.(entryId);
  }

  activatePane(paneId: string): void {
    this.deps.activatePane?.(paneId);
  }

  /** The setting moved after `init`. Nothing re-renders — the next click reads it. */
  setRowActivation(activation: WorktreeRowActivation): void {
    this.rowActivation = activation;
  }

  /** The worktree the panel has selected, or `null` for none. */
  selectedWorktree(): string | null {
    return this.view.selectedWorktree();
  }

  /** Drop the panel's selection — the tab bar's chip clearing its own scope. */
  clearSelection(): void {
    this.view.clearSelection();
  }

  /** The drawer, for tests and for the panel that needs to know it is open. */
  isInspectorOpen(): boolean {
    return this.inspector.isOpen();
  }

  /**
   * The tab bar dropped its scope because the worktree left the tree. Reported
   * through the panel's own notice list — the one place this panel says what
   * happened — rather than a second channel the user has to learn (design.md D7).
   */
  reportScopeCleared(worktreeId: string, label: string): void {
    this.stageScopeCleared(worktreeId, label);
    this.push();
  }

  /**
   * The same statement, without the repaint. The seam stages it before handing the
   * tree over, so ONE push carries the notice and the tree that caused it — the
   * notice is never painted beside the row it contradicts, and the panel is not
   * rebuilt twice for one event (round-2 V5).
   */
  stageScopeCleared(worktreeId: string, label: string): void {
    this.actionResults = [
      ...this.actionResults.filter((r) => !(r.action === "scope" && r.worktreeId === worktreeId)),
      { action: "scope", worktreeId, outcome: "ok", orphanedLabel: label },
    ];
  }

  dispose(): void {
    this.view.dispose();
  }

  /**
   * Bring the two collections keyed by tree identity back onto the tree that
   * has just arrived, BEFORE it replaces the one they were keyed against —
   * the outgoing tree is the only place a departed row's label still exists.
   *
   * Two distinct failures, one pass (round-3 B1, W6):
   * - a result whose worktree is gone renders nowhere, so a successful removal
   *   reported nothing at all. Re-scoped to its repo, it stays dismissable.
   * - both maps otherwise grow with every repository and worktree the surface
   *   has ever seen, and a recreation at the same id inherits the old notice.
   */
  private reconcile(next: WorktreeTree): void {
    const repos = new Set(next.repos.map((r) => r.repoId));
    const worktrees = new Set(next.repos.flatMap((r) => r.worktrees.map((w) => w.id)));
    const labels = new Map(
      (this.tree?.repos ?? []).flatMap((r) => r.worktrees.map((w) => [w.id, w.displayPath] as const)),
    );

    for (const repoId of this.createDefaults.keys()) {
      if (!repos.has(repoId)) {
        this.createDefaults.delete(repoId);
      }
    }
    for (const repoId of this.provisionOffers.keys()) {
      if (!repos.has(repoId)) {
        this.provisionOffers.delete(repoId);
      }
    }
    for (const repoId of this.migrationOffers.keys()) {
      if (!repos.has(repoId)) {
        this.migrationOffers.delete(repoId);
        this.applyMigrationOffer?.(repoId, undefined);
      }
    }
    const source = this.createSource;
    if (
      source !== null &&
      !next.repos
        .find((repo) => repo.repoId === source.repoId)
        ?.worktrees.some((row) => row.id === source.worktreeId && !row.bare && !row.missing && !row.prunable)
    ) {
      this.createSource = null;
      this.migrationOffers.delete(source.repoId);
      this.applyMigrationOffer?.(source.repoId, undefined);
    }
    for (const repoId of this.repoRefs.keys()) {
      if (!repos.has(repoId)) {
        this.repoRefs.delete(repoId);
      }
    }

    // A create waiting on a repository that has left is waiting for a message
    // the host has no way to send: it answers only while the repo is in its
    // cache, and there is no error reply. Unreconciled, one departure jams the
    // create for every repository it asked (round-1 W1).
    const pending = this.pendingCreate;
    if (pending !== null) {
      for (const repoId of pending.outstanding) {
        if (!repos.has(repoId)) {
          pending.outstanding.delete(repoId);
        }
      }
      if (pending.initialRepoId !== undefined && !repos.has(pending.initialRepoId)) {
        delete pending.initialRepoId;
      }
      if (pending.outstanding.size === 0) {
        this.openPendingCreate(pending);
      }
    }

    // Remember what left, so a result that arrives after this rebuild can name
    // the row it outlived. Dropped again the moment the id comes back.
    for (const [id, label] of labels) {
      if (!worktrees.has(id)) {
        this.departed.set(id, label);
      }
    }
    for (const id of this.departed.keys()) {
      if (worktrees.has(id)) {
        this.departed.delete(id);
      }
    }
    trim(this.departed, MAX_DEPARTED);

    this.actionResults = this.actionResults.flatMap((r) => {
      if (r.repoId !== undefined && !repos.has(r.repoId)) {
        // The repository itself left the workspace. Nothing is left to report to.
        return [];
      }
      return [this.rescope(r, worktrees)];
    });
    // W6: orphan notices answer to no row, so nothing else would ever bound them.
    const orphans = this.actionResults.filter((r) => r.orphanedLabel !== undefined);
    if (orphans.length > MAX_ORPHAN_NOTICES) {
      const dropped = new Set(orphans.slice(0, orphans.length - MAX_ORPHAN_NOTICES));
      this.actionResults = this.actionResults.filter((r) => !dropped.has(r));
    }
  }

  /**
   * A result whose row is not in the tree is re-scoped to its repository.
   *
   * Applied at BOTH doors — an arriving result and an arriving tree — because
   * which one comes second is not the controller's choice.
   */
  private rescope(result: WorktreeActionResult, present?: ReadonlySet<string>): WorktreeActionResult {
    const worktreeId = result.worktreeId ?? result.canonicalId;
    if (worktreeId === undefined) {
      return result;
    }
    if (present === undefined && this.tree === null) {
      // No tree is not an empty tree. Re-scoping here would orphan every notice
      // that arrives before the first rebuild lands.
      return result;
    }
    const rows = present ?? new Set((this.tree?.repos ?? []).flatMap((r) => r.worktrees.map((w) => w.id)));
    if (rows.has(worktreeId)) {
      // Both directions, because a create's notice arrives BEFORE the row it is
      // about: every real create is re-scoped first and reattached here, and a
      // one-way move left it at the repository anchor forever, still counted
      // against the orphan bound that can evict it (round-5 F017).
      const { orphanedLabel: _shown, ...named } = result;
      return result.worktreeId === undefined ? { ...named, worktreeId } : result;
    }
    const label = result.orphanedLabel ?? this.departed.get(worktreeId);
    const { worktreeId: _gone, ...rest } = result;
    return {
      ...rest,
      // Identity is kept only for a row that has NOT ARRIVED yet. A row that
      // DEPARTED can be recreated at the same id, and handing the old notice
      // back to it would report someone else's action on a worktree that never
      // had it — so `departed`, which reconciliation has already filled by the
      // time a removal's result lands, is what tells the two apart. An id aged
      // out of that bounded map reads as never-arrived; the notice is then
      // reattachable, which is the same answer it would get if it had been made
      // after the eviction.
      ...(label === undefined ? { canonicalId: worktreeId } : {}),
      orphanedLabel: label ?? worktreeId,
    };
  }

  /** The reply is the next envelope, carrying the roster on the row itself. */
  private requestRoster(row: WorktreeAgentRow): void {
    if (row.entryId !== undefined) {
      this.deps.postMessage({ type: "requestWorktreeSubagents", rowId: row.rowId, entryId: row.entryId });
    }
  }

  /** Ids only — the host resolves them against its own tree and presence (D2). */
  private activateAgent(row: WorktreeAgentRow, activation: WorktreeRowActivation): void {
    if (activation === "focus") {
      if (row.paneId !== undefined) {
        this.deps.postMessage({ type: "worktreeFocusPane", rowId: row.rowId, paneId: row.paneId });
      }
      return;
    }
    if (row.entryId !== undefined) {
      this.deps.postMessage({ type: "worktreeOpenPreview", rowId: row.rowId, entryId: row.entryId });
    }
  }

  private activateSubagentParent(parent: WorktreeAgentRow): void {
    if (parent.paneId !== undefined) {
      this.deps.postMessage({ type: "worktreeFocusPane", rowId: parent.rowId, paneId: parent.paneId });
    }
  }

  private push(): void {
    this.view.setData({
      tree: this.tree,
      presence: this.presence,
      loading: this.loading,
      refreshing: this.refreshing,
      actionResults: this.actionResults,
      noFolder: this.deps.init.workspaceRoot === null,
    });
    // After the view: the drawer describes a worktree the tree has already
    // reconciled, and a selection that left the tree is dropped in there.
    this.inspector.setData(this.tree, this.presence);
  }
}

/**
 * The host's outcome as the panel renders it.
 *
 * `blocked` is not a failure: the host declined to act and handed back the
 * blocker set it assessed, so the notice reopens the confirmation bound to that
 * exact set rather than reporting a dead end. A `null` fingerprint means the
 * set is a refusal — nothing can authorize it, and the dialog says so.
 */
function toActionResult(msg: WorktreeMutationResultMessage): WorktreeActionResult {
  // A worktree-scoped result hangs on its row, a repo-scoped one on the repo —
  // `resultsFor` reads the repo branch only when no worktreeId is present. The
  // repo id rides along regardless, because the indeterminate notice's Prune
  // needs a repository to act on.
  const scope = {
    repoId: msg.repoId,
    ...(msg.worktreeId === undefined ? {} : { worktreeId: msg.worktreeId }),
  };
  switch (msg.result.kind) {
    case "ok":
      return {
        action: msg.verb,
        ...scope,
        outcome: "ok",
        ...(msg.result.openFailed === undefined ? {} : { openFailed: msg.result.openFailed }),
        ...(msg.result.branchDelete === undefined ? {} : { branchDelete: msg.result.branchDelete }),
      };
    case "indeterminate":
      return { action: msg.verb, ...scope, outcome: "indeterminate", observed: msg.result.observed };
    case "unavailable":
      return { action: msg.verb, ...scope, outcome: "unavailable", unreadable: msg.result.unreadable };
    case "blocked":
      return {
        action: "remove",
        repoId: msg.repoId,
        worktreeId: msg.result.worktreeId,
        outcome: "error",
        needsConfirm: { ...msg.result.assessment, fingerprint: msg.result.fingerprint },
      };
    default:
      return { action: msg.verb, ...scope, outcome: "error", error: msg.result.message };
  }
}
