// src/vault/readers/codexReader.ts — Read Codex sessions (SQLite + JSONL fallback).
// See: specs/agent-session-index/spec.md (Read Codex sessions), design.md D3,D8,
//      docs/research/20260528-cmux-vault-mechanism.md §4.
//
// Primary source is the `threads` table of ~/.codex/state_5.sqlite. When the DB
// or the sqlite3 tool is unavailable we fall back to scanning
// ~/.codex/sessions/**/*.jsonl (first line's session_meta). A query-error on the
// SQLite read is surfaced as unreadable rather than masked by the fallback.

import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { isResolvedPathInside } from "../../utils/pathBoundary";
import type { ReaderListCache, ReaderResultWithState } from "../cacheTypes";
import { boundedPreview } from "../preview";
import { readSqlite, writeSqlite } from "../sqlite";
import { sameStamps, stampStoreFiles } from "../storeStamp";
import {
  formatEntryId,
  type VaultActivityStep,
  type VaultEntryLookup,
  type VaultSessionDetail,
  type VaultSessionEntry,
  type VaultTimelineItem,
} from "../types";
import type { ReaderResult } from "./claudeReader";
import {
  boundActivity,
  boundTimeline,
  buildQuestionOptions,
  createBoundedRecordBuffer,
  type DetailParts,
  finalizeDetail,
  MAX_MESSAGE_TEXT,
  mergeTimestampedItems,
  normalizeRich,
  type QuestionPair,
  sourceVerdict,
  truncate,
  truncateRich,
} from "./detail";
import { findRecordLine, type RecordLineResult } from "./recordLine";

/** Bound the SQLite read so the vault list stays cheap (D2). */
const ROW_LIMIT = 500;

const CODEX_THREAD_COLUMNS = `id, rollout_path, cwd, title, model, git_branch,
       approval_mode, sandbox_policy, reasoning_effort,
       first_user_message, updated_at_ms`;

const CODEX_THREADS_UNLIMITED_SQL = `SELECT ${CODEX_THREAD_COLUMNS}
FROM threads
WHERE archived = 0
ORDER BY updated_at_ms DESC`;

const CODEX_THREADS_WITH_SOURCE_SQL = `SELECT ${CODEX_THREAD_COLUMNS}, source
FROM threads
WHERE archived = 0
ORDER BY updated_at_ms DESC`;

const CODEX_THREAD_SPAWN_EDGES_SQL = "SELECT parent_thread_id, child_thread_id, status FROM thread_spawn_edges";

const SQLITE_PARENTAGE_CACHE_KEY = "__codex_sqlite_parentage_available__";

/** Single-thread lookup for the single-entry resolve (readCodexEntry). `id` is
 *  validated by isSafeCodexId before this is called, so the embed is injection-safe. */
function codexThreadByIdSql(id: string): string {
  return `SELECT ${CODEX_THREAD_COLUMNS} FROM threads WHERE id = '${id}' LIMIT 1`;
}

export interface CodexReaderOptions {
  home?: string;
  /** Override `~/.codex`. */
  codexDir?: string;
  /** Injectable for tests; defaults to the real WAL-safe reader. */
  readSqliteFn?: typeof readSqlite;
  /** Injectable for tests; defaults to the real live-DB writer. */
  writeSqliteFn?: typeof writeSqlite;
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

/** The only values codex's `-s/--sandbox` flag accepts (codex-cli ≥0.136). */
const CODEX_SANDBOX_MODES = new Set(["read-only", "workspace-write", "danger-full-access"]);

/** A `managed` policy lists per-path filesystem `access`; any `write` entry means
 *  the closest CLI bucket is workspace-write, otherwise read-only. */
function managedToCliMode(policy: object): string {
  const fs = (policy as { file_system?: unknown }).file_system;
  const entries = fs && typeof fs === "object" ? (fs as { entries?: unknown }).entries : undefined;
  const hasWrite =
    Array.isArray(entries) &&
    entries.some((e) => e && typeof e === "object" && (e as { access?: unknown }).access === "write");
  return hasWrite ? "workspace-write" : "read-only";
}

/**
 * Resolve `sandbox_policy` to a value `codex resume -s <…>` accepts, or undefined
 * to omit the flag. `sandbox_policy` is a JSON blob whose `.type` is codex's
 * INTERNAL policy enum, which is NOT 1:1 with the CLI flag's value set: codex
 * ≥0.136 records a granular `"managed"` type that the flag rejects. We map the
 * direct modes through, collapse `"managed"` to its closest bucket, and drop any
 * other/unknown type (so codex falls back to its configured default rather than
 * crashing the resume).
 */
function parseSandbox(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw) {
    return undefined;
  }
  let policy: unknown;
  try {
    policy = JSON.parse(raw);
  } catch {
    // not JSON — keep only if it is already a valid CLI mode.
    return CODEX_SANDBOX_MODES.has(raw) ? raw : undefined;
  }
  if (!policy || typeof policy !== "object") {
    return undefined;
  }
  const type = (policy as { type?: unknown }).type;
  if (typeof type !== "string") {
    return undefined;
  }
  if (CODEX_SANDBOX_MODES.has(type)) {
    return type;
  }
  if (type === "managed") {
    return managedToCliMode(policy);
  }
  return undefined;
}

function mapThreadRow(row: Record<string, unknown>): VaultSessionEntry | null {
  const sessionId = asString(row.id);
  if (!sessionId) {
    return null; // unusable row (D8)
  }
  const title = asString(row.title) ?? asString(row.first_user_message) ?? "";
  return {
    id: formatEntryId("codex", sessionId),
    agent: "codex",
    sessionId,
    title: boundedPreview(title),
    cwd: asString(row.cwd) ?? "",
    modified: Number(row.updated_at_ms) || 0,
    gitBranch: asString(row.git_branch),
    flags: {
      model: asString(row.model),
      approval: asString(row.approval_mode),
      sandbox: parseSandbox(row.sandbox_policy),
      reasoningEffort: asString(row.reasoning_effort),
    },
    canFork: false, // resolved by VaultService (task 2_5)
    // File-backed iff a rollout transcript exists (UI hint only, D9). The host
    // re-derives this path by id; it never trusts a webview-supplied path.
    sessionPath: asString(row.rollout_path),
  };
}

