import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { AgentHookController } from "./agentHooks/AgentHookController";
import { createAgentHookRuntime } from "./agentHooks/AgentHookRuntime";
import { claudeAgentRegistration } from "./agentHooks/agents/claude";
import { cursorAgentRegistration } from "./agentHooks/agents/cursor";
import { opencodeAgentRegistration } from "./agentHooks/agents/opencode";
import { withHookEnvironment } from "./agentHooks/hookEnvironment";
import {
  AGENT_HOOK_SETTINGS,
  AGENT_HOOK_UNINSTALL_COMMAND,
  AgentHookLifecycle,
  summarizeAgentHookRemoval,
} from "./agentHooks/install/agentHookLifecycle";
import { ClaudeHookInstaller } from "./agentHooks/install/ClaudeHookInstaller";
import { installOpenCodePlugin } from "./agentHooks/opencodeConfigDir";
import { ReportedSessions } from "./agentHooks/reportedSessions";
import { exportBuffer, exportCommand, exportLastCommand, NO_FOCUS_TOAST } from "./commands/exportCommands";
import { CursorHookInstaller } from "./cursor/CursorHookInstaller";
import { createWatcherPool } from "./providers/fsWatcherPool";
import { createGitDecorationProvider } from "./providers/gitDecorationProvider";
import { resolveRenameTargetTabId } from "./providers/resolveRenameTarget";
import { TerminalEditorProvider } from "./providers/TerminalEditorProvider";
import { TerminalPanelSerializer } from "./providers/TerminalPanelSerializer";
import { TerminalViewProvider } from "./providers/TerminalViewProvider";
import { VaultWatchCoordinator } from "./providers/VaultWatchCoordinator";
import { createWorktreeHost, type WorktreeActions } from "./providers/WorktreeHost";
import { loadNodePty } from "./pty/PtyManager";
import type { MessageSender } from "./session/OutputBuffer";
import { createPaneEvidenceStore } from "./session/PaneEvidenceStore";
import { SessionManager } from "./session/SessionManager";
import { SessionStorage } from "./session/SessionStorage";
import {
  affectsSessionRestoreEnabled,
  affectsTerminalConfig,
  readSessionRestoreEnabled,
  readTerminalConfig,
  readTerminalSettings,
  readWorktreeCreateRoot,
} from "./settings/SettingsReader";
import { PtyLoadError } from "./types/errors";
import type {
  ExtensionToWebViewMessage,
  ProvisionResultContest,
  WorktreeMutationResultMessage,
  WorktreeRemoveAssessmentPayload,
} from "./types/messages";
import { authorizeDirectory, directoryStillAuthorized } from "./utils/authorizedDirectory";
import { isPathInside } from "./utils/pathBoundary";
import { createTrackedPathResolver, ResolvedPathMemo } from "./utils/resolvedPathMemo";
import { escapePathForShell } from "./utils/shellEscape";
import { MAX_DETAIL_LIMIT } from "./vault/readers/detail";
import { listClaudeSessionRecords } from "./vault/readers/runningSessions";
import { detectLaunchTargets } from "./vault/registry";
import { disposeSnapshotPool } from "./vault/sqlite";
import { formatEntryId, VAULT_AGENT_IDS } from "./vault/types";
import { VaultCacheStore } from "./vault/VaultCacheStore";
import { VaultCustomNameRegistry } from "./vault/VaultCustomNameRegistry";
import { VaultLauncher } from "./vault/VaultLauncher";
import { VaultService } from "./vault/VaultService";
import { afterDelay } from "./worktree/deadline";
import { rosterFromDetail } from "./worktree/delegations";
import { deleteBranch as runDeleteBranch } from "./worktree/deleteBranch";
import { createGitCommandRunner } from "./worktree/gitCommandRunner";
import { addToGitExclude } from "./worktree/gitExclude";
import { diskIgnoredDeps, measureIgnoredMaterial } from "./worktree/ignoredMaterial";
import { probeMigrationSource } from "./worktree/migrateChanges";
import { normalizeWorktreePath } from "./worktree/normalizePath";
import { readOrphanProofs } from "./worktree/orphanProofs";
import { createPresenceProjectorDeps } from "./worktree/presenceDeps";
import { createPresenceProjector } from "./worktree/presenceProjector";
import type { DelegationRoster } from "./worktree/presenceTypes";
import { nodeApplyFsDeps } from "./worktree/provisioning/applyEntries";
import { applyProvisioning, failEveryEntry } from "./worktree/provisioning/applyProvisioning";
import { prepareEntryGate } from "./worktree/provisioning/entryGate";
import { createProvisioningDeps } from "./worktree/provisioning/provisioningDeps";
import { readProvisioning } from "./worktree/provisioning/readProvisioning";
import { writeNativeConfig } from "./worktree/provisioning/writeNativeConfig";
import { probeReattach, type ReattachVerdict, readGitLink } from "./worktree/reattachProbe";
import { branchDeleteOfferFor, checksFor } from "./worktree/removalChecks";
import { readPullRequests } from "./worktree/repoPullRequests";
import { readRepoRefs } from "./worktree/repoRefs";
import { createSessionPreviewService } from "./worktree/sessionPreviewService";
import { composeSessionViews } from "./worktree/sessionViews";
import { listRepoWorktrees } from "./worktree/WorktreeDiscovery";
import type { RemovalAssessment } from "./worktree/worktreeBlockers";
import { createWorktreeTreeDeps } from "./worktree/worktreeDeps";
import { readWorktreeGitDir } from "./worktree/worktreeGitDir";
import {
  createWorktreeMutationService,
  existenceFromStatError,
  type MutationOutcome,
} from "./worktree/worktreeMutationService";
import { worktreeHeadOid } from "./worktree/worktreeMutations";
import { allocateWorktreePorts, previewWorktreePorts } from "./worktree/worktreePorts";

/**
 * What the worktree panel's read-only actions need from the world, injected so
 * the resolution above them can be tested without a window.
 *
 * Every path and id here has ALREADY been resolved by the host against its own
 * tree and presence — nothing in this seam looks anything up, and nothing here
 * may be handed a value the webview supplied.
 *
 * See: asimov/changes/wire-worktree-navigation-actions/design.md D2, D4.
 */
export interface WorktreeActionDeps {
  executeCommand(command: string, ...args: unknown[]): Thenable<unknown>;
  writeClipboard(text: string): Thenable<void>;
  fileUri(path: string): unknown;
  workspaceFolderCount(): number;
  addWorkspaceFolder(at: number, uri: unknown): void;
  /** The editor panel with this view id, if the id names one at all. */
  editorForView(viewId: string): { reveal(): void; post(msg: ExtensionToWebViewMessage): void } | undefined;
  /** Post to the sidebar or bottom-panel view with this id. */
  postToView(viewId: string, msg: ExtensionToWebViewMessage): void;
  resumeCommand(entryId: string): Promise<string>;
  /** The working directory the vault recorded for a session, if it has one. */
  sessionCwd(entryId: string): Promise<string | undefined>;
}

/**
 * The panel's read-only capabilities.
 *
 * Opening a terminal is deliberately absent: creating a pane needs a view id and
 * a webview, which only the provider owning the surface holds, so that one
 * capability lives on `WorktreeSurface` instead (D2).
 */
export function createWorktreeActions(deps: WorktreeActionDeps): WorktreeActions {
  /** Reveal the surface that HOLDS a pane, then activate the pane inside it. */
  async function focusPane(paneId: string, viewId: string): Promise<void> {
    const activate: ExtensionToWebViewMessage = { type: "worktreeActivatePane", paneId };
    // An editor panel is revealed through its own panel object; a view is
    // revealed by its focus command. Revealing the surface that ASKED would
    // focus a pane the user cannot see whenever the panel is open twice (D4).
    const editor = deps.editorForView(viewId);
    if (editor) {
      editor.reveal();
      editor.post(activate);
      return;
    }
    if (viewId.startsWith("editor-")) {
      // An editor view id whose panel is gone: there is nothing to reveal, and
      // the sidebar is not a substitute for it.
      return;
    }
    await deps.executeCommand(
      viewId === TerminalViewProvider.panelViewType ? "anywhereTerminal.panel.focus" : "anywhereTerminal.sidebar.focus",
    );
    deps.postToView(viewId, activate);
  }

  return {
    openFolder: async (path, mode) => {
      if (mode === "newWindow") {
        await deps.executeCommand("vscode.openFolder", deps.fileUri(path), { forceNewWindow: true });
        return;
      }
      // Appended, never replacing: adding a worktree to the workspace must not
      // remove the folders the user already had open.
      deps.addWorkspaceFolder(deps.workspaceFolderCount(), deps.fileUri(path));
    },
    revealInOS: async (path) => {
      await deps.executeCommand("revealFileInOS", deps.fileUri(path));
    },
    copyText: async (text) => {
      await deps.writeClipboard(text);
    },
    focusPane,
    copyResumeCommand: async (entryId) => {
      // Built through the launcher, so a copy cannot hand out a command the
      // launcher itself would refuse to run.
      await deps.writeClipboard(await deps.resumeCommand(entryId));
    },
    revealSessionCwd: async (entryId) => {
      const cwd = await deps.sessionCwd(entryId);
      if (cwd !== undefined) {
        await deps.executeCommand("revealFileInOS", deps.fileUri(cwd));
      }
    },
    copySessionCwd: async (entryId) => {
      const cwd = await deps.sessionCwd(entryId);
      if (cwd !== undefined) {
        await deps.writeClipboard(cwd);
      }
    },
  };
}

/**
 * The worktree host's delegation reader, backed by the vault.
 *
 * Asks for `MAX_DETAIL_LIMIT` rather than a page: the roster's incompleteness
 * claim rests on there being no larger limit left to ask for, so a smaller
 * bound here would make a truncated read report omission that a second, wider
 * read could have recovered (design.md D5, D6).
 *
 * A null detail is a read that did not produce a transcript, which is a failure
 * to report — never a session that delegated nothing.
 */
