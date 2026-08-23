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
 * Per-agent persisted freshness state. Opaque to `VaultService` (which only
 * passes it back to the producing reader); shaped per reader:
 *
 * - `"files"` (Claude): one stamp + derived entry PER session file, so an
 *   unchanged file reuses its entry without re-reading the body (the 64 KB
 *   ai-title tail read is the dominant cost we skip).
 * - `"store"` (Codex / OpenCode): stamps for the store file(s) (`.db` + `-wal`,
 *   never `-shm` — volatile lock state) plus the cached entries, reused wholesale
 *   when the store is unchanged (skips the snapshot clone + query).
 */
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
export type ListReader = (prev?: ReaderListCache) => Promise<ReaderResultWithState>;

/** Current on-disk cache schema version. Bump on any incompatible shape change —
 *  or on any change to how a cached ENTRY is DERIVED, since an unchanged file
 *  reuses its stored entry verbatim and would otherwise keep serving the old
 *  derivation forever. `VaultCacheStore.load` discards any other version (→ full
 *  rebuild). v4: Claude `permissionMode` is now the session's latest recorded
 *  mode, not its first (improve-vault-session-detail D2). */
export const VAULT_CACHE_VERSION = 4 as const;

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
