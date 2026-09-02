// src/types/messages.ts — Shared message type definitions for AnyWhere Terminal
// Used by both Extension Host and WebView code.
// See: docs/design/message-protocol.md

import type { WorktreeRowActivation } from "../settings/SettingsReader";
import type { VaultLaunchTarget, VaultListResult, VaultSessionDetail } from "../vault/types";
import type { WorktreePresence } from "../worktree/presenceTypes";
import type { WorktreeRef } from "../worktree/repoRefs";
import type { WorktreeTree } from "../worktree/types";

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
  /**
   * Opaque webview-chosen token echoed verbatim in the response. Sent only by
   * nested (sub-agent card) detail requests so a reply can be matched to the
   * exact request that produced it — host reads complete out of order, so the
   * entry id alone cannot correlate them (round-6 W15).
   */
  requestId?: string;
}

/**
 * Webview → Extension: resolve one timeline message back to its stored record,
 * for the per-message Raw copy (improve-vault-transcript-messages D5). `msgRef` is
 * the opaque locator the reader stamped on the item — never a path.
 */
export interface RequestVaultMessageRecordMessage {
  type: "requestVaultMessageRecord";
  entryId: string;
  msgRef: string;
}

/**
 * Webview → Extension: start a NEW session seeded with a handoff prompt, after
 * the reader confirmed it in the continuation dialog (D9/D10). `instruction` is
 * the reader's OWN text — the webview never sends transcript content; `anchorRef`
 * locates the assistant reply being continued from, which the host resolves
 * itself. The stored session is left untouched — this is not a resume.
 */
export interface VaultContinueSessionMessage {
  type: "vaultContinueSession";
  entryId: string;
  instruction: string;
  confirmIntent: boolean;
  /** Agent to start; defaults to the entry's own when absent. */
  agent?: string;
  /** Id of the chosen permission posture, from that agent's registry choices. */
  permissionChoiceId?: string;
  anchorRef?: string;
}

/**
 * Webview → Extension: which agents this host can start a continuation in, and
 * the permission postures each exposes (D11). Asked when the dialog opens.
 */
export interface RequestVaultLaunchTargetsMessage {
  type: "requestVaultLaunchTargets";
  /**
   * Which launch is being asked about. Absent means `"continue"`, so the
   * continuation dialog's existing request keeps its meaning unchanged.
   */
  capability?: VaultLaunchCapability;
}

/** The two launches a target list can describe. */
export type VaultLaunchCapability = "continue" | "start";

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
 * WebView → Extension: ask for the worktree tree. `force` bypasses the per-repo
 * cache and rebuilds before answering; without it a cached listing may answer.
 * Two requests in flight for one scope collapse into a single rebuild.
 *
 * See: docs/design/worktree-rpc.md § 2.1.
 */
export interface RequestWorktreeTreeMessage {
  type: "requestWorktreeTree";
  force?: boolean;
}

/**
 * WebView → Extension: this row was expanded — read what its session delegated.
 *
 * `entryId` is an expected-version token, never an argument: the host looks
 * `rowId` up in the projection it last published and reads only when THAT row's
 * own entry id matches, using its own value. A surface whose last envelope was
 * skipped or threw still shows the previous session under the same stable
 * `rowId`, and a row-id-only request would resolve the click against the new
 * session and open the wrong transcript.
 *
 * There is no paired response: the roster rides the `worktreeTreeResponse`
 * envelope that already carries presence, so a recipient can never hold a
 * roster for a row its current presence does not contain.
 *
 * See: docs/design/worktree-rpc.md § 2.1;
 *      asimov/changes/surface-subagent-history-rows/design.md D1, D2.
 */
export interface RequestWorktreeSubagentsMessage {
  type: "requestWorktreeSubagents";
  rowId: string;
  /** The session the view believed the row had when it was expanded. */
  entryId: string;
}

/**
 * WebView → Extension: the panel's read-only actions.
 *
 * **Every id here is a lookup key, never a value to act on.** The host resolves
 * `worktreeId` against its cached tree and `rowId` against the presence it last
 * published, and acts on what IT holds — a request naming something the host
 * does not currently hold performs nothing at all, rather than falling back to a
 * nearest match, a first repository, or the workspace root. An action that "did
 * something" against an unintended target is worse than one that did nothing.
 *
 * Where a request also carries a `paneId` or `entryId`, that value is an
 * expected-version token compared against the host's own, exactly as
 * `requestWorktreeSubagents` uses one: a surface whose last envelope was skipped
 * still shows the previous worktree or session under a stable row id.
 *
 * See: docs/design/worktree-rpc.md § 2.1;
 *      asimov/changes/wire-worktree-navigation-actions/design.md D2, D3.
 */
export interface WorktreeOpenFolderMessage {
  type: "worktreeOpenFolder";
  worktreeId: string;
  mode: "newWindow" | "addToWorkspace";
}

/** After-creation modes create ships with. */
export type WorktreeOpenAfterMode = "none" | "terminal" | "agent" | "newWindow" | "addToWorkspace";

/**
 * What a launch runs: which agent, under which posture, seeded with what.
 *
 * `permissionChoiceId` and `prompt` are the agent's OWN vocabulary — an id it
 * declared and text it will receive as one argument. Neither is argv; the host
 * resolves that from the registry, so nothing here is a command fragment.
 */
export interface WorktreeAgentLaunchFields {
  agent: string;
  permissionChoiceId?: string;
  prompt?: string;
  /**
   * The answer this launch was chosen from, quoted back.
   *
   * The host admits a launch against the agents it OFFERED, and "offered" has
   * to mean delivered: a reply the surface never received, or one a refresh has
   * already replaced, is not a list the user chose from. Quoting the id is what
   * makes that checkable — absent or stale is refused, never assumed current.
   */
  offerId?: string;
  /**
   * The registration the chosen worktree carried when the dialog rendered it.
   *
   * Same rule as `offerId`, for the other half of the choice: the host advances
   * this whenever it re-observes the repository, so a launch quoting a
   * superseded one is refused rather than handed to whatever now occupies that
   * path (design.md D10). Absent is refused, never assumed current.
   */
  generation?: number;
}

/**
 * How the new worktree gets its branch. Five shapes, not a flag set: the modes
 * differ in what they REQUIRE, and a flag set would admit combinations that mean
 * nothing, such as a base ref on a reuse (worktree-rpc.md § 2.3).
 *
 * `baseRef` is structurally absent from `reuse`, `reattach` and `adopt`. The
 * contractual-base rule is enforced by this type, not by a validator three
 * layers down that can be forgotten.
 */
export type WorktreeCreateMode =
  | { kind: "fresh"; branch: string; baseRef?: string }
  | { kind: "fresh-detached"; baseRef: string }
  | { kind: "reuse"; branch: string }
  | {
      kind: "reattach";
      branch: string;
      /** The surviving directory whose administrative entry is stale. */
      repairPath: string;
      /** The DIRECTORY's HEAD at resolution — guards against a checkout that moved. */
      expectedOid: string;
    }
  | {
      kind: "adopt";
      branch: string;
      /** The surviving directory with no administrative entry at all. */
      adoptPath: string;
      /**
       * The BRANCH TIP at resolution. Adopt has no HEAD to compare against — that
       * file is exactly what was lost — so the only OID it can promise is the one
       * it is about to write into a new one (worktree-rpc.md § 2.3).
       */
      expectedBranchOid: string;
    };

/**
 * WebView → Extension: issue an authorization to clear this destination.
 *
 * Its OWN request, deliberately. The probe fires on every settled edit, so an
 * authorization riding that answer would mint a delete token for a path nobody
 * asked to delete, many times per dialog (design.md D6).
 */
export interface WorktreeAuthorizeDebrisMessage {
  type: "worktreeAuthorizeDebris";
  repoId: string;
  /** Echoed, so an answer below the current opening is dropped. */
  token: number;
  /**
   * WHICH request this is, within one opening.
   *
   * `token` separates two openings and `path` separates two directories, but a
   * user who accepts, withdraws and accepts again asks about the same path
   * twice inside one opening — and the first answer, arriving late, would
   * satisfy the second request with a reading that request never made. The same
   * thing `seq` does for the probe (round-2 W2).
   */
  ask: number;
  /** The destination the user asked to clear. */
  path: string;
}

