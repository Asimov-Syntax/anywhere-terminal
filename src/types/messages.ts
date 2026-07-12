// src/types/messages.ts — Shared message type definitions for AnyWhere Terminal
// Used by both Extension Host and WebView code.
// See: docs/design/message-protocol.md

import type { VaultListResult, VaultSessionDetail } from "../vault/types";

// ─── Shared Types ───────────────────────────────────────────────────

/** Terminal configuration (maps to anywhereTerminal.* settings). */
export interface TerminalConfig {
  /** Font size in pixels (0 = inherit from VS Code editor) */
  fontSize: number;
  /** Whether the cursor should blink */
  cursorBlink: boolean;
  /** Maximum number of lines in the scrollback buffer */
  scrollback: number;
  /** Font family (empty string = inherit from VS Code) */
  fontFamily: string;
}

// ─── File-Tree RPC Types ────────────────────────────────────────────
// See: asimov/changes/port-vscode-async-data-tree/design.md § Interfaces, D10

/** A single entry returned by `readDirectory()` — see design.md § Interfaces. */
/**
 * Approximation of VS Code's git decoration palette. Out-of-band statuses from
 * the built-in git extension (TYPE_CHANGED, COPIED, INTENT_TO_ADD/RENAME,
 * submodule) collapse into the nearest of these seven values via the host's
 * status mapper. See: asimov/changes/add-file-tree-git-decorations/design.md D2.
 */
export type GitStatus = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted" | "ignored";

export interface FileEntry {
  /** Basename (no path components). */
  name: string;
  /** Absolute path to the entry. */
  path: string;
  /** Whether the entry is a file or a directory. Symlinks are followed; if they resolve to neither, the entry is omitted. */
  kind: "file" | "directory";
  /**
   * True when git considers this entry ignored relative to the workspace root
   * (populated by `gitIgnoreChecker.getIgnoredPaths`). The host upgrades
   * `ignored: true` into `gitStatus: "ignored"` when no higher-severity status
   * exists, so the webview reads `gitStatus` as the single source of truth for
   * rendering — `ignored` is retained for hosts/tests that depend on the
   * existing field semantics.
   */
  ignored?: boolean;
  /**
   * Highest-severity git status for this entry, or omitted when the file has no
   * decoration. Set by the host's `GitDecorationProvider` when assembling the
   * read-directory response. See:
   * asimov/changes/add-file-tree-git-decorations/specs/git-decoration-source/spec.md.
   */
  gitStatus?: GitStatus;
  /**
   * Provider revision at which `gitStatus` was sampled. Always present when the
   * host has a working git provider — the webview uses it to reject stale
   * snapshots that race against fresher delta messages. See:
   * asimov/changes/add-file-tree-git-decorations/design.md D10.
   */
  gitRevision?: number;
  /**
   * Directory entries ONLY: per-status count of dirty descendants the git
   * provider currently tracks under this folder (any depth). Lets the
   * webview render the correct folder badge color BEFORE the user expands
   * the directory. Absent for file entries and for directories with no
   * dirty descendants. See:
   * asimov/changes/add-file-tree-fs-watcher/design.md D11.
   */
  dirtyDescendantCountsByStatus?: Partial<Record<GitStatus, number>>;
}

/** Position of the file-tree panel relative to the terminal area. */
export type FileTreePosition = "top" | "bottom" | "left" | "right";

// ─── WebView → Extension Messages ───────────────────────────────────

/** Sent once when the WebView DOM is fully loaded and xterm.js is initialized. */
export interface ReadyMessage {
  type: "ready";
}

/** Raw terminal input from the user (keystrokes, paste data, IME output). */
export interface InputMessage {
  type: "input";
  /** Target terminal session ID */
  tabId: string;
  /** Raw input data (may contain ANSI escape sequences) */
  data: string;
}

/** Terminal viewport resized (e.g., sidebar dragged, window resized). */
export interface ResizeMessage {
  type: "resize";
  /** Target terminal session ID */
  tabId: string;
  /** New column count */
  cols: number;
  /** New row count */
  rows: number;
}

/** User requested creation of a new terminal tab. */
export interface CreateTabMessage {
  type: "createTab";
}

/** User switched to a different terminal tab. */
export interface SwitchTabMessage {
  type: "switchTab";
  /** Tab to activate */
  tabId: string;
}

/** User requested closing a terminal tab. */
export interface CloseTabMessage {
  type: "closeTab";
  /** Tab to close */
  tabId: string;
}

/**
 * Inline-edit dblclick path for tab rename. Host normalizes (trim / empty→null /
 * truncate to 80 chars) and persists via `SessionManager.renameSession`. The host-
 * side triggers (right-click, command palette, F2) invoke `renameSession` directly
 * — they do NOT send this message.
 */
export interface RenameTabMessage {
  type: "renameTab";
  /** Target tab (root tab) session id */
  tabId: string;
  /**
   * Raw input from the inline `<input>`. Null/empty/whitespace-only resets the
   * tab to its auto-derived name. Host normalizes before storing.
   */
  customName: string | null;
}

/** User requested a new PTY session for a split pane. */
export interface RequestSplitSessionMessage {
  type: "requestSplitSession";
  /** Direction of the split */
  direction: "horizontal" | "vertical";
  /** Session ID of the pane being split */
  sourcePaneId: string;
  /**
   * Session ID of the root tab that owns the split tree containing
   * `sourcePaneId`. The extension propagates this onto the new pane's
   * `rootTabId` so cross-restart eviction can group split snapshots
   * atomically. See restore-terminal-sessions design.md D12 + round-1 B4.
   */
  rootTabId: string;
}

/** User requested destruction of a split pane's session. */
export interface RequestCloseSplitPaneMessage {
  type: "requestCloseSplitPane";
  /** Session ID of the pane to close */
  sessionId: string;
}

