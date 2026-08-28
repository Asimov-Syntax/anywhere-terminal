// src/session/SessionManager.ts — Central registry for all terminal sessions.
//
// Owns: session map, view→session index, terminal-number recycling, grace-period
// destroy queue, the operation-queue serializing destructive operations, and the
// PTY lifecycle wiring (spawn / onData / onExit / resize / kill).
//
// Delegates:
//   - cross-restart snapshot pipeline → SnapshotPersistence
//   - editor-panel registry           → EditorPanelRegistry
//   - per-number custom names         → CustomNameRegistry
//
// See: docs/design/session-manager.md and
//      asimov/changes/restore-terminal-sessions/design.md (D1-D13).

import * as crypto from "node:crypto";
import type { SessionEnvironmentContributor } from "../agentHooks/AgentHookRuntime";
import * as PtyManager from "../pty/PtyManager";
import { PtySession } from "../pty/PtySession";
import { queryProcessCwd } from "../pty/processCwd";
import type { InjectionContext } from "../pty/ShellIntegrationInjector";
import { CustomNameRegistry, type CustomNameStorage, noopCustomNameStorage } from "./CustomNameRegistry";
import { EditorPanelRegistry } from "./EditorPanelRegistry";
import type { MessageSender } from "./OutputBuffer";
import { OutputBuffer } from "./OutputBuffer";
import type { PaneEvidenceStore } from "./PaneEvidenceStore";
import { ScrollbackDumpCoordinator, type ScrollbackDumpPayload } from "./ScrollbackDumpCoordinator";
import type {
  LiveEditorPanelsRecord,
  PendingSnapshot,
  SessionSnapshotMetadata,
  SessionSnapshotsIndex,
} from "./SessionSnapshot";
import type { SessionStorage } from "./SessionStorage";
import { ShellIntegrationCoordinator } from "./ShellIntegrationCoordinator";
import { defaultHeadlessFactory, defaultSerializeAddonFactory, SnapshotPersistence } from "./SnapshotPersistence";
import type {
  HeadlessFactory,
  MemoryMetrics,
  SerializeAddonFactory,
  SessionState,
  TerminalSession,
} from "./TerminalSession";
import { CommandTracker, type TrackedCommand } from "./TrackedCommand";

// ─── Re-exports (preserve external API for tests + providers) ──────

export type { CustomNameStorage } from "./CustomNameRegistry";
export { truncateSnapshotBuffer } from "./SnapshotPersistence";
export type {
  HeadlessFactory,
  HeadlessTerminalLike,
  MemoryMetrics,
  SerializeAddonFactory,
  SerializeAddonLike,
  SessionState,
  TerminalSession,
} from "./TerminalSession";

// ─── Constants ──────────────────────────────────────────────────────

/** Maximum total size of scrollback cache per session (in characters). Default 512KB. */
const SCROLLBACK_MAX_SIZE = 512 * 1024;

/** Default grace window between an editor panel disposing and the underlying PTY being destroyed. */
const DEFAULT_GRACE_DESTROY_MS = 5000;

// ─── Options ────────────────────────────────────────────────────────

/**
 * Optional configuration for cross-restart session restore. See:
 * asimov/changes/restore-terminal-sessions/design.md D1, D3, D11.
 */
export interface SessionManagerOptions {
  /** Default false — set true once the rest of the restore pipeline is wired. */
  restoreEnabled?: boolean;
  /** Default 5000ms — grace window before destroying sessions whose webview disposed. */
  gracePeriodMs?: number;
  /** Test seam: inject a fake headless constructor. */
  headlessFactory?: HeadlessFactory;
  /** Test seam: inject a fake serialize-addon constructor. */
  serializeAddonFactory?: SerializeAddonFactory;
  /** Persistence backend for cross-restart snapshots. Required when restoreEnabled === true. */
  storage?: SessionStorage;
  /**
   * Shell-integration injection context. When provided, recognised shells
   * (bash/zsh/fish/pwsh) get their args+env mutated at spawn time so
   * OSC 633 markers stream into the session's tracked-command runtime.
   * Omit to disable integration (e.g. in unit tests).
   * See: asimov/changes/export-terminal-session/design.md D3.
   */
  shellIntegrationContext?: InjectionContext;
  /**
   * Window-scoped pane evidence for the Worktree view's presence projection.
   * Written, never read, by this class: it is the registry of what the host
   * knows about each pane, and this is the only place that knows when a pane
   * comes into existence, produces output, exits, or closes.
   *
   * See: asimov/changes/add-host-pane-evidence/design.md D2, D6.
   */
  paneEvidence?: PaneEvidenceStore;
  /**
   * Optional per-session environment contributor for renewable agent-hook
   * authority (design D6, integrate-cursor-agent 2_3). One contributor serves
   * every enabled agent, so a spawn's coordinates arrive whole or not at all
   * (generalize-agent-hook-runtime D1). Every live PTY incarnation (initial
   * spawn + fallback-shell respawn) merges its fresh
   * `create(sessionId)` env into the spawn env; authority is released on
   * failed spawn, natural exit, destroy, and manager disposal. May also be
   * attached/detached post-construction via `setAgentHookContributor` —
   * `extension.ts` wires it that way because the hook runtime binds its
   * loopback listener asynchronously, after SessionManager is constructed.
   */
  agentHookContributor?: SessionEnvironmentContributor;
}

// ─── SessionManager ─────────────────────────────────────────────────

/**
 * Central registry for all terminal sessions across all views.
 *
 * Owns the lifecycle of each terminal session: creation, input/output routing,
 * resize, and destruction. Handles tab numbering with gap-filling recycling,
 * serializes destructive operations via operation queue, and maintains
 * scrollback cache for view restore. Cross-restart persistence is delegated to
 * SnapshotPersistence; custom tab names to CustomNameRegistry; editor-panel
 * tracking to EditorPanelRegistry.
 */
export class SessionManager {
  /** All sessions indexed by session ID */
  private sessions = new Map<string, TerminalSession>();

  /** View ID → ordered list of session IDs */
  private viewSessions = new Map<string, string[]>();

  /** Set of terminal numbers currently in use (for recycling) */
  private usedNumbers = new Set<number>();

  /** Set of session IDs currently being killed (prevent re-entrant cleanup) */
  private terminalBeingKilled = new Set<string>();

  /** Serialized operation queue for destructive operations */
  private operationQueue: Promise<void> = Promise.resolve();

  /** Whether this manager has been disposed */
  private _disposed = false;

  /** Pending grace-period destroys keyed by viewId. */
  private pendingDestroys: Map<string, NodeJS.Timeout> = new Map();

  /** Default grace window applied when scheduleDestroyForView is called without an explicit delay. */
  private readonly defaultGracePeriodMs: number;

  /**
   * Shell-integration coordinator — owns the per-session cleanup map, the
   * injector wiring, and the OSC 633 event reducer. Extracted from
   * SessionManager so the central registry stays focused on session lifecycle.
   * See: .reviews/round-1.md [W1].
   */
  private readonly shellIntegration: ShellIntegrationCoordinator;

  /**
   * Scrollback-dump coordinator — owns the in-flight `pendingDumps` map and
   * the request/reply/abort/timeout state machine. See: design.md D4 + W1.
   */
  private readonly scrollbackDumps: ScrollbackDumpCoordinator;

