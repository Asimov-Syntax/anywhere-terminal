// src/vault/readers/opencodeReader.ts — Read OpenCode sessions (SQLite only).
// See: specs/agent-session-index/spec.md (Read OpenCode sessions), design.md D3,D8,
//      docs/research/20260528-cmux-vault-mechanism.md §7.
//
// Source is the `session` table of ~/.local/share/opencode/opencode.db, with a
// correlated subquery for the latest assistant `message` to recover the model +
// agent. OpenCode has no JSONL fallback: an absent DB contributes zero entries.

import * as os from "node:os";
import * as path from "node:path";
import type { ReaderListCache, ReaderResultWithState } from "../cacheTypes";
import { boundedPreview } from "../preview";
import { readSqlite, withSqliteSnapshot, writeSqlite } from "../sqlite";
import { sameStamps, stampStoreFiles } from "../storeStamp";
import {
  formatEntryId,
  type VaultActivityStep,
  type VaultMessageTokens,
  type VaultSessionDetail,
  type VaultSessionEntry,
  type VaultTimelineItem,
} from "../types";
import {
  boundActivity,
  boundTimeline,
  buildQuestionOptions,
  type DetailParts,
  finalizeDetail,
  MAX_MESSAGE_TEXT,
  normalizeRich,
  type QuestionPair,
  sourceVerdict,
  truncate,
  truncateRich,
} from "./detail";
import { MAX_RECORD_BYTES, type RecordLineResult } from "./recordLine";

/** Bound the read so the vault list stays cheap (D2). */
const ROW_LIMIT = 500;

// Bound the per-session detail read by keeping BOTH the head and the tail of the
// `message`/`part` streams (mirrors the Claude reader's head+tail buffer —
// detail.ts createBoundedRecordBuffer). A head-only ASC read drops the tail once
// a long session exceeds the budget — the part budget goes first (many parts per
// turn) — which silently hid the final assistant message from the preview.
const DETAIL_MESSAGE_HEAD = 100;
const DETAIL_MESSAGE_TAIL = 2000;
const DETAIL_PART_HEAD = 1000;
const DETAIL_PART_TAIL = 4000;
/** Bound the direct-child stubs embedded in a parent's detail timeline. */
const CHILD_LIMIT = 100;

// Shared SELECT (columns + correlated title/first-prompt subqueries). The list
// adds the top-level `parent_id` filter + ordering/limit; the single-entry resolve
// (readOpenCodeEntry) adds `WHERE s.id = ?` and keeps no filter so a child session
// is still resolvable by id for resume.
const OPENCODE_SESSION_SELECT = `SELECT s.id, s.title, s.directory, s.time_updated, (
    SELECT data FROM message
    WHERE session_id = s.id AND data LIKE '%"role":"assistant"%'
    ORDER BY time_created DESC LIMIT 1
) AS last_assistant, (
    SELECT p.data FROM part p JOIN message m ON p.message_id = m.id
    WHERE p.session_id = s.id AND m.data LIKE '%"role":"user"%'
      AND p.data LIKE '%"type":"text"%' AND p.data NOT LIKE '%"synthetic":true%'
    ORDER BY p.time_created ASC LIMIT 1
) AS first_user_part
FROM session s`;

const OPENCODE_SESSION_SQL = `${OPENCODE_SESSION_SELECT}
WHERE s.parent_id IS NULL OR s.parent_id = ''
ORDER BY s.time_updated DESC
LIMIT ${ROW_LIMIT}`;

export interface OpenCodeReaderOptions {
  home?: string;
  /** Override `~/.local/share/opencode`. */
  dataDir?: string;
  /** Injectable for tests; defaults to the real WAL-safe reader. */
  readSqliteFn?: typeof readSqlite;
  /** Injectable for tests; defaults to the real live-DB writer. */
  writeSqliteFn?: typeof writeSqlite;
  /** Injectable for tests; defaults to the real one-copy snapshot reader. */
  withSqliteSnapshotFn?: typeof withSqliteSnapshot;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") {
    return v || undefined;
  }
  if (typeof v === "number") {
    return String(v);
  }
  return undefined;
}

/** Recover model (provider/model) + agent from the latest assistant message JSON. */
function parseAssistant(raw: unknown): { model?: string; agent?: string } {
  if (typeof raw !== "string" || !raw) {
    return {};
  }
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") {
      return {};
    }
    const providerID = asString(obj.providerID);
    const modelID = asString(obj.modelID);
    const agent = asString(obj.agent);
    const model = providerID && modelID ? `${providerID}/${modelID}` : (modelID ?? providerID);
    return { model, agent };
  } catch {
    return {}; // malformed assistant JSON → no model/agent, entry still listed (D8)
  }
}

