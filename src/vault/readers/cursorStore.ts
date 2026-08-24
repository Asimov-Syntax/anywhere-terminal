import { createHash } from "node:crypto";
import { type SqliteSnapshot, withSqliteSnapshot } from "../sqlite";
import type { VaultActivityStep, VaultTimelineItem } from "../types";
import {
  type CursorNormalizedRecord,
  type CursorSubagentStep,
  type CursorToolResult,
  collectCursorAgentTypes,
  countCursorAgents,
  mergeCursorSubagentInvocations,
  normalizeCursorRecord,
} from "./cursorNormalization";

const MAX_META_HEX_CHARS = 128 * 1024;
export const MAX_CURSOR_BLOB_BYTES = 5 * 1024 * 1024;
export const MAX_CURSOR_STORE_BYTES = 20 * 1024 * 1024;
const MAX_CURSOR_BLOBS = 4096;
const BLOB_BATCH_SIZE = 64;
const MAX_NORMALIZED_TEXT_CHARS = 2 * 1024 * 1024;
const LIMITED_REASON = "Cursor transcript is unavailable for this store.";
const HASH_RE = /^[0-9a-f]{64}$/i;
const SAFE_AGENT_ID_RE = /^[A-Za-z0-9._-]{1,200}$/;

const CURSOR_PROFILE_SQL = `SELECT
  (SELECT user_version FROM pragma_user_version) AS user_version,
  (SELECT COUNT(*) FROM pragma_table_info('meta')) AS meta_columns,
  (SELECT COUNT(*) FROM pragma_table_info('meta') WHERE name = 'key' AND upper(type) = 'TEXT' AND pk = 1) AS meta_key,
  (SELECT COUNT(*) FROM meta WHERE key = '0') AS meta_key_rows,
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
  | {
      status: "limited";
      reason: string;
      /**
       * The store was readable and named a DIFFERENT agent than the candidate
       * directory. That contradiction is the stale/moved-directory signal, so the
       * caller must not substitute the same-cwd project mirror for it (B15). An
       * absent, locked, or unsupported store makes no competing claim and leaves
       * this false.
       */
      identityContradicted?: boolean;
    };

interface ParsedFields {
  current: string[];
  archives: string[];
}

type NormalizedRecord = CursorNormalizedRecord;

interface BlobFetchState {
  blobs: Map<string, Buffer>;
  totalBytes: number;
  count: number;
}

function limited(): CursorStoreResult {
  return { status: "limited", reason: LIMITED_REASON };
}

function identityContradicted(): CursorStoreResult {
  return { status: "limited", reason: LIMITED_REASON, identityContradicted: true };
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function decodeHex(value: unknown, maxChars: number): Buffer | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > maxChars || value.length % 2 !== 0) {
    return undefined;
  }
  if (!/^[0-9a-f]+$/i.test(value)) {
    return undefined;
  }
  return Buffer.from(value, "hex");
}

function readVarint(data: Uint8Array, start: number): { value: number; next: number } | undefined {
  let value = 0;
  let factor = 1;
  for (let index = start; index < data.length && index < start + 10; index++) {
    const byte = data[index];
    value += (byte & 0x7f) * factor;
    if (!Number.isSafeInteger(value)) {
      return undefined;
    }
    if ((byte & 0x80) === 0) {
      return { value, next: index + 1 };
    }
    factor *= 128;
  }
  return undefined;
}

function directHash(value: Uint8Array): string | undefined {
  if (value.length === 32) {
    return Buffer.from(value).toString("hex");
  }
  if (value.length === 64) {
    const text = Buffer.from(value).toString("ascii");
    if (HASH_RE.test(text)) {
      return text.toLowerCase();
    }
  }
  return undefined;
}

function nestedHash(value: Uint8Array): string | undefined {
  const direct = directHash(value);
  if (direct) {
    return direct;
  }
  let offset = 0;
  while (offset < value.length) {
    const tag = readVarint(value, offset);
    if (!tag) {
      return undefined;
    }
    offset = tag.next;
    const fieldNumber = Math.floor(tag.value / 8);
    const wireType = tag.value & 7;
    if (wireType !== 2) {
      return undefined;
    }
    const length = readVarint(value, offset);
    if (!length) {
      return undefined;
    }
    offset = length.next;
    const end = offset + length.value;
    if (end > value.length) {
      return undefined;
    }
    if (fieldNumber === 1) {
      const candidate = directHash(value.subarray(offset, end));
      if (candidate) {
        return candidate;
      }
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
    if (!tag || tag.value === 0) {
      return undefined;
    }
    offset = tag.next;
    const fieldNumber = Math.floor(tag.value / 8);
    const wireType = tag.value & 7;
    if (wireType === 0) {
      const skipped = readVarint(data, offset);
      if (!skipped) {
        return undefined;
      }
      offset = skipped.next;
      continue;
    }
    if (wireType === 1) {
      if (offset + 8 > data.length) {
        return undefined;
      }
      offset += 8;
      continue;
    }
    if (wireType === 5) {
      if (offset + 4 > data.length) {
        return undefined;
      }
      offset += 4;
      continue;
    }
    if (wireType !== 2) {
      return undefined;
    }
    const length = readVarint(data, offset);
    if (!length) {
      return undefined;
    }
    offset = length.next;
    const end = offset + length.value;
    if (end > data.length) {
      return undefined;
    }
    if (fieldNumber === currentField || fieldNumber === archiveField) {
      const ref = nestedHash(data.subarray(offset, end));
      if (!ref) {
        return undefined;
      }
      (fieldNumber === archiveField ? parsed.archives : parsed.current).push(ref);
    }
    offset = end;
  }
  return parsed;
}

/**
 * One batch read. The cumulative guard is part of the QUERY, not the row loop:
 * the inner scan projects lengths only (no blob bytes enter the sorter), the
 * window sum orders them deterministically, and `hex(data)` is applied only to
 * the prefix that still fits the remaining total budget. Without it a 64-id
 * batch could materialize 64 × the per-blob cap before any check ran.
 */
function blobSql(ids: string[], maxBlobBytes: number, remainingBytes: number): string {
  const list = ids.map((id) => `'${id}'`).join(", ");
  return `SELECT b.id AS id, hex(b.data) AS data_hex, length(b.data) AS byte_length
