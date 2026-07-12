// src/webview/terminal/TerminalFactory.ts — Terminal creation and configuration
//
// Encapsulates terminal instance creation, addon loading, WebGL management,
// input handler wiring, and config application.
//
// See: docs/design/xterm-integration.md#§3-§6

import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import type { HoverPreviewSettings, TerminalConfig } from "../../types/messages";
import type { VaultSessionDetail } from "../../vault/types";
import { type ClipboardProvider, createKeyEventHandler } from "../InputHandler";
import { FilePathLinkProvider } from "../links/FilePathLinkProvider";
import { HoverPreviewController, type HoverPreviewThemeKind } from "../links/HoverPreviewController";
import { HoverPreviewPopup } from "../links/HoverPreviewPopup";
import { ImagePlaceholderLinkProvider } from "../links/ImagePlaceholderLinkProvider";
import { createMarkdownRenderer } from "../links/markdownRenderer";
import { PastedImageStore } from "../links/PastedImageStore";
import { SubagentLinkProvider } from "../links/SubagentLinkProvider";
import { SubagentPreviewPopup } from "../links/SubagentPreviewPopup";
import { createSyntaxRenderer, isHighlighterReady, whenHighlighterReady } from "../links/syntaxRenderer";
import { fitTerminal as fitTerminalCore } from "../resize/XtermFitService";
import { createLeaf, getAllSessionIds } from "../SplitModel";
import type { TerminalInstance, WebviewStateStore } from "../state/WebviewStateStore";
import type { ThemeManager } from "../theme/ThemeManager";

// ─── TerminalFactory ────────────────────────────────────────────────

/** Dependencies injected into TerminalFactory. */
export interface TerminalFactoryDeps {
  themeManager: ThemeManager;
  store: WebviewStateStore;
  postMessage: (msg: unknown) => void;
  onTabBarUpdate: () => void;
  getIsComposing: () => boolean;
  /**
   * Reads the latest theme kind for the hover-preview popup. Driven by the
   * extension host's `themeChanged` IPC.
   */
  getHoverPreviewTheme: () => HoverPreviewThemeKind;
  /**
   * Reads the latest hover-preview settings (debounce, wrap, enabled, etc).
   * Driven by the host's `hoverPreviewSettings` IPC.
   */
  getHoverPreviewSettings: () => HoverPreviewSettings;
}

/**
 * Factory for creating and configuring terminal instances.
 *
 * Owns:
 * - `createTerminal()` — full terminal creation pipeline
 * - `attachInputHandler()` — keyboard/clipboard/onData wiring
 * - `getClipboardProvider()` — browser clipboard abstraction
 * - `getFontFamily()` — CSS variable font resolution
 * - `fitTerminal()` — fit-to-container delegation
 * - `applyConfig()` — partial config update to all terminals
 * - `getActivePaneTerminal()` — active pane terminal lookup
 * - `webglFailed` — WebGL failure tracking (prevents retries)
 */
export class TerminalFactory {
  /** Whether WebGL initialization has failed — prevents retrying on subsequent terminals. */
  private webglFailed = false;

  /** Monotonic counter for subagent-preview request-correlation ids. */
  private subagentReqSeq = 0;

  /** The single, factory-owned subagent preview popup (at most one open; D7). */
  // The popup posts `requestSubagentPreview{entryId}` for nested drill-down; the
  // arrow reads `this.postMessage` lazily (set in the constructor body, after this
  // field initializer runs) (support-nested-subagent-preview D5).
  private readonly subagentPopup = new SubagentPreviewPopup({ postMessage: (msg) => this.postMessage(msg) });

  private readonly themeManager: ThemeManager;
  private readonly store: WebviewStateStore;
  private readonly postMessage: (msg: unknown) => void;
  private readonly onTabBarUpdate: () => void;
  private readonly getIsComposing: () => boolean;
  private readonly getHoverPreviewTheme: () => HoverPreviewThemeKind;
  private readonly getHoverPreviewSettings: () => HoverPreviewSettings;

