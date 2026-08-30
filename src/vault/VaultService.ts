// src/vault/VaultService.ts — Aggregate per-agent readers into one recency-sorted,
// metadata-only session list with resolved fork support.
// See: specs/agent-session-index/spec.md (Aggregate and sort; Defensive parsing),
//      specs/vault-session-launch/spec.md (Fork when supported), design.md D2,D8.

import { createHash, randomBytes } from "node:crypto";
import * as path from "node:path";
import {
  type ListReader,
  type ReaderListCache,
  type ReaderResultWithState,
  VAULT_CACHE_VERSION,
  type VaultListCacheFileV1,
  type VaultRefreshHint,
} from "./cacheTypes";
import { canForkOpenCode } from "./forkSupport";
import { claudeRoots, resolveClaudeSessionPath } from "./readers/claudePaths";
import {
  lookupClaudeEntry,
  readClaudeDetail,
  readClaudeMessageRecord,
  readClaudeSessions,
} from "./readers/claudeReader";
import {
  codexStoreDirs,
  lookupCodexEntry,
  readCodexDetail,
  readCodexMessageRecord,
  readCodexSessions,
  renameCodexThread,
} from "./readers/codexReader";
import { cursorIdeDbPath } from "./readers/cursorIdeReader";
import { cursorChatsRoot } from "./readers/cursorPaths";
import {
  type CursorCombinedReaderOptions,
  type CursorDetailReaderOptions,
  lookupCursorEntry,
  readCursorDetail,
  readCursorMessageRecord,
  readCursorSessions,
  resolveCursorLaunchTarget,
  resolveCursorSessionWatchPaths,
  verifyCursorLaunchTarget,
} from "./readers/cursorReader";
import { clampDetailLimit } from "./readers/detail";
import {
  lookupOpenCodeEntry,
  opencodeStoreDirs,
  readOpenCodeDetail,
  readOpenCodeMessageRecord,
  readOpenCodeSessions,
  renameOpenCodeSession,
} from "./readers/opencodeReader";
import type { RecordLineResult } from "./readers/recordLine";
import { getAgentDefinition, VAULT_AGENT_IDS, type VaultAgentId } from "./registry";
import {
  parseEntryId,
  type VaultEntryLookup,
  type VaultListResult,
  type VaultSessionDetail,
  type VaultSessionEntry,
} from "./types";
import type { VaultAgentAdapter, VaultWatchTarget } from "./VaultAgentAdapter";
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

import type { VaultNativeRenamer } from "./VaultAgentAdapter";

export type { VaultAgentAdapter, VaultNativeRenamer, VaultWatchTarget } from "./VaultAgentAdapter";

const REQUIRED_ADAPTER_CAPABILITIES = ["list", "detail", "entry", "record"] as const;

/**
 * An adapter override with `undefined` stripped from the REQUIRED capabilities.
 *
 * The two capability tiers read an absent override in opposite directions: for the
 * optional three, `undefined` DROPS the capability, which is how an agent that
 * declares no watch capability is exercised (D6). The required four have no absent
 * state — dispatch calls them unguarded — so there `undefined` must leave the
 * default standing. `Partial` alone cannot separate the two: without
 * `exactOptionalPropertyTypes`, an explicit `undefined` satisfies a required member.
 */
function definedRequiredCapabilities(override: Partial<VaultAgentAdapter> | undefined): Partial<VaultAgentAdapter> {
  if (!override) {
    return {};
  }
  const merged: Partial<VaultAgentAdapter> = { ...override };
  for (const capability of REQUIRED_ADAPTER_CAPABILITIES) {
    if (merged[capability] === undefined) {
      delete merged[capability];
    }
  }
  return merged;
}

