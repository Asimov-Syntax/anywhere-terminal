// WebviewPanelSerializer for editor-area terminals. Registered for view type
// `anywhereTerminal.editor` in `extension.activate`. On window reload, VS Code
// invokes `deserializeWebviewPanel(panel, state)` for every serialized panel.
//
// Sequence (mirrors VS Code's markdown-preview pattern + design.md D2/D3/D7):
//   1. Resolve panelId from state.panelId (fallback: fresh UUID for legacy panels).
//   2. Cancel the grace-period destroy scheduled by the prior provider instance.
//   3. Consume any pending restore snapshots that were rehydrated on activate.
//   4. Construct a new TerminalEditorProvider that takes over the panel.

import * as crypto from "node:crypto";
import type * as vscode from "vscode";
import type { PaneEvidenceStore } from "../session/PaneEvidenceStore";
import type { SessionManager } from "../session/SessionManager";
import type { ResolvedPathMemo } from "../utils/resolvedPathMemo";
import type { VaultService } from "../vault/VaultService";
import type { WatcherPool } from "./fsWatcherPool";
import type { GitDecorationProvider } from "./gitDecorationProvider";
import { TerminalEditorProvider } from "./TerminalEditorProvider";
import type { WorktreeHost } from "./WorktreeHost";

export class TerminalPanelSerializer implements vscode.WebviewPanelSerializer<{ panelId?: string }> {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessionManager: SessionManager,
    private readonly gitDecorationProvider: GitDecorationProvider | null,
    private readonly watcherPool: WatcherPool | null,
    private readonly worktreeHost: WorktreeHost | null = null,
    /**
     * Threaded through for the same reason `worktreeHost` is: a panel revived
     * here never passes through `createPanel`, so a store wired only there
     * would leave every restored editor reporting into nothing.
     */
    private readonly paneEvidence: PaneEvidenceStore | null = null,
    /** Threaded through for the same reason `worktreeHost` is — a revived panel
     *  never passes through `createPanel`, and its worktree rows offer preview. */
    private readonly vaultService: VaultService | null = null,
    /** Threaded through for the same reason `worktreeHost` is — a revived panel
     *  never passes through `createPanel` (round-2 B1). */
    private readonly pathMemo: ResolvedPathMemo | null = null,
  ) {}

  async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: { panelId?: string } | null): Promise<void> {
    const stateMissing = !state?.panelId;
    const panelId = state?.panelId ?? crypto.randomUUID();
    const viewId = `editor-${panelId}`;

    if (stateMissing) {
      // No panelId in state means we cannot match this revival to any prior
      // identity: `cancelScheduledDestroy` won't find the right grace timer
      // (the original viewId is unknown — it lives under the lost panelId),
      // and `consumeSnapshotsForPanel(freshUUID)` returns nothing. The grace-
      // period destroy from the prior instance WILL fire ~5s after this
      // revive and kill the PTY. Surface a warning so the silent failure
      // is at least visible in dev logs. See .reviews/round-4.md [W2].
      console.warn(
        "[AnyWhere Terminal] Editor panel revived without prior panelId state — " +
          "scheduled destroy from prior instance may fire and kill the new PTY; " +
          "persisted snapshot for the original panelId stays orphaned and will be " +
          "swept by the next activate's hydrate.",
      );
      // Best-effort: sweep any pending editor-* destroys older than the
      // grace window. If we just constructed a fresh viewId, no other live
      // panel can claim it — safer to cancel ALL pending editor destroys
      // than to let one fire on our newly-spawned PTY. Conservative: only
      // cancel if no live editor panel currently owns each one.
      for (const pendingId of this.sessionManager.getPendingDestroyViewIds()) {
        if (pendingId.startsWith("editor-") && !TerminalEditorProvider.findByViewId(pendingId)) {
          this.sessionManager.cancelScheduledDestroy(pendingId);
        }
      }
    } else {
      // Cancel the grace-period destroy BEFORE constructing the new provider so
      // surviving PTYs from the prior instance aren't killed mid-revive.
      this.sessionManager.cancelScheduledDestroy(viewId);
    }

    // Pull any persisted snapshots that hydrate-on-activate has staged for
    // this panel. Empty array on Phase A reloads (sessions survive in memory)
    // or when state was missing (fresh UUID can't match anything).
    const snapshots = this.sessionManager.consumeSnapshotsForPanel(panelId);

    TerminalEditorProvider.revive(
      this.context,
      this.sessionManager,
      panel,
      panelId,
      snapshots,
      this.gitDecorationProvider,
      this.watcherPool,
      this.worktreeHost,
      this.paneEvidence,
      this.vaultService,
      this.pathMemo,
    );
  }
}
