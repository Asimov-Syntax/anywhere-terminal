// src/vault/readers/cursorReader.ts — Bounded Cursor CLI chat index/detail
// reader (integrate-cursor-agent design.md D3, D10, D11;
// specs/agent-session-index/spec.md discover-cursor-cli-chats /
// cursor-metadata-compatibility-profile / cursor-chat-eligibility /
// safe-cursor-chat-lookup / cursor-indexing-is-metadata-only;
// specs/vault-session-preview/spec.md cursor-metadata-only-session-detail).
//
// List indexing reads ONLY bounded `meta.json` metadata and stats (never opens)
// sibling `store.db`. An explicit detail request resolves the same validated chat
// and delegates to the bounded, WAL-aware root-graph decoder in cursorStore.ts.

import type { FileHandle } from "node:fs/promises";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  CursorFileCacheEntry,
  CursorLocationIndex,
  CursorProjectCacheEntry,
  FileStamp,
  ReaderListCache,
  ReaderRefreshHint,
  ReaderResultWithState,
} from "../cacheTypes";
import { boundedPreview } from "../preview";
import type { withSqliteSnapshot } from "../sqlite";
import { formatEntryId, type VaultSessionDetail, type VaultSessionEntry } from "../types";
import {
  type CursorIdeReaderOptions,
  cursorIdeDbPath,
  readCursorIdeDetail,
  readCursorIdeEntry,
  readCursorIdeSessions,
} from "./cursorIdeReader";
import {
  type CursorChatCandidate,
  type CursorFsDeps,
  type CursorReaderOptions,
  cursorChatsRoot,
  listCursorChatCandidates,
  resolveChangedCursorChatCandidates,
  resolveCursorChatCandidate,
} from "./cursorPaths";
import { readCursorStoreDetail } from "./cursorStore";
import { cursorProjectsRoot, readCursorTranscript, resolveCursorTranscriptCandidate } from "./cursorTranscript";
import type { RecordLineResult } from "./recordLine";

export type { CursorFsDeps, CursorPathFsDeps, CursorReaderOptions } from "./cursorPaths";

/** cursor-metadata-compatibility-profile bounds. */
export const MAX_META_BYTES = 64 * 1024;
const MAX_CWD_CHARS = 16 * 1024;

const PARTIAL_LIMITED_REASON = "Cursor transcript is unavailable for this store.";
const MAX_RECENT_ACTIVITY = 12;

export type CursorCombinedReaderOptions = CursorReaderOptions & CursorIdeReaderOptions;

export type CursorDetailReaderOptions = CursorCombinedReaderOptions & {
  /** Injectable only for focused decoder tests; production uses one WAL-aware snapshot. */
  withSqliteSnapshotFn?: typeof withSqliteSnapshot;
};

/** Real fs, wrapped to the narrow {@link CursorFsDeps} shape — the default
 *  when `options.fs` is not injected (tests only). */
const REAL_FS: CursorFsDeps = {
  stat: (p) => fs.stat(p),
  open: (p, flags) => fs.open(p, flags),
};

/** Stat + require a REGULAR FILE — a directory (or other non-file) at either
 *  `meta.json` or `store.db` must never be treated as present/readable. */
async function statFileOrNull(p: string, deps: CursorFsDeps): Promise<FileStamp | null> {
  try {
    const st = await deps.stat(p);
    return st.isFile() ? { mtimeMs: st.mtimeMs, size: st.size } : null;
  } catch {
    return null;
  }
}

/**
 * Read at most `maxBytes + 1` bytes and reject overflow — bounded by the READ
 * itself, not by a prior `stat().size` (which a growing/replaced file could
 * outrun between the stat and a follow-up `readFile`, TOCTOU). The handle is
 * always closed, and no more than `maxBytes + 1` bytes are ever materialized.
 */
