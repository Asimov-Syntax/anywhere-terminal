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
  VaultLaunchTargetsMessage,
  WebViewToExtensionMessage,
  WorktreeCreateDefaultsMessage,
  WorktreeMutationResultMessage,
  WorktreeSubscriptionLevel,
  WorktreeTreeResponseMessage,
} from "../../types/messages";
import { attributionKey, type PaneReport, waitingKey } from "../paneAttribution";
import type { WebviewState } from "../state/WebviewState";
import type { VaultView } from "../vault/VaultPanel";
import type { WorktreeMenuActions } from "./WorktreeContextMenu";
import { WorktreeView } from "./WorktreeView";
import type {
  WorktreeActionResult,
  WorktreeAgentRow,
  WorktreeCreateDefaults,
  WorktreeInfo,
  WorktreeLaunchAgent,
  WorktreeOpenAfter,
  WorktreePresence,
  WorktreeRowActivation,
  WorktreeTree,
} from "./worktreeViewTypes";

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
  init: { workspaceRoot: string | null; rowActivation: WorktreeRowActivation; workbench: boolean };
  /**
   * The user selected a worktree, or `null` when the selected one left the tree.
   * The scope consumer subscribes here; the controller only relays and holds.
   */
  onSelectWorktree?: (worktreeId: string | null) => void;
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
    removeWorktree: (info) => post({ type: "worktreeRemove", worktreeId: info.id, force: false }),
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

export class WorktreeController {
  /** The tree element — goes into `VaultPanel`'s `worktreeBody`. */
  readonly element: HTMLElement;