/**
 * Extension → WebView: the authorization, or why there is not one.
 *
 * `entries` is what the token was digested over AND what the offer states will
 * be removed — one read, so the list shown and the list bound cannot differ.
 */
export type WorktreeDebrisAuthorizedMessage = {
  type: "worktreeDebrisAuthorized";
  repoId: string;
  token: number;
  /** Echoed, so an answer can be told from one the form has already withdrawn. */
  ask: number;
  path: string;
} & (
  | { granted: true; authorization: DebrisAuthorization; entries: readonly string[] }
  /** Named rather than absent: "not debris" and "could not read it" are different answers. */
  | { granted: false; because: "notDebris" | "unreadable" }
);

/** Authorizes deleting exactly what the user was shown, at exactly the place they were shown it. */
export interface DebrisAuthorization {
  readonly path: string;
  /** Host-issued over the path and what was found there. Absent → the delete is refused. */
  readonly fingerprint: string;
}

/**
 * What the destination already holds. Independent of the branch mode — an
 * existing branch and a debris-occupied destination can hold at once, which a
 * sixth mode could not express (worktree-rpc.md § 2.3).
 */
export type DestinationDisposition = { kind: "free" } | { kind: "debris"; authorization: DebrisAuthorization };

/**
 * What happens once the worktree exists.
 *
 * The agent fields live ONLY on the `agent` variant, so a draft that chose
 * "Nothing" is structurally incapable of carrying an agent, a posture, or a
 * setup gate (worktree-rpc.md § 2.6).
 *
 * The variant embeds `WorktreeAgentLaunchFields` rather than redeclaring the
 * three fields § 2.6 sketches: `offerId` and `generation` are staleness guards
 * this extension already ships, and a shape that dropped them would refuse
 * nothing the old one refused.
 */
export type WorktreeAfterCreate =
  | { kind: "none" }
  | { kind: "terminal" }
  | { kind: "newWindow" }
  | { kind: "addToWorkspace" }
  | ({
      kind: "agent";
      /** Sequence the agent's start after the setup runner exits (worktree-create.md § 6). */
      waitForSetup: boolean;
    } & WorktreeAgentLaunchFields);

/**
 * Every selectable item carries an opaque host-issued id, unique within one
 * offer. The webview submits ids; it never submits paths or command text
 * (worktree-provisioning.md § 4.0). Ids are not stable across offers.
 */
/**
 * The handle a selection quotes back for one offered row.
 *
 * Unique within ONE offer, and nothing wider.
 *
 * Each adapter mints from its own counter starting at the same value, so two
 * adapters read for the same create both produce `i1`. The offer store remints
 * every selectable row as it issues an offer, which is the point where the
 * completed model exists and no provider registry or merge algorithm has to be
 * guessed at — so uniqueness holds by construction rather than by each adapter
 * remembering to arrange it (.reviews/round-2.md W4).
 *
 * Deliberately not derived from a path: an id that encoded one would be a path
 * the webview could read back out, and an id from a superseded offer would
 * still name something. A counter resolves to nothing once its offer is gone,
 * which is the answer worktree-provisioning.md § 4.0 wants.
 */
export interface ProvisionItemId {
  readonly id: string;
}

/** One thing to materialize into a new worktree. */
export interface ProvisionEntry extends ProvisionItemId {
  /** Repo-relative POSIX path. Globs are expanded at read time, never stored. */
  readonly path: string;
  readonly mode: "copy" | "link";
  /** Provider file this entry came from, repo-relative. Never absent. */
  readonly source: string;
}

/**
 * One step to run in the new worktree after materialization.
 *
 * There is exactly one variant. A second, carrying a resolved VS Code task so
 * the task system could run it with its identity intact, was designed and then
 * removed: a task cannot be run for a directory that is not a workspace folder,
 * and it does not refuse — it runs in the window's open folder instead
 * (worktree-provisioning.md § 3.3).
 *
 * `kind` survives the collapse to a single member so a later variant can be
 * added without reshaping every stored step.
 */
export type ProvisionSetupStep = ProvisionItemId & {
  readonly kind: "shell";
  /** Exact script text, passed as the shell's single script argument. Never concatenated. */
  readonly script: string;
  readonly source: string;
};

/** A named port the repo wants allocated per worktree. Selectable, like every other row. */
export interface ProvisionPort extends ProvisionItemId {
  readonly name: string;
  readonly source: string;
  /**
   * The free port this create will take.
   *
   * Absent until something allocates one. Reading a provider file cannot: it
   * learns the NAME the repo wants, and probing for a free port is WT-012.6,
   * which lands after the task that materializes files. So a row can be offered
   * — named, attributed, selectable — before any number exists for it, and the
   * dialog renders the name alone rather than a placeholder that reads as an
   * allocation nobody made.
   *
   * Once set it is still a preview: it is re-resolved immediately before it is
   * written (worktree-provisioning.md § 5.3), and the second resolution binds.
   */
  readonly port?: number;
}

export interface ProvisionProvider {
  readonly id: "asimov" | "orca" | "vscodeTasks" | "native";
  /**
   * Repo-relative files it reads, in read order. Non-empty.
   *
   * A list rather than one name because orca is one provider over two files by
   * its own design, and with both present no single value truthfully answers
   * "which file said so" — the row the user sees names what it read (design.md
   * D8). A row's `source` still names ONE file: that is a different question.
   */
  readonly files: readonly string[];
  /**
   * The subset of `files` that is actually there, in read order.
   *
   * `files` is what the adapter DECLARES it can read; this is what was found.
   * The two differ wherever a provider is optional over several files — orca is
   * one provider over two — and a consumer that must name one existing file
   * cannot get it from `files`: writing `files[0]` as `extends` in a repository
   * carrying only the other one names a file that is not there, which the read
   * side then reports as `missingExtends`
   * (worktree-provisioning.md § 6, design.md D11).
   *
   * Presence, not readability: a file that is there and denied still counts,
   * because it is one `extends` can name without producing `missingExtends`.
   *
   * Can be EMPTY on a provider that was nonetheless detected — the file was
   * there when it was read and gone when presence was taken. A consumer that
   * needs a name has none, which is the truthful answer rather than a stale one.
   */
  readonly present: readonly string[];
  /** True for the provider whose model the native file extended or detection chose. */
  readonly active: boolean;
}

export interface ProvisionProblem {
  readonly file: string;
  /**
   * The first five describe a READ going wrong. `unsaved` is the one that does
   * not: a save was refused and nothing was written, about a file that may have
   * read perfectly well a moment earlier (design.md D13).
   *
   * `locked` is a seventh thing again, and it exists because reusing either of
   * the others states a falsehood: the file WAS written, so "not saved" is
   * wrong, and it read fine, so "could not be read" is wrong. It carries no
   * pathname — a person acts on what it says long after the name could have
   * been rebound (say-which-lock-a-save-left-behind design.md D1).
   *
   * One value for every write refusal rather than one each, with the cause in
   * `detail`: the writer's own enumeration cannot always tell a held lock from a
   * directory it could not create, so putting it on the wire would offer
   * distinctions that are not always real.
   */
  readonly reason:
    | "unreadable"
    | "malformed"
    | "unknownKey"
    | "missingExtends"
    | "unsubstituted"
    | "unsaved"
    | "locked";
  /** Bounded, already safe to render. Parser text is quoted, never interpreted. */
  readonly detail: string;
}

/**
 * Declarations that may turn out to name one destination.
 *
 * Ids, never paths: the wire carries one copy of a path, on the row that
 * declared it. Both members stay offered — withholding them would deliver
 * nothing in the ordinary case where a repository and the source it builds on
 * spell one path two ways.
 */
