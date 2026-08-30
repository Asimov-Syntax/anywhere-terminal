// src/vault/sqlite.ts — WAL-safe, read-only SQLite access (no new native
// dependency). See: design.md D3, D13, D14,
// specs/agent-session-index/spec.md (WAL-safe read-only SQLite access),
// docs/research/20260528-cmux-vault-mechanism.md §4,§7.
//
// ENGINE (D14): PREFER the in-process `node:sqlite` built-in (native row values);
// fall back to the host `sqlite3` CLI only when it is unavailable. The CLI's
// `-json` output formatter is pathologically slow (30s+ of CPU) for sessions with
// large message blobs (e.g. embedded diffs), which blew past the query timeout
// and surfaced as "Session not found" for big sessions; `node:sqlite` reads the
// same rows in ~20ms. The static query is passed as a single argv element to
// `execFile` (CLI path) — no shell, no interpolation, no injection.
//
// SNAPSHOT: we copy the live DB + its `-wal`/`-shm` sidecars into a temp dir and
// query the copy, so a running agent's writes are never disturbed and a
// checkpoint mid-read can't corrupt our snapshot. (We do NOT read the live store
// in place: a read-only open of a live WAL DB can silently return an empty result
// instead of erroring — indistinguishable from a genuinely-empty session — so it
// would surface "not found" for real sessions. See D13.)
//
// PERF (D13): the copy is a copy-on-write CLONE (APFS `clonefile` / Linux reflink,
// via `cp -c` / `cp --reflink=auto`) when the filesystem supports it — near-instant
// regardless of size — falling back to a byte copy otherwise, keeping a multi-GB
// store (OpenCode's exceeds 1 GB) from dominating list/detail/resume latency while
// preserving exact snapshot semantics.

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { type FsPresence, presenceFromAccessError } from "../utils/fsPresence";

const execFileAsync = promisify(execFile);

/** Capability probe — short, since a missing/old `sqlite3` should fail fast. */
const PROBE_TIMEOUT_MS = 2000;
/** Per-query cap so a hung `sqlite3` can't stall the vault list. */
const QUERY_TIMEOUT_MS = 5000;
/** Cap for the clone/copy step (a reflink clone is ms; a byte-copy fallback of a
 *  multi-GB store needs headroom). */
const COPY_TIMEOUT_MS = 30000;
/** `sqlite3 -json` output is bounded by the readers' LIMITs; keep headroom. */
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** `no-db` means the database file is CONFIRMED not there. A path that could not
 *  be reached at all — a directory denying access, an I/O error, a dead mount —
 *  is `db-unreachable`, because "I could not look" is not "it is not there"
 *  (tell-an-absent-session-from-an-unknown-one D6). */
export type SqliteStatus = "ok" | "no-db" | "db-unreachable" | "no-sqlite3" | "query-error";

/** What a presence check could establish about the database file. The scanners in
 *  the readers ask the same question, so the answer has one owner. */
export type SqlitePresence = FsPresence;
export { presenceFromAccessError };

export interface SqliteResult {
  rows: Record<string, unknown>[];
  status: SqliteStatus;
  /** Populated only for `query-error`. */
  error?: string;
}

export interface SqliteSnapshot {
  /** Run one static query against the same disposable WAL-aware snapshot. */
  query(sql: string): Promise<SqliteResult>;
}

export type SqliteSnapshotResult<T> =
  | { status: "ok"; value: T }
  | { status: Exclude<SqliteStatus, "ok">; error?: string };

/** Injectable IO surface — tests stub this to avoid real fs / child_process. */
export interface SqliteDeps {
  exec(file: string, args: string[], options: { timeout: number }): Promise<{ stdout: string; stderr: string }>;
  exists(p: string): Promise<boolean>;
  /**
   * Presence WITH the reason a check failed, which `exists` collapses. Optional:
   * a dep set that supplies only `exists` keeps today's behaviour, where anything
   * other than "present" reads as absent (D6).
   */
  access?(p: string): Promise<SqlitePresence>;
  copy(src: string, dest: string): Promise<void>;
  mkdtemp(): Promise<string>;
  rmrf(dir: string): Promise<void>;
  /**
   * Whether the in-process `node:sqlite` engine is usable. Defaults to a
   * memoized real probe. Used only as a fallback when the `sqlite3` CLI is
   * absent (typically Windows). Tests stub it to isolate the CLI path.
   */
  hasNodeSqlite?(): Promise<boolean>;
  /**
   * Query the copied DB with `node:sqlite` instead of the CLI. Defaults to the
   * real engine. Tests stub it to avoid touching a real sqlite file.
   */
  runNodeQuery?(dbCopy: string, sql: string): Promise<SqliteResult>;
}