  /**
   * Active hover-preview controllers indexed by session id. main.ts routes
   * `filePreviewResult` to `controllers.get(sessionId).onMessage(msg)`.
   */
  readonly hoverControllers = new Map<string, HoverPreviewController>();

  /**
   * Per-terminal cache of images pasted into each session, indexed by session
   * id. The document-level paste listener writes here; the placeholder link
   * provider reads here. Disposed alongside the hover controller so its object
   * URLs are revoked on every teardown path (preview-pasted-images D2).
   */
  private readonly pastedImageStores = new Map<string, PastedImageStore>();

  constructor(deps: TerminalFactoryDeps) {
    this.themeManager = deps.themeManager;
    this.store = deps.store;
    this.postMessage = deps.postMessage;
    this.onTabBarUpdate = deps.onTabBarUpdate;
    this.getIsComposing = deps.getIsComposing;
    this.getHoverPreviewTheme = deps.getHoverPreviewTheme;
    this.getHoverPreviewSettings = deps.getHoverPreviewSettings;
  }

  /**
   * Attach a deferred-open terminal to its container and load the WebGL addon.
   * Used by the session-restore router after writing the persisted buffer +
   * divider so the first render frame already has the restored content.
   * See: asimov/changes/restore-terminal-sessions/design.md D8.
   */
  attachDeferredTerminal(instance: { terminal: Terminal; container: HTMLDivElement }): void {
    instance.terminal.open(instance.container);
    if (!this.webglFailed) {
      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon.dispose();
          this.webglFailed = true;
          console.warn("[AnyWhere Terminal] WebGL context lost, falling back to canvas renderer");
        });
        instance.terminal.loadAddon(webglAddon);
      } catch {
        this.webglFailed = true;
        console.warn("[AnyWhere Terminal] WebGL renderer failed, using canvas fallback for all future terminals");
      }
    }
  }

  /**
   * Fit a single terminal to its container.
   * Delegates to XtermFitService for dimension calculation,
   * then performs the resize if needed.
   */
  fitTerminal(instance: { terminal: Terminal; container: HTMLDivElement }): void {
    const parentElement = instance.terminal.element?.parentElement;
    if (!parentElement) {
      return;
    }

    const result = fitTerminalCore(instance.terminal, parentElement);
    if (result) {
      instance.terminal.resize(result.cols, result.rows);
    }
  }

  /**
   * Get the font family from CSS variables or use default.
   */
  getFontFamily(): string {
    const style = getComputedStyle(document.documentElement);
    const fontFamily = style.getPropertyValue("--vscode-editor-font-family").trim();
    return fontFamily || "monospace";
  }

  /** Build a ClipboardProvider from the browser's navigator.clipboard API. */
  getClipboardProvider(): ClipboardProvider | undefined {
    if (!navigator.clipboard) {
      return undefined;
    }
    return {
      readText: () => navigator.clipboard.readText(),
      writeText: (text: string) => navigator.clipboard.writeText(text),
    };
  }

  /**
   * Attach the custom key event handler and input wiring to a terminal.
   * Uses the extracted InputHandler module for testability.
   * See: docs/design/keyboard-input.md#§2
   */
  attachInputHandler(terminal: Terminal, tabId: string): void {
    const handler = createKeyEventHandler({
      terminal,
      clipboard: this.getClipboardProvider(),
      postMessage: (msg: unknown) => this.postMessage(msg),
      getActiveTabId: () => this.store.activeTabId,
      getIsComposing: this.getIsComposing,
      isMac: navigator.platform.includes("Mac"),
    });

    terminal.attachCustomKeyEventHandler(handler);

    // Wire terminal.onData -> send input to extension
    terminal.onData((data: string) => {
      // Check if this terminal has exited — don't forward input
      const instance = this.store.terminals.get(tabId);
      if (instance?.exited) {
        return;
      }

      this.postMessage({ type: "input", tabId, data });
    });
  }

  /**
   * Create a new terminal instance with addons.
   * See: docs/design/xterm-integration.md#§3-§6
   */
  createTerminal(
    id: string,
    name: string,
    config: TerminalConfig,
    isActive: boolean,
    customName: string | null = null,
    options?: { deferOpen?: boolean; isSplitPane?: boolean },
  ): TerminalInstance {
    const containerEl = document.getElementById("terminal-container");
    if (!containerEl) {
      throw new Error("[AnyWhere Terminal] #terminal-container not found");
    }

    // Create dedicated container div for this terminal
    const container = document.createElement("div");
    container.style.width = "100%";
    container.style.height = "100%";
    container.style.display = isActive ? "block" : "none";
    // VS Code native context menu support — always set on terminal container
    container.dataset.vscodeContext = JSON.stringify({
      webviewSection: "splitPane",
      paneSessionId: id,
    });
    containerEl.appendChild(container);

    // Create xterm.js Terminal with config. overviewRuler.width also drives
    // the vertical scrollbar width in xterm v6 (Viewport._getChangeOptions)
    // — 10px matches Monaco's default so the terminal scrollbar visually
    // matches the file-tree list scrollbar.
    const resolvedFontFamily = config.fontFamily || this.getFontFamily();
    const terminal = new Terminal({
      scrollback: config.scrollback || 10000,
      cursorBlink: config.cursorBlink ?? true,
      cursorStyle: "block",
      fontSize: config.fontSize || 14,
      fontFamily: resolvedFontFamily,
      macOptionIsMeta: false,
      macOptionClickForcesSelection: true,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: this.themeManager.getMinimumContrastRatio(),
      rightClickSelectsWord: false,
      fastScrollSensitivity: 5,
      tabStopWidth: 8,
      theme: this.themeManager.getTheme(),
      overviewRuler: { width: 10 },
    });

    // Load addons
    const fitAddon = new FitAddon();
    // VS Code webviews block window.open, so route the click through the
    // extension host which calls vscode.env.openExternal().
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      this.postMessage({ type: "openLink", url: uri });
    });
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    // Build the hover-preview controller + renderers + popup for this terminal.
    // The controller is also registered in `hoverControllers` so main.ts can
    // route `filePreviewResult` messages by session id.
    // See: asimov/changes/add-hover-file-preview/design.md "Architecture", D10
    const syntaxRenderer = createSyntaxRenderer({ getTheme: this.getHoverPreviewTheme });
    const markdownRenderer = createMarkdownRenderer({ getTheme: this.getHoverPreviewTheme });
    // Schedule a re-render once the Shiki highlighter finishes loading. The
    // initial render at first-hover falls back to plain `<pre>` when the
    // singleton isn't yet ready (round-1 W4); this wrapper re-injects styled
    // HTML once Shiki resolves, only if the element is still in the DOM.
    //
    // `onAsyncRefresh` (round-2 W5) is invoked AFTER innerHTML replacement so
    // the popup can re-apply the active-line highlight + scroll. Without it,
    // the first hover with a `:line` suffix loses focus the moment Shiki
    // catches up (it replaces the plain-text DOM that held the active class).
    const renderCodeWithRefresh = (
      content: string,
      languageId: string,
      theme: HoverPreviewThemeKind,
      onAsyncRefresh?: () => void,
    ): HTMLElement => {
      const el = syntaxRenderer.renderElement(content, languageId, theme);
      if (!isHighlighterReady()) {
        void whenHighlighterReady().then(() => {
          if (el.isConnected) {
            el.innerHTML = syntaxRenderer.renderElement(content, languageId, theme).innerHTML;
            try {
              onAsyncRefresh?.();
            } catch {
              // Best-effort — popup's reapply must never throw out of here.
            }
          }
        });
      }
      return el;
    };
    const renderMarkdownWithRefresh = (
      content: string,
      theme: HoverPreviewThemeKind,
      onAsyncRefresh?: () => void,
    ): HTMLElement => {
      const el = markdownRenderer.render(content, theme);
      if (!isHighlighterReady()) {
        void whenHighlighterReady().then(() => {
          if (el.isConnected) {
            el.innerHTML = markdownRenderer.render(content, theme).innerHTML;
            try {
              onAsyncRefresh?.();
            } catch {
              // Best-effort.
            }
          }
        });
      }
      return el;
    };
    // Forward-declared so the popup's `onDismiss` callback can invalidate the
    // controller's `activeRequestId` even when dismissal originates inside
    // the popup itself (e.g. Escape key pressed while popup is shown).
    let hoverController: HoverPreviewController;
    const hoverPopup = new HoverPreviewPopup({
      renderCode: renderCodeWithRefresh,
      renderMarkdown: renderMarkdownWithRefresh,
      onDismiss: () => hoverController?.dismiss(),
      // Forward popup pointer enter/leave to the controller so the leave-grace
      // timer doesn't fire while the cursor is over the popup. Without these
      // hooks, `link.leave` dismisses the popup the instant the cursor crosses
      // the 12px gap between link and popup, blocking scroll/interaction.
      onPointerEnter: () => hoverController?.onPopupEnter(),
      onPointerLeave: () => hoverController?.onPopupLeave(),
      getSettings: () => this.getHoverPreviewSettings(),
      onUpdateSetting: (key, value) => this.postMessage({ type: "updateHoverPreviewSetting", key, value }),
      // Header "Open" button → reuse the same openFile flow as clicking the
      // underlined link in the terminal. Prefer absPath so the host's resolver
      // hits the absolute candidate first; fall back to the echoed request
      // path when absPath is absent (e.g. ambiguous match).
      onOpenFile: (result) => {
        const openPath =
          (result.status === "ok" ||
          result.status === "binary" ||
          result.status === "too-large" ||
          result.status === "requires-confirmation"
            ? result.absPath
            : undefined) ?? result.path;
        this.postMessage({
          type: "openFile",
          path: openPath,
          sessionId: id,
          ...(result.line !== undefined ? { line: result.line } : {}),
        });
      },
    });
    hoverController = new HoverPreviewController({
      terminal,
      sessionId: id,
      postMessage: (msg) => this.postMessage(msg),
      getTheme: this.getHoverPreviewTheme,
      popup: hoverPopup,
      debounceMs: this.getHoverPreviewSettings().delay,
    });
    this.hoverControllers.set(id, hoverController);

    // Per-terminal pasted-image cache. The placeholder link provider resolves a
    // hovered [Image #N] against it; the document-level paste listener (main.ts)
    // fills it at paste time. See preview-pasted-images D2/D4.
    const pastedImageStore = new PastedImageStore();
    this.pastedImageStores.set(id, pastedImageStore);

    // Register a custom link provider for file paths in terminal output.
    // Underlines + cursor:pointer come from xterm's built-in link decorations;
    // activation posts an `openFile` message that the extension host resolves
    // against the PTY's initial cwd and any workspace folder.
    terminal.registerLinkProvider(
      new FilePathLinkProvider({
        terminal,
        sessionId: id,
        postMessage: (msg) => this.postMessage(msg),
        platform: navigator.platform.includes("Win") ? "win32" : "posix",
        hoverController,
      }),
    );

    // Second link provider (additive): make Claude CLI subagent (Task) header
    // lines clickable → preview the sub-session transcript in a floating popup.
    // xterm allows multiple providers; file-path links are unaffected (D1).
    terminal.registerLinkProvider(
      new SubagentLinkProvider({
        terminal,
        onActivate: (agentType, description, x, y) => this.handleSubagentClick(id, agentType, description, x, y),
      }),
    );

    // Third link provider (additive): make [Image #N] / [Image N] placeholders
    // hoverable → preview the image captured at paste time. See D4/D5.
    terminal.registerLinkProvider(
      new ImagePlaceholderLinkProvider({
        terminal,
        store: pastedImageStore,
        hoverController,
      }),
    );

    // Open terminal in container. When `options.deferOpen === true`, the
    // caller is responsible for invoking `instance.terminal.open(container)`
    // later (used by the session-restore router which writes the persisted
    // buffer + divider into the terminal BEFORE attaching to the DOM — see
    // asimov/changes/restore-terminal-sessions/design.md D8).
    if (!options?.deferOpen) {
      terminal.open(container);

      // Try to enable WebGL renderer for better rendering on Retina displays.
      // Only meaningful AFTER open() — opening attaches the canvas.
      if (!this.webglFailed) {
        try {
          const webglAddon = new WebglAddon();
          webglAddon.onContextLoss(() => {
            webglAddon.dispose();
            this.webglFailed = true;
            console.warn("[AnyWhere Terminal] WebGL context lost, falling back to canvas renderer");
          });
          terminal.loadAddon(webglAddon);
        } catch {
          this.webglFailed = true;
          console.warn("[AnyWhere Terminal] WebGL renderer failed, using canvas fallback for all future terminals");
        }
      }
    }

    // Wire resize event -> send resize message to extension
    terminal.onResize(({ cols, rows }) => {
      this.postMessage({ type: "resize", tabId: id, cols, rows });
    });

    // Attach input handler (keyboard + clipboard + onData)
    this.attachInputHandler(terminal, id);

    const instance: TerminalInstance = {
      id,
      name,
      customName,
      terminal,
      container,
      exited: false,
      activityStatus: "idle",
    };

    this.store.terminals.set(id, instance);

    // Listen for OSC title change events
    terminal.onTitleChange((newTitle: string) => {
      if (newTitle) {
        instance.name = newTitle;
        this.onTabBarUpdate();
      }
    });

    // OSC 7 — shell-emitted current working directory updates. Modern shells
    // (bash with PS1 hook, zsh with chpwd hook, fish with --print-rusage-self,
    // VS Code shell integration scripts) emit
    //   ESC ] 7 ; file://<hostname>/<encoded-path> BEL
    // after every `cd`. The xterm parser strips the OSC 7 envelope and hands
    // us the data payload. We parse out the path, decode percent-escapes,
    // strip the host portion, and record it on the instance so the
    // right-click "Reveal in File Explorer" command can resolve the active
    // pane's pwd. Returning `false` lets other OSC 7 listeners (if any) see
    // the sequence too.
    terminal.parser.registerOscHandler(7, (data: string) => {
      // Pre-decode DoS gate. A `%XX`-heavy payload can balloon ~3x when
      // decoded, so cap the ENCODED form at 16 KB — comfortably above
      // PATH_MAX (4 KB Linux, 1 KB macOS) even when every byte is
      // percent-encoded. Anything larger is a bug or hostile.
      if (data.length > 16384) {
        return false;
      }
      // Strip optional `file://` scheme + hostname (xterm leaves the leading
      // scheme intact). Patterns: `file://host/path`, `file:///path` (empty
      // host), or sometimes just a bare path.
      let raw = data;
      const fileMatch = raw.match(/^file:\/\/([^/]*)(\/.*)$/);
      if (fileMatch) {
        raw = fileMatch[2];
      }
      let decoded: string;
      try {
        decoded = decodeURIComponent(raw);
      } catch {
        // Malformed escape — drop the OSC sequence rather than persisting a
        // half-decoded payload that downstream consumers can't trust.
        return false;
      }
      // PATH_MAX gate on the DECODED value (after percent-decode + scheme
      // strip). 4 KB matches Linux PATH_MAX; macOS is lower (1 KB) but
      // we accept up to PATH_MAX so non-conforming filesystems still work.
      if (decoded.length > 4096) {
        return false;
      }
      // Sanitize before writing. Same predicate as `src/pty/processCwd.ts`
      // sanitize() — rejecting control bytes and requiring an absolute path
      // closes a defense-in-depth gap where any process in the PTY (including
      // remote SSH or hostile binaries) can emit `\e]7;file:///etc\x07` or
      // arbitrary escapes. The downstream `fs.readDirectory` call is
      // metadata-only and `path.resolve` normalizes traversal — so this is
      // not a confidentiality boundary — but a pathological payload would
      // otherwise sit in `instance.cwd` indefinitely.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — reject control chars from untrusted shell output.
      if (/[\x00-\x1f\x7f]/.test(decoded)) {
        return false;
      }
      if (!/^(?:\/|[A-Za-z]:[\\/])/.test(decoded)) {
        return false;
      }
      // Linux /proc/<pid>/cwd appends " (deleted)" for unlinked directories.
      // OSC 7 won't realistically emit this (it's a /proc artifact, not a
      // shell concern) — but keeping it rejected makes the "same predicate
      // as processCwd.ts:sanitize()" comment literally true.
      if (decoded.endsWith(" (deleted)")) {
        return false;
      }
      instance.cwd = decoded;
      return false;
    });

    // Initialize split layout for this tab (single leaf). Skipped for split
    // panes — the layout is owned by the root tab, not the pane itself. See
    // restore-terminal-sessions design.md D12.
    if (!options?.isSplitPane && !this.store.tabLayouts.has(id)) {
      this.store.tabLayouts.set(id, createLeaf(id));
      this.store.tabActivePaneIds.set(id, id);
      this.store.persist();
    }

    // Split panes are never the `activeTabId` (that's a root-tab concept).
    if (isActive && !options?.isSplitPane) {
      this.store.activeTabId = id;
    }

    // Fit after opening (deferred to allow layout to settle).
    //
    // Split-pane children are NOT fit here — their container is reparented by
    // `renderTabSplitTree` AFTER this constructor returns, so a setTimeout(0)
    // measurement would see the still-detached container (0×0) and send a
    // stale resize IPC to the extension. `debouncedFitAllLeaves` (scheduled
    // by handleInit via requestAnimationFrame) owns split-pane sizing instead.
    // Root tabs still need the immediate fit so single-pane terminals get
    // measured before first PTY output. See round-2 [S2].
    if (!options?.isSplitPane) {
      setTimeout(() => {
        if (!this.store.terminals.has(id)) {
          return;
        }
        this.fitTerminal(instance);
        if (isActive) {
          terminal.focus();
        }
      }, 0);
    }

    return instance;
  }

  /**
   * Apply a partial config update to all terminal instances.
   * See: docs/design/xterm-integration.md#§8
   */
  applyConfig(config: Partial<TerminalConfig>): void {
    // Persist config changes for future tab creation
    if (config.fontSize !== undefined) {
      this.store.currentConfig.fontSize = config.fontSize;
    }
    if (config.cursorBlink !== undefined) {
      this.store.currentConfig.cursorBlink = config.cursorBlink;
    }
    if (config.scrollback !== undefined) {
      this.store.currentConfig.scrollback = config.scrollback;
    }
    if (config.fontFamily !== undefined) {
      this.store.currentConfig.fontFamily = config.fontFamily;
    }

    const needsRefit = config.fontSize !== undefined || config.fontFamily !== undefined;

    for (const instance of this.store.terminals.values()) {
      const term = instance.terminal;

      if (config.fontSize !== undefined) {
        // fontSize 0 means "inherit from editor" — use fallback
        term.options.fontSize = config.fontSize || 14;
      }
      if (config.cursorBlink !== undefined) {
        term.options.cursorBlink = config.cursorBlink;
      }
      if (config.scrollback !== undefined) {
        term.options.scrollback = config.scrollback;
      }
      if (config.fontFamily !== undefined) {
        // Empty fontFamily falls back to CSS variable → 'monospace'
        term.options.fontFamily = config.fontFamily || this.getFontFamily();
      }

      // Refit after font changes (affects cell dimensions)
      if (needsRefit) {
        this.fitTerminal(instance);
      }
    }
  }

  /**
   * Fit all terminal leaves in a tab's layout and focus the active pane.
   * Used by switchTab after the tab container is made visible.
   */
  fitAllAndFocus(tabId: string, fallbackInstance: TerminalInstance): void {
    const layout = this.store.tabLayouts.get(tabId);
    if (layout) {
      for (const sessionId of getAllSessionIds(layout)) {
        const instance = this.store.terminals.get(sessionId);
        if (instance) {
          this.fitTerminal(instance);
        }
      }
    } else {
      this.fitTerminal(fallbackInstance);
    }
    const activePaneId = this.store.tabActivePaneIds.get(tabId) ?? tabId;
    const activeInstance = this.store.terminals.get(activePaneId);
    if (activeInstance) {
      activeInstance.terminal.focus();
    } else {
      fallbackInstance.terminal.focus();
    }
  }

  /**
   * Dispose hover-preview controller for a session. Idempotent; safe to call
   * even when no controller is registered (e.g. terminal never opened).
   *
   * See: asimov/changes/add-hover-file-preview/design.md D10
   */
  disposeHoverController(sessionId: string): void {
    const controller = this.hoverControllers.get(sessionId);
    if (controller) {
      try {
        controller.dispose();
      } catch {
        // Best-effort.
      }
      this.hoverControllers.delete(sessionId);
    }
    // The pasted-image cache shares the controller's lifetime — dispose it on
    // every teardown path (tab + split close) so its object URLs are revoked.
    this.disposePastedImageStore(sessionId);
  }

  /** This terminal's pasted-image cache, for the document-level paste capture. */
  getPastedImageStore(sessionId: string): PastedImageStore | undefined {
    return this.pastedImageStores.get(sessionId);
  }

  /** Dispose + drop a session's pasted-image cache (revokes its object URLs). Idempotent. */
  disposePastedImageStore(sessionId: string): void {
    const store = this.pastedImageStores.get(sessionId);
    if (store) {
      try {
        store.dispose();
      } catch {
        // Best-effort.
      }
      this.pastedImageStores.delete(sessionId);
    }
  }

  /**
   * A subagent (Task) header link was clicked: open the single popup at the click
   * in a loading state (replacing any prior one) and post `requestSubagentPreview`
   * for the host to resolve. The matching `subagentPreviewResponse` fills the
   * popup via {@link fillSubagentPreview}, correlated by `requestId` (D3, D7).
   */
  private handleSubagentClick(terminalId: string, agentType: string, description: string, x: number, y: number): void {
    const requestId = `subagent-${++this.subagentReqSeq}`;
    // agentType is webview-display only (header badge); the host resolves by description.
    // terminalId is remembered so the popup's nested-drill-down requests can echo it.
    this.subagentPopup.open(requestId, agentType, description, x, y, terminalId);
    this.postMessage({ type: "requestSubagentPreview", terminalId, requestId, description, x, y });
  }

  /** Fill the open subagent popup with the host's response. A response carrying an
   *  `entryId` is a NESTED drill-down reply → route it to that block; otherwise it's
   *  the top-level transcript (matched by `requestId`) (support-nested-subagent-preview D5). */
  fillSubagentPreview(requestId: string, detail?: VaultSessionDetail, error?: string, entryId?: string): void {
    if (entryId) {
      this.subagentPopup.handleNestedResponse(entryId, detail, error);
    } else {
      this.subagentPopup.setContent(requestId, detail, error);
    }
  }

  /** Dispose the subagent popup. Idempotent; called on every terminal teardown (D7). */
  disposeSubagentPopup(): void {
    this.subagentPopup.dispose();
  }

  /** Get the terminal instance for the active pane in the current tab. */
  getActivePaneTerminal(): TerminalInstance | undefined {
    if (!this.store.activeTabId) {
      return undefined;
    }
    const activePaneId = this.store.tabActivePaneIds.get(this.store.activeTabId) ?? this.store.activeTabId;
    return this.store.terminals.get(activePaneId);
  }
}