export interface ProvisionContenders {
  /** Two or more entry ids from the same model. */
  readonly members: readonly string[];
  /**
   * The members the repository's own file declared, in `members` order.
   *
   * Which members are the repository's own, rather than a pre-computed winner:
   * a winner is decided against the whole offer and goes stale the moment the
   * user unticks a row, so both the dialog and the apply answer from this list
   * against the selection in front of them (design.md D3c) — more than one is
   * refused entire, exactly one is favoured, none claims priority. The three
   * states are ranges of one list's length, so no pair of fields can contradict
   * each other.
   */
  readonly natives: readonly string[];
}

export interface ProvisionModel {
  readonly entries: readonly ProvisionEntry[];
  readonly setup: readonly ProvisionSetupStep[];
  readonly ports: readonly ProvisionPort[];
  /** Providers detected, in detection order. The first is the one that supplied the base. */
  readonly providers: readonly ProvisionProvider[];
  /** Entries an `exclude` rule removed, kept so the UI can show them as deliberate. */
  readonly excluded: readonly ProvisionEntry[];
  /**
   * Entries that MAY name one destination, grouped.
   *
   * Never a claim that they do. Whether two spellings are one file is a property
   * of the directory they land in, and this model is built before that directory
   * exists — so the read path groups what a common filesystem could fold and
   * leaves the answer to the apply side (worktree-provisioning.md § 4.2).
   */
  readonly contenders: readonly ProvisionContenders[];
  /** Populated when a provider file was found but could not be read. */
  readonly problems: readonly ProvisionProblem[];
}

/**
 * WebView → Extension: which of the host's own offered provisioning items the
 * user left checked.
 *
 * There is deliberately no field capable of carrying a command or a path. A
 * message carrying command text would make the webview the authority on what
 * executes, which is the property the untrusted-provider-file model exists to
 * deny (worktree-provisioning.md § 4.0).
 */
export interface ProvisionSelection {
  /**
   * From `worktreeProvisionOffer`. Unrelated to `WorktreeAgentLaunchFields.offerId`,
   * which quotes an agent list rather than a provisioning model.
   */
  readonly offerId: string;
  /**
   * Host-issued ids of the checked items — entries, ports and setup steps in one
   * list, because every offered row is a checkbox and a caller should not have to
   * know which kind a row was. Opaque and per-offer: not paths, not stable across
   * offers.
   */
  readonly itemIds: readonly string[];
}

/**
 * `notApplicable` is on the wire because the UI must not render it as `passed`
 * (worktree-removal.md § 2.2): an unlocked worktree has no lock age, and
 * claiming a check ran that never applied is a different lie from claiming one
 * passed.
 */
export type RemovalCheckOutcome = "passed" | "failed" | "unproven" | "notApplicable";

/**
 * What an unproven outcome blocks. Carried per check rather than re-derived in
 * the webview, because the decision to show a typed confirmation depends on it
 * and a second copy of that mapping is a second place for the rule to be wrong.
 */
export type RemovalCheckClass = "refusal" | "confirmable" | "proof";

export interface RemovalCheck {
  readonly id: string;
  readonly cls: RemovalCheckClass;
  readonly outcome: RemovalCheckOutcome;
  /**
   * How many, where the check counts something. Separate from `detail` because
   * the panel renders the magnitude inside its own element, and a number that
   * arrived as prose can only be re-rendered by parsing it back out.
   */
  readonly count?: number;
  /** Bounded, already safe to render. */
  readonly detail?: string;
}

/** Present only when the merge proof passed. Absence is how "not offered" is expressed. */
export interface BranchDeleteOffer {
  readonly branch: string;
  readonly branchOid: string;
  readonly defaultBranch: string;
  readonly defaultOid: string;
}

/**
 * Echoes the offer the user acted on, in full. Both ref NAMES travel as well as
 * both OIDs: an OID pair alone does not prove the default branch the proof used
 * is the one being verified now (worktree-rpc.md § 2.5).
 */
export interface BranchDeleteRequest {
  readonly branch: string;
  readonly expectedBranchOid: string;
  readonly defaultBranch: string;
  readonly expectedDefaultOid: string;
  /** The assessment whose `BranchDeleteOffer` carried these values. */
  readonly fingerprint: string;
}

/**
 * The opted-in branch delete's own outcome, riding the removal's result
 * rather than replacing it — a failed branch delete never fails the removal
 * (design.md D5, worktree-panel/spec.md#the-branch-deletion-is-reported-apart-from-the-removal).
 *
 * A named guard on refusal, never a bare boolean: the notice states WHICH
 * check declined rather than only that the branch survived.
 */
export type WorktreeBranchDeleteOutcome =
  | { readonly kind: "deleted"; readonly branch: string }
  | {
      readonly kind: "refused";
      readonly reason: "branch-in-use" | "default-branch" | "holders-unavailable" | "refs-moved";
    };

/**
 * WebView → Extension: create a worktree at a path the host will re-validate.
 *
 * The launch fields are required exactly when `openAfter` is `"agent"` and
 * rejected on every other mode — a launch payload riding a non-launch mode is a
 * caller bug, not a field to ignore (worktree-rpc.md § 2.2). The union makes
 * that unrepresentable rather than validated.
 */
export interface WorktreeCreateRequestMessage {
  type: "worktreeCreate";
  repoId: string;
  /**
   * WHICH create form composed this. Required, like the field is on every other
   * request belonging to an opening — the spec says the identity travels on all
   * of them, and this was the one door left outside that contract, so a submit
   * naming no opening is unrepresentable rather than validated (round-5 W1).
   */
  opening: number;
  /** Untrusted: the one action with no host-issued id to re-resolve from. */
  path: string;
  /**
   * WHICH branch mode the user chose, said outright.
   *
   * It used to be inferred from which of `branch` / `baseRef` / `detach`
   * happened to be present, and the new-branch and existing-branch modes were
   * indistinguishable that way — so the host guessed, and guessed wrong for a
   * new branch with no base ref.
   */
  mode: WorktreeCreateMode;
  disposition: DestinationDisposition;
  afterCreate: WorktreeAfterCreate;
  /**
   * Which of the host's own offered provisioning items the user left checked.
   *
   * Optional because a create carrying none is every create made before
   * provisioning existed, and that is not an error — it provisions nothing.
   * Carries ids, never paths and never command text: the host resolves them
   * against the model it issued (worktree-rpc.md § 2.4).
   */
  provision?: ProvisionSelection;
}

/** WebView → Extension: start a fresh agent session in a worktree. */
export interface WorktreeLaunchAgentMessage extends WorktreeAgentLaunchFields {
  type: "worktreeLaunchAgent";
  worktreeId: string;
}

/**
 * WebView → Extension: resume an existing session, in this worktree rather than
 * the one it was recorded in.
 *
 * `rowId` travels with `entryId` because every agent-row action resolves through
 * the published row rather than the id the request carried — the entry id is an
 * expected-version token, never an argument (design.md D1).
 */
export interface WorktreeResumeHereMessage {
  type: "worktreeResumeHere";
  worktreeId: string;
  rowId: string;
  entryId: string;
  /**
   * The registration the worktree carried when this row was rendered.
   *
   * Same rule as a launch's: the row the user acted on is an answer the host
   * published, and a replacement landing between the click and the receipt must
   * not inherit it (design.md D10). Absent is refused, never assumed current.
   */
  generation?: number;
}

/**
 * WebView → Extension: remove a worktree.
 *
 * `fingerprint` is REQUIRED when `force` is true and rejected when it is not:
 * worktree-rpc.md:90 declares only `{ worktreeId, force }`, but :196 requires the
 * fingerprint to be validated on the way in, so the payload is amended here.
 * A force without one authorizes nothing (design.md D3).
 */
/**
 * WebView → Extension: what destination would a create in this repo take?
 *
 * Asked rather than computed, because the panel does not know the configured
 * root, the repo's own layout, or which candidates are already taken.
 */