/** User requested terminal clear (scrollback + viewport). */
export interface ClearMessage {
  type: "clear";
  /** Target terminal session ID */
  tabId: string;
}

/** Acknowledgment that the WebView has processed terminal output data. */
export interface AckMessage {
  type: "ack";
  /** Number of characters processed (sent in batches of ACK_BATCH_SIZE = 5000) */
  charCount: number;
  /** Session ID this ack belongs to (routes ack to the correct OutputBuffer). */
  tabId: string;
}

/** Terminal view received focus (click/keyboard). Reports active pane session ID for split-pane routing. */
export interface FocusMessage {
  type: "focus";
  /** Active pane session ID (resolved from split layout, not tab ID) */
  activeSessionId?: string;
}

/** Request the extension host to open an external link (e.g. Cmd+Click on a URL in the terminal). */
export interface OpenLinkMessage {
  type: "openLink";
  /** Absolute URL to open in the user's default browser */
  url: string;
}

/** Request the extension host to open a file detected in terminal output. */
export interface OpenFileMessage {
  type: "openFile";
  /** Raw matched path text without any line/column suffix */
  path: string;
  /** Source terminal session id (used to look up the PTY's initial cwd) */
  sessionId: string;
  /** Optional 1-based line number parsed from the suffix */
  line?: number;
  /** Optional 1-based column number parsed from the suffix */
  col?: number;
}

/**
 * Webview → Extension: enumerate ALL files inside a scope folder for the
 * file-tree in-panel search. No query is included — the webview fuzzy-scores
 * the returned enumeration client-side per keystroke, so one RPC covers the
 * entire search session for the given (scope, rootGeneration) tuple.
 *
 * See: asimov/changes/add-file-tree-search/design.md D11.
 */
export interface RequestFileTreeSearchMessage {
  type: "request-file-tree-search";
  /** Correlation id — echoed in `FileTreeSearchResponseMessage.requestId`. */
  requestId: string;
  /** Webview's last-known workspace root generation. */
  rootGeneration: number;
  /** Absolute path to the scope folder to enumerate. */
  scopePath: string;
  /**
   * Optional cap on returned items. Host clamps to [1, 5000]; omit to use
   * the host default of 2000.
   */
  maxResults?: number;
}

/**
 * Webview → Extension: cancel the host's current in-flight file-tree search
 * enumeration. Sent when the user closes the search bar (Esc), exits the
 * panel, or the workspace root changes mid-flight — so the host's
 * `findFiles` + `git check-ignore` work doesn't run to completion just to
 * have its response dropped on arrival.
 */
export interface CancelFileTreeSearchMessage {
  type: "cancel-file-tree-search";
}

/** One file in the search-enumeration response. `relativePath` uses forward
 * slashes on ALL platforms so client-side fuzzy ranking is path-separator
 * agnostic. See: design.md D11. */
export interface FileTreeSearchResult {
  /** Absolute filesystem path (host-native separators). */
  absolutePath: string;
  /** Path relative to the request's `scopePath`, forward-slash separators. */
  relativePath: string;
}

/**
 * Webview → Extension: read a directory's entries for the file-tree panel.
 * The host echoes `rootGeneration` back in the response so the webview can
 * discard responses bound to a stale workspace root (see design D10).
 */
export interface RequestReadDirectoryMessage {
  type: "request-read-directory";
  /** Correlation id — echoed in `ReadDirectoryResponseMessage.requestId`. */
  requestId: string;
  /** Webview's last-known workspace root generation (see design D10). */
  rootGeneration: number;
  /** Absolute path to the directory whose children are requested. */
  path: string;
}

/**
 * Webview → Extension: user clicked the in-panel "Open Folder" button.
 * The extension shows a folder picker and, on confirm, posts
 * `reveal-in-file-tree` with `source: "openFolder"` on the host's stable
 * attach channel.
 */
export interface RequestOpenFolderMessage {
  type: "request-open-folder";
}

/**
 * Webview → Extension: ask the host to start watching `path` for create/delete
 * events. Fire-and-forget — no response is sent on success. The host:
 *   - validates `rootGeneration` matches its current value (drops on mismatch);
 *   - subscribes the path in the shared `WatcherPool` (refcounted across hosts);
 *   - posts `FsChangesInvalidatedMessage` when the path's debounced watcher fires.
 *
 * Re-subscribing the same path from the same webview is idempotent (host
 * dedupes by path in its per-host subscription map). See:
 * asimov/changes/add-file-tree-fs-watcher/specs/file-tree-rpc/spec.md.
 */
export interface RequestSubscribeFsChangesMessage {
  type: "request-subscribe-fs-changes";
  /** Webview's last-known workspace root generation. */
  rootGeneration: number;
  /** Absolute path of the directory to watch. */
  path: string;
}

/**
 * Webview → Extension: ask the host to stop watching the given paths.
 * Fire-and-forget. Bulk shape so eviction of a subtree only takes one
 * round-trip. Unknown paths in the array are silently ignored.
 */
export interface RequestUnsubscribeFsChangesMessage {
  type: "request-unsubscribe-fs-changes";
  /** Webview's last-known workspace root generation. */
  rootGeneration: number;
  /** Absolute paths to stop watching. */
  paths: string[];
}

/** Webview → Extension: reveal a file-tree row target in the OS file manager. */
export interface FileTreeRevealInOsMessage {
  type: "file-tree-reveal-in-os";
  /** Webview's last-known file-tree root generation. */
  rootGeneration: number;
  /** Absolute filesystem path to reveal. */
  path: string;
}

/** Webview → Extension: copy a file-tree row target's absolute path. */
export interface FileTreeCopyPathMessage {
  type: "file-tree-copy-path";
  /** Webview's last-known file-tree root generation. */
  rootGeneration: number;
  /** Absolute filesystem path to copy. */
  path: string;
}

