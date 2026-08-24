// src/vault/cacheTypes.ts — Shared, JSON-serializable shapes for the vault list
// cache (cache-vault-load design.md D3, D4, Interfaces).
//
// The cache lets the panel display the last-known session list instantly on open
// and lets a refresh re-read ONLY the sources whose backing files changed. All
// types here are persisted verbatim to `<globalStorageUri>/vault-cache/list.json`,
// so they MUST stay JSON-round-trippable (no class instances, no undefined-only
// fields that matter).

import type { VaultAgentId, VaultSessionEntry } from "./types";

/** One backing file's identity for change detection (design.md D3). */
export interface FileStamp {
  mtimeMs: number;
  size: number;
}

/**
 * One cached Cursor chat: the `meta.json` stamp used for reuse, whether its
 * sibling `store.db` existed at read time (D3 — the DB's CONTENT is never
 * stamped, only its create/delete presence), and the derived entry. Excluded
 * (ineligible/unsupported/ambiguous) chats are never cached (integrate-cursor-agent D3).
 */
export interface CursorFileCacheEntry {
  metaStamp: FileStamp;
  dbPresent: boolean;
  entry: VaultSessionEntry;
}

/** Metadata-only cache for one independently listed project transcript. */
export interface CursorProjectCacheEntry {
  stamp: FileStamp;
  entry: VaultSessionEntry;
}

/** Metadata-only cache for the Cursor IDE global store. */
export interface CursorIdeCache {
  sources: Record<string /* state.vscdb and -wal absolute paths */, FileStamp>;
  entries: VaultSessionEntry[];
  unreadable: number;
}

export const CURSOR_CHAT_ID_RE = /^[A-Za-z0-9._-]{1,200}$/;
export const MAX_CURSOR_LOCATION_IDS = 4096;
export const MAX_CURSOR_LOCATION_BUCKETS = 8192;
export const MAX_CURSOR_PROJECT_CACHE_ENTRIES = 4096;
export const MAX_CURSOR_IDE_CACHE_ENTRIES = 4096;
export const MAX_CURSOR_IDE_SOURCE_STAMPS = 3;
const MAX_CURSOR_BUCKET_CHARS = 200;

export function isSafeCursorChatId(id: string): boolean {
  return CURSOR_CHAT_ID_RE.test(id) && !id.includes("..");
}

export function isSafeCursorBucketId(id: string): boolean {
  if (id.length === 0 || id.length > MAX_CURSOR_BUCKET_CHARS || id === "." || id === ".." || id.includes("/")) {
    return false;
  }
  for (let index = 0; index < id.length; index++) {
    const code = id.charCodeAt(index);
    if (id[index] === "\\" || code < 0x20 || code === 0x7f) {
      return false;
    }
  }
  return true;
}

/** Bounded, persisted map of every safe chat id to all known workspace buckets. */
export interface CursorLocationIndex {
  byId: Record<string, string[]>;
  /** A complete scan exceeded the persisted-state cap; targeted reads must rescan. */
  overflowed: boolean;
}

