// src/session/SnapshotPersistence.ts — Cross-restart snapshot pipeline.
//
// Owns everything related to restore: per-session xterm-headless mirror,
// SerializeAddon caching, snapshot metadata generation, debounced flush,
// sync deactivate flush, hydrate-on-activate (with index-lost fallback +
// orphan cleanup), and the pending-restore staging map drained by the
// providers' onReady branches.
//
// Extracted from SessionManager.ts so the core session lifecycle and the
// restore pipeline can be reasoned about independently. SessionManager owns
// the canonical session registry and wires `pty.onData`/`onExit`/`resize`
// into this collaborator via `recordData`/`recordExit`/`recordResize`.
//
// See: restore-terminal-sessions design.md D1, D4-D7, D11, D13.

import type { PendingSnapshot, SessionSnapshotMetadata, SessionSnapshotsIndex, ViewLocation } from "./SessionSnapshot";
import type { SessionStorage } from "./SessionStorage";
import { evictIndex } from "./sessionSnapshotEviction";
import type { HeadlessFactory, SerializeAddonFactory, TerminalSession } from "./TerminalSession";

/** Snapshot serialize options — match VS Code core's XtermSerializer (`ptyService.ts:1086-1089`). */
const SERIALIZE_OPTIONS = { scrollback: 1000, excludeAltBuffer: true, excludeModes: true } as const;

/** Hard cap for the serialized buffer attached to a single snapshot. See design.md D5. */
const SNAPSHOT_BUFFER_MAX_BYTES = 1_048_576;

/** Debounce for coalescing high-frequency pty.onData events into one snapshot write. See design.md D6. */
const SNAPSHOT_PERSIST_DEBOUNCE_MS = 1000;

/**
 * Default factory: dynamically loads `@xterm/headless` and constructs a
 * Terminal sized to the PTY. Lazy require avoids the cold-start cost when
 * `sessionRestore.enabled === false`.
 */
export const defaultHeadlessFactory: HeadlessFactory = (cols, rows) => {
  const { Terminal } = require("@xterm/headless") as typeof import("@xterm/headless");
  return new Terminal({
    cols,
    rows,
    scrollback: 1000,
    allowProposedApi: true,
  }) as unknown as import("./TerminalSession").HeadlessTerminalLike;
};

export const defaultSerializeAddonFactory: SerializeAddonFactory = () => {
  const { SerializeAddon } = require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize");
  return new SerializeAddon() as unknown as import("./TerminalSession").SerializeAddonLike;
};

/**
 * Trim leading bytes off a serialized buffer when it exceeds the byte cap.
 * Cuts at the nearest LF AFTER the byte slice so the new head starts at a
 * line boundary. The xterm parser is resilient to incomplete escape sequences
 * at the start of a write call.
 */
export function truncateSnapshotBuffer(buffer: string, maxBytes: number = SNAPSHOT_BUFFER_MAX_BYTES): string {
  const totalBytes = Buffer.byteLength(buffer, "utf8");
  if (totalBytes <= maxBytes) {
    return buffer;
  }
  const buf = Buffer.from(buffer, "utf8");
  const tail = buf.subarray(buf.length - maxBytes);
  const lf = tail.indexOf(0x0a);
  const headSafe = lf >= 0 ? tail.subarray(lf + 1) : tail;
  return headSafe.toString("utf8");
}

/** Map a viewId back to the `viewLocation` kept in the persisted index. */
export function viewLocationOf(viewId: string): ViewLocation {
  if (viewId.startsWith("editor-")) {
    return "editor";
  }
  if (viewId === "anywhereTerminal.panel") {
    return "panel";
  }
  return "sidebar";
}

export interface SnapshotPersistenceOptions {
  restoreEnabled: boolean;
  storage: SessionStorage | null;
  headlessFactory: HeadlessFactory;
  serializeAddonFactory: SerializeAddonFactory;
  /** Lookup callback for SessionManager's session registry. */
  getSession: (id: string) => TerminalSession | undefined;
  /**
   * Optional editor-panel registry — used during hydrate orphan fallback (W2)
   * to map a torn-flush orphan buffer back to its owning editor panel rather
   * than defaulting to sidebar.
   */
  editorPanels?: {
    findPanelForSession(sessionId: string): string | undefined;
  };
}

export class SnapshotPersistence {
  private readonly headlessFactory: HeadlessFactory;
  private readonly serializeAddonFactory: SerializeAddonFactory;
  private readonly getSession: (id: string) => TerminalSession | undefined;
  private readonly editorPanels?: { findPanelForSession(sessionId: string): string | undefined };
  private storage: SessionStorage | null;
  private restoreEnabled: boolean;

  /** Debounce timer for coalesced snapshot persistence. Null when idle. */
  private _persistTimer: NodeJS.Timeout | null = null;

  /** Sessions with buffer changes since the last flush. Drained per tick. */
  private _pendingSessions = new Set<string>();

