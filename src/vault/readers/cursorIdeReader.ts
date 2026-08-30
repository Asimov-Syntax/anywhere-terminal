import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { FileStamp } from "../cacheTypes";
import { boundedPreview } from "../preview";
import { withSqliteSnapshot as readSnapshot, type SqliteSnapshot } from "../sqlite";
import {
  formatEntryId,
  type VaultActivityStep,
  type VaultEntryLookup,
  type VaultSessionDetail,
  type VaultSessionEntry,
  type VaultTimelineItem,
} from "../types";
import { finalizeDetail, limitedDetail, sourceVerdict } from "./detail";

const MAX_COMPOSERS = 4096;
const MAX_JSON_CHARS = 2 * 1024 * 1024;
const MAX_CONVERSATION_HEADERS = 500;
const MAX_BUBBLE_BYTES = 5 * 1024 * 1024;
const MAX_BUBBLE_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 256 * 1024;
const MAX_NORMALIZED_TEXT_CHARS = 2 * 1024 * 1024;
const MAX_TOOL_DETAIL_CHARS = 2000;
const MAX_CONTEXT_CHARS = 512;
const SAFE_COMPOSER_ID_RE = /^[A-Za-z0-9._-]{1,200}$/;
const LIMITED_REASON = "Cursor IDE transcript is unavailable for this session.";

const COMPOSER_LIST_SQL = `SELECT composerId, workspaceId, createdAt, lastUpdatedAt, isArchived, isSubagent, value
FROM composerHeaders
WHERE isArchived = 0 AND isSubagent = 0 AND length(CAST(value AS BLOB)) <= ${MAX_JSON_CHARS}
ORDER BY COALESCE(lastUpdatedAt, createdAt) DESC
LIMIT ${MAX_COMPOSERS}`;

export interface CursorIdeReaderOptions {
  home?: string;
  ideDbPath?: string;
  withSqliteSnapshotFn?: typeof readSnapshot;
}

export interface CursorIdeListResult {
  entries: VaultSessionEntry[];
  unreadable: number;
  sources: Record<string, FileStamp>;
}

interface ParsedComposer {
  composerId: string;
  workspaceId: string;
  cwd: string;
  title: string;
  modified: number;
  headers: Record<string, unknown>[];
  truncated: boolean;
}

export function cursorIdeDbPath(options: CursorIdeReaderOptions = {}): string {
  if (options.ideDbPath) {
    return options.ideDbPath;
  }
  const home = options.home ?? os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA ?? path.join(home, "AppData", "Roaming"),
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    );
  }
  return path.join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb");
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function parseJson(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_JSON_CHARS) {
    return undefined;
  }
  let sanitized = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    sanitized += code < 0x20 && character !== "\n" && character !== "\r" && character !== "\t" ? " " : character;
  }
  try {
    return asObject(JSON.parse(sanitized));
  } catch {
    return undefined;
  }
}

function hasControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function validCwd(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 16 * 1024 &&
    (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) &&
    !hasControl(value)
  );
}

function safeTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64url(value: string): string | undefined {
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(value)) {
    return undefined;
  }
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    if (
      decoded.length === 0 ||
      decoded.length > MAX_CONTEXT_CHARS ||
      hasControl(decoded) ||
      base64url(decoded) !== value
    ) {
      return undefined;
    }
    return decoded;
  } catch {
    return undefined;
  }
}

function composerSessionId(workspaceId: string, composerId: string): string {
  return `ide:${base64url(workspaceId)}:${composerId}`;
}

function parseSessionId(sessionId: string): { workspaceId: string; composerId: string } | undefined {
  const match = /^ide:([A-Za-z0-9_-]+):([A-Za-z0-9._-]+)$/.exec(sessionId);
  if (!match || !SAFE_COMPOSER_ID_RE.test(match[2]) || match[2].includes("..")) {
    return undefined;
  }
  const workspaceId = decodeBase64url(match[1]);
  return workspaceId ? { workspaceId, composerId: match[2] } : undefined;
}

function workspaceIdentity(composer: Record<string, unknown>): { workspaceId: string; cwd: string } | undefined {
  const identifier = asObject(composer.workspaceIdentifier);
  const workspaceId = identifier?.id;
  const uri = asObject(identifier?.uri);
  const cwd = uri?.fsPath ?? uri?.path;
  if (
    typeof workspaceId !== "string" ||
    workspaceId.length === 0 ||
    workspaceId.length > MAX_CONTEXT_CHARS ||
    hasControl(workspaceId) ||
    !validCwd(cwd)
  ) {
    return undefined;
  }
  return { workspaceId, cwd };
}

