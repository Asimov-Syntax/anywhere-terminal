import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as vscode from "vscode";
import { descendantPids } from "../pty/processTree";
import { type ResolveClaudeSessionDeps, resolveClaudeSession } from "../session/resolveClaudeSession";
import type { SessionManager } from "../session/SessionManager";
import type { PendingSnapshot } from "../session/SessionSnapshot";
import { readTerminalConfig, readTerminalSettings } from "../settings/SettingsReader";
import type { SetPanelIdMessage, ThemeChangedMessage, WebViewToExtensionMessage } from "../types/messages";
import { readClaudeSessions, resolveClaudeSessionPath } from "../vault/readers/claudeReader";
import { listRunningClaudeSessions } from "../vault/readers/runningSessions";
import { resolveSubagentDetail, resolveSubagentDetailByEntryId } from "../vault/readers/subagentLookup";
import { agentKindForExecutable } from "../vault/registry";
import { handlePasteClipboardImage, handlePasteOsClipboardImage, readImageFromOsClipboard } from "./clipboardImageSync";
import { FileTreeHost } from "./fileTreeHost";
import type { WatcherPool } from "./fsWatcherPool";
import type { GitDecorationProvider } from "./gitDecorationProvider";
import { affectsHoverPreview, readHoverPreviewSettings, updateHoverPreviewSetting } from "./hoverPreviewSettings";
import { openExternalLink } from "./openExternalLink";
import { DEFAULT_FIND_FILES_MAX_RESULTS, openFileLink } from "./openFileLink";
import { previewFileLink } from "./previewFileLink";
import { isValidPreviewRequest } from "./previewValidation";
import { readBytesBounded } from "./readBytesBounded";
import { themeKindFor } from "./TerminalViewProvider";
import { getTerminalHtml } from "./webviewHtml";

/**
 * Editor-area terminal provider using WebviewPanel.
 *
 * Unlike TerminalViewProvider (which uses WebviewViewProvider for sidebar/panel),
 * this class creates on-demand WebviewPanels that open as editor tabs.
 * Each call to createPanel() produces an independent terminal with its own PTY.
 * All session operations are delegated to the shared SessionManager.
 *
 * See: docs/design/webview-provider.md#§7
 */
/**
 * Grace window between the editor panel disposing and the underlying PTY
 * being destroyed. A webview-reload (Cmd+R) typically re-attaches within
 * ~1s; we wait 5s to be safe. See: restore-terminal-sessions design.md D3.
 */
const GRACE_PERIOD_MS = 5000;

export class TerminalEditorProvider {
  public static readonly viewType = "anywhereTerminal.editor";

  /** Track all active editor panels for config updates. */
  private static readonly _activePanels = new Set<vscode.WebviewPanel>();

  /**
   * Instance registry keyed by the owning WebviewPanel. Populated in
   * `createPanel`, cleared on `panel.onDidDispose`. Lets host-side commands
   * (e.g. rename) resolve "the currently active editor terminal" to a concrete
   * provider whose `getActiveTabId()` can be queried.
   *
   * See add-tab-rename design.md D5.
   */
  private static readonly _instances = new Map<vscode.WebviewPanel, TerminalEditorProvider>();

  /** Get all active editor panels (for pushing config updates). */
  static getActivePanels(): ReadonlySet<vscode.WebviewPanel> {
    return TerminalEditorProvider._activePanels;
  }

  /**
   * Return the editor-area provider whose panel currently holds focus
   * (`panel.active === true`), or undefined. Used by the rename-command
   * resolver (see add-tab-rename design.md D5).
   */
  static getActiveProvider(): TerminalEditorProvider | undefined {
    for (const [panel, provider] of TerminalEditorProvider._instances) {
      if (panel.active) {
        return provider;
      }
    }
    return undefined;
  }

  /**
   * Get the **root tab** id for the active tab in this editor panel — symmetric
   * with `TerminalViewProvider.getActiveTabId()`. Rename always targets the
   * root tab, never a split pane (see add-tab-rename design.md D5).
   */
  getActiveTabId(): string | undefined {
    return this.sessionManager.getTabsForView(this._viewId).find((t) => t.isActive)?.id;
  }

