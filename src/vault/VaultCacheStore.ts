// src/vault/VaultCacheStore.ts — Persist the vault session list to a single
// owner-only JSON sidecar so the panel can display instantly on open
// (cache-vault-load design.md D4).
//
// Mirrors the proven SessionStorage pattern: atomic temp+rename writes, a
// version-guarded load that treats anything unrecognized as a cache miss, and
// `0o600`/`0o700` modes (the at-rest mitigation for the bounded title + cwd we
// persist — see design.md D5). The cache is NON-AUTHORITATIVE: every open still
// follows the cached render with a source-of-truth refresh, so a discarded or
// stale cache only costs one slower open, never correctness.

import * as path from "node:path";
import type * as vscode from "vscode";
import type { FsLike } from "../session/SessionStorage";
import {
  isSafeCursorChatId,
  isValidCursorLocationIndex,
  MAX_CURSOR_IDE_CACHE_ENTRIES,
  MAX_CURSOR_IDE_SOURCE_STAMPS,
  MAX_CURSOR_PROJECT_CACHE_ENTRIES,
  VAULT_CACHE_VERSION,
  type VaultListCacheFileV1,
} from "./cacheTypes";
import type { VaultSessionEntry } from "./types";

/** Minimal shape check on a persisted entry so a tampered/garbled cache element
 *  can't reach the webview and throw in render/signature (a poisoned `sessionPath`
 *  is harmless — actions always re-resolve paths by id host-side — but a non-string
 *  `title` would crash `.toLowerCase()` in search). Any malformed entry voids the
 *  whole cache → full rebuild. */
function isValidCachedEntry(e: unknown): e is VaultSessionEntry {
  if (!e || typeof e !== "object") {
    return false;
  }
  const v = e as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.agent === "string" &&
    typeof v.sessionId === "string" &&
    typeof v.title === "string" &&
    typeof v.cwd === "string" &&
    typeof v.modified === "number" &&
    !("timeline" in v) &&
    !("recentActivity" in v) &&
    !("contentKind" in v) &&
    !("limitedReason" in v) &&
    !("stats" in v) &&
    typeof v.canFork === "boolean" &&
    (v.canResume === undefined || typeof v.canResume === "boolean") &&
    (v.source === undefined || v.source === "cli" || v.source === "ide") &&
    typeof v.flags === "object" &&
    v.flags !== null &&
    (v.sessionPath === undefined || typeof v.sessionPath === "string")
  );
}

/** A finite, JSON-real number — guards stamp fields a tampered/torn cache could
 *  set to null/NaN/string, which would later break freshness math. */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** A `(mtimeMs,size)` stamp with both fields present and finite. */
function isValidStamp(s: unknown): boolean {
  if (!s || typeof s !== "object") {
    return false;
  }
  const v = s as Record<string, unknown>;
  return isFiniteNumber(v.mtimeMs) && isFiniteNumber(v.size);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isValidCursorEntry(
  value: unknown,
  sessionId: string,
  source: "cli" | "ide" | undefined,
  canResume: boolean,
): value is VaultSessionEntry {
  if (!isValidCachedEntry(value)) {
    return false;
  }
  return (
    value.agent === "cursor" &&
    value.id === `cursor:${sessionId}` &&
    value.sessionId === sessionId &&
    value.source === source &&
    value.canResume === canResume &&
    value.canFork === false
  );
}

function isValidCursorProjects(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_CURSOR_PROJECT_CACHE_ENTRIES) {
    return false;
  }
  for (const [filePath, cached] of entries) {
    if (!path.isAbsolute(filePath) || filePath.length > 16 * 1024 || !isRecord(cached) || !isValidStamp(cached.stamp)) {
      return false;
    }
    const sessionId =
      isRecord(cached.entry) && typeof cached.entry.sessionId === "string" ? cached.entry.sessionId : "";
    if (!sessionId.startsWith("project:") || !isValidCursorEntry(cached.entry, sessionId, undefined, false)) {
      return false;
    }
  }
  return true;
}

