import { createHash } from "node:crypto";
import { type SqliteSnapshot, withSqliteSnapshot } from "../sqlite";
import type { VaultActivityStep, VaultTimelineItem } from "../types";

const MAX_META_HEX_CHARS = 128 * 1024;
export const MAX_CURSOR_BLOB_BYTES = 5 * 1024 * 1024;
export const MAX_CURSOR_STORE_BYTES = 20 * 1024 * 1024;
const MAX_CURSOR_BLOBS = 4096;
const MAX_RECORD_TEXT_CHARS = 256 * 1024;
const MAX_NORMALIZED_TEXT_CHARS = 2 * 1024 * 1024;
const MAX_TOOL_DETAIL_CHARS = 2000;
const LIMITED_REASON = "Cursor transcript is unavailable for this store.";
const HASH_RE = /^[0-9a-f]{64}$/i;
const SAFE_AGENT_ID_RE = /^[A-Za-z0-9._-]{1,200}$/;

const CURSOR_PROFILE_SQL = `SELECT
  (SELECT user_version FROM pragma_user_version) AS user_version,
  (SELECT COUNT(*) FROM pragma_table_info('meta')) AS meta_columns,
  (SELECT COUNT(*) FROM pragma_table_info('meta') WHERE name = 'key' AND upper(type) = 'TEXT') AS meta_key,
  (SELECT COUNT(*) FROM pragma_table_info('meta') WHERE name = 'value' AND upper(type) = 'TEXT') AS meta_value_column,
  (SELECT COUNT(*) FROM pragma_table_info('blobs')) AS blob_columns,
  (SELECT COUNT(*) FROM pragma_table_info('blobs') WHERE name = 'id' AND upper(type) = 'TEXT') AS blob_id,
  (SELECT COUNT(*) FROM pragma_table_info('blobs') WHERE name = 'data' AND upper(type) = 'BLOB') AS blob_data,
  (SELECT value FROM meta WHERE key = '0' AND length(value) <= ${MAX_META_HEX_CHARS} LIMIT 1) AS meta_value`;

export interface CursorStoreOptions {
  withSqliteSnapshotFn?: typeof withSqliteSnapshot;
}

export interface CursorStoreStats {
  messageCount: number;
  toolCount: number;
  subagentCount: number;
}

export type CursorStoreResult =
  | {
      status: "ok";
      timeline: VaultTimelineItem[];
      recentActivity: VaultActivityStep[];
      stats: CursorStoreStats;
    }
  | { status: "limited"; reason: string };

interface ParsedFields {
  current: string[];
  archives: string[];
}

interface NormalizedRecord {
  timeline: VaultTimelineItem[];
  activity: VaultActivityStep[];
  textChars: number;
  messageCount: number;
  toolCount: number;
}

interface BlobFetchState {
  blobs: Map<string, Buffer>;
  totalBytes: number;
  count: number;
}

function limited(): CursorStoreResult {
  return { status: "limited", reason: LIMITED_REASON };
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function decodeHex(value: unknown, maxChars: number): Buffer | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > maxChars || value.length % 2 !== 0) {
    return undefined;
  }
  if (!/^[0-9a-f]+$/i.test(value)) return undefined;
  return Buffer.from(value, "hex");
}

function readVarint(data: Uint8Array, start: number): { value: number; next: number } | undefined {
  let value = 0;
  let factor = 1;
  for (let index = start; index < data.length && index < start + 10; index++) {
    const byte = data[index];
    value += (byte & 0x7f) * factor;
    if (!Number.isSafeInteger(value)) return undefined;
    if ((byte & 0x80) === 0) return { value, next: index + 1 };
    factor *= 128;
  }
  return undefined;
}

function directHash(value: Uint8Array): string | undefined {
  if (value.length === 32) return Buffer.from(value).toString("hex");
  if (value.length === 64) {
    const text = Buffer.from(value).toString("ascii");
    if (HASH_RE.test(text)) return text.toLowerCase();
  }
  return undefined;
}