async function readBoundedUtf8(filePath: string, maxBytes: number, deps: CursorFsDeps): Promise<string | undefined> {
  let handle: FileHandle | undefined;
  try {
    handle = await deps.open(filePath, "r");
    const buf = Buffer.alloc(maxBytes + 1);
    let total = 0;
    while (total < buf.length) {
      const { bytesRead } = await handle.read(buf, total, buf.length - total, total);
      if (bytesRead === 0) {
        break; // EOF
      }
      total += bytesRead;
    }
    if (total > maxBytes) {
      return undefined; // oversized, even if it grew after any earlier stat
    }
    return buf.subarray(0, total).toString("utf8");
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function sameStamp(a: FileStamp, b: FileStamp): boolean {
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** Absolute, control-character-free, ≤16 KiB (cursor-metadata-compatibility-profile). */
function isValidCwd(cwd: unknown): cwd is string {
  return (
    typeof cwd === "string" &&
    cwd.length > 0 &&
    cwd.length <= MAX_CWD_CHARS &&
    (cwd.startsWith("/") || /^[A-Za-z]:[\\/]/.test(cwd)) &&
    !hasControlChar(cwd)
  );
}

/** Finite non-negative safe integer, else the caller falls back to filesystem time. */
function isValidTimestamp(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

/** Parse `meta.json` into a plain object, or undefined on any read/parse/shape/size
 *  failure. The read itself — not a prior stat — enforces the 64 KiB bound. */
async function readMeta(
  candidate: CursorChatCandidate,
  deps: CursorFsDeps,
): Promise<Record<string, unknown> | undefined> {
  const raw = await readBoundedUtf8(candidate.metaPath, MAX_META_BYTES, deps);
  if (raw === undefined) {
    return undefined; // oversized (incl. grown after any earlier stat) or unreadable
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** True iff the parsed metadata is schema-1 and its `cwd` passes the compatibility profile. */
function isCompatibleMeta(meta: Record<string, unknown>): boolean {
  return meta.schemaVersion === 1 && isValidCwd(meta.cwd);
}

/** cursor-chat-eligibility: conversation present, not a subagent, sibling DB exists. */
function isEligible(meta: Record<string, unknown>, dbPresent: boolean): boolean {
  return meta.hasConversation === true && meta.isSubagent !== true && dbPresent;
}

/** Build the launch entry from validated schema-1 metadata. The safe chat-directory
 *  name is Cursor Agent's documented `--resume [chatId]` operand (D4). */
function mapCursorMeta(
  candidate: CursorChatCandidate,
  meta: Record<string, unknown>,
  metaStamp: FileStamp,
): VaultSessionEntry {
  const title = boundedPreview(typeof meta.title === "string" ? meta.title : "");
  const modified = isValidTimestamp(meta.updatedAtMs)
    ? meta.updatedAtMs
    : isValidTimestamp(meta.createdAtMs)
      ? meta.createdAtMs
      : metaStamp.mtimeMs;
  return {
    id: formatEntryId("cursor", candidate.chatId),
    agent: "cursor",
    sessionId: candidate.chatId,
    title,
    cwd: meta.cwd as string,
    modified,
    flags: {},
    canFork: false,
    canResume: true,
    source: "cli",
    // No sessionPath: the reader never surfaces a path into `store.db` (D3).
  };
}

async function readCandidate(
  candidate: CursorChatCandidate,
  cached: CursorFileCacheEntry | undefined,
  deps: CursorFsDeps,
): Promise<{ cached?: CursorFileCacheEntry; unreadable: number }> {
  const metaStamp = await statFileOrNull(candidate.metaPath, deps);
  if (!metaStamp) {
    return { unreadable: 1 };
  }
  const dbPresent = (await statFileOrNull(candidate.dbPath, deps)) !== null;
  if (cached && sameStamp(cached.metaStamp, metaStamp) && cached.dbPresent === dbPresent) {
    return { cached, unreadable: 0 };
  }
  const meta = await readMeta(candidate, deps);
  if (!meta || !isCompatibleMeta(meta)) {
    return { unreadable: 1 };
  }
  if (!isEligible(meta, dbPresent)) {
    return { unreadable: 0 };
  }
  const entry = mapCursorMeta(candidate, meta, metaStamp);
  return { cached: { metaStamp, dbPresent, entry }, unreadable: 0 };
}

function cursorResult(
  chats: Record<string, CursorFileCacheEntry>,
  locations: CursorLocationIndex,
  unreadableById: Record<string, number>,
  rejected: number,
  ide: { entries: VaultSessionEntry[]; unreadable: number; sources: Record<string, FileStamp> },
  projects: Record<string, CursorProjectCacheEntry> = {},
): ReaderResultWithState {
  const entries = [...Object.values(chats).map((chat) => chat.entry), ...ide.entries];
  const unreadable = ide.unreadable + rejected + Object.values(unreadableById).reduce((sum, count) => sum + count, 0);
  return {
    entries,
    unreadable,
    cache: {
      kind: "cursor-files",
      chats,
      locations,
      ide: { sources: ide.sources, entries: ide.entries, unreadable: ide.unreadable },
      projects,
      unreadableById,
      rejected,
    },
  };
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function cachedIde(prev: ReaderListCache | undefined): {
  entries: VaultSessionEntry[];
  unreadable: number;
  sources: Record<string, FileStamp>;
} {
  return prev?.kind === "cursor-files" && prev.ide
    ? { entries: prev.ide.entries, unreadable: prev.ide.unreadable, sources: prev.ide.sources }
    : { entries: [], unreadable: 0, sources: {} };
}

function cursorHintKinds(
  paths: readonly string[],
  options: CursorCombinedReaderOptions,
): Set<"cli" | "project" | "ide" | "unknown"> {
  const kinds = new Set<"cli" | "project" | "ide" | "unknown">();
  const chatsRoot = cursorChatsRoot(options);
  const projectsRoot = cursorProjectsRoot(options);
  const ideDb = cursorIdeDbPath(options);
  for (const changedPath of paths) {
    if (changedPath.length === 0 || changedPath.length > 16 * 1024 || !path.isAbsolute(changedPath)) {
      kinds.add("unknown");
    } else if (changedPath === ideDb || changedPath.startsWith(`${ideDb}-`)) {
      kinds.add("ide");
    } else if (isWithin(chatsRoot, changedPath)) {
      kinds.add("cli");
    } else if (isWithin(projectsRoot, changedPath)) {
      kinds.add("project");
    } else {
      kinds.add("unknown");
    }
  }
  return kinds;
}

/**
 * List eligible Cursor CLI chats (discover-cursor-cli-chats). With no hint this
 * performs the complete initial/manual scan. A watcher hint re-resolves only
 * affected safe ids and carries every unrelated cached chat forward untouched.
 */
export async function readCursorSessions(
  prev?: ReaderListCache,
  options: CursorCombinedReaderOptions = {},
  hint?: ReaderRefreshHint,
): Promise<ReaderResultWithState> {
  const deps = options.fs ?? REAL_FS;
  const prevCursor = prev?.kind === "cursor-files" ? prev : undefined;

  if (hint && prevCursor) {
    const kinds = cursorHintKinds(hint.paths, options);
    if (kinds.has("unknown") || (kinds.has("cli") && kinds.has("ide"))) {
      return readCursorSessions(prev, options);
    }
    if (kinds.has("ide")) {
      return cursorResult(
        prevCursor.chats,
        prevCursor.locations,
        prevCursor.unreadableById ?? {},
        prevCursor.rejected ?? 0,
        await readCursorIdeSessions(options),
        prevCursor.projects,
      );
    }
    if (kinds.has("project") || kinds.size === 0) {
      return cursorResult(
        prevCursor.chats,
        prevCursor.locations,
        prevCursor.unreadableById ?? {},
        prevCursor.rejected ?? 0,
        cachedIde(prevCursor),
        prevCursor.projects,
      );
    }
    const { groups, locations, metaChanged, requiresFullScan } = await resolveChangedCursorChatCandidates(
      hint.paths,
      prevCursor.locations,
      options,
    );
    if (requiresFullScan || !locations) {
      return readCursorSessions(prev, options);
    }
    const chats = { ...prevCursor.chats };
    const unreadableById = { ...(prevCursor.unreadableById ?? {}) };
    for (const [chatId, group] of Object.entries(groups)) {
      const cached = chats[chatId];
      delete chats[chatId];
      delete unreadableById[chatId];
      if (group.length > 1) {
        unreadableById[chatId] = group.length;
        continue;
      }
      if (group.length === 0) {
        continue;
      }
      const next = await readCandidate(group[0], metaChanged.has(chatId) ? undefined : cached, deps);
      if (next.cached) {
        chats[chatId] = next.cached;
      }
      if (next.unreadable > 0) {
        unreadableById[chatId] = next.unreadable;
      }
    }
    return cursorResult(
      chats,
      locations,
      unreadableById,
      prevCursor.rejected ?? 0,
      cachedIde(prevCursor),
      prevCursor.projects,
    );
  }

  const { candidates, ambiguousById, locations, rejected } = await listCursorChatCandidates(options);
  const prevChats = prevCursor?.chats ?? {};
  const chats: Record<string, CursorFileCacheEntry> = {};
  const unreadableById = { ...ambiguousById };
  for (const candidate of candidates) {
    const next = await readCandidate(candidate, prevChats[candidate.chatId], deps);
    if (next.cached) {
      chats[candidate.chatId] = next.cached;
    }
    if (next.unreadable > 0) {
      unreadableById[candidate.chatId] = next.unreadable;
    }
  }
  return cursorResult(chats, locations, unreadableById, rejected, await readCursorIdeSessions(options));
}

/**
 * Resolve ONE Cursor chat to its launch entry by id — the point-lookup
 * counterpart to readCursorSessions (safe-cursor-chat-lookup). Returns null for
 * an unsafe/ambiguous id, incompatible/malformed metadata, or an ineligible chat.
 */
export async function readCursorEntry(
  sessionId: string,
  options: CursorCombinedReaderOptions = {},
): Promise<VaultSessionEntry | null> {
  if (sessionId.startsWith("ide:")) {
    return readCursorIdeEntry(sessionId, options);
  }
  const candidate = await resolveCursorChatCandidate(sessionId, options);
  if (!candidate) {
    return null;
  }
  const deps = options.fs ?? REAL_FS;
  const metaStamp = await statFileOrNull(candidate.metaPath, deps);
  if (!metaStamp) {
    return null;
  }
  const meta = await readMeta(candidate, deps);
  if (!meta || !isCompatibleMeta(meta)) {
    return null;
  }
  const dbPresent = (await statFileOrNull(candidate.dbPath, deps)) !== null;
  if (!isEligible(meta, dbPresent)) {
    return null;
  }
  return mapCursorMeta(candidate, meta, metaStamp);
}

/** Explicit detail decoding is isolated from metadata-only list refreshes. Any
 * private-schema drift or bounded-read failure degrades to an empty partial view. */
export async function readCursorDetail(
  sessionId: string,
  limit?: number,
  options: CursorDetailReaderOptions = {},
): Promise<VaultSessionDetail | null> {
  if (sessionId.startsWith("ide:")) {
    return readCursorIdeDetail(sessionId, limit, options);
  }
  const entry = await readCursorEntry(sessionId, options);
  if (!entry) {
    return null;
  }
  const candidate = await resolveCursorChatCandidate(sessionId, options);
  if (!candidate) {
    return null;
  }

  const store = await readCursorStoreDetail(candidate.dbPath, sessionId, {
    withSqliteSnapshotFn: options.withSqliteSnapshotFn,
  });
  let decoded = store;
  let sourceTruncated = false;
  if (store.status === "limited") {
    const transcriptCandidate = await resolveCursorTranscriptCandidate(sessionId, options);
    if (transcriptCandidate) {
      const transcript = await readCursorTranscript(transcriptCandidate, options);
      if (transcript.status === "ok") {
        decoded = {
          status: "ok",
          timeline: transcript.timeline,
          recentActivity: transcript.recentActivity,
          stats: transcript.stats,
        };
        sourceTruncated = transcript.truncated;
      }
    }
  }
  if (decoded.status === "limited") {
    return {
      entryId: entry.id,
      recentActivity: [],
      timeline: [],
      stats: { messageCount: 0, toolCount: 0, subagentCount: 0 },
      partial: true,
      limitedReason: decoded.reason || PARTIAL_LIMITED_REASON,
      contentKind: "metadata-only",
    };
  }

  const maxItems = typeof limit === "number" && Number.isSafeInteger(limit) && limit >= 0 ? limit : undefined;
  const timeline = maxItems === undefined ? decoded.timeline : maxItems === 0 ? [] : decoded.timeline.slice(-maxItems);
  return {
    entryId: entry.id,
    recentActivity: decoded.recentActivity.slice(-MAX_RECENT_ACTIVITY),
    timeline,
    stats: decoded.stats,
    partial: false,
    truncated: sourceTruncated || (maxItems !== undefined && decoded.timeline.length > maxItems),
    contentKind: "timeline",
  };
}

/** Cursor timelines intentionally omit `msgRef`: the private SQLite/protobuf
 * envelope is never exposed as a raw-record copy target. */
export async function readCursorMessageRecord(_sessionId: string, _msgRef: string): Promise<RecordLineResult> {
  return { ok: false, reason: "not-found" };
}