/**
 * Webview → Extension: copy a file-tree row target relative to the
 * host-owned active file-tree root. The webview deliberately does NOT send a
 * base path; the host derives it from trusted state.
 */
export interface FileTreeCopyRelativePathMessage {
  type: "file-tree-copy-relative-path";
  /** Webview's last-known file-tree root generation. */
  rootGeneration: number;
  /** Absolute filesystem path to relativize. */
  path: string;
}

/** Webview → Extension: delete a file-tree row target after host confirmation. */
export interface FileTreeDeleteMessage {
  type: "file-tree-delete";
  /** Webview's last-known file-tree root generation. */
  rootGeneration: number;
  /** Absolute filesystem path to delete. */
  path: string;
}

/** Request the extension host to read a file for the hover preview popup. */
export interface RequestFilePreviewMessage {
  type: "requestFilePreview";
  /** Unique per-hover correlation id (echoed back in `filePreviewResult`). */
  requestId: string;
  /** Source terminal session id (used to resolve relative paths via cwd chain). */
  sessionId: string;
  /** Raw matched path text without any line/column suffix. */
  path: string;
  /** Optional 1-based line number parsed from the suffix. */
  line?: number;
  /** Optional 1-based column number parsed from the suffix. */
  col?: number;
  /**
   * When true, the host bypasses the trust-policy block (dotfile / sensitive
   * folder / out-of-workspace) that would otherwise return `requires-
   * confirmation`. Set by the webview when the user explicitly holds Cmd
   * (macOS) / Ctrl (Win/Linux) during the hover.
   */
  override?: boolean;
}

// ─── Vault RPC Types ─────────────────────────────────────────────────
// See: asimov/changes/add-ai-coding-vault/design.md § Interfaces, D5.

/** Webview → Extension: request the aggregated AI-agent session list. */
export interface RequestVaultSessionsMessage {
  type: "requestVaultSessions";
}

/** Webview → Extension: resume the given vault session in a new terminal. */
export interface VaultResumeMessage {
  type: "vaultResume";
  /** `<agent>:<sessionId>` id from a `VaultSessionEntry`. */
  entryId: string;
}

/** Webview → Extension: fork the given vault session in a new terminal. */
export interface VaultForkMessage {
  type: "vaultFork";
  /** `<agent>:<sessionId>` id from a `VaultSessionEntry`. */
  entryId: string;
}

// ── Session preview + context menu (redesign-vault-panel-ui D3, D9) ──
// Every one of these carries the entry `id` ONLY. The host resolves the
// session's on-disk location from the id within the agent's store and derives
// any path/cwd itself — it NEVER trusts a webview-supplied path.

/** Webview → Extension: read one session's bounded detail for the preview overlay. */
export interface RequestVaultSessionDetailMessage {
  type: "requestVaultSessionDetail";
  entryId: string;
  /**
   * Max timeline items to return (most-recent kept). Omitted on the initial
   * open (host uses its default); the webview sends a larger value to load
   * older messages when the user scrolls to the top of the transcript.
   */
  limit?: number;
}

/** Webview → Extension: reveal the session's file in the OS file manager. */
export interface VaultRevealInOSMessage {
  type: "vaultRevealInOS";
  entryId: string;
}

/** Webview → Extension: open the session's file in an editor. */
export interface VaultOpenSessionFileMessage {
  type: "vaultOpenSessionFile";
  entryId: string;
}

/** Webview → Extension: open the session's recorded working directory. */
export interface VaultOpenWorkingDirMessage {
  type: "vaultOpenWorkingDir";
  entryId: string;
}

/** Webview → Extension: copy the session's resume command to the clipboard (host-side). */
export interface VaultCopyResumeCommandMessage {
  type: "vaultCopyResumeCommand";
  entryId: string;
}

/** Webview → Extension: copy the session's file path to the clipboard (host-side). */
export interface VaultCopyFilePathMessage {
  type: "vaultCopyFilePath";
  entryId: string;
}

/**
 * Webview → Extension: set or clear a session's user custom name
 * (enhance-vault-sessions D1). An empty (after trim) `name` clears it, reverting
 * to the reader-derived title. Persisted in a sidecar registry — never in the
 * agent's own files.
 */
export interface VaultRenameSessionMessage {
  type: "vaultRenameSession";
  entryId: string;
  name: string;
}

/**
 * Webview → Extension: start/stop live-following the previewed session
 * (enhance-vault-sessions D5). `entryId` selects the session to watch;
 * `null` stops following (preview closed or switched). At most one follow
 * watcher is active per view.
 */
export interface VaultWatchSessionMessage {
  type: "vaultWatchSession";
  entryId: string | null;
}

/**
 * Webview → Extension: resolve the REAL current working directory of a terminal
 * pane (the host queries its own PTY: lsof/`/proc` live cwd, else the
 * shell-integration-tracked cwd, else the spawn cwd) so the vault's "This folder
 * only" filter can scope to the focused pane's actual folder — without depending
 * on OSC 7 / shell integration in the webview. The host resolves by `sessionId`
 * from its own SessionManager; it never trusts a webview-supplied path.
 */
export interface RequestVaultContextCwdMessage {
  type: "requestVaultContextCwd";
  /** The terminal pane (session) id whose live cwd the filter should scope to. */
  sessionId: string;
}

/**
 * Webview → Extension: the user clicked a Claude subagent (Task) invocation line
 * in live terminal output. The host resolves the terminal's running Claude
 * session and the clicked subagent (by `description` prefix) entirely from
 * `terminalId` — it never trusts a webview-supplied path — and replies with a
 * `subagentPreviewResponse` echoing `requestId`. See:
 * asimov/changes/preview-subagent-popup/design.md D3.
 */