  /** The unique view ID for this editor panel's sessions. */
  private readonly _viewId: string;
  /** Whether the webview has sent the 'ready' message. Gates outbound messages. */
  private _ready = false;
  /** The WebviewPanel managed by this instance. */
  private readonly _panel: vscode.WebviewPanel;
  /**
   * Shared file-tree wiring (rootGeneration, workspaceRoot getter,
   * onDidChangeWorkspaceFolders subscription, message dispatch). Same
   * companion class TerminalViewProvider uses — single point of change
   * keeps the sidebar / panel / editor providers in lockstep. The optional
   * `gitDecorationProvider` (passed via `createPanel`) is shared across the
   * three providers so revision sequences line up.
   * See: providers/fileTreeHost.ts; design.md D10.
   */
  private readonly fileTreeHost: FileTreeHost;

  /** Public accessor for `extension.ts` ctx command routing. */
  get rootGeneration(): number {
    return this.fileTreeHost.rootGeneration;
  }

  /** Public accessor for `extension.ts` ctx command routing. */
  get workspaceRoot(): string | null {
    return this.fileTreeHost.workspaceRoot;
  }

  /** Public accessor — used by `extension.ts` to route ctx commands. */
  getViewId(): string {
    return this._viewId;
  }

  /** Public accessor — used by `extension.ts` to post messages to this panel. */
  get panel(): vscode.WebviewPanel {
    return this._panel;
  }

  /**
   * Find the editor provider whose `_viewId` matches the given session's
   * `viewId`. Returns undefined when no editor instance owns that session
   * (e.g. it's a sidebar/panel session).
   */
  static findByViewId(viewId: string): TerminalEditorProvider | undefined {
    if (!viewId.startsWith("editor-")) {
      return undefined;
    }
    for (const provider of TerminalEditorProvider._instances.values()) {
      if (provider._viewId === viewId) {
        return provider;
      }
    }
    return undefined;
  }

  /** In-flight hover-preview cancellation tokens, keyed by `sessionId`. See: design.md D9, D10 */
  private readonly _previewTokens = new Map<string, vscode.CancellationTokenSource>();

  /** Stable panel identity persisted via webview `vscode.setState`. See: design.md D2. */
  private readonly _panelId: string;
  /**
   * Snapshots consumed from `SessionManager.consumeSnapshotsForPanel(panelId)`
   * by `TerminalPanelSerializer.deserializeWebviewPanel`. Empty on cold-open.
   * `setupPanel().onReady` decides between existing / restore / cold branches.
   * See: design.md D7.
   */
  private readonly restoreSnapshots: PendingSnapshot[];

  /** Public accessor — used by `TerminalPanelSerializer` for back-compat lookups. */
  getPanelId(): string {
    return this._panelId;
  }