export interface VaultServiceDeps {
  /**
   * Per-agent adapter overrides (D6), merged over the defaults after the
   * per-capability maps below. Passing `undefined` for an optional capability
   * DROPS it, which is how an agent that declares no watch capability at all is
   * exercised — absence must be handled, never stubbed.
   */
  adapters?: Partial<Record<VaultAgentId, Partial<VaultAgentAdapter>>>;
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
  /** Cursor source roots used by watcher resolution; production uses platform defaults. */
  cursorReaderOptions?: CursorCombinedReaderOptions;
  /**
   * Injectable Cursor D14 deferred store-identity proof; production uses the real
   * point-resolution + bounded-store verifier. Only Cursor entries are routed
   * through it — see {@link VaultService.getLaunchTarget}.
   */
  resolveCursorLaunchTargetFn?: (
    sessionId: string,
    options: CursorCombinedReaderOptions,
  ) => Promise<CursorLaunchTarget | null>;
  verifyCursorLaunchTargetFn?: (target: CursorLaunchTarget, options: CursorCombinedReaderOptions) => Promise<boolean>;
  /** Injectable Cursor detail decoder — the one reader handed a child-locator
   *  issuer, so the D12 registry is exercised through it rather than around it. */
  readCursorDetailFn?: (
    sessionId: string,
    limit: number | undefined,
    options: CursorDetailReaderOptions,
  ) => Promise<VaultSessionDetail | null>;
}

interface CursorLaunchTarget {
  entry: VaultSessionEntry;
  dbPath: string;
}

/** An entry resolved for launch plus the identity proof for that exact location. */
export interface VaultLaunchTarget {
  entry: VaultSessionEntry;
  verify: () => Promise<boolean>;
}

// ONE registration per agent (D6). Readers stay option-first for back-compat;
// adapt them to the prev-only ListReader shape the service drives
// (cache-vault-load Interfaces). `renameNative` is absent for claude, which has
// no writable title field — absent, not stubbed.
const defaultAdapters = {
  claude: {
    list: (prev) => readClaudeSessions({}, prev),
    detail: (sessionId, limit) => readClaudeDetail(sessionId, {}, limit),
    entry: (sessionId) => lookupClaudeEntry(sessionId),
    record: (sessionId, msgRef) => readClaudeMessageRecord(sessionId, msgRef),
    storeWatchTargets: () => [{ baseDir: claudeRoots({}).projectsDir, glob: "**/*.jsonl" }],
    sessionWatchTargets: async (sessionId) => {
      if (!isGlobSafeId(sessionId)) {
        return [];
      }
      const file = await resolveClaudeSessionPath(sessionId);
      return file ? [{ baseDir: path.dirname(file), glob: path.basename(file) }] : [];
    },
  },
  codex: {
    list: (prev) => readCodexSessions({}, prev),
    detail: (sessionId, limit) => readCodexDetail(sessionId, {}, limit),
    entry: (sessionId) => lookupCodexEntry(sessionId),
    record: (sessionId, msgRef) => readCodexMessageRecord(sessionId, msgRef),
    renameNative: (sessionId, name) => renameCodexThread(sessionId, name),
    storeWatchTargets: () => {
      const { dbPath, sessionsDir } = codexStoreDirs();
      return [
        { baseDir: path.dirname(dbPath), glob: `${path.basename(dbPath)}*` },
        { baseDir: sessionsDir, glob: "**/*.jsonl" },
      ];
    },
    sessionWatchTargets: async (sessionId) => {
      if (!isGlobSafeId(sessionId)) {
        return [];
      }
      const { dbPath, sessionsDir } = codexStoreDirs();
      return [
        { baseDir: sessionsDir, glob: `**/*-${sessionId}.jsonl` },
        { baseDir: path.dirname(dbPath), glob: `${path.basename(dbPath)}*` },
      ];
    },
  },
  opencode: {
    list: (prev) => readOpenCodeSessions({}, prev),
    detail: (sessionId, limit) => readOpenCodeDetail(sessionId, {}, limit),
    entry: (sessionId) => lookupOpenCodeEntry(sessionId),
    record: (sessionId, msgRef) => readOpenCodeMessageRecord(sessionId, msgRef),
    renameNative: (sessionId, name) => renameOpenCodeSession(sessionId, name),
    storeWatchTargets: () => {
      const { dbPath } = opencodeStoreDirs();
      return [{ baseDir: path.dirname(dbPath), glob: `${path.basename(dbPath)}*` }];
    },
    sessionWatchTargets: async (sessionId) => {
      if (!isGlobSafeId(sessionId)) {
        return [];
      }
      const { dbPath } = opencodeStoreDirs();
      return [{ baseDir: path.dirname(dbPath), glob: `${path.basename(dbPath)}*` }];
    },
  },
  cursor: {
    // The three Cursor-option-bearing capabilities are rebound in the constructor,
    // which is where `cursorReaderOptions` and the child-locator issuer exist.
    list: (prev, hint) => readCursorSessions(prev, {}, hint),
    detail: (sessionId, limit) => readCursorDetail(sessionId, limit),
    entry: (sessionId) => lookupCursorEntry(sessionId),
    record: (sessionId, msgRef) => readCursorMessageRecord(sessionId, msgRef),
  },
} satisfies Record<VaultAgentId, VaultAgentAdapter>;