  /**
   * Per-session promise chain of in-flight headless writes. xterm.js
   * `write(data, cb)` is asynchronous — the buffer is not guaranteed to be
   * up-to-date until `cb` fires. Async flushes MUST await this barrier before
   * `serialize()` so the snapshot reflects the full byte stream.
   * Sync flush (deactivate) is best-effort — captures whatever is currently
   * parsed; this is the accepted ≤8ms loss window. See `.reviews/round-1.md` B1.
   */
  private writeBarriers = new Map<string, Promise<void>>();

  /**
   * Incremented when persistence is invalidated (restore toggled off, storage
   * swapped). In-flight async flushes capture the generation at entry and
   * abort if it changes — prevents stale writes from resurrecting purged
   * snapshots. See `.reviews/round-1.md` W9.
   */
  private _persistGeneration = 0;

  /** Latest snapshot metadata, indexed by sessionId. Used to compose the persisted index. */
  private _snapshotIndex: Record<string, SessionSnapshotMetadata> = {};

  /**
   * Pending restore snapshots loaded on activate via `hydrateFromSnapshots`.
   * Drained by `consumeSnapshotsForLocation` / `consumeSnapshotsForPanel`.
   */
  private _pendingSnapshots: Map<string, PendingSnapshot> = new Map();

  private _disposed = false;

  constructor(opts: SnapshotPersistenceOptions) {
    this.restoreEnabled = opts.restoreEnabled;
    this.storage = opts.storage;
    this.headlessFactory = opts.headlessFactory;
    this.serializeAddonFactory = opts.serializeAddonFactory;
    this.getSession = opts.getSession;
    this.editorPanels = opts.editorPanels;
  }

  isRestoreEnabled(): boolean {
    return this.restoreEnabled;
  }

  /**
   * Flip the restore-enabled flag at runtime in response to a setting change.
   * SessionManager passes its live session ids so we can dispose every mirror.
   * See design.md D11.
   */
  setRestoreEnabled(enabled: boolean, liveSessionIds: Iterable<string>): void {
    if (this.restoreEnabled === enabled) {
      return;
    }
    this.restoreEnabled = enabled;
    // Invalidate any in-flight async flush so it can't resurrect snapshots
    // after this teardown completes.
    this._persistGeneration++;
    if (!enabled) {
      if (this._persistTimer) {
        clearTimeout(this._persistTimer);
        this._persistTimer = null;
      }
      this._pendingSessions.clear();
      this.writeBarriers.clear();
      // Dispose every mirror + cached addon. The session itself stays alive;
      // only the restore pipeline is torn down.
      for (const id of liveSessionIds) {
        const session = this.getSession(id);
        if (session) {
          this.disposeMirrorFor(session);
        }
      }
      this._snapshotIndex = {};
      if (this.storage) {
        void this.storage.purge();
      }
    }
  }

  // ─── Mirror lifecycle ───────────────────────────────────────────

  /**
   * Called by SessionManager.createSession after the session is registered.
   * Seeds the headless mirror from a restore buffer (when applicable) so a
   * subsequent serialize includes prior history. Mirrors VS Code core's
   * `ptyService.ts` restore flow.
   *
   * When restoring an EXITED shell (`restoreFrom.metadata.shellExited`), the
   * mirror is NOT seeded — there is no live PTY and the existing buffer file
   * on disk already captures everything.
   */
  attachSession(session: TerminalSession, restoreFrom?: PendingSnapshot): void {
    if (!this.restoreEnabled) {
      return;
    }
    if (!restoreFrom?.buffer) {
      return;
    }
    if (restoreFrom.metadata.shellExited === true) {
      return;
    }
    try {
      const seeded = this.headlessFactory(session.cols, session.rows);
      session.headless = seeded;
      // Track the seed write so an immediate snapshot waits for it to parse.
      // Tail `\r\x1b[2K` wipes the inherited prompt row before the new PTY
      // prints its own prompt — without this, every idle reload appends a
      // stale prompt line to the next snapshot, accumulating linearly across
      // reloads (7 reloads → 6 stacked prompts above the divider).
      const seededBuffer = `${restoreFrom.buffer}\r\x1b[2K`;
      const seedBarrier = new Promise<void>((resolve) => {
        try {
          seeded.write(seededBuffer, () => resolve());
        } catch (err) {
          console.error("[AnyWhere Terminal] Failed to seed headless mirror from restore buffer:", err);
          resolve();
        }
      });
      this.writeBarriers.set(session.id, seedBarrier);
    } catch (err) {
      console.error("[AnyWhere Terminal] Failed to construct seeded headless mirror:", err);
    }
  }

