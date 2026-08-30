// src/vault/sqlite.ts — WAL-safe, read-only SQLite access (no new native
// dependency). See: design.md D3, D13, D14 (superseded on snapshotting by
// snapshot-a-live-store-atomically design.md D1-D3),
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
// SNAPSHOT: the ENGINE takes the snapshot — SQLite's Online Backup API in process,
// a read-only `VACUUM INTO` on the CLI — into a temp dir we then query. Both run
// inside a read transaction, so a concurrent write, checkpoint or vacuum is
// included or excluded as a unit. We do NOT read the live store in place, and we
// do NOT assemble a snapshot from separately-timed copies of the base file and its
// `-wal`/`-shm` sidecars: no ordering of those copies is safe, because the store
// can checkpoint and vacuum between any two of them, yielding a snapshot that
// passes `integrity_check` while missing a row that was there the whole time.
// A snapshot that cannot be taken reports `db-unreachable`/`query-error`; it is
// never an empty result, which is the failure this mechanism exists to remove.
//
// PERF: a backup copies only the store's LIVE pages and `VACUUM INTO` writes a
// compacted copy, so neither pays for free space — which matters for a multi-GB
// store (OpenCode's exceeds 1 GB). The copy-on-write clone that used to make the
// file copy cheap is gone with it — nothing in this module copies a store now.

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
/** Cap for the snapshot step — a backup of a multi-GB store needs headroom. */
const SNAPSHOT_TIMEOUT_MS = 30000;
/** Pages per backup step — small enough that the deadline is checked often, large
 *  enough that stepping does not dominate the copy. */
const SNAPSHOT_PAGES_PER_STEP = 256;
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
  /**
   * Produce a point-in-time snapshot of the live store at `dest`. Defaults to the
   * real engine. Throws on any failure — a snapshot that could not be taken must
   * never be mistaken for a store that is empty (D2).
   */
  snapshot?(dbPath: string, dest: string): Promise<void>;
  /** Wall clock for the snapshot, in ms. Defaults to `SNAPSHOT_TIMEOUT_MS`; tests
   *  lower it to drive the real deadline through the real progress callback. */
  snapshotTimeoutMs?: number;
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

/**
 * Snapshot a live store using SQLite's Online Backup API, opening the source
 * READ-ONLY (D3 — the store belongs to a running agent; a read must never take a
 * write lock on it). The backup runs inside a read transaction, so writers,
 * checkpoints and vacuums during it are included or excluded as a unit. That
 * atomicity is the point: assembling a snapshot from separately-timed copies of
 * the base file and its sidecars cannot be made correct by ordering them, because
 * the store can checkpoint and vacuum between any two of those copies.
 */
/** One snapshot, whichever engine is in play: the Online Backup API in process,
 *  a read-only `VACUUM INTO` on the CLI. Both are atomic against a concurrent
 *  writer, checkpoint or vacuum; neither copies files. */
async function takeSnapshot(deps: SqliteDeps, dbPath: string, dest: string, useCli: boolean): Promise<void> {
  if (deps.snapshot) {
    await deps.snapshot(dbPath, dest);
    return;
  }
  const budget = deps.snapshotTimeoutMs ?? SNAPSHOT_TIMEOUT_MS;
  await (useCli ? cliSnapshot(deps, budget) : defaultSnapshot)(dbPath, dest, budget);
}

/** The CLI engine's snapshot: `VACUUM INTO` under `-readonly`. VACUUM INTO runs
 *  inside a read transaction, so it is atomic against a concurrent checkpoint or
 *  vacuum the same way the Online Backup API is. `.backup` would do as well but
 *  opens the source read-WRITE, which D3 forbids for a store a live agent owns.
 *  The destination is quoted as a SQL string literal — it is a path we minted
 *  under `mkdtemp`, never caller input. */
function cliSnapshot(deps: SqliteDeps, budget: number): (dbPath: string, dest: string) => Promise<void> {
  return async (dbPath, dest) => {
    try {
      await deps.exec("sqlite3", ["-readonly", dbPath, `VACUUM INTO '${dest.replaceAll("'", "''")}'`], {
        timeout: budget,
      });
    } catch (err) {
      if (!isOpenClass(err)) {
        throw err;
      }
      // `VACUUM INTO` raises the same CANTOPEN for a source it cannot read and a
      // destination it cannot create, so ask the source to prove itself before
      // blaming it (W1) — the same proof the in-process path makes.
      throw (await cliSourceReads(deps, dbPath, budget)) ? err : new SnapshotOpenError(errorMessage(err));
    }
  };
}

/** Whether the CLI can still read the source at all. Runs only on the failure
 *  path, so a healthy snapshot pays nothing for it. */
async function cliSourceReads(deps: SqliteDeps, dbPath: string, budget: number): Promise<boolean> {
  try {
    await deps.exec("sqlite3", ["-readonly", dbPath, "SELECT 1"], { timeout: budget });
    return true;
  } catch {
    return false;
  }
}