export function createDelegationReader(
  vault: Pick<VaultService, "getDetail">,
): (entryId: string) => Promise<DelegationRoster> {
  return async (entryId: string) => {
    const detail = await vault.getDetail(entryId, MAX_DETAIL_LIMIT);
    return detail === null
      ? { kind: "failed", reason: "this session's transcript could not be read" }
      : rosterFromDetail(detail);
  };
}

/** One outcome, as the union member the webview can actually route (D17). */
/**
 * The assessment as the panel renders it. A refusal and a confirmable set are
 * the same shape here on purpose: the panel decides what to offer from the
 * fields, and a refusal is exactly a set whose refusing fields are non-zero.
 */
function toAssessmentPayload(
  assessment: Exclude<RemovalAssessment, { kind: "unavailable" }>,
): WorktreeRemoveAssessmentPayload {
  const branchDelete = branchDeleteOfferFor(assessment);
  return {
    checks: checksFor(assessment),
    contained: assessment.kind === "refused" ? assessment.containsWorktrees : [],
    ...(branchDelete === undefined ? {} : { branchDelete }),
  };
}

function toResultMessage(outcome: MutationOutcome): WorktreeMutationResultMessage {
  const head = {
    type: "worktreeMutationResult" as const,
    verb: outcome.verb,
    repoId: outcome.repoId,
    ...(outcome.kind === "blocked" ? {} : { worktreeId: outcome.worktreeId }),
  };
  switch (outcome.kind) {
    case "ok":
      return {
        ...head,
        result: {
          kind: "ok",
          ...(outcome.openFailed === undefined ? {} : { openFailed: outcome.openFailed }),
          // The optional branch outcome rides beside `openFailed` rather than
          // dropping it — a refused branch delete is not the removal failing.
          ...(outcome.branchDelete === undefined ? {} : { branchDelete: outcome.branchDelete }),
        },
      };
    case "indeterminate":
      return { ...head, result: { kind: "indeterminate", observed: outcome.observed } };
    case "unavailable":
      return { ...head, result: { kind: "unavailable", unreadable: outcome.unreadable } };
    case "blocked":
      return {
        ...head,
        verb: "remove",
        result: {
          kind: "blocked",
          worktreeId: outcome.worktreeId,
          fingerprint: outcome.fingerprint,
          assessment: toAssessmentPayload(outcome.assessment),
        },
      };
    default:
      return { ...head, result: { kind: "error", message: outcome.message } };
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Validate node-pty availability early — show user-facing error if missing
  try {
    loadNodePty();
  } catch (err) {
    if (err instanceof PtyLoadError) {
      vscode.window.showErrorMessage(
        `AnyWhere Terminal: Failed to load node-pty. Requires VS Code >= 1.109.0. ${err.message}`,
      );
    } else {
      console.error("[AnyWhere Terminal] Unexpected error loading node-pty:", err);
    }
    // Continue activation — individual createSession calls will fail gracefully
  }
  // Cross-restart session-restore wiring. See: restore-terminal-sessions design.md D4–D7, D11.
  //
  // No-workspace windows: `context.storageUri` is undefined when no folder is
  // open. Falling back to `globalStorageUri` would leak snapshots between
  // otherwise-unrelated no-folder windows (next window's hydrate scans the
  // shared global directory). Disable persistence entirely for this window
  // instead — the user can re-enable by opening a folder. See round-1 W7.
  const hasWorkspaceStorage = context.storageUri !== undefined;
  const restoreEnabled = hasWorkspaceStorage && readSessionRestoreEnabled();
  if (!hasWorkspaceStorage && readSessionRestoreEnabled()) {
    console.warn(
      "[AnyWhere Terminal] sessionRestore disabled for this window — no workspace folder open. Open a folder to enable persistence.",
    );
  }
  const restoreStorageUri = context.storageUri ?? context.globalStorageUri;
  const sessionStorage = new SessionStorage(context.workspaceState, restoreStorageUri, fs);

  // Shell-integration injector context — wires the vendored MIT scripts into
  // every freshly-spawned PTY. See:
  //   asimov/changes/export-terminal-session/design.md D3
  //   resources/shell-integration/  (vendored from microsoft/vscode@1.95.3)
  const shellIntegrationContext = {
    scriptsDir: path.join(context.extensionPath, "resources", "shell-integration"),
    tmpRoot: os.tmpdir(),
    generateId: () => crypto.randomUUID(),
    fs: {
      mkdirSync: fs.mkdirSync as (target: string, options: { recursive?: boolean; mode?: number }) => void,
      copyFileSync: fs.copyFileSync,
      rmSync: fs.rmSync,
    },
  };

  // Pane evidence — one store per window, written by the session lifecycle, the
  // output flush, the Cursor hook, and the three webview surfaces, and read by
  // the presence projection below.
  //
  // The forwarder exists because the store is built before the host that
  // subscribes to it: sessions must be able to record evidence from the moment
  // they exist, and the host needs a built tree to attribute panes to.
  // See: asimov/changes/add-host-pane-evidence/design.md D1.
  let onPaneEvidenceChange: (() => void) | undefined;
  const paneEvidence = createPaneEvidenceStore({ onChange: () => onPaneEvidenceChange?.() });

  // Create shared SessionManager (singleton). workspaceState backs the per-workspace
  // custom-tab-name persistence (anywhereTerminal.tabCustomNames); see design.md D3 of add-tab-rename.
  const sessionManager = new SessionManager(context.workspaceState, {
    restoreEnabled,
    storage: sessionStorage,
    shellIntegrationContext,
    paneEvidence,
  });

  // Hydrate restore state BEFORE registering any view provider so the
  // sidebar/panel/editor onReady branches see populated pending snapshots.
  // Live panels MUST hydrate first — the snapshot orphan-recovery fallback
  // uses the live-panels lookup to map an unindexed buffer file back to its
  // owning editor panel rather than defaulting to sidebar. See round-1 W2.
  if (restoreEnabled) {
    // One-time migration: copy legacy Memento snapshot index → sidecar so
    // upgraded users keep their restore on the first activate post-upgrade.
    // Idempotent no-op if the sidecar already exists. See design.md D17.
    sessionStorage.migrateMementoIndexToSidecar();
    sessionManager.hydrateLivePanels(sessionStorage.loadLivePanels());
    // Hydrate reads its own typed index via loadIndexDetailed so it can
    // distinguish "missing" (orphan recovery OK) from "unsupported"
    // (discard entire restore set). The sidecar is the single source of
    // truth (D17) — no Memento fallback.
    sessionManager.hydrateFromSnapshots();
  } else {
    // Setting disabled — purge any leftover persistence from a prior session.
    void sessionStorage.purge();
  }

  // Allow late deactivate() to find this singleton without re-routing.
  _activeSessionManager = sessionManager;

  // Per-agent hook authority is granted only after the current destination
  // reconciles. Claude resolves its settings path inside every install/remove,
  // so a location change never reaches backward to an old destination.
  const readAgentHookEnabled = (agent: "cursor" | "claude" | "opencode"): boolean =>
    vscode.workspace.getConfiguration().get<boolean>(AGENT_HOOK_SETTINGS[agent].enabled) === true;
  const cursorInstaller = new CursorHookInstaller({
    configPath: path.join(os.homedir(), ".cursor", "hooks.json"),
    storagePath: path.join(context.globalStorageUri.fsPath, "cursor-hooks"),
  });
  const claudeInstaller = {
    install: () =>
      new ClaudeHookInstaller({
        configuredDirectory: () =>
          vscode.workspace.getConfiguration("anywhereTerminal").get<string>("agentHooks.claudeConfigDir"),
      }).install(),
    uninstall: () =>
      new ClaudeHookInstaller({
        configuredDirectory: () =>
          vscode.workspace.getConfiguration("anywhereTerminal").get<string>("agentHooks.claudeConfigDir"),
      }).uninstall(),
  };
  const reportedSessions = new ReportedSessions();
  let opencodeEnvironment: Record<string, string> = {};
  const opencodeInstaller = {
    install: async () => {
      opencodeEnvironment = await installOpenCodePlugin({ storagePath: context.globalStorageUri.fsPath });
      return { installed: true };
    },
    uninstall: async () => {
      opencodeEnvironment = {};
      reportedSessions.clear();
      onPaneEvidenceChange?.();
      return { removed: true };
    },
  };
  const agentHookController = new AgentHookController({
    agents: [
      { agent: "cursor", initialEnabled: readAgentHookEnabled("cursor"), installer: cursorInstaller },
      { agent: "claude", initialEnabled: readAgentHookEnabled("claude"), installer: claudeInstaller },
      { agent: "opencode", initialEnabled: readAgentHookEnabled("opencode"), installer: opencodeInstaller },
    ],
    createRuntime: () =>
      createAgentHookRuntime(
        [cursorAgentRegistration(), claudeAgentRegistration(), opencodeAgentRegistration()],
        {},
        {
          onStatus: (update) => {
            if (update.agent === "opencode") {
              if (typeof update.state === "string") {
                reportedSessions.record({
                  terminalId: update.sessionId,
                  agent: "opencode",
                  sessionId: update.state,
                });
              } else if (update.state === null) {
                reportedSessions.release(update.sessionId);
              }
              // A report changes identity and title without changing pane facts.
              onPaneEvidenceChange?.();
              return;
            }
            // A structured turn goes to the pane's evidence, which is what the
            // presence projection reads. It never reaches the webview status
            // contract below — that one carries Cursor's two words only.
            if (typeof update.state === "object" && update.state !== null) {
              paneEvidence.reportTurn(update.sessionId, update.state);
              return;
            }
            // A revoked Claude source stops deciding activity immediately; its
            // validated identity remains in PaneEvidenceStore.
            if (update.state === null && update.agent === "claude") {
              paneEvidence.expireTurn(update.sessionId);
              return;
            }
            if (update.agent !== "cursor") {
              return;
            }
            const session = sessionManager.getSession(update.sessionId);
            if (session?.state !== "live") {
              return;
            }
            // Read at the source rather than round-tripping through the
            // webview: the host already has this, and the surface that would
            // echo it back sees only its own panes.
            const semantic = update.state === "working" || update.state === "idle" ? update.state : null;
            paneEvidence.setSemantic(update.sessionId, semantic);
            safePostMessage(session.webview, {
              type: "agentActivityStatus",
              tabId: update.sessionId,
              agent: update.agent,
              state: semantic,
            });
          },
          onReasonCode: (reason, sessionSuffix) => {
            console.warn(`[AnyWhere Terminal] Agent hook ${reason}${sessionSuffix ? ` (…${sessionSuffix})` : ""}`);
          },
        },
      ),
    setContributor: (contributor) =>
      sessionManager.setAgentHookContributor(
        contributor === undefined ? undefined : withHookEnvironment(contributor, () => opencodeEnvironment),
      ),
    onWarning: (agent, operation, reason) => {
      if (operation === "runtime") {
        console.warn(
          `[AnyWhere Terminal] Agent hook runtime unavailable — continuing without hook observability: ${reason}`,
        );
        return;
      }
      console.warn(`[AnyWhere Terminal] ${agent} hook ${operation} reconciliation failed: ${reason}`);
    },
  });
  _activeAgentHookController = agentHookController;

  const agentHookLifecycle = new AgentHookLifecycle({
    controller: agentHookController,
    readEnabled: readAgentHookEnabled,
  });

  // Register before runtime binding awaits so settings events use the same
  // bounded per-agent queue and reread their values when their body starts.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      void agentHookLifecycle.handleConfigurationChange((key) => event.affectsConfiguration(key));
    }),
    vscode.commands.registerCommand(AGENT_HOOK_UNINSTALL_COMMAND, async () => {
      const summary = summarizeAgentHookRemoval(await agentHookLifecycle.removeAll());
      if (summary.success) {
        void vscode.window.showInformationMessage(summary.message);
      } else {
        void vscode.window.showWarningMessage(summary.message);
      }
    }),
  );
  await agentHookController.start();

  // Shared GitDecorationProvider — one singleton, threaded through every
  // FileTreeHost so the three webviews (sidebar / panel / editor) see one
  // consistent revision sequence. See: add-file-tree-git-decorations design.md D8, D10.
  // One window, one set of resolutions, shared by every site that decides which
  // worktree, repository or root a path belongs to. Each site wraps it in its
  // own tracker, because what counts as "this set changed" differs per site —
  // but they must never disagree about where a directory is (design.md D1, D5).
  const pathMemo = new ResolvedPathMemo();

  const gitDecorationProvider = createGitDecorationProvider({ paths: createTrackedPathResolver(pathMemo) });
  context.subscriptions.push(gitDecorationProvider);

  // Shared FS WatcherPool — singleton, refcounted across every FileTreeHost
  // so we never spawn more than one `vscode.FileSystemWatcher` per directory
  // regardless of how many webviews (sidebar / panel / editor) have it open.
  // See: add-file-tree-fs-watcher design.md D1.
  const fsWatcherPool = createWatcherPool();
  context.subscriptions.push(fsWatcherPool);

  // AI coding vault — reads the user's existing CLI-agent session stores and
  // resumes/forks them. Backed by a persistent list cache under globalStorageUri
  // so the panel displays instantly on open, then refreshes only changed sources
  // (cache-vault-load D1/D2). The cache is machine-global (agent stores are not
  // workspace-scoped), so it uses `globalStorageUri`, not the workspace storageUri.
  // Shared across the sidebar + panel providers.
  const vaultCacheStore = new VaultCacheStore(context.globalStorageUri, fs);
  vaultCacheStore.cleanupOrphanTemps(); // reap temp files orphaned by a prior crash
  // User custom names for vault sessions (enhance-vault-sessions D1). Machine-global,
  // like the cache, and applied as a serve-time overlay — it NEVER writes agent files.
  const vaultCustomNames = new VaultCustomNameRegistry(context.globalState);
  const vaultService = new VaultService({ cacheStore: vaultCacheStore, customNames: vaultCustomNames });

  // Worktree tree — one host per window, shared by the sidebar / panel / editor
  // surfaces so freshness costs one set of git calls and watchers regardless of
  // how many surfaces show it. See: cache-and-broadcast-worktree-tree design.md D1.
  // Constructed before the host, which needs it for the resume-command capability.
  const vaultLauncher = new VaultLauncher(vaultService);

  const worktreeActions = createWorktreeActions({
    executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
    writeClipboard: (text) => vscode.env.clipboard.writeText(text),
    fileUri: (path) => vscode.Uri.file(path),
    workspaceFolderCount: () => (vscode.workspace.workspaceFolders ?? []).length,
    addWorkspaceFolder: (at, uri) => vscode.workspace.updateWorkspaceFolders(at, null, { uri: uri as vscode.Uri }),
    editorForView: (viewId) => {
      const provider = TerminalEditorProvider.findByViewId(viewId);
      if (!provider) {
        return undefined;
      }
      return {
        reveal: () => provider.panel.reveal(provider.panel.viewColumn, false),
        post: (msg) => void provider.panel.webview.postMessage(msg),
      };
    },
    postToView: (viewId, msg) => {
      const provider = viewId === TerminalViewProvider.panelViewType ? panelProvider : sidebarProvider;
      const view = provider?.view;
      if (view) {
        void view.webview.postMessage(msg);
      }
    },
    resumeCommand: (entryId) => vaultLauncher.buildResumeCommand(entryId),
    sessionCwd: async (entryId) => (await vaultService.getEntry(entryId))?.cwd,
  });

  /**
   * The five mutating capabilities, built on first use.
   *
   * Lazy because the service reads `worktreeHost.mutationBindings()` and the
   * host is what these capabilities are passed INTO — a value here would be a
   * use-before-declaration. Nothing calls it until a message arrives, which is
   * long after construction. Round-1 B1 was that this assembly did not exist at
   * all, so the host declared five optional capabilities and production
   * supplied none of them.
   */
  /**
   * Each apply's contest membership, waiting for the message that reports it.
   *
   * The mutation service's `applyProvision` answers with steps alone, and that
   * contract is not this change's to move. A step carries the INDEX of its
   * contest, so the membership travels here — written by the apply, read once
   * by the message assembly below, and deleted, so nothing accumulates across
   * creates.
   */
  const provisionContests = new Map<string, readonly ProvisionResultContest[]>();
  /** Read once and forgotten — a create that never reports leaves nothing behind. */
  const takeContests = (worktreePath: string): { contests?: readonly ProvisionResultContest[] } => {
    const contests = provisionContests.get(worktreePath);
    provisionContests.delete(worktreePath);
    return contests === undefined ? {} : { contests };
  };
  let worktreeMutations: ReturnType<typeof createWorktreeMutationService> | undefined;
  function mutations(): ReturnType<typeof createWorktreeMutationService> {
    if (worktreeMutations === undefined) {
      const bindings = worktreeHost.mutationBindings();
      worktreeMutations = createWorktreeMutationService({
        authorizeDirectory,
        // Sequential, and every entry answers. `applyProvisioning` never
        // throws, so a rejection here would be a bug rather than a bad entry —
        // the call site catches one anyway, because the create has already
        // succeeded by then.
        provisionUnavailable: (worktreePath, entries, reason) => {
          const unavailable = failEveryEntry(entries, reason);
          if (unavailable.contests.length > 0) {
            provisionContests.set(worktreePath, unavailable.contests);
          }
          return unavailable.steps;
        },
        applyProvision: async (mainCheckout, worktreePath, entries, authorization) => {
          const roots = await prepareEntryGate(mainCheckout, worktreePath, authorization);
          if (roots === null) {
            // Through the same builder as the ordinary path, and staging its
            // memberships the same way: a contested declaration is in a contest
            // whether or not the apply could read the worktree, and a step with
            // no index reads as a row unrelated to the dispute beside it
            // (.reviews/round-5.md F011).
            const unread = failEveryEntry(entries, "the worktree could not be read after it was created");
            if (unread.contests.length > 0) {
              provisionContests.set(worktreePath, unread.contests);
            }
            return unread.steps;
          }
          // ONE budget for the whole apply, shared by every entry. Minting it
          // per iteration multiplied D10's bound by the entry count — against
          // the provider's own row cap that is hours of wall clock and a
          // hundred gigabytes, all of it holding the mutation queue that every
          // removal for this repository is waiting in (round-1 F007).
          const budget = {
            maxNodes: 20_000,
            maxBytes: 512 * 1024 * 1024,
            deadline: afterDelay(60_000),
          };
          try {
            const applied = await applyProvisioning(entries, roots, budget, nodeApplyFsDeps, {
              directoryStillAuthorized,
            });
            if (applied.contests.length > 0) {
              provisionContests.set(worktreePath, applied.contests);
            }
            return applied.steps;
          } finally {
            budget.deadline.cancel();
          }
        },
        applyPorts: (input) =>
          allocateWorktreePorts(input, {
            listWorktrees: async (repoPath, options) => {
              const listing = await listRepoWorktrees(repoPath, worktreeTreeDeps, options);
              const worktrees = await Promise.all(
                listing.worktrees.map(async (worktree) => {
                  const authorization = await authorizeDirectory(worktree.id, {}, options.authorizationBudget);
                  if (authorization === undefined) {
                    throw new Error(`could not authorize listed worktree: ${worktree.id}`);
                  }
                  return { id: worktree.id, path: worktree.displayPath, authorization };
                }),
              );
              return {
                worktrees,
                reasons: listing.reasons,
                skipped: listing.skipped,
                ...(listing.degraded === undefined ? {} : { degraded: listing.degraded }),
              };
            },
          }),
        // The SAME call the tree's own `normalize` makes at `:648`. Spelled
        // identically on purpose: two normalizations of one path are two ids.
        normalizeWorktreeId: (raw) => normalizeWorktreePath(raw),
        runner: worktreeTreeDeps.runner,
        forceRebuild: bindings.forceRebuild,
        resolve: bindings.resolve,
        repoPath: bindings.repoPath,
        assessRemoval: bindings.assessRemoval,
        corroborateRepair,
        // The SAME listing the tree is built from — it negotiates `-z` through
        // the capability probe, so the listing that offers a repair and the one
        // that confirms it cannot parse the same path differently (round-1 W5).
        listWorktrees: async (repoPath) => {
          const listing = await listRepoWorktrees(repoPath, worktreeTreeDeps);
          return listing.degraded === undefined ? listing.worktrees : null;
        },
        observation: bindings.observation,
        observeAfter: async (target, journalledPath) => {
          // Two INDEPENDENT readings. The previous version inferred "directory
          // gone" from a null registration lookup, which is the one thing D11
          // forbids: the comparison exists precisely because registration and
          // filesystem can disagree, and deriving one from the other deletes
          // the disagreement it is meant to detect (round-2 B7).
          const observed = bindings.observation(target.repoId);
          if (observed === undefined) {
            // A listing we cannot trust is not evidence of anything. Null is
            // what `classifyRemoval` reads as indeterminate.
            return null;
          }
          // The JOURNALLED path, always — the path recorded before the spawn
          // is the only one still meaningful once the registration is gone.
          const existsOnDisk = await fsp.stat(journalledPath).then(
            () => true,
            (error: NodeJS.ErrnoException) => existenceFromStatError(error),
          );
          if (existsOnDisk === null) {
            return null;
          }
          // Round-9 B8: the stat takes real time. The registration read below
          // has to belong to the same observation the existence read was
          // authorized under, or the two halves of the comparison come from
          // different trees — and the disagreement between them is the whole
          // point of reading them separately.
          if (bindings.observation(target.repoId) !== observed) {
            return null;
          }
          return { isRegistered: bindings.resolve(target) !== null, existsOnDisk };
        },
        createContext: bindings.createContext,
        pathDeps: {
          platform: process.platform,
          lstat: (p) => fsp.lstat(p).catch(() => null),
          readdir: (p) => fsp.readdir(p).catch(() => null),
          normalize: (raw) => normalizeWorktreePath(raw),
        },
        // D8: a create under a root INSIDE the main worktree would otherwise
        // show up as an untracked directory in the parent's status.
        gitExcludeDirFor: (repoId, repoPath, createdPath) => {
          if (!isPathInside(createdPath, repoPath)) {
            return null;
          }
          // The create ROOT, not the leaf: every worktree made under it needs
          // the same entry, and one pattern per worktree grew `info/exclude`
          // without bound (round-4 B10). `addToGitExclude` is idempotent, so
          // the second create under a root writes nothing.
          const root = path.dirname(createdPath);
          // Unless the root IS the repository — excluding that hides everything.
          const dir = isPathInside(root, repoPath) ? root : createdPath;
          return { gitDir: repoId, relativePath: path.relative(repoPath, dir) };
        },
        addToGitExclude: async (gitDir, entry) => {
          // Reported, never fatal: the worktree exists either way, and failing
          // the create over a hygiene write would be the worse outcome.
          const outcome = await addToGitExclude(gitDir, entry);
          if ("failed" in outcome) {
            console.warn(`[AnyWhere Terminal] could not update info/exclude: ${outcome.failed}`);
          }
        },
        report: (outcome, origin) => {
          // The HOST delivers it — it owns attachment, and only a surface can
          // open a terminal (D17). Posting straight at two providers is what
          // missed every editor surface.
          worktreeHost.reportMutation({
            origin: origin ?? null,
            message: toResultMessage(outcome),
            ...(outcome.kind === "ok" && outcome.openTerminalAt !== undefined
              ? { openTerminalAt: outcome.openTerminalAt }
              : {}),
            // Through the SAME path, so provisioning cannot land on a surface
            // the outcome did not, and cannot arrive before it.
            ...(outcome.kind === "ok" && outcome.provision !== undefined
              ? {
                  provisionResult: {
                    type: "worktreeProvisionResult" as const,
                    worktreeId: outcome.provision.path,
                    steps: outcome.provision.steps,
                    ports: outcome.provision.ports,
                    ...(outcome.provision.portWarnings === undefined
                      ? {}
                      : { portWarnings: outcome.provision.portWarnings }),
                    ...takeContests(outcome.provision.path),
                  },
                }
              : {}),
          });
        },
        afterCreate: async (createdPath, after, origin) => {
          if (after.kind === "newWindow" || after.kind === "addToWorkspace") {
            await worktreeActions.openFolder(createdPath, after.kind);
            return;
          }
          // The same two halves the menu's launch uses — resolve the argv here,
          // open the pane on the surface that asked. Throwing is the contract:
          // the service reports it as an agent that did not start, and the
          // worktree it was created in stays.
          //
          // No "and the launch details are present" clause: they are fields of
          // this variant, so narrowing the kind is what produces them.
          if (after.kind === "agent") {
            const open = origin?.launchAgent;
            if (!open) {
              throw new Error("This view cannot start an agent.");
            }
            await open.call(
              origin,
              await vaultLauncher.startAgent(after.agent, createdPath, {
                ...(after.permissionChoiceId === undefined ? {} : { permissionChoiceId: after.permissionChoiceId }),
                ...(after.prompt === undefined ? {} : { prompt: after.prompt }),
              }),
            );
          }
          // `terminal` needs a view id and a webview, which only a surface
          // holds, and `none` is the no-op it says it is.
        },
        now: () => Date.now(),
        // The SAME shared git runner every other worktree read and write goes
        // through, and the guarded delete itself: production supplies no
        // parallel git invocation path, only this adapter from the wire shape
        // to the evidence shape `deleteBranch` verifies (design.md D2).
        deleteBranch: (repoPath, request) =>
          runDeleteBranch(worktreeTreeDeps.runner, repoPath, {
            branch: request.branch,
            branchOid: request.expectedBranchOid,
            defaultBranch: request.defaultBranch,
            defaultOid: request.expectedDefaultOid,
          }),
      });
    }
    return worktreeMutations;
  }

  // Held rather than inlined: the mutation service runs git through the SAME
  // runner discovery uses, so a capability probe or a timeout setting cannot
  // differ between reading the tree and changing it.
  const worktreeTreeDeps = createWorktreeTreeDeps({ pathMemo });

  // One owner of every preview the agent rows show — the stamp, the re-check
  // interval, the in-flight de-duplication and the bound all live behind it.
  const sessionPreviews = createSessionPreviewService({
    entry: async (entryId) => {
      // `lookupEntry`, not `getEntry`: only a PROVEN absence may retire a row's
      // preview, and `getEntry` is the view that collapses that proof back into
      // the `null` a failed reader also returns.
      const found = await vaultService.lookupEntry(entryId);
      if (found.status !== "found") {
        return found;
      }
      // `VaultSessionEntry.agent` is a bare string because it crosses IPC; the
      // service takes the union, so an unrecognised provider is answered here
      // rather than falling through its coverage check as an unknown literal.
      // `unknown` and not `absent`: an agent this build does not know is a fact
      // about this build's coverage, never proof the session was deleted.
      const agent = VAULT_AGENT_IDS.find((id) => id === found.entry.agent);
      return agent === undefined
        ? { status: "unknown" }
        : {
            status: "found",
            entry: {
              agent,
              sessionId: found.entry.sessionId,
              ...(found.entry.sessionPath ? { sessionPath: found.entry.sessionPath } : {}),
            },
          };
    },
  });

  // Constructed before the host because `removalFacts` reads it: the removal
  // assessment asks the user-wide registry a SECOND question, and needs this
  // pass's answer to which of those sessions this window already holds (D6).
  const presenceProjector = createPresenceProjector(
    createPresenceProjectorDeps({
      store: paneEvidence,
      cwdMemo: pathMemo,
      // Fallback only — the projector asks about a session the registry left
      // unnamed. A user rename outranks the derived title here for the same
      // reason it does in the vault list (enhance-vault-sessions D1).
      sessionTitle: async (entryId) => {
        const entry = await vaultService.getEntry(entryId);
        return entry?.customName || entry?.title || undefined;
      },
      // The row's second line. The service behind this owns the stamp, the
      // re-check rate and its own bound, so presence rebuilding at the 150 ms
      // cap costs no filesystem work for a session that has said nothing.
      sessionPreviews,
      reportedSession: (paneId) => {
        const report = reportedSessions.get(paneId);
        return report === undefined
          ? undefined
          : { agent: report.agent, entryId: formatEntryId(report.agent, report.sessionId) };
      },
      listSessions: async () => (await vaultService.list()).entries,
    }),
  );

  /**
   * D3's conditions 2 and 3, in one place.
   *
   * The host's offer and the mutation's re-check both call this, so the two
   * cannot drift apart about what a repairable worktree is — a second
   * hand-rolled copy of the link and HEAD reads is exactly how they would
   * (round-1 B1). Declared rather than assigned so `mutations()`, defined
   * above and called lazily, can reach it.
   */
  async function corroborateRepair({
    repoPath,
    branch,
    repairPath,
  }: {
    repoPath: string;
    branch: string;
    repairPath: string;
  }): Promise<ReattachVerdict> {
    const tip = await worktreeTreeDeps.runner.run(["rev-parse", `refs/heads/${branch}`], repoPath);
    if (tip.code !== 0 || tip.timedOut || tip.failedToSpawn) {
      // A branch whose tip we could not read is one we cannot prove this
      // directory still sits on, and an unprovable repair is not offered.
      return { kind: "declined", because: "unreadable" };
    }
    return probeReattach(
      { repairPath, branchOid: tip.stdout.toString("utf8").trim() },
      {
        readGitLink: (worktreePath) =>
          readGitLink(worktreePath, {
            lstat: (p) => fsp.lstat(p).catch(() => null),
            readFile: (p) => fsp.readFile(p, "utf8").catch(() => null),
          }),
        adminDirExists: async (gitdir) => (await fsp.stat(gitdir).catch(() => null))?.isDirectory() === true,
        headOid: (worktreePath) => worktreeHeadOid(worktreeTreeDeps.runner, worktreePath),
      },
    );
  }

  // `gh` is the forge client (design.md D1). One runner, built here, so the
  // read below is the only thing that knows the executable is not git.
  const ghRunner = createGitCommandRunner({ executable: "gh" });
  const worktreeHost = createWorktreeHost({
    deps: worktreeTreeDeps,
    probeMigrationSource: (sourcePath) =>
      probeMigrationSource(gitDecorationProvider.getApi?.(), sourcePath, {
        runner: worktreeTreeDeps.runner,
        uri: vscode.Uri.file,
      }),
    // Without this the create form never receives an offer and the whole
    // provisioning section is dark in the shipped extension — every test passed
    // because they all supplied their own (.reviews/round-1.md B1).
    readProvisioning: (mainWorktree, prefer) => readProvisioning(createProvisioningDeps(), mainWorktree, prefer),
    previewProvisioningPorts: (ports, worktreePaths) => previewWorktreePorts(ports, worktreePaths),
    // And the same reason again for the save: without this the Configure
    // control is inert in the shipped extension while every module test passes
    // against its own fake.
    writeNativeConfig: (mainWorktree, divergence) =>
      writeNativeConfig({ realpath: (p) => fsp.realpath(p), lstat: (p) => fsp.lstat(p) }, mainWorktree, divergence),
    // Same reason as the offer above: without this the create form never
    // receives a branch list and the combobox is a plain text field in the
    // shipped extension, with every module test green against its own fake.
    // The listing arrives from the host, which already holds it — this side
    // supplies only the git runner (design.md D2).
    readRefs: (input) => readRepoRefs(worktreeTreeDeps.runner, input),
    // Same reason again, and the same failure it prevents: without this the
    // combobox never offers a pull request in the shipped extension while every
    // module test stays green against its own fake. The runner is the shared
    // factory with a different executable — `gh` classifies a missing client as
    // `failedToSpawn`, which is the one unavailable state (design.md D2).
    readPullRequests: (input) => readPullRequests(ghRunner, input),
    // § 2.3's conditions 2 and 3, which are a filesystem read and a ref read.
    // Assembled here rather than in the host for the same reason `readRefs` is:
    // the host holds a listing, and neither `.git` nor `refs/heads` is one.
    probeReattach: corroborateRepair,
    // Through the mutation service, because the store it writes to is the one
    // the create redeems against (design.md D6).
    issueDebrisAuthorization: (p) => mutations().issueDebrisAuthorization(p),
    // D5 puts the base validation host-side "riding the resolution". Asked with
    // `^{commit}` so an annotated tag answers the commit it points at rather
    // than the tag object, which is what `git worktree add` would start from.
    resolveBase: async ({ repoPath, ref }) => {
      const result = await worktreeTreeDeps.runner.run(
        ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
        repoPath,
      );
      if (result.code !== 0 || result.timedOut || result.failedToSpawn) {
        return undefined;
      }
      const oid = result.stdout.toString("utf8").trim();
      return oid.length === 0 ? undefined : oid;
    },
    // The two evidence sources a removal blocker set needs and the tree does
    // not carry, from the same store and registry the projector reads.
    removalFacts: {
      // Resolved through the SAME memo the projection uses, so the panes a
      // removal warns about and the rows the tree shows under that worktree
      // are attributed by one set of facts. `prepare` first because this path
      // can run before the first projection has resolved anything.
      panes: async () => {
        // Ids, cwds AND activity are read in one synchronous pass, before the
        // resolution is awaited. Reading activity on the far side let a pane
        // that exited during the await be filtered out by `evaluateRemoval`,
        // so a terminal that was live when the set was taken could go unnamed
        // in the confirmation for an irreversible removal (round-1 B5).
        const observed = paneEvidence.panes().map((pane) => ({
          paneId: pane.paneId,
          cwd: pane.cwd,
          activity: paneEvidence.activityFor(pane.paneId),
        }));
        // Its OWN claim, for the length of this assessment. Two assessments
        // sharing one resolver release each other's paths mid-flight — the
        // second `prepare` drops the first's set before its realpath lands, the
        // superseded resolution declines to publish, and the first assessment
        // reads its panes lexically. That answer is the blocker set for an
        // irreversible destroy, so the miss is a pane nobody was warned about
        // (round-3 B8).
        const paths = createTrackedPathResolver(pathMemo);
        try {
          await paths.prepare(observed.flatMap((pane) => (pane.cwd === undefined ? [] : [pane.cwd])));
          return observed.map((pane) => ({
            ...pane,
            cwd: pane.cwd === undefined ? undefined : paths.resolvedOr(pane.cwd),
          }));
        } finally {
          paths.dispose();
        }
      },
      sessions: async () => {
        const outcome = await listClaudeSessionRecords();
        // The FAILURE is carried, not flattened to an empty list. An unreadable
        // registry is not "no external sessions", and on a forced removal that
        // difference is a session nobody was warned about (round-2 B6).
        if (outcome.kind !== "ok") {
          return { ok: false };
        }
        // One scan, two views (design.md D3). The canonical winner per session
        // id is chosen HERE, over every live record user-wide, before anything
        // asks which directory a session is rooted in — that order is what
        // `evaluateRemoval` needs and what it cannot reconstruct itself
        // (round-1 B2).
        //
        // The registry is USER-WIDE, so a Claude in one of
        // our own panes writes its own live-pid record and must be counted once
        // — but a claim is only worth applying where the SAME assessment will
        // classify the pane that made it, and this producer holds neither the
        // target nor the pane snapshot to check that against. It carries the
        // claim instead, and `evaluateRemoval` corroborates it (cycle-2 B5).
        const paths = createTrackedPathResolver(pathMemo);
        try {
          return { ok: true, value: await composeSessionViews(outcome.records, outcome.partial, paths) };
        } finally {
          paths.dispose();
        }
      },
      // The three proofs of worktree-removal.md § 4, over the runner the rest of
      // the assessment uses. The registry read is HANDED IN, not taken again:
      // the ownership proof is about the records that read returns, and a
      // second scan of the same directory could disagree with the first about
      // the same instant (design.md D3).
      proofs: (subject, sessions) =>
        readOrphanProofs(
          {
            path: subject.path,
            locked: subject.locked,
            ...(subject.branch === undefined ? {} : { branch: subject.branch }),
            // Handed UNRESOLVED. The lock and merge proofs need no registry at
            // all, and awaiting it here made them wait on one (round-1 W2).
            //
            // `notApplicable` is not a successful read of no records. It is the
            // registry saying its question did not arise, and the proof it
            // feeds must report unproven rather than "nobody is here".
            // The UNDEDUPED live records, not the canonical ones: a duplicate
            // that loses the registry's selection is still a live pid rooted in
            // that directory, and this proof asks whether any process is there.
            // `partial` travels with them — a scan that skipped a file it could
            // not read cannot prove absence (round-1 W1).
            sessions: sessions.then((read) =>
              read.ok === true ? { ok: true, value: read.value.live, partial: read.value.partial } : { ok: false },
            ),
          },
          {
            git: (args, cwd) => worktreeTreeDeps.runner.run(args, cwd),
            // `stat`, not `lstat`: git writes `locked` as a regular file, and
            // the mtime wanted is that file's own.
            lockMtime: async (absPath) => (await fsp.stat(absPath)).mtimeMs,
            // The same reader `diskIgnoredDeps` uses — git's own answer for this
            // worktree, never `<repoGitDir>/worktrees/<basename>`, which names
            // the wrong lock exactly where two worktrees share a basename.
            gitDir: (worktreePath) =>
              readWorktreeGitDir(worktreePath, (args, cwd, runOptions) =>
                worktreeTreeDeps.runner.run(args, cwd, runOptions),
              ),
            now: () => Date.now(),
          },
        ),
      // The last completed window pass's claims, keyed by the pane that made
      // each one. Published rather than recomputed: `identify()` reads the
      // process table and falls back to heuristics, so a second copy would cost
      // a real read per assessment and could differ from what the panel shows.
      claimedByPane: async () => presenceProjector.claimedSessionIds(),
      // What the removal will delete that `git status --porcelain` never names —
      // the `node_modules`, the copied `.env`, the build output this extension
      // provisions into every worktree it creates (worktree-removal.md § 2.3).
      // Bounded inside `measureIgnoredMaterial`; a walk that cannot finish
      // leaves one confirmable check unproven and refuses nothing.
      ignored: (worktreePath) =>
        measureIgnoredMaterial(
          diskIgnoredDeps({
            worktreePath,
            // `runOptions` FORWARDED. A two-parameter wrapper here silently
            // dropped the third, so every deadline the walk computed was
            // discarded at this boundary while the module's own unit test —
            // which asserts against its own injected fake — stayed green
            // (cycle-2 B4).
            run: (args, cwd, runOptions) => worktreeTreeDeps.runner.run(args, cwd, runOptions),
            // `lstat`, never `stat`: a removal deletes an ignored SYMLINK, not
            // whatever it points at, and following it sizes bytes that live
            // outside the worktree entirely (round-1 S1).
            stat: (absPath) => fsp.lstat(absPath),
            readFile: (absPath) => fsp.readFile(absPath, "utf8"),
            join: (...parts) => path.join(...parts),
          }),
        ),
    },
    workspaceFolders: () => (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
    // Read at each request rather than captured: the setting is live, and D7
    // says an explicit one outranks the layout detected from the repository.
    // It existed and was never supplied here, so the setting the spec's own
    // scenario names did nothing in production (round-3 B12).
    createRoot: () => readWorktreeCreateRoot(),
    // B12 shipped twice: the host has probed the filesystem since round 3 and
    // nothing here supplied the probe, so in production an unregistered
    // occupied directory still read as free.
    exists: (p) => fs.existsSync(p),
    pool: fsWatcherPool,
    onDidChangeWorkspaceFolders: (listener) => vscode.workspace.onDidChangeWorkspaceFolders(listener),
    // This window's panes, as agent rows under the worktree each one is inside.
    projector: presenceProjector,
    onPaneChange: (listener) => {
      onPaneEvidenceChange = listener;
      return {
        dispose: () => {
          onPaneEvidenceChange = undefined;
        },
      };
    },
    // What an expanded row's session delegated, read from the vault on demand.
    readDelegations: createDelegationReader(vaultService),
    // The panel's read-only actions. Every one receives a value the host looked
    // up; none of them takes an id (worktree-navigation design.md D2).
    actions: {
      ...worktreeActions,
      // The mutating half. Every one re-resolves its own target on the far side
      // of a forced rebuild, so none of them takes a path (round-1 B1, B2).
      createWorktree: (request) => mutations().createWorktree(request),
      // Resolution only — the surface that asked owns the pane it opens in.
      startAgent: (agent, cwd, opts) => vaultLauncher.startAgent(agent, cwd, opts),
      // The same answer the panel is given, so the host admits a launch against
      // what it published rather than against what the registry would run.
      launchTargets: () => detectLaunchTargets("start"),
      resumeSessionAt: (entryId, cwd) => vaultLauncher.resolve(entryId, "resume", undefined, undefined, cwd),
      removeWorktree: (target, fingerprint, deleteBranchRequest) =>
        mutations().removeWorktree(target, fingerprint, deleteBranchRequest),
      // The service decides the authority; this only reshapes the assessment for
      // the wire, through the SAME converter the blocked path uses — a second
      // one would let the two reports disagree about what the user was shown.
      assessRemovalReport: async (target) => {
        const report = await mutations().assessRemovalReport(target);
        if (report === null) {
          return null;
        }
        return report.kind === "unavailable"
          ? { kind: "unavailable", unreadable: report.unreadable }
          : { kind: "assessed", assessment: toAssessmentPayload(report.assessment), fingerprint: report.fingerprint };
      },
      lockWorktree: (target, reason) => mutations().lockWorktree(target, reason),
      unlockWorktree: (target) => mutations().unlockWorktree(target),
      pruneRepo: (repoId, confirmedCount, origin) => mutations().pruneRepo(repoId, confirmedCount, origin),
      // Called after every authoritative rebuild, so a worktree that vanished
      // by any route drops whatever confirmation it was holding (D15).
      reconcileFingerprints: (present) => mutations().reconcileFingerprints(present),
    },
  });
  context.subscriptions.push(worktreeHost);

  const vaultWatchCoordinator = new VaultWatchCoordinator({ watcherPool: fsWatcherPool, vaultService });
  context.subscriptions.push(vaultWatchCoordinator);

  // Sidebar view
  const sidebarProvider = new TerminalViewProvider(
    context.extensionUri,
    sessionManager,
    "sidebar",
    gitDecorationProvider,
    fsWatcherPool,
    vaultService,
    vaultLauncher,
    vaultWatchCoordinator,
    worktreeHost,
    paneEvidence,
    pathMemo,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(TerminalViewProvider.sidebarViewType, sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Panel view
  const panelProvider = new TerminalViewProvider(
    context.extensionUri,
    sessionManager,
    "panel",
    gitDecorationProvider,
    fsWatcherPool,
    vaultService,
    vaultLauncher,
    vaultWatchCoordinator,
    worktreeHost,
    paneEvidence,
    pathMemo,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(TerminalViewProvider.panelViewType, panelProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Editor terminal command — each invocation creates an independent editor tab terminal
  context.subscriptions.push(
    vscode.commands.registerCommand("anywhereTerminal.newTerminalInEditor", () => {
      const panelDisposable = TerminalEditorProvider.createPanel(
        context,
        sessionManager,
        gitDecorationProvider,
        fsWatcherPool,
        worktreeHost,
        paneEvidence,
        vaultService,
        pathMemo,
      );
      context.subscriptions.push(panelDisposable);
    }),
  );

  // WebviewPanelSerializer — revives editor terminal panels on window reload.
  // Wired AFTER SessionManager construction so consumeSnapshotsForPanel sees the
  // hydrated pending snapshots. See: restore-terminal-sessions design.md D2, D7.
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(
      TerminalEditorProvider.viewType,
      new TerminalPanelSerializer(
        context,
        sessionManager,
        gitDecorationProvider,
        fsWatcherPool,
        worktreeHost,
        paneEvidence,
        vaultService,
        pathMemo,
      ),
    ),
  );

  // ─── Provider Lookup ──────────────────────────────────────────

  // Map of view location to provider for direct lookup
  const providers = {
    sidebar: sidebarProvider,
    panel: panelProvider,
  };

  // Track which provider last received user interaction (for keybinding fallback)
  let lastFocusedProvider: TerminalViewProvider = sidebarProvider;

  sidebarProvider.onDidReceiveInteraction = () => {
    lastFocusedProvider = sidebarProvider;
  };
  panelProvider.onDidReceiveInteraction = () => {
    lastFocusedProvider = panelProvider;
  };

  // Helper: get the focused provider for keybinding context (both views may be visible).
  const getFocusedProvider = (): TerminalViewProvider => {
    if (panelProvider.view?.visible && !sidebarProvider.view?.visible) {
      return panelProvider;
    }
    if (sidebarProvider.view?.visible && !panelProvider.view?.visible) {
      return sidebarProvider;
    }
    return lastFocusedProvider;
  };

  // Helper: pick the sessionId to export. If a right-click delivered a
  // `paneSessionId` AND that session is still live, use it. Otherwise fall
  // through to the focused provider's active session — handles both the
  // Command Palette invocation (no ctx) and the stale-ctx race where the
  // user right-clicked a pane that's been closed in between. Returning
  // `undefined` lets the downstream command surface NO_FOCUS_TOAST naturally.
  // See: .reviews/round-1.md [W4].
  const resolveExportSessionId = (ctx?: { paneSessionId?: string }): string | undefined => {
    // `typeof === "string"` (not just truthy) defends against a malformed
    // right-click invocation delivering `paneSessionId` as a number / array /
    // object — the truthy chain alone would let those slip through and break
    // the downstream `sessionId: string` contract. See: .reviews/round-2.md [W4].
    if (
      ctx !== null &&
      typeof ctx === "object" &&
      typeof ctx?.paneSessionId === "string" &&
      sessionManager.getSession(ctx.paneSessionId)
    ) {
      return ctx.paneSessionId;
    }
    return getFocusedProvider().getActiveSessionId();
  };

  // Helper: assemble the dependency bag for the export commands. Resolved
  // lazily so the closure picks up the latest target sessionId at click time.
  // The caller decides whether sessionId comes from a right-click ctx
  // (`ctx.paneSessionId`) or the focused provider's active session.
  const buildExportDeps = (getSessionId: () => string | undefined, sm: SessionManager) => ({
    sessionManager: sm,
    getFocusedSessionId: getSessionId,
    getSessionName: (sessionId: string) =>
      sm.getSession(sessionId)?.customName ?? sm.getSession(sessionId)?.name ?? "terminal",
    vsc: {
      showSaveDialog: (opts: vscode.SaveDialogOptions) => vscode.window.showSaveDialog(opts),
      showQuickPick: <T extends vscode.QuickPickItem>(
        items: readonly T[] | Thenable<readonly T[]>,
        options?: vscode.QuickPickOptions,
      ) => vscode.window.showQuickPick(items as T[] | Thenable<T[]>, options),
      showInformationMessage: (message: string, ...items: string[]) =>
        vscode.window.showInformationMessage(message, ...items),
      showWarningMessage: (message: string) => vscode.window.showWarningMessage(message),
      showErrorMessage: (message: string) => vscode.window.showErrorMessage(message),
      openExternal: (uri: vscode.Uri) => vscode.env.openExternal(uri),
      fs: vscode.workspace.fs,
    },
    readmeShellIntegrationUrl: "https://github.com/huybuidac/anywhere-terminal/blob/main/README.md#shell-integration",
  });

  // ─── Action Helpers ──────────────────────────────────────────

  const doOpenVault = (provider: TerminalViewProvider): void => {
    const view = provider.view;
    if (!view) {
      return;
    }
    void view.webview.postMessage({ type: "openVault" });
  };

  const doNewTerminal = (provider: TerminalViewProvider): void => {
    const view = provider.view;
    if (!view) {
      return;
    }
    const viewId = provider.getViewId();
    const settings = readTerminalSettings();
    try {
      const newSessionId = sessionManager.createSession(viewId, view.webview, {
        shell: settings.shell,
        shellArgs: settings.shellArgs,
        cwd: settings.cwd,
      });
      const newSession = sessionManager.getSession(newSessionId);
      if (newSession) {
        safePostMessage(view.webview, {
          type: "tabCreated",
          tabId: newSessionId,
          name: newSession.name,
          customName: newSession.customName,
        });
      }
    } catch (err) {
      console.error("[AnyWhere Terminal] Failed to create terminal:", err);
      safePostMessage(view.webview, {
        type: "error",
        message: err instanceof Error ? err.message : "Failed to create new terminal",
        severity: "error",
      });
    }
  };

  const doKillTerminal = (provider: TerminalViewProvider): void => {
    const activeSessionId = provider.getActiveSessionId();
    if (!activeSessionId) {
      return;
    }
    sessionManager.destroySession(activeSessionId);
    const view = provider.view;
    if (view) {
      safePostMessage(view.webview, {
        type: "tabRemoved",
        tabId: activeSessionId,
      });
    }
  };

  const doClearTerminal = (provider: TerminalViewProvider): void => {
    const activeSessionId = provider.getActiveSessionId();
    if (!activeSessionId) {
      return;
    }
    sessionManager.clearScrollback(activeSessionId);
    const view = provider.view;
    if (view) {
      safePostMessage(view.webview, { type: "clear", tabId: activeSessionId });
    }
  };

  const doSplit = (provider: TerminalViewProvider, direction: "horizontal" | "vertical"): void => {
    const view = provider.view;
    if (!view) {
      return;
    }
    safePostMessage(view.webview, { type: "splitPane", direction });
  };

  const doCloseSplitPane = (provider: TerminalViewProvider): void => {
    const view = provider.view;
    if (!view) {
      return;
    }
    safePostMessage(view.webview, { type: "closeSplitPane" });
  };

  // ─── Generic Commands (for keybindings — use getFocusedProvider) ──────

  context.subscriptions.push(
    vscode.commands.registerCommand("anywhereTerminal.newTerminal", () => doNewTerminal(getFocusedProvider())),
    vscode.commands.registerCommand("anywhereTerminal.killTerminal", () => doKillTerminal(getFocusedProvider())),
    vscode.commands.registerCommand("anywhereTerminal.clearTerminal", () => doClearTerminal(getFocusedProvider())),
    vscode.commands.registerCommand("anywhereTerminal.splitHorizontal", () =>
      doSplit(getFocusedProvider(), "horizontal"),
    ),
    vscode.commands.registerCommand("anywhereTerminal.splitVertical", () => doSplit(getFocusedProvider(), "vertical")),
    vscode.commands.registerCommand("anywhereTerminal.closeSplitPane", () => doCloseSplitPane(getFocusedProvider())),
    // ─── Export Terminal Session ──────────────────────────────────
    // See: asimov/changes/export-terminal-session/specs/terminal-session-export/spec.md
    // The 3 commands are reachable from both Command Palette and the webview
    // right-click context menu (see package.json `menus.webview/context`). The
    // ctx arg carries the right-clicked pane's sessionId; falls back to the
    // focused provider's active session for Command Palette invocations.
    //
    // A right-click after a pane was just closed (race with destroySession)
    // delivers a stale paneSessionId — `resolveExportSessionId` validates the
    // id against the session map and silently falls through to the focused
    // provider in that case, so the no-focus toast surfaces instead of the
    // confusing "scrollback dump failed" error from `requestScrollbackDump`.
    // See: .reviews/round-1.md [W4].
    vscode.commands.registerCommand("anywhereTerminal.exportBuffer", (ctx?: { paneSessionId?: string }) =>
      exportBuffer(buildExportDeps(() => resolveExportSessionId(ctx), sessionManager)),
    ),
    vscode.commands.registerCommand("anywhereTerminal.exportLastCommand", (ctx?: { paneSessionId?: string }) =>
      exportLastCommand(buildExportDeps(() => resolveExportSessionId(ctx), sessionManager)),
    ),
    vscode.commands.registerCommand("anywhereTerminal.exportCommand", (ctx?: { paneSessionId?: string }) =>
      exportCommand(buildExportDeps(() => resolveExportSessionId(ctx), sessionManager)),
    ),
    vscode.commands.registerCommand("anywhereTerminal.setFileTreePosition", async () => {
      const view = getFocusedProvider().view;
      if (!view) {
        return;
      }
      const choice = await vscode.window.showQuickPick(["Top", "Bottom", "Left", "Right"], {
        placeHolder: "Move AnyWhere Terminal file tree to…",
      });
      if (!choice) {
        return;
      }
      void view.webview.postMessage({
        type: "set-file-tree-position",
        position: choice.toLowerCase() as "top" | "bottom" | "left" | "right",
      });
    }),
    // Open AI Vault — focus the sidebar terminal view, then expand the vault
    // section stacked above the file tree (the webview re-reads the agents'
    // session stores). See: add-ai-coding-vault D11.
    vscode.commands.registerCommand("anywhereTerminal.openVault", async () => {
      await vscode.commands.executeCommand("anywhereTerminal.sidebar.focus");
      doOpenVault(sidebarProvider);
    }),
  );

  // ─── View-Specific Commands (for view/title menus — directly target correct provider) ──

  for (const loc of ["sidebar", "panel"] as const) {
    const provider = providers[loc];
    context.subscriptions.push(
      vscode.commands.registerCommand(`anywhereTerminal.newTerminal.${loc}`, () => doNewTerminal(provider)),
      vscode.commands.registerCommand(`anywhereTerminal.killTerminal.${loc}`, () => doKillTerminal(provider)),
      vscode.commands.registerCommand(`anywhereTerminal.splitHorizontal.${loc}`, () => doSplit(provider, "horizontal")),
      vscode.commands.registerCommand(`anywhereTerminal.splitVertical.${loc}`, () => doSplit(provider, "vertical")),
      // View-title "Export…" action — opens a quickpick of the
      // three real export commands. We flash the active pane first so the user
      // visually confirms which pane will be exported (the title bar applies
      // to whichever pane is currently active in THIS view).
      vscode.commands.registerCommand(`anywhereTerminal.exportPick.${loc}`, () => runExportPick(provider)),
      vscode.commands.registerCommand(`anywhereTerminal.openVault.${loc}`, () => doOpenVault(provider)),
    );
  }

  /**
   * Helper backing the per-loc `exportPick` commands. Resolves the active
   * session of `provider`, posts a `flashPane` message so the webview pulses
   * the matching split-leaf, then opens a quickpick to choose between the
   * three concrete export entry points. Passing `paneSessionId` through the
   * downstream command keeps the right pane targeted if focus shifts during
   * the quickpick.
   */
  function runExportPick(provider: TerminalViewProvider): void {
    const sessionId = provider.getActiveSessionId();
    if (!sessionId) {
      void vscode.window.showWarningMessage(NO_FOCUS_TOAST);
      return;
    }
    const view = provider.view;
    if (view) {
      safePostMessage(view.webview, { type: "flashPane", sessionId });
    }
    type PickItem = vscode.QuickPickItem & { commandId: string };
    const items: PickItem[] = [
      {
        label: "$(history) Export Last Command Output…",
        description: "Most-recent completed command",
        commandId: "anywhereTerminal.exportLastCommand",
      },
      {
        label: "$(list-selection) Export Command…",
        description: "Pick from tracked commands",
        commandId: "anywhereTerminal.exportCommand",
      },
      {
        label: "$(file) Export Buffer to File…",
        description: "Whole visible scrollback",
        commandId: "anywhereTerminal.exportBuffer",
      },
    ];
    void vscode.window.showQuickPick(items, { placeHolder: "Export…", matchOnDescription: true }).then((picked) => {
      if (!picked) {
        return;
      }
      return vscode.commands.executeCommand(picked.commandId, { paneSessionId: sessionId });
    });
  }

  // ─── Webview Context Menu Commands ────────────────────────────────
  // These are triggered from right-click on split panes via webview/context menus.
  // VS Code passes the data-vscode-context values as the command argument.

  /**
   * Find the provider that owns a given session ID.
   * Context menu commands receive paneSessionId from data-vscode-context;
   * use it to target the correct provider instead of getFocusedProvider().
   */
  const getProviderBySessionId = (sessionId: string): TerminalViewProvider | undefined => {
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return undefined;
    }
    for (const provider of [sidebarProvider, panelProvider]) {
      if (provider.getViewId() === session.viewId) {
        return provider;
      }
    }
    return undefined;
  };

  /**
   * Resolve the correct provider for a context menu command.
   * Prefers the provider owning the right-clicked session (paneSessionId),
   * falls back to getFocusedProvider() when context is unavailable.
   */
  const getCtxProvider = (ctx?: { paneSessionId?: string }): TerminalViewProvider => {
    if (ctx?.paneSessionId) {
      const provider = getProviderBySessionId(ctx.paneSessionId);
      if (provider) {
        return provider;
      }
    }
    return getFocusedProvider();
  };

  /** Post a message to the correct provider's webview based on context. */
  const postToCtxWebview = (ctx: { paneSessionId?: string } | undefined, message: unknown): void => {
    const provider = getCtxProvider(ctx);
    const view = provider.view;
    if (view) {
      safePostMessage(view.webview, message);
    }
  };

  /**
   * Locate the webview owning a given session — handles all three locations
   * (sidebar, panel, editor). Used by file-tree-aware ctx commands like
   * `revealInFileTree` that must post to the EXACT webview the user
   * right-clicked, not the focused one. Returns undefined when the session
   * has no surfaced webview (e.g. an editor panel disposed mid-click).
   */
  const getWebviewForSession = (sessionId: string): vscode.Webview | undefined => {
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return undefined;
    }
    for (const provider of [sidebarProvider, panelProvider]) {
      if (provider.getViewId() === session.viewId) {
        return provider.view?.webview;
      }
    }
    const editor = TerminalEditorProvider.findByViewId(session.viewId);
    return editor?.panel.webview;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("anywhereTerminal.ctx.closePane", (ctx: { paneSessionId?: string }) => {
      if (ctx?.paneSessionId) {
        postToCtxWebview(ctx, { type: "closeSplitPaneById", sessionId: ctx.paneSessionId });
      }
    }),
    vscode.commands.registerCommand("anywhereTerminal.ctx.splitVertical", (ctx: { paneSessionId?: string }) => {
      if (ctx?.paneSessionId) {
        postToCtxWebview(ctx, { type: "splitPaneAt", direction: "vertical", sourcePaneId: ctx.paneSessionId });
      }
    }),
    vscode.commands.registerCommand("anywhereTerminal.ctx.splitHorizontal", (ctx: { paneSessionId?: string }) => {
      if (ctx?.paneSessionId) {
        postToCtxWebview(ctx, { type: "splitPaneAt", direction: "horizontal", sourcePaneId: ctx.paneSessionId });
      }
    }),
    vscode.commands.registerCommand("anywhereTerminal.ctx.clearTerminal", (ctx?: { paneSessionId?: string }) => {
      // Clear scrollback on extension side, then tell webview to clear viewport
      const provider = getCtxProvider(ctx);
      // Use the right-clicked pane's session if available, otherwise fall back to active session
      const sessionId = ctx?.paneSessionId ?? provider.getActiveSessionId();
      if (sessionId) {
        sessionManager.clearScrollback(sessionId);
      }
      const view = provider.view;
      if (view) {
        safePostMessage(view.webview, { type: "ctxClear", sessionId });
      }
    }),
    vscode.commands.registerCommand("anywhereTerminal.ctx.newTerminal", (ctx?: { paneSessionId?: string }) => {
      doNewTerminal(getCtxProvider(ctx));
    }),
    vscode.commands.registerCommand("anywhereTerminal.ctx.killTerminal", (ctx?: { paneSessionId?: string }) => {
      const provider = getCtxProvider(ctx);
      const sessionId = ctx?.paneSessionId ?? provider.getActiveSessionId();
      if (!sessionId) {
        return;
      }
      sessionManager.destroySession(sessionId);
      const view = provider.view;
      if (view) {
        safePostMessage(view.webview, { type: "tabRemoved", tabId: sessionId });
      }
    }),
    // Right-click → "Reveal Working Directory in File Explorer". The extension
    // resolves the pane's live cwd by querying the PTY shell process at the OS
    // level (lsof on macOS, /proc/<pid>/cwd on Linux). This avoids requiring
    // shell integration / OSC 7 emission — it works out of the box on any
    // shell that has cd'd anywhere. Falls back to the parsed-prompt cwd (set
    // by the terminal output parser when available), then the initial cwd
    // recorded at PTY spawn. The webview falls back further to the workspace
    // root when all three are null (e.g. Windows where neither query works).
    vscode.commands.registerCommand(
      "anywhereTerminal.ctx.revealInFileTree",
      async (ctx?: { paneSessionId?: string }) => {
        // For editor sessions, `getCtxProvider` falls back to the focused
        // sidebar/panel provider (it only knows view-typed providers). Routing
        // the message there would deliver it to the WRONG webview. Resolve
        // the webview directly from the session ID so sidebar/panel/editor
        // are all handled identically.
        const sessionId = ctx?.paneSessionId ?? getCtxProvider(ctx).getActiveSessionId();
        if (!sessionId) {
          return;
        }
        const liveCwd = await sessionManager.getLiveCwd(sessionId);
        const cwd =
          liveCwd ?? sessionManager.getCurrentCwd(sessionId) ?? sessionManager.getInitialCwd(sessionId) ?? null;
        // The webview's file tree happily re-roots to any absolute path the
        // RPC handler can read (workspace containment check was dropped on
        // purpose — see fileTreeRpcHandler.ts). So we just relay the cwd
        // regardless of whether it's inside the workspace folder.
        const webview = getWebviewForSession(sessionId);
        if (webview) {
          safePostMessage(webview, { type: "reveal-in-file-tree", sessionId, cwd });
        }
      },
    ),
  );

  // ─── Rename Tab Command ───────────────────────────────────────────
  // See add-tab-rename: specs/tab-rename/spec.md#Rename-Command-and-Entry-Points,
  // design.md D5 (resolution chain — extracted to resolveRenameTarget.ts),
  // D7 (validation), D8 (single command id).
  //
  // Once a tabId is resolved, open an InputBox seeded with the current displayed
  // name. Dismissal (`undefined`) is no-op; any other value (incl. empty string)
  // is passed to `SessionManager.renameSession`, which normalizes per D7.

  context.subscriptions.push(
    vscode.commands.registerCommand("anywhereTerminal.renameTab", async (arg?: { tabId?: string }) => {
      const tabId = resolveRenameTargetTabId(
        arg,
        () => TerminalEditorProvider.getActiveProvider(),
        () => TerminalViewProvider.getLastFocusedProvider(),
      );
      if (!tabId) {
        return;
      }
      const session = sessionManager.getSession(tabId);
      if (!session) {
        return;
      }
      const currentDisplayed = session.customName ?? session.name;
      const input = await vscode.window.showInputBox({
        prompt: "Rename Tab (leave empty to reset to auto-name)",
        value: currentDisplayed,
        placeHolder: session.name,
      });
      if (input === undefined) {
        return; // User dismissed; do nothing
      }
      sessionManager.renameSession(tabId, input);
    }),
  );

  // ─── Configuration Change Listener ────────────────────────────────
  // Push updated config to all active webviews when relevant settings change.
  // See: specs/extension-settings/spec.md#settings-change-listener

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      // sessionRestore.enabled is the only `anywhereTerminal.*` setting that
      // does NOT push a configUpdate to webviews — it owns the restore pipeline
      // lifecycle and is handled here on the extension side.
      if (affectsSessionRestoreEnabled(e)) {
        // Re-apply the no-workspace-folder guard at runtime: without it, a
        // user toggling the setting on (or User-scope sync flipping it) would
        // re-enable persistence to globalStorageUri in a no-folder window and
        // leak snapshots across unrelated no-folder windows. See round-2 [W2].
        const want = readSessionRestoreEnabled();
        if (want && !hasWorkspaceStorage) {
          console.warn("[AnyWhere Terminal] sessionRestore toggle ignored — no workspace folder open.");
        }
        sessionManager.setRestoreEnabled(hasWorkspaceStorage && want);
      }

      if (!affectsTerminalConfig(e)) {
        return;
      }

      const config = readTerminalConfig();
      const configUpdateMessage = { type: "configUpdate" as const, config };

      // Push to sidebar and panel providers
      for (const provider of [sidebarProvider, panelProvider]) {
        const view = provider.view;
        if (view) {
          safePostMessage(view.webview, configUpdateMessage);
        }
      }

      // Push to all editor panels
      for (const panel of TerminalEditorProvider.getActivePanels()) {
        safePostMessage(panel.webview, configUpdateMessage);
      }
    }),
  );

  // ─── Insert Path Command (Explorer context menu) ────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "anywhereTerminal.insertPath",
      (uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined) => {
        // Resolve file URIs: multi-select (uris) or single-select (uri) from Explorer
        const targets = uris && uris.length > 0 ? uris : uri ? [uri] : [];
        if (targets.length === 0) {
          return;
        }

        // Escape each path and join with spaces, append trailing space
        const escaped = targets.map((u) => escapePathForShell(u.fsPath)).join(" ");

        // Route to the focused sidebar/panel provider's active pane session.
        // getActiveSessionId() correctly resolves split panes (via webview state).
        // NOTE: Editor terminals are not targeted by this command — they don't
        // expose an active session ID to the Extension Host. This is a known
        // limitation; the Shift+drag approach covers editor terminals directly.
        const provider = getFocusedProvider();
        const activeSessionId = provider.getActiveSessionId();
        if (!activeSessionId) {
          return;
        }

        sessionManager.writeToSession(activeSessionId, `${escaped} `);

        // Send visual feedback to the webview (brief flash effect)
        const view = provider.view;
        if (view) {
          safePostMessage(view.webview, { type: "insertPathEffect" });
        }
      },
    ),
  );

  // ─── Focus & Move Commands ──────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand("anywhereTerminal.focusSidebar", () => {
      void vscode.commands.executeCommand("anywhereTerminal.sidebar.focus");
    }),
    vscode.commands.registerCommand("anywhereTerminal.focusPanel", () => {
      void vscode.commands.executeCommand("anywhereTerminal.panel.focus");
    }),
    vscode.commands.registerCommand("anywhereTerminal.moveToSecondary", async () => {
      await vscode.commands.executeCommand("anywhereTerminal.sidebar.focus");
      await vscode.commands.executeCommand("workbench.action.moveView");
    }),
  );

  // SessionManager is NOT added to context.subscriptions: the deactivate()
  // hook below orchestrates a two-step flush (sync buffers → awaited index)
  // BEFORE dispose, so ordering matters. See: design.md D6.
}

