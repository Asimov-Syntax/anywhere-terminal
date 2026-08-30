// src/vault/readers/cursorPaths.ts — Cursor CLI chat-root scanning, chat-id
// safety, containment-checked path resolution, and duplicate-id grouping
// (integrate-cursor-agent design.md D3, specs/agent-session-index/spec.md
// discover-cursor-cli-chats / safe-cursor-chat-lookup).
//
// The host NEVER trusts a webview-supplied path or id: every chat is located
// by scanning `~/.cursor/chats/<bucket>/<chat-id>/` and each candidate path is
// containment-checked under the chats root before it is read.

import type { Dirent } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { provesAbsence } from "../../utils/fsPresence";
import {
  type CursorLocationIndex,
  isSafeCursorBucketId,
  isSafeCursorChatId,
  isValidCursorLocationIndex,
  MAX_CURSOR_LOCATION_BUCKETS,
  MAX_CURSOR_LOCATION_IDS,
} from "../cacheTypes";

export { CURSOR_CHAT_ID_RE, isSafeCursorChatId } from "../cacheTypes";

/**
 * Injectable `stat`/`open` seam for cursorReader's OWN bounded `meta.json`
 * access (list + point lookup). `cursorPaths` itself always scans directories
 * with the real fs — this exists only so tests can exercise TOCTOU and
 * store.db-untouched behavior with plain pass-through functions, portable to
 * both Vitest and Bun's test runner (neither `vi.mock` nor `vi.importActual`
 * — ESM module-mock hoisting — is available under `bun test`).
 */
export interface CursorFsDeps {
  stat: (p: string) => Promise<{ isFile(): boolean; mtimeMs: number; size: number }>;
  open: (p: string, flags: string) => Promise<FileHandle>;
}

export interface CursorPathFsDeps {
  readdir: (p: string, options: { withFileTypes: true }) => Promise<Dirent[]>;
  stat: (p: string) => Promise<{ isDirectory(): boolean }>;
  lstat?: (p: string) => Promise<{ isDirectory(): boolean; isSymbolicLink(): boolean }>;
}

export interface CursorReaderOptions {
  /** Home dir; defaults to `os.homedir()`. */
  home?: string;
  /** Override the resolved `~/.cursor/chats` root (tests). */
  chatsDir?: string;
  /** Override the resolved `~/.cursor/projects` root (tests/detail fallback). */
  projectsDir?: string;
  /** Injectable stat/open for the reader's bounded meta.json/store.db access. */
  fs?: CursorFsDeps;
  /** Injectable directory seam used to prove targeted reads avoid root scans. */
  pathsFs?: CursorPathFsDeps;
}

const REAL_PATH_FS: CursorPathFsDeps = {
  readdir: (p, options) => fs.readdir(p, options),
  stat: (p) => fs.stat(p),
  lstat: (p) => fs.lstat(p),
};

export function cursorChatsRoot(options: CursorReaderOptions = {}): string {
  if (options.chatsDir) {
    return options.chatsDir;
  }
  const home = options.home ?? os.homedir();
  return path.join(home, ".cursor", "chats");
}

/** One located, containment-checked Cursor chat directory. */
export interface CursorChatCandidate {
  chatId: string;
  bucket: string;
  dir: string;
  metaPath: string;
  dbPath: string;
}

/** `complete` is false when the directory could not be listed for a reason that
 *  does not prove it is missing — the caller then cannot claim it enumerated
 *  everything (tell-an-absent-session-from-an-unknown-one D4). */
async function listDirNames(dir: string, deps: CursorPathFsDeps): Promise<{ names: string[]; complete: boolean }> {
  try {
    const entries = await deps.readdir(dir, { withFileTypes: true });
    return {
      names: entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(),
      complete: true,
    };
  } catch (err) {
    // A missing root/bucket contributes zero entries and is still a complete
    // answer; anything else means this process could not look.
    return { names: [], complete: provesAbsence(err) };
  }
}