  /** Per-number custom-name persistence (workspace-scoped). */
  private readonly customNames: CustomNameRegistry;

  /** Live editor-panel registry (panelId → entry); persisted via SessionStorage. */
  protected readonly editorPanels: EditorPanelRegistry;

  /** Cross-restart snapshot pipeline (headless mirror, persist + hydrate). */
  private readonly snapshots: SnapshotPersistence;

  /** Persistence backend (workspaceState index + buffer files). May be null in tests. */
  private storage: SessionStorage | null;

  /**
   * Optional per-session agent-hook environment contributor (design D6).
   * Not `readonly` — `setAgentHookContributor` may attach/detach it after
   * construction (extension.ts wiring, and hook-disable teardown).
   */
  private agentHooks: SessionEnvironmentContributor | undefined;

  /** See `SessionManagerOptions.paneEvidence`. Absent in tests that don't need it. */
  private readonly paneEvidence: PaneEvidenceStore | undefined;

  /**
   * Hook fired internally when a session's shell exits — schedules an
   * immediate snapshot so the exit state survives a sudden window close.
   * Public so tests can observe / override the hook.
   */
  onShellExited?: (sessionId: string) => void;

  constructor(customNameStorage: CustomNameStorage = noopCustomNameStorage, options: SessionManagerOptions = {}) {
    this.customNames = new CustomNameRegistry(customNameStorage);
    this.storage = options.storage ?? null;
    this.agentHooks = options.agentHookContributor;
    this.paneEvidence = options.paneEvidence;
    this.defaultGracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_DESTROY_MS;
    this.shellIntegration = new ShellIntegrationCoordinator({
      ctx: options.shellIntegrationContext,
      getSession: (id) => this.sessions.get(id),
      setCurrentCwd: (id, cwd) => this.setCurrentCwd(id, cwd),
    });
    this.scrollbackDumps = new ScrollbackDumpCoordinator({
      postMessage: (webview, msg) => this.safePostMessage(webview, msg),
    });
    this.editorPanels = new EditorPanelRegistry((record) => {
      // Only write through to storage when restore is enabled; otherwise we
      // produce churn against `workspaceState` for no benefit.
      if (!this.snapshots.isRestoreEnabled() || !this.storage) {
        return;
      }
      this.storage.scheduleLivePanelsWrite(record);
    });
    this.snapshots = new SnapshotPersistence({
      restoreEnabled: options.restoreEnabled ?? false,
      storage: this.storage,
      headlessFactory: options.headlessFactory ?? defaultHeadlessFactory,
      serializeAddonFactory: options.serializeAddonFactory ?? defaultSerializeAddonFactory,
      getSession: (id) => this.sessions.get(id),
      // Pass live-panels lookup so hydrate orphan fallback maps editor
      // session ids back to their owning panel (round-1 W2).
      editorPanels: this.editorPanels,
    });
    // Default exit-hook → intentful commitExitSnapshot (sync). The exit
    // snapshot is durable BEFORE cleanupSession runs; cleanupSession then
    // dispatches releaseRuntimeOnly (state === "exited-preserved") so the
    // just-committed snapshot survives for D13 read-only restore. Tests
    // override `onShellExited` directly. See design.md D15.
    this.onShellExited = (sessionId) => {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return;
      }
      this.snapshots.commitExitSnapshot(sessionId, session.exitCode ?? null);
    };
  }

  /** Test/inspection helper — current value of the restore-enabled flag. */
  isRestoreEnabled(): boolean {
    return this.snapshots.isRestoreEnabled();
  }

  /**
   * Flip the restore-enabled flag at runtime in response to a
   * `anywhereTerminal.sessionRestore.enabled` setting change. See design.md D11.
   */
  setRestoreEnabled(enabled: boolean): void {
    this.snapshots.setRestoreEnabled(enabled, this.sessions.keys());
    if (!enabled) {
      this.editorPanels.clear();
    }
  }

  /**
   * Attach (or detach with `undefined`) the agent-hook session-environment
   * contributor. Called by the hook controller once the runtime finishes
   * binding its loopback listener, and again when the last authoritative
   * agent goes away (generalize-agent-hook-runtime D6) — every session
   * created afterward gets fresh renewable hook authority
   * (design D6). Same-reference calls are a no-op. Swapping to a different
   * contributor (including `undefined`) first releases EVERY currently
   * tracked session through the OLD contributor, so a token minted while
   * attached can never "go live" later just by re-attaching without a fresh
   * PTY (hook-session-isolation).
   */
  setAgentHookContributor(contributor: SessionEnvironmentContributor | undefined): void {
    if (contributor === this.agentHooks) {
      return;
    }
    const previous = this.agentHooks;
    if (previous) {
      for (const sessionId of this.sessions.keys()) {
        this.releaseAgentHookAuthority(sessionId, previous);
      }
    }
    this.agentHooks = contributor;
  }

  // ─── Snapshot pass-through (test + provider compatibility) ──────

  /**
   * Generate a snapshot for a single session — used by tests and by the
   * persist/sync flush internally. See SnapshotPersistence.
   */
  generateSnapshotMetadata(sessionId: string): { metadata: SessionSnapshotMetadata; buffer: string } | null {
    return this.snapshots.generateSnapshotMetadata(sessionId);
  }

  /** Schedule a debounced snapshot persist for a session. */
  schedulePersist(sessionId: string): void {
    this.snapshots.schedulePersist(sessionId);
  }

  /** Bypass the debounce and persist a single session immediately. */
  async flushSessionImmediate(sessionId: string): Promise<void> {
    await this.snapshots.flushSessionImmediate(sessionId);
  }

  /** Test/inspection helper — the latest in-memory snapshot index. */
  getSnapshotIndexEntries(): Record<string, SessionSnapshotMetadata> {
    return this.snapshots.getSnapshotIndexEntries();
  }

  /**
   * Step 1 of `extension.deactivate`: synchronously write every active
   * session's serialized buffer to its file under `<storageUri>/snapshots/`.
   */
  flushSnapshotsSync(): void {
    this.snapshots.flushSnapshotsSync(this.sessions.keys());
  }

  /**
   * Step 2 of `extension.deactivate`: persist the snapshot index AND the live
   * editor-panels record via the awaited Memento API.
   */
  async flushIndexAwaited(): Promise<void> {
    await this.snapshots.flushIndexAwaited();
    if (this._disposed || !this.snapshots.isRestoreEnabled() || !this.storage) {
      return;
    }
    try {
      await this.storage.writeLivePanelsAwaited(this.editorPanels.toRecord());
    } catch (err) {
      console.error("[AnyWhere Terminal] writeLivePanelsAwaited failed:", err);
    }
  }

  /** Hydrate the pending-restore map from the persisted index (post-restart). */
  hydrateFromSnapshots(index?: SessionSnapshotsIndex): void {
    this.snapshots.hydrateFromSnapshots(index);
  }

  /** Hydrate the live editor-panels registry from workspaceState (post-restart). */
  hydrateLivePanels(record?: LiveEditorPanelsRecord): void {
    if (!this.snapshots.isRestoreEnabled()) {
      return;
    }
    this.editorPanels.hydrate(record);
  }

  hasSnapshotsForLocation(loc: "sidebar" | "panel"): boolean {
    return this.snapshots.hasSnapshotsForLocation(loc);
  }

  consumeSnapshotsForLocation(loc: "sidebar" | "panel"): PendingSnapshot[] {
    return this.snapshots.consumeSnapshotsForLocation(loc);
  }

  consumeSnapshotsForPanel(panelId: string): PendingSnapshot[] {
    return this.snapshots.consumeSnapshotsForPanel(panelId);
  }

  /**
   * Test-only seam: stage a single PendingSnapshot for provider onReady tests.
   * Preserves the legacy `(sm as any)._pendingSnapshots.set(...)` reach-in pattern
   * post-refactor by providing a proper public entry point.
   */
  __stagePendingSnapshot(snap: PendingSnapshot): void {
    this.snapshots.__stagePendingSnapshot(snap);
  }

  // ─── Live editor-panel pass-through ─────────────────────────────

  /** Record a new editor panel in the live-panels registry. Idempotent. */
  registerEditorPanel(panelId: string): void {
    this.editorPanels.register(panelId);
  }

  /** Attach a session to an editor panel. Idempotent. Silent no-op for unknown panelIds. */
  attachSessionToPanel(panelId: string, sessionId: string): void {
    this.editorPanels.attachSession(panelId, sessionId);
  }

  /** Remove an editor panel from the live-panels registry (after a grace-period destroy fires). */
  unregisterEditorPanel(panelId: string): void {
    this.editorPanels.unregister(panelId);
  }

  /** Build a `LiveEditorPanelsRecord` for persistence. */
  getLiveEditorPanelsRecord(): LiveEditorPanelsRecord {
    return this.editorPanels.toRecord();
  }

  // ─── Public API: Core CRUD ──────────────────────────────────────

  /**
   * Create a new terminal session for a view.
   *
   * Spawns a PTY, creates an OutputBuffer, wires events, and registers
   * the session in all maps. The new session becomes the active tab
   * (unless it is a split pane session).
   *
   * @param options.isSplitPane If true, marks the session as a split pane.
   *   Split pane sessions are excluded from getTabsForView() and do NOT
   *   deactivate existing sessions.
   * @param options.shell Optional shell path override (from settings).
   * @param options.shellArgs Optional shell arguments override (from settings).
   * @param options.cwd Optional working directory override (from settings).
   * @param options.restoreFrom Restore from a hydrated snapshot (preserves
   *   sessionId + metadata). See D7/D13.
   * @returns The session ID (UUID)
   */
  createSession(
    viewId: string,
    webview: MessageSender,
    options?: {
      isSplitPane?: boolean;
      shell?: string;
      shellArgs?: string[];
      cwd?: string;
      /**
       * Per-session env overrides merged OVER the base (and shell-integration)
       * environment just before spawn. Used by the vault to carry a resumed
       * Claude's `CLAUDE_CONFIG_DIR` when it differs from the host. See D5.
       */
      env?: Record<string, string>;
      /**
       * Marks the root process as a vault agent CLI (not a shell). Arms
       * "respawn a shell in this tab when it exits" so the agent quitting leaves
       * a usable prompt instead of a dead terminal. On restore this is re-derived
       * from the persisted snapshot, not this option.
       */
      isAgentLaunch?: boolean;
      restoreFrom?: PendingSnapshot;
      /**
       * For split-pane children, the sessionId of the owning root tab. The
       * extension stores this on the session so cross-restart eviction can
       * group split snapshots atomically. Ignored when `isSplitPane !== true`.
       * See round-1 B4.
       */
      rootTabId?: string;
    },
  ): string {
    const restoreFrom = options?.restoreFrom;
    const restoringExited = restoreFrom?.metadata.shellExited === true;
    // Vault agent session? Drives the shell-fallback-on-exit arming below. On
    // restore the flag is re-derived from the persisted snapshot (the option is
    // absent there).
    const isAgentLaunch = options?.isAgentLaunch ?? restoreFrom?.metadata.isAgentLaunch ?? false;
    const isSplitPane = options?.isSplitPane ?? restoreFrom?.metadata.isSplitPane ?? false;
    // Preserve the persisted sessionId during restore so the webview's
    // split-layout (`vscode.setState`) keeps referencing the same tabs.
    const id = restoreFrom ? restoreFrom.metadata.sessionId : crypto.randomUUID();
    const number = restoreFrom ? this.reserveNumber(restoreFrom.metadata.terminalNumber) : this.findAvailableNumber();
    const name = `Terminal ${number}`;

    // Resolve shell/args/cwd. For restore: prefer the persisted values; for a
    // fresh session: caller-provided or auto-detected.
    const restoredShell = restoreFrom?.metadata.shell?.trim();
    const optShell = restoredShell || options?.shell;
    const optArgs = restoredShell ? restoreFrom?.metadata.shellArgs : options?.shellArgs;
    let resolvedShell: string;
    let resolvedArgs: string[];
    if (optShell) {
      resolvedShell = optShell;
      resolvedArgs = optArgs ?? [];
    } else {
      const detected = PtyManager.detectShell();
      resolvedShell = detected.shell;
      resolvedArgs = optArgs && optArgs.length > 0 ? optArgs : detected.args;
    }

    const cwd = restoreFrom?.metadata.cwd || options?.cwd || PtyManager.resolveWorkingDirectory();

    // Spawn PTY (skipped for exited shells — restored read-only per D13).
    const pty = new PtySession(id);
    if (!restoringExited) {
      const nodePty = PtyManager.loadNodePty();
      const baseEnv = PtyManager.buildEnvironment();
      // Try to inject shell integration. Returns null when the shell is
      // unrecognised (sh, dash, nu, custom) OR the user passed opt-out flags
      // (--noprofile --norc / -NoProfile); the spawn then proceeds with the
      // original args/env, and per-command export commands fall back to the
      // no-tracked-commands toast (design D6).
      let spawnArgs: readonly string[] = resolvedArgs;
      let spawnEnv: Record<string, string> = baseEnv;
      const injection = this.shellIntegration.injectAtSpawn(id, resolvedShell, resolvedArgs, baseEnv);
      if (injection) {
        spawnArgs = injection.args;
        spawnEnv = injection.env;
        pty.setShellIntegrationNonce(injection.nonce);
      }
      // Per-session overrides win over base + shell-integration env (D5).
      if (options?.env) {
        spawnEnv = { ...spawnEnv, ...options.env };
      }
      // Every live PTY incarnation gets fresh renewable agent-hook authority
      // (design D6) — merged last so it can never be shadowed by an override.
      spawnEnv = { ...spawnEnv, ...this.mintAgentHookEnv(id, spawnEnv) };
      try {
        pty.spawn(nodePty, resolvedShell, [...spawnArgs], { cwd, env: spawnEnv });
      } catch (err) {
        this.releaseAgentHookAuthority(id);
        throw err;
      }
      // Wire the unified shell-integration sink — receives every parsed event
      // from the passive OSC 7 / OSC 633 parser (cwd + A/B/C/D/E markers).
      // PtySession guarantees byte-identical forwarding to onData regardless.
      pty.setShellIntegrationSink(this.shellIntegration.makeSink(id));
    }

    const outputBuffer = new OutputBuffer(id, webview, pty, (tabId, at) => this.paneEvidence?.markOutput(tabId, at));

    // Hydrate custom name: restore wins (persisted metadata), then the
    // per-number custom-names record (root tabs only; see add-tab-rename D3).
    const restoredCustomName = restoreFrom?.metadata.customName ?? null;
    const hydratedCustomName = isSplitPane ? null : (restoredCustomName ?? this.customNames.getForNumber(number));

    const session: TerminalSession = {
      id,
      // Initial state: live for fresh / restored-running, exited-preserved for
      // restored-exited (D13 read-only). See design.md D14.
      state: restoringExited ? "exited-preserved" : "live",
      viewId,
      pty,
      name,
      customName: hydratedCustomName,
      // Restored exited sessions surface read-only — keep them inactive so the
      // active-tab indicator doesn't move to a dead shell.
      isActive: !isSplitPane && !restoringExited,
      number,
      outputBuffer,
      scrollbackCache: [],
      scrollbackSize: 0,
      createdAt: Date.now(),
      cols: restoreFrom?.metadata.cols ?? 80,
      rows: restoreFrom?.metadata.rows ?? 30,
      disposables: [],
      webview,
      isSplitPane,
      // For splits: caller-supplied rootTabId (live runtime) or persisted (restore).
      // For roots: own id — supports atomic group eviction across the tab unit.
      rootTabId: isSplitPane
        ? (options?.rootTabId ?? restoreFrom?.metadata.rootTabId ?? id)
        : (restoreFrom?.metadata.rootTabId ?? id),
      initialCwd: cwd,
      currentCwd: restoreFrom?.metadata.currentCwd ?? undefined,
      shell: resolvedShell,
      shellArgs: resolvedArgs,
      isAgentLaunch: isAgentLaunch || undefined,
      // Arm shell-fallback for a live agent root; a restored-exited session is
      // read-only so nothing to fall back from.
      shellFallbackArmed: isAgentLaunch && !restoringExited ? true : undefined,
      panelId: viewId.startsWith("editor-") ? viewId.slice("editor-".length) : undefined,
      shellExited: restoringExited || undefined,
      exitCode: restoringExited ? (restoreFrom?.metadata.exitCode ?? null) : undefined,
      // Hydrate from snapshot when restoring so "Export Last Command…" /
      // "Export Command…" survive window reload + IDE restart. Fresh
      // sessions and back-compat snapshots (no `trackedCommands` field)
      // get a clean tracker.
      commandTracking: new CommandTracker(restoreFrom?.metadata.trackedCommands),
    };

    // Deactivate other sessions in the same view (only for root tab sessions)
    if (!isSplitPane) {
      const viewSessionIds = this.viewSessions.get(viewId);
      if (viewSessionIds) {
        for (const sid of viewSessionIds) {
          const s = this.sessions.get(sid);
          if (s) {
            s.isActive = false;
          }
        }
      }
    }

    // Register in maps
    this.sessions.set(id, session);
    if (!this.viewSessions.has(viewId)) {
      this.viewSessions.set(viewId, []);
    }
    this.viewSessions.get(viewId)!.push(id);

    // For Phase B (restore-from-snapshot) we pause output flushing so the
    // fresh PTY's first prompt CAN'T race ahead of the webview's
    // `restoreFromSnapshot` replay. The provider's `onReady` calls
    // `resumeOutputForView(viewId)` AFTER posting every snapshot replay; the
    // fresh-shell prompt then flushes in correct FIFO order behind the
    // divider line. Spec: cross-restart-session-restore § "resize → write
    // buffer → write divider → DOM attach → begin PTY forwarding".
    // See round-1 B3.
    if (restoreFrom && !restoringExited) {
      outputBuffer.pauseOutput();
    }

    // Seed the headless mirror from the restore buffer (if applicable) so
    // subsequent serializes include the prior session's history.
    this.snapshots.attachSession(session, restoreFrom);

    // The pane now exists as far as presence is concerned. Seeded from
    // `restoringExited` rather than defaulted live: a read-only tab restored
    // from a snapshot has no running process, and claiming otherwise would be
    // the presence view's first lie about it.
    this.paneEvidence?.create(id, {
      exited: restoringExited,
      viewId,
      // The pane facts a presence projection needs, seeded here because this is
      // the only place that knows them at birth. The store outlives the session
      // map, so these must live beside the evidence rather than be read back
      // from `sessions` — which drops a naturally-exited pane while its tab is
      // still on screen (project-worktree-agent-presence design.md D2).
      cwd,
      ptyPid: pty.pid,
      shell: resolvedShell,
      isAgentLaunch,
    });

    // Wire PTY events (extracted so respawnFallbackShell can re-wire a fresh PTY).
    this.wirePty(session, pty, webview);

    return id;
  }

  /**
   * Wire a freshly-spawned PTY's data/exit handlers onto a session. Reads
   * `session.outputBuffer` live (not a captured local) so it stays correct after
   * `respawnFallbackShell` swaps the buffer. Used by createSession and the
   * shell-fallback respawn.
   */
  private wirePty(session: TerminalSession, pty: PtySession, webview: MessageSender): void {
    const id = session.id;
    pty.onData = (data: string) => {
      session.outputBuffer.append(data);
      this.appendToScrollback(session, data);
      this.snapshots.recordData(session, data);
      // NOTE: command-output capture is NOT done here. The OSC parser emits
      // ordered `text`/`commandStart`/`commandEnd` events; the tracker drives
      // `appendOutput` from the `text` event so a single PTY chunk shaped
      // `[output][OSC_D]` cannot close the in-flight before its output is
      // captured. See: .reviews/round-2.md [B1].
    };

    pty.onExit = (code: number) => {
      // Shell-fallback: a vault agent that owns the terminal (the PTY root) just
      // exited on its own (Ctrl+C / done). Replace it with a fresh shell in the
      // SAME tab so the user keeps an input prompt, instead of a dead terminal.
      // Checked BEFORE recordExit so the session isn't frozen as "exited". Skip
      // when the user is closing the tab (terminalBeingKilled). One-shot: the
      // fallback shell then behaves like a normal terminal.
      if (session.shellFallbackArmed && !this.terminalBeingKilled.has(id)) {
        session.shellFallbackArmed = false;
        try {
          this.respawnFallbackShell(session, webview);
          return;
        } catch (err) {
          console.error(`[AnyWhere Terminal] shell-fallback respawn failed for ${id}:`, err);
          // Fall through to the normal exit path so the tab doesn't hang.
        }
      }

      // Record exit state BEFORE cleanup so an immediate persist (queued by
      // the persistence pipeline) captures the exit metadata. See D13.
      this.snapshots.recordExit(session, typeof code === "number" ? code : null);
      this.onShellExited?.(id);

      // If this is an intentional kill, skip cleanup (destroySession handles it
      // via performDestroy → cleanupSession, and the state is already
      // "destroying" from the synchronous transitionState in destroySession).
      if (this.terminalBeingKilled.has(id)) {
        return;
      }

      // Natural exit (user typed `exit`, ^D, crash). Transition live →
      // exited-preserved BEFORE cleanupSession so its dispatch picks
      // releaseMirror (D13 preserve). See design.md D14.
      this.transitionState(id, "live", "exited-preserved");
      // Before cleanupSession, which drops this session from `this.sessions`
      // while the tab stays on screen. The pane outlives its process, and its
      // evidence has to outlive it too — the tab shows "[Process exited]" until
      // the user closes it, and the worktree row must say the same thing.
      this.paneEvidence?.markExited(id, true);
      this.cleanupSession(id);
      this.safePostMessage(webview, { type: "exit", tabId: id, code });
    };
  }

  /**
   * The agent that owned this tab exited — spawn the user's default shell in the
   * same session so the tab stays usable. Swaps in a fresh PTY + OutputBuffer and
   * re-wires events.
   *
   * The session's persisted identity (`shell`/`shellArgs`/`isAgentLaunch`) is
   * flipped to the fallback shell so a later window reload restores THIS shell
   * (scrollback history above), NOT the agent the user already quit. Auto-resume
   * therefore only applies while the agent is still live: reload-with-agent-running
   * re-resumes it; reload-after-exit restores the shell. See respawn UX bug.
   */
  private respawnFallbackShell(session: TerminalSession, webview: MessageSender): void {
    const id = session.id;
    const detected = PtyManager.detectShell();
    const shell = detected.shell;
    const args = detected.args;
    const cwd = session.currentCwd || session.initialCwd || PtyManager.resolveWorkingDirectory();

    const nodePty = PtyManager.loadNodePty();
    // Base env only: the fallback is a plain shell, so the vault's per-session
    // env (CLAUDE_CONFIG_DIR / auth allowlist) must not leak into it.
    const baseEnv = PtyManager.buildEnvironment();
    // Reclaim the exited agent's shell-integration cleanup before re-registering
    // the same id; injectAtSpawn would otherwise drop its cleanup callback unrun.
    this.shellIntegration.cleanupSession(id);
    // Fallback replacement invalidates the old hook token BEFORE a fresh one
    // is issued for the replacement PTY (design D6 / hook-session-isolation).
    this.releaseAgentHookAuthority(id);
    const pty = new PtySession(id);
    let spawnArgs: readonly string[] = args;
    let spawnEnv: Record<string, string> = baseEnv;
    const injection = this.shellIntegration.injectAtSpawn(id, shell, args, baseEnv);
    if (injection) {
      spawnArgs = injection.args;
      spawnEnv = injection.env;
      pty.setShellIntegrationNonce(injection.nonce);
    }
    spawnEnv = { ...spawnEnv, ...this.mintAgentHookEnv(id, spawnEnv) };
    // Do all fallible spawn work BEFORE mutating `session`, so a throw leaves the
    // old PTY/buffer intact for the caller's fall-through exit path. Tear down the
    // half-spawned shell on failure so it isn't orphaned.
    try {
      pty.spawn(nodePty, shell, [...spawnArgs], { cwd, env: spawnEnv });
      pty.setShellIntegrationSink(this.shellIntegration.makeSink(id));
      pty.resize(session.cols, session.rows);
    } catch (err) {
      this.releaseAgentHookAuthority(id);
      pty.dispose();
      throw err;
    }

    // Atomic swap: the dead agent PTY + its buffer for the fresh shell, keeping
    // the tab. If a restore replay hasn't resumed output yet, inherit the paused
    // state (dropping the old paused chunks) so shell output can't beat the
    // snapshot replay.
    const wasOutputPaused = session.outputBuffer.isOutputPaused;
    session.outputBuffer.dispose(wasOutputPaused ? { flush: false } : undefined);
    session.pty = pty;
    const nextBuffer = new OutputBuffer(id, webview, pty, (tabId, at) => this.paneEvidence?.markOutput(tabId, at));
    if (wasOutputPaused) {
      nextBuffer.pauseOutput();
    }
    session.outputBuffer = nextBuffer;
    // A live process is back in this pane. Cleared here, at the swap, rather
    // than in `wirePty`: that runs for a restored read-only tab too, where
    // clearing it would resurrect a pane whose process is genuinely gone.
    this.paneEvidence?.markExited(id, false);
    // Flip the persisted identity (+ cwd) so a reload restores THIS shell, not
    // the agent the user already quit.
    session.shell = shell;
    session.shellArgs = args;
    session.initialCwd = cwd;
    session.isAgentLaunch = undefined;
    // Identity rank 1 reads these, so a shell that reclaimed the pane must stop
    // it claiming the agent that used to be here (D4).
    this.paneEvidence?.markProcess(id, { ptyPid: pty.pid, shell, isAgentLaunch: false });
    this.paneEvidence?.markCwd(id, cwd);
    this.wirePty(session, pty, webview);
    // Persist the flip now so a crash/quit before the next debounced flush can't
    // resurrect the agent identity (clean reload is covered by the deactivate
    // flush). See review W1.
    void this.snapshots.flushSessionImmediate(id).catch((err) => {
      console.error(`[AnyWhere Terminal] persist fallback-shell identity failed for ${id}:`, err);
    });
  }

  /** Write input data to a session's PTY. Silent no-op for unknown session IDs. */
  writeToSession(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    session.pty.write(data);
  }

  /** Resize a session's PTY and update stored dimensions. Silent no-op for unknown session IDs. */
  resizeSession(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    session.pty.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
    this.snapshots.recordResize(session, cols, rows);
  }

  /** Switch active session within a view. Silent no-op for unknown viewId or sessionId. */
  switchActiveSession(viewId: string, sessionId: string): void {
    const viewSessionIds = this.viewSessions.get(viewId);
    if (!viewSessionIds) {
      return;
    }
    if (!viewSessionIds.includes(sessionId)) {
      return;
    }
    for (const sid of viewSessionIds) {
      const s = this.sessions.get(sid);
      if (s) {
        s.isActive = sid === sessionId;
      }
    }
  }

  /**
   * Get tab info for a view (root tabs only — split panes are filtered).
   * Returns empty array for unknown viewIds. Emits `isSplitPane: false`
   * explicitly to match the InitMessage wire contract (see W10).
   */
  getTabsForView(
    viewId: string,
  ): Array<{ id: string; name: string; customName: string | null; isActive: boolean; isSplitPane: false }> {
    const viewSessionIds = this.viewSessions.get(viewId);
    if (!viewSessionIds) {
      return [];
    }

    type TabInfo = {
      id: string;
      name: string;
      customName: string | null;
      isActive: boolean;
      isSplitPane: false;
    };
    return viewSessionIds
      .map((sid): TabInfo | undefined => {
        const s = this.sessions.get(sid);
        if (!s || s.isSplitPane) {
          return undefined;
        }
        return { id: s.id, name: s.name, customName: s.customName, isActive: s.isActive, isSplitPane: false };
      })
      .filter((tab): tab is TabInfo => tab !== undefined);
  }

  /**
   * Like {@link getTabsForView} but also includes split-pane children with an
   * `isSplitPane` flag so the webview can recreate every xterm referenced by
   * `WebviewStateStore.tabLayouts` on reload / cross-restart. See
   * restore-terminal-sessions design.md D12.
   */
  getAllSessionsForView(
    viewId: string,
  ): Array<{ id: string; name: string; customName: string | null; isActive: boolean; isSplitPane: boolean }> {
    const viewSessionIds = this.viewSessions.get(viewId);
    if (!viewSessionIds) {
      return [];
    }

    type SessionInfo = {
      id: string;
      name: string;
      customName: string | null;
      isActive: boolean;
      isSplitPane: boolean;
    };
    return viewSessionIds
      .map((sid): SessionInfo | undefined => {
        const s = this.sessions.get(sid);
        if (!s) {
          return undefined;
        }
        return {
          id: s.id,
          name: s.name,
          customName: s.customName,
          isActive: s.isActive,
          isSplitPane: s.isSplitPane,
        };
      })
      .filter((info): info is SessionInfo => info !== undefined);
  }

  /** Get a session by ID. Returns undefined if not found. */
  getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Return the resolved cwd recorded at PTY spawn time, or undefined when the session is unknown. */
  getInitialCwd(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.initialCwd;
  }

  /** Record the latest cwd parsed from PTY output. Silent no-op for unknown ids. */
  setCurrentCwd(sessionId: string, cwd: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    session.currentCwd = cwd;
    // The store's copy has exactly one writer — this class — at the same sites
    // that set the session's own fields, so the two cannot diverge (D2).
    this.paneEvidence?.markCwd(sessionId, cwd);
    this.snapshots.schedulePersist(sessionId);
  }

  /** Return the latest cwd parsed from PTY output, or undefined when never set. */
  getCurrentCwd(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.currentCwd;
  }

  /**
   * Asynchronously query the PTY child process's current cwd via the OS
   * process table (`/proc/<pid>/cwd` on Linux, `lsof` on macOS). Returns
   * undefined when the session is unknown, the PTY has no pid, the OS query
   * fails, or the platform is unsupported (Windows).
   *
   * Lazy: only invoke when a clicked file path actually needs resolution.
   * Bounded latency: macOS lsof is capped at 500ms by queryProcessCwd.
   */
  async getLiveCwd(sessionId: string): Promise<string | undefined> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }
    const pid = session.pty.pid;
    if (pid === undefined) {
      return undefined;
    }
    return queryProcessCwd(pid);
  }

  /**
   * Rename a tab session by setting its `customName`. Single public entry point
   * for the rename feature; all UX triggers converge here (see add-tab-rename
   * design.md D2).
   *
   * - Silent no-op on unknown sessionId.
   * - Silent no-op when the target is a split pane (split panes consume terminal
   *   numbers but aren't tab identities, so the persisted record stays scoped
   *   to root tabs only — see design.md D3).
   * - `input` is normalized via CustomNameRegistry.
   * - On success: updates `session.customName`, broadcasts `tabRenamed` to the
   *   owning webview, and persists fire-and-forget (see design.md D9).
   */
  renameSession(sessionId: string, input: string | null): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.isSplitPane) {
      return;
    }

    const normalized = this.customNames.normalize(input);
    session.customName = normalized;

    this.safePostMessage(session.webview, {
      type: "tabRenamed",
      tabId: sessionId,
      customName: normalized,
    });

    this.customNames.setForNumber(session.number, normalized);
    this.snapshots.schedulePersist(sessionId);
  }

  /**
   * Clear scrollback cache for a session. Silent no-op for unknown session IDs.
   *
   * Also resets the headless mirror (`\x1bc` RIS), wipes the tracked-commands
   * list, and schedules an immediate persist so the cleared state is a true
   * privacy boundary — a restart after clear MUST NOT resurrect the cleared
   * content via either the visible buffer OR the Export Command quickpick.
   * See round-1 B2 (initial clear semantics) + external-review B2 (extending
   * the boundary to commandTracking).
   */
  clearScrollback(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    session.scrollbackCache = [];
    session.scrollbackSize = 0;
    session.commandTracking.clear();
    this.snapshots.commitClearSnapshot(sessionId);
  }

  /** Handle ack message for a session's output buffer. Silent no-op for unknown session IDs. */
  handleAck(sessionId: string, charCount: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    session.outputBuffer.handleAck(charCount);
  }

  /**
   * Update the webview reference for all sessions belonging to a view.
   * Used when a webview is re-created but sessions survive.
   */
  updateWebviewForView(viewId: string, webview: MessageSender): void {
    const viewSessionIds = this.viewSessions.get(viewId);
    if (!viewSessionIds) {
      return;
    }

    for (const sid of viewSessionIds) {
      const session = this.sessions.get(sid);
      if (session) {
        session.webview = webview;
        session.outputBuffer.updateWebview(webview);
      }
    }
  }

  /** Get the joined scrollback cache data for a session. Returns "" if unknown. */
  getScrollbackData(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return "";
    }
    return session.scrollbackCache.join("");
  }

  // ─── Shell-integration read API ─────────────────────────────────────
  //
  // OSC 633 routing + cleanup map live on the ShellIntegrationCoordinator.
  // SessionManager exposes only the per-session read API for the export
  // commands. See: .reviews/round-1.md [W1].

  /**
   * Return the tracked commands for a session in oldest-first order. Empty
   * when shell integration is inactive OR the session does not exist.
   */
  getTrackedCommands(sessionId: string): readonly TrackedCommand[] {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return [];
    }
    return session.commandTracking.commands;
  }

  /**
   * Return the most-recently-closed tracked command for a session, or null.
   * Skips any in-flight command — only fully-closed commands are returned.
   */
  getLastCompletedCommand(sessionId: string): TrackedCommand | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    return session.commandTracking.lastCompleted;
  }

  // ─── Scrollback dump IPC (delegated) ───────────────────────────────
  //
  // See: asimov/changes/export-terminal-session/specs/webview-scrollback-dump/spec.md
  // See: asimov/changes/export-terminal-session/design.md D4
  // See: .reviews/round-1.md [W1] — request/reply/abort/timeout state lives
  // on ScrollbackDumpCoordinator now.

  /**
   * Ask the webview to serialise the full xterm.js scrollback for the given
   * session and resolve with the payload. Throws `ScrollbackDumpAbortedError`
   * synchronously if the session is unknown (no webview to ask).
   */
  async requestScrollbackDump(sessionId: string): Promise<ScrollbackDumpPayload> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      const { ScrollbackDumpAbortedError } = await import("../types/errors");
      throw new ScrollbackDumpAbortedError(sessionId, "<no-request-yet>");
    }
    return this.scrollbackDumps.request(sessionId, session.webview);
  }

  /**
   * Resolve a pending dump request with the webview's reply. `senderSessionId`
   * is the `tabId` echoed by the webview in the reply — used to authenticate
   * the reply against the original request target. See: .reviews/round-2.md [S3].
   */
  handleScrollbackDump(requestId: string, senderSessionId: string, payload: ScrollbackDumpPayload): void {
    this.scrollbackDumps.handleReply(requestId, senderSessionId, payload);
  }

  /** Get aggregate memory usage metrics across all sessions. */
  getMemoryMetrics(): MemoryMetrics {
    let totalBufferSize = 0;
    let totalScrollbackSize = 0;
    const sessions: MemoryMetrics["sessions"] = [];

    for (const session of this.sessions.values()) {
      const bufferSize = session.outputBuffer.bufferSize;
      const { scrollbackSize } = session;
      const unackedCharCount = session.outputBuffer.unackedCharCount;

      totalBufferSize += bufferSize;
      totalScrollbackSize += scrollbackSize;

      sessions.push({
        id: session.id,
        name: session.name,
        bufferSize,
        scrollbackSize,
        unackedCharCount,
      });
    }

    return {
      sessionCount: this.sessions.size,
      totalBufferSize,
      totalScrollbackSize,
      sessions,
    };
  }

  /** Pause output flushing for all sessions in a view. */
  pauseOutputForView(viewId: string): void {
    const viewSessionIds = this.viewSessions.get(viewId);
    if (!viewSessionIds) {
      return;
    }
    for (const sid of viewSessionIds) {
      const s = this.sessions.get(sid);
      if (s) {
        s.outputBuffer.pauseOutput();
      }
    }
  }

  /** Resume output flushing for all sessions in a view (any buffered data flushes immediately). */
  resumeOutputForView(viewId: string): void {
    const viewSessionIds = this.viewSessions.get(viewId);
    if (!viewSessionIds) {
      return;
    }
    for (const sid of viewSessionIds) {
      const s = this.sessions.get(sid);
      if (s) {
        s.outputBuffer.resumeOutput();
      }
    }
  }

  // ─── Public API: Destructive Operations (Queued) ────────────────

  /**
   * Transition a session's lifecycle state. Asserts the current state is one
   * of the expected `from` values; logs an error + returns false on mismatch
   * (caller continues with stale state — we never throw during shutdown).
   * See design.md D14. Replaces the implicit `sessionsPendingDestroy` set
   * from .reviews/round-4.md [B1].
   */
  private transitionState(sessionId: string, from: SessionState | readonly SessionState[], to: SessionState): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    const allowed = Array.isArray(from) ? from : [from as SessionState];
    if (!allowed.includes(session.state)) {
      console.error(
        `[AnyWhere Terminal] Invalid state transition for session ${sessionId}: ${session.state} → ${to} (expected from: ${allowed.join("|")})`,
      );
      return false;
    }
    session.state = to;
    return true;
  }

  /** Destroy a session (queued, serialized via operation queue). */
  destroySession(sessionId: string): void {
    // The pane is going away, so its evidence goes with it. Here rather than in
    // `cleanupSession`, which also runs on a natural exit that leaves the tab
    // open — and unconditionally, because a naturally-exited pane has already
    // left `this.sessions` and would otherwise leak its evidence for the life
    // of the window. See: add-host-pane-evidence design.md D2.
    this.paneEvidence?.delete(sessionId);

    // Record destructive intent SYNCHRONOUSLY before enqueueing — the queue
    // microtask hasn't run yet. dispose() and cleanupSession() branch on
    // session.state to choose detachSession (drop snapshot — user wanted it
    // gone) vs releaseMirror (D13 preserve). See design.md D14.
    // Accept both "live" (running session) and "exited-preserved" (user closes
    // an already-exited restored tab).
    this.transitionState(sessionId, ["live", "exited-preserved"], "destroying");
    this.operationQueue = this.operationQueue
      .then(async () => {
        await this.performDestroy(sessionId);
      })
      .catch((err) => {
        console.error("[AnyWhere Terminal] Destroy operation failed:", err);
      });
  }

  /**
   * Schedule a delayed destroy for every session belonging to a view. Used by
   * `TerminalEditorProvider.onDidDispose` to ride out a window-reload's
   * webview swap. The serializer's `deserializeWebviewPanel` calls
   * `cancelScheduledDestroy(viewId)` BEFORE constructing the new provider.
   * See design.md D3.
   */
  scheduleDestroyForView(viewId: string, delayMs: number = this.defaultGracePeriodMs, onFire?: () => void): void {
    const existing = this.pendingDestroys.get(viewId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.pendingDestroys.delete(viewId);
      this.destroyAllForView(viewId);
      if (onFire) {
        try {
          onFire();
        } catch (err) {
          console.error("[AnyWhere Terminal] scheduleDestroyForView onFire callback failed:", err);
        }
      }
    }, delayMs);
    this.pendingDestroys.set(viewId, timer);
  }

  /** Cancel a previously scheduled destroy. Silent no-op when nothing is pending. */
  cancelScheduledDestroy(viewId: string): void {
    const existing = this.pendingDestroys.get(viewId);
    if (!existing) {
      return;
    }
    clearTimeout(existing);
    this.pendingDestroys.delete(viewId);
  }

  /** Test/inspection helper — current pending-destroy view ids. */
  getPendingDestroyViewIds(): string[] {
    return Array.from(this.pendingDestroys.keys());
  }

  /** Destroy all sessions for a specific view (queued, serialized). */
  destroyAllForView(viewId: string): void {
    // The whole view is closing, so every pane it held is closing with it.
    // Synchronous, like the intent record below, and routed through the store's
    // own pane-to-view index rather than `viewSessions`: a pane whose process
    // exited naturally has already left that map while its tab stayed open, so
    // no walk of it could reach the evidence. See .reviews/round-1.md B1.
    this.paneEvidence?.deleteForView(viewId);

    // Capture the doomed session ids + record destructive intent SYNC.
    // Re-reading viewSessions inside the queued drain would sweep up
    // sessions created between sync-enqueue and async-execute — see
    // .reviews/round-5.md [W3]. The state transition gates against
    // sweeping a session a NEW destroyAllForView already moved into
    // "destroying" too.
    const viewSessionIds = this.viewSessions.get(viewId);
    const doomedIds: string[] = [];
    if (viewSessionIds) {
      for (const sid of viewSessionIds) {
        this.transitionState(sid, ["live", "exited-preserved"], "destroying");
        doomedIds.push(sid);
      }
    }
    this.operationQueue = this.operationQueue
      .then(async () => {
        // performDestroy is per-session and never throws (every internal op
        // is wrapped in try/catch). Sessions are independent — kill in
        // parallel rather than serial so a 20-tab view tears down in one
        // setTimeout(0) instead of N. Use the captured doomedIds list (not
        // the live viewSessions map) so sessions created between sync-
        // enqueue and async-execute are NOT swept (R5.W3).
        await Promise.all(doomedIds.map((sid) => this.performDestroy(sid)));
      })
      .catch((err) => {
        console.error("[AnyWhere Terminal] DestroyAllForView operation failed:", err);
      });
  }

  /**
   * Dispose the SessionManager. Kills every PTY synchronously and clears all
   * state. Called explicitly from `extension.deactivate` (NOT registered in
   * context.subscriptions — ordering matters; see design.md D6).
   *
   * Spec: "Synchronous cleanup of pending destroys — SessionManager.dispose()
   * SHALL synchronously iterate pendingDestroys, clear each timer, and invoke
   * destroyAllForView(viewId) for every queued view ID before resolving."
   * Implementation: we don't queue via `operationQueue` here (that's async); we
   * walk every session inline and dispose its resources directly. PendingDestroy
   * timers are cleared up front. See round-1 W3.
   */
  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;

    // Tear down the snapshot debounce/timer; per-session mirror disposal
    // happens below in the session iteration via snapshots.detachSession.
    this.snapshots.dispose();

    // Clear every pending grace-period timer up front so its async callback
    // doesn't race with our synchronous cleanup below.
    for (const [, timer] of this.pendingDestroys) {
      try {
        clearTimeout(timer);
      } catch {
        /* best-effort */
      }
    }
    this.pendingDestroys.clear();

    // Synchronously dispose every session — bypasses the async operation queue
    // entirely so no PTY leaks past extension shutdown.
    const allIds = [...this.sessions.keys()];
    for (const id of allIds) {
      const session = this.sessions.get(id);
      if (!session) {
        continue;
      }
      try {
        session.outputBuffer.dispose();
      } catch {
        /* best-effort */
      }
      try {
        session.pty.kill();
      } catch {
        /* best-effort */
      }
      this.releaseAgentHookAuthority(id);
      for (const d of session.disposables) {
        try {
          d.dispose();
        } catch {
          /* best-effort */
        }
      }
      // Branch on lifecycle state — design.md D14+D15. "destroying" means
      // the user explicitly destroyed (or queued a destroy still mid-flight
      // at deactivate-time); we MUST drop the snapshot. "exited-preserved"
      // and "live" both preserve the on-disk state so the next activate
      // restores the user's terminals (D13 read-only for exited, full
      // replay for live) — runtime mirror is released, disk untouched.
      if (session.state === "destroying") {
        this.snapshots.dropSession(id);
      } else {
        this.snapshots.releaseRuntimeOnly(id);
      }
    }

    // Reject every still-pending scrollback dump (the webviews are gone).
    this.scrollbackDumps.abortAll();

    // Run any remaining shell-integration cleanups (sessions that disposed
    // without going through cleanupSession — rare but possible during dispose).
    this.shellIntegration.cleanupAll();

    // `dispose` empties `this.sessions` directly and never routes through
    // `cleanupSession`, so nothing else here would drop the evidence.
    this.paneEvidence?.clear();

    this.sessions.clear();
    this.viewSessions.clear();
    this.usedNumbers.clear();
    this.terminalBeingKilled.clear();
  }

  // ─── Private: Destroy Implementation ────────────────────────────

  /** Perform the actual destruction of a session. Called from the operation queue — serial. */
  private async performDestroy(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // Mark as being killed to prevent re-entrant cleanup from onExit
    this.terminalBeingKilled.add(sessionId);

    // Flush and dispose the output buffer
    try {
      session.outputBuffer.dispose();
    } catch {
      /* best-effort */
    }

    // Kill the PTY (graceful shutdown)
    try {
      session.pty.kill();
    } catch {
      /* best-effort */
    }

    // Wait a tick for onExit to fire (it will be skipped due to terminalBeingKilled)
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // Clean up maps
    this.cleanupSession(sessionId);

    // Remove from kill tracking
    this.terminalBeingKilled.delete(sessionId);
  }

  // ─── Private: Cleanup ───────────────────────────────────────────

  /** Remove a session from all maps and free its resources. */
  private cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // Dispose per-session resources
    for (const d of session.disposables) {
      try {
        d.dispose();
      } catch {
        /* best-effort */
      }
    }

    // Release agent-hook authority for this session — natural exit and
    // destroy both funnel through here (design D6; hook-session-isolation).
    this.releaseAgentHookAuthority(sessionId);

    // Reject any in-flight scrollback dumps for this session — the webview
    // is about to disappear and the response will never arrive (D4).
    this.scrollbackDumps.abortForSession(sessionId);

    // Run the shell-integration cleanup (per-session temp ZDOTDIR / bash
    // init-file). Coordinator owns idempotence + try/catch.
    this.shellIntegration.cleanupSession(sessionId);

    // Branch on lifecycle state — design.md D14+D15. "destroying" means the
    // user explicitly destroyed; we dispatch dropSession. "exited-preserved"
    // means a natural shell exit (`exit`, ^D, crash); the sync exit commit
    // already persisted the snapshot via onShellExited → commitExitSnapshot,
    // so releaseRuntimeOnly disposes only the runtime mirror — the persisted
    // snapshot survives for D13 read-only restore. "live" here would be a
    // contract violation (cleanupSession runs only from performDestroy or
    // post-exit transition); fall through to releaseRuntimeOnly + log.
    if (session.state === "destroying") {
      this.snapshots.dropSession(sessionId);
    } else if (session.state === "exited-preserved") {
      this.snapshots.releaseRuntimeOnly(sessionId);
    } else {
      console.error(
        `[AnyWhere Terminal] cleanupSession called for ${sessionId} in unexpected state '${session.state}' — defaulting to releaseRuntimeOnly`,
      );
      this.snapshots.releaseRuntimeOnly(sessionId);
    }
    // Tombstone the state before deleting from the map. Useful for debugging
    // and for any in-flight callback that still holds a reference.
    session.state = "disposed";

    // Remove from maps
    this.sessions.delete(sessionId);
    this.usedNumbers.delete(session.number);

    const viewSessionIds = this.viewSessions.get(session.viewId);
    if (viewSessionIds) {
      const idx = viewSessionIds.indexOf(sessionId);
      if (idx !== -1) {
        viewSessionIds.splice(idx, 1);
      }
      if (viewSessionIds.length === 0) {
        this.viewSessions.delete(session.viewId);
      }
    }
  }

  // ─── Private: Number Recycling ──────────────────────────────────

  /** Find the lowest available terminal number starting from 1 (gap-filling). */
  private findAvailableNumber(): number {
    for (let i = 1; ; i++) {
      if (!this.usedNumbers.has(i)) {
        this.usedNumbers.add(i);
        return i;
      }
    }
  }

  /**
   * Reserve a specific terminal number for restore. If the preferred number is
   * already in use, fall back to `findAvailableNumber()` — restoring two
   * workspaces with overlapping numbers should never crash.
   *
   * Note: `preferred <= 0` is intentionally treated as "no preference" so the
   * hydrate-fallback path (which synthesizes `terminalNumber: 0` for orphan
   * buffer files) routes through `findAvailableNumber()`.
   */
  private reserveNumber(preferred: number): number {
    if (preferred > 0 && !this.usedNumbers.has(preferred)) {
      this.usedNumbers.add(preferred);
      return preferred;
    }
    return this.findAvailableNumber();
  }

  // ─── Private: Scrollback Cache ──────────────────────────────────

  /** Append data to a session's scrollback cache with FIFO eviction. */
  private appendToScrollback(session: TerminalSession, data: string): void {
    session.scrollbackCache.push(data);
    session.scrollbackSize += data.length;

    // Evict oldest chunks until under limit
    while (session.scrollbackSize > SCROLLBACK_MAX_SIZE && session.scrollbackCache.length > 0) {
      const evicted = session.scrollbackCache.shift()!;
      session.scrollbackSize -= evicted.length;
    }
  }

  // ─── Private: Safe Message Posting ──────────────────────────────

  /**
   * Hook coordinates are optional observability, so minting them must never
   * decide whether a pane opens: a throwing contributor releases whatever it
   * half-minted and the shell spawns with no hook environment at all.
   */
  private mintAgentHookEnv(sessionId: string, spawnEnv: Readonly<Record<string, string>>): Record<string, string> {
    if (!this.agentHooks) {
      return {};
    }
    try {
      return this.agentHooks.create(sessionId, spawnEnv);
    } catch {
      this.releaseAgentHookAuthority(sessionId);
      return {};
    }
  }

  /** Release hook authority and immediately revoke its webview identity. */
  private releaseAgentHookAuthority(sessionId: string, contributor = this.agentHooks): void {
    try {
      contributor?.release(sessionId);
    } catch {
      /* best-effort */
    }
    // The host's own copy of the semantic state is cleared on the same event
    // that revokes the webview's, so the two cannot disagree about whether an
    // agent is still reporting itself as working.
    this.paneEvidence?.setSemantic(sessionId, null);
    const session = this.sessions.get(sessionId);
    if (session) {
      this.safePostMessage(session.webview, {
        type: "agentActivityStatus",
        tabId: sessionId,
        agent: null,
        state: null,
      });
    }
  }

  /** Safely post a message to a webview, handling both sync throws and async rejections. */
  private safePostMessage(webview: MessageSender, message: unknown): void {
    try {
      void (webview.postMessage(message) as Thenable<boolean>).then(undefined, () => {
        // Async rejection — webview may be disposed
      });
    } catch {
      // Sync throw — webview may be disposed
    }
  }
}
