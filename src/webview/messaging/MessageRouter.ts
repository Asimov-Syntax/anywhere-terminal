// src/webview/messaging/MessageRouter.ts — Typed message dispatch
//
// Replaces the monolithic switch statement with a typed dispatch table.
// Each message type maps to a named handler from the MessageHandlers interface.
//
// See: docs/design/message-protocol.md

import type {
  ClipboardImagePreviewMessage,
  CloseSplitPaneByIdMessage,
  ConfigUpdateMessage,
  CtxClearMessage,
  ErrorMessage,
  ExitMessage,
  ExtensionToWebViewMessage,
  FilePreviewResultMessage,
  FileTreeSearchResponseMessage,
  FlashPaneMessage,
  FsChangesInvalidatedMessage,
  FsRehydrateMessage,
  GitStatusChangedMessage,
  HoverPreviewSettingsMessage,
  InsertPathEffectMessage,
  OpenVaultMessage,
  OsClipboardPasteMissMessage,
  OutputMessage,
  ReadDirectoryResponseMessage,
  RequestScrollbackDumpMessage,
  RestoreFromSnapshotMessage,
  RestoreMessage,
  RevealInFileTreeMessage,
  SetFileTreePositionMessage,
  SetPanelIdMessage,
  SplitPaneAtMessage,
  SplitPaneCreatedMessage,
  SplitPaneMessage,
  SubagentPreviewResponseMessage,
  TabCreatedMessage,
  TabRemovedMessage,
  TabRenamedMessage,
  ThemeChangedMessage,
  VaultContextCwdMessage,
  VaultSessionDetailResponseMessage,
  VaultSessionsResponseMessage,
  WorkspaceRootChangedMessage,
} from "../../types/messages";

// ─── Types ──────────────────────────────────────────────────────────

/**
 * Handler interface for non-init message types.
 * Each handler receives the typed message payload.
 * Handlers with no payload take no arguments.
 *
 * `init` is excluded — it's bootstrap orchestration handled directly by main.ts.
 */
export interface MessageHandlers {
  onOutput(msg: OutputMessage): void;
  onExit(msg: ExitMessage): void;
  onTabCreated(msg: TabCreatedMessage): void;
  onTabRemoved(msg: TabRemovedMessage): void;
  onTabRenamed(msg: TabRenamedMessage): void;
  onRestore(msg: RestoreMessage): void;
  onConfigUpdate(msg: ConfigUpdateMessage): void;
  onViewShow(): void;
  onSplitPane(msg: SplitPaneMessage): void;
  onSplitPaneCreated(msg: SplitPaneCreatedMessage): void;
  onCloseSplitPane(): void;
  onCloseSplitPaneById(msg: CloseSplitPaneByIdMessage): void;
  onSplitPaneAt(msg: SplitPaneAtMessage): void;
  onCtxClear(msg: CtxClearMessage): void;
  onError(msg: ErrorMessage): void;
  onInsertPathEffect(msg: InsertPathEffectMessage): void;
  onFilePreviewResult(msg: FilePreviewResultMessage): void;
  onThemeChanged(msg: ThemeChangedMessage): void;
  onHoverPreviewSettings(msg: HoverPreviewSettingsMessage): void;
  // ── File-tree (port-vscode-async-data-tree) ──
  onReadDirectoryResponse(msg: ReadDirectoryResponseMessage): void;
  onWorkspaceRootChanged(msg: WorkspaceRootChangedMessage): void;
  onSetFileTreePosition(msg: SetFileTreePositionMessage): void;
  onRevealInFileTree(msg: RevealInFileTreeMessage): void;
  // ── File-tree search (add-file-tree-search) ──
  onFileTreeSearchResponse(msg: FileTreeSearchResponseMessage): void;
  // ── File-tree git decorations (add-file-tree-git-decorations) ──
  onGitStatusChanged(msg: GitStatusChangedMessage): void;
  // ── File-tree FS watcher (add-file-tree-fs-watcher) ──
  onFsChangesInvalidated(msg: FsChangesInvalidatedMessage): void;
  onFsRehydrate(msg: FsRehydrateMessage): void;
  // ── Session restore (restore-terminal-sessions) ──
  onSetPanelId(msg: SetPanelIdMessage): void;
  onRestoreFromSnapshot(msg: RestoreFromSnapshotMessage): void;
  // ── Export terminal session (export-terminal-session) ──
  onRequestScrollbackDump(msg: RequestScrollbackDumpMessage): void;
  onFlashPane(msg: FlashPaneMessage): void;
  // ── AI coding vault (add-ai-coding-vault) ──
  // Optional: a webview without a mounted vault panel safely ignores these.
  onVaultSessionsResponse?(msg: VaultSessionsResponseMessage): void;
  onVaultSessionDetailResponse?(msg: VaultSessionDetailResponseMessage): void;
  onVaultContextCwd?(msg: VaultContextCwdMessage): void;
  onOpenVault?(msg: OpenVaultMessage): void;
  // ── Subagent preview popup (preview-subagent-popup) ──
  // Optional: a webview with no terminal factory mounted safely ignores it.
  onSubagentPreviewResponse?(msg: SubagentPreviewResponseMessage): void;
  // ── Pasted-image preview + host-read fallback (macOS Ctrl+V / Windows Ctrl+V) ──
  onClipboardImagePreview?(msg: ClipboardImagePreviewMessage): void;
  onOsClipboardPasteMiss?(msg: OsClipboardPasteMissMessage): void;
}