  // ─── Intentful command API (design.md D15) ─────────────────────────
  //
  // Every snapshot-touching action below names a user-INTENT (commitLive,
  // commitExit, commitClear, dropSession, releaseRuntimeOnly) rather than a
  // cleanup gesture. All writes flow through the transactional storage
  // commit API (design.md D16) — sync writers + drops bump the per-artifact
  // generation; async writers capture-check-rename, so stale results never
  // touch the canonical path. Replaces the round-4/5 patch stack
  // (`detachSession`, `releaseMirror`, `resetMirror`, `purgePersistedSnapshot`,
  // `flushSessionImmediateSync`, `_sessionEpochs`).

  /**
   * Async commit of the current live mirror buffer. Driven by the debounce
   * timer in `flushPending`; also exposed for tests. Captures the buffer
   * generation BEFORE serializing; the underlying transactional commit will
   * abort cleanly (no touch to canonical) if a sync writer or `dropSession`
   * landed during our serialize/write. Updates `_snapshotIndex[id]` ONLY on
   * a successful rename so the in-memory metadata stays consistent with the
   * on-disk canonical file.
   */
  async commitLiveSnapshot(id: string): Promise<void> {
    if (this._disposed || !this.restoreEnabled || !this.storage) {
      return;
    }
    const storage = this.storage;
    const generation = this._persistGeneration;
    const session = this.getSession(id);
    if (!session) {
      // Session destroyed before commit landed — drop the in-mem entry.
      // The on-disk side is owned by dropSession (which has already run or
      // will run before deactivate completes).
      delete this._snapshotIndex[id];
      return;
    }
    await this.awaitWriteBarrier(id);
    if (!this.isStillCurrent(storage, generation)) {
      return;
    }
    const result = this.generateSnapshotMetadata(id);
    if (!result) {
      return;
    }
    const capturedGen = storage.currentBufferGen(id);
    let outcome: "renamed" | "stale-skipped" | "stale-post-write" | "stale-post-rename";
    try {
      outcome = await storage.commitBufferAsync(id, result.buffer, capturedGen);
    } catch (err) {
      console.error("[AnyWhere Terminal] commitLiveSnapshot commitBufferAsync failed:", err);
      return;
    }
    if (!this.isStillCurrent(storage, generation)) {
      return;
    }
    if (outcome !== "renamed") {
      return;
    }
    // Liveness re-check: a destroy may have run during our await. Don't
    // re-insert metadata for a session the user already killed.
    if (!this.getSession(id)) {
      return;
    }
    this._snapshotIndex[id] = result.metadata;
  }

  /**
   * SYNC commit of the exit snapshot. Called from `pty.onExit` for non-
   * killed exits (design.md D13). Sets `shellExited: true, exitCode` on the
   * session, serializes the frozen mirror, sync-writes the canonical buffer
   * + sidecar via the transactional storage API.
   */
  commitExitSnapshot(id: string, exitCode: number | null): void {
    if (this._disposed || !this.restoreEnabled || !this.storage) {
      return;
    }
    const session = this.getSession(id);
    if (!session) {
      return;
    }
    session.shellExited = true;
    session.exitCode = exitCode;
    this._pendingSessions.delete(id);
    const result = this.generateSnapshotMetadata(id);
    if (!result) {
      return;
    }
    try {
      this.storage.commitBufferSync(id, result.buffer);
    } catch (err) {
      console.error("[AnyWhere Terminal] commitExitSnapshot commitBufferSync failed:", err);
      return;
    }
    this._snapshotIndex[id] = result.metadata;
    try {
      this.storage.commitIndexSync({ version: 1, entries: { ...this._snapshotIndex } });
    } catch (err) {
      console.error("[AnyWhere Terminal] commitExitSnapshot commitIndexSync failed:", err);
    }
  }