/**
 * Copy `src`→`dest` as a copy-on-write CLONE when the platform/filesystem
 * supports it (APFS `clonefile` via `cp -c`, Linux reflink via `cp --reflink=auto`
 * — near-instant regardless of size), falling back to a byte copy otherwise. A
 * clone is an independent file view, so it has the same snapshot semantics as a
 * byte copy while avoiding multi-GB I/O for stores like OpenCode's 1.4 GB db (D13).
 */
async function cloneOrCopy(src: string, dest: string): Promise<void> {
  try {
    if (process.platform === "darwin") {
      await execFileAsync("cp", ["-c", src, dest], { timeout: COPY_TIMEOUT_MS });
      return;
    }
    if (process.platform === "linux") {
      await execFileAsync("cp", ["--reflink=auto", src, dest], { timeout: COPY_TIMEOUT_MS });
      return;
    }
  } catch {
    // clone tool missing / clone unsupported (e.g. cross-volume) — byte-copy below.
  }
  await fs.copyFile(src, dest);
}

async function defaultAccess(p: string): Promise<SqlitePresence> {
  try {
    await fs.access(p);
    return "present";
  } catch (err) {
    return presenceFromAccessError(err);
  }
}

const defaultDeps: SqliteDeps = {
  exec: (file, args, options) =>
    execFileAsync(file, args, { timeout: options.timeout, maxBuffer: MAX_BUFFER_BYTES }).then(({ stdout, stderr }) => ({
      stdout: stdout.toString(),
      stderr: stderr.toString(),
    })),
  exists: async (p) => (await defaultAccess(p)) === "present",
  access: defaultAccess,
  copy: (src, dest) => cloneOrCopy(src, dest),
  mkdtemp: () => fs.mkdtemp(path.join(os.tmpdir(), "at-vault-")),
  rmrf: (dir) => fs.rm(dir, { recursive: true, force: true }),
};

let probePromise: Promise<boolean> | undefined;
let nodeProbePromise: Promise<boolean> | undefined;

/** Reset the memoized capability probes — tests only. */
export function __resetSqliteProbeCache(): void {
  probePromise = undefined;
  nodeProbePromise = undefined;
}

/**
 * Probe once whether `sqlite3` exists AND supports `-json` (older builds don't).
 * `:memory:` avoids touching any file. Memoized: the first caller's `deps.exec`
 * decides the cached result for the process lifetime.
 */
function probeSqlite(deps: SqliteDeps): Promise<boolean> {
  if (!probePromise) {
    probePromise = (async () => {
      try {
        await deps.exec("sqlite3", ["-readonly", "-json", ":memory:", "select 1"], { timeout: PROBE_TIMEOUT_MS });
        return true;
      } catch {
        return false;
      }
    })();
  }
  return probePromise;
}

/**
 * Probe once whether the built-in `node:sqlite` module is importable (Node
 * 22.5+). VS Code's Electron host ships a recent enough Node, but the dynamic
 * import is guarded so an older/locked-down runtime degrades to `no-sqlite3`
 * rather than throwing. Memoized.
 */
function probeNodeSqlite(deps: SqliteDeps): Promise<boolean> {
  if (deps.hasNodeSqlite) {
    return deps.hasNodeSqlite();
  }
  if (!nodeProbePromise) {
    nodeProbePromise = (async () => {
      try {
        const mod = await import("node:sqlite");
        return typeof mod.DatabaseSync === "function";
      } catch {
        return false;
      }
    })();
  }
  return nodeProbePromise;
}

/**
 * Run `sql` against the copied DB using `node:sqlite`. The copy is a disposable
 * temp file, so we open it read-WRITE: that lets SQLite replay the copied
 * `-wal` sidecar (read-only opens can fail when the `-shm` can't be created)
 * without ever touching the user's live store. Never throws.
 */