interface CodexSourceMeta {
  parentThreadId?: string;
  agentNickname?: string;
  agentRole?: string;
  prompt?: string;
  model?: string;
  reasoningEffort?: string;
}

interface CodexJsonlMeta {
  sessionId: string;
  cwd?: string;
  timestamp?: number;
  parentThreadId?: string;
}

interface CodexThreadRowsRead {
  status: "ok" | "no-db" | "no-sqlite3" | "query-error";
  rows: Record<string, unknown>[];
  hasSource: boolean;
}

interface CodexEdgesRead {
  available: boolean;
  childIds: Set<string>;
  childrenByParent: Map<string, Set<string>>;
}

interface CodexChildStub {
  childThreadId: string;
  title?: string;
  firstMessage?: string;
  agent?: string;
  timestamp: number;
  rolloutPath?: string;
  spawn?: {
    prompt?: string;
    model?: string;
    reasoningEffort?: string;
    status?: string;
  };
}

function parseCodexSourceMeta(raw: unknown): CodexSourceMeta | undefined {
  const source = parseJsonObj(raw);
  if (!source) {
    return undefined;
  }
  const subagent = objField(source.subagent);
  const containers = [subagent, source].filter((value): value is Record<string, unknown> => !!value);
  for (const container of containers) {
    const spawn = objField(container.thread_spawn) ?? objField(source.thread_spawn);
    const parentThreadId = asString(spawn?.parent_thread_id) ?? asString(spawn?.parentThreadId);
    if (!parentThreadId) {
      continue;
    }
    return {
      parentThreadId,
      agentNickname: asString(container.agent_nickname) ?? asString(source.agent_nickname),
      agentRole: asString(container.agent_role) ?? asString(source.agent_role),
      prompt: asString(spawn?.prompt) ?? asString(container.prompt) ?? asString(source.prompt),
      model: asString(spawn?.model) ?? asString(container.model) ?? asString(source.model),
      reasoningEffort:
        asString(spawn?.reasoning_effort) ?? asString(container.reasoning_effort) ?? asString(source.reasoning_effort),
    };
  }
  return undefined;
}

async function readCodexJsonlMeta(filePath: string): Promise<CodexJsonlMeta | null> {
  const first = await readFirstLine(filePath);
  if (!first) {
    return null;
  }
  const obj = JSON.parse(first) as Record<string, unknown>;
  const payload = objField(obj.payload) ?? {};
  const sessionId = asString(payload.id) ?? path.basename(filePath, ".jsonl");
  if (!isSafeCodexId(sessionId)) {
    return null;
  }
  const source = parseCodexSourceMeta(payload.source);
  const timestamp = parseTs(obj.timestamp) || parseTs(payload.timestamp);
  return {
    sessionId,
    ...(asString(payload.cwd) ? { cwd: asString(payload.cwd) } : {}),
    ...(timestamp ? { timestamp } : {}),
    ...(source?.parentThreadId ? { parentThreadId: source.parentThreadId } : {}),
  };
}

async function collectCodexJsonlParentage(sessionsDir: string): Promise<Map<string, CodexJsonlMeta>> {
  const files = await walkJsonl(sessionsDir);
  const children = new Map<string, CodexJsonlMeta>();
  for (const filePath of files) {
    try {
      const meta = await readCodexJsonlMeta(filePath);
      if (meta?.parentThreadId) {
        children.set(meta.sessionId, meta);
      }
    } catch {
      // Parentage fallback is best-effort; unreadable files are counted only on
      // the primary JSONL fallback list path.
    }
  }
  return children;
}

async function readCodexThreadRowsForParentage(
  dbPath: string,
  readSqliteFn: typeof readSqlite,
): Promise<CodexThreadRowsRead> {
  const withSource = await readSqliteFn(dbPath, CODEX_THREADS_WITH_SOURCE_SQL);
  if (withSource.status === "ok") {
    return { status: "ok", rows: withSource.rows, hasSource: true };
  }
  if (withSource.status !== "query-error") {
    return { status: withSource.status, rows: [], hasSource: false };
  }
  const base = await readSqliteFn(dbPath, CODEX_THREADS_UNLIMITED_SQL);
  return { status: base.status, rows: base.rows, hasSource: false };
}

async function readCodexThreadSpawnEdges(dbPath: string, readSqliteFn: typeof readSqlite): Promise<CodexEdgesRead> {
  const result = await readSqliteFn(dbPath, CODEX_THREAD_SPAWN_EDGES_SQL);
  const childIds = new Set<string>();
  const childrenByParent = new Map<string, Set<string>>();
  if (result.status !== "ok") {
    return { available: false, childIds, childrenByParent };
  }
  for (const row of result.rows) {
    const parent = asString(row.parent_thread_id);
    const child = asString(row.child_thread_id);
    if (!parent || !child || !isSafeCodexId(child)) {
      continue;
    }
    childIds.add(child);
    const set = childrenByParent.get(parent) ?? new Set<string>();
    set.add(child);
    childrenByParent.set(parent, set);
  }
  return { available: true, childIds, childrenByParent };
}

function collectSourceChildIds(rows: Record<string, unknown>[], parentId?: string): Set<string> {
  const childIds = new Set<string>();
  for (const row of rows) {
    const childId = asString(row.id);
    const source = parseCodexSourceMeta(row.source);
    if (
      childId &&
      isSafeCodexId(childId) &&
      source?.parentThreadId &&
      (!parentId || source.parentThreadId === parentId)
    ) {
      childIds.add(childId);
    }
  }
  return childIds;
}

function withSqliteParentageCacheMarker(
  sources: Record<string, { mtimeMs: number; size: number }>,
): Record<string, { mtimeMs: number; size: number }> {
  return { ...sources, [SQLITE_PARENTAGE_CACHE_KEY]: { mtimeMs: 1, size: 1 } };
}

function buildRootEntries(
  rows: Record<string, unknown>[],
  hiddenChildIds: Set<string>,
): { entries: VaultSessionEntry[]; unreadable: number } {
  const entries: VaultSessionEntry[] = [];
  let unreadable = 0;
  for (const row of rows) {
    const sessionId = asString(row.id);
    if (sessionId && hiddenChildIds.has(sessionId)) {
      continue;
    }
    const entry = mapThreadRow(row);
    if (entry) {
      entries.push(entry);
      if (entries.length >= ROW_LIMIT) {
        break;
      }
    } else {
      unreadable++;
    }
  }
  return { entries, unreadable };
}

