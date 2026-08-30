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
  FileStamp,
  ReaderListCache,
  ReaderRefreshHint,
  ReaderResultWithState,
} from "../cacheTypes";
import { boundedPreview } from "../preview";
import type { withSqliteSnapshot } from "../sqlite";
import {
  formatEntryId,
  type VaultActivityStep,
  type VaultEntryLookup,
  type VaultSessionDetail,
  type VaultSessionEntry,
  type VaultTimelineItem,
} from "../types";
import {
  type CursorIdeReaderOptions,
  cursorIdeDbPath,
  readCursorIdeDetail,
  readCursorIdeEntry,
  readCursorIdeSessions,
} from "./cursorIdeReader";
import { isCursorContinuationStep, isCursorDeclaredAgentType } from "./cursorNormalization";
import {
  type CursorChatCandidate,
  type CursorFsDeps,
  type CursorReaderOptions,
  cursorChatsRoot,
  isSafeCursorChatId,
  listCursorChatCandidates,
  resolveChangedCursorChatCandidates,
  resolveCursorChatCandidate,
} from "./cursorPaths";
import { readCursorStoreDetail, verifyCursorStoreIdentity } from "./cursorStore";
import {
  type CursorTranscriptCandidate,
  cursorProjectBucketForCwd,
  cursorProjectSessionId,
  cursorProjectsRoot,
  readCursorTranscript,
  resolveCursorProjectCwd,
  resolveCursorProjectTranscriptSession,
} from "./cursorTranscript";
import { finalizeDetail, limitedDetail, sourceVerdict } from "./detail";
import type { RecordLineResult } from "./recordLine";

export type { CursorFsDeps, CursorPathFsDeps, CursorReaderOptions } from "./cursorPaths";

/** cursor-metadata-compatibility-profile bounds. */
export const MAX_META_BYTES = 64 * 1024;
const MAX_CWD_CHARS = 16 * 1024;

const PARTIAL_LIMITED_REASON = "Cursor transcript is unavailable for this store.";
const MAX_RECENT_ACTIVITY = 12;
const MAX_CURSOR_CHILD_LINKS = 64;

export type CursorCombinedReaderOptions = CursorReaderOptions & CursorIdeReaderOptions;

/**
 * D12 child-transcript access boundary: the reader never publishes a derivable
 * `project:<bucket>:<id>` on the wire. The host issues an opaque locator for the
 * child it just resolved and keeps the mapping; with no issuer wired in, the
 * child stays a bounded inline card rather than an unaddressable id.
 */
export type CursorChildLocatorIssuer = (child: {
  parentSessionId: string;
  childAgentId: string;
  projectSessionId: string;
}) => string;