/** Safely post a message to a webview, handling both sync throws and async rejections. */
function safePostMessage(webview: vscode.Webview | MessageSender, message: unknown): void {
  try {
    void (webview.postMessage(message) as Thenable<boolean>).then(undefined, () => {});
  } catch {
    // Webview may be disposed
  }
}

/**
 * Singleton reference set in `activate` and consumed in `deactivate`.
 * Lives at module scope so `deactivate` (which has no `context` arg) can
 * orchestrate the two-step persistence flush. See: design.md D6.
 */
let _activeSessionManager: SessionManager | null = null;

/** Singleton agent hook lifecycle owner — detached and disposed before PTYs. */
let _activeAgentHookController: AgentHookController | null = null;

export async function deactivate(): Promise<void> {
  const sm = _activeSessionManager;
  const agentHookController = _activeAgentHookController;
  _activeAgentHookController = null;

  // Controller disposal detaches the contributor before disabling and
  // disposing the runtime, so SessionManager cannot retain stale authority.
  if (agentHookController) {
    try {
      agentHookController.dispose();
    } catch (err) {
      console.error("[AnyWhere Terminal] AgentHookController.dispose failed during deactivate:", err);
    }
  }

  // Retained store snapshots are real temp files; they must not outlive the host.
  try {
    await disposeSnapshotPool();
  } catch (err) {
    console.error("[AnyWhere Terminal] snapshot pool dispose failed during deactivate:", err);
  }

  if (!sm) {
    return;
  }
  _activeSessionManager = null;
  // Step 1 — synchronously write every active session's buffer to disk so
  // partial-flush windows don't lose the most recent state.
  try {
    sm.flushSnapshotsSync();
  } catch (err) {
    console.error("[AnyWhere Terminal] flushSnapshotsSync failed during deactivate:", err);
  }
  // Step 2 — await the index + live-panels Memento updates. VS Code raises a
  // `Canceled` Thenable here when the extension host is shutting down — the
  // sidecar index written synchronously in Step 1 is the authoritative source
  // on next activate, so a cancel here is a degraded-but-correct outcome.
  try {
    await sm.flushIndexAwaited();
  } catch (err) {
    console.error("[AnyWhere Terminal] flushIndexAwaited failed during deactivate:", err);
  }
  // Step 3 — tear down PTYs (idempotent).
  try {
    sm.dispose();
  } catch (err) {
    console.error("[AnyWhere Terminal] SessionManager.dispose failed during deactivate:", err);
  }
}
