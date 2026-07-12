import * as fs from "node:fs/promises";
import * as vscode from "vscode";
import { descendantPids } from "../pty/processTree";
import { type ResolveClaudeSessionDeps, resolveClaudeSession } from "../session/resolveClaudeSession";
import type { SessionManager } from "../session/SessionManager";
import { readTerminalConfig, readTerminalSettings } from "../settings/SettingsReader";
import type { ThemeChangedMessage, WebViewToExtensionMessage } from "../types/messages";
import { buildResumeCommandString, type LaunchMode } from "../vault/LaunchBuilder";
import { readClaudeSessions, resolveClaudeSessionPath } from "../vault/readers/claudeReader";
import { listRunningClaudeSessions } from "../vault/readers/runningSessions";
import { resolveSubagentDetail, resolveSubagentDetailByEntryId } from "../vault/readers/subagentLookup";
import { agentKindForExecutable } from "../vault/registry";
import { parseEntryId, type VaultSessionEntry } from "../vault/types";
import { normalizeVaultCustomName } from "../vault/VaultCustomNameRegistry";
import type { VaultLauncher } from "../vault/VaultLauncher";
import type { VaultService } from "../vault/VaultService";
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
import { getTerminalHtml } from "./webviewHtml";

/** Coalesce a burst of store-watch events into one trailing list refresh
 *  (enhance-vault-sessions D4). Sits on top of the watcher's own 150ms debounce. */
const VAULT_STORE_REFRESH_DEBOUNCE_MS = 300;

/** Debounce live-follow re-reads of the previewed session (D5, ≥400ms): bounds
 *  re-parse cost during a rapid append burst on an active session. */
const VAULT_FOLLOW_REFRESH_DEBOUNCE_MS = 400;

/**
 * Map VSCode's `ColorThemeKind` to the four-way `ThemeChangedMessage["kind"]`
 * union the webview popup understands. See `design.md` D8 for the table.
 */
export function themeKindFor(kind: vscode.ColorThemeKind): ThemeChangedMessage["kind"] {
  switch (kind) {
    case vscode.ColorThemeKind.Light:
      return "light";
    case vscode.ColorThemeKind.Dark:
      return "dark";
    case vscode.ColorThemeKind.HighContrastLight:
      return "hc-light";
    case vscode.ColorThemeKind.HighContrast:
      return "hc-dark";
    default:
      // Should be unreachable — the union is closed in vscode.d.ts. Fall back
      // to dark as the conservative default (VSCode itself defaults to dark).
      return "dark";
  }
}

/**
 * WebviewViewProvider for sidebar and panel terminal views.
 *
 * The same class is instantiated per view location (sidebar, panel).
 * Each instance manages its own set of terminal sessions through a unique viewId.
 * All session operations are delegated to the shared SessionManager.
 *
 * See: docs/design/webview-provider.md
 */
export class TerminalViewProvider implements vscode.WebviewViewProvider {
  public static readonly sidebarViewType = "anywhereTerminal.sidebar";
  public static readonly panelViewType = "anywhereTerminal.panel";

  /** The active webview view instance. Set after resolveWebviewView, cleared on dispose. */
  private _view: vscode.WebviewView | undefined;

  /** Whether the webview has sent the 'ready' message. Gates outbound messages. */
  private _ready = false;

  /** Callback fired when this provider receives user interaction (message from webview). */
  private _onDidReceiveInteraction: (() => void) | undefined;

  /** Last active pane session ID reported by the webview (for split-pane aware routing). */
  private _lastActivePaneSessionId: string | undefined;

  /**
   * Monotonic token for vault-list refreshes. Bumped per `requestVaultSessions`;
   * a refresh whose token is stale by the time it resolves is dropped so an
   * out-of-order refresh never overwrites a newer one (cache-vault-load D7).
   */
  private _vaultRefreshSeq = 0;

  /**
   * In-flight hover-preview cancellation tokens, keyed by `sessionId`. A new
   * `requestFilePreview` for the same `sessionId` cancels + disposes the
   * prior entry before starting. Cleared on closeTab / requestCloseSplitPane
   * and on webview dispose.
   *
   * See: asimov/changes/add-hover-file-preview/design.md D9, D10
   */
  private readonly _previewTokens = new Map<string, vscode.CancellationTokenSource>();

  /**
   * Vault auto-refresh (enhance-vault-sessions D4): store-wide FS-watch
   * subscriptions (one per target dir) plus the coalescing trailing-refresh
   * timer. Armed when the view resolves, disposed with the view.
   */
  private _vaultStoreWatchers: vscode.Disposable[] = [];
  private _vaultStoreRefreshTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Vault live-follow (enhance-vault-sessions D5): AT MOST ONE follow watcher is
   * active — the previewed session. It is torn down on
   * `vaultWatchSession {entryId:null}` and on view dispose.
   */
  private _vaultFollowWatchers: vscode.Disposable[] = [];
  private _vaultFollowRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  /** Monotonic guard so a stale follow subscription (after a rapid switch) can't
   *  push a detail for a session that is no longer the followed one. */
  private _vaultFollowSeq = 0;

  /**
   * Shared file-tree wiring (rootGeneration counter, workspaceRoot getter,
   * onDidChangeWorkspaceFolders subscription, message dispatch). Same
   * instance lives on the editor provider; both delegate through it so the
   * three providers never drift out of sync. The optional
   * `gitDecorationProvider` is shared across all three providers — passing
   * the same singleton lets every webview see the same revision sequence.
   * See: design.md D10.
   */
  private readonly fileTreeHost: FileTreeHost;

  /** Public for external readers (extension.ts ctx commands). Forwarded to fileTreeHost. */
  get rootGeneration(): number {
    return this.fileTreeHost.rootGeneration;
  }

  /** Public for external readers. Forwarded to fileTreeHost. */
  get workspaceRoot(): string | null {
    return this.fileTreeHost.workspaceRoot;
  }

  /** Public accessor for the current webview view. */
  get view(): vscode.WebviewView | undefined {
    return this._view;
  }