/** Webview captured an image paste; host mirrors it to the OS clipboard then signals the PTY. */
export interface PasteClipboardImageMessage {
  type: "pasteClipboardImage";
  /** Active pane session id (same as `InputMessage.tabId`). */
  tabId: string;
  mimeType: string;
  /** Base64-encoded image bytes from the webview clipboard. */
  data: string;
}

/**
 * Webview → host: read the current OS clipboard image so the webview can cache
 * it for hover preview. Used for macOS Ctrl+V into OpenCode/Codex, where the CLI
 * reads the pasteboard natively but the webview Clipboard API can't see the
 * image (non-web format) — only the host can. The host always replies with
 * `clipboardImagePreview`; its `data` is "" when the clipboard holds no image.
 */
export interface RequestClipboardImagePreviewMessage {
  type: "requestClipboardImagePreview";
  /** Active pane session id — echoed back so the reply routes to the right store. */
  tabId: string;
}

/**
 * Webview → host: Windows-only empty paste event (no `image/*`, no plain text)
 * where the OS clipboard may still hold DIB/CF_BITMAP. The host reads the OS
 * clipboard and emits the PTY trigger on hit; replies with `clipboardImagePreview`
 * (cache) or `osClipboardPasteMiss` (no-op — text never uses this path).
 */
export interface PasteOsClipboardImageMessage {
  type: "pasteOsClipboardImage";
  /** Active pane session id — echoed back so the reply routes to the right store. */
  tabId: string;
}

/**
 * Host → webview: OS clipboard held no image after a `pasteOsClipboardImage`
 * request. Text paste is never deferred to this message (native paste path).
 */
export interface OsClipboardPasteMissMessage {
  type: "osClipboardPasteMiss";
  tabId: string;
}

/** Host → webview: OS clipboard image bytes for the preview cache (reply to the above). */
export interface ClipboardImagePreviewMessage {
  type: "clipboardImagePreview";
  tabId: string;
  mimeType: string;
  /** Base64-encoded image bytes read from the OS clipboard by the host; "" on miss. */
  data: string;
}

export interface RequestSubagentPreviewMessage {
  type: "requestSubagentPreview";
  /** Source terminal pane (session) id, used to resolve the running session. */
  terminalId: string;
  /** Correlation id — echoed in `SubagentPreviewResponseMessage.requestId`. */
  requestId: string;
  /** The subagent description captured verbatim from the terminal header line. */
  description: string;
  /** Click viewport coordinates — the popup anchor (`event.clientX/clientY`). */
  x: number;
  y: number;
  /**
   * NESTED drill-down (support-nested-subagent-preview D5): when set, the host
   * resolves THIS child by its vault `entryId` (`claude:<parentId>:subagent:<stem>`,
   * containment-checked) instead of the live terminal + `description` path, and the
   * response echoes the same `entryId` so the popup routes it to the right nested
   * block. Absent for the initial top-level click (`terminalId`+`description` path).
   */
  entryId?: string;
}

/**
 * All messages that can be sent from the WebView to the Extension Host.
 * Use msg.type as the discriminant in switch/case for exhaustive handling.
 */
export type WebViewToExtensionMessage =
  | ReadyMessage
  | InputMessage
  | ResizeMessage
  | CreateTabMessage
  | SwitchTabMessage
  | CloseTabMessage
  | RenameTabMessage
  | ClearMessage
  | AckMessage
  | RequestSplitSessionMessage
  | RequestCloseSplitPaneMessage
  | FocusMessage
  | OpenLinkMessage
  | OpenFileMessage
  | RequestFilePreviewMessage
  | RequestReadDirectoryMessage
  | RequestFileTreeSearchMessage
  | CancelFileTreeSearchMessage
  | RequestOpenFolderMessage
  | RequestSubscribeFsChangesMessage
  | RequestUnsubscribeFsChangesMessage
  | FileTreeRevealInOsMessage
  | FileTreeCopyPathMessage
  | FileTreeCopyRelativePathMessage
  | FileTreeDeleteMessage
  | UpdateHoverPreviewSettingMessage
  | PersistPanelIdMessage
  | ScrollbackDumpMessage
  | RequestVaultSessionsMessage
  | VaultResumeMessage
  | VaultForkMessage
  | RequestVaultSessionDetailMessage
  | VaultRevealInOSMessage
  | VaultOpenSessionFileMessage
  | VaultOpenWorkingDirMessage
  | VaultCopyResumeCommandMessage
  | VaultCopyFilePathMessage
  | VaultRenameSessionMessage
  | VaultWatchSessionMessage
  | RequestVaultContextCwdMessage
  | RequestSubagentPreviewMessage
  | PasteClipboardImageMessage
  | RequestClipboardImagePreviewMessage
  | PasteOsClipboardImageMessage;

/**
 * Webview → Extension. Sent by the editor webview after it has merged the
 * extension-supplied panelId into `vscode.setState({...})`. Lets the editor
 * provider know it is safe to assume VS Code will include the panelId in any
 * subsequent `WebviewPanelSerializer.deserializeWebviewPanel` payload.
 *
 * See: asimov/changes/restore-terminal-sessions/design.md D2.
 */
export interface PersistPanelIdMessage {
  type: "persistPanelId";
  panelId: string;
}

// ─── Extension → WebView Messages ───────────────────────────────────