export interface WorktreeCreateDefaultsRequestMessage {
  type: "requestWorktreeCreateDefaults";
  repoId: string;
  /**
   * The form OPENING this belongs to, minted by the panel.
   *
   * `repoId` names a repository, not a conversation: a dialog closed and
   * reopened on the same one leaves two whose messages are otherwise
   * indistinguishable. The same identity `requestWorktreeRefs`,
   * `worktreeCreateProbe` and `worktreeAuthorizeDebris` already carry — this is
   * not a second one (design.md D1).
   *
   * Required. An absent opening would have to be read as "the live one", which
   * is the permissive reading that lets a malformed message adopt a form's
   * authority.
   */
  opening: number;
  /**
   * The branch the form currently holds, if any.
   *
   * The destination depends on it, so the host has to resolve against the
   * branch the user actually typed. Without this the host proved one path free
   * and the form submitted a different, branch-derived one (round-3 B12).
   */
  branch?: string;
}

/**
 * WebView → Extension: this create form closed.
 *
 * Its own message because closure cannot be inferred. The host reads a
 * branch-less defaults request as "a form opened", and has no counterpart for
 * the other end — which is why a cancelled form's read still minted authority
 * nothing would ever redeem. Posted on BOTH exits, cancel and submit: a form
 * cancelled and never reopened is exactly the case a "supersede on next
 * opening" rule would never reach (design.md D3).
 */
export interface WorktreeCreateClosedMessage {
  type: "worktreeCreateClosed";
  /** The opening being retired. Nothing about it is honoured afterwards. */
  opening: number;
}

/**
 * WebView → Extension: populate the section from a source that was detected but
 * did not win.
 *
 * A NEW request with its own identity, not a re-entry of the open one. The host
 * admits one provisioning read per `(repo, opening)` and holds that marker until
 * the opening retires, so a switch riding the opening alone would either join a
 * finished read and do nothing, or clear a marker that exists to stop exactly
 * that (design.md D5).
 *
 * `switch` is minted by the dialog and increases per dialog. It is what makes
 * latest-wins expressible: without it, two switches whose reads resolve in the
 * opposite order let the earlier choice overwrite the later one, and the opening
 * check cannot tell them apart because both carry the same opening.
 *
 * There is deliberately no field capable of carrying a file, a path, a command,
 * or a model. It names a provider the HOST already detected; the host
 * re-resolves that provider itself. Taking a switch submits nothing and creates
 * nothing.
 */
export interface WorktreeProvisionSwitchMessage {
  type: "worktreeProvisionSwitch";
  repoId: string;
  /** The opening the form was composed in. A retired one is not honoured. */
  opening: number;
  /** Monotonic per dialog. The highest seen wins, whatever order reads resolve in. */
  switch: number;
  /** Must be one the host itself put in the model it last offered for this form. */
  provider: ProvisionProvider["id"];
}

/**
 * WebView → Extension: which local branches does this repository have?
 *
 * Its own message rather than a field on `requestWorktreeCreateDefaults`,
 * which is re-asked on every settled branch edit: the ref list does not change
 * as the user types, and shipping it per keystroke answers a question nobody
 * asked again (offer-every-ref-in-one-box/design.md D1).
 */
/**
 * WebView → Extension: record what the user has chosen in the repository's own
 * provisioning configuration (worktree-provisioning.md § 6).
 *
 * Ids and ordering, and nothing else. No path, no key and no file text: the
 * host resolves `offerId` against the model it issued and computes every value
 * it writes. A webview that could supply the path to exclude would be the
 * authority on what the repository's configuration says, which is § 4.0's rule
 * for what EXECUTES applied one hop later (design.md D1).
 *
 * `repoId` selects a record in the host's own cache; it never becomes a
 * destination, even though it is spelled like a path.
 *
 * `switch` comes from the SAME sequence `worktreeProvisionSwitch` mints, so a
 * save and a source change order against each other. Without one shared
 * sequence, a save begun against the offer on screen can finish after a later
 * switch has published and overwrite the choice the user actually made
 * (design.md D8).
 */
export interface WorktreeProvisionSaveMessage {
  type: "worktreeProvisionSave";
  repoId: string;
  opening: number;
  switch: number;
  /** From `worktreeProvisionOffer`. Names the model the user was looking at. */
  offerId: string;
  /** Which of the host's own offered items the user left checked. */
  kept: readonly string[];
}

export interface WorktreeRefsRequestMessage {
  type: "requestWorktreeRefs";
  repoId: string;
  /**
   * Which OPENING of the create dialog is asking.
   *
   * `repoId` names a repository, not an opening, so a dialog closed and
   * reopened on the same repository leaves two conversations on the wire whose
   * answers are indistinguishable. The answer echoes this, and anything below
   * the current opening is dropped (design.md D1, round-2 W2).
   */
  token: number;
}

/**
 * What a resolution says a destination already holds — a REPORT, never an
 * authorization (design.md D4 of resolve-a-selection-before-the-create-runs).
 *
 * Narrower than {@link DestinationDisposition} on purpose: that type's `debris`
 * variant carries a `DebrisAuthorization`, and this one has no field a delete
 * could be built from. A probe is sent on every settled edit, so a reported
 * disposition that could authorize a removal would hand one out to nobody's
 * request.
 */
export type ResolvedDisposition = { kind: "free" } | { kind: "debris" };

/**
 * The classification, carrying only what the form needs to build a
 * `WorktreeCreateMode` — never the mode itself, because the form owns the base
 * ref and the detached choice and the resolver does not see them.
 *
 * `adopt` is named so the resolver can REPORT the state it detects; the form
 * does not offer it, and WT-012.15 owns what to do about it.
 */
export type ResolvedMode =
  | { kind: "fresh" }
  | { kind: "reuse" }
  | { kind: "reattach"; repairPath: string; expectedOid: string }
  | { kind: "adopt"; adoptPath: string };

/**
 * WebView → Extension: what would a create against this selection actually do?
 *
 * Sent per SETTLED selection rather than per keystroke. `query` echoes back so
 * the form can tell a current answer from one it has typed past, and `token`
 * says which OPENING asked — `repoId` names a repository, not an opening, so a
 * dialog closed and reopened on the same repository leaves two conversations on
 * the wire whose answers are otherwise indistinguishable (design.md D1).
 */
/** What the form would start a NEW branch from, so the host can resolve it (D7). */
export type ProbeBase = { kind: "ref"; ref: string } | { kind: "detached" };

/**
 * Whether the base the probe carried resolves to a commit (D7).
 *
 * Absent from a resolution whose mode refuses a base at all — `reuse` and
 * `reattach` start from something that already exists, and a verdict there
 * would imply a control the form has disabled is still live.
 */
export type BaseVerdict = { ok: true; oid: string } | { ok: false; reason: string };

export interface WorktreeCreateProbeMessage {
  type: "worktreeCreateProbe";
  repoId: string;
  token: number;
  /**
   * Monotonic per probe WITHIN one opening.
   *
   * `token` separates two openings and `query` separates two edits, but an
   * A → B → A edit sequence puts two answers on the wire identical in both, so
   * a delayed first answer could overwrite a newer one and restore a repair the
   * newest classification withdrew (round-1 B5).
   */
  seq: number;
  query: string;
  /**
   * A destination to assess INSTEAD of the derived candidate.
   *
   * Refused host-side when it is not inside the configured create root: the
   * answer states whether a path is occupied, and honouring an arbitrary one
   * would turn the probe into an existence oracle for the whole filesystem.
   */
  candidatePath?: string;
  /**
   * What the form would start a NEW branch from, so the host can resolve it.
   *
   * D5 puts this validation host-side "riding the resolution"; without the
   * field the wire could not carry the answer, and an unresolvable base stayed
   * a post-submit git failure (round-1 B4).
   */
  base?: ProbeBase;
}

export interface WorktreeRemoveRequestMessage {
  type: "worktreeRemove";
  worktreeId: string;
  fingerprint?: string;
  /** Absent by default: removal alone never implies deleting its branch. */
  deleteBranch?: BranchDeleteRequest;
}