async function walkJsonl(dir: string): Promise<string[]> {
  const out: string[] = [];
  let dirents: import("node:fs").Dirent[];
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const dirent of dirents) {
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      out.push(...(await walkJsonl(full)));
    } else if (dirent.isFile() && dirent.name.endsWith(".jsonl")) {
      out.push(full);
    }
  }
  return out;
}

async function readFirstLine(filePath: string): Promise<string | undefined> {
  let stream: ReturnType<typeof createReadStream> | undefined;
  let rl: readline.Interface | undefined;
  try {
    stream = createReadStream(filePath, { encoding: "utf8" });
    rl = readline.createInterface({
      input: stream,
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    for await (const line of rl) {
      return line;
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    rl?.close();
    stream?.destroy();
  }
}

/**
 * Build one minimal Codex entry from a rollout jsonl's `session_meta` first line.
 * Shared by the JSONL fallback list and the single-entry resolve. Throws on
 * read/parse failure (caller catches → unreadable); returns null when the first
 * line is empty. `sessionIdOverride` forces the resolved id on the by-id path so
 * the resume command targets the requested session even if `payload.id` is absent.
 */
async function buildCodexJsonlEntry(filePath: string, sessionIdOverride?: string): Promise<VaultSessionEntry | null> {
  const meta = await readCodexJsonlMeta(filePath);
  if (!meta) {
    return null;
  }
  const sessionId = sessionIdOverride ?? meta.sessionId;
  const stat = await fs.stat(filePath);
  return {
    id: formatEntryId("codex", sessionId),
    agent: "codex",
    sessionId,
    title: "",
    cwd: meta.cwd ?? "",
    modified: meta.timestamp ?? stat.mtimeMs,
    flags: {},
    canFork: false,
    sessionPath: filePath, // the rollout jsonl backs this session (UI hint)
  };
}

/** Degraded source: minimal entries from session_meta first lines. */
async function readCodexJsonlFallback(sessionsDir: string): Promise<ReaderResult> {
  const files = await walkJsonl(sessionsDir);
  const entries: VaultSessionEntry[] = [];
  let unreadable = 0;

  for (const filePath of files) {
    try {
      const meta = await readCodexJsonlMeta(filePath);
      if (meta?.parentThreadId) {
        continue;
      }
      const entry = await buildCodexJsonlEntry(filePath);
      if (entry) {
        entries.push(entry);
      } else {
        unreadable++;
      }
    } catch {
      unreadable++;
    }
  }
  entries.sort((a, b) => b.modified - a.modified);
  return { entries: entries.slice(0, ROW_LIMIT), unreadable };
}

/** Trim an env-var path; treat empty/whitespace as unset. */
function envDir(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Resolve Codex's dirs. Codex resolves its home as `$CODEX_HOME` (when set) else
 * `~/.codex`; the default is correct on Windows too (`os.homedir()` =
 * `%USERPROFILE%`). The SQLite DB can be relocated independently via
 * `$CODEX_SQLITE_HOME`. See docs/research/20260529-cross-platform-store-paths-sqlite.md.
 */
function codexDirs(options: CodexReaderOptions): { dbPath: string; sessionsDir: string } {
  const home = options.home ?? os.homedir();
  const codexDir = options.codexDir ?? envDir(process.env.CODEX_HOME) ?? path.join(home, ".codex");
  const sqliteDir = envDir(process.env.CODEX_SQLITE_HOME) ?? codexDir;
  return { dbPath: path.join(sqliteDir, "state_5.sqlite"), sessionsDir: path.join(codexDir, "sessions") };
}

/** Public store paths for FS-watch targets (enhance-vault-sessions D4/D5) — the
 *  single source of truth so watchers don't drift from the reader's resolution. */
export function codexStoreDirs(options: CodexReaderOptions = {}): { dbPath: string; sessionsDir: string } {
  return codexDirs(options);
}

/**
 * Write a user-chosen title into Codex's own store (`threads.title`), keyed by
 * thread id and scoped `AND archived = 0` so a stale/forged id can't rename an
 * archived (list-hidden) thread (write-vault-rename-to-store D1/D3). `name` is a
 * bound parameter; `id` is guarded by `isSafeCodexId` first. Returns true iff a
 * row was updated — false (→ overlay fallback) otherwise. DB-only: the vault reads
 * `threads.title`, which reconcile preserves via `prefer_existing_explicit_title`;
 * Codex's `session_index.jsonl` is intentionally not mirrored (see design Risk Map).
 */
export async function renameCodexThread(
  threadId: string,
  name: string,
  options: CodexReaderOptions = {},
): Promise<boolean> {
  if (!isSafeCodexId(threadId)) {
    return false;
  }
  const { dbPath } = codexDirs(options);
  const writeFn = options.writeSqliteFn ?? writeSqlite;
  const result = await writeFn(dbPath, "UPDATE threads SET title = ? WHERE id = ? AND archived = 0", [name, threadId]);
  return result.status === "ok" && result.changes > 0;
}

export async function readCodexSessions(
  options: CodexReaderOptions = {},
  prev?: ReaderListCache,
): Promise<ReaderResultWithState> {
  const { dbPath, sessionsDir } = codexDirs(options);
  const readSqliteFn = options.readSqliteFn ?? readSqlite;

  // Cheap freshness check: when the DB (+ -wal) is byte-for-byte unchanged since
  // the cache was written, reuse the cached entries and skip the snapshot clone +
  // query entirely (cache-vault-load D3). Guarded on a non-empty stamp set so an
  // absent DB falls through to the query → fallback path rather than "reusing" {}.
  const sources = await stampStoreFiles([dbPath, `${dbPath}-wal`]);
  const prevHasSqliteParentageMarker = prev?.kind === "store" && SQLITE_PARENTAGE_CACHE_KEY in prev.sources;
  const reusableSources = prevHasSqliteParentageMarker ? withSqliteParentageCacheMarker(sources) : sources;
  if (
    prev?.kind === "store" &&
    prevHasSqliteParentageMarker &&
    Object.keys(sources).length > 0 &&
    sameStamps(prev.sources, reusableSources)
  ) {
    const u = prev.unreadable ?? 0;
    return {
      entries: prev.entries,
      unreadable: u,
      cache: { kind: "store", sources: reusableSources, entries: prev.entries, unreadable: u },
    };
  }

  const threadRead = await readCodexThreadRowsForParentage(dbPath, readSqliteFn);

  if (threadRead.status === "no-db" || threadRead.status === "no-sqlite3") {
    // Degraded JSONL scan: no cheap DB stamp, so cache empty `sources` → the next
    // refresh always re-reads (correct for the fallback's freshness semantics).
    const fb = await readCodexJsonlFallback(sessionsDir);
    return { ...fb, cache: { kind: "store", sources: {}, entries: fb.entries, unreadable: fb.unreadable } };
  }
  if (threadRead.status === "query-error") {
    // Surface, don't mask with the fallback (spec: query-error → unreadable). Cache
    // EMPTY sources so the error is NOT reused as an empty success on the next
    // refresh — it is retried until the query succeeds (oracle review).
    return { entries: [], unreadable: 1, cache: { kind: "store", sources: {}, entries: [], unreadable: 1 } };
  }

  // status === "ok"
  const edges = await readCodexThreadSpawnEdges(dbPath, readSqliteFn);
  const sqliteParentageAvailable = edges.available || threadRead.hasSource;
  const hiddenChildIds = new Set(edges.childIds);
  if (threadRead.hasSource) {
    for (const childId of collectSourceChildIds(threadRead.rows)) {
      hiddenChildIds.add(childId);
    }
  }
  if (!sqliteParentageAvailable) {
    for (const childId of (await collectCodexJsonlParentage(sessionsDir)).keys()) {
      hiddenChildIds.add(childId);
    }
  }
  const { entries, unreadable } = buildRootEntries(threadRead.rows, hiddenChildIds);
  const cacheSources = sqliteParentageAvailable ? withSqliteParentageCacheMarker(sources) : sources;
  return { entries, unreadable, cache: { kind: "store", sources: cacheSources, entries, unreadable } };
}

/**
 * Resolve ONE Codex session to its launch entry by id — the single-entry
 * counterpart to readCodexSessions, used by VaultService.getEntry for fast
 * resume/fork (a `threads` point lookup, not the full-store scan; D3). Falls back
 * to the rollout jsonl (located by its filename uuid) when no SQLite DB exists.
 * Returns null for an unsafe id or an unlocatable session.
 */
export async function readCodexEntry(
  sessionId: string,
  options: CodexReaderOptions = {},
): Promise<VaultSessionEntry | null> {
  if (!isSafeCodexId(sessionId)) {
    return null;
  }
  const { dbPath, sessionsDir } = codexDirs(options);
  const readSqliteFn = options.readSqliteFn ?? readSqlite;

  const result = await readSqliteFn(dbPath, codexThreadByIdSql(sessionId));
  if (result.status === "ok") {
    return result.rows.length > 0 ? mapThreadRow(result.rows[0]) : null;
  }
  if (result.status === "no-db" || result.status === "no-sqlite3") {
    const filePath = await findCodexRolloutByFilename(sessionId, sessionsDir);
    if (!filePath) {
      return null;
    }
    try {
      return await buildCodexJsonlEntry(filePath, sessionId);
    } catch {
      return null;
    }
  }
  return null; // query-error → unresolved (caller treats null as unknown-entry)
}

/**
 * Codex by-id lookup, as the conclusive answer the adapter contract asks for.
 * Task 1_1 wraps the existing reader without classifying: a non-null read is
 * `found`, everything else is `unknown`, which is what the caller already assumed.
 * Task 1_4 replaces this body with the real classification.
 */
export async function lookupCodexEntry(
  sessionId: string,
  options: CodexReaderOptions = {},
): Promise<VaultEntryLookup> {
  const entry = await readCodexEntry(sessionId, options);
  return entry ? { status: "found", entry } : { status: "unknown" };
}

// ── On-demand session detail (redesign-vault-panel-ui 2_4) ──────────────────
//
// The Codex rollout JSONL is NOT Claude-shaped (build-time discovery, design
// D4): records are `{timestamp, type, payload}` with `type` ∈ session_meta /
// event_msg / response_item / turn_context. So this reader has its own
// classifier; when no rollout exists it degrades to a partial detail built from
// the `threads` index (`first_user_message`).

const PARTIAL_LIMITED_REASON = "No transcript file for this Codex session — showing index only.";

function objField(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function parseTs(v: unknown): number {
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : 0;
  }
  if (typeof v === "string") {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? 0 : ms;
  }
  return 0;
}

/** Session ids are uuids; reject anything that could escape a filename/SQL. */
function isSafeCodexId(id: string): boolean {
  return /^[A-Za-z0-9-]+$/.test(id);
}

/** Primary arg for a Codex `function_call` (arguments is a JSON string). */
function codexFunctionLabel(args: unknown): string | undefined {
  const raw = asString(args);
  let obj: Record<string, unknown> | undefined;
  if (typeof args === "string") {
    try {
      obj = objField(JSON.parse(args));
    } catch {
      obj = undefined;
    }
  } else {
    obj = objField(args);
  }
  if (obj) {
    for (const k of ["cmd", "command", "file_path", "path", "query", "pattern"]) {
      const s = asString(obj[k]);
      if (s) {
        return s;
      }
    }
    for (const v of Object.values(obj)) {
      const s = asString(v);
      if (s) {
        return s;
      }
    }
  }
  return raw;
}

/** Parse a Codex JSON-string field (`arguments` / `output`) into an object, else undefined. */
function parseJsonObj(v: unknown): Record<string, unknown> | undefined {
  if (typeof v !== "string") {
    return objField(v);
  }
  try {
    return objField(JSON.parse(v));
  } catch {
    return undefined;
  }
}

/**
 * Codex's `request_user_input` (Plan-mode/feature-gated AskUserQuestion analogue).
 * The CALL `arguments` carry `{ questions: [{ id, header, question, options }] }`;
 * the user's pick arrives in a later `function_call_output` (correlated by
 * `call_id`) as `{ answers: { <questionId>: { answers: [label, …] } } }`. This maps
 * the call to a question item, recovering each question's answer by its id.
 *
 * Source-derived shape (codex-rs request_user_input): no real session in the test
 * corpus invokes it, so parsing is defensive — a shape mismatch degrades to an
 * answer-less ("Awaiting answer") item rather than throwing, and a call with no
 * parseable questions returns null so the caller falls back to a tool chip.
 */
function buildCodexQuestionItem(
  args: unknown,
  answersById: Record<string, unknown> | undefined,
  ts: number,
): Extract<VaultTimelineItem, { kind: "question" }> | null {
  const questions = Array.isArray(parseJsonObj(args)?.questions) ? (parseJsonObj(args)?.questions as unknown[]) : [];
  const pairs: QuestionPair[] = [];
  for (const q of questions) {
    const qObj = objField(q);
    const prompt = asString(qObj?.question) ?? asString(qObj?.header);
    if (!prompt) {
      continue;
    }
    const id = asString(qObj?.id);
    const { labels, note } = splitCodexAnswer(id ? codexAnswerEntries(answersById?.[id]) : []);
    const answered = labels.length > 0 || note !== undefined;
    // A secret answer is persisted RAW (as a user_note) — mask it and never reveal
    // the picked option. Otherwise the answer is the picked label(s) + freeform note.
    const secret = qObj?.isSecret === true;
    const answer = secret
      ? answered
        ? "••••••"
        : undefined
      : [...labels, ...(note !== undefined ? [note] : [])].join(", ") || undefined;
    const options = buildQuestionOptions(
      Array.isArray(qObj?.options) ? (qObj?.options as unknown[]) : [],
      secret ? new Set<string>() : new Set(labels),
    );
    pairs.push({
      prompt: truncate(prompt),
      ...(answer ? { answer: truncate(answer) } : {}),
      ...(options.length ? { options } : {}),
    });
  }
  return pairs.length > 0 ? { kind: "question", questions: pairs, timestamp: ts } : null;
}

/**
 * Pre-scan: map each `request_user_input` call_id → its answers-by-question-id,
 * recovered from the matching `function_call_output` (a JSON string
 * `{ answers: { <questionId>: { answers: [...] } } }`). The output for other tools
 * (e.g. exec_command) is plain text → no `answers` object → skipped.
 */
function collectCodexQuestionAnswers(records: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const rec of records) {
    const payload = objField(objField(rec)?.payload);
    if (payload?.type !== "function_call_output") {
      continue;
    }
    const callId = asString(payload.call_id);
    const answers = objField(parseJsonObj(payload.output)?.answers);
    if (callId && answers) {
      map.set(callId, answers);
    }
  }
  return map;
}

/** The raw answer entries for one question from a `request_user_input` answer entry
 *  (`{ answers: [label | "user_note: …", …] }`). */
function codexAnswerEntries(entry: unknown): string[] {
  const list = objField(entry)?.answers;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.map((a) => asString(a)).filter((s): s is string => !!s);
}

/** Split request_user_input answer entries into picked option labels + an optional
 *  freeform note. Notes are encoded `user_note: <text>` (mirrors the Codex TUI). */
function splitCodexAnswer(entries: string[]): { labels: string[]; note?: string } {
  const labels: string[] = [];
  let note: string | undefined;
  for (const e of entries) {
    if (e.startsWith("user_note: ")) {
      const t = e.slice("user_note: ".length).trim();
      if (t) {
        note = note ? `${note} ${t}` : t;
      }
    } else {
      labels.push(e);
    }
  }
  return { labels, ...(note !== undefined ? { note } : {}) };
}

/** Best-effort reasoning text from a Codex `reasoning` item — only the plaintext
 *  `summary[].text` (the bulk is `encrypted_content`, which we never surface). */
function codexReasoningText(payload: Record<string, unknown>): string | undefined {
  const summary = payload.summary;
  if (Array.isArray(summary)) {
    const parts: string[] = [];
    for (const s of summary) {
      const t = asString(objField(s)?.text);
      if (t) {
        parts.push(t);
      }
    }
    const joined = parts.join(" ").trim();
    if (joined) {
      return joined;
    }
  }
  return asString(payload.content);
}

/** Label an `apply_patch`-style custom tool: prefer the `*** … File: <p>` line, else first line. */
function codexPatchLabel(input: unknown): string | undefined {
  const text = asString(input);
  if (!text) {
    return undefined;
  }
  const lines = text.split("\n");
  for (const line of lines) {
    const m = line.match(/\*\*\* (?:Add|Update|Delete) File:\s*(.+)/);
    if (m) {
      return m[1].trim();
    }
  }
  for (const line of lines) {
    const t = line.trim();
    if (t) {
      return t;
    }
  }
  return undefined;
}

/**
 * Dedicated classifier for the Codex rollout schema → bounded session detail
 * (same `VaultSessionDetail` shape as Claude/OpenCode, so D5/D6 bounds hold).
 */
export function classifyCodexRolloutEvents(
  records: Record<string, unknown>[],
  limit?: number,
  childStubs: CodexChildStub[] = [],
): DetailParts {
  let firstPrompt: string | undefined;
  let latestMessage: VaultSessionDetail["latestMessage"];
  const activity: VaultActivityStep[] = [];
  const timeline: VaultTimelineItem[] = [];
  let messageCount = 0;
  let toolCount = 0;
  let totalTokens: number | undefined;
  // Per-message model/tokens (enhance-vault-sessions D3/D6): the model rides on
  // `turn_context` (captured as we walk), and the per-turn token usage arrives in
  // the `token_count` event AFTER the turn's `agent_message` — so we backfill it
  // onto the most recent assistant item by reference.
  let currentModel: string | undefined;
  let lastAssistantItem: Extract<VaultTimelineItem, { kind: "message" }> | undefined;
  // request_user_input answers arrive in a later function_call_output (correlated
  // by call_id); pre-scan them so the question item can carry the answer inline.
  const questionAnswers = collectCodexQuestionAnswers(records);
  const childrenById = new Map(childStubs.map((stub) => [stub.childThreadId, stub]));
  const matchedChildren = new Set<string>();

  for (const rec of records) {
    if (!rec || typeof rec !== "object") {
      continue;
    }
    if (rec.type === "__vault_gap__") {
      timeline.push({ kind: "gap" });
      lastAssistantItem = undefined;
      continue;
    }
    const payload = objField(rec.payload);
    if (!payload) {
      continue;
    }
    const type = rec.type;
    const ptype = payload.type;
    const ts = parseTs(rec.timestamp);

    if (type === "turn_context") {
      const m = asString(payload.model);
      if (m) {
        currentModel = m;
      }
      continue;
    }

    if (type === "event_msg") {
      if (ptype === "user_message") {
        const m = asString(payload.message);
        if (m) {
          messageCount++;
          if (firstPrompt === undefined) {
            firstPrompt = truncate(m);
          }
          latestMessage = { role: "user", text: truncate(m), timestamp: ts };
          timeline.push({
            kind: "message",
            role: "user",
            text: truncateRich(m, MAX_MESSAGE_TEXT),
            timestamp: ts,
            ...msgRefOf(rec),
          });
        }
      } else if (ptype === "agent_message") {
        const m = asString(payload.message);
        if (m) {
          messageCount++;
          latestMessage = { role: "assistant", text: truncate(m), timestamp: ts };
          const item: Extract<VaultTimelineItem, { kind: "message" }> = {
            kind: "message",
            role: "assistant",
            text: normalizeRich(m),
            timestamp: ts,
            ...(currentModel ? { model: currentModel } : {}),
            ...msgRefOf(rec),
          };
          timeline.push(item);
          lastAssistantItem = item;
        }
      } else if (ptype === "token_count") {
        const info = objField(payload.info);
        const tot = objField(info?.total_token_usage);
        const n = tot ? num(tot.total_tokens) : 0;
        if (n > 0) {
          totalTokens = n; // last token_count is the cumulative session total (D7)
        }
        // Backfill this turn's usage onto its assistant message (arrives after it).
        const last = objField(info?.last_token_usage);
        if (last && lastAssistantItem) {
          const ctx = info ? num(info.model_context_window) : 0;
          lastAssistantItem.tokens = {
            input: num(last.input_tokens) + num(last.cached_input_tokens),
            output: num(last.output_tokens),
            ...(ctx > 0 ? { contextWindow: ctx } : {}),
          };
          // Consume the reference: a later token_count with no intervening
          // agent_message (tool-only / interrupted turn) must not re-attribute its
          // usage onto this already-backfilled message.
          lastAssistantItem = undefined;
        }
      } else if (ptype === "collab_agent_spawn_end") {
        const childThreadId = asString(payload.new_thread_id);
        const stub = childThreadId ? childrenById.get(childThreadId) : undefined;
        if (childThreadId && stub) {
          matchedChildren.add(childThreadId);
          const item = codexChildTimelineItem(stub, {
            timestamp: ts || undefined,
            prompt: asString(payload.prompt),
            agentNickname: asString(payload.agent_nickname),
            agentRole: asString(payload.agent_role),
          });
          timeline.push(item);
          activity.push({
            kind: "subagent",
            name: item.agent ?? "subagent",
            ...(item.firstMessage ? { prompt: item.firstMessage } : {}),
          });
        }
      }
    } else if (type === "response_item") {
      if (ptype === "function_call") {
        toolCount++;
        const name = asString(payload.name) ?? "tool";
        // request_user_input is a user decision point — surface it as a question
        // item (Q + options + recovered answer); anything else, and an unparseable
        // one, falls through to a generic tool step.
        const question =
          name === "request_user_input"
            ? buildCodexQuestionItem(payload.arguments, questionAnswers.get(asString(payload.call_id) ?? ""), ts)
            : null;
        if (question) {
          timeline.push(question);
        } else {
          const label = codexFunctionLabel(payload.arguments);
          const step: VaultActivityStep = { kind: "tool", tool: name, detail: label ? truncate(label) : undefined };
          activity.push(step);
          timeline.push(step);
        }
      } else if (ptype === "custom_tool_call") {
        toolCount++;
        const name = asString(payload.name) ?? "tool";
        const label = codexPatchLabel(payload.input);
        const step: VaultActivityStep = { kind: "tool", tool: name, detail: label ? truncate(label) : undefined };
        activity.push(step);
        timeline.push(step);
      } else if (ptype === "web_search_call") {
        toolCount++;
        const q = asString(objField(payload.action)?.query);
        const step: VaultActivityStep = { kind: "tool", tool: "WebSearch", detail: q ? truncate(q) : undefined };
        activity.push(step);
        timeline.push(step);
      } else if (ptype === "reasoning") {
        const t = codexReasoningText(payload);
        if (t) {
          timeline.push({ kind: "thinking", text: truncateRich(t, MAX_MESSAGE_TEXT), timestamp: ts });
        }
      }
      // function_call_output / custom_tool_call_output / reasoning / message → skipped
    }
  }

  const unmatchedChildren = childStubs
    .filter((stub) => !matchedChildren.has(stub.childThreadId))
    .map((stub) => codexChildTimelineItem(stub));

  const bounded = boundTimeline(mergeTimestampedItems(timeline, unmatchedChildren), limit);
  return {
    firstPrompt,
    recentActivity: boundActivity(activity),
    latestMessage,
    timeline: bounded.timeline,
    ...(bounded.truncated ? { truncated: true } : {}),
    stats: {
      messageCount,
      toolCount,
      subagentCount: childStubs.length,
      ...(totalTokens !== undefined ? { tokenCount: totalTokens } : {}),
    },
  };
}

/**
 * Read parseable records from a rollout jsonl (skip-malformed, D8), bounded to a
 * head + tail window so a large rollout never fully materializes (W1). Returns
 * `truncated` when the middle was dropped.
 */
/**
 * Codex records carry no id, so the locator is the record's physical line in the
 * rollout — stamped here, while streaming, because the head+tail window drops the
 * middle and positions would otherwise be unrecoverable downstream (D4).
 * Non-enumerable so it never rides along into a raw record copy.
 */
const LINE_ORDINAL = "__lineOrdinal";

function stampLineOrdinal(rec: Record<string, unknown>, lineNo: number): void {
  Object.defineProperty(rec, LINE_ORDINAL, { value: lineNo, enumerable: false });
}

export function lineOrdinalOf(rec: Record<string, unknown>): number | undefined {
  const n = (rec as { __lineOrdinal?: unknown }).__lineOrdinal;
  return typeof n === "number" ? n : undefined;
}

/** `#<line>` locator, or nothing when the record did not come from a streamed file. */
function msgRefOf(rec: Record<string, unknown>): { msgRef?: string } {
  const n = lineOrdinalOf(rec);
  return n === undefined ? {} : { msgRef: `#${n}` };
}

async function streamCodexRecords(
  filePath: string,
): Promise<{ records: Record<string, unknown>[]; truncated: boolean } | null> {
  const buffer = createBoundedRecordBuffer();
  let stream: ReturnType<typeof createReadStream> | undefined;
  let rl: readline.Interface | undefined;
  try {
    stream = createReadStream(filePath, { encoding: "utf8" });
    rl = readline.createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
    let lineNo = 0;
    for await (const line of rl) {
      lineNo++;
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          stampLineOrdinal(parsed as Record<string, unknown>, lineNo);
          buffer.push(parsed as Record<string, unknown>);
        }
      } catch {
        // skip a corrupt line, keep reading (D8)
      }
    }
  } catch {
    return null;
  } finally {
    rl?.close();
    stream?.destroy();
  }
  return buffer.result();
}

/** Find the rollout jsonl by the session uuid embedded in its filename. */
async function findCodexRolloutByFilename(sessionId: string, sessionsDir: string): Promise<string | null> {
  const suffix = `-${sessionId}.jsonl`;
  let dirents: import("node:fs").Dirent[];
  const stack = [sessionsDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) {
      break;
    }
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of dirents) {
      const full = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        stack.push(full);
      } else if (dirent.isFile() && dirent.name.endsWith(suffix)) {
        return full;
      }
    }
  }
  return null;
}