/** Initial state sent to the WebView after the ready handshake. */
export interface InitMessage {
  type: "init";
  /** List of existing terminal tabs (at least one, the initial tab) */
  tabs: Array<{
    /** Unique session ID */
    id: string;
    /** Display name (e.g., "Terminal 1") */
    name: string;
    /** Persisted custom name for this tab (null when none). See add-tab-rename design.md D2. */
    customName: string | null;
    /** Whether this tab is currently active */
    isActive: boolean;
    /**
     * When true, the entry is a split-pane child of another root tab (not a
     * top-level tab in its own right). The webview MUST create the xterm
     * instance for the pane but skip per-tab side effects (no `tabLayouts`
     * leaf init, never the `activeTabId`). Required so that on reload /
     * cross-restart the layout tree in `WebviewStateStore.tabLayouts` finds
     * every referenced session in `validTabIds`. See restore-terminal-sessions
     * design.md D12 + round-1 W10 (locked the contract — now required).
     */
    isSplitPane: boolean;
  }>;
  /** Terminal configuration from user settings */
  config: TerminalConfig;
  /**
   * Monotonic workspace-root generation (see design D10). Incremented every
   * time `vscode.workspace.onDidChangeWorkspaceFolders` fires. Webview pins
   * this on init; file-tree RPC carries it back so stale responses can be
   * dropped.
   */
  rootGeneration: number;
  /** Absolute path of the first workspace folder, or null if no workspace open. */
  workspaceRoot: string | null;
}

/**
 * Buffered PTY output data.
 * May contain raw text, ANSI escape sequences, and control characters.
 */
export interface OutputMessage {
  type: "output";
  /** Source terminal session ID */
  tabId: string;
  /** Raw terminal output (ANSI sequences included) */
  data: string;
}

/** PTY process has exited. */
export interface ExitMessage {
  type: "exit";
  /** Terminal session ID that exited */
  tabId: string;
  /** Process exit code (0 = normal, non-zero = error/signal) */
  code: number;
}

/** A new terminal tab has been created and its PTY is ready. */
export interface TabCreatedMessage {
  type: "tabCreated";
  /** New session ID */
  tabId: string;
  /** Display name (e.g., "Terminal 2") */
  name: string;
  /**
   * Persisted custom name for this tab (root tabs only; null when none). Sent
   * on creation so a hydrated name surfaces on first render without flicker.
   */
  customName: string | null;
}

/**
 * Host pushes the normalized custom name after any rename trigger (inline-edit,
 * context menu, command palette, F2). The webview mirrors it into
 * `TerminalInstance.customName` and re-renders the tab bar.
 */
export interface TabRenamedMessage {
  type: "tabRenamed";
  /** Target tab (root tab) session id */
  tabId: string;
  /**
   * Final normalized name. `null` means the tab reverts to its auto-derived
   * name. Always the host-normalized value (trimmed, possibly truncated).
   */
  customName: string | null;
}

/** A terminal tab has been removed and its PTY destroyed. */
export interface TabRemovedMessage {
  type: "tabRemoved";
  /** Removed session ID */
  tabId: string;
}

/** Cached scrollback data for view restoration. */
export interface RestoreMessage {
  type: "restore";
  /** Terminal session ID to restore */
  tabId: string;
  /** Cached terminal output (raw ANSI data) */
  data: string;
}

/** Terminal configuration has changed (user edited settings). */
export interface ConfigUpdateMessage {
  type: "configUpdate";
  /** Only the changed configuration fields */
  config: Partial<TerminalConfig>;
}

/** Error notification for the WebView to display. */
export interface ErrorMessage {
  type: "error";
  /** Human-readable error message */
  message: string;
  /** Severity level determines display style */
  severity: "info" | "warn" | "error";
}

/**
 * Internal: sent when the view becomes visible again (for deferred resize).
 * Not part of the public protocol spec — used internally between provider and webview.
 */
export interface ViewShowMessage {
  type: "viewShow";
}

/** Trigger a split action in the webview. */
export interface SplitPaneMessage {
  type: "splitPane";
  /** Direction of the split */
  direction: "horizontal" | "vertical";
}

/** Confirms a new split session was created by the extension host. */
export interface SplitPaneCreatedMessage {
  type: "splitPaneCreated";
  /** Session ID of the pane that was split */
  sourcePaneId: string;
  /** New session ID for the split pane */
  newSessionId: string;
  /** Display name for the new session */
  newSessionName: string;
  /** Direction of the split */
  direction: "horizontal" | "vertical";
}

/** Close the active split pane in the webview. */
export interface CloseSplitPaneMessage {
  type: "closeSplitPane";
}

/** Close a specific split pane by session ID (from context menu). */
export interface CloseSplitPaneByIdMessage {
  type: "closeSplitPaneById";
  sessionId: string;
}

/** Split a specific pane by session ID (from context menu). */
export interface SplitPaneAtMessage {
  type: "splitPaneAt";
  direction: "horizontal" | "vertical";
  sourcePaneId: string;
}

/** Context menu: clear terminal viewport and scrollback for a specific session. */
export interface CtxClearMessage {
  type: "ctxClear";
  sessionId?: string;
}

/** Visual feedback: a file path was inserted into the terminal via context menu. */
export interface InsertPathEffectMessage {
  type: "insertPathEffect";
}

/** Outcome of a `requestFilePreview` for hover. See spec "IPC contract — requestFilePreview / filePreviewResult". */
export type FilePreviewStatus =
  | "ok"
  | "not-found"
  | "binary"
  | "too-large"
  | "ambiguous"
  | "error"
  | "requires-confirmation";

/**
 * Fields present on every `filePreviewResult` regardless of `status`. The
 * `path` echo guarantees the popup header has a non-empty value to display.
 */
interface FilePreviewResultBase {
  type: "filePreviewResult";
  /** Echoes the `requestId` from the originating `RequestFilePreviewMessage`. */
  requestId: string;
  /** Echoes the original `path` from the request — header fallback when `absPath` is unknown. */
  path: string;
  /** Echoes the 1-based line number from the request — popup uses it to scroll-to-line. */
  line?: number;
}

