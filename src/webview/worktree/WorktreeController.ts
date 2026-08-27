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
  WorktreeTreeResponseMessage,
} from "../../types/messages";
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
  init: { workspaceRoot: string | null; rowActivation: WorktreeRowActivation };
  /**
   * Open the session-preview overlay for a host-resolved entry. Returns false
   * when this surface holds no such entry — the host resolved against presence,
   * which can name a session this webview's own list does not have.
   */
  showPreview?(entryId: string): boolean;
  /** Activate a pane this surface holds. False when it holds no such pane. */
  activatePane?(paneId: string): boolean;
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
  private visible = false;
  private tree: WorktreeTree | null = null;
  private presence: WorktreePresence | null = null;
  private loading: boolean;
  private refreshing = false;
  private rowActivation: WorktreeRowActivation;
  /** The host's resolved create destination, per repo. Only it can know one. */
  private readonly createDefaults = new Map<string, WorktreeCreateDefaultsMessage>();
  /** The repo a create was invoked for, waiting on its defaults. */
  private pendingCreate: string | null = null;
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
  /** Which worktree the open launch dialog is for. */
  private launchTarget: string | null = null;
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
        if (this.launchTarget === null) {
          return;
        }
        deps.postMessage({ type: "worktreeLaunchAgent", worktreeId: this.launchTarget, ...request });
        this.launchTarget = null;
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
    if (visible === this.visible) {
      return;
    }
    this.visible = visible;
    this.deps.postMessage({ type: "worktreeViewVisibility", visible });
    if (visible) {
      this.deps.postMessage({ type: "requestWorktreeTree" });
      // Asked on the way in rather than once at mount: which agents resolve is a
      // property of the machine, and one installed since the last look should
      // appear without reloading the window.
      this.deps.postMessage({ type: "requestVaultLaunchTargets", capability: "start" });
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
    if (!this.visible || this.refreshing) {
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
    this.pendingCreate = repo.repoId;
    this.deps.postMessage({ type: "requestWorktreeCreateDefaults", repoId: repo.repoId });
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
    this.launchTarget = info.id;
    this.view.openLaunchDialog(info.branch ?? info.displayPath, this.launchAgents);
  }

  /** Resume a row's session in the worktree that row is published under. */
  private resumeHere(row: WorktreeAgentRow): void {
    const worktreeId = this.worktreeIdOf(row);
    if (row.entryId === undefined || worktreeId === undefined) {
      return;
    }
    this.deps.postMessage({
      type: "worktreeResumeHere",
      worktreeId,
      rowId: row.rowId,
      entryId: row.entryId,
    });
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
    if (this.pendingCreate !== msg.repoId) {
      // Not the answer that opens a form — it answers a branch the OPEN form
      // asked about, so it goes straight into that form.
      const seed = this.createRepos().find((r) => r.repoId === msg.repoId);
      if (seed !== undefined) {
        this.applyCreateDefaults?.(seed);
      }
      return;
    }
    this.pendingCreate = null;
    this.view.openCreateDialog(msg.repoId);
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
    this.loading = false;
    this.refreshing = false;
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