  private constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessionManager: SessionManager,
    panel: vscode.WebviewPanel,
    gitDecorationProvider: GitDecorationProvider | null = null,
    watcherPool: WatcherPool | null = null,
    panelId: string = crypto.randomUUID(),
    restoreSnapshots: PendingSnapshot[] = [],
  ) {
    this._panel = panel;
    this._panelId = panelId;
    this._viewId = `editor-${panelId}`;
    this.restoreSnapshots = restoreSnapshots;
    this.fileTreeHost = new FileTreeHost(gitDecorationProvider, watcherPool);
    this.setupPanel();
  }

  /**
   * Create a new terminal panel in the editor area.
   *
   * Each invocation creates an independent terminal with its own PTY.
   * The returned Disposable kills the PTY and disposes the panel on cleanup.
   */
  static createPanel(
    context: vscode.ExtensionContext,
    sessionManager: SessionManager,
    gitDecorationProvider: GitDecorationProvider | null = null,
    watcherPool: WatcherPool | null = null,
  ): vscode.Disposable {
    const panel = vscode.window.createWebviewPanel(
      TerminalEditorProvider.viewType,
      "Terminal",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
      },
    );

    const provider = new TerminalEditorProvider(
      context.extensionUri,
      sessionManager,
      panel,
      gitDecorationProvider,
      watcherPool,
      crypto.randomUUID(),
      [],
    );

    // Track this panel for config updates + the provider instance for host-side
    // commands (rename). Disposal happens in `setupPanel`'s onDidDispose.
    TerminalEditorProvider._activePanels.add(panel);
    TerminalEditorProvider._instances.set(panel, provider);
    sessionManager.registerEditorPanel(provider._panelId);

    // Return a disposable that cleans up via panel dispose (which triggers onDidDispose → destroyAllForView)
    return {
      dispose: () => {
        panel.dispose();
      },
    };
  }

  /**
   * Revive an editor panel previously serialized by VS Code. Constructed by
   * `TerminalPanelSerializer.deserializeWebviewPanel` after `cancelScheduledDestroy`
   * + `consumeSnapshotsForPanel`. The new provider takes over an existing
   * `WebviewPanel` instance (no createWebviewPanel call) and registers it in
   * the live-panels registry. See: restore-terminal-sessions design.md D2, D3, D7.
   */
  static revive(
    context: vscode.ExtensionContext,
    sessionManager: SessionManager,
    panel: vscode.WebviewPanel,
    panelId: string,
    restoreSnapshots: PendingSnapshot[],
    gitDecorationProvider: GitDecorationProvider | null = null,
    watcherPool: WatcherPool | null = null,
  ): TerminalEditorProvider {
    const provider = new TerminalEditorProvider(
      context.extensionUri,
      sessionManager,
      panel,
      gitDecorationProvider,
      watcherPool,
      panelId,
      restoreSnapshots,
    );
    TerminalEditorProvider._activePanels.add(panel);
    TerminalEditorProvider._instances.set(panel, provider);
    sessionManager.registerEditorPanel(panelId);
    return provider;
  }

  /**
   * Set up the panel: HTML content, message handler, dispose handler.
   */
  private setupPanel(): void {
    // 1. Set HTML content using shared utility
    this._panel.webview.html = getTerminalHtml(this._panel.webview, this.extensionUri, "editor");

    // 2. Wire message handler
    const disposables: vscode.Disposable[] = [];

    disposables.push(
      this._panel.webview.onDidReceiveMessage((msg: unknown) => {
        this.handleMessage(msg);
      }),
    );

    // 3a. Wire theme-change bridge for hover-preview popup theming.
    // See: asimov/changes/add-hover-file-preview/design.md D8
    disposables.push(
      vscode.window.onDidChangeActiveColorTheme((theme) => {
        if (!this._ready) {
          return;
        }
        this.safePostMessage({
          type: "themeChanged",
          kind: themeKindFor(theme.kind),
        } satisfies ThemeChangedMessage);
      }),
    );

    // 3a-bis. Wire hover-preview settings bridge. See: design.md D17
    disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!affectsHoverPreview(event) || !this._ready) {
          return;
        }
        this.safePostMessage({
          type: "hoverPreviewSettings",
          settings: readHoverPreviewSettings(),
        });
      }),
    );

    // 3b. Wire visibility handler (for deferred resize on tab switch)
    disposables.push(
      this._panel.onDidChangeViewState((e) => {
        if (e.webviewPanel.visible && this._ready) {
          this.safePostMessage({ type: "viewShow" });
        }
      }),
    );

    // 3c. Workspace-folder bridge — delegated to fileTreeHost so all three
    // providers (sidebar/panel/editor) stay in lockstep on file-tree state.
    disposables.push(
      this.fileTreeHost.attach({
        isReady: () => this._ready,
        post: (msg) => this.safePostMessage(msg),
      }),
    );

    // 4. Wire dispose handler — clean up all subscriptions and sessions.
    //    NOTE: PTY destruction is DEFERRED via scheduleDestroyForView so a
    //    window-reload's webview swap can revive the panel before the grace
    //    period elapses. See: restore-terminal-sessions design.md D3.
    this._panel.onDidDispose(() => {
      for (const d of disposables) {
        d.dispose();
      }
      // Cancel + dispose any in-flight preview tokens (D10).
      this.cancelAllPreviewTokens();
      TerminalEditorProvider._activePanels.delete(this._panel);
      TerminalEditorProvider._instances.delete(this._panel);
      this.sessionManager.scheduleDestroyForView(this._viewId, GRACE_PERIOD_MS, () => {
        // Live-panels registry is cleaned only on the REAL destroy (grace
        // window elapsed without revival). See: design.md D10.
        this.sessionManager.unregisterEditorPanel(this._panelId);
      });
    });
  }

  /**
   * Cancel the in-flight preview token for `sessionId` and remove it from the
   * map. Does NOT dispose — disposal is owned by the handler's finally block
   * so in-flight `isCancellationRequested` checks remain safe. See round-1 W6.
   */
  private cancelPreviewToken(sessionId: string): void {
    const prior = this._previewTokens.get(sessionId);
    if (prior) {
      try {
        prior.cancel();
      } catch {
        // Best-effort.
      }
      this._previewTokens.delete(sessionId);
    }
  }

  /** Cancel + dispose ALL in-flight preview tokens. */
  private cancelAllPreviewTokens(): void {
    for (const sessionId of [...this._previewTokens.keys()]) {
      this.cancelPreviewToken(sessionId);
    }
  }

  /** Handle a hover-preview request. See: design.md D9 */
  private async handleRequestFilePreview(
    message: Extract<WebViewToExtensionMessage, { type: "requestFilePreview" }>,
  ): Promise<void> {
    // Reject unknown sessionId BEFORE resolution work — see TerminalViewProvider
    // counterpart + round-2 W3.
    if (!this.sessionManager.getSession(message.sessionId)) {
      return;
    }
    this.cancelPreviewToken(message.sessionId);
    const source = new vscode.CancellationTokenSource();
    this._previewTokens.set(message.sessionId, source);
    try {
      const allSettings = readHoverPreviewSettings();
      const result = await previewFileLink(
        message,
        {
          getInitialCwd: (id) => this.sessionManager.getInitialCwd(id),
          getCurrentCwd: (id) => this.sessionManager.getCurrentCwd(id),
          getLiveCwd: (id) => this.sessionManager.getLiveCwd(id),
          workspaceFolders: vscode.workspace.workspaceFolders,
          fs: {
            stat: (uri) => vscode.workspace.fs.stat(uri),
            readFile: (uri) => vscode.workspace.fs.readFile(uri),
            readBytes: (uri, maxBytes) => readBytesBounded(uri, maxBytes),
          },
          findFiles: (include, exclude, maxResults, token) =>
            vscode.workspace.findFiles(include, exclude, maxResults, token),
          uriFactory: { file: vscode.Uri.file },
          createCancellationTokenSource: () => new vscode.CancellationTokenSource(),
          directoryFileType: vscode.FileType.Directory,
          symbolicLinkFileType: vscode.FileType.SymbolicLink,
          relativePatternFactory: (base, glob) => new vscode.RelativePattern(base, glob),
          settings: { blockSensitive: allSettings.blockSensitive },
        },
        source.token,
      );
      if (result && !source.token.isCancellationRequested) {
        this.safePostMessage(result);
      }
    } catch (err) {
      console.warn("[AnyWhere Terminal] requestFilePreview failed (editor):", err);
    } finally {
      if (this._previewTokens.get(message.sessionId) === source) {
        this._previewTokens.delete(message.sessionId);
      }
      // Always dispose our own source — review round-1 W6.
      try {
        source.dispose();
      } catch {
        // Best-effort.
      }
    }
  }

  /**
   * Route incoming webview messages to appropriate handlers.
   *
   * See: docs/design/webview-provider.md#§8, docs/design/message-protocol.md#§10
   */
  private handleMessage(msg: unknown): void {
    // Basic shape validation
    if (!msg || typeof msg !== "object" || !("type" in msg) || typeof (msg as { type: unknown }).type !== "string") {
      console.warn("[AnyWhere Terminal] Invalid message from editor webview:", msg);
      return;
    }

    const message = msg as WebViewToExtensionMessage;

    try {
      switch (message.type) {
        case "ready":
          void this.onReady();
          break;

        case "input":
          if (typeof message.tabId === "string" && typeof message.data === "string") {
            this.sessionManager.writeToSession(message.tabId, message.data);
          }
          break;

        case "pasteClipboardImage":
          if (typeof message.tabId === "string" && typeof message.data === "string") {
            const session = this.sessionManager.getSession(message.tabId);
            const agentKind = session?.isAgentLaunch ? agentKindForExecutable(session.shell) : undefined;
            void handlePasteClipboardImage(
              {
                tabId: message.tabId,
                mimeType: typeof message.mimeType === "string" ? message.mimeType : "image/png",
                data: message.data,
              },
              (tabId, data) => this.sessionManager.writeToSession(tabId, data),
              { agentKind, platform: process.platform },
            );
          }
          break;

        case "requestClipboardImagePreview":
          if (typeof message.tabId === "string") {
            const tabId = message.tabId;
            void readImageFromOsClipboard().then((img) => {
              this.safePostMessage({
                type: "clipboardImagePreview",
                tabId,
                mimeType: img?.mimeType ?? "image/png",
                data: img?.data ?? "",
              });
            });
          }
          break;

        case "pasteOsClipboardImage":
          if (typeof message.tabId === "string") {
            const tabId = message.tabId;
            const session = this.sessionManager.getSession(tabId);
            const agentKind = session?.isAgentLaunch ? agentKindForExecutable(session.shell) : undefined;
            void handlePasteOsClipboardImage(tabId, (tid, data) => this.sessionManager.writeToSession(tid, data), {
              agentKind,
              platform: process.platform,
            }).then((img) => {
              if (img) {
                this.safePostMessage({
                  type: "clipboardImagePreview",
                  tabId,
                  mimeType: img.mimeType,
                  data: img.data,
                });
              } else {
                this.safePostMessage({ type: "osClipboardPasteMiss", tabId });
              }
            });
          }
          break;

        case "resize":
          if (
            typeof message.tabId === "string" &&
            typeof message.cols === "number" &&
            typeof message.rows === "number" &&
            Number.isFinite(message.cols) &&
            Number.isFinite(message.rows)
          ) {
            this.sessionManager.resizeSession(message.tabId, message.cols, message.rows);
          }
          break;

        case "ack":
          if (typeof message.charCount === "number" && typeof message.tabId === "string") {
            this.sessionManager.handleAck(message.tabId, message.charCount);
          }
          break;

        case "scrollbackDump":
          if (
            typeof message.requestId === "string" &&
            typeof message.tabId === "string" &&
            typeof message.data === "string" &&
            typeof message.lineCount === "number" &&
            typeof message.truncated === "boolean"
          ) {
            this.sessionManager.handleScrollbackDump(message.requestId, message.tabId, {
              data: message.data,
              lineCount: message.lineCount,
              truncated: message.truncated,
              error: typeof message.error === "string" ? message.error : undefined,
            });
          }
          break;

        case "createTab": {
          const createSettings = readTerminalSettings();
          const newSessionId = this.sessionManager.createSession(this._viewId, this._panel.webview, {
            shell: createSettings.shell,
            shellArgs: createSettings.shellArgs,
            cwd: createSettings.cwd,
          });
          this.sessionManager.attachSessionToPanel(this._panelId, newSessionId);
          const newSession = this.sessionManager.getSession(newSessionId);
          if (newSession) {
            this.safePostMessage({
              type: "tabCreated",
              tabId: newSessionId,
              name: newSession.name,
              customName: newSession.customName,
            });
          }
          break;
        }

        case "switchTab":
          if (typeof message.tabId === "string") {
            this.sessionManager.switchActiveSession(this._viewId, message.tabId);
          }
          break;

        case "closeTab":
          if (typeof message.tabId === "string") {
            this.cancelPreviewToken(message.tabId);
            this.sessionManager.destroySession(message.tabId);
            this.safePostMessage({
              type: "tabRemoved",
              tabId: message.tabId,
            });
          }
          break;

        case "renameTab":
          if (typeof message.tabId === "string") {
            this.sessionManager.renameSession(message.tabId, message.customName ?? null);
          }
          break;

        case "requestCloseSplitPane": {
          // Mirrors TerminalViewProvider — cancel the in-flight hover preview
          // for the pane being closed BEFORE destroying its session.
          if (typeof (message as { sessionId?: unknown }).sessionId === "string") {
            const closeMsg = message as { sessionId: string };
            this.cancelPreviewToken(closeMsg.sessionId);
            this.sessionManager.destroySession(closeMsg.sessionId);
          }
          break;
        }

        case "clear":
          if (typeof message.tabId === "string") {
            this.sessionManager.clearScrollback(message.tabId);
          }
          break;

        case "request-read-directory":
        case "request-open-folder":
        case "request-file-tree-search":
        case "cancel-file-tree-search":
        case "request-subscribe-fs-changes":
        case "request-unsubscribe-fs-changes":
        case "file-tree-reveal-in-os":
        case "file-tree-copy-path":
        case "file-tree-copy-relative-path":
        case "file-tree-delete":
          // File-tree messages are dispatched by FileTreeHost so the
          // sidebar / panel / editor providers share one wiring. See
          // providers/fileTreeHost.ts.
          this.fileTreeHost.handleMessage(message, (response) => this.safePostMessage(response));
          break;

        case "openLink":
          if (typeof message.url === "string") {
            void openExternalLink(message.url);
          }
          break;

        case "openFile":
          if (typeof message.path === "string" && typeof message.sessionId === "string") {
            void openFileLink(message, {
              getInitialCwd: (id) => this.sessionManager.getInitialCwd(id),
              getCurrentCwd: (id) => this.sessionManager.getCurrentCwd(id),
              getLiveCwd: (id) => this.sessionManager.getLiveCwd(id),
              workspaceFolders: vscode.workspace.workspaceFolders,
              stat: (uri) => vscode.workspace.fs.stat(uri),
              findFiles: (include, exclude, maxResults, token) =>
                vscode.workspace.findFiles(include, exclude, maxResults, token),
              showWarning: vscode.window.showWarningMessage,
              showError: vscode.window.showErrorMessage,
              showTextDocument: vscode.window.showTextDocument,
              showQuickPick: vscode.window.showQuickPick,
              getFileSearchMaxResults: () =>
                vscode.workspace
                  .getConfiguration("anywhereTerminal.fileSearch")
                  .get<number>("maxResults", DEFAULT_FIND_FILES_MAX_RESULTS),
            });
          }
          break;

        case "requestFilePreview":
          if (isValidPreviewRequest(message)) {
            void this.handleRequestFilePreview(message);
          }
          break;

        case "requestSubagentPreview":
          void this.handleRequestSubagentPreview(message);
          break;

        case "updateHoverPreviewSetting":
          // Mirrors TerminalViewProvider — webview-driven setting update.
          if (
            typeof (message as { key?: unknown }).key === "string" &&
            (typeof (message as { value?: unknown }).value === "boolean" ||
              typeof (message as { value?: unknown }).value === "number")
          ) {
            void updateHoverPreviewSetting(
              (message as { key: string }).key as Parameters<typeof updateHoverPreviewSetting>[0],
              (message as { value: boolean | number }).value,
            ).catch((err) => {
              console.warn("[AnyWhere Terminal] updateHoverPreviewSetting failed (editor):", err);
            });
          }
          break;

        default:
          break;
      }
    } catch (err) {
      console.error(`[AnyWhere Terminal] Error handling editor message ${message.type}:`, err);
    }
  }

  /**
   * Resolve a clicked subagent (Task) line in a running Claude editor-terminal to
   * its sub-session transcript and reply with `subagentPreviewResponse`. Mirrors
   * `TerminalViewProvider.handleRequestSubagentPreview`; posts to this panel's
   * webview. A missing session / no match / read error becomes an `error` marker —
   * it never throws (design.md D3).
   */
  private async handleRequestSubagentPreview(
    message: Extract<WebViewToExtensionMessage, { type: "requestSubagentPreview" }>,
  ): Promise<void> {
    const { terminalId, requestId, description, entryId } = message;
    try {
      // Nested drill-down: resolve the named child by its vault entryId (no live
      // terminal/description matching) and echo entryId so the popup routes the
      // reply to that nested block (support-nested-subagent-preview D5).
      if (entryId) {
        const nested = await resolveSubagentDetailByEntryId(entryId);
        this.safePostMessage(
          nested
            ? { type: "subagentPreviewResponse", requestId, entryId, detail: nested }
            : { type: "subagentPreviewResponse", requestId, entryId, error: "notFound" },
        );
        return;
      }
      const session = await resolveClaudeSession(terminalId, this.subagentResolveDeps());
      if (!session) {
        this.safePostMessage({ type: "subagentPreviewResponse", requestId, error: "noSession" });
        return;
      }
      const detail = await resolveSubagentDetail(session.sessionId, description);
      this.safePostMessage(
        detail
          ? { type: "subagentPreviewResponse", requestId, detail }
          : { type: "subagentPreviewResponse", requestId, error: "notFound" },
      );
    } catch (err) {
      this.safePostMessage({
        type: "subagentPreviewResponse",
        requestId,
        ...(entryId ? { entryId } : {}),
        error: err instanceof Error ? err.message : "Failed to read subagent transcript",
      });
    }
  }

  /** Wire SessionManager + Claude readers into the `resolveClaudeSession` deps. */
  private subagentResolveDeps(): ResolveClaudeSessionDeps {
    return {
      getPtyPid: (id) => this.sessionManager.getSession(id)?.pty.pid,
      getCwd: async (id) =>
        (await this.sessionManager.getLiveCwd(id)) ??
        this.sessionManager.getCurrentCwd(id) ??
        this.sessionManager.getInitialCwd(id),
      listRunning: () => listRunningClaudeSessions(),
      descendantPids: (pid) => descendantPids(pid),
      sessionMtime: async (sessionId) => {
        const filePath = await resolveClaudeSessionPath(sessionId);
        if (!filePath) {
          return undefined;
        }
        try {
          return (await fs.stat(filePath)).mtimeMs;
        } catch {
          return undefined;
        }
      },
      newestSessionUnderCwd: async (cwd) => {
        const { entries } = await readClaudeSessions({});
        let best: { sessionId: string; cwd: string } | null = null;
        let bestMtime = Number.NEGATIVE_INFINITY;
        for (const entry of entries) {
          if (entry.agent === "claude" && entry.cwd === cwd && entry.modified > bestMtime) {
            best = { sessionId: entry.sessionId, cwd: entry.cwd };
            bestMtime = entry.modified;
          }
        }
        return best;
      },
    };
  }

  /**
   * Handle the 'ready' message from the webview.
   * Creates a session via SessionManager and sends 'init' to the webview.
   *
   * MUST be async + await `init` delivery before posting any `restore` /
   * `restoreFromSnapshot` payload — mirrors the round-2 [W4] fix for
   * TerminalViewProvider. Without the await, a transient postMessage
   * failure (50-150ms retry window) would let restore messages arrive at a
   * webview that hasn't processed init, triggering the `deferOpen`
   * mis-wrap with a default-config terminal. See .reviews/round-4.md [W1].
   */
  private async onReady(): Promise<void> {
    this._ready = true;

    // Tell the webview which panelId VS Code will use to identify this panel
    // across reloads. The webview persists `{ panelId }` via vscode.setState
    // so the serializer's `state` arg carries it back. See design.md D2.
    this.safePostMessage({ type: "setPanelId", panelId: this._panelId } satisfies SetPanelIdMessage);

    // Post the initial theme so the popup renderer can pick the right Shiki
    // theme before the first hover.
    this.safePostMessage({
      type: "themeChanged",
      kind: themeKindFor(vscode.window.activeColorTheme.kind),
    } satisfies ThemeChangedMessage);

    // Post initial hover-preview settings — see design.md D17.
    this.safePostMessage({
      type: "hoverPreviewSettings",
      settings: readHoverPreviewSettings(),
    });

    try {
      const settings = readTerminalSettings();
      const existingSessions = this.sessionManager.getAllSessionsForView(this._viewId);

      if (existingSessions.length > 0) {
        // Phase A: window-reload revive — sessions survived the grace window.
        // Rebind their webview reference BEFORE replaying scrollback, otherwise
        // the surviving sessions still hold the disposed webview and
        // safePostMessage silently no-ops. See: design.md D3, D12.
        this.sessionManager.updateWebviewForView(this._viewId, this._panel.webview);
        const initDelivered = await this.safeSendWithRetry({
          type: "init",
          tabs: existingSessions,
          config: readTerminalConfig(),
          ...this.fileTreeHost.initPayload(),
        });
        if (!initDelivered) {
          console.error("[AnyWhere Terminal] init delivery failed during editor reload — skipping scrollback restore.");
          this.sessionManager.resumeOutputForView(this._viewId);
          return;
        }
        for (const session of existingSessions) {
          const scrollback = this.sessionManager.getScrollbackData(session.id);
          if (scrollback) {
            this.safePostMessage({ type: "restore", tabId: session.id, data: scrollback });
          }
        }
        this.sessionManager.resumeOutputForView(this._viewId);
      } else if (this.restoreSnapshots.length > 0) {
        // Phase B: cross-restart restore — consume staged snapshots from the
        // panel serializer and seed new sessions with the persisted metadata.
        for (const snap of this.restoreSnapshots) {
          const sessionId = this.sessionManager.createSession(this._viewId, this._panel.webview, {
            shell: settings.shell,
            shellArgs: settings.shellArgs,
            cwd: settings.cwd,
            restoreFrom: snap,
          });
          this.sessionManager.attachSessionToPanel(this._panelId, sessionId);
        }
        const restoredSessions = this.sessionManager.getAllSessionsForView(this._viewId);
        // Await init delivery before posting restoreFromSnapshot — same
        // W4 race as TerminalViewProvider. Pre-fix, a transient init drop
        // would deliver restoreFromSnapshot to a webview with no terminal
        // in store.terminals → deferOpen mis-wrap → blank editor tab.
        const initDelivered = await this.safeSendWithRetry({
          type: "init",
          tabs: restoredSessions,
          config: readTerminalConfig(),
          ...this.fileTreeHost.initPayload(),
        });
        if (!initDelivered) {
          console.error(
            "[AnyWhere Terminal] init delivery failed during editor restore — skipping restoreFromSnapshot posts.",
          );
          this.sessionManager.resumeOutputForView(this._viewId);
          return;
        }
        for (const snap of this.restoreSnapshots) {
          this.safePostMessage({
            type: "restoreFromSnapshot",
            tabId: snap.metadata.sessionId,
            serializedBuffer: snap.buffer,
            cols: snap.metadata.cols,
            rows: snap.metadata.rows,
            snapshotAt: snap.metadata.snapshotAt,
            shellExited: snap.metadata.shellExited,
            exitCode: snap.metadata.exitCode,
            isSplitPane: snap.metadata.isSplitPane,
          });
        }
        // Resume output flushing for sessions paused by createSession({restoreFrom}).
        // Order is now: init → restoreFromSnapshot (per session) → buffered PTY
        // output flush. See round-1 B3.
        this.sessionManager.resumeOutputForView(this._viewId);
      } else {
        // Cold open: existing behaviour — spawn a fresh session.
        const newSessionId = this.sessionManager.createSession(this._viewId, this._panel.webview, {
          shell: settings.shell,
          shellArgs: settings.shellArgs,
          cwd: settings.cwd,
        });
        this.sessionManager.attachSessionToPanel(this._panelId, newSessionId);
        const tabs = this.sessionManager.getTabsForView(this._viewId);
        void this.safeSendWithRetry({
          type: "init",
          tabs,
          config: readTerminalConfig(),
          ...this.fileTreeHost.initPayload(),
        });
      }
    } catch (err) {
      console.error("[AnyWhere Terminal] Failed to initialize editor terminal:", err);

      void this.safeSendWithRetry({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to initialize terminal",
        severity: "error",
      });
    }
  }

  /**
   * Safely post a message to the webview, handling both sync throws and async rejections.
   */
  private safePostMessage(message: unknown): void {
    try {
      void (this._panel.webview.postMessage(message) as Thenable<boolean>).then(undefined, () => {
        // Async rejection — webview may be disposed
      });
    } catch {
      // Sync throw — webview may be disposed
    }
  }

  /**
   * Post a message with retry logic for transient postMessage failures.
   * Retries up to `maxRetries` times with a 50ms delay between attempts.
   * Returns true if delivered, false if all attempts failed. Mirrors the
   * implementation in TerminalViewProvider so editor + sidebar/panel
   * providers share the same delivery guarantee. See .reviews/round-4.md [W1].
   */
  private async safeSendWithRetry(message: unknown, maxRetries = 2): Promise<boolean> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await (this._panel.webview.postMessage(message) as Thenable<boolean>);
        if (result) {
          return true;
        }
      } catch {
        // Sync or async failure — will retry
      }
      if (attempt < maxRetries) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
    }
    return false;
  }
}