/**
 * WebView → Extension: what would this removal cost? Answered, never acted on.
 *
 * Its own message because the only other way to obtain a report is
 * `worktreeMutationResult.result.kind === "blocked"`, which the host produces BY
 * ATTEMPTING THE REMOVAL. So a worktree with nothing at risk was deleted from
 * the first menu click, having never been reported at all — the ellipsis in
 * `Remove Worktree…` promised a dialog that could not exist for it (round-3 B1,
 * design.md D6). Declared in worktree-rpc.md § 2.1 since WT-013.1 and never
 * implemented until now.
 */
export interface WorktreeRemoveAssessRequestMessage {
  type: "worktreeRemoveAssess";
  worktreeId: string;
  /**
   * Orders answers; authorizes NOTHING. Minted per request by the asking
   * surface and echoed back unchanged, so a reply that arrives after the user
   * moved on is discarded instead of closing whatever dialog is open now and
   * replacing it with an obsolete report (round-4 W4, design.md D11). Force
   * authority stays the fingerprint below.
   */
  token: string;
}

/**
 * Extension → WebView: the removal report, and what it does or does not authorize.
 *
 * DISCRIMINATED rather than flat, and that is load-bearing. `checksFor` marks the
 * ENTIRE catalogue `unproven` for an assessment it could not make — refusal-class
 * checks included — and `isRefusedByChecks` refuses on an unproven refusal since
 * task 1_5. A flat payload would therefore render a worktree the host merely
 * could not READ as a hard refusal, offering no control at all, which is the
 * opposite of what the user needs (design.md D8).
 */
export interface WorktreeRemoveAssessmentMessage {
  type: "worktreeRemoveAssessment";
  worktreeId: string;
  /** The request's own token, echoed unchanged. The host never reads it (D11). */
  token: string;
  result:
    | {
        kind: "assessed";
        assessment: WorktreeRemoveAssessmentPayload;
        /**
         * PRESENCE is authority for one confirmed removal attempt, not authority
         * to force Git. Every readable non-refused assessment carries one; a
         * refusal carries null and mounts no confirmation control. The host
         * re-evaluates and derives ordinary versus forced execution from the fresh
         * evidence after redemption (design.md D7).
         */
        fingerprint: string | null;
      }
    | { kind: "unavailable"; unreadable: readonly string[] };
}

/** WebView → Extension: lock this worktree, optionally with a reason. */
export interface WorktreeLockMessage {
  type: "worktreeLock";
  worktreeId: string;
  /** Free text from the user. Refused host-side when it would read as a flag. */
  reason?: string;
}

/** WebView → Extension: release this worktree's lock. */
export interface WorktreeUnlockMessage {
  type: "worktreeUnlock";
  worktreeId: string;
}

/**
 * WebView → Extension: drop this repository's stale worktree registrations.
 *
 * `confirmedCount` is the number the confirmation named. The host re-counts
 * before running and re-prompts when the answer moved, so the user never
 * authorizes one number and gets another (design.md D13).
 */
export interface WorktreePruneMessage {
  type: "worktreePrune";
  repoId: string;
  confirmedCount: number;
}

/** WebView → Extension: show this worktree in the OS file manager. */
export interface WorktreeRevealInOSMessage {
  type: "worktreeRevealInOS";
  worktreeId: string;
}

/** WebView → Extension: copy this worktree's path. Offered for `missing` worktrees too. */
export interface WorktreeCopyPathMessage {
  type: "worktreeCopyPath";
  worktreeId: string;
}

/** WebView → Extension: a new terminal tab whose cwd is this worktree. */
export interface WorktreeOpenTerminalMessage {
  type: "worktreeOpenTerminal";
  worktreeId: string;
}

/**
 * WebView → Extension: reveal this agent row's pane.
 *
 * Window-scope rows only — an external row carries no `paneId` at all
 * (`presenceTypes.ts`), so the host cannot resolve one even if asked.
 */
export interface WorktreeFocusPaneMessage {
  type: "worktreeFocusPane";
  rowId: string;
  /** The pane the view believed the row had. Compared, never used. */
  paneId: string;
}

/** WebView → Extension: open this agent row's session preview. */
export interface WorktreeOpenPreviewMessage {
  type: "worktreeOpenPreview";
  rowId: string;
  /** The session the view believed the row had. Compared, never used. */
  entryId: string;
}

/** WebView → Extension: copy the command that resumes this agent row's session. */
export interface WorktreeCopyResumeCommandMessage {
  type: "worktreeCopyResumeCommand";
  rowId: string;
  entryId: string;
}

/** WebView → Extension: show this agent's working directory in the OS file manager. */
export interface WorktreeRevealAgentCwdMessage {
  type: "worktreeRevealAgentCwd";
  rowId: string;
  entryId: string;
}

/** WebView → Extension: copy this agent's working directory. */
export interface WorktreeCopyAgentPathMessage {
  type: "worktreeCopyAgentPath";
  rowId: string;
  entryId: string;
}

/**
 * WebView → Extension: this surface declares what it needs from presence. A
 * surface starts NOT visible and receives no push until it says otherwise — all
 * three surfaces retain their DOM while hidden, so pushing to one that never
 * showed the view pays render cost nobody asked for.
 *
 * `visible: false` means no subscription at all. `visible: true` means the
 * surface draws something from presence, and `level` says how much:
 *
 * - `"rows"` — the Worktree view is shown and agent rows are on screen.
 * - `"presence"` — the rail is not shown, but something else drawn from presence
 *   is: a scope's chip, its escape control, and the count carried on that
 *   control all survive a collapsed rail (worktree-panel-ui.md § 7.1). The
 *   surface still receives presence; the window skips per-row title and preview
 *   enrichment, which only rows consume.
 *
 * The field is optional and defaults to `"rows"`, so a sender that predates it
 * is unchanged.
 *
 * See: asimov/changes/cache-and-broadcast-worktree-tree/design.md D7;
 * asimov/changes/separate-presence-subscription-from-view-visibility/design.md D1.
 */
export interface WorktreeViewVisibilityMessage {
  type: "worktreeViewVisibility";
  visible: boolean;
  level?: WorktreeSubscriptionLevel;
}

/** What a subscribed surface draws from presence. See the message above. */
export type WorktreeSubscriptionLevel = "rows" | "presence";

/**
 * WebView → Extension: evidence about one pane that only the surface rendering
 * it can see — its title, and whether it is waiting on the user.
 *
 * **Partial by contract.** Title evidence and waiting evidence change at
 * different moments and come from different sources, so a message carries only
 * what changed. An absent field means *unchanged*, never `false`: a pane no
 * surface has reported yet has UNKNOWN waiting evidence, which falls through to
 * the next identity rank rather than resolving to "not waiting". A message that
 * required both would make the first title report invent `waiting: false` and
 * collapse that distinction on the one field the seam exists to keep honest.
 *
 * `title` is the decoration-stripped signature, never the raw title — an
 * unstripped title turns every spinner frame into a message. `decorated` is
 * carried if and only if `title` is, because stripping destroys it and the host
 * cannot recover it.
 *
 * Sent whenever the evidence changes, regardless of which body the surface is
 * showing: presence is window state, not per-surface state, so gating this on
 * worktree-view visibility would blind the host to exactly the panes one
 * surface alone renders.
 *
 * See: docs/design/worktree-agent-presence.md § 3.3 "The host evidence seam";
 *      asimov/changes/add-host-pane-evidence/design.md D3, D8.
 */