function parseHeaderRow(row: Record<string, unknown>): ParsedComposer | undefined {
  const composerId = row.composerId;
  if (typeof composerId !== "string" || !SAFE_COMPOSER_ID_RE.test(composerId) || composerId.includes("..")) {
    return undefined;
  }
  const header = parseJson(row.value);
  if (!header || header.isArchived === true || header.isSubagent === true || header.isDraft === true) {
    return undefined;
  }
  if (typeof header.composerId === "string" && header.composerId !== composerId) {
    return undefined;
  }
  const workspace = workspaceIdentity(header);
  if (!workspace || (typeof row.workspaceId === "string" && row.workspaceId !== workspace.workspaceId)) {
    return undefined;
  }
  return {
    composerId,
    workspaceId: workspace.workspaceId,
    cwd: workspace.cwd,
    title: boundedPreview(typeof header.name === "string" ? header.name : ""),
    modified: safeTimestamp(row.lastUpdatedAt) ?? safeTimestamp(row.createdAt) ?? 0,
    headers: [],
    truncated: false,
  };
}

function decodeHexJson(value: unknown, maxBytes = MAX_JSON_CHARS): Record<string, unknown> | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > maxBytes * 2 || value.length % 2 !== 0) {
    return undefined;
  }
  if (!/^[0-9a-f]+$/i.test(value)) {
    return undefined;
  }
  return parseJson(Buffer.from(value, "hex").toString("utf8"));
}

function mapEntry(composer: ParsedComposer): VaultSessionEntry {
  const sessionId = composerSessionId(composer.workspaceId, composer.composerId);
  return {
    id: formatEntryId("cursor", sessionId),
    agent: "cursor",
    sessionId,
    title: composer.title,
    cwd: composer.cwd,
    modified: composer.modified,
    flags: {},
    canFork: false,
    canResume: false,
    source: "ide",
  };
}

async function listFromSnapshot(snapshot: SqliteSnapshot): Promise<Omit<CursorIdeListResult, "sources">> {
  const result = await snapshot.query(COMPOSER_LIST_SQL);
  if (result.status !== "ok") {
    return { entries: [], unreadable: 1 };
  }
  const byId = new Map<string, VaultSessionEntry[]>();
  let unreadable = 0;
  for (const row of result.rows) {
    const composer = parseHeaderRow(row);
    if (!composer) {
      unreadable++;
      continue;
    }
    const entry = mapEntry(composer);
    const group = byId.get(entry.id);
    if (group) {
      group.push(entry);
    } else {
      byId.set(entry.id, [entry]);
    }
  }
  const entries: VaultSessionEntry[] = [];
  for (const group of byId.values()) {
    if (group.length === 1) {
      entries.push(group[0]);
    } else {
      unreadable += group.length;
    }
  }
  return { entries, unreadable };
}

async function sourceStamps(dbPath: string): Promise<Record<string, FileStamp>> {
  const sources: Record<string, FileStamp> = {};
  for (const sourcePath of [dbPath, `${dbPath}-wal`]) {
    try {
      const stamp = await fs.stat(sourcePath);
      if (stamp.isFile()) {
        sources[sourcePath] = { mtimeMs: stamp.mtimeMs, size: stamp.size };
      }
    } catch {
      // Missing sidecars are normal; the database snapshot decides readability.
    }
  }
  return sources;
}