async function defaultRunNodeQuery(dbCopy: string, sql: string): Promise<SqliteResult> {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbCopy);
    try {
      const rows = db.prepare(sql).all() as Record<string, unknown>[];
      return { rows: rows.map(normalizeRow), status: "ok" };
    } finally {
      db.close();
    }
  } catch (err) {
    return { rows: [], status: "query-error", error: errorMessage(err) };
  }
}

/**
 * Coerce a `node:sqlite` row into the JSON-ish shapes the readers expect
 * (matching the CLI's `-json` output): BIGINT columns can come back as
 * `bigint`, blobs as `Uint8Array`. The readers only consume text + ms
 * timestamps (well within Number range), so a `bigint → number` coercion is
 * safe; blobs are left as-is (readers ignore them).
 */
function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = typeof value === "bigint" ? Number(value) : value;
  }
  return out;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** One `sqlite3 -readonly -json` attempt against `dbFile` (live or copy). */
async function attemptQuery(deps: SqliteDeps, dbFile: string, sql: string): Promise<SqliteResult> {
  try {
    const { stdout } = await deps.exec("sqlite3", ["-readonly", "-json", dbFile, sql], { timeout: QUERY_TIMEOUT_MS });
    const trimmed = stdout.trim();
    // `sqlite3 -json` prints nothing for a zero-row result.
    if (trimmed === "") {
      return { rows: [], status: "ok" };
    }
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      return { rows: [], status: "query-error", error: "sqlite3 did not return a JSON array" };
    }
    return { rows: parsed as Record<string, unknown>[], status: "ok" };
  } catch (err) {
    return { rows: [], status: "query-error", error: errorMessage(err) };
  }
}

async function runQuery(deps: SqliteDeps, dbCopy: string, sql: string): Promise<SqliteResult> {
  // One retry: a transient exec failure or a torn JSON read shouldn't drop the
  // whole agent.
  let last: SqliteResult = { rows: [], status: "query-error", error: "no attempt" };
  for (let attempt = 0; attempt < 2; attempt++) {
    last = await attemptQuery(deps, dbCopy, sql);
    if (last.status === "ok") {
      return last;
    }
  }
  return last;
}

/**
 * Read `sql` (a STATIC query) from the SQLite store at `dbPath`, WAL-safe and
 * read-only. Never throws — every failure mode maps to a discriminated status:
 * - `no-sqlite3` — host has no usable `sqlite3 -json`
 * - `no-db`      — the store file is absent
 * - `query-error`— copy/exec/parse failed (the `error` field carries detail)
 * - `ok`         — `rows` holds the parsed result (possibly empty)
 */
/** One presence answer for both entry points, honouring `access` when the dep set
 *  supplies it and degrading to `exists` when it does not. */
async function presence(deps: SqliteDeps, dbPath: string): Promise<SqlitePresence> {
  try {
    return deps.access ? await deps.access(dbPath) : (await deps.exists(dbPath)) ? "present" : "absent";
  } catch {
    return "unreachable";
  }
}

/** Copy the `-wal`/`-shm` sidecars beside a snapshot, PRESERVING the reason a
 *  sidecar could not be read. A WAL holds committed rows the base file does not,
 *  so querying a base-only copy after a failed sidecar read returns a smaller
 *  database, not a smaller answer — and its empty result is indistinguishable
 *  from a genuine miss, which D5 then maps to `absent` (round-3 B1). Only a
 *  PROVEN absence is safe to skip: an unreachable or uncopyable sidecar throws,
 *  and the caller's existing catch reports `query-error`, which every reader
 *  already reads as "could not find out". */
async function copySidecars(deps: SqliteDeps, dbPath: string, dbCopy: string): Promise<void> {
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = dbPath + suffix;
    const found = await presence(deps, sidecar);
    if (found === "absent") {
      continue; // checkpointed or never in WAL mode — the base copy is whole
    }
    if (found === "unreachable") {
      throw new Error(`sidecar ${suffix} could not be reached`);
    }
    await deps.copy(sidecar, dbCopy + suffix);
  }
}