/** Best-effort: the `threads` index row for one session (rollout_path + first prompt). */
async function queryCodexThread(
  sessionId: string,
  dbPath: string,
  readSqliteFn: typeof readSqlite,
): Promise<{ rolloutPath?: string; firstUserMessage?: string } | null> {
  const sql = `SELECT rollout_path, first_user_message FROM threads WHERE id = '${sessionId}' LIMIT 1`;
  const res = await readSqliteFn(dbPath, sql);
  if (res.status !== "ok" || res.rows.length === 0) {
    return null;
  }
  const row = res.rows[0];
  return { rolloutPath: asString(row.rollout_path), firstUserMessage: asString(row.first_user_message) };
}

async function readCodexThreadRowsForDetailChildren(
  dbPath: string,
  readSqliteFn: typeof readSqlite,
): Promise<CodexThreadRowsRead> {
  const withCreated = await readSqliteFn(
    dbPath,
    `SELECT ${CODEX_THREAD_COLUMNS}, source, created_at_ms
FROM threads
WHERE archived = 0
ORDER BY updated_at_ms DESC`,
  );
  if (withCreated.status === "ok") {
    return { status: "ok", rows: withCreated.rows, hasSource: true };
  }
  return readCodexThreadRowsForParentage(dbPath, readSqliteFn);
}