  /**
   * SYNC commit of a cleared snapshot — the privacy boundary for
   * `clearScrollback` / Cmd+K. For mirror-backed sessions: RIS the mirror so
   * future commitLiveSnapshot serializes empty, then sync-write an empty
   * canonical buffer + bufferBytes=0 metadata. For mirror-less restored-
   * exited sessions: drop the canonical buffer + index entry entirely.
   * Replaces the round-4 `resetMirror` + `purgePersistedSnapshot` unification.
   */
  commitClearSnapshot(id: string): void {
    if (this._disposed || !this.restoreEnabled || !this.storage) {
      return;
    }
    const session = this.getSession(id);
    if (!session) {
      return;
    }
    this._pendingSessions.delete(id);
    if (!session.headless) {
      // No mirror to RIS — drop entirely (privacy boundary for restored
      // exited sessions cleared via Cmd+K).
      delete this._snapshotIndex[id];
      this.storage.dropBuffer(id);
      try {
        this.storage.commitIndexSync({ version: 1, entries: { ...this._snapshotIndex } });
      } catch (err) {
        console.error("[AnyWhere Terminal] commitClearSnapshot (no-mirror) commitIndexSync failed:", err);
      }
      return;
    }
    // RIS the mirror. Chain into writeBarriers so the next commitLiveSnapshot
    // awaits the RIS parse before serialize — otherwise a debounced flush
    // arriving between the bumped buffer gen and the new pty.onData could
    // capture pre-RIS state. Subsequent serialize reflects the cleared
    // buffer. See round-6 R6.S1.
    const prior = this.writeBarriers.get(id) ?? Promise.resolve();
    const risPromise = new Promise<void>((resolve) => {
      try {
        session.headless?.write("\x1bc", () => resolve());
      } catch (err) {
        console.error("[AnyWhere Terminal] commitClearSnapshot RIS failed:", err);
        resolve();
      }
    });
    this.writeBarriers.set(
      id,
      prior.then(() => risPromise),
    );
    // Sync-commit an empty canonical so a window close immediately after Cmd+K
    // doesn't preserve the pre-clear content. We can't await the RIS parse
    // sync; overwrite with literal empty bytes.
    const metadata = this.generateSnapshotMetadata(id)?.metadata;
    try {
      this.storage.commitBufferSync(id, "");
    } catch (err) {
      console.error("[AnyWhere Terminal] commitClearSnapshot commitBufferSync failed:", err);
      return;
    }
    if (metadata) {
      // Force-omit trackedCommands on the clear path. SessionManager.clearScrollback
      // already calls commandTracking.clear() before us so the in-memory list is
      // empty by the time generateSnapshotMetadata runs — but persisting an empty
      // value here is defense-in-depth: any future caller of commitClearSnapshot
      // that forgets to wipe commandTracking first still won't leak command
      // output across the privacy boundary. See external-review B2.
      this._snapshotIndex[id] = { ...metadata, bufferBytes: 0, trackedCommands: undefined };
    }
    try {
      this.storage.commitIndexSync({ version: 1, entries: { ...this._snapshotIndex } });
    } catch (err) {
      console.error("[AnyWhere Terminal] commitClearSnapshot commitIndexSync failed:", err);
    }
  }

  /**
   * Destructive: the user explicitly destroyed the session. Dispose the
   * runtime mirror, drop the canonical buffer (which bumps the per-buffer
   * generation so any in-flight async commit unlinks its temp ONLY), drop
   * the index entry, sync the sidecar.
   */
  dropSession(id: string): void {
    const session = this.getSession(id);
    if (session) {
      this.disposeMirrorFor(session);
    }
    this._pendingSessions.delete(id);
    this.writeBarriers.delete(id);
    const hadEntry = this._snapshotIndex[id] !== undefined;
    delete this._snapshotIndex[id];
    if (!this.storage) {
      return;
    }
    this.storage.dropBuffer(id);
    if (!hadEntry) {
      return;
    }
    // Skip the per-session sidecar commit when dispose() is iterating N
    // destroying sessions — flushSnapshotsSync/flushIndexAwaited writes the
    // final sidecar ONCE at the end of the dispose path, batching all the
    // deletions. Avoids quadratic shutdown cost (R6.W2). Outside dispose
    // (normal user destroy), commit the sidecar immediately so the next
    // restart doesn't resurrect a snapshot the user just deleted.
    if (this._disposed) {
      return;
    }
    try {
      this.storage.commitIndexSync({ version: 1, entries: { ...this._snapshotIndex } });
    } catch (err) {
      console.error("[AnyWhere Terminal] dropSession commitIndexSync failed:", err);
    }
  }

  /**
   * Shutdown of a live or exited-preserved session — dispose runtime
   * resources only (headless terminal + SerializeAddon). NEVER touches disk:
   * the just-committed snapshot survives to the next activate. Use during
   * `extension.deactivate` for sessions whose state machine reports `live`
   * or `exited-preserved`.
   *
   * Any in-flight async commit started before this is invalidated by the
   * generation bump on its next disk op (the prior commitLive/commitExit
   * call already advanced the gen; releaseRuntimeOnly itself does not need
   * to touch storage).
   */
  releaseRuntimeOnly(id: string): void {
    const session = this.getSession(id);
    if (session) {
      this.disposeMirrorFor(session);
    }
    this._pendingSessions.delete(id);
    this.writeBarriers.delete(id);
    // Intentionally NOT touching _snapshotIndex or storage — the on-disk
    // state is owned by the latest commitLive/commitExit/commitClear call
    // and must survive to the next activate (D13 read-only + cross-restart).
  }

  /** Internal current-state guard for async flushes. Used in commitLiveSnapshot. */
  private isStillCurrent(storage: SessionStorage, generation: number): boolean {
    return this.restoreEnabled && this.storage === storage && this._persistGeneration === generation && !this._disposed;
  }

  // ─── PTY event hooks ────────────────────────────────────────────