export async function readSqlite(dbPath: string, sql: string, deps: SqliteDeps = defaultDeps): Promise<SqliteResult> {
  // Pick an engine: PREFER the in-process `node:sqlite` built-in (returns native
  // row values) over the `sqlite3` CLI. The CLI's `-json` output formatter is
  // pathologically slow (30s+ of CPU for a session with large message blobs —
  // e.g. embedded diffs), which blew past the query timeout and surfaced as
  // "Session not found" for big sessions (D14). The CLI remains the fallback for
  // runtimes without `node:sqlite`. Neither → `no-sqlite3` (graceful empty).
  const useNode = await probeNodeSqlite(deps);
  const useCli = useNode ? false : await probeSqlite(deps);
  if (!useNode && !useCli) {
    return { rows: [], status: "no-sqlite3" };
  }

  const found = await presence(deps, dbPath);
  if (found !== "present") {
    return { rows: [], status: found === "absent" ? "no-db" : "db-unreachable" };
  }

  return readSqliteViaCopy(deps, dbPath, sql, useCli);
}

/**
 * Copy a live database and its WAL/SHM sidecars once, then run bounded static
 * queries against that one disposable snapshot. The callback cannot access the
 * live path and the snapshot is deleted before this function returns.
 */
export async function withSqliteSnapshot<T>(
  dbPath: string,
  callback: (snapshot: SqliteSnapshot) => Promise<T>,
  deps: SqliteDeps = defaultDeps,
): Promise<SqliteSnapshotResult<T>> {
  const useNode = await probeNodeSqlite(deps);
  const useCli = useNode ? false : await probeSqlite(deps);
  if (!useNode && !useCli) {
    return { status: "no-sqlite3" };
  }

  const found = await presence(deps, dbPath);
  if (found !== "present") {
    return { status: found === "absent" ? "no-db" : "db-unreachable" };
  }

  let tempDir: string | undefined;
  try {
    tempDir = await deps.mkdtemp();
    const dbCopy = path.join(tempDir, "db.sqlite");
    await deps.copy(dbPath, dbCopy);
    await copySidecars(deps, dbPath, dbCopy);
    const snapshot: SqliteSnapshot = {
      query: (sql) => (useCli ? runQuery(deps, dbCopy, sql) : (deps.runNodeQuery ?? defaultRunNodeQuery)(dbCopy, sql)),
    };
    return { status: "ok", value: await callback(snapshot) };
  } catch (err) {
    return { status: "query-error", error: errorMessage(err) };
  } finally {
    if (tempDir) {
      await deps.rmrf(tempDir).catch(() => {});
    }
  }
}

/**
 * Snapshot the DB (a copy-on-write clone where supported, else a byte copy; see
 * `cloneOrCopy`) plus its `-wal`/`-shm` sidecars into a temp dir, query the
 * snapshot read-only, then delete it. Never reads the live store in place (a
 * read-only WAL open can silently return empty → false "not found"; D13). Never
 * throws — failures map to `query-error`.
 */
async function readSqliteViaCopy(
  deps: SqliteDeps,
  dbPath: string,
  sql: string,
  useCli: boolean,
): Promise<SqliteResult> {
  let tempDir: string | undefined;
  try {
    tempDir = await deps.mkdtemp();
    const dbCopy = path.join(tempDir, "db.sqlite");
    await deps.copy(dbPath, dbCopy);
    await copySidecars(deps, dbPath, dbCopy);
    return useCli ? await runQuery(deps, dbCopy, sql) : await (deps.runNodeQuery ?? defaultRunNodeQuery)(dbCopy, sql);
  } catch (err) {
    return { rows: [], status: "query-error", error: errorMessage(err) };
  } finally {
    if (tempDir) {
      await deps.rmrf(tempDir).catch(() => {});
    }
  }
}

// ── WRITE PATH (write-vault-rename-to-store D2) ──────────────────────────────
// The read path above queries a TEMP COPY on purpose, so a write there would be
// discarded. A rename must instead mutate the LIVE store: open it read-write via
// `node:sqlite` with a short `busy_timeout` (so a running agent's WAL lock doesn't
// fail the write) and run ONE parameterized UPDATE in autocommit — the name is a
// BOUND parameter, never interpolated. `node:sqlite`-only: the `sqlite3` CLI's
// parameter binding is clunky/injection-prone, and the host Node 22 runtime
// (engines.vscode ^1.105) guarantees the built-in. When it's unavailable the write
// is a no-op (`no-sqlite3`) and the caller falls back to the sidecar overlay,
// preserving the read-only guarantee. Never throws.