function codexChildStubFromRow(row: Record<string, unknown>): CodexChildStub | null {
  const childThreadId = asString(row.id);
  if (!childThreadId || !isSafeCodexId(childThreadId)) {
    return null;
  }
  const source = parseCodexSourceMeta(row.source);
  const firstMessage = asString(row.first_user_message);
  const title = asString(row.title);
  const timestamp = parseTs(row.created_at_ms) || parseTs(row.updated_at_ms);
  return {
    childThreadId,
    ...(title ? { title: boundedPreview(title) } : {}),
    ...(firstMessage ? { firstMessage: truncate(firstMessage) } : {}),
    agent: source?.agentNickname ?? source?.agentRole ?? "subagent",
    timestamp,
    ...(asString(row.rollout_path) ? { rolloutPath: asString(row.rollout_path) } : {}),
    ...(source
      ? {
          spawn: {
            ...(source.prompt ? { prompt: source.prompt } : {}),
            ...(source.model ? { model: source.model } : {}),
            ...(source.reasoningEffort ? { reasoningEffort: source.reasoningEffort } : {}),
          },
        }
      : {}),
  };
}

async function readCodexChildJsonlMeta(
  childThreadId: string,
  sessionsDir: string,
  rolloutPath?: string,
): Promise<CodexJsonlMeta | null> {
  if (rolloutPath && (await isResolvedPathInside(rolloutPath, sessionsDir))) {
    try {
      return await readCodexJsonlMeta(rolloutPath);
    } catch {
      // Fall back to filename lookup below.
    }
  }
  const foundRolloutPath = await findCodexRolloutByFilename(childThreadId, sessionsDir);
  if (!foundRolloutPath) {
    return null;
  }
  try {
    return await readCodexJsonlMeta(foundRolloutPath);
  } catch {
    return null;
  }
}