  /**
   * Forward PTY bytes to the per-session xterm-headless mirror and schedule a
   * persist. Lazy-constructs the mirror on first data when restore is enabled.
   * Failures MUST NOT propagate — the user-visible PTY output and scrollback
   * cache already fired before this is called. See design.md D1.
   */
  recordData(session: TerminalSession, data: string): void {
    if (!this.restoreEnabled) {
      return;
    }
    // Once the shell has exited, freeze the mirror so post-exit noise doesn't
    // overwrite the captured state. See D13.
    if (session.shellExited) {
      return;
    }
    if (!session.headless) {
      try {
        session.headless = this.headlessFactory(session.cols, session.rows);
      } catch (err) {
        console.error("[AnyWhere Terminal] Failed to construct headless mirror:", err);
        return;
      }
    }
    // Chain the write callback onto the per-session barrier. Async flushes
    // await the latest barrier before serialize so the snapshot is consistent.
    // The map stores only the tail Promise — the chain itself stays
    // bounded because each `.then(() => writePromise)` returns a single
    // Promise (no nesting).
    const prior = this.writeBarriers.get(session.id) ?? Promise.resolve();
    const writePromise = new Promise<void>((resolve) => {
      try {
        // biome-ignore lint/style/noNonNullAssertion: just constructed above
        session.headless!.write(data, () => resolve());
      } catch (err) {
        console.error("[AnyWhere Terminal] Headless mirror write failed:", err);
        resolve();
      }
    });
    this.writeBarriers.set(
      session.id,
      prior.then(() => writePromise),
    );
    this.schedulePersist(session.id);
  }

  /** Mirror a PTY resize. Best-effort — never break the user-facing resize on a mirror failure. */
  recordResize(session: TerminalSession, cols: number, rows: number): void {
    if (!session.headless) {
      return;
    }
    try {
      session.headless.resize(cols, rows);
    } catch {
      // headless is best-effort.
    }
  }

  /**
   * Record an exit code on the session and freeze the mirror. Thin helper
   * kept for backward compat with tests that prefer to record-then-flush
   * separately. SessionManager's `pty.onExit` calls `commitExitSnapshot`
   * directly, which subsumes this.
   */
  recordExit(session: TerminalSession, exitCode: number | null): void {
    session.shellExited = true;
    session.exitCode = exitCode;
  }

  // ─── Snapshot generation ────────────────────────────────────────

  /**
   * Generate a snapshot for a single session. Returns metadata + serialized
   * buffer, or `null` when there is no headless mirror to serialize from.
   * The SerializeAddon instance is constructed on first call and cached on
   * the session.
   *
   * Buffer is truncated to 1 MB on output at the nearest LF boundary.
   */
  generateSnapshotMetadata(sessionId: string): { metadata: SessionSnapshotMetadata; buffer: string } | null {
    const session = this.getSession(sessionId);
    if (!session?.headless) {
      return null;
    }

    if (!session.serializeAddon) {
      try {
        const addon = this.serializeAddonFactory();
        session.headless.loadAddon(addon);
        session.serializeAddon = addon;
      } catch (err) {
        console.error("[AnyWhere Terminal] Failed to load SerializeAddon:", err);
        return null;
      }
    }

    let raw: string;
    try {
      raw = session.serializeAddon.serialize(SERIALIZE_OPTIONS);
    } catch (err) {
      console.error("[AnyWhere Terminal] SerializeAddon.serialize failed:", err);
      return null;
    }
    const buffer = truncateSnapshotBuffer(raw);
    const bufferBytes = Buffer.byteLength(buffer, "utf8");

    const viewLocation = viewLocationOf(session.viewId);
    const metadata: SessionSnapshotMetadata = {
      sessionId: session.id,
      panelId: session.panelId,
      viewLocation,
      terminalNumber: session.number,
      customName: session.customName,
      shell: session.shell ?? "",
      shellArgs: session.shellArgs ?? [],
      cwd: session.initialCwd ?? "",
      currentCwd: session.currentCwd ?? null,
      cols: session.cols,
      rows: session.rows,
      bufferFile: `snapshots/${session.id}.snapshot.ans`,
      bufferBytes,
      isSplitPane: session.isSplitPane,
      // For roots: own id. For splits: the owning tab's id (so eviction can
      // keep/drop split groups atomically). See round-1 B4.
      rootTabId: session.rootTabId ?? session.id,
      snapshotAt: Date.now(),
      shellExited: session.shellExited ?? false,
      exitCode: session.exitCode ?? null,
      // Persisted so the restore re-spawn re-arms the shell-fallback-on-exit for
      // vault agent sessions (omitted when false to keep snapshots clean).
      isAgentLaunch: session.isAgentLaunch ? true : undefined,
      // Snapshot a shallow copy so concurrent appendOutput / close calls
      // during JSON.stringify can't mutate what we hand off to the storage
      // layer. The TrackedCommand objects themselves are pure data (no
      // methods), so shallow clone is sufficient.
      trackedCommands: session.commandTracking.commands.length > 0 ? [...session.commandTracking.commands] : undefined,
    };
    return { metadata, buffer };
  }

  // ─── Scheduling + flush ─────────────────────────────────────────