async function defaultSnapshot(dbPath: string, dest: string, budget: number): Promise<void> {
  const { DatabaseSync, backup } = await import("node:sqlite");
  // node:sqlite opens lazily, so a refusal can surface at the constructor OR at
  // the backup. Classify by the error, not by where it was thrown — and only
  // after proving the SOURCE is the one refusing (W1): the same SQLITE_CANTOPEN
  // can come from the destination, and blaming the user's store for our own temp
  // directory is the misattribution D2 exists to prevent.
  let source: InstanceType<typeof DatabaseSync> | undefined;
  const deadline = Date.now() + budget;
  try {
    source = new DatabaseSync(dbPath, { readOnly: true });
    // SQLite RESTARTS an incremental backup whenever the source is written, so a
    // busy store can starve it indefinitely. Stepping with a progress callback
    // gives a place to enforce a wall clock, and throwing from it aborts the
    // backup for real rather than leaving it running behind a settled promise.
    await backup(source, dest, {
      rate: SNAPSHOT_PAGES_PER_STEP,
      progress: () => {
        if (Date.now() > deadline) {
          throw new Error(`snapshot exceeded ${budget}ms`);
        }
      },
    });
  } catch (err) {
    throw isSourceRefusal(err, source) ? new SnapshotOpenError(errorMessage(err)) : err;
  } finally {
    source?.close();
  }
}

/** Whether SQLite refused to open the SOURCE, as opposed to failing anywhere else.
 *  An open-class result code is necessary but not sufficient — the destination
 *  raises the same codes — so the source is asked to prove it is readable. */
function isSourceRefusal(err: unknown, source: { prepare(sql: string): { get(): unknown } } | undefined): boolean {
  if (!isOpenClass(err)) {
    return false;
  }
  if (!source) {
    return true; // never got a connection at all
  }
  try {
    source.prepare("SELECT 1").get();
    return false; // the source reads fine — something else refused
  } catch {
    return true;
  }
}

/** Whether SQLite refused to OPEN the store rather than failing to read it.
 *  Classified by primary result code where the engine gives one — the extended
 *  code's low byte — because the message varies by sub-case: a missing `-shm`
 *  that cannot be created reports SQLITE_READONLY ("attempt to write a readonly
 *  database", errcode 1544 = SQLITE_READONLY_DIRECTORY) while a sidecar in an
 *  unreadable directory reports SQLITE_CANTOPEN. The CLI gives no code, so its
 *  message is matched instead. */
const OPEN_REFUSAL_CODES = new Set([3, 8, 14, 23]); // PERM, READONLY, CANTOPEN, AUTH
function isOpenClass(err: unknown): boolean {
  const errcode = (err as { errcode?: unknown } | undefined)?.errcode;
  if (typeof errcode === "number") {
    return OPEN_REFUSAL_CODES.has(errcode & 0xff);
  }
  return /unable to open|readonly database|SQLITE_CANTOPEN|SQLITE_READONLY|SQLITE_PERM/i.test(errorMessage(err));
}

/** A snapshot that failed at the OPEN, which the entry points report as
 *  `db-unreachable` rather than `query-error`. Marked by a field rather than by
 *  `instanceof` so it survives bundling. */
class SnapshotOpenError extends Error {
  readonly snapshotOpenFailure = true;
}

function isOpenFailure(err: unknown): boolean {
  return (err as SnapshotOpenError | undefined)?.snapshotOpenFailure === true;
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

  return readSqliteViaSnapshot(deps, dbPath, sql, useCli);
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
    await takeSnapshot(deps, dbPath, dbCopy, useCli);
    const snapshot: SqliteSnapshot = {
      query: (sql) => (useCli ? runQuery(deps, dbCopy, sql) : (deps.runNodeQuery ?? defaultRunNodeQuery)(dbCopy, sql)),
    };
    return { status: "ok", value: await callback(snapshot) };
  } catch (err) {
    if (isOpenFailure(err)) {
      return { status: "db-unreachable", error: errorMessage(err) };
    }
    return { status: "query-error", error: errorMessage(err) };
  } finally {
    if (tempDir) {
      await deps.rmrf(tempDir).catch(() => {});
    }
  }
}

/**
 * Take one engine snapshot into a temp dir, query it, then delete it. Never reads
 * the live store in place and never assembles the snapshot from file copies.
 * Never throws — a failed open maps to `db-unreachable`, anything else to
 * `query-error`, and neither is ever an empty `ok`.
 */
async function readSqliteViaSnapshot(
  deps: SqliteDeps,
  dbPath: string,
  sql: string,
  useCli: boolean,
): Promise<SqliteResult> {
  let tempDir: string | undefined;
  try {
    tempDir = await deps.mkdtemp();
    const dbCopy = path.join(tempDir, "db.sqlite");
    await takeSnapshot(deps, dbPath, dbCopy, useCli);
    return useCli ? await runQuery(deps, dbCopy, sql) : await (deps.runNodeQuery ?? defaultRunNodeQuery)(dbCopy, sql);
  } catch (err) {
    if (isOpenFailure(err)) {
      return { rows: [], status: "db-unreachable", error: errorMessage(err) };
    }
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