/** OpenCode's default title before it summarizes is `New session - <ISO ts>`.
 *  Treat that (and an empty title) as "no title" so we fall back to the prompt. */
function isPlaceholderTitle(title: string): boolean {
  return /^New session\b/i.test(title.trim());
}

/**
 * OpenCode names a subtask (subagent) session `<description> (@<agent> subagent)`
 * — e.g. `Review logic architecture (@asm-review-logic subagent)`. The webview
 * already shows the agent as its own `@<agent>` chip, so leaving the suffix in
 * makes it render twice (`@asm-review-logic · … (@asm-review-logic subagent)`).
 * Split the suffix off: return the clean description plus the embedded agent, so
 * the agent can also be RECOVERED when the row's own `agent` column is empty (it
 * frequently is for nested spawns). No match → the title is returned untouched
 * with no agent.
 *
 * The agent is captured as `[^)]+?` — "anything up to the structural ` subagent)`
 * tail, minus a literal `)`" — NOT a restricted id class: OpenCode interpolates the
 * raw `subagent_type` string into `… (@<name> subagent)` with no character limit, so
 * a custom name containing spaces / slashes must still be split off and recovered.
 * The lazy `.*?` description plus the `)`-excluding agent class means a description
 * that itself contains an earlier `(@foo)` is not mis-split — only the trailing
 * ` (@… subagent)` matches. Anchored at both ends with the literal `subagent)` tail,
 * so it stays linear on the short session-title input. */
export function splitOpencodeSubtaskTitle(rawTitle: string): { title: string; agent?: string } {
  const m = /^(.*?)\s*\(@([^)]+?)\s+subagent\)\s*$/.exec(rawTitle);
  const agent = m?.[2].trim();
  if (m && agent) {
    // The description MAY be empty (an empty/near-empty task description still
    // yields a bare ` (@<agent> subagent)` title). Return it as-is and let the
    // caller fall back to the first message — the agent is still recovered here.
    return { title: m[1].trim(), agent };
  }
  return { title: rawTitle.trim() };
}

/** First user message text from the `first_user_part` subquery (a text part). */
function firstUserPartText(raw: unknown): string | undefined {
  return strField(parseJsonData(raw)?.text);
}

function mapSessionRow(row: Record<string, unknown>): VaultSessionEntry | null {
  const sessionId = asString(row.id);
  if (!sessionId) {
    return null;
  }
  const { model, agent } = parseAssistant(row.last_assistant);
  // Prefer the session's real title; fall back to the first user message when
  // the title is absent or OpenCode's placeholder (#5).
  const rawTitle = asString(row.title);
  const title =
    rawTitle && !isPlaceholderTitle(rawTitle) ? rawTitle : (firstUserPartText(row.first_user_part) ?? rawTitle ?? "");
  return {
    id: formatEntryId("opencode", sessionId),
    agent: "opencode",
    sessionId,
    title: boundedPreview(title),
    cwd: asString(row.directory) ?? "",
    modified: Number(row.time_updated) || 0,
    flags: { model, agent },
    canFork: false, // resolved by VaultService (task 2_5)
  };
}

/** Resolve the opencode db path + sqlite reader, shared by the list and single-entry paths. */
function resolveOpencodePaths(options: OpenCodeReaderOptions): {
  dbPath: string;
  readSqliteFn: typeof readSqlite;
} {
  const home = options.home ?? os.homedir();
  // OpenCode resolves its data dir via the `xdg-basedir` package, which is the
  // SAME on every OS (it is NOT OS-aware): `$XDG_DATA_HOME/opencode` else
  // `~/.local/share/opencode` — including Windows (`%USERPROFILE%\.local\share`,
  // NOT %APPDATA%). Mirror that here. See docs/research/20260529-cross-platform-store-paths-sqlite.md.
  const xdgData = process.env.XDG_DATA_HOME?.trim() || path.join(home, ".local", "share");
  const dataDir = options.dataDir ?? path.join(xdgData, "opencode");
  return { dbPath: path.join(dataDir, "opencode.db"), readSqliteFn: options.readSqliteFn ?? readSqlite };
}

/** Public store paths for FS-watch targets (enhance-vault-sessions D4/D5) — the
 *  single source of truth so watchers don't drift from the reader's resolution. */
export function opencodeStoreDirs(options: OpenCodeReaderOptions = {}): { dbPath: string; dataDir: string } {
  const { dbPath } = resolveOpencodePaths(options);
  return { dbPath, dataDir: path.dirname(dbPath) };
}