export interface PaneEvidenceMessage {
  type: "paneEvidence";
  /** The AT session id of the pane this evidence describes. */
  paneId: string;
  /** Decorative signature of the pane's title. Absent = unchanged. */
  title?: string;
  /** Whether the raw title carried a decorative frame. Present iff `title` is. */
  decorated?: boolean;
  /** Whether the pane is waiting on the user. Absent = unchanged. */
  waiting?: boolean;
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
  | RequestVaultMessageRecordMessage
  | RequestVaultLaunchTargetsMessage
  | VaultContinueSessionMessage
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
  | PasteOsClipboardImageMessage
  | RequestWorktreeTreeMessage
  | RequestWorktreeSubagentsMessage
  | WorktreeOpenFolderMessage
  | WorktreeRevealInOSMessage
  | WorktreeCopyPathMessage
  | WorktreeOpenTerminalMessage
  | WorktreeFocusPaneMessage
  | WorktreeOpenPreviewMessage
  | WorktreeCopyResumeCommandMessage
  | WorktreeRevealAgentCwdMessage
  | WorktreeCopyAgentPathMessage
  | WorktreeViewVisibilityMessage
  | WorktreeLaunchAgentMessage
  | WorktreeResumeHereMessage
  | WorktreeCreateRequestMessage
  | WorktreeCreateDefaultsRequestMessage
  | WorktreeCreateClosedMessage
  | WorktreeProvisionSwitchMessage
  | WorktreeProvisionSaveMessage
  | WorktreeRefsRequestMessage
  | WorktreeCreateProbeMessage
  | WorktreeAuthorizeDebrisMessage
  | WorktreeRemoveRequestMessage
  | WorktreeRemoveAssessRequestMessage
  | WorktreeLockMessage
  | WorktreeUnlockMessage
  | WorktreePruneMessage
  | PaneEvidenceMessage;

/** A `T` that is not `never` is a compile error — see {@link WORKTREE_MESSAGE_TYPES}. */
type AssertNever<T extends never> = T;

/**
 * Every worktree message the webview sends, derived from the union itself.
 *
 * Derived by the shape of the type NAME rather than listed, so membership is not
 * a second inventory somebody has to remember. `paneEvidence` is deliberately
 * outside it: pane evidence is window state routed to its own store, not a
 * worktree request (see the providers' `paneEvidence` case).
 */
export type WorktreeInboundMessage = Extract<
  WebViewToExtensionMessage,
  { type: `worktree${string}` | `requestWorktree${string}` }
>;

/**
 * The routing list, and the only thing a provider consults.
 *
 * Both providers used to name each worktree type in a `switch` of their own, and
 * the list already failed once in production: `requestWorktreeSubagents` was
 * declared, posted and handled, but reached neither provider, so the feature was
 * inert end to end with every unit test green — the host and the view are each
 * tested alone, and nothing tested the path between them.
 */
export const WORKTREE_MESSAGE_TYPES = [
  "requestWorktreeCreateDefaults",
  "worktreeCreateClosed",
  "worktreeProvisionSwitch",
  "worktreeProvisionSave",
  "requestWorktreeRefs",
  "worktreeCreateProbe",
  "worktreeAuthorizeDebris",
  "requestWorktreeTree",
  "requestWorktreeSubagents",
  "worktreeViewVisibility",
  "worktreeOpenFolder",
  "worktreeRevealInOS",
  "worktreeCopyPath",
  "worktreeOpenTerminal",
  "worktreeFocusPane",
  "worktreeOpenPreview",
  "worktreeCopyResumeCommand",
  "worktreeRevealAgentCwd",
  "worktreeCopyAgentPath",
  "worktreeLaunchAgent",
  "worktreeResumeHere",
  "worktreeCreate",
  "worktreeRemove",
  "worktreeRemoveAssess",
  "worktreeLock",
  "worktreeUnlock",
  "worktreePrune",
] as const satisfies readonly WorktreeInboundMessage["type"][];

/**
 * Fails the BUILD for a subunion member the list omits.
 *
 * `satisfies` above proves every listed type is real; this proves every real
 * type is listed, which is the direction the production defect ran. Without it
 * the routing test — driven from the same list — would only ever prove "every
 * listed type routes", never "every worktree type is listed".
 */
type _NoWorktreeMessageUnrouted = AssertNever<
  Exclude<WorktreeInboundMessage["type"], (typeof WORKTREE_MESSAGE_TYPES)[number]>
>;

/**
 * The worktree requests that ASK FOR SOMETHING TO HAPPEN, as opposed to the
 * three that ask for data or declare surface state. Derived, so a new action
 * type joins it by being named `worktree*` and not being one of the three.
 */
export type WorktreeActionMessage = Exclude<
  WorktreeInboundMessage,
  RequestWorktreeTreeMessage | RequestWorktreeSubagentsMessage | WorktreeViewVisibilityMessage
>;

/** Does this message belong to the worktree host? One test, both providers. */
export function isWorktreeMessage(msg: WebViewToExtensionMessage): msg is WorktreeInboundMessage {
  return (WORKTREE_MESSAGE_TYPES as readonly string[]).includes(msg.type);
}

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
  /**
   * Where `workspaceRoot` RESOLVES, for containment comparisons only.
   *
   * Separate from `workspaceRoot` because the two answer different questions:
   * that one mounts the tree and is echoed back to the user, so it must keep the
   * spelling they opened; this one decides whether a path the editor reports is
   * inside the workspace, and a physical path under a symlinked root is inside
   * it however either is spelled (design.md D1).
   *
   * `null` when there is no workspace, and equal to `workspaceRoot` when it has
   * not been resolved yet or does not resolve — the lexical answer, unchanged.
   */
  resolvedWorkspaceRoot: string | null;
  /**
   * At least one workspace folder is inside a git repository. Decides which body
   * the vault panel opens on when the user has recorded no choice — a decision
   * that has to be made before the first paint, and cannot wait for a tree the
   * host only pushes once a surface says it is showing the view.
   *
   * See: docs/design/worktree-panel-ui.md § 2.2;
   *      asimov/changes/wire-live-worktree-tree/design.md D1.
   */
  worktreeHasRepo: boolean;
  /**
   * What activating an agent row does. The INITIAL value only — a later change
   * arrives as `worktreeRowActivation`, because a view already open must not
   * need reopening to pick one up (design.md D5).
   */
  worktreeRowActivation: WorktreeRowActivation;
  /**
   * Whether this surface can perform the vault actions a user can INVOKE —
   * resume, rename, reveal, copy, open, continue, raw record, launch. False on an
   * editor surface, which answers `requestVaultSessions` and
   * `requestVaultSessionDetail` and none of the action messages, so a populated
   * list there would otherwise offer controls that silently do nothing — the
   * absent-not-disabled defect this change exists to remove (.reviews/round-2.md B4).
   *
   * One flag rather than a capability enum: the split is all-or-nothing per
   * surface today, so an enum would encode no real distinction.
   *
   * NOT gated: `vaultWatchSession`. It is automatic preview lifecycle traffic —
   * posted on open and released on close, never an offered control — so a surface
   * that does not answer it simply drops it and loses live-follow, with nothing
   * on screen claiming otherwise (.reviews/round-3.md S1).
   */
  vaultActionsAvailable: boolean;
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
  /** Where `rootPath` resolves; see `resolvedWorkspaceRoot` on the init payload. */
  resolvedRootPath: string | null;
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
  /**
   * The request's `requestId`, echoed verbatim. Present exactly when the request
   * carried one; host-initiated follow pushes never do. A reply bearing one is a
   * nested reply and renders only while that request is still pending (W15).
   */
  requestId?: string;
}

/**
 * Extension → Webview: reply to `requestVaultSessionDetail`. Discriminated XOR —
 * EXACTLY one of `detail` / `error` is present, so a producer cannot compile
 * while sending both or neither and consumers narrow without ambiguity (W3).
 */
export type VaultSessionDetailResponseMessage =
  | (VaultSessionDetailResponseBase & { detail: VaultSessionDetail; error?: never })
  | (VaultSessionDetailResponseBase & { error: string; detail?: never });

interface VaultMessageRecordResponseBase {
  type: "vaultMessageRecordResponse";
  /** Echoed so the webview can match the reply to its pending copy and drop stale ones. */
  entryId: string;
  msgRef: string;
}

/**
 * Extension → Webview: reply to `requestVaultMessageRecord`. Same XOR shape as the
 * detail response — exactly one of `record` / `error` is present.
 */
export type VaultMessageRecordResponseMessage =
  | (VaultMessageRecordResponseBase & { record: string; error?: never })
  | (VaultMessageRecordResponseBase & { error: string; record?: never });