async function isDirectory(dir: string, deps: CursorPathFsDeps): Promise<boolean> {
  try {
    return (await deps.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Scan every workspace bucket under the chats root and group the resulting
 * chat-id candidates. A chat id that resolves under more than one bucket is
 * AMBIGUOUS: every candidate sharing that id is omitted from the returned
 * list and counted in `ambiguous` (safe-cursor-chat-lookup — omitted from
 * both list and point lookup, never guessed). A missing chats root or bucket
 * contributes zero candidates without failing the scan (discover-cursor-cli-chats).
 */
function makeCandidate(root: string, bucket: string, chatId: string): CursorChatCandidate | null {
  if (!isSafeCursorBucketId(bucket) || !isSafeCursorChatId(chatId)) {
    return null;
  }
  const dir = path.join(root, bucket, chatId);
  const rel = path.relative(root, dir);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return {
    chatId,
    bucket,
    dir,
    metaPath: path.join(dir, "meta.json"),
    dbPath: path.join(dir, "store.db"),
  };
}

function locationIndexFromCandidates(byId: ReadonlyMap<string, readonly CursorChatCandidate[]>): CursorLocationIndex {
  if (byId.size > MAX_CURSOR_LOCATION_IDS) {
    return { byId: {}, overflowed: true };
  }
  const locations: Record<string, string[]> = {};
  let bucketCount = 0;
  for (const [chatId, candidates] of byId) {
    bucketCount += candidates.length;
    if (bucketCount > MAX_CURSOR_LOCATION_BUCKETS) {
      return { byId: {}, overflowed: true };
    }
    locations[chatId] = candidates.map((candidate) => candidate.bucket);
  }
  return { byId: locations, overflowed: false };
}

export async function listCursorChatCandidates(options: CursorReaderOptions = {}): Promise<{
  candidates: CursorChatCandidate[];
  ambiguousById: Record<string, number>;
  locations: CursorLocationIndex;
  rejected: number;
  /** True only when the root and EVERY bucket were listed. A point lookup may
   *  report absence only from a complete enumeration. */
  complete: boolean;
}> {
  const root = cursorChatsRoot(options);
  const deps = options.pathsFs ?? REAL_PATH_FS;
  const rootListing = await listDirNames(root, deps);
  const buckets = rootListing.names;
  let complete = rootListing.complete;
  const byId = new Map<string, CursorChatCandidate[]>();
  let rejected = 0;

  for (const bucket of buckets) {
    if (!isSafeCursorBucketId(bucket)) {
      rejected++;
      continue;
    }
    const bucketDir = path.join(root, bucket);
    const bucketListing = await listDirNames(bucketDir, deps);
    complete = complete && bucketListing.complete;
    for (const chatId of bucketListing.names) {
      if (!isSafeCursorChatId(chatId)) {
        rejected++;
        continue; // unsafe id — counted, but never joined into a path
      }
      const candidate = makeCandidate(root, bucket, chatId);
      if (!candidate) {
        rejected++;
        continue;
      }
      const group = byId.get(chatId);
      if (group) {
        group.push(candidate);
      } else {
        byId.set(chatId, [candidate]);
      }
    }
  }

  const candidates: CursorChatCandidate[] = [];
  const ambiguousById: Record<string, number> = {};
  for (const [chatId, group] of byId) {
    if (group.length > 1) {
      ambiguousById[chatId] = group.length;
      continue;
    }
    candidates.push(group[0]);
  }
  return { candidates, ambiguousById, locations: locationIndexFromCandidates(byId), rejected, complete };
}

/** Resolve validated watcher buckets directly, consulting persisted locations only
 * for duplicate-id ambiguity. Unsafe or unusable state promotes to a full scan. */
export async function resolveChangedCursorChatCandidates(
  changedPaths: readonly string[],
  locations: unknown,
  options: CursorReaderOptions = {},
): Promise<{
  groups: Record<string, CursorChatCandidate[]>;
  locations?: CursorLocationIndex;
  metaChanged: ReadonlySet<string>;
  requiresFullScan: boolean;
}> {
  const groups: Record<string, CursorChatCandidate[]> = {};
  const metaChanged = new Set<string>();
  if (!isValidCursorLocationIndex(locations) || locations.overflowed) {
    return { groups, metaChanged, requiresFullScan: true };
  }

  const root = cursorChatsRoot(options);
  const deps = options.pathsFs ?? REAL_PATH_FS;
  const affectedBuckets = new Map<string, Set<string>>();
  let requiresFullScan = false;

  for (const changedPath of changedPaths) {
    const rel = path.relative(root, changedPath);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
      requiresFullScan = true;
      continue;
    }
    const parts = rel.split(path.sep);
    if (
      parts.length !== 3 ||
      !isSafeCursorBucketId(parts[0]) ||
      !isSafeCursorChatId(parts[1]) ||
      (parts[2] !== "meta.json" && parts[2] !== "store.db")
    ) {
      requiresFullScan = true;
      continue;
    }
    const [bucket, chatId, fileName] = parts;
    const buckets = affectedBuckets.get(chatId) ?? new Set(locations.byId[chatId] ?? []);
    buckets.add(bucket);
    affectedBuckets.set(chatId, buckets);
    if (fileName === "meta.json") {
      metaChanged.add(chatId);
    }
  }

  if (requiresFullScan) {
    return { groups, metaChanged, requiresFullScan };
  }

  const nextById: Record<string, string[]> = { ...locations.byId };
  for (const [chatId, buckets] of affectedBuckets) {
    const group: CursorChatCandidate[] = [];
    for (const bucket of [...buckets].sort()) {
      const candidate = makeCandidate(root, bucket, chatId);
      if (!candidate) {
        return { groups: {}, metaChanged, requiresFullScan: true };
      }
      if (await isDirectory(candidate.dir, deps)) {
        group.push(candidate);
      }
    }
    groups[chatId] = group;
    if (group.length === 0) {
      delete nextById[chatId];
    } else {
      nextById[chatId] = group.map((candidate) => candidate.bucket);
    }
  }

  const nextLocations: CursorLocationIndex = { byId: nextById, overflowed: false };
  if (!isValidCursorLocationIndex(nextLocations)) {
    return { groups: {}, metaChanged, requiresFullScan: true };
  }
  return { groups, locations: nextLocations, metaChanged, requiresFullScan: false };
}

/**
 * Resolve ONE chat id to its candidate directory, applying the same safety
 * and duplicate-ambiguity rules as the list scan (safe-cursor-chat-lookup —
 * point lookup never bypasses ambiguity omission). Returns null for an unsafe,
 * unlocatable, or ambiguous id.
 */
export async function resolveCursorChatCandidate(
  chatId: string,
  options: CursorReaderOptions = {},
): Promise<CursorChatCandidate | null> {
  const found = await lookupCursorChatCandidate(chatId, options);
  return found.status === "found" ? found.candidate : null;
}

/** What a point lookup could establish about one chat id. */
export type CursorChatCandidateLookup =
  | { status: "found"; candidate: CursorChatCandidate }
  | { status: "absent" }
  | { status: "unknown" };

/**
 * The same resolution, saying WHY it found nothing. An id no store can carry, and
 * an id missing from a complete enumeration, are absent. An incomplete
 * enumeration and a deliberately-omitted ambiguous id are not: the second means
 * the chat exists more than once, which is the opposite of gone.
 */
export async function lookupCursorChatCandidate(
  chatId: string,
  options: CursorReaderOptions = {},
): Promise<CursorChatCandidateLookup> {
  if (!isSafeCursorChatId(chatId)) {
    return { status: "absent" };
  }
  const { candidates, ambiguousById, complete } = await listCursorChatCandidates(options);
  const candidate = candidates.find((c) => c.chatId === chatId);
  if (candidate) {
    return { status: "found", candidate };
  }
  if (ambiguousById[chatId] !== undefined) {
    return { status: "unknown" };
  }
  return complete ? { status: "absent" } : { status: "unknown" };
}