FROM blobs b
JOIN (
  SELECT id, SUM(len) OVER (ORDER BY id ROWS UNBOUNDED PRECEDING) AS running_bytes
  FROM (SELECT id, length(data) AS len FROM blobs WHERE id IN (${list}) AND length(data) <= ${maxBlobBytes})
) fit ON fit.id = b.id
WHERE fit.running_bytes <= ${remainingBytes}
LIMIT ${ids.length}`;
}

/** Fetch already-proven root-reachable hashes in bounded batches. Batching is a
 *  transport detail only: every row still passes the same per-blob byte,
 *  SHA-256, blob-count, and total-byte checks a single read applied (round-4 W13). */
async function fetchBlobs(snapshot: SqliteSnapshot, ids: readonly string[], state: BlobFetchState): Promise<void> {
  const pending: string[] = [];
  const requested = new Set<string>();
  for (const id of ids) {
    if (!HASH_RE.test(id) || state.blobs.has(id) || requested.has(id)) {
      continue;
    }
    requested.add(id);
    pending.push(id);
  }

  for (let offset = 0; offset < pending.length; ) {
    const remainingCount = MAX_CURSOR_BLOBS - state.count;
    if (remainingCount <= 0) {
      return;
    }
    const remainingBytes = MAX_CURSOR_STORE_BYTES - state.totalBytes;
    const maxBytes = Math.min(MAX_CURSOR_BLOB_BYTES, remainingBytes);
    if (maxBytes <= 0) {
      return;
    }
    const batch = pending.slice(offset, offset + Math.min(BLOB_BATCH_SIZE, remainingCount));
    offset += batch.length;

    const result = await snapshot.query(blobSql(batch, maxBytes, remainingBytes));
    if (result.status !== "ok") {
      return;
    }
    const wanted = new Set(batch);
    for (const row of result.rows) {
      const id = typeof row.id === "string" ? row.id : undefined;
      if (!id || !wanted.delete(id)) {
        continue;
      }
      const byteLength = Number(row.byte_length);
      if (!Number.isSafeInteger(byteLength) || byteLength > maxBytes) {
        continue;
      }
      const data = decodeHex(row.data_hex, maxBytes * 2);
      if (!data || data.length !== byteLength) {
        continue;
      }
      if (createHash("sha256").update(data).digest("hex") !== id) {
        continue;
      }
      if (state.count >= MAX_CURSOR_BLOBS || state.totalBytes + data.length > MAX_CURSOR_STORE_BYTES) {
        return;
      }
      state.count++;
      state.totalBytes += data.length;
      state.blobs.set(id, data);
    }
  }
}

async function fetchBlob(snapshot: SqliteSnapshot, id: string, state: BlobFetchState): Promise<Buffer | undefined> {
  const normalizedId = id.toLowerCase();
  await fetchBlobs(snapshot, [normalizedId], state);
  return state.blobs.get(normalizedId);
}

function normalizeRecord(data: Buffer): NormalizedRecord | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(data.toString("utf8"));
  } catch {
    return undefined;
  }
  return normalizeCursorRecord(raw);
}

/** `meta_key` requires the supported unique key column and `meta_key_rows` that
 *  exactly one identity row exists: the profile query reads a single value, so
 *  duplicate key-0 rows would otherwise let SQLite pick which identity proves
 *  the store (B16). */
function compatibleProfile(row: Record<string, unknown>): boolean {
  return (
    Number(row.user_version) === 1 &&
    Number(row.meta_columns) === 2 &&
    Number(row.meta_key) === 1 &&
    Number(row.meta_key_rows) === 1 &&
    Number(row.meta_value_column) === 1 &&
    Number(row.blob_columns) === 2 &&
    Number(row.blob_id) === 1 &&
    Number(row.blob_data) === 1
  );
}

interface CursorStoreProfile {
  agentId: string;
  meta: Record<string, unknown>;
}

/**
 * D14/D9: read ONLY the bounded supported store profile plus `meta['0']` — no
 * blob is fetched and no transcript root is followed. Shared by the deferred
 * identity proof (`verifyCursorStoreIdentity`) and full detail decoding
 * (`decodeSnapshot`), so the two paths can never drift on what "compatible and
 * identified" means.
 */
async function readCursorStoreProfile(snapshot: SqliteSnapshot): Promise<CursorStoreProfile | undefined> {
  const profileResult = await snapshot.query(CURSOR_PROFILE_SQL);
  if (profileResult.status !== "ok" || profileResult.rows.length !== 1) {
    return undefined;
  }
  const profile = profileResult.rows[0];
  if (!compatibleProfile(profile)) {
    return undefined;
  }

  const metaBytes = decodeHex(profile.meta_value, MAX_META_HEX_CHARS);
  if (!metaBytes) {
    return undefined;
  }
  let meta: Record<string, unknown> | undefined;
  try {
    meta = asObject(JSON.parse(metaBytes.toString("utf8")));
  } catch {
    return undefined;
  }
  if (!meta || typeof meta.agentId !== "string") {
    return undefined;
  }
  return { agentId: meta.agentId, meta };
}

async function decodeSnapshot(snapshot: SqliteSnapshot, expectedAgentId: string): Promise<CursorStoreResult> {
  const profile = await readCursorStoreProfile(snapshot);
  if (!profile) {
    return limited();
  }
  if (profile.agentId !== expectedAgentId) {
    return identityContradicted();
  }
  const rootValue =
    typeof profile.meta.latestRootBlobId === "string" ? profile.meta.latestRootBlobId : profile.meta.rootBlobId;
  if (typeof rootValue !== "string" || !HASH_RE.test(rootValue)) {
    return limited();
  }

  const fetchState: BlobFetchState = { blobs: new Map(), totalBytes: 0, count: 0 };
  const root = await fetchBlob(snapshot, rootValue, fetchState);
  if (!root) {
    return limited();
  }
  const rootRefs = parseReferenceFields(root, 1, 13);
  if (!rootRefs) {
    return limited();
  }

  const orderedMessageRefs: string[] = [];
  await fetchBlobs(snapshot, rootRefs.archives, fetchState);
  for (const archiveId of rootRefs.archives) {
    const archive = fetchState.blobs.get(archiveId);
    if (!archive) {
      return limited();
    }
    const archiveRefs = parseReferenceFields(archive, 1);
    if (!archiveRefs) {
      return limited();
    }
    orderedMessageRefs.push(...archiveRefs.current);
  }
  orderedMessageRefs.push(...rootRefs.current);
  await fetchBlobs(snapshot, orderedMessageRefs, fetchState);

  const timeline: VaultTimelineItem[] = [];
  const recentActivity: VaultActivityStep[] = [];
  const subagentsByCallId = new Map<string, CursorSubagentStep>();
  const subagentsByTaskId = new Map<string, CursorSubagentStep>();
  const pendingResults = new Map<string, CursorToolResult>();
  const seen = new Set<string>();
  let normalizedTextChars = 0;
  let messageCount = 0;
  let toolCount = 0;
  const applyToolResult = (step: CursorSubagentStep, result: CursorToolResult) => {
    if (result.childAgentId) {
      step.childAgentId = result.childAgentId;
    }
    if (step.background) {
      step.status = "running";
      if (result.taskId) {
        subagentsByTaskId.set(result.taskId, step);
      }
      return;
    }
    step.result = result.result;
    step.status = "completed";
  };

  for (const ref of orderedMessageRefs) {
    if (seen.has(ref)) {
      continue;
    }
    seen.add(ref);
    const data = fetchState.blobs.get(ref);
    if (!data) {
      return limited();
    }
    const record = normalizeRecord(data);
    if (!record) {
      return limited();
    }
    normalizedTextChars += record.textChars;
    if (normalizedTextChars > MAX_NORMALIZED_TEXT_CHARS) {
      return limited();
    }
    for (const call of record.subagentCalls) {
      if (!call.callId) {
        continue;
      }
      subagentsByCallId.set(call.callId, call.step);
      const pending = pendingResults.get(call.callId);
      if (pending) {
        pendingResults.delete(call.callId);
        applyToolResult(call.step, pending);
      }
    }
    for (const result of record.toolResults) {
      const step = subagentsByCallId.get(result.callId);
      if (step) {
        applyToolResult(step, result);
      } else {
        pendingResults.set(result.callId, result);
      }
    }
    let correlatedNotice = false;
    if (record.notice) {
      const step = subagentsByTaskId.get(record.notice.taskId);
      if (step) {
        if (record.notice.result) {
          step.result = record.notice.result;
        }
        if (record.notice.childAgentId) {
          step.childAgentId = record.notice.childAgentId;
        }
        step.status = "completed";
        correlatedNotice = true;
      }
    }
    timeline.push(...(correlatedNotice ? record.timeline.filter((item) => item.kind !== "notice") : record.timeline));
    recentActivity.push(...record.activity);
    messageCount += record.messageCount;
    toolCount += record.toolCount;
  }

  // One agent, many invocations: give each its agent's declared type before
  // anything counts or links them, resolving that type across both arrays so a
  // display cut cannot hide the declaring launch (D2).
  const declaredTypes = collectCursorAgentTypes(timeline, recentActivity);
  const mergedActivity = mergeCursorSubagentInvocations(recentActivity, declaredTypes);
  return {
    status: "ok",
    timeline: mergeCursorSubagentInvocations(timeline, declaredTypes),
    recentActivity: mergedActivity,
    stats: {
      messageCount,
      toolCount,
      subagentCount: countCursorAgents(mergedActivity),
    },
  };
}

export async function readCursorStoreDetail(
  dbPath: string,
  expectedAgentId: string,
  options: CursorStoreOptions = {},
): Promise<CursorStoreResult> {
  if (!SAFE_AGENT_ID_RE.test(expectedAgentId) || expectedAgentId.includes("..")) {
    return limited();
  }
  const snapshotResult = await (options.withSqliteSnapshotFn ?? withSqliteSnapshot)(dbPath, (snapshot) =>
    decodeSnapshot(snapshot, expectedAgentId),
  );
  return snapshotResult.status === "ok" ? snapshotResult.value : limited();
}

/**
 * D14 explicit Resume identity proof: open one WAL-aware disposable snapshot,
 * read only the bounded supported store profile plus `meta['0']`, and require
 * `agentId === expectedAgentId`. An unavailable (missing/locked), malformed, or
 * unsupported store, and a mismatched identity, all reject the same way — the
 * caller never learns WHY, only that Resume/Copy must not proceed. Never fetches
 * a blob, so it cannot follow a transcript root.
 */
export async function verifyCursorStoreIdentity(
  dbPath: string,
  expectedAgentId: string,
  options: CursorStoreOptions = {},
): Promise<boolean> {
  if (!SAFE_AGENT_ID_RE.test(expectedAgentId) || expectedAgentId.includes("..")) {
    return false;
  }
  const snapshotResult = await (options.withSqliteSnapshotFn ?? withSqliteSnapshot)(dbPath, async (snapshot) => {
    const profile = await readCursorStoreProfile(snapshot);
    return profile?.agentId === expectedAgentId;
  });
  return snapshotResult.status === "ok" && snapshotResult.value === true;
}