function nestedHash(value: Uint8Array): string | undefined {
  const direct = directHash(value);
  if (direct) return direct;
  let offset = 0;
  while (offset < value.length) {
    const tag = readVarint(value, offset);
    if (!tag) return undefined;
    offset = tag.next;
    const fieldNumber = Math.floor(tag.value / 8);
    const wireType = tag.value & 7;
    if (wireType !== 2) return undefined;
    const length = readVarint(value, offset);
    if (!length) return undefined;
    offset = length.next;
    const end = offset + length.value;
    if (end > value.length) return undefined;
    if (fieldNumber === 1) {
      const candidate = directHash(value.subarray(offset, end));
      if (candidate) return candidate;
    }
    offset = end;
  }
  return undefined;
}

function parseReferenceFields(data: Uint8Array, currentField: number, archiveField?: number): ParsedFields | undefined {
  const parsed: ParsedFields = { current: [], archives: [] };
  let offset = 0;
  while (offset < data.length) {
    const tag = readVarint(data, offset);
    if (!tag || tag.value === 0) return undefined;
    offset = tag.next;
    const fieldNumber = Math.floor(tag.value / 8);
    const wireType = tag.value & 7;
    if (wireType === 0) {
      const skipped = readVarint(data, offset);
      if (!skipped) return undefined;
      offset = skipped.next;
      continue;
    }
    if (wireType === 1) {
      if (offset + 8 > data.length) return undefined;
      offset += 8;
      continue;
    }
    if (wireType === 5) {
      if (offset + 4 > data.length) return undefined;
      offset += 4;
      continue;
    }
    if (wireType !== 2) return undefined;
    const length = readVarint(data, offset);
    if (!length) return undefined;
    offset = length.next;
    const end = offset + length.value;
    if (end > data.length) return undefined;
    if (fieldNumber === currentField || fieldNumber === archiveField) {
      const ref = nestedHash(data.subarray(offset, end));
      if (!ref) return undefined;
      (fieldNumber === archiveField ? parsed.archives : parsed.current).push(ref);
    }
    offset = end;
  }
  return parsed;
}

function blobSql(id: string, maxBytes: number): string {
  return `SELECT id, hex(data) AS data_hex, length(data) AS byte_length
FROM blobs
WHERE id = '${id}' AND length(data) <= ${maxBytes}
LIMIT 1`;
}

async function fetchBlob(snapshot: SqliteSnapshot, id: string, state: BlobFetchState): Promise<Buffer | undefined> {
  const normalizedId = id.toLowerCase();
  if (!HASH_RE.test(normalizedId)) return undefined;
  const cached = state.blobs.get(normalizedId);
  if (cached) return cached;
  if (state.count >= MAX_CURSOR_BLOBS) return undefined;
  const remainingBytes = MAX_CURSOR_STORE_BYTES - state.totalBytes;
  const maxBytes = Math.min(MAX_CURSOR_BLOB_BYTES, remainingBytes);
  if (maxBytes <= 0) return undefined;

  const result = await snapshot.query(blobSql(normalizedId, maxBytes));
  if (result.status !== "ok" || result.rows.length !== 1) return undefined;
  const row = result.rows[0];
  if (row.id !== normalizedId || Number(row.byte_length) > maxBytes) return undefined;
  const data = decodeHex(row.data_hex, maxBytes * 2);
  if (!data || data.length !== Number(row.byte_length)) return undefined;
  if (createHash("sha256").update(data).digest("hex") !== normalizedId) return undefined;

  state.count++;
  state.totalBytes += data.length;
  if (state.totalBytes > MAX_CURSOR_STORE_BYTES) return undefined;
  state.blobs.set(normalizedId, data);
  return data;
}