export async function readCursorIdeSessions(options: CursorIdeReaderOptions = {}): Promise<CursorIdeListResult> {
  const dbPath = cursorIdeDbPath(options);
  const result = await (options.withSqliteSnapshotFn ?? readSnapshot)(dbPath, listFromSnapshot);
  const sources = await sourceStamps(dbPath);
  return result.status === "ok"
    ? { ...result.value, sources }
    : { entries: [], unreadable: result.status === "no-db" ? 0 : 1, sources };
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

interface LoadedComposer {
  composer: ParsedComposer;
  bubbles: Map<string, Record<string, unknown>>;
  supported: boolean;
}

async function composerFromSnapshot(
  snapshot: SqliteSnapshot,
  identity: { workspaceId: string; composerId: string },
): Promise<LoadedComposer | undefined> {
  const headerResult = await snapshot.query(
    `SELECT composerId, workspaceId, createdAt, lastUpdatedAt, isArchived, isSubagent, value
     FROM composerHeaders
     WHERE composerId = ${sqlText(identity.composerId)} AND isArchived = 0 AND isSubagent = 0
       AND length(CAST(value AS BLOB)) <= ${MAX_JSON_CHARS}
     LIMIT 1`,
  );
  if (headerResult.status !== "ok" || headerResult.rows.length !== 1) {
    return undefined;
  }
  const header = parseHeaderRow(headerResult.rows[0]);
  if (!header || header.workspaceId !== identity.workspaceId) {
    return undefined;
  }
  const limited = (): LoadedComposer => ({ composer: header, bubbles: new Map(), supported: false });

  const composerKey = `composerData:${identity.composerId}`;
  const composerResult = await snapshot.query(
    `SELECT hex(value) AS value_hex FROM cursorDiskKV
     WHERE key = ${sqlText(composerKey)} AND length(CAST(value AS BLOB)) <= ${MAX_JSON_CHARS}
     LIMIT 1`,
  );
  if (composerResult.status !== "ok" || composerResult.rows.length !== 1) {
    return limited();
  }
  const data = decodeHexJson(composerResult.rows[0].value_hex);
  if (!data || (typeof data.composerId === "string" && data.composerId !== identity.composerId)) {
    return limited();
  }
  const allHeaders = Array.isArray(data.fullConversationHeadersOnly)
    ? data.fullConversationHeadersOnly.map(asObject).filter((item): item is Record<string, unknown> => !!item)
    : [];
  if (allHeaders.length === 0) {
    return limited();
  }
  const headers = allHeaders.slice(-MAX_CONVERSATION_HEADERS);
  const composer = { ...header, headers, truncated: allHeaders.length > headers.length };
  const prefix = `bubbleId:${identity.composerId}:`;
  const requested = new Map<string, string>();
  for (const conversationHeader of headers) {
    const bubbleId = conversationHeader.bubbleId;
    if (
      typeof bubbleId === "string" &&
      SAFE_COMPOSER_ID_RE.test(bubbleId) &&
      !bubbleId.includes("..") &&
      !requested.has(bubbleId)
    ) {
      requested.set(bubbleId, `${prefix}${bubbleId}`);
    }
  }
  if (requested.size === 0) {
    return limited();
  }
  const requestedRows = [...requested.values()].map((key, index) => `(${sqlText(key)}, ${index})`).join(",");
  const bubbleResult = await snapshot.query(
    `WITH requested(key, ordinal) AS (VALUES ${requestedRows}),
     selected AS (
       SELECT data.key, data.value, requested.ordinal, length(data.value) AS bytes
       FROM requested JOIN cursorDiskKV AS data ON data.key = requested.key
       WHERE length(data.value) <= ${MAX_BUBBLE_BYTES}
     ),
     budgeted AS (
       SELECT key, value, ordinal, SUM(bytes) OVER (ORDER BY ordinal) AS total_bytes
       FROM selected
     )
     SELECT key, hex(value) AS value_hex FROM budgeted
     WHERE total_bytes <= ${MAX_BUBBLE_TOTAL_BYTES}
     ORDER BY ordinal`,
  );
  if (bubbleResult.status !== "ok") {
    return limited();
  }
  const bubbles = new Map<string, Record<string, unknown>>();
  for (const [id, key] of requested) {
    const row = bubbleResult.rows.find((candidate) => candidate.key === key);
    const bubble = row ? decodeHexJson(row.value_hex, MAX_BUBBLE_BYTES) : undefined;
    if (bubble) {
      bubbles.set(id, bubble);
    }
  }
  composer.truncated ||= bubbles.size < requested.size;
  return bubbles.size > 0 ? { composer, bubbles, supported: true } : limited();
}

function bubbleTimestamp(bubble: Record<string, unknown>): number | undefined {
  for (const key of ["createdAt", "timestamp"]) {
    const value = bubble[key];
    const numeric = safeTimestamp(value);
    if (numeric !== undefined) {
      return numeric;
    }
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (Number.isSafeInteger(parsed) && parsed >= 0) {
        return parsed;
      }
    }
  }
  return undefined;
}