/**
 * Write a user-chosen title into OpenCode's own store (`session.title`), keyed by
 * session id (write-vault-rename-to-store D1/D2). `name` is bound as a parameter;
 * `sessionId` is guarded by `isSafeOpenCodeId` first. The write is scoped to ROOT
 * sessions (`parent_id IS NULL OR parent_id = ''`) — the same visibility as the
 * list query — so a forged/stale id for a hidden child (subagent) session can't
 * mutate its title (review W2). Returns true iff a row was updated — false (→
 * overlay fallback) for an unsafe id, a non-root id, or any non-`ok` write status.
 * OpenCode's `ensureTitle` only runs while the title is its default placeholder, so
 * an explicit title set here is not auto-regenerated.
 */
export async function renameOpenCodeSession(
  sessionId: string,
  name: string,
  options: OpenCodeReaderOptions = {},
): Promise<boolean> {
  if (!isSafeOpenCodeId(sessionId)) {
    return false;
  }
  const { dbPath } = resolveOpencodePaths(options);
  const writeFn = options.writeSqliteFn ?? writeSqlite;
  const result = await writeFn(
    dbPath,
    "UPDATE session SET title = ? WHERE id = ? AND (parent_id IS NULL OR parent_id = '')",
    [name, sessionId],
  );
  return result.status === "ok" && result.changes > 0;
}

export async function readOpenCodeSessions(
  options: OpenCodeReaderOptions = {},
  prev?: ReaderListCache,
): Promise<ReaderResultWithState> {
  const { dbPath, readSqliteFn } = resolveOpencodePaths(options);

  // Skip the snapshot clone + query when the DB (+ -wal) is unchanged since the
  // cache was written (cache-vault-load D3). Guarded on a non-empty stamp set so
  // an absent DB falls through to the query (→ zero entries) rather than reusing {}.
  const sources = await stampStoreFiles([dbPath, `${dbPath}-wal`]);
  if (prev?.kind === "store" && Object.keys(sources).length > 0 && sameStamps(prev.sources, sources)) {
    const u = prev.unreadable ?? 0;
    return {
      entries: prev.entries,
      unreadable: u,
      cache: { kind: "store", sources, entries: prev.entries, unreadable: u },
    };
  }

  const result = await readSqliteFn(dbPath, OPENCODE_SESSION_SQL);

  if (result.status === "query-error") {
    // Cache EMPTY sources so a query-error is retried next refresh, not reused as
    // an empty success (oracle review).
    return { entries: [], unreadable: 1, cache: { kind: "store", sources: {}, entries: [], unreadable: 1 } };
  }
  if (result.status !== "ok") {
    // no-db / no-sqlite3 → zero entries; empty sources so the next refresh re-reads.
    return { entries: [], unreadable: 0, cache: { kind: "store", sources: {}, entries: [], unreadable: 0 } };
  }

  const entries: VaultSessionEntry[] = [];
  let unreadable = 0;
  for (const row of result.rows) {
    const entry = mapSessionRow(row);
    if (entry) {
      entries.push(entry);
    } else {
      unreadable++;
    }
  }
  return { entries, unreadable, cache: { kind: "store", sources, entries, unreadable } };
}

/**
 * Resolve ONE OpenCode session to its launch entry by id — the single-entry
 * counterpart to readOpenCodeSessions, used by VaultService.getEntry for fast
 * resume/fork (a point lookup, not the full-store scan; D3). No `parent_id`
 * filter so a child (subagent) session is still resolvable by id. Returns null
 * for an unsafe id or a missing row.
 */
export async function readOpenCodeEntry(
  sessionId: string,
  options: OpenCodeReaderOptions = {},
): Promise<VaultSessionEntry | null> {
  if (!isSafeOpenCodeId(sessionId)) {
    return null;
  }
  const { dbPath, readSqliteFn } = resolveOpencodePaths(options);
  // `sessionId` is validated to `[A-Za-z0-9_-]+` above, so embedding it is safe.
  const result = await readSqliteFn(dbPath, `${OPENCODE_SESSION_SELECT} WHERE s.id = '${sessionId}' LIMIT 1`);
  if (result.status !== "ok" || result.rows.length === 0) {
    return null;
  }
  return mapSessionRow(result.rows[0]);
}

// ── On-demand session detail (redesign-vault-panel-ui 2_3) ──────────────────

