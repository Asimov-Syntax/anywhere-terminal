// src/vault/VaultService.ts — Aggregate per-agent readers into one recency-sorted,
// metadata-only session list with resolved fork support.
// See: specs/agent-session-index/spec.md (Aggregate and sort; Defensive parsing),
//      specs/vault-session-launch/spec.md (Fork when supported), design.md D2,D8.

import * as path from "node:path";
import {
  type ListReader,
  type ReaderListCache,
  type ReaderResultWithState,
  VAULT_CACHE_VERSION,
  type VaultListCacheFileV1,
} from "./cacheTypes";
import { canForkOpenCode } from "./forkSupport";
import { claudeRoots, resolveClaudeSessionPath } from "./readers/claudePaths";
import { readClaudeDetail, readClaudeEntry, readClaudeMessageRecord, readClaudeSessions } from "./readers/claudeReader";
import {
  codexStoreDirs,
  readCodexDetail,
  readCodexEntry,
  readCodexMessageRecord,
  readCodexSessions,
  renameCodexThread,
} from "./readers/codexReader";
import { clampDetailLimit } from "./readers/detail";
import {
  opencodeStoreDirs,
  readOpenCodeDetail,
  readOpenCodeEntry,
  readOpenCodeMessageRecord,
  readOpenCodeSessions,
  renameOpenCodeSession,
} from "./readers/opencodeReader";
import type { RecordLineResult } from "./readers/recordLine";
import { getAgentDefinition, VAULT_AGENT_IDS, type VaultAgentId } from "./registry";
import { parseEntryId, type VaultListResult, type VaultSessionDetail, type VaultSessionEntry } from "./types";
import type { VaultCacheStore } from "./VaultCacheStore";
import { normalizeVaultCustomName, type VaultCustomNameRegistry } from "./VaultCustomNameRegistry";

// Agent identity is a single source of truth in `registry.ts`: `VaultAgentId`
// is derived from `VAULT_AGENT_IDS`, and the keyed reader records below are
// `satisfies Record<VaultAgentId, …>` so a missing agent is a compile error —
// no positional array or switch to forget (W3).

/** Human label for an agent — derived from the registry, never a parallel array. */
function agentLabel(id: VaultAgentId): string {
  return getAgentDefinition(id)?.displayName ?? id;
}

function isVaultAgentId(value: string): value is VaultAgentId {
  return (VAULT_AGENT_IDS as readonly string[]).includes(value);
}

/** Per-agent incremental list readers: given the prior per-agent cache, return
 *  the current entries + the freshness state to persist (cache-vault-load D3). */
export type VaultReaders = Record<VaultAgentId, ListReader>;

/** Per-agent on-demand detail readers (resolve a single session by id). The
 *  optional `limit` bounds the returned timeline (most-recent kept) so the
 *  webview can load older messages incrementally. */
export type VaultDetailReaders = Record<
  VaultAgentId,
  (sessionId: string, limit?: number) => Promise<VaultSessionDetail | null>
>;

/** Per-agent single-entry readers (resolve ONE launch entry by id, no full scan).
 *  Backs `getEntry`, the fast path for resume/fork. */
export type VaultEntryReaders = Record<VaultAgentId, (sessionId: string) => Promise<VaultSessionEntry | null>>;

/** Per-agent single-record readers: resolve the `msgRef` a timeline item carries
 *  back to its stored record (improve-vault-transcript-messages D5). */
export type VaultRecordReaders = Record<VaultAgentId, (sessionId: string, msgRef: string) => Promise<RecordLineResult>>;

/** Writes a user-chosen title into an agent's own store; true iff a row was
 *  updated (write-vault-rename-to-store D1). Only the SQLite agents have one —
 *  Claude has no writable title field. */
export type VaultNativeRenamer = (sessionId: string, name: string) => Promise<boolean>;

export interface VaultServiceDeps {
  readers?: VaultReaders;
  detailReaders?: VaultDetailReaders;
  entryReaders?: VaultEntryReaders;
  recordReaders?: VaultRecordReaders;
  /** Injectable opencode fork probe; defaults to the real version probe. */
  canForkOpenCodeFn?: (minVersion: string) => Promise<boolean>;
  /**
   * Persistent list cache (cache-vault-load D2). When provided, `listCached()`
   * serves the last list instantly and `refresh()` reads incrementally + persists.
   * When omitted, the service is stateless (full read every `list()`, as before).
   */
  cacheStore?: VaultCacheStore;
  /**
   * User custom-name registry (enhance-vault-sessions D1). When provided, list
   * results are overlaid with `customName` at serve time — cloned, never mutating
   * the cache. When omitted, no overlay is applied.
   */
  customNames?: VaultCustomNameRegistry;
  /**
   * Per-agent native title writers (write-vault-rename-to-store D1). Only opencode
   * and codex have one; claude is absent (no writable title field). Injectable for
   * tests; defaults to the real reader writers.
   */
  nativeRenamers?: Partial<Record<VaultAgentId, VaultNativeRenamer>>;
}

