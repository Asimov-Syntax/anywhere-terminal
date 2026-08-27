import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { AgentHookController } from "./agentHooks/AgentHookController";
import { createAgentHookRuntime } from "./agentHooks/AgentHookRuntime";
import {
  AGENT_HOOK_REGISTRY,
  AGENT_HOOK_UNINSTALL_COMMAND,
  isAgentHookEnabled,
  type SettingsReader,
} from "./agentHooks/install/agentHookRegistry";
import { ManagedConfigInstaller } from "./agentHooks/install/ManagedConfigInstaller";
import { summarizeUninstall, uninstallAllAgents } from "./agentHooks/install/uninstallAllAgents";
import { exportBuffer, exportCommand, exportLastCommand, NO_FOCUS_TOAST } from "./commands/exportCommands";
import { createWatcherPool } from "./providers/fsWatcherPool";
import { createGitDecorationProvider } from "./providers/gitDecorationProvider";
import { resolveRenameTargetTabId } from "./providers/resolveRenameTarget";
import { TerminalEditorProvider } from "./providers/TerminalEditorProvider";
import { TerminalPanelSerializer } from "./providers/TerminalPanelSerializer";
import { TerminalViewProvider } from "./providers/TerminalViewProvider";
import { VaultWatchCoordinator } from "./providers/VaultWatchCoordinator";
import { loadNodePty } from "./pty/PtyManager";
import type { MessageSender } from "./session/OutputBuffer";
import { SessionManager } from "./session/SessionManager";
import { SessionStorage } from "./session/SessionStorage";
import {
  affectsSessionRestoreEnabled,
  affectsTerminalConfig,
  readSessionRestoreEnabled,
  readTerminalConfig,
  readTerminalSettings,
} from "./settings/SettingsReader";
import { PtyLoadError } from "./types/errors";
import { escapePathForShell } from "./utils/shellEscape";
import { VaultCacheStore } from "./vault/VaultCacheStore";
import { VaultCustomNameRegistry } from "./vault/VaultCustomNameRegistry";
import { VaultLauncher } from "./vault/VaultLauncher";
import { VaultService } from "./vault/VaultService";

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

  // Create shared SessionManager (singleton). workspaceState backs the per-workspace
  // custom-tab-name persistence (anywhereTerminal.tabCustomNames); see design.md D3 of add-tab-rename.
  const sessionManager = new SessionManager(context.workspaceState, {
    restoreEnabled,
    storage: sessionStorage,
    shellIntegrationContext,
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

  // Per-agent hook authority is granted only after that agent's machine hook
  // file reconciles successfully. The controller serializes config ownership
  // and runtime/contributor state so stale async transitions cannot restore
  // access. One runtime serves every hook-capable agent
  // (generalize-agent-hook-runtime D1, D6).
  const readAgentHookSetting: SettingsReader = <T>(key: string) =>
    vscode.workspace.getConfiguration("anywhereTerminal").get<T>(key);
  // storageRoot, not the wrapper directory: each adapter appends its own
  // sub-directory, so cursor's on-disk location is unchanged.
  const agentHookStorageRoot = context.globalStorageUri.fsPath;
  // Where each agent's entries currently live. A location setting that moves
  // mid-session must clean the file it left behind, which the adapter can no
  // longer resolve (install-claude-hooks round-1 B1).
  const agentHookDestinations = new Map<string, string>(
    AGENT_HOOK_REGISTRY.map((entry) => [entry.agent, entry.createAdapter(readAgentHookSetting).configPath()]),
  );
  const agentHookController = new AgentHookController({
    agents: AGENT_HOOK_REGISTRY.map((entry) => ({
      agent: entry.agent,
      initialEnabled: isAgentHookEnabled(entry, readAgentHookSetting),
      installer: new ManagedConfigInstaller(entry.createAdapter(readAgentHookSetting), {
        storageRoot: agentHookStorageRoot,
      }),
    })),
    createRuntime: () =>
      createAgentHookRuntime(
        AGENT_HOOK_REGISTRY.map((entry) => entry.createRegistration()),
        {},
        {
          onStatus: (update) => {
            // The webview status contract carries Cursor only; other agents
            // reach the panel through the presence pipeline instead.
            if (update.agent !== "cursor") {
              return;
            }
            const session = sessionManager.getSession(update.sessionId);
            if (session?.state !== "live") {
              return;
            }
            safePostMessage(session.webview, {
              type: "agentActivityStatus",
              tabId: update.sessionId,
              agent: update.agent,
              state: update.state === "working" || update.state === "idle" ? update.state : null,
            });
          },
          onReasonCode: (reason, sessionSuffix) => {
            console.warn(`[AnyWhere Terminal] Agent hook ${reason}${sessionSuffix ? ` (…${sessionSuffix})` : ""}`);
          },
        },
      ),
    setContributor: (contributor) => sessionManager.setAgentHookContributor(contributor),
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

  // Register before runtime binding awaits so changes during activation enter
  // the same serialized controller and the latest desired setting wins.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      for (const entry of AGENT_HOOK_REGISTRY) {
        const enabled = isAgentHookEnabled(entry, readAgentHookSetting);
        const previous = agentHookDestinations.get(entry.agent);
        const current = entry.createAdapter(readAgentHookSetting).configPath();
        if (previous !== undefined && previous !== current) {
          agentHookDestinations.set(entry.agent, current);
          void new ManagedConfigInstaller(entry.createAdapterForPath(previous), {
            storageRoot: agentHookStorageRoot,
          }).uninstall();
        }
        if (event.affectsConfiguration(`anywhereTerminal.${entry.enabledSettingKey}`)) {
          void agentHookController.setDesiredEnabled(entry.agent, enabled);
        }
      }
    }),
    vscode.commands.registerCommand(AGENT_HOOK_UNINSTALL_COMMAND, async () => {
      const results = await uninstallAllAgents({
        storageRoot: agentHookStorageRoot,
        settings: readAgentHookSetting,
      });
      void vscode.window.showInformationMessage(`AnyWhere Terminal agent hooks — ${summarizeUninstall(results)}`);
    }),
  );
  await agentHookController.start();

  // Shared GitDecorationProvider — one singleton, threaded through every
  // FileTreeHost so the three webviews (sidebar / panel / editor) see one
  // consistent revision sequence. See: add-file-tree-git-decorations design.md D8, D10.
  const gitDecorationProvider = createGitDecorationProvider();
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
  const vaultLauncher = new VaultLauncher(vaultService);
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
      new TerminalPanelSerializer(context, sessionManager, gitDecorationProvider, fsWatcherPool),
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