/** Extension → Webview: reply to `requestVaultLaunchTargets` (D11). */
export interface VaultLaunchTargetsMessage {
  type: "vaultLaunchTargets";
  /**
   * Echoes the question. The two capabilities return different agent sets, so
   * without this a reply cannot be told from the other one's and would populate
   * whichever dialog happened to be listening (design.md D5).
   */
  capability: VaultLaunchCapability;
  targets: VaultLaunchTarget[];
  /** Identifies this answer, for a launch to quote back. Start capability only. */
  offerId?: string;
}

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
 * Extension → Webview: pane-scoped Cursor Agent semantic activity status,
 * sourced from renewable per-session hook authority (integrate-cursor-agent
 * design.md D6/D7). Posted ONLY through the session's own live webview — a
 * disposed/unknown/non-live session's runtime callback never reaches the
 * webview (spec: cursor-status-pane-isolation, hook-session-isolation).
 * `agent`/`state` are both `null` when semantic status is cleared (hook
 * disable, freshness expiry, or session-boundary `sessionStart`).
 */
export interface AgentActivityStatusMessage {
  type: "agentActivityStatus";
  /** Target terminal session ID */
  tabId: string;
  agent: "cursor" | null;
  state: "working" | "idle" | null;
}

/**
 * Extension → WebView: the whole Worktree view state.
 *
 * Sent both as the reply to `requestWorktreeTree` and unsolicited when the host
 * rebuilds; a recipient handles every arrival identically and never polls.
 *
 * `tree` and `presence` always travel together. Two messages would let a
 * recipient hold an agent row whose `worktreeId` is absent from the tree it
 * currently has — one message makes that unrepresentable. `presence` carries no
 * rows until WT-004 supplies the projection.
 *
 * See: docs/design/worktree-rpc.md § 2.2;
 *      asimov/changes/cache-and-broadcast-worktree-tree/design.md D6.
 */
export interface WorktreeTreeResponseMessage {
  type: "worktreeTreeResponse";
  tree: WorktreeTree;
  presence: WorktreePresence;
}

/**
 * Extension → WebView: show the session preview for an entry the HOST resolved.
 *
 * The panel's preview overlay is entirely webview-owned — `PreviewController`
 * builds and shows the floating shell and only then asks for detail — so the
 * extension cannot open one. Host-side validation is still the point: the
 * `entryId` here is the one the host's own presence carries for that row, not
 * the one the webview asked with, so a stale request opens nothing rather than
 * the wrong transcript.
 *
 * See: asimov/changes/wire-worktree-navigation-actions/design.md D2.
 */
export interface WorktreeShowPreviewMessage {
  type: "worktreeShowPreview";
  entryId: string;
}

/**
 * Extension → WebView: make this pane the active one in the surface holding it.
 *
 * Revealing a VS Code surface is the extension's job; selecting a pane INSIDE
 * that surface's webview is not. This message is delivered only to the surface
 * whose view holds the pane, after that surface has been revealed (D2, D4).
 */
export interface WorktreeActivatePaneMessage {
  type: "worktreeActivatePane";
  paneId: string;
}

/**
 * Extension → WebView: the row-activation setting changed.
 *
 * Every neighbouring UI setting here is live — terminal settings are rebroadcast
 * on configuration change and hover-preview settings have their own listeners —
 * so requiring a reload for this one would be worse behaviour than the panel's
 * own neighbours already offer (design.md D5).
 */
export interface WorktreeRowActivationMessage {
  type: "worktreeRowActivation";
  activation: WorktreeRowActivation;
}

/**
 * All messages that can be sent from the Extension Host to the WebView.
 * Use msg.type as the discriminant in switch/case for exhaustive handling.
 */
/**
 * Extension → WebView: what a mutation did.
 *
 * Typed because the previous wiring posted a bare object literal that no union
 * member described, so nothing could route it and no surface could render it
 * (round-2 W3). `blocked` is not a failure — it is the removal declining to run
 * until the blockers are confirmed — and `unavailable` is not a refusal, which
 * is why only it offers a retry (design.md D16).
 */
/**
 * The assessment a removal was stopped by, as the panel renders it.
 *
 * Carried on the message because the confirmation the panel reopens must name
 * exactly what the host assessed — a webview that recomputed this from the tree
 * would be authorizing a different set than the one the fingerprint binds.
 *
 * This replaced a record of booleans and counts. That record could not express
 * ignored content, a proof-gated option, `notApplicable`, or a per-check class,
 * and above all it could not say a check had not RUN: an unreadable `git status`
 * and a clean worktree both arrived as `dirty: false`, on the one action that
 * cannot be undone (worktree-rpc.md § 3.1).
 */
export interface WorktreeRemoveAssessmentPayload {
  readonly checks: readonly RemovalCheck[];
  /** Named, not just counted — the refusal tells the user what to remove first. */
  readonly contained: readonly { worktreeId: string; displayPath: string }[];
  /** Present only when the merge proof passed; presence gates the opt-in. */
  readonly branchDelete?: BranchDeleteOffer;
}

export interface WorktreeMutationResultMessage {
  type: "worktreeMutationResult";
  verb: "create" | "remove" | "lock" | "unlock" | "prune";
  repoId: string;
  /** The row the notice attaches to. Absent for the repo-scoped verbs. */
  worktreeId?: string;
  result:
    | { kind: "ok"; openFailed?: string; branchDelete?: WorktreeBranchDeleteOutcome }
    | { kind: "error"; message: string }
    | { kind: "indeterminate"; observed: string }
    | { kind: "unavailable"; unreadable: readonly string[] }
    | {
        kind: "blocked";
        worktreeId: string;
        fingerprint: string | null;
        assessment: WorktreeRemoveAssessmentPayload;
      };
}

/**
 * Extension → WebView: the destination a create will actually take.
 *
 * The HOST resolves it. The panel cannot: `specs/worktree-panel/spec.md` says a
 * create names the destination it will actually use, and only the host knows
 * the configured root, the repo's own layout, and which candidates are free.
 */
export interface WorktreeCreateDefaultsMessage {
  type: "worktreeCreateDefaults";
  repoId: string;
  /** Echoes the opening that asked, so a superseded form's answer is droppable. */
  opening: number;
  /** Free, suffixed if taken. */
  path: string;
  root: string;
  /** Base name a branch-derived path is appended to, e.g. `anywhere-terminal`. */
  prefix: string;
  /** The branch this answer was computed for, absent when none was named. */
  branch?: string;
  /**
   * The unsuffixed candidate's directory NAME, present only when it was taken.
   *
   * A name, never a path: `path` above already states where the create lands,
   * and the form draws this beside it. A second full path here is the
   * duplication WT-009.3 removed (worktree-rpc.md § 2).
   */
  collidedWith?: string;
}

/**
 * Extension → WebView: the repository's local branches, and which are taken.
 *
 * Absent is NOT "there are none": a repository whose branches could not be
 * enumerated must not render as one with no branches, so the form leaves the
 * list unavailable until this arrives and the create-new row carries the user
 * through either way.
 *
 * Not in `WORKTREE_MESSAGE_TYPES` — that list enumerates what the WEBVIEW sends.
 */
export interface WorktreeRefsMessage {
  type: "worktreeRefs";
  repoId: string;
  /** Echoed from the request, so an answer can be matched to its opening. */
  token: number;
  refs: readonly WorktreeRef[];
  /** The enumeration hit its cap and the list is partial — the form says so. */
  truncated: boolean;
}

/**
 * Extension → WebView: what a create against `query` would actually do.
 *
 * Not in `WORKTREE_MESSAGE_TYPES` — that list enumerates what the WEBVIEW sends.
 */