export type CursorDetailReaderOptions = CursorCombinedReaderOptions & {
  /** Injectable only for focused decoder tests; production uses one WAL-aware snapshot. */
  withSqliteSnapshotFn?: typeof withSqliteSnapshot;
  issueChildLocator?: CursorChildLocatorIssuer;
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

/** True iff the parsed metadata is schema-1 and its cwd passes the compatibility profile. */
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

function sameCwd(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

function mapCursorProjectEntry(candidate: CursorTranscriptCandidate, cwd: string, stamp: FileStamp): VaultSessionEntry {
  const sessionId = cursorProjectSessionId(candidate);
  return {
    id: formatEntryId("cursor", sessionId),
    agent: "cursor",
    sessionId,
    title: boundedPreview(candidate.transcriptId),
    cwd,
    modified: stamp.mtimeMs,
    flags: {},
    canFork: false,
    canResume: false,
  };
}

function cursorHintKinds(
  paths: readonly string[],
  options: CursorCombinedReaderOptions,
): Set<"cli" | "ide" | "unknown"> {
  const kinds = new Set<"cli" | "ide" | "unknown">();
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
    } else if (!isWithin(projectsRoot, changedPath)) {
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
    if (kinds.size === 0) {
      return cursorResult(
        prevCursor.chats,
        prevCursor.locations,
        prevCursor.unreadableById ?? {},
        prevCursor.rejected ?? 0,
        cachedIde(prevCursor),
      );
    }
    if (kinds.has("unknown") || kinds.size !== 1) {
      return readCursorSessions(prev, options);
    }
    if (kinds.has("ide")) {
      return cursorResult(
        prevCursor.chats,
        prevCursor.locations,
        prevCursor.unreadableById ?? {},
        prevCursor.rejected ?? 0,
        await readCursorIdeSessions(options),
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
    return cursorResult(chats, locations, unreadableById, prevCursor.rejected ?? 0, cachedIde(prevCursor));
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
  const ide = await readCursorIdeSessions(options);
  return cursorResult(chats, locations, unreadableById, rejected, ide);
}

interface ResolvedCursorCliSession {
  candidate: CursorChatCandidate;
  entry: VaultSessionEntry;
}

interface ResolvedCursorProjectSession {
  candidate: CursorTranscriptCandidate;
  entry: VaultSessionEntry;
}

async function resolveCursorCliSession(
  sessionId: string,
  options: CursorCombinedReaderOptions,
): Promise<ResolvedCursorCliSession | null> {
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
  return { candidate, entry: mapCursorMeta(candidate, meta, metaStamp) };
}

async function resolveCursorProjectSession(
  sessionId: string,
  options: CursorCombinedReaderOptions,
): Promise<ResolvedCursorProjectSession | null> {
  const candidate = await resolveCursorProjectTranscriptSession(sessionId, options);
  if (!candidate) {
    return null;
  }
  const deps = options.fs ?? REAL_FS;
  const [stamp, cwd] = await Promise.all([
    statFileOrNull(candidate.filePath, deps),
    resolveCursorProjectCwd(candidate.projectBucket, options),
  ]);
  if (!stamp || !cwd) {
    return null;
  }
  return { candidate, entry: mapCursorProjectEntry(candidate, cwd, stamp) };
}

/** The exact same-project bucket for `cwd`, or null when that bucket names a
 *  different directory (D12 exact point resolution). Validating the context is a
 *  per-cwd fact, so it is resolved once and reused across a detail's children. */
async function resolveCursorProjectContext(cwd: string, options: CursorCombinedReaderOptions): Promise<string | null> {
  const projectBucket = cursorProjectBucketForCwd(cwd);
  const projectCwd = await resolveCursorProjectCwd(projectBucket, options);
  return projectCwd && sameCwd(projectCwd, cwd) ? projectBucket : null;
}

function cursorProjectTranscriptSessionId(projectBucket: string, transcriptId: string): string {
  return `project:${Buffer.from(projectBucket, "utf8").toString("base64url")}:${transcriptId}`;
}

export async function resolveCursorProjectTranscriptForCwd(
  transcriptId: string,
  cwd: string,
  options: CursorCombinedReaderOptions = {},
): Promise<CursorTranscriptCandidate | null> {
  const projectBucket = await resolveCursorProjectContext(cwd, options);
  if (!projectBucket) {
    return null;
  }
  return resolveCursorProjectTranscriptSession(cursorProjectTranscriptSessionId(projectBucket, transcriptId), options);
}

type CursorPrivateSubagentStep = Extract<VaultActivityStep, { kind: "subagent" }> & {
  childAgentId?: unknown;
};

function visibleSubagentStep(step: CursorPrivateSubagentStep): Extract<VaultActivityStep, { kind: "subagent" }> {
  const { childAgentId: _childAgentId, ...visible } = step;
  // No decoded invocation declared a type for this agent, so `name` is the
  // invoking tool's — say so rather than let it render as `@Task` (D2, review W2).
  return isCursorDeclaredAgentType(visible.name) ? visible : { ...visible, undeclared: true };
}

async function linkCursorChildSessions(
  timeline: VaultTimelineItem[],
  parentSessionId: string,
  cwd: string,
  options: CursorDetailReaderOptions,
): Promise<VaultTimelineItem[]> {
  const issueChildLocator = options.issueChildLocator;
  const resolved = new Map<string, CursorTranscriptCandidate | null>();
  // One agent, one locator: every invocation of it must address the same child, and
  // re-issuing per invocation would also churn the host's bounded registry (D3).
  const locators = new Map<string, string>();
  let projectBucket: string | null | undefined;
  let lookupCount = 0;
  const output: VaultTimelineItem[] = [];
  for (const item of timeline) {
    if (item.kind !== "subagent") {
      output.push(item);
      continue;
    }
    const privateStep = item as CursorPrivateSubagentStep;
    const childAgentId =
      typeof privateStep.childAgentId === "string" && isSafeCursorChatId(privateStep.childAgentId)
        ? privateStep.childAgentId
        : undefined;
    // No issuer means nothing can address the child transcript, so resolving one
    // would only spend I/O on a card that must stay inline.
    if (!childAgentId || !issueChildLocator) {
      output.push(visibleSubagentStep(privateStep));
      continue;
    }
    let candidate = resolved.get(childAgentId);
    if (candidate === undefined) {
      if (lookupCount >= MAX_CURSOR_CHILD_LINKS) {
        output.push(visibleSubagentStep(privateStep));
        continue;
      }
      lookupCount++;
      // W14: the parent cwd's project context is one fact for the whole detail —
      // validate it once, then point-resolve each child leaf inside it.
      if (projectBucket === undefined) {
        projectBucket = await resolveCursorProjectContext(cwd, options);
      }
      candidate = projectBucket
        ? await resolveCursorProjectTranscriptSession(
            cursorProjectTranscriptSessionId(projectBucket, childAgentId),
            options,
          )
        : null;
      resolved.set(childAgentId, candidate);
    }
    if (!candidate) {
      output.push(visibleSubagentStep(privateStep));
      continue;
    }
    let locator = locators.get(childAgentId);
    if (locator === undefined) {
      locator = formatEntryId(
        "cursor",
        issueChildLocator({ parentSessionId, childAgentId, projectSessionId: cursorProjectSessionId(candidate) }),
      );
      locators.set(childAgentId, locator);
    }
    output.push({
      kind: "subagentSession",
      entryId: locator,
      title: privateStep.title ?? privateStep.prompt ?? privateStep.name,
      ...(privateStep.prompt ? { firstMessage: privateStep.prompt, prompt: privateStep.prompt } : {}),
      ...(privateStep.result ? { result: privateStep.result } : {}),
      ...(privateStep.status ? { status: privateStep.status } : {}),
      ...(privateStep.continuation ? { continuation: true } : {}),
      // No declared type was decoded for this agent — show no chip rather than
      // the invoking tool's own name (D2). Stated explicitly, not left implied by a
      // missing `agent`: agentless group nodes share that shape (review round 2 W2).
      ...(isCursorDeclaredAgentType(privateStep.name) ? { agent: privateStep.name } : { undeclared: true as const }),
    });
  }
  return output;
}

/** The 12-slot strip stays agent-level: a resumed agent occupies one slot, not one
 *  per turn (D4). Locality is the timeline's job. */
function visibleRecentActivity(activity: VaultActivityStep[]): VaultActivityStep[] {
  return activity
    .filter((step) => !isCursorContinuationStep(step))
    .map((step) => (step.kind === "subagent" ? visibleSubagentStep(step as CursorPrivateSubagentStep) : step));
}

/**
 * D14 explicit Resume identity proof, resolved once per action. The bounded
 * `store.db` identity must match the safe chat-directory name before Resume or
 * Copy Resume Command may proceed; transcript content is never decoded and the
 * metadata-only list path never calls this. IDE and project-transcript ids are
 * never CLI Resume candidates, so they fail closed without opening a store.
 *
 * One resolution per explicit launch action. `resolveCursorChatCandidate`
 * enumerates every chat bucket, so resolving the entry and then re-resolving it
 * for the identity proof both doubled that scan and let the two resolutions
 * observe different candidates across a move or delete-create (B17). The launcher
 * takes the entry and its store path from here and proves that same path.
 */
export async function resolveCursorLaunchTarget(
  sessionId: string,
  options: CursorDetailReaderOptions = {},
): Promise<{ entry: VaultSessionEntry; dbPath: string } | null> {
  if (sessionId.startsWith("ide:") || sessionId.startsWith("project:")) {
    return null;
  }
  const resolved = await resolveCursorCliSession(sessionId, options);
  return resolved ? { entry: resolved.entry, dbPath: resolved.candidate.dbPath } : null;
}

/** Prove a Cursor store whose location was already resolved for this action. */
export function verifyCursorLaunchTarget(
  target: { entry: VaultSessionEntry; dbPath: string },
  options: CursorDetailReaderOptions = {},
): Promise<boolean> {
  return verifyCursorStoreIdentity(target.dbPath, target.entry.sessionId, {
    withSqliteSnapshotFn: options.withSqliteSnapshotFn,
  });
}

/**
 * Resolve ONE Cursor session to its metadata entry. Source-qualified project and
 * IDE ids never fall through to the CLI chat-id domain.
 */
export async function readCursorEntry(
  sessionId: string,
  options: CursorCombinedReaderOptions = {},
): Promise<VaultSessionEntry | null> {
  if (sessionId.startsWith("ide:")) {
    return readCursorIdeEntry(sessionId, options);
  }
  if (sessionId.startsWith("project:")) {
    return (await resolveCursorProjectSession(sessionId, options))?.entry ?? null;
  }
  return (await resolveCursorCliSession(sessionId, options))?.entry ?? null;
}

/**
 * Cursor by-id lookup, as the conclusive answer the adapter contract asks for.
 * Task 1_1 wraps the existing reader without classifying: a non-null read is
 * `found`, everything else is `unknown`, which is what the caller already assumed.
 * Task 1_6 replaces this body with the real classification.
 */
export async function lookupCursorEntry(
  sessionId: string,
  options: CursorCombinedReaderOptions = {},
): Promise<VaultEntryLookup> {
  const entry = await readCursorEntry(sessionId, options);
  return entry ? { status: "found", entry } : { status: "unknown" };
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
  if (sessionId.startsWith("project:")) {
    const resolved = await resolveCursorProjectSession(sessionId, options);
    if (!resolved) {
      return null;
    }
    const transcript = await readCursorTranscript(resolved.candidate, options);
    if (transcript.status === "limited") {
      return limitedDetail(resolved.entry.id, transcript.reason);
    }
    const maxItems = typeof limit === "number" && Number.isSafeInteger(limit) && limit >= 0 ? limit : undefined;
    const sourceTimeline =
      maxItems === undefined ? transcript.timeline : maxItems === 0 ? [] : transcript.timeline.slice(-maxItems);
    const timeline = await linkCursorChildSessions(sourceTimeline, sessionId, resolved.entry.cwd, options);
    return finalizeDetail(
      resolved.entry.id,
      {
        recentActivity: visibleRecentActivity(transcript.recentActivity).slice(-MAX_RECENT_ACTIVITY),
        timeline,
        stats: transcript.stats,
        truncated: maxItems !== undefined && transcript.timeline.length > maxItems,
      },
      sourceVerdict(transcript.truncated),
    );
  }

  const resolved = await resolveCursorCliSession(sessionId, options);
  if (!resolved) {
    return null;
  }
  const { candidate, entry } = resolved;
  const store = await readCursorStoreDetail(candidate.dbPath, sessionId, {
    withSqliteSnapshotFn: options.withSqliteSnapshotFn,
  });
  let decoded = store;
  let sourceTruncated = false;
  // A store that names a different agent contradicts this directory; the mirror
  // must not stand in for it. Capability drift (absent/locked/unsupported store)
  // makes no competing claim and keeps its mirror (B15).
  if (store.status === "limited" && !store.identityContradicted) {
    const transcriptCandidate = await resolveCursorProjectTranscriptForCwd(sessionId, entry.cwd, options);
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
    return limitedDetail(entry.id, decoded.reason || PARTIAL_LIMITED_REASON);
  }

  const maxItems = typeof limit === "number" && Number.isSafeInteger(limit) && limit >= 0 ? limit : undefined;
  const sourceTimeline =
    maxItems === undefined ? decoded.timeline : maxItems === 0 ? [] : decoded.timeline.slice(-maxItems);
  const timeline = await linkCursorChildSessions(sourceTimeline, sessionId, entry.cwd, options);
  return finalizeDetail(
    entry.id,
    {
      recentActivity: visibleRecentActivity(decoded.recentActivity).slice(-MAX_RECENT_ACTIVITY),
      timeline,
      stats: decoded.stats,
      truncated: maxItems !== undefined && decoded.timeline.length > maxItems,
    },
    sourceVerdict(sourceTruncated),
  );
}

export async function resolveCursorSessionWatchPaths(
  sessionId: string,
  options: CursorCombinedReaderOptions = {},
): Promise<string[]> {
  if (sessionId.startsWith("ide:")) {
    const entry = await readCursorIdeEntry(sessionId, options);
    if (!entry) {
      return [];
    }
    const dbPath = cursorIdeDbPath(options);
    return [dbPath, `${dbPath}-wal`];
  }
  if (sessionId.startsWith("project:")) {
    const resolved = await resolveCursorProjectSession(sessionId, options);
    return resolved ? [resolved.candidate.filePath] : [];
  }
  const resolved = await resolveCursorCliSession(sessionId, options);
  if (!resolved) {
    return [];
  }
  const paths = [resolved.candidate.dbPath, `${resolved.candidate.dbPath}-wal`];
  const transcript = await resolveCursorProjectTranscriptForCwd(sessionId, resolved.entry.cwd, options);
  if (transcript) {
    paths.push(transcript.filePath);
  }
  return paths;
}

/** Cursor timelines intentionally omit `msgRef`: the private SQLite/protobuf
 * envelope is never exposed as a raw-record copy target. */
export async function readCursorMessageRecord(_sessionId: string, _msgRef: string): Promise<RecordLineResult> {
  return { ok: false, reason: "not-found" };
}