/**
 * Result variants of a hover-preview request — discriminated union on `status`
 * so consumers narrow without optional-chaining (review round-1 W1).
 *
 *   - `ok`: file was read; `content`, `languageId`, `isMarkdown`, `totalBytes`,
 *     `totalLines`, `absPath` all required. `truncated` flags the 200 KB / 500-
 *     line cap from `readFileForPreview`.
 *   - `binary` / `too-large`: file was resolved; we know `absPath` and
 *     `totalBytes` but not the contents. `languageId` + `isMarkdown` are still
 *     provided so the popup can label the placeholder.
 *   - `requires-confirmation`: file was resolved but the trust policy (dotfile
 *     / known-sensitive folder / out-of-workspace) blocked auto-preview. The
 *     popup shows a "Press Cmd/Ctrl to preview" placeholder. `absPath` is
 *     provided so the user can verify what they're about to load.
 *   - `not-found` / `ambiguous` / `error`: only base fields (`requestId`,
 *     `path`).
 */
export type FilePreviewResultMessage =
  | (FilePreviewResultBase & {
      status: "ok";
      content: string;
      languageId: string;
      isMarkdown: boolean;
      truncated: boolean;
      totalBytes: number;
      totalLines: number;
      absPath: string;
    })
  | (FilePreviewResultBase & {
      status: "binary" | "too-large";
      languageId: string;
      isMarkdown: boolean;
      totalBytes: number;
      absPath: string;
    })
  | (FilePreviewResultBase & {
      status: "requires-confirmation";
      /**
       * Reason the policy blocked auto-preview — purely informational. The
       * popup placeholder reads the same "Press Cmd/Ctrl to preview" for every
       * reason; this field is for diagnostics + future-proofing.
       *   - `dotfile`: basename starts with `.` (e.g. `.env`).
       *   - `sensitive-dir`: path lives inside `.git`, `.ssh`, `.aws`,
       *     `.config`, `node_modules`, …
       *   - `out-of-workspace`: not under any trust base (initialCwd +
       *     workspace folders).
       */
      reason: "dotfile" | "sensitive-dir" | "out-of-workspace";
      /** Resolved absolute path — present so the popup header shows the target. */
      absPath?: string;
      /** Total file size from `stat`, optional — included when resolver had it. */
      totalBytes?: number;
    })
  | (FilePreviewResultBase & {
      status: "not-found" | "ambiguous" | "error";
    });

/** VSCode color theme kind, mapped for Shiki theme selection in the webview popup. */
export interface ThemeChangedMessage {
  type: "themeChanged";
  /**
   * Light / Dark / HighContrastLight / HighContrast — one of four kinds.
   * See `design.md` D8 for the mapping to Shiki themes.
   */
  kind: "light" | "dark" | "hc-light" | "hc-dark";
}

/** Hover-preview user-facing settings, mirrored from `contributes.configuration`. */
export interface HoverPreviewSettings {
  /** Debounce in milliseconds (matches `anywhereTerminal.hoverPreview.delay`). */
  delay: number;
  /** Trust policy on/off (matches `anywhereTerminal.hoverPreview.blockSensitive`). */
  blockSensitive: boolean;
}

/** Host → webview: new settings snapshot (sent on init + onDidChangeConfiguration). */
export interface HoverPreviewSettingsMessage {
  type: "hoverPreviewSettings";
  settings: HoverPreviewSettings;
}

/** Webview → host: ask the host to persist a setting via `workspace.getConfiguration().update()`. */
export interface UpdateHoverPreviewSettingMessage {
  type: "updateHoverPreviewSetting";
  key: keyof HoverPreviewSettings;
  value: boolean | number;
}

// ─── File-Tree Extension → WebView Messages ──────────────────────────
// See: asimov/changes/port-vscode-async-data-tree/design.md § Interfaces, D10

/**
 * Extension → Webview: result of `RequestReadDirectoryMessage`. Either `entries`
 * is set (success) or `error` is set. `rootGeneration` echoes the host's
 * current generation so the webview can drop responses bound to a stale root.
 *
 * Error codes:
 *   - `OUT_OF_WORKSPACE`: requested path is outside the current workspace folder.
 *   - `STALE_ROOT`: request's `rootGeneration` no longer matches the host.
 *   - any other code: filesystem error from `vscode.workspace.fs.readDirectory`.
 */
export interface ReadDirectoryResponseMessage {
  type: "read-directory-response";
  requestId: string;
  rootGeneration: number;
  entries?: FileEntry[];
  error?: { code: string; message: string };
}

/**
 * Extension → Webview: result of `RequestFileTreeSearchMessage`. Either
 * `results` is set (success) or `error` is set. `truncated` is true when
 * the enumeration hit the request's `maxResults` cap. The webview drops
 * the response when `rootGeneration` no longer matches its current value.
 *
 * Error codes:
 *   - `OUT_OF_WORKSPACE`: requested scopePath outside the active workspace.
 *   - `STALE_ROOT`: request's `rootGeneration` no longer matches the host.
 *   - `INTERNAL`: filesystem / findFiles error.
 *
 * See: asimov/changes/add-file-tree-search/design.md D11.
 */
export interface FileTreeSearchResponseMessage {
  type: "file-tree-search-response";
  requestId: string;
  rootGeneration: number;
  results?: FileTreeSearchResult[];
  truncated?: boolean;
  error?: { code: string; message: string };
}

/** Extension → Webview: move the file-tree panel to one of four sides. */
export interface SetFileTreePositionMessage {
  type: "set-file-tree-position";
  position: FileTreePosition;
}

/**
 * Extension → Webview: workspace folder set has changed (see design D10). The
 * webview SHALL drop pending RPC requests, clear in-memory caches, and adopt
 * the new `rootGeneration`. `rootPath` is null when no workspace folder is open.
 */
export interface WorkspaceRootChangedMessage {
  type: "workspace-root-changed";
  rootPath: string | null;
  rootGeneration: number;
}

/**
 * Extension → Webview: incremental delta from the host's `GitDecorationProvider`.
 * `revision` is monotonic across the provider's lifetime; the webview drops any
 * delta whose path-revision pair is older than the one it has already applied.
 * `status: null` means the file no longer has a decoration. See:
 * asimov/changes/add-file-tree-git-decorations/specs/git-decoration-source/spec.md.
 */