function isValidCursorIde(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.sources) || !Array.isArray(value.entries)) {
    return false;
  }
  const sources = Object.entries(value.sources);
  if (sources.length > MAX_CURSOR_IDE_SOURCE_STAMPS) {
    return false;
  }
  for (const [filePath, stamp] of sources) {
    if (!path.isAbsolute(filePath) || filePath.length > 16 * 1024 || !isValidStamp(stamp)) {
      return false;
    }
  }
  if (
    value.entries.length > MAX_CURSOR_IDE_CACHE_ENTRIES ||
    !value.entries.every((entry) => {
      const sessionId = isRecord(entry) && typeof entry.sessionId === "string" ? entry.sessionId : "";
      return sessionId.startsWith("ide:") && isValidCursorEntry(entry, sessionId, "ide", false);
    })
  ) {
    return false;
  }
  return Number.isSafeInteger(value.unreadable) && (value.unreadable as number) >= 0;
}

/**
 * Validate one agent's persisted freshness state against the `ReaderListCache`
 * union. A malformed blob (e.g. `{kind:"store", sources:null}`) must NOT be handed
 * back to a reader as `prev`: it would throw inside `sameStamps`/`Object.keys`,
 * failing the whole reader — which then drops that agent from the list (review
 * round-2 F2). Any failure here voids the ENTIRE cache → full rebuild, matching the
 * per-entry policy. An empty `agents` object is valid (nothing cached yet).
 */
function isValidReaderCache(c: unknown): boolean {
  if (!c || typeof c !== "object") {
    return false;
  }
  const v = c as Record<string, unknown>;
  if (v.kind === "files") {
    if (!v.files || typeof v.files !== "object") {
      return false;
    }
    for (const rec of Object.values(v.files as Record<string, unknown>)) {
      if (!rec || typeof rec !== "object") {
        return false;
      }
      const r = rec as Record<string, unknown>;
      if (!isValidStamp(r.stamp) || !isValidCachedEntry(r.entry)) {
        return false;
      }
    }
    return true;
  }
  if (v.kind === "store") {
    if (!v.sources || typeof v.sources !== "object") {
      return false;
    }
    for (const st of Object.values(v.sources as Record<string, unknown>)) {
      if (!isValidStamp(st)) {
        return false;
      }
    }
    return Array.isArray(v.entries) && v.entries.every(isValidCachedEntry) && isFiniteNumber(v.unreadable);
  }
  if (v.kind === "cursor-files") {
    if (!isRecord(v.chats) || !isValidCursorLocationIndex(v.locations)) {
      return false;
    }
    for (const [chatId, chat] of Object.entries(v.chats)) {
      if (
        !isSafeCursorChatId(chatId) ||
        !isRecord(chat) ||
        !isValidStamp(chat.metaStamp) ||
        typeof chat.dbPresent !== "boolean" ||
        !isValidCursorEntry(chat.entry, chatId, "cli", true)
      ) {
        return false;
      }
    }
    if (v.projects !== undefined && !isValidCursorProjects(v.projects)) {
      return false;
    }
    if (v.ide !== undefined && !isValidCursorIde(v.ide)) {
      return false;
    }
    if (v.unreadableById !== undefined) {
      if (
        !isRecord(v.unreadableById) ||
        !Object.values(v.unreadableById).every((count) => isFiniteNumber(count) && count >= 0)
      ) {
        return false;
      }
    }
    return v.rejected === undefined || (isFiniteNumber(v.rejected) && v.rejected >= 0);
  }
  return false; // unknown discriminant
}

/** Owner-only file mode on POSIX (macOS/Linux). NOTE: on Windows Node's `mode`
 *  argument does NOT set an owner-only ACL — the file inherits the parent
 *  (`globalStorageUri`, under the user profile) ACLs instead. The cache holds
 *  bounded titles + absolute cwds that MAY carry sensitive content (design.md D5);
 *  this is the SAME POSIX-only mitigation `SessionStorage` already uses [W5]. */
const CACHE_FILE_MODE = 0o600;
/** Owner-only directory mode (POSIX only — see {@link CACHE_FILE_MODE}). */
const CACHE_DIR_MODE = 0o700;

export class VaultCacheStore {
  private readonly cacheDir: string;
  private readonly cacheFile: string;
  /** Monotonic temp-id so concurrent writers never collide on the spool path. */
  private tempCounter = 0;