export function isValidCursorLocationIndex(value: unknown): value is CursorLocationIndex {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const location = value as Record<string, unknown>;
  if (
    typeof location.overflowed !== "boolean" ||
    !location.byId ||
    typeof location.byId !== "object" ||
    Array.isArray(location.byId)
  ) {
    return false;
  }
  const byId = location.byId as Record<string, unknown>;
  const entries = Object.entries(byId);
  if (location.overflowed) {
    return entries.length === 0;
  }
  if (entries.length > MAX_CURSOR_LOCATION_IDS) {
    return false;
  }
  let bucketCount = 0;
  for (const [chatId, buckets] of entries) {
    if (!isSafeCursorChatId(chatId) || !Array.isArray(buckets) || buckets.length === 0) {
      return false;
    }
    const unique = new Set<string>();
    for (const bucket of buckets) {
      if (typeof bucket !== "string" || !isSafeCursorBucketId(bucket) || unique.has(bucket)) {
        return false;
      }
      unique.add(bucket);
      bucketCount++;
      if (bucketCount > MAX_CURSOR_LOCATION_BUCKETS) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Per-agent persisted freshness state. Opaque to `VaultService` (which only
 * passes it back to the producing reader); shaped per reader:
 *
 * - `"files"` (Claude): one stamp + derived entry PER session file, so an
 *   unchanged file reuses its entry without re-reading the body (the 64 KB
 *   ai-title tail read is the dominant cost we skip).
 * - `"store"` (Codex / OpenCode): stamps for the store file(s) (`.db` + `-wal`,
 *   never `-shm` — volatile lock state) plus the cached entries, reused wholesale
 *   when the store is unchanged (skips the snapshot clone + query).
 * - `"cursor-files"` (Cursor): one `meta.json` stamp + `store.db` presence PER
 *   chat, so an unchanged chat with unchanged DB presence reuses its entry
 *   without re-parsing `meta.json` (integrate-cursor-agent D3).
 */
export interface ReaderRefreshHint {
  paths: readonly string[];
}

export interface VaultRefreshHint extends ReaderRefreshHint {
  agent: VaultAgentId;
}

export type ReaderListCache =
  | {
      kind: "files";
      files: Record<string /* absolute path */, { stamp: FileStamp; entry: VaultSessionEntry }>;
    }
  | {
      kind: "store";
      sources: Record<string /* absolute path */, FileStamp>;
      entries: VaultSessionEntry[];
      /** Unreadable count from the read that produced `entries`, carried so a
       *  reuse (skipping the query) preserves the partial-failure notice instead
       *  of silently reporting 0. */
      unreadable: number;
    }
  | {
      kind: "cursor-files";
      chats: Record<string /* chat id */, CursorFileCacheEntry>;
      locations: CursorLocationIndex;
      /** Independently listed project transcript metadata, keyed by absolute JSONL path. */
      projects?: Record<string, CursorProjectCacheEntry>;
      /** Cursor IDE list metadata keyed by the global SQLite source stamps. */
      ide?: CursorIdeCache;
      /** Per-safe-id accounting only; no rejected path is joined or read. */
      unreadableById?: Record<string /* safe chat id */, number>;
      rejected?: number;
    };

/** What an incremental list reader returns: the same `entries`/`unreadable` as
 *  before plus the freshness `cache` to persist for the next refresh. */
export interface ReaderResultWithState {
  entries: VaultSessionEntry[];
  unreadable: number;
  cache: ReaderListCache;
}

/**
 * The internal reader-map signature used by `VaultService` — prev-only. The
 * EXPORTED reader functions stay option-first (`readClaudeSessions(options?,
 * prev?)`) for back-compat; the service adapts them (`(prev) =>
 * readClaudeSessions({}, prev)`).
 */
export type ListReader = (prev?: ReaderListCache, hint?: ReaderRefreshHint) => Promise<ReaderResultWithState>;

/** Current on-disk cache schema version. Bump on any incompatible shape change —
 *  or on any change to how a cached ENTRY is DERIVED, since an unchanged file
 *  reuses its stored entry verbatim and would otherwise keep serving the old
 *  derivation forever. `VaultCacheStore.load` discards any other version (→ full
 *  rebuild). v6: Cursor entries include source-qualified CLI/IDE metadata and
 *  source-specific project/IDE freshness state. */
export const VAULT_CACHE_VERSION = 6 as const;

/** The persisted cache document (design.md D4). */
export interface VaultListCacheFileV1 {
  version: typeof VAULT_CACHE_VERSION;
  /** epoch ms when written — informational only. */
  savedAt: number;
  /** Per-agent freshness state for the next incremental refresh. */
  agents: Partial<Record<VaultAgentId, ReaderListCache>>;
  /** Merged + recency-sorted snapshot, served verbatim for instant render. */
  entries: VaultSessionEntry[];
  unreadable: { count: number; reasons: string[] };
}
