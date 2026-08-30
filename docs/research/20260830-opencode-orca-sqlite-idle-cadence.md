---
topic: opencode-orca-sqlite-idle-cadence
created-by: reuse-a-snapshot-while-the-store-is-unchanged
date: 2026-08-30
verified: 2026-08-30
libraries: [bun:sqlite, node:sqlite, drizzle-orm, SQLite WAL]
used-by: [reuse-a-snapshot-while-the-store-is-unchanged]
---

# Research: OpenCode and Orca SQLite Idle Cadence

Source revisions: `anomalyco/opencode@10765ff2a9da8c3b88e4de873aa383a49c318912` (2026-08-30), `stablyai/orca@9062494f9b232112cbbe137f985a6ff67c8da37b` (2026-08-26).

## 1. OpenCode writer, journal mode, and idle write/checkpoint cadence

OpenCode core `1.18.25` selects the SQLite adapter by runtime: `"bun" -> sqlite.bun.ts`, `"node" -> sqlite.node.ts`, defaulting to Bun (`/Users/huybuidac/Projects/ai-oss/opencode/packages/core/package.json:3-4,25-30`). The Bun adapter is explicitly `bun:sqlite` plus Drizzle:

> `import { Database } from "bun:sqlite"`
>
> `import { drizzle } from "drizzle-orm/bun-sqlite"`

(`/Users/huybuidac/Projects/ai-oss/opencode/packages/core/src/database/sqlite.bun.ts:1-2`). It constructs one native `Database` and closes it only through the layer finalizer (`sqlite.bun.ts:154-165`). The Node build analog uses `node:sqlite` `DatabaseSync` plus `drizzle-orm/node-sqlite` (`sqlite.node.ts:1-2,147-160`). `better-sqlite3` is not the production driver.

Database initialization sets:

> `PRAGMA journal_mode = WAL`
>
> `PRAGMA synchronous = NORMAL`
>
> `PRAGMA busy_timeout = 5000`
>
> `PRAGMA cache_size = -64000`
>
> `PRAGMA foreign_keys = ON`
>
> `PRAGMA wal_checkpoint(PASSIVE)`

(`/Users/huybuidac/Projects/ai-oss/opencode/packages/core/src/database/database.ts:22-36`). The database service is in the process-wide `AppLayer` (`/Users/huybuidac/Projects/ai-oss/opencode/packages/opencode/src/effect/app-runtime.ts:58-63,109-112`), so the connection is long-lived.

Writes are event-driven: session creation/update/delete and message/part events execute Drizzle inserts/updates/deletes (`/Users/huybuidac/Projects/ai-oss/opencode/packages/core/src/session/projector.ts:210-270,320-345,385-411`). The only 15-second heartbeat found is an SSE comment merged into the HTTP response, not a database event (`/Users/huybuidac/Projects/ai-oss/opencode/packages/server/src/handlers/event.ts:30-39`). OTLP telemetry is exported over HTTP when configured and has no SQLite write (`/Users/huybuidac/Projects/ai-oss/opencode/packages/core/src/observability/otlp.ts:50-76`). Repo-wide searches found no periodic `wal_checkpoint`, `PRAGMA optimize`, `VACUUM`, session last-seen write, or database telemetry heartbeat; the sole checkpoint is the initialization call above.

**Verdict:** after process/database initialization, a merely open and idle session has no source-defined DB/WAL write or checkpoint timer. Reuse should hit throughout genuine idle periods; startup may perform one passive checkpoint, and user/session events invalidate it.

## 2. Connection lifetime, synchronous mode, and WAL auto-checkpoint churn

The connection is long-lived as above and uses `synchronous=NORMAL` (`database.ts:27-32`). OpenCode does not set `wal_autocheckpoint` anywhere in either local source tree, so SQLite's configured/build default applies. SQLite documents the normal default as 1000 pages and triggers auto-checkpoint when a **commit** crosses the threshold or when the last connection closes; it is not idle-timer-driven. Automatic checkpoints are PASSIVE and normally recycle rather than truncate the WAL. OpenCode's explicit startup checkpoint is also PASSIVE, not TRUNCATE (`database.ts:32`).

Because the global connection remains open, last-connection-close cleanup does not recur while the app sits idle. Without commits there is neither WAL growth nor auto-checkpoint churn. During active writes, commits append/reuse WAL frames and threshold-crossing commits may checkpoint; on clean final close SQLite may checkpoint and remove WAL/SHM.

**Verdict:** long-lived connection: yes; `synchronous=NORMAL`: yes; explicit `wal_autocheckpoint`: no. These settings do not produce DB or WAL mtime/size churn without commits.