export interface GitStatusChangedMessage {
  type: "git-status-changed";
  rootGeneration: number;
  revision: number;
  changes: ReadonlyArray<{ path: string; status: GitStatus | null }>;
}

/**
 * Extension → Webview: a watched directory had a create/delete event. The
 * webview re-runs `request-read-directory` for `parent` so the new entries
 * are stamped with fresh git status via the existing read pipeline. The
 * webview SHALL drop the message when `rootGeneration` no longer matches its
 * current value. See: asimov/changes/add-file-tree-fs-watcher/design.md D4.
 */
export interface FsChangesInvalidatedMessage {
  type: "fs-changes-invalidated";
  rootGeneration: number;
  /** Absolute path of the directory whose direct children changed. */
  parent: string;
}

/**
 * Extension → Webview: window-focus rising edge or other coarse-grained
 * resync signal. The webview SHALL refresh the synthetic root node and every
 * currently-expanded directory node (NOT every cached directory — see
 * asimov/changes/add-file-tree-fs-watcher/design.md D7). The webview SHALL
 * drop the message on `rootGeneration` mismatch.
 */
export interface FsRehydrateMessage {
  type: "fs-rehydrate";
  rootGeneration: number;
}

/**
 * Two valid shapes:
 *
 * 1. OSC 7 path (`source: 'osc7'` or omitted): set `sessionId` + `cwd`.
 *    Triggered by `anywhereTerminal.ctx.revealInFileTree` (terminal pane
 *    right-click). The extension resolves the pane's live cwd (querying the
 *    PTY shell process via `SessionManager.getLiveCwd` — `lsof` on macOS,
 *    `/proc/<pid>/cwd` on Linux) and posts it here. The webview then asks
 *    `FileTreePanel.revealPath` to expand ancestors + scroll the row in.
 *    `cwd` is null only when the OS query failed (e.g. Windows, permission
 *    denied) — webview falls back to the workspace root in that case.
 *
 * 2. Auto-reveal path (`source: 'autoReveal'`): set `absPath` (and optionally
 *    `focusNoScroll`). Triggered by `ActiveFileRevealer` when the active
 *    editor tab changes. Bypasses cwd resolution. When `focusNoScroll` is
 *    true, the webview selects + focuses the row without scrolling the tree.
 *    When the root is collapsed, the webview short-circuits silently instead
 *    of expanding the panel.
 */
export interface RevealInFileTreeMessage {
  type: "reveal-in-file-tree";
  sessionId?: string;
  cwd?: string | null;
  absPath?: string;
  focusNoScroll?: boolean;
  /** Where this reveal originated. Drives focus/scroll/bail-out behavior.
   * `openFolder` = user picked a folder via the Open Folder header button —
   * treat as a user-initiated reveal (always proceeds, no bail-out). */
  source?: "osc7" | "autoReveal" | "openFolder";
}

/** Extension → Webview: the aggregated, recency-sorted vault session list. */
export interface VaultSessionsResponseMessage {
  type: "vaultSessionsResponse";
  result: VaultListResult;
  /**
   * True for the instant response served from the persisted cache, false (or
   * absent) for the authoritative response that follows the source-of-truth
   * refresh (cache-vault-load D1). The webview renders both; a no-op guard makes
   * the second invisible when nothing changed.
   */
  fromCache?: boolean;
}

interface VaultSessionDetailResponseBase {
  type: "vaultSessionDetailResponse";
  /**
   * Echoes the requested entry id so the webview can drop a response for a
   * session that is no longer the active preview (redesign-vault-panel-ui D3
   * stale-render guard).
   */
  entryId: string;
  /**
   * True when this detail is a live-follow push (not a user-initiated open/load-more)
   * (enhance-vault-sessions D5). The webview handles it before the normal open path:
   * it never force-scrolls — it appends+auto-scrolls only when already at the bottom,
   * otherwise it surfaces a "new messages" indicator.
   */
  followUpdate?: boolean;
}

/**
 * Extension → Webview: reply to `requestVaultSessionDetail`. Discriminated XOR —
 * EXACTLY one of `detail` / `error` is present, so a producer cannot compile
 * while sending both or neither and consumers narrow without ambiguity (W3).
 */
export type VaultSessionDetailResponseMessage =
  | (VaultSessionDetailResponseBase & { detail: VaultSessionDetail; error?: never })
  | (VaultSessionDetailResponseBase & { error: string; detail?: never });

/**
 * Extension → Webview: reply to `requestVaultContextCwd`. Echoes `sessionId` so
 * the webview can drop a reply for a pane that is no longer active (stale-guard,
 * mirroring the detail `entryId` echo). `cwd` is null only when the OS query
 * failed and no tracked/initial cwd exists (e.g. Windows) — the webview then
 * falls back to the workspace root.
 */
export interface VaultContextCwdMessage {
  type: "vaultContextCwd";
  sessionId: string;
  cwd: string | null;
}

/**
 * Extension → Webview: reply to `requestSubagentPreview`. Echoes `requestId` so
 * the webview can drop a response for a popup that has since been dismissed or
 * replaced by a newer click. EXACTLY one of `detail` / `error` is present:
 * `detail` carries the subagent's bounded transcript; `error` is a short marker
 * (`"notFound"` | `"noSession"` | a read-error message) the popup renders as an
 * empty state. See: asimov/changes/preview-subagent-popup/design.md D3.
 */
interface SubagentPreviewResponseBase {
  type: "subagentPreviewResponse";
  requestId: string;
  /** Echoed when the request carried an `entryId` (a NESTED drill-down fetch) so the
   *  popup routes this response to that nested block instead of the top-level body
   *  (support-nested-subagent-preview D5). Absent for the initial top-level reply. */
  entryId?: string;
}