function timestamp(record: Record<string, unknown>): number | undefined {
  for (const key of ["timestampMs", "timestamp_ms", "createdAtMs", "created_at_ms"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  }
  return undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= MAX_RECORD_TEXT_CHARS ? value : undefined;
}

function toolDetail(input: unknown): string | undefined {
  const obj = asObject(input);
  if (!obj) return undefined;
  for (const key of ["file_path", "path", "command", "query", "description"]) {
    const value = obj[key];
    if (typeof value === "string" && value.length > 0) return value.slice(0, MAX_TOOL_DETAIL_CHARS);
  }
  return undefined;
}

function toolResultText(value: unknown): string | undefined {
  if (typeof value === "string") return value.slice(0, MAX_TOOL_DETAIL_CHARS);
  if (!Array.isArray(value)) return undefined;
  const parts: string[] = [];
  for (const item of value) {
    if (typeof item === "string") parts.push(item);
    else {
      const block = asObject(item);
      if (block && (block.type === "text" || block.type === "tool_result") && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
  }
  return parts.join("\n").slice(0, MAX_TOOL_DETAIL_CHARS) || undefined;
}

function toolName(record: Record<string, unknown>): string {
  for (const key of ["name", "toolName", "tool_name"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0 && value.length <= 200) return value;
  }
  return "Tool result";
}

function normalizedTool(tool: string, detail?: string): VaultActivityStep {
  return { kind: "tool", tool, ...(detail ? { detail } : {}) };
}

function normalizeRecord(data: Buffer): NormalizedRecord | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(data.toString("utf8"));
  } catch {
    return undefined;
  }
  const envelope = asObject(raw);
  if (!envelope) return undefined;
  const message = asObject(envelope.message);
  const record = message ? { ...envelope, ...message } : envelope;
  if (
    [envelope, record].some(
      (value) =>
        value.isSummary === true ||
        value.isGenerated === true ||
        value.generated === true ||
        value.type === "summary" ||
        value.type === "reasoning" ||
        value.type === "thinking" ||
        value.role === "system" ||
        value.role === "reasoning",
    )
  ) {
    return { timeline: [], activity: [], textChars: 0, messageCount: 0, toolCount: 0 };
  }

  if (record.role === "tool" || record.role === "tool_result" || record.type === "tool_result") {
    const detail = toolResultText(record.content ?? record.output ?? record.result);
    const tool = normalizedTool(toolName(record), detail);
    return { timeline: [tool], activity: [tool], textChars: detail?.length ?? 0, messageCount: 0, toolCount: 1 };
  }

  const role = record.role;
  if (role !== "user" && role !== "assistant") {
    return { timeline: [], activity: [], textChars: 0, messageCount: 0, toolCount: 0 };
  }

  const texts: string[] = [];
  const tools: VaultActivityStep[] = [];
  const content = record.content;
  if (typeof content === "string") {
    const text = textValue(content);
    if (text === undefined) return undefined;
    texts.push(text);
  } else if (Array.isArray(content)) {
    for (const blockValue of content) {
      const block = asObject(blockValue);
      if (!block) continue;
      if (block.type === "text" || block.type === "input_text" || block.type === "output_text") {
        const text = textValue(block.text);
        if (text === undefined) return undefined;
        texts.push(text);
      } else if (
        role === "assistant" &&
        (block.type === "tool_use" || block.type === "tool_call" || block.type === "tool-call") &&
        typeof block.name === "string" &&
        block.name.length > 0 &&
        block.name.length <= 200
      ) {
        tools.push(normalizedTool(block.name, toolDetail(block.input ?? block.arguments)));
      } else if (block.type === "tool_result") {
        const detail = toolResultText(block.content ?? block.text ?? block.output);
        tools.push(normalizedTool(toolName(block), detail));
      }
    }
  } else {
    const text = textValue(record.text);
    if (text !== undefined) texts.push(text);
  }

  const text = texts.join("\n");
  const ts = timestamp(record) ?? timestamp(envelope);
  const timeline: VaultTimelineItem[] = [];
  if (text.length > 0) {
    timeline.push({ kind: "message", role, text, ...(ts !== undefined ? { timestamp: ts } : {}) });
  }
  timeline.push(...tools);
  return {
    timeline,
    activity: tools,
    textChars:
      text.length + tools.reduce((sum, tool) => sum + (tool.kind === "tool" ? (tool.detail?.length ?? 0) : 0), 0),
    messageCount: text.length > 0 ? 1 : 0,
    toolCount: tools.length,
  };
}

function compatibleProfile(row: Record<string, unknown>): boolean {
  return (
    Number(row.user_version) === 1 &&
    Number(row.meta_columns) === 2 &&
    Number(row.meta_key) === 1 &&
    Number(row.meta_value_column) === 1 &&
    Number(row.blob_columns) === 2 &&
    Number(row.blob_id) === 1 &&
    Number(row.blob_data) === 1
  );
}

async function decodeSnapshot(snapshot: SqliteSnapshot, expectedAgentId: string): Promise<CursorStoreResult> {
  const profileResult = await snapshot.query(CURSOR_PROFILE_SQL);
  if (profileResult.status !== "ok" || profileResult.rows.length !== 1) return limited();
  const profile = profileResult.rows[0];
  if (!compatibleProfile(profile)) return limited();

  const metaBytes = decodeHex(profile.meta_value, MAX_META_HEX_CHARS);
  if (!metaBytes) return limited();
  let meta: Record<string, unknown> | undefined;
  try {
    meta = asObject(JSON.parse(metaBytes.toString("utf8")));
  } catch {
    return limited();
  }
  if (!meta || meta.agentId !== expectedAgentId) return limited();
  const rootValue = typeof meta.latestRootBlobId === "string" ? meta.latestRootBlobId : meta.rootBlobId;
  if (typeof rootValue !== "string" || !HASH_RE.test(rootValue)) return limited();

  const fetchState: BlobFetchState = { blobs: new Map(), totalBytes: 0, count: 0 };
  const root = await fetchBlob(snapshot, rootValue, fetchState);
  if (!root) return limited();
  const rootRefs = parseReferenceFields(root, 1, 13);
  if (!rootRefs) return limited();

  const orderedMessageRefs: string[] = [];
  for (const archiveId of rootRefs.archives) {
    const archive = await fetchBlob(snapshot, archiveId, fetchState);
    if (!archive) return limited();
    const archiveRefs = parseReferenceFields(archive, 1);
    if (!archiveRefs) return limited();
    orderedMessageRefs.push(...archiveRefs.current);
  }
  orderedMessageRefs.push(...rootRefs.current);

  const timeline: VaultTimelineItem[] = [];
  const recentActivity: VaultActivityStep[] = [];
  const seen = new Set<string>();
  let normalizedTextChars = 0;
  let messageCount = 0;
  let toolCount = 0;
  for (const ref of orderedMessageRefs) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    const data = await fetchBlob(snapshot, ref, fetchState);
    if (!data) return limited();
    const record = normalizeRecord(data);
    if (!record) return limited();
    normalizedTextChars += record.textChars;
    if (normalizedTextChars > MAX_NORMALIZED_TEXT_CHARS) return limited();
    timeline.push(...record.timeline);
    recentActivity.push(...record.activity);
    messageCount += record.messageCount;
    toolCount += record.toolCount;
  }

  return {
    status: "ok",
    timeline,
    recentActivity,
    stats: { messageCount, toolCount, subagentCount: 0 },
  };
}

export async function readCursorStoreDetail(
  dbPath: string,
  expectedAgentId: string,
  options: CursorStoreOptions = {},
): Promise<CursorStoreResult> {
  if (!SAFE_AGENT_ID_RE.test(expectedAgentId) || expectedAgentId.includes("..")) return limited();
  const snapshotResult = await (options.withSqliteSnapshotFn ?? withSqliteSnapshot)(dbPath, (snapshot) =>
    decodeSnapshot(snapshot, expectedAgentId),
  );
  return snapshotResult.status === "ok" ? snapshotResult.value : limited();
}