## 3. Orca reads and cache invalidation

Orca does not snapshot/copy OpenCode's live DB. AI Vault opens it directly with `node:sqlite` in read-only mode, sets `query_only`, fully materializes the read, and closes the handle:

> `const db = new SyncDatabase(dbPath, { readonly: true, fileMustExist: true, timeout: ... })`
>
> `db.pragma('query_only = ON')`
>
> `try { return args.read(db) } finally { db.close() }`

(`/Users/huybuidac/Projects/ai-oss/orca/src/main/ai-vault/session-scanner-opencode-sqlite-open.ts:38-45,54-63`). The wrapper maps this to `new DatabaseSync(path, { readOnly, timeout })` (`/Users/huybuidac/Projects/ai-oss/orca/src/main/sqlite/sync-database.ts:30-37,43-57`). Listing and per-session parsing each use this open/read/close wrapper (`session-scanner-opencode-sqlite-list.ts:101-121`; `session-scanner-opencode-sqlite.ts:247-255`).

AI Vault's general parse cache uses `(path, platform, mtimeMs, sizeBytes)` equality (`/Users/huybuidac/Projects/ai-oss/orca/src/main/ai-vault/session-scanner-parse-cache.ts:34-40,175-188`). For OpenCode SQLite candidates, however, the synthetic `<db>#<session>` candidate's `mtimeMs` is the row's `session.time_updated` (fallback `time_created`) and no DB/WAL generation is included (`/Users/huybuidac/Projects/ai-oss/orca/src/main/ai-vault/session-scanner-opencode-sqlite-list.ts:57-69,90-99`). OpenCode is explicitly non-incremental and gets only unchanged-candidate reuse (`session-scanner-parse-cache.ts:42-46,78-82`).

Orca's separate OpenCode usage scanner also opens the live DB directly read-only and closes it (`/Users/huybuidac/Projects/ai-oss/orca/src/main/opencode-usage/scanner.ts:51-59,92-94`). Its persisted cache invalidates only on the main DB file's `(mtimeMs,size)`:

> `previous.mtimeMs === databaseInfo.mtimeMs && previous.size === databaseInfo.size`

(`/Users/huybuidac/Projects/ai-oss/orca/src/main/opencode-usage/scanner.ts:122-140`), where `getProcessedDatabaseInfo` stats only `dbPath` (`/Users/huybuidac/Projects/ai-oss/orca/src/main/opencode-usage/opencode-database-discovery.ts:85-93`). It does not include `-wal`, so commits still resident only in WAL can evade that cache key until a checkpoint changes the main DB.

**Verdict:** direct short-lived read-only opens; no snapshot/copy and no SQLite generation counter. AI Vault caches per session using row `time_updated`; usage caching uses main-DB `(mtime,size)` only. Neither existing key is as complete as proposed `(db mtime,size)+(wal mtime,size)`.

## 4. `PRAGMA data_version`

Repo-wide searches over OpenCode `packages/` and Orca `src/` found no `PRAGMA data_version` or `data_version` use at the revisions above.

SQLite's documented constraint is important: values are meaningful only between two reads on the **same connection**; they change for commits by another connection, remain unchanged for commits by that same observer connection, and values from separate connections are not comparable. Therefore Orca's current open/read/close pattern cannot persist a `data_version` integer and compare it on the next fresh handle. A valid detector would require retaining one read-only/query-only observer connection and issuing `PRAGMA data_version` on that same handle; it is not a global on-disk generation counter. This can complement filesystem identity but is not a drop-in replacement for cross-process snapshot-cache persistence or after reconnect.

**Verdict:** neither project uses it. It can avoid mtime-granularity ambiguity only with a stable long-lived read-only observer connection; Orca's fresh-per-read handles cannot use it as a cross-scan key.

## Recommended Approach

- Keep the proposed key over both `<db>` and `<db>-wal`, excluding `-shm`; it covers OpenCode's commit and checkpoint paths better than Orca's existing caches.
- Treat missing/present transitions of `-wal` as key changes, and re-stat before publishing/reusing a snapshot to reject a commit or checkpoint racing the copy.
- Consider `PRAGMA data_version` only as an in-process enhancement backed by one retained read-only observer connection, never as a persisted or cross-connection generation value.

## Confidence

High — conclusions come from current local source at recorded commits, repo-wide timer/maintenance searches, and SQLite's official WAL and `data_version` documentation.

**Bottom line: reuse-hit-rate risk: low, because OpenCode has no idle DB maintenance/heartbeat writes and SQLite auto-checkpointing is commit/last-close driven, so `<db>` and `<db>-wal` remain still between genuinely idle reads.**