async function queryCodexDirectChildStubs(
  parentThreadId: string,
  dbPath: string,
  sessionsDir: string,
  readSqliteFn: typeof readSqlite,
): Promise<CodexChildStub[]> {
  const stubs = new Map<string, CodexChildStub>();
  const threadRead = await readCodexThreadRowsForDetailChildren(dbPath, readSqliteFn);
  let sqliteParentageAvailable = false;
  if (threadRead.status === "ok") {
    const edges = await readCodexThreadSpawnEdges(dbPath, readSqliteFn);
    sqliteParentageAvailable = edges.available || threadRead.hasSource;
    const directChildIds = new Set(edges.childrenByParent.get(parentThreadId) ?? []);
    if (threadRead.hasSource) {
      for (const childId of collectSourceChildIds(threadRead.rows, parentThreadId)) {
        directChildIds.add(childId);
      }
    }
    for (const row of threadRead.rows) {
      const childThreadId = asString(row.id);
      if (!childThreadId || !directChildIds.has(childThreadId)) {
        continue;
      }
      const stub = codexChildStubFromRow(row);
      if (stub) {
        stubs.set(childThreadId, stub);
      }
    }
  }

  if (sqliteParentageAvailable) {
    for (const stub of stubs.values()) {
      const meta = await readCodexChildJsonlMeta(stub.childThreadId, sessionsDir, stub.rolloutPath);
      if (meta?.timestamp) {
        stub.timestamp = meta.timestamp;
      }
    }
  } else if (threadRead.status !== "query-error") {
    for (const meta of (await collectCodexJsonlParentage(sessionsDir)).values()) {
      if (meta.parentThreadId !== parentThreadId || stubs.has(meta.sessionId)) {
        continue;
      }
      stubs.set(meta.sessionId, {
        childThreadId: meta.sessionId,
        agent: "subagent",
        timestamp: meta.timestamp ?? 0,
      });
    }
  }

  return [...stubs.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function codexChildTimelineItem(
  stub: CodexChildStub,
  overrides: { timestamp?: number; prompt?: string; agentNickname?: string; agentRole?: string } = {},
): Extract<VaultTimelineItem, { kind: "subagentSession" }> {
  const title = stub.title || stub.firstMessage || overrides.prompt || stub.spawn?.prompt || "Subagent";
  const agent = overrides.agentNickname ?? overrides.agentRole ?? stub.agent ?? "subagent";
  return {
    kind: "subagentSession",
    entryId: formatEntryId("codex", stub.childThreadId),
    title: truncate(title),
    ...(stub.firstMessage ? { firstMessage: truncate(stub.firstMessage) } : {}),
    agent,
    timestamp: overrides.timestamp ?? stub.timestamp,
  };
}

/**
 * On-demand detail for a Codex session: classify the rollout jsonl when one can
 * be located (full detail); otherwise return a labeled partial detail from the
 * `threads` index. Returns null when the session can't be located at all.
 */
/**
 * The verbatim rollout line at the `#<n>` locator (D4/D5). Codex records carry no
 * id, so the position IS the address — resolved against the same rollout the
 * detail was read from.
 */
/** The two payloads the timeline emits as messages (and stamps a locator on). */
function isCodexMessageRecord(rec: Record<string, unknown>): boolean {
  const ptype = objField(rec.payload)?.type;
  return rec.type === "event_msg" && (ptype === "user_message" || ptype === "agent_message");
}

export async function readCodexMessageRecord(
  sessionId: string,
  msgRef: string,
  options: CodexReaderOptions = {},
  maxBytes?: number,
): Promise<RecordLineResult> {
  const ordinal = /^#(\d+)$/.exec(msgRef);
  if (!isSafeCodexId(sessionId) || !ordinal) {
    return { ok: false, reason: "not-found" };
  }
  const rolloutPath = await resolveCodexRolloutPath(sessionId, options);
  if (!rolloutPath) {
    return { ok: false, reason: "not-found" };
  }
  const target = Number(ordinal[1]);
  // The ordinal alone would address any line, so a stale or off-by-one locator
  // would hand back a tool call as if it were the message it names.
  return findRecordLine(rolloutPath, (rec, lineNo) => lineNo === target && isCodexMessageRecord(rec), maxBytes, {
    lineNo: target,
  });
}

async function resolveCodexRolloutPath(sessionId: string, options: CodexReaderOptions): Promise<string | undefined> {
  const { dbPath, sessionsDir } = codexDirs(options);
  const thread = await queryCodexThread(sessionId, dbPath, options.readSqliteFn ?? readSqlite);
  return pickRolloutPath(thread, sessionId, sessionsDir);
}

/**
 * The index's rollout_path when it RESOLVES inside the sessions dir, else a scan
 * by filename. Strict: a stored path equal to the directory itself is refused,
 * so the scan still runs rather than the caller being handed a directory.
 */
export async function pickRolloutPath(
  thread: { rolloutPath?: string } | null,
  sessionId: string,
  sessionsDir: string,
): Promise<string | undefined> {
  if (thread?.rolloutPath && (await isResolvedPathInside(thread.rolloutPath, sessionsDir))) {
    return thread.rolloutPath;
  }
  return (await findCodexRolloutByFilename(sessionId, sessionsDir)) ?? undefined;
}

export async function readCodexDetail(
  sessionId: string,
  options: CodexReaderOptions = {},
  limit?: number,
): Promise<VaultSessionDetail | null> {
  if (!isSafeCodexId(sessionId)) {
    return null;
  }
  const { dbPath, sessionsDir } = codexDirs(options);
  const readSqliteFn = options.readSqliteFn ?? readSqlite;

  const thread = await queryCodexThread(sessionId, dbPath, readSqliteFn);
  const childStubs = await queryCodexDirectChildStubs(sessionId, dbPath, sessionsDir, readSqliteFn);

  const rolloutPath = await pickRolloutPath(thread, sessionId, sessionsDir);

  if (rolloutPath) {
    const read = await streamCodexRecords(rolloutPath);
    if (read && read.records.length > 0) {
      const detail = classifyCodexRolloutEvents(read.records, limit, childStubs);
      return finalizeDetail(formatEntryId("codex", sessionId), detail, sourceVerdict(read.truncated));
    }
  }

  if (thread?.firstUserMessage || childStubs.length > 0) {
    const promptItem = thread?.firstUserMessage
      ? {
          kind: "message" as const,
          role: "user" as const,
          text: truncateRich(thread.firstUserMessage, MAX_MESSAGE_TEXT),
          timestamp: 0,
        }
      : undefined;
    const childItems = childStubs.map((stub) => codexChildTimelineItem(stub));
    const timeline = mergeTimestampedItems(promptItem ? [promptItem] : [], childItems);
    // A USEFUL partial: no rollout, but the index still yields the first prompt
    // and the children, so it goes through the timeline-bearing constructor
    // rather than the empty metadata-only one.
    return finalizeDetail(
      formatEntryId("codex", sessionId),
      {
        ...(thread?.firstUserMessage ? { firstPrompt: truncate(thread.firstUserMessage) } : {}),
        recentActivity: [],
        ...(thread?.firstUserMessage
          ? { latestMessage: { role: "user" as const, text: truncate(thread.firstUserMessage), timestamp: 0 } }
          : {}),
        timeline,
        // The index-only fallback surfaces exactly the one indexed prompt (s3 — was 0).
        stats: { messageCount: thread?.firstUserMessage ? 1 : 0, toolCount: 0, subagentCount: childStubs.length },
      },
      { kind: "partial", reason: PARTIAL_LIMITED_REASON },
    );
  }

  return null;
}