/** A parsed `message` row for the pure mapper. */
export interface OcMessageRow {
  id: string;
  timeCreated: number;
  data: Record<string, unknown>;
}
/** A parsed `part` row for the pure mapper. */
export interface OcPartRow {
  messageId: string;
  timeCreated: number;
  data: Record<string, unknown>;
}

/** OpenCode session ids are `ses_<base62>` — validated before any SQL embed. */
function isSafeOpenCodeId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id);
}

function strField(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function objField(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Concise primary argument for an OpenCode tool call (lowercase tool names, `filePath` inputs). */
function opencodeToolLabel(tool: string, input: Record<string, unknown>): string | undefined {
  switch (tool) {
    case "read":
    case "edit":
    case "write":
      return strField(input.filePath) ?? strField(input.file_path);
    case "bash":
      return strField(input.command);
    case "grep":
    case "glob":
      return strField(input.pattern);
    case "webfetch":
      return strField(input.url);
    default: {
      for (const v of Object.values(input)) {
        const s = strField(v);
        if (s) {
          return s;
        }
      }
      return undefined;
    }
  }
}

/**
 * AskUserQuestion ("question") tool → structured Q&A pairs: each question paired
 * with the option label(s) the user picked (`state.metadata.answers` — an array
 * per question). `answer` is left absent while the call is still pending (status
 * not `completed`, or no answer recorded) so the preview shows "awaiting answer".
 */
function opencodeQuestionPairs(state: Record<string, unknown>): QuestionPair[] {
  const input = objField(state.input) ?? {};
  const questions = Array.isArray(input.questions) ? input.questions : [];
  const meta = objField(state.metadata) ?? {};
  const answers = Array.isArray(meta.answers) ? meta.answers : [];
  const pairs: QuestionPair[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = objField(questions[i]);
    const prompt = strField(q?.question) ?? strField(q?.header);
    if (!prompt) {
      continue;
    }
    const picked = Array.isArray(answers[i])
      ? (answers[i] as unknown[]).map((a) => strField(a)).filter((s): s is string => !!s)
      : [];
    const options = buildQuestionOptions(Array.isArray(q?.options) ? q.options : [], new Set(picked));
    pairs.push({
      prompt: truncate(prompt),
      ...(picked.length ? { answer: truncate(picked.join(", ")) } : {}),
      ...(options.length ? { options } : {}),
    });
  }
  return pairs;
}

/** Count added/removed lines from a unified-diff string (cheap, best-effort). */
function diffStat(metadata: unknown): { added: number; removed: number } | undefined {
  const d = objField(metadata)?.diff;
  if (typeof d !== "string") {
    return undefined;
  }
  let added = 0;
  let removed = 0;
  for (const line of d.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed++;
    }
  }
  return added === 0 && removed === 0 ? undefined : { added, removed };
}

/** A message is synthetic/compaction when flagged as a summary. */
function isSyntheticMessage(data: Record<string, unknown>): boolean {
  return data.summary === true;
}

/** Capitalize a lowercase tool name for display ("read" → "Read"). */
function titleCase(name: string): string {
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

/**
 * Pure: reconstruct bounded session detail from OpenCode `message` + `part`
 * rows (redesign-vault-panel-ui D4/D6). Tool/subtask are first-class parts;
 * synthetic/compaction messages are excluded from first/latest selection.
 */
export function mapOpencodeRows(
  messages: OcMessageRow[],
  parts: OcPartRow[],
  limit?: number,
  childStubs: { timestamp: number; item: VaultTimelineItem }[] = [],
): DetailParts {
  const msgs = [...messages].sort((a, b) => a.timeCreated - b.timeCreated);
  const ordered = [...parts].sort((a, b) => a.timeCreated - b.timeCreated);

  // Text per message, ignoring synthetic text parts.
  const textByMessage = new Map<string, string[]>();
  for (const p of ordered) {
    if (p.data.type === "text" && p.data.synthetic !== true) {
      const t = strField(p.data.text);
      if (t) {
        const list = textByMessage.get(p.messageId) ?? [];
        list.push(t);
        textByMessage.set(p.messageId, list);
      }
    }
  }

  let firstPrompt: string | undefined;
  let latestMessage: VaultSessionDetail["latestMessage"];
  let messageCount = 0;
  let tokenCount = 0;
  let sawTokens = false;
  // Timeline items carry their source timestamp so messages + tool/subtask parts
  // can be merged into one chronological stream below.
  const tl: { ts: number; item: VaultTimelineItem }[] = [];

  for (const m of msgs) {
    if (isSyntheticMessage(m.data)) {
      continue;
    }
    // Skip malformed / unknown-role rows so they don't inflate the count (W7).
    const role = m.data.role;
    if (role !== "user" && role !== "assistant") {
      continue;
    }
    // Per-message model + tokens (enhance-vault-sessions D3). Assistant only.
    let msgModel: string | undefined;
    let msgTokens: VaultMessageTokens | undefined;
    if (role === "assistant") {
      // A real assistant turn counts even when it's tool-only (no text), mirroring
      // the Claude classifier; tokens accrue regardless of visible text.
      messageCount++;
      const providerID = strField(m.data.providerID);
      const modelID = strField(m.data.modelID);
      msgModel = providerID && modelID ? `${providerID}/${modelID}` : (modelID ?? providerID);
      const tokens = objField(m.data.tokens);
      if (tokens) {
        sawTokens = true;
        const cache = objField(tokens.cache) ?? {};
        tokenCount +=
          num(tokens.input) + num(tokens.output) + num(tokens.reasoning) + num(cache.read) + num(cache.write);
        // "context" size = prompt tokens (input + cache read/creation); output =
        // generated. OpenCode records reasoning separately, but Claude/Codex fold it
        // into their output — add it here so `output` means the same across agents.
        msgTokens = {
          input: num(tokens.input) + num(cache.read) + num(cache.write),
          output: num(tokens.output) + num(tokens.reasoning),
        };
      }
    }
    const text = (textByMessage.get(m.id) ?? []).join(" ").trim();
    if (text) {
      if (role === "user") {
        // A user row counts only when it carries real text (a tool-result-only
        // user row is plumbing, not a turn) (W7).
        messageCount++;
        if (firstPrompt === undefined) {
          firstPrompt = truncate(text);
        }
      }
      latestMessage = { role, text: truncate(text), timestamp: m.timeCreated };
      // Assistant bodies render in full; user prompts stay length-capped.
      const body = role === "assistant" ? normalizeRich(text) : truncateRich(text, MAX_MESSAGE_TEXT);
      tl.push({
        ts: m.timeCreated,
        item: {
          kind: "message",
          role,
          text: body,
          timestamp: m.timeCreated,
          ...(msgModel ? { model: msgModel } : {}),
          ...(msgTokens ? { tokens: msgTokens } : {}),
          msgRef: m.id, // the message row id addresses the record (D4)
        },
      });
    }
  }

  const activity: VaultActivityStep[] = [];
  let toolCount = 0;
  let subagentCount = 0;
  for (const p of ordered) {
    const type = p.data.type;
    if (type === "tool") {
      toolCount++;
      const tool = strField(p.data.tool) ?? "tool";
      const state = objField(p.data.state) ?? {};
      // AskUserQuestion is a user decision point, not plumbing — surface it as a
      // first-class question item (the Q + the user's answer) rather than a bare
      // "Question" tool chip that would collapse inside a run. An ERRORED question
      // (rejected/aborted) is skipped here so it falls back to a tool chip instead
      // of misrendering as "Awaiting answer"; pending/running/completed still map.
      if (tool === "question" && strField(state.status) !== "error") {
        const pairs = opencodeQuestionPairs(state);
        if (pairs.length > 0) {
          tl.push({ ts: p.timeCreated, item: { kind: "question", questions: pairs, timestamp: p.timeCreated } });
          continue;
        }
      }
      const input = objField(state.input) ?? {};
      const label = opencodeToolLabel(tool, input);
      const diff = tool === "edit" ? diffStat(state.metadata) : undefined;
      const step: VaultActivityStep = {
        kind: "tool",
        tool: titleCase(tool),
        detail: label ? truncate(label) : undefined,
        diff,
      };
      activity.push(step);
      tl.push({ ts: p.timeCreated, item: step });
    } else if (type === "subtask") {
      subagentCount++;
      const name = strField(p.data.agent) ?? "subagent";
      const prompt = strField(p.data.prompt) ?? strField(p.data.description);
      const step: VaultActivityStep = { kind: "subagent", name, prompt: prompt ? truncate(prompt) : undefined };
      activity.push(step);
      tl.push({ ts: p.timeCreated, item: step });
    } else if (type === "reasoning") {
      const t = strField(p.data.text);
      if (t) {
        tl.push({ ts: p.timeCreated, item: { kind: "thinking", text: truncateRich(t, MAX_MESSAGE_TEXT) } });
      }
    }
  }

  // Nested sub-sessions (subagents / workflow children, linked by parent_id)
  // interleave at their spawn time alongside messages + tool/subtask steps.
  for (const c of childStubs) {
    tl.push({ ts: c.timestamp, item: c.item });
  }

  // Merge messages + tool/subtask steps into one chronological stream (stable
  // sort keeps same-timestamp items in their original push order).
  const merged = tl
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => a.ts - b.ts || a.i - b.i)
    .map((x) => x.item);
  const bounded = boundTimeline(merged, limit);

  return {
    firstPrompt,
    recentActivity: boundActivity(activity),
    latestMessage,
    timeline: bounded.timeline,
    ...(bounded.truncated ? { truncated: true } : {}),
    stats: {
      messageCount,
      toolCount,
      // Prefer the count of real child sub-sessions; fall back to subtask parts.
      subagentCount: childStubs.length > 0 ? childStubs.length : subagentCount,
      ...(sawTokens && tokenCount > 0 ? { tokenCount } : {}),
    },
  };
}

/**
 * On-demand bounded detail for an OpenCode session — queries its `message` +
 * `part` rows by id (no full-table scan) and maps them. Returns null when the
 * id is unsafe, the query fails, or no rows exist (session not found).
 */
/**
 * One message row plus its parts, as JSON — OpenCode's "record" is rows in a DB,
 * not a transcript line, so the Raw copy is the row set serialized here (D5).
 */
export async function readOpenCodeMessageRecord(
  sessionId: string,
  msgRef: string,
  options: OpenCodeReaderOptions = {},
  maxBytes = MAX_RECORD_BYTES,
): Promise<RecordLineResult> {
  if (!isSafeOpenCodeId(sessionId) || !isSafeOpenCodeId(msgRef)) {
    return { ok: false, reason: "not-found" };
  }
  const { dbPath, readSqliteFn } = resolveOpencodePaths(options);
  // Both ids are validated to `[A-Za-z0-9_-]+` above, so they introduce no
  // injectable characters into these static queries. Preflight JSON encoding in
  // SQLite before payload rows cross into the extension host (review B3).
  const messageWhere = `id = '${msgRef}' AND session_id = '${sessionId}'`;
  const partWhere = `message_id = '${msgRef}' AND session_id = '${sessionId}'`;
  const rowJson = "json_object('id', id, 'time_created', time_created, 'data', data)";
  const result = await readSqliteFn(
    dbPath,
    `WITH message_row AS (
      SELECT ${rowJson} AS row_json FROM message WHERE ${messageWhere} LIMIT 1
    ), part_rows AS (
      SELECT id, time_created, ${rowJson} AS row_json FROM part WHERE ${partWhere}
    ), record_size AS (
      SELECT
        (SELECT length(CAST(row_json AS BLOB)) FROM message_row)
        + COALESCE((SELECT SUM(length(CAST(row_json AS BLOB))) FROM part_rows), 0)
        + COALESCE((SELECT COUNT(*) FROM part_rows), 0) + 64 AS source_bytes
    )
    SELECT record_size.source_bytes,
      CASE WHEN record_size.source_bytes <= ${Math.max(0, Math.floor(maxBytes))} THEN (
        SELECT json_object(
          'message', json(message_row.row_json),
          'parts', json(COALESCE((
            SELECT json_group_array(json(row_json)) FROM (
              SELECT row_json FROM part_rows ORDER BY time_created ASC, id ASC
            )
          ), '[]'))
        ) FROM message_row
      ) END AS record_json
    FROM record_size
    WHERE EXISTS (SELECT 1 FROM message_row)`,
  );
  const row = result.status === "ok" ? result.rows[0] : undefined;
  if (!row) {
    return { ok: false, reason: "not-found" };
  }
  if (num(row.source_bytes) > maxBytes) {
    return { ok: false, reason: "too-large" };
  }
  if (typeof row.record_json !== "string") {
    return { ok: false, reason: "not-found" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.record_json);
  } catch {
    return { ok: false, reason: "not-found" };
  }
  const line = JSON.stringify(parsed, null, 2);
  return Buffer.byteLength(line, "utf8") > maxBytes ? { ok: false, reason: "too-large" } : { ok: true, line };
}

export async function readOpenCodeDetail(
  sessionId: string,
  options: OpenCodeReaderOptions = {},
  limit?: number,
): Promise<VaultSessionDetail | null> {
  if (!isSafeOpenCodeId(sessionId)) {
    return null;
  }
  const { dbPath } = resolveOpencodePaths(options);

  // `sessionId` is validated to `[A-Za-z0-9_-]+` above, so embedding it in the
  // static query introduces no injectable characters (no quotes/semicolons).
  // Per table a head window (ASC) preserves firstPrompt + early context and a tail
  // window (DESC) preserves the final assistant message + recent timeline; the two
  // are unioned and de-duplicated by row id below (they overlap on short sessions).
  // `time_created` alone is not a total order, and tied rows let both windows miss
  // the same row while overlapping elsewhere — so the tie-break is `id`, reversed
  // exactly between head and tail to keep the two windows complementary.
  const msgHeadSql = `SELECT id, time_created, data FROM message WHERE session_id = '${sessionId}' ORDER BY time_created ASC, id ASC LIMIT ${DETAIL_MESSAGE_HEAD}`;
  const msgTailSql = `SELECT id, time_created, data FROM message WHERE session_id = '${sessionId}' ORDER BY time_created DESC, id DESC LIMIT ${DETAIL_MESSAGE_TAIL}`;
  const partHeadSql = `SELECT id, message_id, time_created, data FROM part WHERE session_id = '${sessionId}' ORDER BY time_created ASC, id ASC LIMIT ${DETAIL_PART_HEAD}`;
  const partTailSql = `SELECT id, message_id, time_created, data FROM part WHERE session_id = '${sessionId}' ORDER BY time_created DESC, id DESC LIMIT ${DETAIL_PART_TAIL}`;
  // Direct children (subagents / workflow sub-sessions) of this session, with a
  // first-user-message subquery (reused from the list SQL) for the collapsed stub.
  // Omission has to be PROVEN, not inferred from the two windows failing to
  // overlap: at exactly DETAIL_MESSAGE_HEAD + DETAIL_MESSAGE_TAIL rows both
  // windows are full and disjoint while their union still covers every row.
  // One row past the retained capacity is that proof, and OFFSET stops there
  // instead of counting the session's whole history.
  const msgProbeSql = `SELECT id FROM message WHERE session_id = '${sessionId}' LIMIT 1 OFFSET ${DETAIL_MESSAGE_HEAD + DETAIL_MESSAGE_TAIL}`;
  const partProbeSql = `SELECT id FROM part WHERE session_id = '${sessionId}' LIMIT 1 OFFSET ${DETAIL_PART_HEAD + DETAIL_PART_TAIL}`;
  const childrenSql = `SELECT s.id, s.title, s.agent, s.time_created, (
      SELECT p.data FROM part p JOIN message m ON p.message_id = m.id
      WHERE p.session_id = s.id AND m.data LIKE '%"role":"user"%'
        AND p.data LIKE '%"type":"text"%' AND p.data NOT LIKE '%"synthetic":true%'
      ORDER BY p.time_created ASC LIMIT 1
    ) AS first_user_part
    FROM session s WHERE s.parent_id = '${sessionId}' ORDER BY s.time_created ASC LIMIT ${CHILD_LIMIT}`;

  // One snapshot for every query: `readSqlite` copies the live DB per call, so
  // independent reads could compare a probe against windows from another version
  // of the database and prove nothing about either.
  const read = await (options.withSqliteSnapshotFn ?? withSqliteSnapshot)(dbPath, async (snapshot) => {
    const [msgHeadRes, msgTailRes, partHeadRes, partTailRes, childRes, msgProbeRes, partProbeRes] = await Promise.all([
      snapshot.query(msgHeadSql),
      snapshot.query(msgTailSql),
      snapshot.query(partHeadSql),
      snapshot.query(partTailSql),
      snapshot.query(childrenSql),
      snapshot.query(msgProbeSql),
      snapshot.query(partProbeSql),
    ]);
    return { msgHeadRes, msgTailRes, partHeadRes, partTailRes, childRes, msgProbeRes, partProbeRes };
  });
  if (read.status !== "ok") {
    return null;
  }
  const { msgHeadRes, msgTailRes, partHeadRes, partTailRes, childRes, msgProbeRes, partProbeRes } = read.value;
  if (
    msgHeadRes.status !== "ok" ||
    msgTailRes.status !== "ok" ||
    partHeadRes.status !== "ok" ||
    partTailRes.status !== "ok" ||
    // `partial` means source omission and nothing else, so an unproven read has
    // no honest value to report and fails like any other failed query here.
    msgProbeRes.status !== "ok" ||
    partProbeRes.status !== "ok"
  ) {
    return null;
  }
  const msgRows = dedupeById([...msgHeadRes.rows, ...msgTailRes.rows]);
  if (msgRows.length === 0) {
    return null; // session not found in the store
  }
  const partRows = dedupeById([...partHeadRes.rows, ...partTailRes.rows]);

  const messages = parseMessageRows(msgRows);
  const parts = parsePartRows(partRows);
  const childStubs = childRes.status === "ok" ? buildChildStubs(childRes.rows) : [];
  const messageHeadIds = new Set(msgHeadRes.rows.map((row) => asString(row.id)).filter((id): id is string => !!id));
  const messageTailIds = new Set(msgTailRes.rows.map((row) => asString(row.id)).filter((id): id is string => !!id));
  // A source row past the retained capacity is the proof of omission.
  const messageWindowTruncated = msgProbeRes.rows.length > 0;
  const windowTruncated = messageWindowTruncated || partProbeRes.rows.length > 0;
  // Parts, not a detail: the constructor owns `entryId` and the verdict fields,
  // so nothing here carries one for it to have to override.
  const detail: DetailParts = mapOpencodeRows(messages, parts, limit, childStubs);
  if (messageWindowTruncated) {
    const firstTail = detail.timeline.findIndex(
      (item) => item.kind === "message" && !!item.msgRef && messageTailIds.has(item.msgRef),
    );
    const keepsHead = detail.timeline
      .slice(0, firstTail < 0 ? 0 : firstTail)
      .some((item) => item.kind === "message" && !!item.msgRef && messageHeadIds.has(item.msgRef));
    if (firstTail >= 0 && keepsHead) {
      detail.timeline.splice(firstTail, 0, { kind: "gap" });
    }
  }
  // The windows are fixed, so what they dropped is unrecoverable at any limit —
  // that is `partial`. Pageability stays whatever `boundTimeline` decided.
  return finalizeDetail(formatEntryId("opencode", sessionId), detail, sourceVerdict(windowTruncated));
}

/** Map direct-child session rows into timestamped `subagentSession` stubs. */
function buildChildStubs(rows: Record<string, unknown>[]): { timestamp: number; item: VaultTimelineItem }[] {
  const stubs: { timestamp: number; item: VaultTimelineItem }[] = [];
  for (const row of rows) {
    const childId = asString(row.id);
    if (!childId) {
      continue;
    }
    const rawTitle = asString(row.title);
    // OpenCode embeds the agent in the subtask title as `… (@<agent> subagent)`.
    // Strip it (the webview renders a separate @agent chip) and recover the agent
    // name from it when the row's own `agent` column is empty.
    const split = rawTitle ? splitOpencodeSubtaskTitle(rawTitle) : undefined;
    // Empty cleaned title (a bare `(@x subagent)`) → undefined so the fallbacks engage.
    const cleanTitle = split?.title || undefined;
    const firstMessage = firstUserPartText(row.first_user_part);
    // Prefer the cleaned title; fall back to the first user message for placeholders.
    const title =
      cleanTitle && !isPlaceholderTitle(cleanTitle) ? cleanTitle : (firstMessage ?? cleanTitle ?? "Subagent");
    // `strField` trims + treats a whitespace-only column as absent, so a blank
    // `agent` column falls through to the agent recovered from the title suffix.
    const agent = strField(row.agent) ?? split?.agent;
    const timestamp = Number(row.time_created) || 0;
    stubs.push({
      timestamp,
      item: {
        kind: "subagentSession",
        entryId: formatEntryId("opencode", childId),
        title: boundedPreview(title),
        ...(firstMessage ? { firstMessage: truncate(firstMessage) } : {}),
        ...(agent ? { agent } : {}),
        timestamp,
      },
    });
  }
  return stubs;
}

function parseJsonData(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") {
    return objField(raw) ?? null;
  }
  try {
    return objField(JSON.parse(raw)) ?? null;
  } catch {
    return null;
  }
}

/** De-duplicate raw SQL rows by their `id` column (the head ∪ tail windows
 *  overlap on short sessions); first occurrence wins, id-less rows are dropped. */
function dedupeById(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = strField(row.id);
    if (id && !seen.has(id)) {
      seen.set(id, row);
    }
  }
  return [...seen.values()];
}

function parseMessageRows(rows: Record<string, unknown>[]): OcMessageRow[] {
  const out: OcMessageRow[] = [];
  for (const row of rows) {
    const id = strField(row.id);
    const data = parseJsonData(row.data);
    if (id && data) {
      out.push({ id, timeCreated: num(row.time_created), data });
    }
  }
  return out;
}

function parsePartRows(rows: Record<string, unknown>[]): OcPartRow[] {
  const out: OcPartRow[] = [];
  for (const row of rows) {
    const messageId = strField(row.message_id);
    const data = parseJsonData(row.data);
    if (messageId && data) {
      out.push({ messageId, timeCreated: num(row.time_created), data });
    }
  }
  return out;
}