// Readers stay option-first for back-compat; adapt them to the prev-only ListReader
// shape the service drives (cache-vault-load Interfaces).
const defaultReaders = {
  claude: (prev) => readClaudeSessions({}, prev),
  codex: (prev) => readCodexSessions({}, prev),
  opencode: (prev) => readOpenCodeSessions({}, prev),
} satisfies VaultReaders;

const defaultDetailReaders = {
  claude: (sessionId, limit) => readClaudeDetail(sessionId, {}, limit),
  codex: (sessionId, limit) => readCodexDetail(sessionId, {}, limit),
  opencode: (sessionId, limit) => readOpenCodeDetail(sessionId, {}, limit),
} satisfies VaultDetailReaders;

const defaultRecordReaders = {
  claude: (sessionId, msgRef) => readClaudeMessageRecord(sessionId, msgRef),
  codex: (sessionId, msgRef) => readCodexMessageRecord(sessionId, msgRef),
  opencode: (sessionId, msgRef) => readOpenCodeMessageRecord(sessionId, msgRef),
} satisfies VaultRecordReaders;

const defaultEntryReaders = {
  claude: (sessionId) => readClaudeEntry(sessionId),
  codex: (sessionId) => readCodexEntry(sessionId),
  opencode: (sessionId) => readOpenCodeEntry(sessionId),
} satisfies VaultEntryReaders;

/** Native title writers — only the SQLite agents (claude has no writable title). */
const defaultNativeRenamers: Partial<Record<VaultAgentId, VaultNativeRenamer>> = {
  codex: (sessionId, name) => renameCodexThread(sessionId, name),
  opencode: (sessionId, name) => renameOpenCodeSession(sessionId, name),
};

/** A directory + glob to hand to `WatcherPool.subscribePattern` (enhance-vault-sessions
 *  D4/D5). Resolved from the reader path helpers so watch targets never drift. */
export interface VaultWatchTarget {
  baseDir: string;
  glob: string;
}

/** Glob-safe id (filename stems / uuids) — reject anything with path or glob
 *  metacharacters before interpolating an id into a watch glob. */
function isGlobSafeId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id) && !id.includes("..");
}

export class VaultService {
  private readonly readers: VaultReaders;
  private readonly detailReaders: VaultDetailReaders;
  private readonly entryReaders: VaultEntryReaders;
  private readonly recordReaders: VaultRecordReaders;
  private readonly canForkOpenCodeFn: (minVersion: string) => Promise<boolean>;
  private readonly cacheStore?: VaultCacheStore;
  private readonly customNames?: VaultCustomNameRegistry;
  private readonly nativeRenamers: Partial<Record<VaultAgentId, VaultNativeRenamer>>;

  /** In-memory copy of the persisted cache, lazily loaded from `cacheStore`. */
  private mem: VaultListCacheFileV1 | null = null;
  private memLoaded = false;
  /** Single-flight guard so concurrent opens (sidebar + panel) share one refresh. */
  private inflightRefresh: Promise<VaultListResult> | null = null;

  constructor(deps: VaultServiceDeps = {}) {
    this.readers = deps.readers ?? defaultReaders;
    this.detailReaders = deps.detailReaders ?? defaultDetailReaders;
    this.entryReaders = deps.entryReaders ?? defaultEntryReaders;
    this.recordReaders = deps.recordReaders ?? defaultRecordReaders;
    this.canForkOpenCodeFn = deps.canForkOpenCodeFn ?? ((min) => canForkOpenCode(min));
    this.cacheStore = deps.cacheStore;
    this.customNames = deps.customNames;
    this.nativeRenamers = deps.nativeRenamers ?? defaultNativeRenamers;
  }

  /**
   * Set or clear a session's user custom name (enhance-vault-sessions D1). Empty
   * (after trim) clears it, reverting to the reader-derived title. No-op when the
   * service was built without a registry.
   */
  setCustomName(entryId: string, name: string): void {
    this.customNames?.set(entryId, name);
  }