// ─── Factory ────────────────────────────────────────────────────────

/**
 * Create a message router function that dispatches to typed handlers.
 *
 * The `init` message type is NOT routed — it must be handled separately
 * by the caller (main.ts bootstrap). Unknown message types are silently
 * ignored (matches current behavior).
 *
 * @param handlers - Object implementing the MessageHandlers interface
 * @returns A dispatch function that routes ExtensionToWebViewMessage to the correct handler
 */
export function createMessageRouter(handlers: MessageHandlers): (msg: ExtensionToWebViewMessage) => void {
  return (msg: ExtensionToWebViewMessage): void => {
    switch (msg.type) {
      case "output":
        handlers.onOutput(msg);
        break;
      case "exit":
        handlers.onExit(msg);
        break;
      case "tabCreated":
        handlers.onTabCreated(msg);
        break;
      case "tabRemoved":
        handlers.onTabRemoved(msg);
        break;
      case "tabRenamed":
        handlers.onTabRenamed(msg);
        break;
      case "restore":
        handlers.onRestore(msg);
        break;
      case "configUpdate":
        handlers.onConfigUpdate(msg);
        break;
      case "viewShow":
        handlers.onViewShow();
        break;
      case "splitPane":
        handlers.onSplitPane(msg);
        break;
      case "splitPaneCreated":
        handlers.onSplitPaneCreated(msg);
        break;
      case "closeSplitPane":
        handlers.onCloseSplitPane();
        break;
      case "closeSplitPaneById":
        handlers.onCloseSplitPaneById(msg);
        break;
      case "splitPaneAt":
        handlers.onSplitPaneAt(msg);
        break;
      case "ctxClear":
        handlers.onCtxClear(msg);
        break;
      case "error":
        handlers.onError(msg);
        break;
      case "insertPathEffect":
        handlers.onInsertPathEffect(msg);
        break;
      case "filePreviewResult":
        handlers.onFilePreviewResult(msg);
        break;
      case "themeChanged":
        handlers.onThemeChanged(msg);
        break;
      case "hoverPreviewSettings":
        handlers.onHoverPreviewSettings(msg);
        break;
      case "read-directory-response":
        handlers.onReadDirectoryResponse(msg);
        break;
      case "workspace-root-changed":
        handlers.onWorkspaceRootChanged(msg);
        break;
      case "set-file-tree-position":
        handlers.onSetFileTreePosition(msg);
        break;
      case "reveal-in-file-tree":
        handlers.onRevealInFileTree(msg);
        break;
      case "file-tree-search-response":
        handlers.onFileTreeSearchResponse(msg);
        break;
      case "git-status-changed":
        handlers.onGitStatusChanged(msg);
        break;
      case "fs-changes-invalidated":
        handlers.onFsChangesInvalidated(msg);
        break;
      case "fs-rehydrate":
        handlers.onFsRehydrate(msg);
        break;
      case "setPanelId":
        handlers.onSetPanelId(msg);
        break;
      case "restoreFromSnapshot":
        handlers.onRestoreFromSnapshot(msg);
        break;
      case "requestScrollbackDump":
        handlers.onRequestScrollbackDump(msg);
        break;
      case "flashPane":
        handlers.onFlashPane(msg);
        break;
      case "vaultSessionsResponse":
        handlers.onVaultSessionsResponse?.(msg);
        break;
      case "vaultSessionDetailResponse":
        handlers.onVaultSessionDetailResponse?.(msg);
        break;
      case "vaultContextCwd":
        handlers.onVaultContextCwd?.(msg);
        break;
      case "openVault":
        handlers.onOpenVault?.(msg);
        break;
      case "subagentPreviewResponse":
        handlers.onSubagentPreviewResponse?.(msg);
        break;
      case "clipboardImagePreview":
        handlers.onClipboardImagePreview?.(msg);
        break;
      case "osClipboardPasteMiss":
        handlers.onOsClipboardPasteMiss?.(msg);
        break;
      case "init":
        // init is handled directly by main.ts — not routed
        break;
      default:
        // Silently ignore unknown message types
        break;
    }
  };
}