function toolDetail(value: unknown): string | undefined {
  const record = asObject(value);
  if (!record) {
    return undefined;
  }
  const rawArgs = record.rawArgs;
  if (typeof rawArgs === "string" && rawArgs.length <= MAX_JSON_CHARS) {
    try {
      const args = asObject(JSON.parse(rawArgs));
      for (const key of ["file_path", "path", "command", "query", "description"]) {
        const detail = args?.[key];
        if (typeof detail === "string" && detail.length > 0) {
          return detail.slice(0, MAX_TOOL_DETAIL_CHARS);
        }
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function timelineTextChars(item: VaultTimelineItem): number {
  if (item.kind === "message") {
    return item.text.length;
  }
  if (item.kind === "tool") {
    return item.tool.length + (item.detail?.length ?? 0);
  }
  return 0;
}

function normalizeBubble(
  bubble: Record<string, unknown>,
  type: number,
): { timeline: VaultTimelineItem[]; activity: VaultActivityStep[] } {
  if (bubble.isThought === true) {
    return { timeline: [], activity: [] };
  }
  const timestamp = bubbleTimestamp(bubble);
  const text = typeof bubble.text === "string" && bubble.text.length <= MAX_TEXT_CHARS ? bubble.text : "";
  if (type === 1) {
    return text
      ? {
          timeline: [{ kind: "message", role: "user", text, ...(timestamp !== undefined ? { timestamp } : {}) }],
          activity: [],
        }
      : { timeline: [], activity: [] };
  }
  if (type !== 2) {
    return { timeline: [], activity: [] };
  }
  const toolData = asObject(bubble.toolFormerData);
  if (toolData) {
    const name =
      typeof toolData.name === "string" && toolData.name.length > 0 && toolData.name.length <= 200
        ? toolData.name
        : "Cursor tool";
    const detail = toolDetail(toolData) ?? (text ? text.slice(0, MAX_TOOL_DETAIL_CHARS) : undefined);
    const tool: VaultActivityStep = { kind: "tool", tool: name, ...(detail ? { detail } : {}) };
    return { timeline: [tool], activity: [tool] };
  }
  return text
    ? {
        timeline: [{ kind: "message", role: "assistant", text, ...(timestamp !== undefined ? { timestamp } : {}) }],
        activity: [],
      }
    : { timeline: [], activity: [] };
}

export async function lookupCursorIdeEntry(
  sessionId: string,
  options: CursorIdeReaderOptions = {},
): Promise<VaultEntryLookup> {
  const identity = parseSessionId(sessionId);
  if (!identity) {
    return { status: "absent" };
  }
  const result = await (options.withSqliteSnapshotFn ?? readSnapshot)(cursorIdeDbPath(options), async (snapshot) => {
    const loaded = await composerFromSnapshot(snapshot, identity);
    return loaded ? mapEntry(loaded.composer) : null;
  });
  if (result.status === "ok") {
    // The query ran: a composer that is not in the store is genuinely not there.
    return result.value ? { status: "found", entry: result.value } : { status: "absent" };
  }
  // `no-db` is now a CONFIRMED missing database (D6), so an IDE store that was
  // uninstalled or deleted carries no sessions. Every other status is a failure
  // to look.
  return result.status === "no-db" ? { status: "absent" } : { status: "unknown" };
}

/** The entry-or-nothing view, for callers that cannot act on the difference. */
export async function readCursorIdeEntry(
  sessionId: string,
  options: CursorIdeReaderOptions = {},
): Promise<VaultSessionEntry | null> {
  const found = await lookupCursorIdeEntry(sessionId, options);
  return found.status === "found" ? found.entry : null;
}

export async function readCursorIdeDetail(
  sessionId: string,
  limit?: number,
  options: CursorIdeReaderOptions = {},
): Promise<VaultSessionDetail | null> {
  const identity = parseSessionId(sessionId);
  if (!identity) {
    return null;
  }
  const result = await (options.withSqliteSnapshotFn ?? readSnapshot)(cursorIdeDbPath(options), async (snapshot) => {
    const loaded = await composerFromSnapshot(snapshot, identity);
    if (!loaded) {
      return null;
    }
    if (!loaded.supported) {
      return limitedDetail(formatEntryId("cursor", sessionId), LIMITED_REASON);
    }
    const timeline: VaultTimelineItem[] = [];
    const activity: VaultActivityStep[] = [];
    let messageCount = 0;
    let toolCount = 0;
    let normalizedTextChars = 0;
    let sourceTruncated = loaded.composer.truncated;
    headers: for (const header of loaded.composer.headers) {
      const bubbleId = header.bubbleId;
      const type = header.type;
      if (typeof bubbleId !== "string" || !SAFE_COMPOSER_ID_RE.test(bubbleId) || typeof type !== "number") {
        continue;
      }
      const bubble = loaded.bubbles.get(bubbleId);
      if (!bubble) {
        continue;
      }
      const normalized = normalizeBubble(bubble, type);
      for (const item of normalized.timeline) {
        const itemChars = timelineTextChars(item);
        if (normalizedTextChars + itemChars > MAX_NORMALIZED_TEXT_CHARS) {
          sourceTruncated = true;
          break headers;
        }
        normalizedTextChars += itemChars;
        timeline.push(item);
        if (item.kind === "message") {
          messageCount++;
        } else if (item.kind === "tool") {
          toolCount++;
        }
      }
      activity.push(...normalized.activity);
    }
    const maxItems = typeof limit === "number" && Number.isSafeInteger(limit) && limit >= 0 ? limit : undefined;
    const bounded = maxItems === undefined ? timeline : maxItems === 0 ? [] : timeline.slice(-maxItems);
    return finalizeDetail(
      formatEntryId("cursor", sessionId),
      {
        recentActivity: activity.slice(-12),
        timeline: bounded,
        stats: { messageCount, toolCount, subagentCount: 0 },
        truncated: maxItems !== undefined && timeline.length > maxItems,
      },
      sourceVerdict(sourceTruncated),
    ) satisfies VaultSessionDetail;
  });
  if (result.status !== "ok") {
    return limitedDetail(formatEntryId("cursor", sessionId), LIMITED_REASON);
  }
  return result.value;
}