export type SqliteWriteStatus = "ok" | "no-sqlite3" | "no-db" | "not-found" | "write-error";
export type SqliteWriteParam = string | number;

export interface SqliteWriteResult {
  status: SqliteWriteStatus;
  /** Rows modified by the UPDATE (0 → `not-found`). */
  changes: number;
  /** Populated only for `write-error`. */
  error?: string;
}

/** Injectable IO for the write path — tests stub this to avoid a real DB. */
export interface SqliteWriteDeps {
  exists(p: string): Promise<boolean>;
  /** Whether `node:sqlite` is usable; defaults to the memoized real probe. */
  hasNodeSqlite?(): Promise<boolean>;
  /** Run the parameterized UPDATE against the LIVE db; defaults to the real engine. */
  runNodeWrite?(dbPath: string, sql: string, params: SqliteWriteParam[]): Promise<SqliteWriteResult>;
}

const defaultWriteDeps: SqliteWriteDeps = { exists: defaultDeps.exists };

/** Cap the synchronous write's WAL-lock wait. `node:sqlite` is synchronous, so
 *  this bounds how long a `run()` can block the extension-host event loop under
 *  lock contention. Kept short (2s, not the agents' own 5s) because a rename is
 *  best-effort — on timeout the write degrades to the sidecar overlay, which is far
 *  better than freezing the UI (review S3). Agent write-locks are sub-100ms, so
 *  this ceiling is essentially never reached in practice. */
const WRITE_BUSY_TIMEOUT_MS = 2000;

/**
 * Run a parameterized `UPDATE` against the LIVE db at `dbPath` via `node:sqlite`,
 * read-write, with a short `busy_timeout`. `changes === 0` maps to `not-found`
 * (the row/id isn't present); any throw (incl. `no such table` if the file was
 * created empty by a race) maps to `write-error`. Never throws.
 */
async function defaultRunNodeWrite(
  dbPath: string,
  sql: string,
  params: SqliteWriteParam[],
): Promise<SqliteWriteResult> {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath); // read-write (default open mode)
    try {
      db.exec(`PRAGMA busy_timeout = ${WRITE_BUSY_TIMEOUT_MS}`);
      const info = db.prepare(sql).run(...params);
      const changes = Number(info.changes);
      return { status: changes > 0 ? "ok" : "not-found", changes };
    } finally {
      db.close();
    }
  } catch (err) {
    return { status: "write-error", changes: 0, error: errorMessage(err) };
  }
}

/**
 * Write `sql` (a STATIC parameterized statement, e.g.
 * `UPDATE session SET title = ? WHERE id = ?`) to the LIVE SQLite store at
 * `dbPath` with `params` bound positionally. Never throws — every failure maps to
 * a status:
 * - `no-sqlite3` — the `node:sqlite` engine is unavailable (→ overlay fallback)
 * - `no-db`      — the store file is absent
 * - `not-found`  — the statement matched no row (`changes === 0`)
 * - `write-error`— the write threw (the `error` field carries detail)
 * - `ok`         — the row was updated (`changes > 0`)
 */
export async function writeSqlite(
  dbPath: string,
  sql: string,
  params: SqliteWriteParam[],
  deps: SqliteWriteDeps = defaultWriteDeps,
): Promise<SqliteWriteResult> {
  const hasNode = deps.hasNodeSqlite ? await deps.hasNodeSqlite() : await probeNodeSqlite(defaultDeps);
  if (!hasNode) {
    return { status: "no-sqlite3", changes: 0 };
  }
  let exists = false;
  try {
    exists = await deps.exists(dbPath);
  } catch {
    exists = false;
  }
  if (!exists) {
    return { status: "no-db", changes: 0 };
  }
  return (deps.runNodeWrite ?? defaultRunNodeWrite)(dbPath, sql, params);
}