  /**
   * Write a user-chosen title into the agent's OWN store for a SQLite agent
   * (opencode/codex), keyed off the entry id's agent (write-vault-rename-to-store
   * D1). Returns true iff a store row was updated; false for claude/unknown agents,
   * an empty (after-trim) name, or any failed write — the caller then falls back to
   * the sidecar overlay. The name is normalized (trim + cap) here too so the store
   * title obeys the same bound regardless of caller (review S1).
   */
  async writeNativeTitle(entryId: string, name: string): Promise<boolean> {
    const normalized = normalizeVaultCustomName(name);
    if (normalized === null) {
      return false;
    }
    const parsed = parseEntryId(entryId);
    if (!parsed || !isVaultAgentId(parsed.agent)) {
      return false;
    }
    const renamer = this.nativeRenamers[parsed.agent];
    return renamer ? renamer(parsed.sessionId, normalized) : false;
  }

  /**
   * Overlay user custom names onto a served list WITHOUT mutating the cache: only
   * renamed entries are cloned (`{ ...entry, customName }`); the rest pass through
   * by reference, and `this.mem.entries` / the persisted doc are never touched.
   */
  private overlayCustomNames(result: VaultListResult): VaultListResult {
    if (!this.customNames) {
      return result;
    }
    const names = this.customNames.all();
    if (Object.keys(names).length === 0) {
      return result;
    }
    const entries = result.entries.map((e) => {
      const name = names[e.id];
      return name ? { ...e, customName: name } : e;
    });
    return { entries, unreadable: result.unreadable };
  }

  /**
   * Read every agent store and aggregate into one recency-sorted, fork-resolved
   * list. When `prev` is supplied, each reader reads INCREMENTALLY against its
   * prior per-agent cache (cache-vault-load D3). Returns both the public result
   * and the cache document to persist. A whole reader failing is surfaced as
   * unreadable (not dropped); the failed agent contributes no entries and its
   * stale cache is discarded so the next refresh re-reads it from scratch.
   */
  private async readAll(prev: VaultListCacheFileV1 | null): Promise<{
    result: VaultListResult;
    doc: VaultListCacheFileV1;
  }> {
    const prevAgents = prev?.agents ?? {};
    const settled = await Promise.allSettled(
      VAULT_AGENT_IDS.map((id) => invokeReader(() => this.readers[id](prevAgents[id]))),
    );

    const entries: VaultSessionEntry[] = [];
    let unreadable = 0;
    const reasons: string[] = [];
    const agents: Partial<Record<VaultAgentId, ReaderListCache>> = {};
    settled.forEach((r, i) => {
      const id = VAULT_AGENT_IDS[i];
      const label = agentLabel(id);
      if (r.status === "fulfilled") {
        entries.push(...r.value.entries);
        agents[id] = r.value.cache;
        if (r.value.unreadable > 0) {
          unreadable += r.value.unreadable;
          reasons.push(
            `${label}: ${r.value.unreadable} session${r.value.unreadable === 1 ? "" : "s"} couldn't be read`,
          );
        }
      } else {
        // A whole reader failed (transient I/O, a corrupt store, etc.). Surface it
        // — but preserve LAST-KNOWN-GOOD for this agent rather than wiping it: carry
        // the prior per-agent freshness cache (so the next refresh stays incremental)
        // and the prior persisted entries (so the agent's sessions don't vanish from
        // the list and we don't overwrite the saved snapshot with a missing-agent
        // one). A momentary failure now self-corrects on the next successful read
        // instead of degrading the cache (review round-2 F1). First run / nothing to
        // carry → the agent is simply absent this cycle.
        unreadable += 1;
        const prevCache = prevAgents[id];
        const priorEntries = prev?.entries.filter((e) => e.agent === id) ?? [];
        if (prevCache) {
          agents[id] = prevCache;
        }
        if (priorEntries.length > 0) {
          entries.push(...priorEntries);
          reasons.push(`${label}: reader failed — showing last cached`);
        } else {
          reasons.push(`${label}: reader failed`);
        }
      }
    });

    // Resolve fork support. Only spawn the opencode probe when it can matter.
    const hasOpenCode = entries.some((e) => e.agent === "opencode");
    const opencodeMin = getAgentDefinition("opencode")?.forkMinVersion ?? "1.1.54";
    let opencodeCanFork = false;
    if (hasOpenCode) {
      try {
        opencodeCanFork = await this.canForkOpenCodeFn(opencodeMin);
      } catch {
        opencodeCanFork = false;
      }
    }

    for (const entry of entries) {
      entry.canFork = resolveCanFork(entry, opencodeCanFork);
    }

    entries.sort((a, b) => b.modified - a.modified);
    const result: VaultListResult = { entries, unreadable: { count: unreadable, reasons: dedupe(reasons) } };
    const doc: VaultListCacheFileV1 = {
      version: VAULT_CACHE_VERSION,
      savedAt: Date.now(),
      agents,
      entries,
      unreadable: result.unreadable,
    };
    return { result, doc };
  }