  constructor(
    globalStorageUri: vscode.Uri,
    private readonly fs: FsLike,
  ) {
    this.cacheDir = path.join(globalStorageUri.fsPath, "vault-cache");
    this.cacheFile = path.join(this.cacheDir, "list.json");
  }

  /**
   * Load the cached list synchronously (fast path for the first response). Returns
   * `null` — treated as "no cache", triggering a full rebuild — when the file is
   * missing, unreadable, unparseable, or carries an unrecognized `version`. Never
   * throws and never returns a partial document.
   */
  load(): VaultListCacheFileV1 | null {
    if (!this.fs.existsSync(this.cacheFile)) {
      return null;
    }
    try {
      const raw = this.fs.readFileSync(this.cacheFile, "utf8");
      const parsed = JSON.parse(raw) as Partial<VaultListCacheFileV1>;
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.version === VAULT_CACHE_VERSION &&
        Array.isArray(parsed.entries) &&
        parsed.entries.every(isValidCachedEntry) &&
        parsed.agents &&
        typeof parsed.agents === "object" &&
        Object.values(parsed.agents).every(isValidReaderCache) &&
        parsed.unreadable &&
        typeof parsed.unreadable === "object" &&
        Array.isArray(parsed.unreadable.reasons)
      ) {
        return parsed as VaultListCacheFileV1;
      }
    } catch {
      // Torn/corrupt/unreadable cache — treat as a miss (full rebuild). No
      // partial recovery: the refresh that follows is the source of truth.
    }
    return null;
  }

  /**
   * Persist the cache document. Atomic: `mkdir` → write `list.json.tmp.<n>` →
   * `rename` onto the canonical path (atomic on the same filesystem), so a reader
   * never observes a half-written file. Callers SHOULD `await` this (VaultService
   * does, inside its single-flight refresh) so writes stay ordered.
   */
  async save(doc: VaultListCacheFileV1): Promise<void> {
    await this.fs.promises.mkdir(this.cacheDir, { recursive: true, mode: CACHE_DIR_MODE });
    // Temp name is unique across processes (pid) AND within one process (counter).
    // `globalStorageUri` is shared by every VS Code window, so a per-instance
    // counter alone would collide between windows and lose a write (oracle review).
    const temp = `${this.cacheFile}.tmp.${process.pid}.${++this.tempCounter}`;
    await this.fs.promises.writeFile(temp, JSON.stringify(doc), { mode: CACHE_FILE_MODE });
    try {
      await this.renameWithRetry(temp, this.cacheFile);
    } catch (err) {
      // Commit failed for good — don't leave the spool file (it holds titles+cwds)
      // behind until the next activate's cleanup. Best-effort unlink, then rethrow
      // so VaultService.refresh logs the persist failure (review round-2 F-Win).
      await this.fs.promises.unlink(temp).catch(() => {});
      throw err;
    }
  }

  /**
   * `rename` onto the canonical path, retrying briefly on the transient lock errors
   * that are common on Windows (EPERM/EBUSY/EACCES) when another window, antivirus,
   * the search indexer, or a backup momentarily holds the destination open. POSIX
   * rename rarely hits these, so the retry is a no-op cost there. The original error
   * propagates after the final attempt (review round-2 F-Win).
   */
  private async renameWithRetry(from: string, to: string): Promise<void> {
    const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"]);
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        await this.fs.promises.rename(from, to);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (attempt >= MAX_ATTEMPTS || !code || !TRANSIENT.has(code)) {
          throw err;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 20 * attempt));
      }
    }
  }

  /**
   * Best-effort reaping of `list.json.tmp.*` files orphaned by a crash between
   * write and rename (or by a lost cross-window rename race). Each orphan is an
   * owner-readable file holding titles+cwds, so leaving them to accumulate widens
   * the at-rest footprint. Call once on activate. Mirrors SessionStorage.
   */
  cleanupOrphanTemps(): void {
    try {
      if (!this.fs.existsSync(this.cacheDir)) {
        return;
      }
      for (const name of this.fs.readdirSync(this.cacheDir)) {
        if (name.startsWith("list.json.tmp.")) {
          try {
            this.fs.unlinkSync(path.join(this.cacheDir, name));
          } catch {
            /* best-effort */
          }
        }
      }
    } catch {
      /* best-effort */
    }
  }
}