  private readonly deps: WorktreeControllerDeps;
  private readonly view: WorktreeView;
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
  /**
   * Whether the worktree workbench composition is on. Nothing reads it yet; the
   * slices that do arrive behind it, and it is false unless configured.
   */
  private workbench: boolean;
  /** The last attribution reported, keyed for comparison. `null` → none yet. */
  private lastAttribution: string | null = null;
  /** The host's resolved create destination, per repo. Only it can know one. */
  private readonly createDefaults = new Map<string, WorktreeCreateDefaultsMessage>();
  /** The repo a create was invoked for, waiting on its defaults. */
  /**
   * The create waiting on the host, and the repositories it has yet to hear
   * from. A set rather than one id because an unscoped create asks every
   * repository: the form builds its picker once, from the seed it opened with,
   * so opening on the first reply would offer one repository as the workspace.
   */
  private pendingCreate: { asked: string[]; outstanding: Set<string>; initialRepoId?: string } | null = null;
  /** Push a fresh host answer into the open form. Null when none is open. */
  private applyCreateDefaults: ((next: WorktreeCreateDefaults) => void) | null = null;
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
    );
    // Always wired, unlike `resumeHere`: the capture is what makes the menu's
    // own view of the tree authoritative, and it must happen even on an open
    // that offers no resume, so a later one cannot inherit an older capture.
    this.menuActions.captureTarget = (row) => this.captureMenuTarget(row);
    // No folder means no tree is ever coming, so the skeleton would be a promise
    // the workspace cannot keep.
    this.loading = deps.init.workspaceRoot !== null;
    this.rowActivation = deps.init.rowActivation;
    this.workbench = deps.init.workbench;
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
        onBranchChange: (repoId, branch) => deps.postMessage({ type: "requestWorktreeCreateDefaults", repoId, branch }),
        bindDefaults: (apply) => {
          this.applyCreateDefaults = apply;
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
      onForceRemove: (info, fingerprint) => {
        deps.postMessage({ type: "worktreeRemove", worktreeId: info.id, force: true, fingerprint });
      },
      onPrune: (repoId) => this.confirmPrune(repoId),
      // Only `unavailable` reaches here — the read failed, so asking again is
      // the whole remedy. Unforced: what was unreadable may still be a blocker.
      onRetryAction: (result) => {
        if (result.worktreeId !== undefined) {
          deps.postMessage({ type: "worktreeRemove", worktreeId: result.worktreeId, force: false });
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
        deps.postMessage({
          type: "worktreeCreate",
          repoId: draft.repoId,
          path: draft.path,
          // The launch details travel with the agent mode and with no other —
          // the host rejects any other pairing rather than ignoring them.
          ...(draft.openAfter === "agent" && draft.agentId !== undefined
            ? {
                openAfter: "agent" as const,
                launch: {
                  agent: draft.agentId,
                  ...(draft.permissionChoiceId === undefined ? {} : { permissionChoiceId: draft.permissionChoiceId }),
                  ...(draft.prompt === undefined ? {} : { prompt: draft.prompt }),
                  ...(this.frozenCreateOffer?.offerId === undefined ? {} : { offerId: this.frozenCreateOffer.offerId }),
                },
              }
            : { openAfter: draft.openAfter as Exclude<WorktreeOpenAfter, "agent"> }),
          ...(draft.branchMode === "detached"
            ? { detach: true, ...(baseRef.length > 0 ? { baseRef } : {}) }
            : draft.branchMode === "new"
              ? { branch, ...(baseRef.length > 0 ? { baseRef } : {}) }
              : { branch }),
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
      onRequestSubagents: (row) => {
        if (row.entryId !== undefined) {
          this.deps.postMessage({ type: "requestWorktreeSubagents", rowId: row.rowId, entryId: row.entryId });
        }
      },
      // Ids only — the host resolves them against its own tree and presence, so
      // a path or session the view guessed can never reach an action (D2).
      onActivateAgent: (row, activation) => {
        if (activation === "focus") {
          if (row.paneId !== undefined) {
            this.deps.postMessage({ type: "worktreeFocusPane", rowId: row.rowId, paneId: row.paneId });
          }
          return;
        }
        if (row.entryId !== undefined) {
          this.deps.postMessage({ type: "worktreeOpenPreview", rowId: row.rowId, entryId: row.entryId });
        }
      },
      // A subagent has no pane of its own, so its activation is the PARENT's —
      // sending the user anywhere else would be a dead click (design.md D9).
      onActivateSubagent: (_subagent, parent) => {
        if (parent.paneId !== undefined) {
          this.deps.postMessage({ type: "worktreeFocusPane", rowId: parent.rowId, paneId: parent.paneId });
        }
      },
      // A getter, not a value: the setting is live, and re-reading it at the
      // click is what lets an update reach a view already painted.
      rowActivation: () => this.rowActivation,
      workbench: () => this.workbench,
      // Forwarded, not mirrored: the view owns the selection because the view is
      // what marks it, and a second copy here is a second thing to keep right.
      onSelectWorktree: (worktreeId) => this.deps.onSelectWorktree?.(worktreeId),
      now: deps.now,
    });
    this.element = this.view.element;
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
    this.openCreateForRepo(repo.repoId);
  }

  /**
   * Ask where a create would go, then open the form on the answer. With a
   * repository, that one; without, every repository in the tree — a door that
   * names none must offer them all rather than pick one for the user.
   */
  openCreateForRepo(repoId?: string): void {
    // EVERY door asks every repository. The picker is built from the answers the
    // seed holds, so a door that asked about one would offer one — and the doors
    // are required to differ only in which repository the form opens ON.
    const targets = (this.tree?.repos ?? []).map((r) => r.repoId);
    if (targets.length === 0 || (repoId !== undefined && !targets.includes(repoId))) {
      return;
    }
    this.pendingCreate = {
      // Kept so a create that cannot open can name what it was waiting on: the
      // outstanding set is empty by the time that is known.
      asked: [...targets],
      outstanding: new Set(targets),
      ...(repoId === undefined ? {} : { initialRepoId: repoId }),
    };
    for (const target of targets) {
      this.deps.postMessage({ type: "requestWorktreeCreateDefaults", repoId: target });
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
      });
    }
    return repos;
  }

  /** The host's create destination for one repo, and the form it was asked for. */
  handleCreateDefaults(msg: WorktreeCreateDefaultsMessage): void {
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
    const result = this.rescope(toActionResult(msg));
    this.actionResults = [
      ...this.actionResults.filter(
        (r) => !(r.action === result.action && r.worktreeId === result.worktreeId && r.repoId === result.repoId),
      ),
      result,
    ];
    this.push();
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

  /** The rollout flag moved after `init`. */
  setWorkbench(enabled: boolean): void {
    if (this.workbench === enabled) {
      return;
    }
    this.workbench = enabled;
    // Unlike `rowActivation`, this one changes what is DRAWN — the card marks
    // selection only while it is on. Nothing in the data moved, so the push
    // guard would skip the render that has to happen.
    this.view.refresh();
  }

  /** Whether the workbench composition is on for this surface. */
  isWorkbenchEnabled(): boolean {
    return this.workbench;
  }

  /** The worktree the panel has selected, or `null` for none. */
  selectedWorktree(): string | null {
    return this.view.selectedWorktree();
  }

  /** Drop the panel's selection — the tab bar's chip clearing its own scope. */
  clearSelection(): void {
    this.view.clearSelection();
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
    const worktreeId = result.worktreeId;
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
      return result;
    }
    const { worktreeId: _gone, ...rest } = result;
    return { ...rest, orphanedLabel: result.orphanedLabel ?? this.departed.get(worktreeId) ?? worktreeId };
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
        needsConfirm: { ...msg.result.blocker, fingerprint: msg.result.fingerprint ?? "" },
      };
    default:
      return { action: msg.verb, ...scope, outcome: "error", error: msg.result.message };
  }
}