export const MAX_PENDING_VAULT_REFRESH_PATHS = 128;

/** Cursor child-transcript locator domain (design.md D13) — host-issued, never
 *  a top-level row and never a launch operand. */
const CURSOR_CHILD_PREFIX = "child:";
/** Registry bound: a preview session can expand unboundedly many children, and
 *  only the recently issued locators can still be on screen. */
const MAX_CURSOR_CHILD_LOCATORS = 256;

/** Glob-safe id (filename stems / uuids) — reject anything with path or glob
 *  metacharacters before interpolating an id into a watch glob. */
function isGlobSafeId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id) && !id.includes("..");
}

export class VaultService {
  /** One adapter per agent — the single registration list/detail/entry/record
   *  and the native renamer all resolve through (D6). */
  private readonly adapters: Record<VaultAgentId, VaultAgentAdapter>;
  private readonly canForkOpenCodeFn: (minVersion: string) => Promise<boolean>;
  private readonly cacheStore?: VaultCacheStore;
  private readonly customNames?: VaultCustomNameRegistry;
  private readonly cursorReaderOptions: CursorCombinedReaderOptions;
  private readonly resolveCursorLaunchTargetFn: (
    sessionId: string,
    options: CursorCombinedReaderOptions,
  ) => Promise<CursorLaunchTarget | null>;
  private readonly verifyCursorLaunchTargetFn: (
    target: CursorLaunchTarget,
    options: CursorCombinedReaderOptions,
  ) => Promise<boolean>;
  /**
   * D12 child-transcript access boundary: locator → the project transcript id it
   * stands for, most-recently-issued last. Only a locator this process handed out
   * with a parent detail resolves, so a forged or hidden-orphan id decodes
   * nothing. Bounded, because previews are unbounded over a session's lifetime.
   */
  private readonly cursorChildLocators = new Map<string, string>();
  /** Per-process, so a locator is stable across live-follow re-reads of the same
   *  parent (an expanded card survives refresh) yet is not derivable outside it. */
  private readonly cursorChildSalt = randomBytes(16).toString("hex");

  /** In-memory copy of the persisted cache, lazily loaded from `cacheStore`. */
  private mem: VaultListCacheFileV1 | null = null;
  private memLoaded = false;
  /** Active persisted refresh plus its completeness, for safe joining decisions. */
  private inflightRefresh: Promise<VaultListResult> | null = null;
  private inflightRefreshKind: "complete" | "hinted" | null = null;
  private inflightHintAgent: VaultAgentId | null = null;
  private inflightHintPaths: Set<string> | null = null;
  private inflightHintReadStarted = false;
  /** One bounded follow-up request: same-agent hints merge; conflicts promote to full. */
  private pendingHint: { agent: VaultAgentId; paths: Set<string> } | null = null;
  private pendingCompleteRefresh = false;
  private pendingRefresh: Promise<VaultListResult> | null = null;
  private forceBarrier: Promise<VaultListResult> | null = null;
  private postForceHint: { agent: VaultAgentId; paths: Set<string> } | null = null;
  private postForceCompleteRefresh = false;
  private postForceRefresh: Promise<VaultListResult> | null = null;