  /** Full, non-persisted read of every store (no cache). Backs `resolveVaultEntry`
   *  and callers that want source-of-truth truth without touching the cache. */
  async list(): Promise<VaultListResult> {
    const { result } = await this.readAll(null);
    return result;
  }

  /**
   * The last persisted list, served synchronously for an instant render on open
   * (cache-vault-load D1). Lazily loads the cache from disk on first call. Returns
   * null when there is no cache store or no valid cached document.
   */
  listCached(): VaultListResult | null {
    this.ensureMemLoaded();
    return this.mem ? this.overlayCustomNames({ entries: this.mem.entries, unreadable: this.mem.unreadable }) : null;
  }

  /**
   * Re-read the stores incrementally (only changed sources), persist the result,
   * and return the fresh list (cache-vault-load D1/D2). Single-flight: concurrent
   * callers share one in-flight read. The cache write is AWAITED before the
   * promise resolves so a later refresh can never persist ahead of an earlier one
   * and overwrite it with stale data; a write failure is logged, not thrown.
   */
  async refresh(opts?: { force?: boolean }): Promise<VaultListResult> {
    if (this.inflightRefresh && !opts?.force) {
      // Default: concurrent callers share the in-flight read.
      return this.inflightRefresh;
    }
    // `force` (used right after a native title write) must NOT join an in-flight
    // read — it may have started BEFORE the write and would return the pre-write
    // title. Drain ALL in-flight reads (including one a concurrent force started)
    // so this read begins strictly after the write, and force refreshes stay
    // serialized — never two `run`s persisting out of order (D4, review W1).
    while (this.inflightRefresh) {
      await this.inflightRefresh.catch(() => {});
    }
    const run = (async (): Promise<VaultListResult> => {
      this.ensureMemLoaded();
      const { result, doc } = await this.readAll(this.mem);
      this.mem = doc;
      this.memLoaded = true;
      if (this.cacheStore) {
        try {
          await this.cacheStore.save(doc);
        } catch (err) {
          console.error("[AnyWhere Terminal] Failed to persist vault cache:", err);
        }
      }
      // Overlay AFTER persistence so the cache stays agent-derived (D1).
      return this.overlayCustomNames(result);
    })();
    this.inflightRefresh = run;
    try {
      return await run;
    } finally {
      // Only clear if still ours — a concurrent force-refresh may have replaced it.
      if (this.inflightRefresh === run) {
        this.inflightRefresh = null;
      }
    }
  }

  /** Load the persisted cache into memory once (no-op without a cache store). */
  private ensureMemLoaded(): void {
    if (this.memLoaded) {
      return;
    }
    this.mem = this.cacheStore?.load() ?? null;
    this.memLoaded = true;
  }

  /**
   * Read one session's bounded detail on demand (redesign-vault-panel-ui D3).
   * Resolves the session by its id within the right agent's store via that
   * reader's `readDetail` — no full `list()`, no cache. Returns null for an
   * unknown agent or an unresolvable session.
   */
  async getDetail(entryId: string, limit?: number): Promise<VaultSessionDetail | null> {
    const parsed = parseEntryId(entryId);
    if (!parsed || !isVaultAgentId(parsed.agent)) {
      return null;
    }
    // Clamp the webview-supplied limit so a forged/garbage value can't defeat the
    // reader's timeline bound (W2).
    return this.detailReaders[parsed.agent](parsed.sessionId, clampDetailLimit(limit));
  }

  /**
   * Resolve one timeline message back to its stored record, for the per-message
   * Raw copy and the continue handoff (D5). The store location comes from the
   * entry id alone — the webview supplies an opaque locator, never a path — and a
   * record above the 256 KB cap is refused rather than shipped.
   */
  async readMessageRecord(entryId: string, msgRef: string): Promise<RecordLineResult> {
    const parsed = parseEntryId(entryId);
    if (!parsed || !isVaultAgentId(parsed.agent)) {
      return { ok: false, reason: "not-found" };
    }
    return this.recordReaders[parsed.agent](parsed.sessionId, msgRef);
  }