export interface WorktreeCreateResolutionMessage {
  type: "worktreeCreateResolution";
  repoId: string;
  /** Echoed from the request. An answer below the current opening is dropped. */
  token: number;
  /** Echoed, so a later answer can be told from an earlier one for one query. */
  seq: number;
  /** Echoed, so a form can tell a current answer from one it has typed past. */
  query: string;
  mode: ResolvedMode;
  /** The path the create would take. Always present — every mode has one. */
  freePath: string;
  /**
   * The path the suffixing SKIPPED, and what was found there.
   *
   * A full path rather than the directory name `worktreeCreateDefaults` carries:
   * this is what WT-012.12 would act on, and a name is not something a removal
   * can be aimed at.
   */
  occupiedCandidate?: { path: string; disposition: ResolvedDisposition };
  /** A branch checked out elsewhere: offered disabled, never submittable. */
  blockedBy?: { ownerPath: string };
  baseValid?: BaseVerdict;
}

/**
 * Extension → WebView: the provisioning model this create would apply, under the
 * id the selection quotes back.
 *
 * The model travels as DISPLAY material — paths, names, script text to show —
 * and the webview answers with `ProvisionSelection`, which carries ids only. The
 * host keeps the model this id names and executes from that, never from a
 * re-read of the provider files: re-reading after the user pressed Create is
 * exactly the window an untrusted checked-in file needs
 * (worktree-provisioning.md § 4.0).
 *
 * Not in `WORKTREE_MESSAGE_TYPES` — that list enumerates what the WEBVIEW sends.
 */
export interface WorktreeProvisionOfferMessage {
  type: "worktreeProvisionOffer";
  repoId: string;
  /**
   * Echoes the opening this model was resolved for.
   *
   * Without it the panel cached whatever arrived, so a predecessor's read
   * landing after a reopening published its model into a form that never asked
   * for it (design.md D2).
   */
  opening: number;
  /** Opaque and per-offer. Not a path, and not stable across offers. */
  offerId: string;
  model: ProvisionModel;
}

/**
 * What became of one offered provisioning item.
 *
 * `refused` and `failed` are separate answers on purpose. Refused means the
 * extension decided not to and the reason is a rule the user can act on — an
 * escaping path, a special file, a lockfile, `node_modules` as a link. Failed
 * means it was allowed and it did not work. `skipped` is neither: nothing was
 * wrong and, crucially, nothing was replaced.
 */
export type ProvisionStepOutcome =
  | { readonly kind: "copied" }
  | { readonly kind: "linked" }
  /** Asked to link; the platform had no symlink to give, so the content was copied. */
  | { readonly kind: "degradedToCopy" }
  /** The destination was already there. Nothing written, nothing replaced. */
  | { readonly kind: "skipped"; readonly reason: string }
  /** A rule forbade it. */
  | { readonly kind: "refused"; readonly reason: string }
  /** It was allowed and it did not work. */
  | { readonly kind: "failed"; readonly reason: string };

/**
 * One offered item's outcome, answering the id the offer issued.
 *
 * Documented at worktree-rpc.md § 2.2 since before there was a producer; this
 * is its first definition.
 */
/**
 * One declaration in a contest, as a refusal names it.
 *
 * Carried once per contest rather than repeated inside every member's reason:
 * every member naming every member is `O(N²)` of text over a wire whose input
 * the model already caps, so a valid group could expand a few hundred kilobytes
 * of declarations into tens of megabytes of report
 * (`award-a-contested-destination-or-refuse-it/.reviews/round-3.md` F008).
 */
export interface ProvisionResultMember {
  readonly id: string;
  /** Repo-relative POSIX path, for display. */
  readonly path: string;
  /** The provider file that declared it, for display. */
  readonly source: string;
}

/** A set of declarations that may name one destination, as the apply found them. */
export interface ProvisionResultContest {
  readonly members: readonly ProvisionResultMember[];
}

export interface ProvisionStepResult {
  /** The offer item this answers. Opaque and per-offer — never a path. */
  readonly id: string;
  /** Repo-relative POSIX path, for display. Echoed from the host's own entry. */
  readonly path: string;
  readonly outcome: ProvisionStepOutcome;
  /**
   * Descendants of a directory entry that were skipped or refused, and why.
   *
   * A directory entry has ONE outcome but many nodes, and a file skipped inside
   * an existing destination has to be reportable — which a single top-level
   * `copied` cannot express. Bounded and display-ready; absent for a file entry.
   */
  readonly details?: readonly { readonly path: string; readonly reason: string }[];
  /**
   * Index into the result message's `contests`, when this step is a member of
   * one. The reason says what happened; the contest says who else was named.
   */
  readonly contest?: number;
}

/**
 * Extension → WebView: what provisioning did, per item, after a create.
 *
 * Arrives AFTER the create's own result. Provisioning never changes whether the
 * create succeeded (worktree-apply.md § 1), so this message never carries a
 * verdict on the create itself.
 *
 * Not in `WORKTREE_MESSAGE_TYPES` — that list enumerates what the WEBVIEW sends.
 */
export interface WorktreeProvisionResultMessage {
  type: "worktreeProvisionResult";
  worktreeId: string;
  steps: readonly ProvisionStepResult[];
  /** Referenced by `ProvisionStepResult.contest`; absent when nothing contested. */
  contests?: readonly ProvisionResultContest[];
}

/**
 * Extension → WebView: the repository's open pull requests, or the one state
 * that says there are none to be had.
 *
 * Its own message rather than a field on `worktreeRefs`: the refs read is local
 * and the forge read is a network call, and worktree-create.md § 4.1 requires
 * that "a slow or unauthenticated forge never blocks branch search underneath
 * it". Folding them together is exactly the wait that rule forbids.
 *
 * `available: false` carries no reason. A missing client, an unauthenticated
 * forge, a timeout and unparseable output are one row to the user (§ 5), and
 * four variants here would be four the form has to collapse again.
 *
 * Not in `WORKTREE_MESSAGE_TYPES` — that list enumerates what the WEBVIEW sends.
 */
interface WorktreePullRequestsBase {
  type: "worktreePullRequests";
  repoId: string;
  /** Echoed from the refs request, so an answer can be matched to its opening. */
  token: number;
}

/**
 * A union on `available` rather than optional fields beside a flag
 * (.reviews/round-1.md W2). Optional rows next to a boolean can spell "answered
 * with no list" and "unavailable with a list", and every reader then has to
 * decide which half to believe. Here the invalid pairs cannot be written.
 */
export type WorktreePullRequestsMessage =
  | (WorktreePullRequestsBase & {
      available: true;
      pullRequests: readonly PullRequestOffer[];
      /** The enumeration hit its cap and the list is partial — the form says so. */
      truncated: boolean;
    })
  | (WorktreePullRequestsBase & {
      available: false;
      pullRequests?: undefined;
      truncated?: undefined;
    });

/**
 * One pull request as the form receives it.
 *
 * A structural copy of `PullRequest` rather than an import: this module is the
 * wire vocabulary and the webview builds against it, so a host-side read's
 * shape must not become the contract by accident.
 */
export interface PullRequestOffer {
  number: number;
  title: string;
  /** The branch the pull request is FROM. Never the branch a create mints. */
  headRefName: string;
  /** What a create from this pull request branches off. */
  baseRefName: string;
  /** The head is on a fork, so a remote would have to be configured (§ 5). */
  fromFork: boolean;
  /** Whose fork, when it is one — what the form names before authorizing. */
  headOwner: string;
}

export type ExtensionToWebViewMessage =
  | WorktreeMutationResultMessage
  | WorktreeRemoveAssessmentMessage
  | WorktreeCreateDefaultsMessage
  | WorktreeRefsMessage
  | WorktreePullRequestsMessage
  | WorktreeCreateResolutionMessage
  | WorktreeDebrisAuthorizedMessage
  | WorktreeProvisionOfferMessage
  | WorktreeProvisionResultMessage
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
  | VaultMessageRecordResponseMessage
  | VaultLaunchTargetsMessage
  | VaultContextCwdMessage
  | SubagentPreviewResponseMessage
  | ClipboardImagePreviewMessage
  | OsClipboardPasteMissMessage
  | OpenVaultMessage
  | AgentActivityStatusMessage
  | WorktreeTreeResponseMessage
  | WorktreeShowPreviewMessage
  | WorktreeActivatePaneMessage
  | WorktreeRowActivationMessage;

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