/**
 * Discriminated XOR — EXACTLY one of `detail` / `error` is present, so a producer
 * cannot compile while sending both or neither and consumers narrow without
 * ambiguity (mirrors `VaultSessionDetailResponseMessage`).
 */
export type SubagentPreviewResponseMessage =
  | (SubagentPreviewResponseBase & { detail: VaultSessionDetail; error?: never })
  | (SubagentPreviewResponseBase & { error: string; detail?: never });

/**
 * Extension → Webview: open/focus the vault panel. The `openVault` command
 * posts this; the webview expands the vault section (stacked above the file
 * tree) and re-requests the session list.
 */
export interface OpenVaultMessage {
  type: "openVault";
}

/**
 * All messages that can be sent from the Extension Host to the WebView.
 * Use msg.type as the discriminant in switch/case for exhaustive handling.
 */
export type ExtensionToWebViewMessage =
  | InitMessage
  | OutputMessage
  | ExitMessage
  | TabCreatedMessage
  | TabRenamedMessage
  | TabRemovedMessage
  | RestoreMessage
  | ConfigUpdateMessage
  | ErrorMessage
  | ViewShowMessage
  | SplitPaneMessage
  | SplitPaneCreatedMessage
  | CloseSplitPaneMessage
  | CloseSplitPaneByIdMessage
  | SplitPaneAtMessage
  | CtxClearMessage
  | InsertPathEffectMessage
  | FilePreviewResultMessage
  | ThemeChangedMessage
  | HoverPreviewSettingsMessage
  | ReadDirectoryResponseMessage
  | FileTreeSearchResponseMessage
  | SetFileTreePositionMessage
  | WorkspaceRootChangedMessage
  | GitStatusChangedMessage
  | FsChangesInvalidatedMessage
  | FsRehydrateMessage
  | RevealInFileTreeMessage
  | SetPanelIdMessage
  | RestoreFromSnapshotMessage
  | RequestScrollbackDumpMessage
  | FlashPaneMessage
  | VaultSessionsResponseMessage
  | VaultSessionDetailResponseMessage
  | VaultContextCwdMessage
  | SubagentPreviewResponseMessage
  | ClipboardImagePreviewMessage
  | OsClipboardPasteMissMessage
  | OpenVaultMessage;

/**
 * Extension → Webview. Visual feedback for title-bar "export" click — briefly
 * flashes the `.split-leaf[data-session-id=sessionId]` element so the user
 * confirms which pane will be exported. No-op when the leaf isn't mounted
 * (inactive tab, editor location with no matching session).
 */
export interface FlashPaneMessage {
  type: "flashPane";
  sessionId: string;
}

/**
 * Extension → Webview. Tells the editor webview the panelId VS Code will use
 * to identify this WebviewPanel across reloads. The webview persists this in
 * `vscode.setState({...})` so the serializer's `state` arg carries it back.
 *
 * See: asimov/changes/restore-terminal-sessions/design.md D2.
 */
export interface SetPanelIdMessage {
  type: "setPanelId";
  panelId: string;
}

/**
 * Extension → Webview. Replays a persisted snapshot into an xterm instance after
 * a VS Code restart. The webview writes the serialized buffer + restore divider
 * before attaching the terminal to the DOM. `shellExited === true` means the
 * underlying shell terminated before the snapshot — the webview marks the
 * instance read-only and the divider includes the exit indicator.
 *
 * See: asimov/changes/restore-terminal-sessions/design.md D8, D9, D13.
 */
export interface RestoreFromSnapshotMessage {
  type: "restoreFromSnapshot";
  tabId: string;
  serializedBuffer: string;
  cols: number;
  rows: number;
  snapshotAt: number;
  shellExited: boolean;
  exitCode: number | null;
  /**
   * True when the tab is a SPLIT-PANE CHILD (not a root tab). The webview's
   * deferOpen fallback must use this to avoid clobbering the parent's
   * `tabLayouts` entry by setting `tabLayouts.set(childId, createLeaf(childId))`.
   * Optional for back-compat with prior webviews on the wire; treat missing
   * as `false` (root tab). See .reviews/round-4.md [W4].
   */
  isSplitPane?: boolean;
}

/**
 * Extension → Webview. Asks the webview to serialise the xterm.js scrollback
 * for the given tab and reply with `ScrollbackDumpMessage`. The webview reuses
 * a single in-flight serialisation per `tabId`: concurrent requests for the
 * same `tabId` resolve to the same payload.
 *
 * See: asimov/changes/export-terminal-session/specs/webview-scrollback-dump/spec.md,
 * design.md D4.
 */
export interface RequestScrollbackDumpMessage {
  type: "requestScrollbackDump";
  tabId: string;
  /** UUID correlation token; the matching `ScrollbackDumpMessage` echoes it. */
  requestId: string;
}

/**
 * Webview → Extension. The serialised scrollback payload requested by
 * `RequestScrollbackDumpMessage`. `data` preserves ANSI escapes; stripping
 * (if any) happens in the extension export pipeline. `truncated` is true iff
 * the xterm `scrollback` setting capped the output. Unknown `tabId` replies
 * with `data: ""`, `lineCount: 0`, `truncated: false`.
 *
 * `error` is set when the webview handler threw — typically
 * `SerializeAddon.serialize()` failed, `loadAddon` rejected, or addon
 * construction itself threw. The coordinator translates this into a
 * `ScrollbackDumpFailedError` so the export command can surface a toast
 * instead of silently writing an empty file. See: external-review W2.
 */
export interface ScrollbackDumpMessage {
  type: "scrollbackDump";
  tabId: string;
  /** Echoed from the matching `RequestScrollbackDumpMessage`. */
  requestId: string;
  data: string;
  lineCount: number;
  truncated: boolean;
  /** When set, the dump failed and `data`/`lineCount`/`truncated` are placeholders. */
  error?: string;
}