  /**
   * Mark a session for snapshot persistence. Hot loops are coalesced via a
   * single 1000ms debounce. No-op when restoreEnabled === false or no
   * SessionStorage is configured. See design.md D6.
   */
  schedulePersist(sessionId: string): void {
    if (!this.restoreEnabled || !this.storage) {
      return;
    }
    this._pendingSessions.add(sessionId);
    if (this._persistTimer) {
      return;
    }
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      void this.flushPending();
    }, SNAPSHOT_PERSIST_DEBOUNCE_MS);
  }

  /**
   * Bypass the debounce and persist a single session immediately. Used by the
   * shell-exit hook so the exit state lands on disk even if the user closes
   * the window in the next moment.
   */
  async flushSessionImmediate(sessionId: string): Promise<void> {
    if (!this.restoreEnabled || !this.storage) {
      return;
    }
    this._pendingSessions.add(sessionId);
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    await this.flushPending();
  }

  /**
   * Drain `_pendingSessions`: call `commitLiveSnapshot` for each, then apply
   * eviction and async-commit the index sidecar. The transactional commit
   * API (D16) ensures stale writes never reach canonical — no more per-
   * session epoch token needed. See design.md D15+D16.
   */
  private async flushPending(): Promise<void> {
    if (this._disposed || !this.storage || !this.restoreEnabled) {
      return;
    }
    const storage = this.storage;
    const generation = this._persistGeneration;
    const ids = Array.from(this._pendingSessions);
    this._pendingSessions.clear();
    // Sessions are independent — kick off all commits in parallel.
    // commitLiveSnapshot internally re-checks isStillCurrent post-await so
    // invalidation mid-flight is safe even without the per-iteration guard.
    await Promise.all(ids.map((id) => this.commitLiveSnapshot(id)));
    if (!this.isStillCurrent(storage, generation)) {
      return;
    }
    // Apply eviction before persisting the index.
    const merged: SessionSnapshotsIndex = { version: 1, entries: { ...this._snapshotIndex } };
    const { kept, dropped } = evictIndex(merged, Date.now());
    this._snapshotIndex = { ...kept.entries };
    for (const sid of dropped) {
      try {
        storage.dropBuffer(sid);
      } catch {
        /* best-effort */
      }
    }
    // Async commit of the sidecar via the transactional API. If a sync
    // sidecar commit lands during our await, the post-write check unlinks
    // our temp only — canonical reflects whatever the sync writer wrote.
    const capturedSidecarGen = storage.currentSidecarGen();
    try {
      await storage.commitIndexAsync(kept, capturedSidecarGen);
    } catch (err) {
      console.error("[AnyWhere Terminal] flushPending commitIndexAsync failed:", err);
    }
  }

  /** Test/inspection helper — the latest in-memory snapshot index. */
  getSnapshotIndexEntries(): Record<string, SessionSnapshotMetadata> {
    return { ...this._snapshotIndex };
  }

  /**
   * Synchronously write the buffer file for every live session. Used in the
   * first step of `extension.deactivate` so buffers survive even when the
   * main-thread RPC is killed before the awaited index update lands.
   * Caller passes the list of live session ids.
   */
  flushSnapshotsSync(liveSessionIds: Iterable<string>): void {
    if (this._disposed || !this.restoreEnabled || !this.storage) {
      return;
    }
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    this._pendingSessions.clear();
    for (const id of liveSessionIds) {
      const session = this.getSession(id);
      // Skip sessions the user has marked for destruction — their snapshot
      // MUST NOT be persisted to the sidecar (would resurrect on next
      // activate). The subsequent dispose() walk fires dropSession for
      // these. State machine guarantees this is the only safe filter
      // (design.md D14+D15).
      if (session && session.state === "destroying") {
        continue;
      }
      const result = this.generateSnapshotMetadata(id);
      if (!result) {
        continue;
      }
      try {
        this.storage.commitBufferSync(id, result.buffer);
      } catch (err) {
        console.error("[AnyWhere Terminal] flushSnapshotsSync commitBufferSync failed:", err);
        continue;
      }
      this._snapshotIndex[id] = result.metadata;
    }
    // Sync sidecar commit via the transactional API. The temp+rename path
    // guarantees a torn-write here cannot corrupt the canonical sidecar.
    try {
      const merged: SessionSnapshotsIndex = { version: 1, entries: { ...this._snapshotIndex } };
      const { kept, dropped } = evictIndex(merged, Date.now());
      for (const sid of dropped) {
        try {
          this.storage.dropBuffer(sid);
        } catch {
          /* best-effort */
        }
      }
      this._snapshotIndex = { ...kept.entries };
      this.storage.commitIndexSync(kept);
    } catch (err) {
      console.error("[AnyWhere Terminal] flushSnapshotsSync commitIndexSync failed:", err);
    }
  }

  /**
   * Step 2 of the deactivate flush: persist the snapshot index via the awaited
   * Memento API. Live-panels record is owned by SessionManager (which calls
   * `storage.writeLivePanelsAwaited` directly via EditorPanelRegistry).
   */
  async flushIndexAwaited(): Promise<void> {
    if (this._disposed || !this.restoreEnabled || !this.storage) {
      return;
    }
    const merged: SessionSnapshotsIndex = { version: 1, entries: { ...this._snapshotIndex } };
    const { kept, dropped } = evictIndex(merged, Date.now());
    this._snapshotIndex = { ...kept.entries };
    for (const sid of dropped) {
      try {
        this.storage.dropBuffer(sid);
      } catch {
        /* best-effort */
      }
    }
    // Sidecar is the single source of truth (D17). The sync sidecar
    // commit fired by flushSnapshotsSync already persisted this state;
    // here we just guarantee eviction + drops applied are reflected on
    // disk for the (rare) case where flushIndexAwaited is called without
    // a prior flushSnapshotsSync.
    try {
      this.storage.commitIndexSync(kept);
    } catch (err) {
      console.error("[AnyWhere Terminal] flushIndexAwaited commitIndexSync failed:", err);
    }
  }

  // ─── Hydrate-on-activate ────────────────────────────────────────

  /**
   * Hydrate the pending-restore map from the persisted index (post-restart).
   * Reads each buffer file referenced by an index entry; entries whose buffer
   * file is missing/unreadable are dropped silently. Orphan buffer files (not
   * referenced by any surviving entry) are deleted. If the index is missing
   * but buffer files exist, a minimal index is reconstructed from the
   * surviving files. Exited entries are KEPT (restored read-only — see D13).
   *
   * No-op when restoreEnabled === false (the activate path is responsible for
   * purging persisted state in that case — see D11).
   */
  hydrateFromSnapshots(index?: SessionSnapshotsIndex): void {
    if (!this.restoreEnabled || !this.storage) {
      return;
    }
    const now = Date.now();
    // Prefer the typed loadIndexDetailed result over the passed-in legacy
    // arg — only the detailed loader can distinguish "missing" (orphan
    // recovery OK) from "unsupported" (entire restore set MUST be
    // discarded, per .reviews/round-4.md [W3] and round-1 W1).
    //
    // The optional `index` parameter is retained for tests that bypass the
    // storage layer. When passed, it's treated identically to the legacy
    // call site that previously did `hydrateFromSnapshots(loadIndex())`.
    let kind: "valid" | "missing" | "unsupported";
    let incoming: Record<string, SessionSnapshotMetadata>;
    if (index !== undefined) {
      // Caller passed an index explicitly — preserve legacy semantics:
      // wrong version is treated as corrupted (discard, no orphan recovery).
      if (index.version === 1 && index.entries) {
        kind = "valid";
        incoming = { ...index.entries };
      } else {
        kind = "unsupported";
        incoming = {};
      }
    } else if (this.storage.loadIndexDetailed) {
      const detailed = this.storage.loadIndexDetailed();
      kind = detailed.kind;
      incoming = detailed.kind === "valid" ? { ...detailed.index.entries } : {};
    } else {
      // Storage shim without the detailed loader — fall back to legacy load.
      const loaded = this.storage.loadIndex();
      if (loaded && loaded.version === 1 && loaded.entries) {
        kind = "valid";
        incoming = { ...loaded.entries };
      } else if (loaded === undefined) {
        kind = "missing";
        incoming = {};
      } else {
        kind = "unsupported";
        incoming = {};
      }
    }
    // Legacy alias for the orphan-recovery gate below.
    const indexCorrupted = kind === "unsupported";

    // Step 1 — Eviction (age, size, count). Drop expired entries first so we
    // don't load their buffer files.
    const initial: SessionSnapshotsIndex = { version: 1, entries: incoming };
    const { kept } = evictIndex(initial, now);
    const indexAfterEviction = { ...kept.entries };

    // Step 2 — Load buffer file for each surviving entry. Drop entries with
    // missing/unreadable files.
    const hydrated: Array<{ metadata: SessionSnapshotMetadata; buffer: string }> = [];
    for (const meta of Object.values(indexAfterEviction)) {
      const buf = this.storage.readBufferFile(meta.sessionId);
      if (buf === null) {
        delete indexAfterEviction[meta.sessionId];
        continue;
      }
      hydrated.push({ metadata: meta, buffer: buf });
    }

    // Step 3 — Buffer-file fallback. Inspect buffer files that survived on disk
    // but are absent from the index. Covers a torn deactivate flush where new
    // buffer files landed but the awaited Memento index update was interrupted
    // after an older partial index. Skipped entirely when the index was present
    // but corrupted (unsupported version) — per spec, corrupted state is
    // discarded, not recovered. See round-1 W1.
    if (!indexCorrupted) {
      for (const sessionId of this.storage.listBufferFiles()) {
        if (indexAfterEviction[sessionId]) {
          continue;
        }
        let buf: string | null;
        try {
          buf = this.storage.readBufferFile(sessionId);
        } catch {
          // SessionStorage may reject unsafe sessionIds (W8 path-traversal guard).
          continue;
        }
        if (buf === null) {
          continue;
        }
        // Live-panels lookup: if this orphan was previously an editor session,
        // restore it AS an editor session under the same panel — otherwise it
        // defaults to a sidebar terminal. See round-1 W2.
        const owningPanelId = this.editorPanels?.findPanelForSession(sessionId);
        // Note: preferred terminalNumber = 0 falls through to findAvailableNumber()
        // (which starts at 1). See SessionManager.reserveNumber.
        const meta: SessionSnapshotMetadata = {
          sessionId,
          panelId: owningPanelId,
          viewLocation: owningPanelId ? "editor" : "sidebar",
          terminalNumber: 0,
          customName: null,
          shell: "",
          shellArgs: [],
          cwd: "",
          currentCwd: null,
          cols: 80,
          rows: 24,
          bufferFile: this.storage.bufferFileRelativePath(sessionId),
          bufferBytes: Buffer.byteLength(buf, "utf8"),
          isSplitPane: false,
          rootTabId: sessionId,
          snapshotAt: now,
          shellExited: false,
          exitCode: null,
        };
        hydrated.push({ metadata: meta, buffer: buf });
        indexAfterEviction[sessionId] = meta;
      }
    }

    // Step 4 — Orphan cleanup. Any buffer file not referenced by the surviving
    // index must be unlinked. Also remove any stray `*.tmp.*` artifacts left
    // by a process crash mid-rename (design.md D16).
    const surviving = new Set(Object.keys(indexAfterEviction));
    for (const sessionId of this.storage.listBufferFiles()) {
      if (!surviving.has(sessionId)) {
        try {
          this.storage.dropBuffer(sessionId);
        } catch {
          /* best-effort */
        }
      }
    }
    this.storage.cleanupOrphanTemps();

    // Step 5 — Stage in memory.
    this._pendingSnapshots.clear();
    for (const item of hydrated) {
      this._pendingSnapshots.set(item.metadata.sessionId, item);
    }
    this._snapshotIndex = { ...indexAfterEviction };
  }

  // ─── Pending restore snapshot consumption ───────────────────────

  hasSnapshotsForLocation(loc: "sidebar" | "panel"): boolean {
    for (const snap of this._pendingSnapshots.values()) {
      if (snap.metadata.viewLocation === loc) {
        return true;
      }
    }
    return false;
  }

  /**
   * Drain pending snapshots for a sidebar/panel location. Returned entries
   * (including exited ones, per D13) are removed from the pending map.
   */
  consumeSnapshotsForLocation(loc: "sidebar" | "panel"): PendingSnapshot[] {
    const out: PendingSnapshot[] = [];
    for (const [sessionId, snap] of this._pendingSnapshots) {
      if (snap.metadata.viewLocation === loc) {
        out.push(snap);
        this._pendingSnapshots.delete(sessionId);
      }
    }
    return out;
  }

  /**
   * Test-only seam: stage a single PendingSnapshot directly without going
   * through the full `hydrateFromSnapshots` storage I/O path. Used by tests
   * exercising provider onReady restore branches.
   */
  __stagePendingSnapshot(snap: PendingSnapshot): void {
    this._pendingSnapshots.set(snap.metadata.sessionId, snap);
  }

  /** Drain pending snapshots for a specific editor panelId. */
  consumeSnapshotsForPanel(panelId: string): PendingSnapshot[] {
    const out: PendingSnapshot[] = [];
    for (const [sessionId, snap] of this._pendingSnapshots) {
      if (snap.metadata.viewLocation === "editor" && snap.metadata.panelId === panelId) {
        out.push(snap);
        this._pendingSnapshots.delete(sessionId);
      }
    }
    return out;
  }

  // ─── Shutdown ───────────────────────────────────────────────────

  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    this._pendingSessions.clear();
    // Disposal of per-session mirrors is performed by SessionManager via
    // dropSession / releaseRuntimeOnly during cleanupSession + dispose
    // (called as it tears down each PTY).
  }

  // ─── Private helpers ────────────────────────────────────────────

  /** Wait for the current write barrier to settle. Best-effort — never throws. */
  private async awaitWriteBarrier(sessionId: string): Promise<void> {
    const barrier = this.writeBarriers.get(sessionId);
    if (!barrier) {
      return;
    }
    try {
      await barrier;
    } catch {
      // The write promise resolver swallows errors; this catch is defensive.
    }
  }

  private disposeMirrorFor(session: TerminalSession): void {
    if (session.serializeAddon) {
      try {
        session.serializeAddon.dispose();
      } catch {
        /* best-effort */
      }
      session.serializeAddon = undefined;
    }
    if (session.headless) {
      try {
        session.headless.dispose();
      } catch {
        /* best-effort */
      }
      session.headless = undefined;
    }
  }
}