  /**
   * Resolve ONE launch entry by id — the fast path for resume/fork. Reads only
   * the relevant agent's store via a point/locate-by-id lookup (no aggregate
   * `list()` over every store, no fork probe for agents other than opencode), so
   * launching is not gated on scanning the full session index. Mirrors getDetail
   * (resolve-by-id, no cache; D3). Returns null for an unknown agent or an
   * unresolvable session. canFork is resolved the same way as in list().
   */
  async getEntry(entryId: string): Promise<VaultSessionEntry | null> {
    const parsed = parseEntryId(entryId);
    if (!parsed || !isVaultAgentId(parsed.agent)) {
      return null;
    }
    const entry = await this.entryReaders[parsed.agent](parsed.sessionId);
    if (!entry) {
      return null;
    }
    let opencodeCanFork = false;
    if (entry.agent === "opencode") {
      const opencodeMin = getAgentDefinition("opencode")?.forkMinVersion ?? "1.1.54";
      try {
        opencodeCanFork = await this.canForkOpenCodeFn(opencodeMin);
      } catch {
        opencodeCanFork = false;
      }
    }
    entry.canFork = resolveCanFork(entry, opencodeCanFork);
    return entry;
  }

  /**
   * Store-wide FS-watch targets for auto-refresh (enhance-vault-sessions D4): the
   * three agents' session roots, scoped to store roots (never all of $HOME). WAL
   * DBs are matched with a `<db>*` glob so `-wal`/`-shm` writes are seen too.
   * Change-aware `subscribePattern` (task 1_3) is required — vault sessions grow
   * by APPEND, which the create/delete-only `subscribe` drops.
   */
  getStoreWatchTargets(): VaultWatchTarget[] {
    const { projectsDir } = claudeRoots({});
    const codex = codexStoreDirs();
    const opencode = opencodeStoreDirs();
    return [
      { baseDir: projectsDir, glob: "**/*.jsonl" },
      { baseDir: path.dirname(codex.dbPath), glob: `${path.basename(codex.dbPath)}*` },
      { baseDir: codex.sessionsDir, glob: "**/*.jsonl" },
      { baseDir: path.dirname(opencode.dbPath), glob: `${path.basename(opencode.dbPath)}*` },
    ];
  }

  /**
   * Per-session FS-watch targets for live-follow (enhance-vault-sessions D5),
   * scoped to the ONE previewed session so unrelated writes don't wake the
   * follow re-read. Claude/Codex content lives in a JSONL (the Codex SQLite index
   * updates in lockstep — watch both); OpenCode content lives in the WAL DB.
   * Returns `[]` for an unknown agent, an unresolved Claude file, or an unsafe id.
   */
  async resolveSessionWatchTargets(entryId: string): Promise<VaultWatchTarget[]> {
    const parsed = parseEntryId(entryId);
    if (!parsed || !isVaultAgentId(parsed.agent) || !isGlobSafeId(parsed.sessionId)) {
      return [];
    }
    switch (parsed.agent) {
      case "claude": {
        const file = await resolveClaudeSessionPath(parsed.sessionId);
        return file ? [{ baseDir: path.dirname(file), glob: path.basename(file) }] : [];
      }
      case "codex": {
        const { dbPath, sessionsDir } = codexStoreDirs();
        return [
          { baseDir: sessionsDir, glob: `**/*-${parsed.sessionId}.jsonl` },
          { baseDir: path.dirname(dbPath), glob: `${path.basename(dbPath)}*` },
        ];
      }
      case "opencode": {
        const { dbPath } = opencodeStoreDirs();
        return [{ baseDir: path.dirname(dbPath), glob: `${path.basename(dbPath)}*` }];
      }
      default:
        return [];
    }
  }
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

// Defer reader invocation to a microtask so a reader that throws SYNCHRONOUSLY
// still rejects its promise (and is caught by allSettled) rather than aborting
// the whole aggregation.
function invokeReader(read: () => Promise<ReaderResultWithState>): Promise<ReaderResultWithState> {
  return Promise.resolve().then(read);
}

function resolveCanFork(entry: VaultSessionEntry, opencodeCanFork: boolean): boolean {
  const def = getAgentDefinition(entry.agent);
  if (!def?.forkCommand) {
    return false;
  }
  if (def.forkMinVersion) {
    // Version-gated agents (currently only opencode).
    return entry.agent === "opencode" ? opencodeCanFork : false;
  }
  return true; // forkCommand present, no version gate (claude, codex)
}