  constructor(deps: VaultServiceDeps = {}) {
    this.cursorReaderOptions = deps.cursorReaderOptions ?? {};
    const readCursorDetailFn = deps.readCursorDetailFn ?? readCursorDetail;
    const base: Record<VaultAgentId, VaultAgentAdapter> = {
      ...defaultAdapters,
      cursor: {
        ...defaultAdapters.cursor,
        list: (prev, hint) => readCursorSessions(prev, this.cursorReaderOptions, hint),
        detail: (sessionId, limit) =>
          readCursorDetailFn(sessionId, limit, {
            ...this.cursorReaderOptions,
            issueChildLocator: (child) => this.issueCursorChildLocator(child),
          }),
        entry: (sessionId) => lookupCursorEntry(sessionId, this.cursorReaderOptions),
        storeWatchTargets: () => {
          const chats = cursorChatsRoot(this.cursorReaderOptions);
          const ide = cursorIdeDbPath(this.cursorReaderOptions);
          const live: Array<"create" | "change" | "delete"> = ["create", "change", "delete"];
          return [
            { baseDir: chats, glob: "**/meta.json", events: live, agent: "cursor" },
            { baseDir: chats, glob: "**/store.db", events: ["create", "delete"], agent: "cursor" },
            { baseDir: path.dirname(ide), glob: path.basename(ide), events: live, agent: "cursor" },
            { baseDir: path.dirname(ide), glob: `${path.basename(ide)}-wal`, events: live, agent: "cursor" },
          ];
        },
        // Cursor ids are opaque locators its own reader resolves, never
        // interpolated into a glob here, so no glob-safety guard applies.
        sessionWatchTargets: async (sessionId) =>
          (await resolveCursorSessionWatchPaths(sessionId, this.cursorReaderOptions)).map((sourcePath) => ({
            baseDir: path.dirname(sourcePath),
            glob: path.basename(sourcePath),
          })),
      },
    };
    // The per-capability deps stay the injection seam they always were: supplying
    // one REPLACES that capability for every agent, so an absent renamer in an
    // injected `nativeRenamers` still means "this agent cannot rename".
    this.adapters = Object.fromEntries(
      VAULT_AGENT_IDS.map((id) => [
        id,
        {
          ...base[id],
          ...(deps.readers ? { list: deps.readers[id] } : {}),
          ...(deps.detailReaders ? { detail: deps.detailReaders[id] } : {}),
          ...(deps.entryReaders
            ? {
                // The seam stays `VaultSessionEntry | null` so every injected reader
                // keeps working unchanged; wrapping here is what widening it would
                // have cost every caller (tell-an-absent-session… 1_1).
                entry: async (sessionId: string): Promise<VaultEntryLookup> => {
                  const injected = await deps.entryReaders?.[id](sessionId);
                  return injected ? { status: "found", entry: injected } : { status: "unknown" };
                },
              }
            : {}),
          ...(deps.recordReaders ? { record: deps.recordReaders[id] } : {}),
          ...(deps.nativeRenamers ? { renameNative: deps.nativeRenamers[id] } : {}),
          ...definedRequiredCapabilities(deps.adapters?.[id]),
        },
      ]),
    ) as Record<VaultAgentId, VaultAgentAdapter>;
    this.canForkOpenCodeFn = deps.canForkOpenCodeFn ?? ((min) => canForkOpenCode(min));
    this.cacheStore = deps.cacheStore;
    this.customNames = deps.customNames;
    this.resolveCursorLaunchTargetFn = deps.resolveCursorLaunchTargetFn ?? resolveCursorLaunchTarget;
    this.verifyCursorLaunchTargetFn = deps.verifyCursorLaunchTargetFn ?? verifyCursorLaunchTarget;
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
    const renamer = this.adapters[parsed.agent].renameNative;
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
  private async readAll(
    prev: VaultListCacheFileV1 | null,
    hint?: VaultRefreshHint,
    onReaderStart?: (id: VaultAgentId) => void,
  ): Promise<{
    result: VaultListResult;
    doc: VaultListCacheFileV1;
  }> {
    const prevAgents = prev?.agents ?? {};
    const ids: readonly VaultAgentId[] = hint ? [hint.agent] : VAULT_AGENT_IDS;
    const targetPrefix = hint ? `${agentLabel(hint.agent)}: ` : null;
    const removedReasons = targetPrefix
      ? (prev?.unreadable.reasons.filter((reason) => reason.startsWith(targetPrefix)) ?? [])
      : [];
    const entries: VaultSessionEntry[] = hint
      ? (prev?.entries.filter((entry) => entry.agent !== hint.agent) ?? [])
      : [];
    let unreadable = hint
      ? Math.max(0, (prev?.unreadable.count ?? 0) - removedReasons.reduce(priorUnreadableContribution, 0))
      : 0;
    const reasons: string[] = hint
      ? (prev?.unreadable.reasons.filter((reason) => !reason.startsWith(targetPrefix ?? "")) ?? [])
      : [];
    const agents: Partial<Record<VaultAgentId, ReaderListCache>> = hint ? { ...prevAgents } : {};
    const settled = await Promise.allSettled(
      ids.map((id) =>
        invokeReader(() => {
          onReaderStart?.(id);
          return this.adapters[id].list(prevAgents[id], hint ? { paths: hint.paths } : undefined);
        }),
      ),
    );

    settled.forEach((r, i) => {
      const id = ids[i];
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

    // A targeted run keeps untouched capability state too; only a refreshed
    // OpenCode segment needs the external version probe again.
    const resolvesOpenCode = !hint || hint.agent === "opencode";
    const hasOpenCode = resolvesOpenCode && entries.some((e) => e.agent === "opencode");
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
      if (!hint || entry.agent === hint.agent) {
        entry.canFork = resolveCanFork(entry, opencodeCanFork);
      }
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
   * and return the fresh list (cache-vault-load D1/D2). Complete reads remain
   * single-flight. Hinted reads replace one cached agent segment; hints arriving
   * during hinted I/O merge into one bounded follow-up, with cross-agent overlap
   * promoted to a complete refresh. Writes are awaited before later work starts.
   */
  async refresh(opts?: { force?: boolean; hint?: VaultRefreshHint }): Promise<VaultListResult> {
    if (opts?.force) {
      return this.forceRefresh();
    }

    const hint = opts?.hint;
    if (this.forceBarrier || this.postForceRefresh) {
      return this.queueBehindForce(hint);
    }

    if (!hint) {
      if (this.pendingRefresh) {
        this.pendingCompleteRefresh = true;
        this.pendingHint = null;
        return this.pendingRefresh;
      }
      if (!this.inflightRefresh) {
        return this.startRefresh();
      }
      if (this.inflightRefreshKind === "complete") {
        return this.inflightRefresh;
      }
      this.pendingCompleteRefresh = true;
      this.pendingHint = null;
      return this.ensurePendingRefresh();
    }

    if (this.pendingRefresh) {
      this.queueHint(hint);
      return this.pendingRefresh;
    }
    if (!this.inflightRefresh) {
      return this.startRefresh(hint);
    }
    if (this.inflightCoversHint(hint)) {
      return this.inflightRefresh;
    }

    this.queueHint(hint);
    return this.ensurePendingRefresh();
  }

  private inflightCoversHint(hint: VaultRefreshHint): boolean {
    return (
      !this.inflightHintReadStarted &&
      this.inflightHintAgent === hint.agent &&
      this.inflightHintPaths !== null &&
      hint.paths.every((changedPath) => this.inflightHintPaths?.has(changedPath))
    );
  }

  private queueHint(hint: VaultRefreshHint): void {
    if (this.pendingCompleteRefresh) {
      return;
    }
    if (this.inflightRefreshKind === "hinted" && this.inflightHintAgent !== hint.agent) {
      this.pendingHint = null;
      this.pendingCompleteRefresh = true;
      return;
    }
    if (!this.pendingHint) {
      const paths = new Set(hint.paths);
      if (paths.size > MAX_PENDING_VAULT_REFRESH_PATHS) {
        this.pendingCompleteRefresh = true;
        return;
      }
      this.pendingHint = { agent: hint.agent, paths };
      return;
    }
    if (this.pendingHint.agent !== hint.agent) {
      this.pendingHint = null;
      this.pendingCompleteRefresh = true;
      return;
    }
    for (const changedPath of hint.paths) {
      this.pendingHint.paths.add(changedPath);
      if (this.pendingHint.paths.size > MAX_PENDING_VAULT_REFRESH_PATHS) {
        this.pendingHint = null;
        this.pendingCompleteRefresh = true;
        return;
      }
    }
  }

  private forceRefresh(): Promise<VaultListResult> {
    const previousBarrier = this.forceBarrier;
    const barrier = (async (): Promise<VaultListResult> => {
      if (previousBarrier) {
        await previousBarrier.catch(() => {});
      }
      while (this.inflightRefresh || this.pendingRefresh) {
        const earlier = this.pendingRefresh ?? this.inflightRefresh;
        await earlier?.catch(() => {});
      }
      return this.startRefresh();
    })();
    this.forceBarrier = barrier;
    const clearBarrier = () => {
      if (this.forceBarrier === barrier) {
        this.forceBarrier = null;
      }
    };
    void barrier.then(clearBarrier, clearBarrier);
    return barrier;
  }

  private queueBehindForce(hint?: VaultRefreshHint): Promise<VaultListResult> {
    if (!hint) {
      this.postForceCompleteRefresh = true;
      this.postForceHint = null;
    } else if (!this.postForceCompleteRefresh) {
      if (!this.postForceHint) {
        const paths = new Set(hint.paths);
        if (paths.size > MAX_PENDING_VAULT_REFRESH_PATHS) {
          this.postForceCompleteRefresh = true;
        } else {
          this.postForceHint = { agent: hint.agent, paths };
        }
      } else if (this.postForceHint.agent !== hint.agent) {
        this.postForceHint = null;
        this.postForceCompleteRefresh = true;
      } else {
        for (const changedPath of hint.paths) {
          this.postForceHint.paths.add(changedPath);
          if (this.postForceHint.paths.size > MAX_PENDING_VAULT_REFRESH_PATHS) {
            this.postForceHint = null;
            this.postForceCompleteRefresh = true;
            break;
          }
        }
      }
    }

    if (this.postForceRefresh) {
      return this.postForceRefresh;
    }
    const pending = (async (): Promise<VaultListResult> => {
      while (this.forceBarrier) {
        const barrier = this.forceBarrier;
        await barrier.catch(() => {});
      }
      const complete = this.postForceCompleteRefresh;
      const queuedHint = this.postForceHint;
      this.postForceCompleteRefresh = false;
      this.postForceHint = null;
      this.postForceRefresh = null;
      return complete || !queuedHint
        ? this.startRefresh()
        : this.startRefresh({ agent: queuedHint.agent, paths: [...queuedHint.paths] });
    })();
    this.postForceRefresh = pending;
    const clearPending = () => {
      if (this.postForceRefresh === pending) {
        this.postForceRefresh = null;
      }
    };
    void pending.then(clearPending, clearPending);
    return pending;
  }

  private ensurePendingRefresh(): Promise<VaultListResult> {
    if (this.pendingRefresh) {
      return this.pendingRefresh;
    }
    const active = this.inflightRefresh;
    const pending = (async (): Promise<VaultListResult> => {
      if (active) {
        await active.catch(() => {});
      }
      while (this.inflightRefresh) {
        await this.inflightRefresh.catch(() => {});
      }

      if (this.pendingCompleteRefresh) {
        this.pendingHint = null;
        this.pendingCompleteRefresh = false;
        this.pendingRefresh = null;
        return this.startRefresh();
      }
      const hint = this.pendingHint;
      this.pendingHint = null;
      this.pendingRefresh = null;
      if (!hint) {
        return this.startRefresh();
      }
      return this.startRefresh({ agent: hint.agent, paths: [...hint.paths] });
    })();
    this.pendingRefresh = pending;
    const clearPending = () => {
      if (this.pendingRefresh === pending) {
        this.pendingRefresh = null;
      }
    };
    void pending.then(clearPending, clearPending);
    return pending;
  }

  private async startRefresh(hint?: VaultRefreshHint): Promise<VaultListResult> {
    this.ensureMemLoaded();
    const effectiveHint = this.mem ? hint : undefined;
    this.inflightRefreshKind = effectiveHint ? "hinted" : "complete";
    this.inflightHintAgent = hint?.agent ?? null;
    this.inflightHintPaths = hint ? new Set(hint.paths) : null;
    this.inflightHintReadStarted = false;
    const run = (async (): Promise<VaultListResult> => {
      const { result, doc } = await this.readAll(this.mem, effectiveHint, (id) => {
        if (id === hint?.agent) {
          this.inflightHintReadStarted = true;
        }
      });
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
      if (this.inflightRefresh === run) {
        this.inflightRefresh = null;
        this.inflightRefreshKind = null;
        this.inflightHintAgent = null;
        this.inflightHintPaths = null;
        this.inflightHintReadStarted = false;
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
    if (parsed.agent === "cursor") {
      const source = this.resolveCursorRequest(parsed.sessionId);
      if (!source) {
        return null;
      }
      const detail = await this.adapters.cursor.detail(source, clampDetailLimit(limit));
      // The child answers under the locator it was asked for; the project id it
      // resolves to stays host-side.
      return detail ? { ...detail, entryId } : null;
    }
    // Clamp the webview-supplied limit so a forged/garbage value can't defeat the
    // reader's timeline bound (W2).
    return this.adapters[parsed.agent].detail(parsed.sessionId, clampDetailLimit(limit));
  }

  /**
   * Mint the opaque locator for one resolved child transcript and remember what
   * it stands for. Derived from (parent, child, per-process salt) so repeated
   * parent reads re-issue the SAME locator; re-inserting also refreshes recency.
   */
  private issueCursorChildLocator(child: {
    parentSessionId: string;
    childAgentId: string;
    projectSessionId: string;
  }): string {
    const token = createHash("sha256")
      .update(`${this.cursorChildSalt}\0${child.parentSessionId}\0${child.childAgentId}`)
      .digest("hex")
      .slice(0, 32);
    const sessionId = `${CURSOR_CHILD_PREFIX}${token}`;
    this.cursorChildLocators.delete(sessionId);
    this.cursorChildLocators.set(sessionId, child.projectSessionId);
    for (const stale of this.cursorChildLocators.keys()) {
      if (this.cursorChildLocators.size <= MAX_CURSOR_CHILD_LOCATORS) {
        break;
      }
      this.cursorChildLocators.delete(stale);
    }
    return sessionId;
  }

  /**
   * Map a requested Cursor session id to the id the reader may open. A child
   * locator resolves only from the registry above; a raw `project:` id is refused
   * outright — project transcripts are never top-level rows, so nothing legitimate
   * asks for one by name, and honouring it would publish the orphans the list
   * deliberately hides (D12).
   */
  private resolveCursorRequest(sessionId: string): string | null {
    if (sessionId.startsWith(CURSOR_CHILD_PREFIX)) {
      const target = this.cursorChildLocators.get(sessionId);
      if (target === undefined) {
        return null;
      }
      this.cursorChildLocators.delete(sessionId);
      this.cursorChildLocators.set(sessionId, target);
      return target;
    }
    return sessionId.startsWith("project:") ? null : sessionId;
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
    return this.adapters[parsed.agent].record(parsed.sessionId, msgRef);
  }

  /**
   * Resolve ONE launch entry by id — the fast path for resume/fork. Reads only
   * the relevant agent's store via a point/locate-by-id lookup (no aggregate
   * `list()` over every store, no fork probe for agents other than opencode), so
   * launching is not gated on scanning the full session index. Mirrors getDetail
   * (resolve-by-id, no cache; D3). Returns null for an unknown agent or an
   * unresolvable session. canFork is resolved the same way as in list().
   */
  async lookupEntry(entryId: string): Promise<VaultEntryLookup> {
    const parsed = parseEntryId(entryId);
    if (!parsed || !isVaultAgentId(parsed.agent)) {
      return { status: "absent" };
    }
    let found: VaultEntryLookup;
    if (parsed.agent === "cursor") {
      const source = this.resolveCursorRequest(parsed.sessionId);
      // A child locator this process cannot decode is NOT proof the session is
      // gone: the registry is per-process and evicts its oldest key on capacity,
      // so a miss can be a restart or an eviction while the transcript survives.
      found = source ? await this.adapters.cursor.entry(source) : { status: "unknown" };
      if (found.status === "found" && source !== parsed.sessionId) {
        found = { status: "found", entry: { ...found.entry, id: entryId, sessionId: parsed.sessionId } };
      }
    } else {
      found = await this.adapters[parsed.agent].entry(parsed.sessionId);
    }
    if (found.status !== "found") {
      return found;
    }
    const entry = found.entry;
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
    return { status: "found", entry };
  }

  /** The launchable-entry-or-nothing view of `lookupEntry`, unchanged for every
   *  caller: both inconclusive statuses collapse back to `null`, including the
   *  synthetic nesting ids `vault-session-launch` requires it to reject. */
  async getEntry(entryId: string): Promise<VaultSessionEntry | null> {
    const found = await this.lookupEntry(entryId);
    return found.status === "found" ? found.entry : null;
  }

  /**
   * One launch resolution per explicit action (B17). Only a Cursor CLI entry has
   * a deferred store identity — list indexing never opens `store.db`, so
   * `canResume` is a candidate, not a proof — and its target carries the resolved
   * store path so the proof cannot re-discover a different candidate. Every other
   * agent's Resume identity IS its sessionId, trusted by construction, so its
   * verify is a pass-through.
   */
  async getLaunchTarget(entryId: string): Promise<VaultLaunchTarget | null> {
    const parsed = parseEntryId(entryId);
    if (!parsed || !isVaultAgentId(parsed.agent)) {
      return null;
    }
    if (parsed.agent !== "cursor") {
      const entry = await this.getEntry(entryId);
      return entry ? { entry, verify: async () => true } : null;
    }
    const target = await this.resolveCursorLaunchTargetFn(parsed.sessionId, this.cursorReaderOptions);
    if (!target) {
      return null;
    }
    target.entry.canFork = resolveCanFork(target.entry, false);
    return {
      entry: target.entry,
      verify: () => this.verifyCursorLaunchTargetFn(target, this.cursorReaderOptions),
    };
  }

  /**
   * Store-wide FS-watch targets for auto-refresh (enhance-vault-sessions D4):
   * agent session roots scoped to their stores (never all of $HOME). WAL
   * DBs are matched with a `<db>*` glob so `-wal`/`-shm` writes are seen too.
   * Change-aware `subscribePattern` (task 1_3) is required — vault sessions grow
   * by APPEND, which the create/delete-only `subscribe` drops.
   */
  getStoreWatchTargets(): VaultWatchTarget[] {
    return VAULT_AGENT_IDS.flatMap((id) => this.adapters[id].storeWatchTargets?.() ?? []);
  }

  /**
   * Per-session FS-watch targets for live-follow (enhance-vault-sessions D5),
   * scoped to the ONE previewed session so unrelated writes don't wake the
   * follow re-read. Each adapter owns where its own content lives and, when it
   * builds a glob from the id, whether that id is safe to interpolate.
   * Returns `[]` for an unknown agent or one that declares no session watch.
   */
  async resolveSessionWatchTargets(entryId: string): Promise<VaultWatchTarget[]> {
    const parsed = parseEntryId(entryId);
    if (!parsed || !isVaultAgentId(parsed.agent)) {
      return [];
    }
    return (await this.adapters[parsed.agent].sessionWatchTargets?.(parsed.sessionId)) ?? [];
  }
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

function priorUnreadableContribution(total: number, reason: string): number {
  if (reason.includes("reader failed")) {
    return total + 1;
  }
  const count = reason.match(/: (\d+) sessions? couldn't be read$/)?.[1];
  return total + (count ? Number(count) : 0);
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