  /** Register a callback to be notified when the user interacts with this view. */
  set onDidReceiveInteraction(callback: (() => void) | undefined) {
    this._onDidReceiveInteraction = callback;
  }

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessionManager: SessionManager,
    private readonly location: "sidebar" | "panel" = "sidebar",
    gitDecorationProvider: GitDecorationProvider | null = null,
    private readonly watcherPool: WatcherPool | null = null,
    /** AI coding vault — null in contexts where the vault is not wired (tests). */
    private readonly vaultService: VaultService | null = null,
    private readonly vaultLauncher: VaultLauncher | null = null,
  ) {
    this.fileTreeHost = new FileTreeHost(gitDecorationProvider, watcherPool);
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    // 1. Configure webview options
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };

    // 2. Set HTML content using shared utility
    webviewView.webview.html = getTerminalHtml(webviewView.webview, this.extensionUri, this.location);

    // 3. Wire message handler and lifecycle handlers
    const disposables: vscode.Disposable[] = [];

    disposables.push(
      webviewView.webview.onDidReceiveMessage((msg: unknown) => {
        this.handleMessage(msg, webviewView);
      }),
    );

    // 4a. Wire theme-change bridge — keep the popup-rendering theme in sync
    // with the user's active VSCode color theme.
    // See: asimov/changes/add-hover-file-preview/design.md D8
    disposables.push(
      vscode.window.onDidChangeActiveColorTheme((theme) => {
        if (!this._ready) {
          // onReady posts the initial theme; skip until then.
          return;
        }
        this.safePostMessage(webviewView.webview, {
          type: "themeChanged",
          kind: themeKindFor(theme.kind),
        } satisfies ThemeChangedMessage);
      }),
    );

    // 4a-bis. Wire hover-preview settings bridge — re-post on every change to
    // `anywhereTerminal.hoverPreview.*` so the webview controller / popup
    // pick up new debounce / wrap / disabled toggles without reload.
    // See: asimov/changes/add-hover-file-preview/design.md D17
    disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!affectsHoverPreview(event) || !this._ready) {
          return;
        }
        this.safePostMessage(webviewView.webview, {
          type: "hoverPreviewSettings",
          settings: readHoverPreviewSettings(),
        });
      }),
    );

    // 4a-ter. Workspace-folder bridge — delegated to fileTreeHost so the
    // sidebar / panel / editor providers stay in lockstep.
    disposables.push(
      this.fileTreeHost.attach({
        isReady: () => this._ready,
        post: (msg) => this.safePostMessage(webviewView.webview, msg),
      }),
    );

    // 4b. Wire visibility handler (for deferred resize on re-show + output pause/resume)
    disposables.push(
      webviewView.onDidChangeVisibility(() => {
        const viewId = this.getViewId();
        if (webviewView.visible) {
          // Resume output flushing when view becomes visible
          this.sessionManager.resumeOutputForView(viewId);
          if (this._ready) {
            this.safePostMessage(webviewView.webview, { type: "viewShow" });
          }
        } else {
          // Pause output flushing when view becomes hidden
          this.sessionManager.pauseOutputForView(viewId);
        }
      }),
    );

    // 4c. Arm the vault store-watchers (enhance-vault-sessions D4) so the list
    // auto-refreshes while the view is live. Disposed with the view below.
    this.armVaultStoreWatchers(webviewView.webview);

    // 5. Wire dispose handler — clean up subscriptions but preserve sessions for re-creation.
    // Sessions are anchored to the Extension Host lifecycle, not the WebView lifecycle.
    // They will be restored when resolveWebviewView is called again.
    webviewView.onDidDispose(() => {
      for (const d of disposables) {
        d.dispose();
      }
      // Cancel + dispose any in-flight preview tokens — see design.md D10.
      this.cancelAllPreviewTokens();
      // Release vault store + live-follow watchers (enhance-vault-sessions D4/D5).
      this.disposeVaultStoreWatchers();
      this.disposeVaultFollowWatchers();
      this._vaultFollowSeq++;
      // Pause output for the view — sessions survive but don't flush to a disposed webview
      this.sessionManager.pauseOutputForView(this.getViewId());
      this._view = undefined;
      this._ready = false;
      // Remove from the focus-recency stack so getLastFocusedProvider doesn't
      // pin a disposed provider. See `.reviews/round-1.md` W2.
      this.unmarkFocused();
    });
  }

  /**
   * Handle a hover-preview request. Supersedes any prior in-flight request for
   * the same session via the cancellation-token map.
   *
   * See: asimov/changes/add-hover-file-preview/design.md D9
   */
  private async handleRequestFilePreview(
    message: Extract<WebViewToExtensionMessage, { type: "requestFilePreview" }>,
    webview: vscode.Webview,
  ): Promise<void> {
    // Reject unknown sessionId BEFORE any resolution work. Without this, a
    // forged or stale id reaches `previewFileLink` where `trustBasesFor`
    // returns an empty list — historically that meant the trust check was
    // skipped entirely. Round-2 W3 plugs that hole on the host side too.
    if (!this.sessionManager.getSession(message.sessionId)) {
      return;
    }
    // Supersede: cancel + dispose any prior request for this session.
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
      // Drop the result if cancelled — webview already invalidated its requestId.
      if (result && !source.token.isCancellationRequested) {
        this.safePostMessage(webview, result);
      }
    } catch (err) {
      console.warn("[AnyWhere Terminal] requestFilePreview failed:", err);
    } finally {
      // Only remove the entry if it's STILL ours — a supersession may have
      // replaced the map value before we got here.
      if (this._previewTokens.get(message.sessionId) === source) {
        this._previewTokens.delete(message.sessionId);
      }
      // ALWAYS dispose our own source — this finally owns `source` exclusively.
      // Deferred from `cancelPreviewToken` (review round-1 W6) so the token
      // stays accessible to in-flight `isCancellationRequested` checks.
      try {
        source.dispose();
      } catch {
        // Best-effort.
      }
    }
  }

  /**
   * Cancel the in-flight preview token for `sessionId` and remove it from the
   * map. Does NOT dispose — that's deferred to the owning
   * `handleRequestFilePreview`'s finally block so its `await`-loop can still
   * observe `token.isCancellationRequested` safely.
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

  /** Cancel ALL in-flight preview tokens (called on webview dispose). Disposal is owned by the handlers. */
  private cancelAllPreviewTokens(): void {
    for (const sessionId of [...this._previewTokens.keys()]) {
      this.cancelPreviewToken(sessionId);
    }
  }

  /**
   * Serve the vault list with stale-while-revalidate (cache-vault-load D1): post
   * the persisted cache immediately (when present) for an instant render, then
   * refresh the agents' on-disk stores incrementally and post the reconciled
   * list. The on-disk stores remain the source of truth — the cache is only an
   * accelerator. A refresh superseded by a newer request is dropped (D7).
   */
  private async handleRequestVaultSessions(webview: vscode.Webview): Promise<void> {
    if (!this.vaultService) {
      return;
    }
    const token = ++this._vaultRefreshSeq;

    // Phase 1 — instant render from cache (no store scan). Absent on the first
    // ever open; then the panel paints immediately on every subsequent open.
    // Best-effort (NOT retried): a retried cache post could land AFTER the fresh
    // response and make a stale list win. If the webview isn't ready yet, the
    // authoritative fresh response below still populates it.
    const cached = this.vaultService.listCached();
    if (cached) {
      this.safePostMessage(webview, { type: "vaultSessionsResponse", result: cached, fromCache: true });
    }

    // Phase 2 — incremental refresh against the on-disk source of truth.
    try {
      const result = await this.vaultService.refresh();
      if (token !== this._vaultRefreshSeq) {
        return; // a newer request owns the list now — drop this stale refresh.
      }
      // Re-check supersession before EACH delivery attempt (not just here): a
      // newer request can arrive during safeSendWithRetry's 50ms retry sleep, and
      // a late retry of this now-stale list would otherwise overwrite the newer
      // one in the webview (review round-2 F4).
      void this.safeSendWithRetry(
        webview,
        { type: "vaultSessionsResponse", result, fromCache: false },
        2,
        () => token !== this._vaultRefreshSeq,
      );
    } catch (err) {
      console.error("[AnyWhere Terminal] Failed to list vault sessions:", err);
      // Don't clobber a successfully-rendered cache with an error notice; only
      // surface the error when there was nothing to show.
      if (!cached) {
        void this.safeSendWithRetry(webview, {
          type: "error",
          message: err instanceof Error ? err.message : "Failed to list AI vault sessions",
          severity: "error",
        });
      }
    }
  }

  /**
   * Resolve a vault entry into createSession options and launch it as a new
   * VISIBLE terminal — mirrors the `createTab` flow (createSession + post
   * `tabCreated`) so the resumed/forked agent appears as a selectable tab. A
   * resolve/launch failure surfaces an error notice rather than a broken
   * terminal (D5/D6).
   */
  private async handleVaultLaunch(entryId: string, mode: LaunchMode, webview: vscode.Webview): Promise<void> {
    if (!this.vaultLauncher) {
      return;
    }
    const viewId = this.getViewId();
    try {
      const opts = await this.vaultLauncher.resolve(entryId, mode);
      const newSessionId = this.sessionManager.createSession(viewId, webview, {
        shell: opts.shell,
        shellArgs: opts.shellArgs,
        cwd: opts.cwd,
        env: opts.env,
        isAgentLaunch: opts.isAgentLaunch,
      });
      const newSession = this.sessionManager.getSession(newSessionId);
      if (newSession) {
        void this.safeSendWithRetry(webview, {
          type: "tabCreated",
          tabId: newSessionId,
          name: newSession.name,
          customName: newSession.customName,
        });
      }
    } catch (err) {
      console.error("[AnyWhere Terminal] Failed to launch vault session:", err);
      void this.safeSendWithRetry(webview, {
        type: "error",
        message: err instanceof Error ? err.message : "Failed to launch AI session",
        severity: "error",
      });
    }
  }

  /**
   * On-demand session detail for the preview overlay. The webview sends the
   * entry id ONLY; `getDetail` resolves the session by id within the agent's
   * store (no full list, no cache — D3). The reply echoes `entryId` so the
   * webview can drop a stale response (D3 stale-render guard).
   */
  private async handleRequestVaultSessionDetail(
    entryId: string,
    webview: vscode.Webview,
    limit?: number,
  ): Promise<void> {
    if (!this.vaultService) {
      return;
    }
    try {
      const detail = await this.vaultService.getDetail(entryId, limit);
      void this.safeSendWithRetry(
        webview,
        detail
          ? { type: "vaultSessionDetailResponse", entryId, detail }
          : { type: "vaultSessionDetailResponse", entryId, error: "Session not found." },
      );
    } catch (err) {
      void this.safeSendWithRetry(webview, {
        type: "vaultSessionDetailResponse",
        entryId,
        error: err instanceof Error ? err.message : "Failed to read session detail",
      });
    }
  }

  /**
   * Rename a vault session (write-vault-rename-to-store D1/D3/D4). The name is
   * normalized once (trim + cap) and routed by agent:
   * - opencode/codex + non-empty name → write the real title into the agent's own
   *   SQLite store. On success the agent title is authoritative, so any sidecar
   *   overlay for this entry is cleared and the list is force-refreshed (a fresh
   *   read strictly after the write, never a pre-write in-flight one).
   * - native write failure, an empty (clearing) name, or claude/unknown agents →
   *   the sidecar overlay path (unchanged): served from `listCached()` instantly,
   *   falling back to `refresh()` when there is no cache yet.
   * Routes through `_vaultRefreshSeq` so the rename push wins over an older refresh.
   */
  private async handleVaultRenameSession(entryId: string, name: string, webview: vscode.Webview): Promise<void> {
    if (!this.vaultService) {
      return;
    }
    const normalized = normalizeVaultCustomName(name);
    const agent = parseEntryId(entryId)?.agent;
    const isSqliteAgent = agent === "opencode" || agent === "codex";

    if (isSqliteAgent && normalized !== null) {
      let wrote = false;
      try {
        wrote = await this.vaultService.writeNativeTitle(entryId, normalized);
      } catch (err) {
        console.error("[AnyWhere Terminal] Native vault rename failed:", err);
      }
      if (wrote) {
        // Agent-owned title is now the single source of truth — drop any overlay
        // for this entry and re-read the store fresh (force: skip a possibly
        // pre-write in-flight refresh so the new title actually surfaces).
        this.vaultService.setCustomName(entryId, "");
        const token = ++this._vaultRefreshSeq;
        try {
          const result = await this.vaultService.refresh({ force: true });
          if (token === this._vaultRefreshSeq) {
            this.safePostMessage(webview, { type: "vaultSessionsResponse", result, fromCache: false });
          }
        } catch (err) {
          console.error("[AnyWhere Terminal] Failed to refresh vault after native rename:", err);
          // Best-effort: serve the cached list so the panel isn't left spinning —
          // the native title lands on the next store-watcher refresh (review S2).
          const cached = this.vaultService.listCached();
          if (cached && token === this._vaultRefreshSeq) {
            this.safePostMessage(webview, { type: "vaultSessionsResponse", result: cached, fromCache: true });
          }
        }
        return;
      }
      // Native write did not stick → fall through to the overlay so the user still
      // sees their name.
    }

    // Overlay path: claude/unknown agent, an empty (clearing) name, or native fallback.
    this.vaultService.setCustomName(entryId, normalized ?? "");
    const token = ++this._vaultRefreshSeq;
    const cached = this.vaultService.listCached();
    if (cached) {
      this.safePostMessage(webview, { type: "vaultSessionsResponse", result: cached, fromCache: true });
      return;
    }
    try {
      const result = await this.vaultService.refresh();
      if (token === this._vaultRefreshSeq) {
        this.safePostMessage(webview, { type: "vaultSessionsResponse", result, fromCache: false });
      }
    } catch (err) {
      console.error("[AnyWhere Terminal] Failed to refresh vault after rename:", err);
    }
  }

  /**
   * Arm the store-wide auto-refresh watchers (enhance-vault-sessions D4/3_3):
   * one change-aware `subscribePattern` per store target. Any create/change/delete
   * schedules a debounced, coalesced `refresh()` + push. Idempotent — disposes any
   * prior set first (survives a re-resolve). No-op without a vault service or pool.
   */
  private armVaultStoreWatchers(webview: vscode.Webview): void {
    if (!this.vaultService || !this.watcherPool) {
      return;
    }
    this.disposeVaultStoreWatchers();
    const onEvent = () => this.scheduleVaultStoreRefresh(webview);
    for (const target of this.vaultService.getStoreWatchTargets()) {
      try {
        this._vaultStoreWatchers.push(
          this.watcherPool.subscribePattern(target.baseDir, target.glob, {
            create: onEvent,
            change: onEvent,
            delete: onEvent,
          }),
        );
      } catch (err) {
        console.error("[AnyWhere Terminal] Failed to watch vault store:", target.baseDir, err);
      }
    }
  }

  /** Coalesce a burst of store events into one trailing refresh (D4). */
  private scheduleVaultStoreRefresh(webview: vscode.Webview): void {
    if (this._vaultStoreRefreshTimer) {
      clearTimeout(this._vaultStoreRefreshTimer);
    }
    this._vaultStoreRefreshTimer = setTimeout(() => {
      this._vaultStoreRefreshTimer = undefined;
      void this.autoRefreshVaultList(webview);
    }, VAULT_STORE_REFRESH_DEBOUNCE_MS);
  }

  /** Refresh the list from disk and push it, dropping the result if a newer
   *  request (manual open / rename) has taken ownership (`_vaultRefreshSeq`). */
  private async autoRefreshVaultList(webview: vscode.Webview): Promise<void> {
    if (!this.vaultService) {
      return;
    }
    const token = ++this._vaultRefreshSeq;
    try {
      const result = await this.vaultService.refresh();
      if (token !== this._vaultRefreshSeq) {
        return;
      }
      void this.safeSendWithRetry(
        webview,
        { type: "vaultSessionsResponse", result, fromCache: false },
        2,
        () => token !== this._vaultRefreshSeq,
      );
    } catch (err) {
      console.error("[AnyWhere Terminal] Vault auto-refresh failed:", err);
    }
  }

  private disposeVaultStoreWatchers(): void {
    if (this._vaultStoreRefreshTimer) {
      clearTimeout(this._vaultStoreRefreshTimer);
      this._vaultStoreRefreshTimer = undefined;
    }
    for (const d of this._vaultStoreWatchers) {
      d.dispose();
    }
    this._vaultStoreWatchers = [];
  }

  /**
   * Live-follow the previewed session (enhance-vault-sessions D5/3_4). At most one
   * follow watcher is active: releases the prior one, then (for a non-null entry)
   * subscribes change-aware to that session's file(s)/DB. On change it re-reads the
   * bounded detail and pushes it with `followUpdate:true`. `_vaultFollowSeq` guards
   * against a stale subscription resolving after a rapid switch. `entryId:null`
   * releases the watcher.
   */
  private async handleVaultWatchSession(entryId: string | null, webview: vscode.Webview): Promise<void> {
    if (!this.vaultService || !this.watcherPool) {
      return;
    }
    this.disposeVaultFollowWatchers();
    const seq = ++this._vaultFollowSeq;
    if (!entryId) {
      return;
    }
    const targets = await this.vaultService.resolveSessionWatchTargets(entryId);
    if (seq !== this._vaultFollowSeq) {
      return; // a newer watch/close superseded this subscription while resolving.
    }
    const onEvent = () => this.scheduleVaultFollowRefresh(entryId, seq, webview);
    for (const target of targets) {
      try {
        this._vaultFollowWatchers.push(
          this.watcherPool.subscribePattern(target.baseDir, target.glob, {
            create: onEvent,
            change: onEvent,
            delete: onEvent,
          }),
        );
      } catch (err) {
        console.error("[AnyWhere Terminal] Failed to watch vault session:", entryId, err);
      }
    }
  }

  /** Coalesce a burst of follow events into one trailing bounded re-read (D5). */
  private scheduleVaultFollowRefresh(entryId: string, seq: number, webview: vscode.Webview): void {
    if (seq !== this._vaultFollowSeq) {
      return; // a stale watcher fired after a switch/close.
    }
    if (this._vaultFollowRefreshTimer) {
      clearTimeout(this._vaultFollowRefreshTimer);
    }
    this._vaultFollowRefreshTimer = setTimeout(() => {
      this._vaultFollowRefreshTimer = undefined;
      void this.pushVaultFollowDetail(entryId, seq, webview);
    }, VAULT_FOLLOW_REFRESH_DEBOUNCE_MS);
  }

  private async pushVaultFollowDetail(entryId: string, seq: number, webview: vscode.Webview): Promise<void> {
    if (!this.vaultService || seq !== this._vaultFollowSeq) {
      return;
    }
    try {
      const detail = await this.vaultService.getDetail(entryId);
      if (seq !== this._vaultFollowSeq) {
        return; // switched away while reading — drop this stale detail.
      }
      if (detail) {
        this.safePostMessage(webview, { type: "vaultSessionDetailResponse", entryId, detail, followUpdate: true });
      }
    } catch (err) {
      console.error("[AnyWhere Terminal] Vault follow re-read failed:", entryId, err);
    }
  }

  private disposeVaultFollowWatchers(): void {
    if (this._vaultFollowRefreshTimer) {
      clearTimeout(this._vaultFollowRefreshTimer);
      this._vaultFollowRefreshTimer = undefined;
    }
    for (const d of this._vaultFollowWatchers) {
      d.dispose();
    }
    this._vaultFollowWatchers = [];
  }

  /**
   * Resolve a terminal pane's REAL current working directory for the vault
   * "This folder only" filter. Prefers the live OS query (lsof/`/proc`, bounded
   * ≤500 ms), then the shell-integration-tracked cwd, then the spawn cwd; null
   * when none resolve (e.g. Windows / unknown pane). Resolves by `sessionId`
   * from our own SessionManager — never trusts a webview-supplied path. Echoes
   * `sessionId` so the webview can drop a reply for a no-longer-active pane.
   */
  private async handleRequestVaultContextCwd(sessionId: string, webview: vscode.Webview): Promise<void> {
    const cwd =
      (await this.sessionManager.getLiveCwd(sessionId)) ??
      this.sessionManager.getCurrentCwd(sessionId) ??
      this.sessionManager.getInitialCwd(sessionId) ??
      null;
    void this.safeSendWithRetry(webview, { type: "vaultContextCwd", sessionId, cwd });
  }

  /**
   * Resolve a clicked subagent (Task) line in a running Claude terminal to its
   * sub-session transcript: map the terminal to its live Claude `sessionId`
   * (process-tree ∩ PID registry, cwd/mtime fallback), then prefix-match the
   * clicked `description` against that session's subagent stubs. Replies with a
   * `subagentPreviewResponse` echoing `requestId`; a missing session / no match /
   * read error becomes an `error` marker — it never throws (design.md D3).
   */
  private async handleRequestSubagentPreview(
    message: Extract<WebViewToExtensionMessage, { type: "requestSubagentPreview" }>,
    webview: vscode.Webview,
  ): Promise<void> {
    const { terminalId, requestId, description, entryId } = message;
    try {
      // Nested drill-down: resolve the named child by its vault entryId (no live
      // terminal/description matching) and echo entryId so the popup routes the
      // reply to that nested block (support-nested-subagent-preview D5).
      if (entryId) {
        const nested = await resolveSubagentDetailByEntryId(entryId);
        void this.safeSendWithRetry(
          webview,
          nested
            ? { type: "subagentPreviewResponse", requestId, entryId, detail: nested }
            : { type: "subagentPreviewResponse", requestId, entryId, error: "notFound" },
        );
        return;
      }
      const session = await resolveClaudeSession(terminalId, this.subagentResolveDeps());
      if (!session) {
        void this.safeSendWithRetry(webview, { type: "subagentPreviewResponse", requestId, error: "noSession" });
        return;
      }
      const detail = await resolveSubagentDetail(session.sessionId, description);
      void this.safeSendWithRetry(
        webview,
        detail
          ? { type: "subagentPreviewResponse", requestId, detail }
          : { type: "subagentPreviewResponse", requestId, error: "notFound" },
      );
    } catch (err) {
      void this.safeSendWithRetry(webview, {
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
   * Resolve a vault entry from its id for a (rare) context-menu action. Uses the
   * same list-and-find path as `VaultLauncher.resolve` so the host derives every
   * path/cwd/command itself — the webview never sends a path to act on (D9).
   */
  private async resolveVaultEntry(entryId: string): Promise<VaultSessionEntry | undefined> {
    if (!this.vaultService) {
      return undefined;
    }
    const { entries } = await this.vaultService.list();
    return entries.find((e) => e.id === entryId);
  }

  /** Reveal the session's transcript file in the OS file manager. */
  private async handleVaultRevealInOS(entryId: string): Promise<void> {
    const sessionPath = (await this.resolveVaultEntry(entryId))?.sessionPath;
    if (!sessionPath) {
      return; // DB-backed session (no file) → no-op
    }
    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(sessionPath));
  }

  /** Open the session's transcript file in an editor. */
  private async handleVaultOpenSessionFile(entryId: string, webview: vscode.Webview): Promise<void> {
    const sessionPath = (await this.resolveVaultEntry(entryId))?.sessionPath;
    if (!sessionPath) {
      return;
    }
    try {
      await vscode.window.showTextDocument(vscode.Uri.file(sessionPath), { preview: true });
    } catch (err) {
      void this.safeSendWithRetry(webview, {
        type: "error",
        message: err instanceof Error ? err.message : "Failed to open session file",
        severity: "error",
      });
    }
  }

  /** Open the session's recorded working directory in the OS file manager. */
  private async handleVaultOpenWorkingDir(entryId: string): Promise<void> {
    const cwd = (await this.resolveVaultEntry(entryId))?.cwd;
    if (!cwd) {
      return;
    }
    await vscode.env.openExternal(vscode.Uri.file(cwd));
  }

  /** Build the session's resume command and copy it to the clipboard (host-side). */
  private async handleVaultCopyResumeCommand(entryId: string, webview: vscode.Webview): Promise<void> {
    const entry = await this.resolveVaultEntry(entryId);
    if (!entry) {
      return;
    }
    try {
      await vscode.env.clipboard.writeText(buildResumeCommandString(entry));
    } catch (err) {
      void this.safeSendWithRetry(webview, {
        type: "error",
        message: err instanceof Error ? err.message : "Failed to copy resume command",
        severity: "error",
      });
    }
  }

  /** Copy the session's transcript file path to the clipboard (host-side). */
  private async handleVaultCopyFilePath(entryId: string): Promise<void> {
    const sessionPath = (await this.resolveVaultEntry(entryId))?.sessionPath;
    if (!sessionPath) {
      return;
    }
    await vscode.env.clipboard.writeText(sessionPath);
  }

  /**
   * Route incoming webview messages to appropriate handlers.
   *
   * See: docs/design/webview-provider.md#§8, docs/design/message-protocol.md#§10
   */
  private handleMessage(msg: unknown, webviewView: vscode.WebviewView): void {
    // Basic shape validation
    if (!msg || typeof msg !== "object" || !("type" in msg) || typeof (msg as { type: unknown }).type !== "string") {
      console.warn("[AnyWhere Terminal] Invalid message from webview:", msg);
      return;
    }

    const message = msg as WebViewToExtensionMessage;

    // Notify that this provider received user interaction
    this._onDidReceiveInteraction?.();

    try {
      switch (message.type) {
        case "ready":
          void this.onReady(webviewView);
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
            // No agent gate: the CLI may be launched by hand (session.shell is the
            // plain shell, not the agent executable), so we can't detect "is an
            // agent" host-side. Preview-only — the CLI already received the image
            // natively (macOS Ctrl+V → \x16).
            const tabId = message.tabId;
            void readImageFromOsClipboard().then((img) => {
              this.safePostMessage(webviewView.webview, {
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
                this.safePostMessage(webviewView.webview, {
                  type: "clipboardImagePreview",
                  tabId,
                  mimeType: img.mimeType,
                  data: img.data,
                });
              } else {
                this.safePostMessage(webviewView.webview, { type: "osClipboardPasteMiss", tabId });
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
          const viewId = this.getViewId();
          const settings = readTerminalSettings();
          try {
            const newSessionId = this.sessionManager.createSession(viewId, webviewView.webview, {
              shell: settings.shell,
              shellArgs: settings.shellArgs,
              cwd: settings.cwd,
            });
            const newSession = this.sessionManager.getSession(newSessionId);
            if (newSession) {
              void this.safeSendWithRetry(webviewView.webview, {
                type: "tabCreated",
                tabId: newSessionId,
                name: newSession.name,
                customName: newSession.customName,
              });
            }
          } catch (err) {
            console.error("[AnyWhere Terminal] Failed to create tab:", err);
            void this.safeSendWithRetry(webviewView.webview, {
              type: "error",
              message: err instanceof Error ? err.message : "Failed to create new terminal tab",
              severity: "error",
            });
          }
          break;
        }

        case "requestVaultSessions":
          void this.handleRequestVaultSessions(webviewView.webview);
          break;

        case "vaultRenameSession":
          if (typeof message.entryId === "string" && typeof message.name === "string") {
            void this.handleVaultRenameSession(message.entryId, message.name, webviewView.webview);
          }
          break;

        case "vaultWatchSession":
          if (typeof message.entryId === "string" || message.entryId === null) {
            void this.handleVaultWatchSession(message.entryId, webviewView.webview);
          }
          break;

        case "vaultResume":
          if (typeof message.entryId === "string") {
            void this.handleVaultLaunch(message.entryId, "resume", webviewView.webview);
          }
          break;

        case "vaultFork":
          if (typeof message.entryId === "string") {
            void this.handleVaultLaunch(message.entryId, "fork", webviewView.webview);
          }
          break;

        case "requestVaultSessionDetail":
          if (typeof message.entryId === "string") {
            void this.handleRequestVaultSessionDetail(
              message.entryId,
              webviewView.webview,
              typeof message.limit === "number" ? message.limit : undefined,
            );
          }
          break;

        case "requestVaultContextCwd":
          if (typeof message.sessionId === "string") {
            void this.handleRequestVaultContextCwd(message.sessionId, webviewView.webview);
          }
          break;

        case "requestSubagentPreview":
          void this.handleRequestSubagentPreview(message, webviewView.webview);
          break;

        case "vaultRevealInOS":
          if (typeof message.entryId === "string") {
            void this.handleVaultRevealInOS(message.entryId);
          }
          break;

        case "vaultOpenSessionFile":
          if (typeof message.entryId === "string") {
            void this.handleVaultOpenSessionFile(message.entryId, webviewView.webview);
          }
          break;

        case "vaultOpenWorkingDir":
          if (typeof message.entryId === "string") {
            void this.handleVaultOpenWorkingDir(message.entryId);
          }
          break;

        case "vaultCopyResumeCommand":
          if (typeof message.entryId === "string") {
            void this.handleVaultCopyResumeCommand(message.entryId, webviewView.webview);
          }
          break;

        case "vaultCopyFilePath":
          if (typeof message.entryId === "string") {
            void this.handleVaultCopyFilePath(message.entryId);
          }
          break;

        case "switchTab":
          if (typeof message.tabId === "string") {
            this.sessionManager.switchActiveSession(this.getViewId(), message.tabId);
          }
          break;

        case "closeTab":
          if (typeof message.tabId === "string") {
            // Cancel any in-flight hover-preview for this session before destroying.
            this.cancelPreviewToken(message.tabId);
            this.sessionManager.destroySession(message.tabId);
            this.safePostMessage(webviewView.webview, {
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

        case "clear":
          if (typeof message.tabId === "string") {
            this.sessionManager.clearScrollback(message.tabId);
          }
          break;

        case "requestSplitSession": {
          if (
            typeof (message as { direction?: unknown }).direction === "string" &&
            typeof (message as { sourcePaneId?: unknown }).sourcePaneId === "string"
          ) {
            const splitMsg = message as {
              direction: "horizontal" | "vertical";
              sourcePaneId: string;
              rootTabId?: string;
            };
            const viewId = this.getViewId();
            const splitSettings = readTerminalSettings();
            try {
              const newSessionId = this.sessionManager.createSession(viewId, webviewView.webview, {
                isSplitPane: true,
                shell: splitSettings.shell,
                shellArgs: splitSettings.shellArgs,
                cwd: splitSettings.cwd,
                // Propagate root-tab identity for atomic group eviction (round-1 B4).
                // Older webviews (legacy IPC shape) omit rootTabId — fall through.
                rootTabId: splitMsg.rootTabId,
              });
              const newSession = this.sessionManager.getSession(newSessionId);
              if (newSession) {
                void this.safeSendWithRetry(webviewView.webview, {
                  type: "splitPaneCreated",
                  sourcePaneId: splitMsg.sourcePaneId,
                  newSessionId,
                  newSessionName: newSession.name,
                  direction: splitMsg.direction,
                });
              }
            } catch (err) {
              console.error("[AnyWhere Terminal] Failed to create split session:", err);
              void this.safeSendWithRetry(webviewView.webview, {
                type: "error",
                message: err instanceof Error ? err.message : "Failed to create split terminal",
                severity: "error",
              });
            }
          }
          break;
        }

        case "requestCloseSplitPane": {
          if (typeof (message as { sessionId?: unknown }).sessionId === "string") {
            const closeMsg = message as { sessionId: string };
            this.cancelPreviewToken(closeMsg.sessionId);
            this.sessionManager.destroySession(closeMsg.sessionId);
          }
          break;
        }

        case "focus":
          // Track the active pane session ID for split-pane-aware command routing
          if (typeof message.activeSessionId === "string") {
            this._lastActivePaneSessionId = message.activeSessionId;
          }
          // Mark this provider as most-recently focused so the rename command
          // can resolve "current tab" without per-view context keys.
          // See add-tab-rename design.md D5.
          this.markFocused();
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
            void this.handleRequestFilePreview(message, webviewView.webview);
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
          this.fileTreeHost.handleMessage(message, (response) => this.safePostMessage(webviewView.webview, response));
          break;

        case "updateHoverPreviewSetting":
          // Webview-driven setting update (e.g. footer toggle). Persist into
          // vscode's user-scope configuration; the change fires
          // onDidChangeConfiguration which re-posts `hoverPreviewSettings` back
          // to the webview. See: design.md D17.
          if (
            typeof (message as { key?: unknown }).key === "string" &&
            (typeof (message as { value?: unknown }).value === "boolean" ||
              typeof (message as { value?: unknown }).value === "number")
          ) {
            void updateHoverPreviewSetting(
              (message as { key: string }).key as Parameters<typeof updateHoverPreviewSetting>[0],
              (message as { value: boolean | number }).value,
            ).catch((err) => {
              console.warn("[AnyWhere Terminal] updateHoverPreviewSetting failed:", err);
            });
          }
          break;

        default:
          // Silently ignore unknown message types
          break;
      }
    } catch (err) {
      console.error(`[AnyWhere Terminal] Error handling message ${message.type}:`, err);
      // Don't rethrow — isolated error shouldn't crash the provider
    }
  }

  /**
   * Handle the 'ready' message from the webview.
   * On first creation: creates a session via SessionManager and sends 'init'.
   * On re-creation: restores existing sessions with scrollback data.
   *
   * See: specs/ipc-wiring/spec.md#Ready-Handshake-Wiring
   * See: specs/view-lifecycle-resilience/spec.md#Scrollback-Cache-Replay-on-Webview-Re-creation
   */
  private async onReady(webviewView: vscode.WebviewView): Promise<void> {
    // Mark webview as ready — gates outbound messages
    this._ready = true;

    // Post the initial theme so the hover-preview renderer can pick the
    // correct Shiki theme before the first hover. Subsequent changes flow
    // through the onDidChangeActiveColorTheme subscription wired in
    // resolveWebviewView.
    this.safePostMessage(webviewView.webview, {
      type: "themeChanged",
      kind: themeKindFor(vscode.window.activeColorTheme.kind),
    } satisfies ThemeChangedMessage);

    // Post initial hover-preview settings so the controller picks up the
    // user's `delay` / `enabled` / `blockSensitive` before the first hover.
    // Subsequent edits flow through the onDidChangeConfiguration subscription
    // wired in resolveWebviewView.
    this.safePostMessage(webviewView.webview, {
      type: "hoverPreviewSettings",
      settings: readHoverPreviewSettings(),
    });

    try {
      const viewId = this.getViewId();
      const existingSessions = this.sessionManager.getAllSessionsForView(viewId);

      if (existingSessions.length > 0) {
        // Re-creation scenario: sessions already exist for this view
        // Update webview references for all existing sessions
        this.sessionManager.updateWebviewForView(viewId, webviewView.webview);

        // Send 'init' message with all existing sessions (roots + splits, see
        // restore-terminal-sessions design.md D12) — splits MUST be present so
        // the webview can recreate every xterm referenced by `tabLayouts`.
        //
        // Await delivery before posting `restore` payloads. Same race as
        // round-2 [W4] on Phase B: if `safeSendWithRetry`'s first attempt
        // fails, it schedules a 50ms retry — a synchronous post-loop would
        // enqueue `restore` first, the webview would look up `store.terminals`
        // for a tabId that doesn't exist yet (no init processed), and the
        // restore payload would be silently dropped. User-visible: tab strip
        // populated, terminal content blank. See `restore` handler in main.ts.
        const initDelivered = await this.safeSendWithRetry(webviewView.webview, {
          type: "init",
          tabs: existingSessions,
          config: readTerminalConfig(),
          ...this.fileTreeHost.initPayload(),
        });
        if (!initDelivered) {
          console.error("[AnyWhere Terminal] init delivery failed during reload — skipping restore posts.");
          this.sessionManager.resumeOutputForView(viewId);
          return;
        }

        // Send 'restore' messages with scrollback data for each session
        for (const session of existingSessions) {
          const scrollbackData = this.sessionManager.getScrollbackData(session.id);
          if (scrollbackData) {
            this.safePostMessage(webviewView.webview, {
              type: "restore",
              tabId: session.id,
              data: scrollbackData,
            });
          }
        }

        // Resume output flushing for the view
        this.sessionManager.resumeOutputForView(viewId);
      } else if (this.sessionManager.hasSnapshotsForLocation(this.location)) {
        // Cross-restart restore: this.location has persisted snapshots staged
        // by `hydrateFromSnapshots`. See: restore-terminal-sessions design.md D7, D12.
        const settings = readTerminalSettings();
        const snaps = this.sessionManager.consumeSnapshotsForLocation(this.location);
        for (const snap of snaps) {
          this.sessionManager.createSession(viewId, webviewView.webview, {
            shell: settings.shell,
            shellArgs: settings.shellArgs,
            cwd: settings.cwd,
            restoreFrom: snap,
          });
        }
        const restoredSessions = this.sessionManager.getAllSessionsForView(viewId);
        // Await init delivery before posting restoreFromSnapshot. If
        // safeSendWithRetry's first attempt fails and schedules a 50ms retry,
        // a synchronous post-loop would enqueue restoreFromSnapshot first —
        // the webview would then see the snapshot before the tab even exists
        // and fall into the deferOpen path, reintroducing the W4 mis-wrap.
        // See round-2 [W4].
        const initDelivered = await this.safeSendWithRetry(webviewView.webview, {
          type: "init",
          tabs: restoredSessions,
          config: readTerminalConfig(),
          ...this.fileTreeHost.initPayload(),
        });
        if (!initDelivered) {
          // All retries failed — the webview channel is unhealthy. Posting
          // restoreFromSnapshot now would arrive at a webview that never
          // processed init, falling into the same deferOpen mis-wrap W4 was
          // closing. Log and skip the restore loop; the persisted snapshots
          // remain on disk and will be retried on the next activate. Output
          // resume still fires so the fresh PTY isn't permanently paused.
          console.error(
            "[AnyWhere Terminal] init delivery failed during restore — skipping restoreFromSnapshot posts.",
          );
          this.sessionManager.resumeOutputForView(viewId);
          return;
        }
        for (const snap of snaps) {
          this.safePostMessage(webviewView.webview, {
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
        this.sessionManager.resumeOutputForView(viewId);
      } else {
        // First-time creation: create initial session with resolved settings
        const settings = readTerminalSettings();
        this.sessionManager.createSession(viewId, webviewView.webview, {
          shell: settings.shell,
          shellArgs: settings.shellArgs,
          cwd: settings.cwd,
        });

        // Get tabs for the init message
        const tabs = this.sessionManager.getTabsForView(viewId);

        // Send 'init' message to the webview with resolved config (with retry)
        void this.safeSendWithRetry(webviewView.webview, {
          type: "init",
          tabs,
          config: readTerminalConfig(),
          ...this.fileTreeHost.initPayload(),
        });
      }
    } catch (err) {
      // Spawn failure: send error message (with retry for transient failures)
      console.error("[AnyWhere Terminal] Failed to initialize terminal:", err);

      void this.safeSendWithRetry(webviewView.webview, {
        type: "error",
        message: err instanceof Error ? err.message : "Failed to initialize terminal",
        severity: "error",
      });
    }
  }

  /**
   * Safely post a message to the webview, handling both sync throws and async rejections.
   * Returns void — fire-and-forget with error logging.
   */
  private safePostMessage(webview: vscode.Webview, message: unknown): void {
    try {
      void (webview.postMessage(message) as Thenable<boolean>).then(undefined, () => {
        // Async rejection — webview may be disposed
      });
    } catch {
      // Sync throw — webview may be disposed
    }
  }

  /**
   * Post a message with retry logic for transient postMessage failures.
   * Retries up to `maxRetries` times with a 50ms delay between attempts.
   * Returns true if the message was delivered, false if all attempts failed.
   * Used for critical messages (init, tabCreated, splitPaneCreated, error).
   */
  private async safeSendWithRetry(
    webview: vscode.Webview,
    message: unknown,
    maxRetries = 2,
    shouldAbort?: () => boolean,
  ): Promise<boolean> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Bail before every attempt (including before a retry) when the caller
      // signals this send is superseded — a late retry must not overwrite newer
      // data the caller has since posted (review round-2 F4).
      if (shouldAbort?.()) {
        return false;
      }
      try {
        const result = await (webview.postMessage(message) as Thenable<boolean>);
        if (result) {
          return true;
        }
      } catch {
        // Sync or async failure — will retry
      }
      // Wait before retrying (skip delay on last attempt)
      if (attempt < maxRetries) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
    }
    return false;
  }

  /**
   * Get the view ID for session tracking.
   */
  getViewId(): string {
    return this.location === "sidebar" ? TerminalViewProvider.sidebarViewType : TerminalViewProvider.panelViewType;
  }

  /**
   * Get the active session ID for this view.
   *
   * Prefers the last-known active pane session ID (reported by webview focus events)
   * for correct split-pane routing. Falls back to the active tab ID from SessionManager.
   * Returns undefined if no sessions exist or no session is active.
   */
  getActiveSessionId(): string | undefined {
    // Prefer pane-level session ID for split-pane accuracy
    if (this._lastActivePaneSessionId && this.sessionManager.getSession(this._lastActivePaneSessionId)) {
      return this._lastActivePaneSessionId;
    }
    const tabs = this.sessionManager.getTabsForView(this.getViewId());
    const activeTab = tabs.find((t) => t.isActive);
    return activeTab?.id;
  }

  /**
   * Get the **root tab** id for the active tab in this view — distinct from
   * `getActiveSessionId()` which prefers a split-pane session id when active.
   * Rename always targets the root tab, never a split pane (see
   * add-tab-rename design.md D5).
   *
   * Returns undefined when this view has no sessions or no active tab.
   */
  getActiveTabId(): string | undefined {
    return this.sessionManager.getTabsForView(this.getViewId()).find((t) => t.isActive)?.id;
  }

  /**
   * Returns the most recently focused TerminalViewProvider whose webview is
   * still visible. Walks providers in focus-recency order so when the most
   * recently focused provider is hidden (e.g. user collapsed the panel after
   * focusing it), we fall back to the next-most-recent visible provider —
   * typically the sidebar that's still on screen. See `.reviews/round-1.md` W2.
   *
   * "Focused" is tracked via the webview's `focus` IPC message — see
   * `_focusOrder` update site inside `markFocused`.
   */
  static getLastFocusedProvider(): TerminalViewProvider | undefined {
    for (const p of TerminalViewProvider._focusOrder) {
      if (p._view?.visible) {
        return p;
      }
    }
    return undefined;
  }

  /**
   * Most-recently-focused providers, in descending recency order (index 0 is
   * most recent). Cleared per-instance on dispose so the array doesn't pin
   * stale providers in memory.
   */
  private static _focusOrder: TerminalViewProvider[] = [];

  /** Test-only hook: clear the recency stack (e.g. between tests). */
  static _resetLastFocused(): void {
    TerminalViewProvider._focusOrder = [];
  }

  /**
   * Internal: hoist this provider to the front of the recency stack. Called on
   * every `focus` IPC message from this provider's webview.
   */
  private markFocused(): void {
    const order = TerminalViewProvider._focusOrder;
    const i = order.indexOf(this);
    if (i === 0) {
      return; // already most recent
    }
    if (i > 0) {
      order.splice(i, 1);
    }
    order.unshift(this);
  }

  /** Internal: remove this provider from the recency stack (called on dispose). */
  private unmarkFocused(): void {
    const order = TerminalViewProvider._focusOrder;
    const i = order.indexOf(this);
    if (i !== -1) {
      order.splice(i, 1);
    }
  }
}
