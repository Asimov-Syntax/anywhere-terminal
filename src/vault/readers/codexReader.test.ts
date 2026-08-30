// src/vault/readers/codexReader.test.ts — Unit tests for the Codex reader.

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VAULT_CACHE_VERSION } from "../cacheTypes";
import type { SqliteResult } from "../sqlite";
import { lookupCodexEntry, pickRolloutPath, readCodexEntry, readCodexSessions } from "./codexReader";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_CODEX_DIR = path.join(here, "..", "__fixtures__", "codex");

function stubSqlite(result: SqliteResult) {
  return vi.fn(async (_dbPath: string, _sql: string) => result);
}

function stubSqliteBySql(handler: (sql: string) => SqliteResult) {
  return vi.fn(async (_dbPath: string, sql: string) => handler(sql));
}

const SAMPLE_ROWS: Record<string, unknown>[] = [
  {
    id: "t1",
    rollout_path: "/r/t1.jsonl",
    cwd: "/Users/me/a",
    title: "first thread",
    model: "gpt-5-codex",
    git_branch: "main",
    approval_mode: "on-request",
    sandbox_policy: '{"type":"workspace-write"}',
    reasoning_effort: "high",
    first_user_message: "ignored because title present",
    updated_at_ms: 2000,
  },
  {
    id: "t2",
    cwd: "/Users/me/b",
    title: "",
    first_user_message: "second thread first message",
    updated_at_ms: 1000,
  },
];

describe("readCodexSessions: SQLite path", () => {
  it("queries the threads table with archived filter + recency order", async () => {
    const fn = stubSqlite({ status: "ok", rows: SAMPLE_ROWS });
    await readCodexSessions({ codexDir: "/x/.codex", readSqliteFn: fn });
    const [dbPath, sql] = fn.mock.calls[0];
    expect(dbPath).toBe("/x/.codex/state_5.sqlite");
    expect(sql).toContain("FROM threads");
    expect(sql).toContain("archived = 0");
    expect(sql).toContain("ORDER BY updated_at_ms DESC");
  });

  it("maps thread rows to entries with flags", async () => {
    const fn = stubSqlite({ status: "ok", rows: SAMPLE_ROWS });
    const { entries, unreadable } = await readCodexSessions({ codexDir: "/x/.codex", readSqliteFn: fn });
    expect(unreadable).toBe(0);
    expect(entries).toHaveLength(2);
    const t1 = entries[0];
    expect(t1.id).toBe("codex:t1");
    expect(t1.title).toBe("first thread");
    expect(t1.flags).toEqual({
      model: "gpt-5-codex",
      approval: "on-request",
      sandbox: "workspace-write",
      reasoningEffort: "high",
    });
  });

  it("falls back to first_user_message when title is empty", async () => {
    const fn = stubSqlite({ status: "ok", rows: SAMPLE_ROWS });
    const { entries } = await readCodexSessions({ codexDir: "/x/.codex", readSqliteFn: fn });
    expect(entries[1].title).toBe("second thread first message");
  });

  it("skips and counts rows without an id", async () => {
    const fn = stubSqlite({ status: "ok", rows: [{ cwd: "/no/id" }, SAMPLE_ROWS[0]] });
    const { entries, unreadable } = await readCodexSessions({ codexDir: "/x/.codex", readSqliteFn: fn });
    expect(entries).toHaveLength(1);
    expect(unreadable).toBe(1);
  });

  it("hides child threads linked by thread_spawn_edges without counting them unreadable", async () => {
    const rows = [
      { id: "child", title: "child", updated_at_ms: 3000 },
      { id: "root", title: "root", updated_at_ms: 2000 },
    ];
    const fn = stubSqliteBySql((sql) =>
      sql.includes("thread_spawn_edges")
        ? { status: "ok", rows: [{ parent_thread_id: "root", child_thread_id: "child", status: "completed" }] }
        : { status: "ok", rows },
    );

    const { entries, unreadable } = await readCodexSessions({ codexDir: "/x/.codex", readSqliteFn: fn });

    expect(entries.map((entry) => entry.sessionId)).toEqual(["root"]);
    expect(unreadable).toBe(0);
  });

  it("hides child threads linked by threads.source subagent metadata", async () => {
    const rows = [
      {
        id: "child",
        title: "child",
        updated_at_ms: 3000,
        source: JSON.stringify({ subagent: { thread_spawn: { parent_thread_id: "root" } } }),
      },
      { id: "root", title: "root", updated_at_ms: 2000 },
    ];
    const fn = stubSqliteBySql((sql) =>
      sql.includes("thread_spawn_edges")
        ? { status: "query-error", rows: [], error: "no such table" }
        : { status: "ok", rows },
    );

    const { entries } = await readCodexSessions({ codexDir: "/x/.codex", readSqliteFn: fn });

    expect(entries.map((entry) => entry.sessionId)).toEqual(["root"]);
  });

  it("uses first-line JSONL metadata to hide children when SQLite lacks parentage metadata", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "vault-codex-jsonl-parentage-"));
    try {
      await fsp.mkdir(path.join(dir, "sessions", "2026", "06", "01"), { recursive: true });
      await fsp.writeFile(
        path.join(dir, "sessions", "2026", "06", "01", "rollout-child.jsonl"),
        `${JSON.stringify({
          type: "session_meta",
          timestamp: "2026-06-01T00:00:00.000Z",
          payload: {
            id: "child",
            source: { subagent: { thread_spawn: { parent_thread_id: "root" } } },
          },
        })}\n`,
      );
      const rows = [
        { id: "child", title: "child", updated_at_ms: 3000 },
        { id: "root", title: "root", updated_at_ms: 2000 },
      ];
      const fn = stubSqliteBySql((sql) => {
        if (sql.includes("source") || sql.includes("thread_spawn_edges")) {
          return { status: "query-error", rows: [], error: "optional schema missing" };
        }
        return { status: "ok", rows };
      });

      const { entries } = await readCodexSessions({ codexDir: dir, readSqliteFn: fn });

      expect(entries.map((entry) => entry.sessionId)).toEqual(["root"]);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("applies the root limit after filtering child rows", async () => {
    const childRows = Array.from({ length: 500 }, (_, index) => ({
      id: `child-${index}`,
      title: `child ${index}`,
      updated_at_ms: 10_000 - index,
    }));
    const rootRow = { id: "root-after-children", title: "root", updated_at_ms: 1 };
    const fn = stubSqliteBySql((sql) => {
      if (sql.includes("thread_spawn_edges")) {
        return {
          status: "ok",
          rows: childRows.map((row) => ({ parent_thread_id: "root-after-children", child_thread_id: row.id })),
        };
      }
      return { status: "ok", rows: sql.includes("LIMIT 500") ? childRows : [...childRows, rootRow] };
    });

    const { entries } = await readCodexSessions({ codexDir: "/x/.codex", readSqliteFn: fn });

    expect(entries.map((entry) => entry.sessionId)).toEqual(["root-after-children"]);
  });
});

describe("readCodexSessions: fallback + errors", () => {
  it("falls back to JSONL scan when the DB is absent", async () => {
    const fn = stubSqlite({ status: "no-db", rows: [] });
    const { entries } = await readCodexSessions({ codexDir: FIXTURE_CODEX_DIR, readSqliteFn: fn });
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("codex:codex-sess-1");
    expect(entries[0].cwd).toBe("/Users/me/codexproj");
  });

  it("falls back to JSONL scan when sqlite3 is unavailable", async () => {
    const fn = stubSqlite({ status: "no-sqlite3", rows: [] });
    const { entries } = await readCodexSessions({ codexDir: FIXTURE_CODEX_DIR, readSqliteFn: fn });
    expect(entries).toHaveLength(1);
  });

  it("does NOT fall back on query-error — surfaces it as unreadable", async () => {
    const fn = stubSqlite({ status: "query-error", rows: [], error: "boom" });
    const { entries, unreadable } = await readCodexSessions({ codexDir: FIXTURE_CODEX_DIR, readSqliteFn: fn });
    expect(entries).toEqual([]);
    expect(unreadable).toBe(1);
  });

  it("returns zero entries when fallback dir is also absent", async () => {
    const fn = stubSqlite({ status: "no-db", rows: [] });
    const { entries, unreadable } = await readCodexSessions({ codexDir: "/nonexistent/.codex", readSqliteFn: fn });
    expect(entries).toEqual([]);
    expect(unreadable).toBe(0);
  });

  it("omits JSONL fallback children from the top-level list", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "vault-codex-jsonl-fallback-"));
    try {
      const sessionsDir = path.join(dir, "sessions", "2026", "06", "02");
      await fsp.mkdir(sessionsDir, { recursive: true });
      await fsp.writeFile(
        path.join(sessionsDir, "rollout-root.jsonl"),
        `${JSON.stringify({ type: "session_meta", payload: { id: "root", cwd: "/repo" } })}\n`,
      );
      await fsp.writeFile(
        path.join(sessionsDir, "rollout-child.jsonl"),
        `${JSON.stringify({
          type: "session_meta",
          payload: {
            id: "child",
            cwd: "/repo",
            source: { subagent: { thread_spawn: { parent_thread_id: "root" } } },
          },
        })}\n`,
      );
      const fn = stubSqlite({ status: "no-db", rows: [] });

      const { entries, unreadable } = await readCodexSessions({ codexDir: dir, readSqliteFn: fn });

      expect(entries.map((entry) => entry.sessionId)).toEqual(["root"]);
      expect(unreadable).toBe(0);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("readCodexSessions: sandbox_policy → -s value", () => {
  async function sandboxOf(sandbox_policy: unknown): Promise<string | undefined> {
    const fn = stubSqlite({ status: "ok", rows: [{ id: "t1", title: "t", updated_at_ms: 1, sandbox_policy }] });
    const { entries } = await readCodexSessions({ codexDir: "/x/.codex", readSqliteFn: fn });
    return entries[0].flags.sandbox;
  }

  it("passes through the direct CLI modes", async () => {
    expect(await sandboxOf('{"type":"read-only"}')).toBe("read-only");
    expect(await sandboxOf('{"type":"workspace-write"}')).toBe("workspace-write");
    expect(await sandboxOf('{"type":"danger-full-access"}')).toBe("danger-full-access");
  });

  it("collapses a managed policy with a write entry to workspace-write", async () => {
    const policy = JSON.stringify({
      type: "managed",
      file_system: {
        type: "restricted",
        entries: [
          { path: { type: "special", value: { kind: "root" } }, access: "read" },
          { path: { type: "path", path: "/p" }, access: "write" },
        ],
      },
      network: "restricted",
    });
    expect(await sandboxOf(policy)).toBe("workspace-write");
  });

  it("collapses a read-only managed policy to read-only", async () => {
    const policy = JSON.stringify({
      type: "managed",
      file_system: {
        type: "restricted",
        entries: [{ path: { type: "special", value: { kind: "root" } }, access: "read" }],
      },
      network: "restricted",
    });
    expect(await sandboxOf(policy)).toBe("read-only");
  });

  it("omits -s for an unknown/future policy type or non-JSON garbage", async () => {
    expect(await sandboxOf('{"type":"something-new"}')).toBeUndefined();
    expect(await sandboxOf("not json")).toBeUndefined();
    expect(await sandboxOf(null)).toBeUndefined();
  });
});

describe("readCodexSessions: cache schema", () => {
  it("bumps the persisted vault list cache version to invalidate stale sandbox values", () => {
    // A FLOOR, not a pin: this guards that caches predating the sandbox fix (v<3)
    // can never be reused. A literal made every later bump — for a derivation this
    // test knows nothing about — fail here instead of where it belongs; the
    // discard behaviour itself is asserted in VaultCacheStore.test.ts.
    expect(VAULT_CACHE_VERSION).toBeGreaterThanOrEqual(3);
  });
});

describe("readCodexEntry: single-entry resolve", () => {
  it("resolves one thread by id (point lookup on the threads table)", async () => {
    const fn = stubSqlite({ status: "ok", rows: [SAMPLE_ROWS[0]] });
    const entry = await readCodexEntry("t1", { codexDir: "/x/.codex", readSqliteFn: fn });
    const [dbPath, sql] = fn.mock.calls[0];
    expect(dbPath).toBe("/x/.codex/state_5.sqlite");
    expect(sql).toContain("WHERE id = 't1'");
    expect(entry?.id).toBe("codex:t1");
    expect(entry?.flags.model).toBe("gpt-5-codex");
  });

  it("returns null for an unsafe id without touching the db", async () => {
    const fn = stubSqlite({ status: "ok", rows: [] });
    expect(await readCodexEntry("../escape", { codexDir: "/x/.codex", readSqliteFn: fn })).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns null when the thread row is missing", async () => {
    const fn = stubSqlite({ status: "ok", rows: [] });
    expect(await readCodexEntry("ghost", { codexDir: "/x/.codex", readSqliteFn: fn })).toBeNull();
  });

  it("returns null (no throw) when no DB and no rollout matches the id", async () => {
    const fn = stubSqlite({ status: "no-db", rows: [] });
    expect(await readCodexEntry("no-such-uuid", { codexDir: FIXTURE_CODEX_DIR, readSqliteFn: fn })).toBeNull();
  });
});

describe("readCodexSessions: home resolution", () => {
  const orig = { home: process.env.CODEX_HOME, sqlite: process.env.CODEX_SQLITE_HOME };
  afterEach(() => {
    for (const [key, value] of [
      ["CODEX_HOME", orig.home],
      ["CODEX_SQLITE_HOME", orig.sqlite],
    ] as const) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("defaults to <home>/.codex/state_5.sqlite (correct on Windows via os.homedir)", async () => {
    delete process.env.CODEX_HOME;
    delete process.env.CODEX_SQLITE_HOME;
    const fn = stubSqlite({ status: "ok", rows: [] });
    await readCodexSessions({ home: "/home/u", readSqliteFn: fn });
    expect(fn.mock.calls[0][0]).toBe(path.join("/home/u", ".codex", "state_5.sqlite"));
  });

  it("honors $CODEX_HOME for both the DB and the sessions dir", async () => {
    process.env.CODEX_HOME = path.join(os.tmpdir(), "codex-home-does-not-exist");
    delete process.env.CODEX_SQLITE_HOME;
    const fn = stubSqlite({ status: "ok", rows: [] });
    await readCodexSessions({ readSqliteFn: fn });
    expect(fn.mock.calls[0][0]).toBe(path.join(process.env.CODEX_HOME as string, "state_5.sqlite"));
  });

  it("relocates only the DB via $CODEX_SQLITE_HOME", async () => {
    process.env.CODEX_HOME = "/codex/home";
    process.env.CODEX_SQLITE_HOME = "/codex/db";
    const fn = stubSqlite({ status: "ok", rows: [] });
    await readCodexSessions({ readSqliteFn: fn });
    expect(fn.mock.calls[0][0]).toBe(path.join("/codex/db", "state_5.sqlite"));
  });
});

describe("readCodexSessions: incremental store stamp", () => {
  const dirs: string[] = [];
  const origSqliteHome = process.env.CODEX_SQLITE_HOME;

  afterEach(async () => {
    if (origSqliteHome === undefined) {
      delete process.env.CODEX_SQLITE_HOME;
    } else {
      process.env.CODEX_SQLITE_HOME = origSqliteHome;
    }
    for (const d of dirs.splice(0)) {
      await fsp.rm(d, { recursive: true, force: true });
    }
  });

  async function makeDb(): Promise<string> {
    delete process.env.CODEX_SQLITE_HOME; // ensure dbPath resolves under codexDir
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "vault-codex-inc-"));
    dirs.push(dir);
    await fsp.writeFile(path.join(dir, "state_5.sqlite"), "dummy-db-bytes");
    return dir;
  }

  it("reuses cached entries without querying when the store is unchanged", async () => {
    const dir = await makeDb();
    const fn = stubSqlite({ status: "ok", rows: SAMPLE_ROWS });
    const first = await readCodexSessions({ codexDir: dir, readSqliteFn: fn }, undefined);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(first.entries).toHaveLength(2);
    expect(first.cache.kind).toBe("store");

    const second = await readCodexSessions({ codexDir: dir, readSqliteFn: fn }, first.cache);
    expect(fn).toHaveBeenCalledTimes(2); // unchanged store → no re-query
    expect(second.entries).toHaveLength(2);
  });

  it("re-queries when the db mtime changes", async () => {
    const dir = await makeDb();
    const fn = stubSqlite({ status: "ok", rows: SAMPLE_ROWS });
    const first = await readCodexSessions({ codexDir: dir, readSqliteFn: fn }, undefined);
    const future = new Date(Date.now() + 60_000);
    await fsp.utimes(path.join(dir, "state_5.sqlite"), future, future);
    await readCodexSessions({ codexDir: dir, readSqliteFn: fn }, first.cache);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("preserves the unreadable count on reuse (no silent reset to 0)", async () => {
    const dir = await makeDb();
    const rows = [SAMPLE_ROWS[0], { cwd: "/no-id" }]; // 2nd row lacks id → unreadable
    const fn = stubSqlite({ status: "ok", rows });
    const first = await readCodexSessions({ codexDir: dir, readSqliteFn: fn }, undefined);
    expect(first.unreadable).toBe(1);
    const second = await readCodexSessions({ codexDir: dir, readSqliteFn: fn }, first.cache);
    expect(fn).toHaveBeenCalledTimes(2); // reused
    expect(second.unreadable).toBe(1); // carried, not reset
  });

  it("does not reuse DB cache when SQLite parentage is unavailable and JSONL fallback may participate", async () => {
    const dir = await makeDb();
    const fn = stubSqliteBySql((sql) => {
      if (sql.includes("source") || sql.includes("thread_spawn_edges")) {
        return { status: "query-error", rows: [], error: "optional parentage missing" };
      }
      return { status: "ok", rows: SAMPLE_ROWS };
    });
    const first = await readCodexSessions({ codexDir: dir, readSqliteFn: fn }, undefined);
    expect(first.entries).toHaveLength(2);

    await readCodexSessions({ codexDir: dir, readSqliteFn: fn }, first.cache);

    expect(fn).toHaveBeenCalledTimes(6);
  });

  it("retries a query-error instead of reusing it as an empty success", async () => {
    const dir = await makeDb();
    const fn = stubSqlite({ status: "query-error", rows: [], error: "boom" });
    const first = await readCodexSessions({ codexDir: dir, readSqliteFn: fn }, undefined);
    expect(first.unreadable).toBe(1);
    // Empty sources cached → next refresh must re-query (not reuse the error as ok).
    const second = await readCodexSessions({ codexDir: dir, readSqliteFn: fn }, first.cache);
    expect(fn).toHaveBeenCalledTimes(4);
    expect(second.unreadable).toBe(1);
  });
});

describe("pickRolloutPath containment", () => {
  // The index stores a rollout path the reader did not write. Trusting its
  // spelling is what these cases refuse: the answer is used to OPEN a file, so
  // it has to be true of the file that would actually be opened.
  let tmp: string;

  afterEach(async () => {
    if (tmp) {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  const setup = async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-rollout-"));
    const sessionsDir = path.join(tmp, "sessions");
    await fsp.mkdir(sessionsDir, { recursive: true });
    return sessionsDir;
  };

  const SESSION = "0199a000-1111-7222-8333-444444444444";

  it("uses a stored path that genuinely resolves inside the sessions dir", async () => {
    const sessionsDir = await setup();
    const real = path.join(sessionsDir, `rollout-2026-01-01T00-00-00-${SESSION}.jsonl`);
    await fsp.writeFile(real, "{}\n");
    expect(await pickRolloutPath({ rolloutPath: real }, SESSION, sessionsDir)).toBe(real);
  });

  it("ignores a stored path that escapes through a link, and scans by filename instead", async () => {
    const sessionsDir = await setup();
    const outside = path.join(tmp, "outside");
    await fsp.mkdir(outside);
    await fsp.writeFile(path.join(outside, "stolen.jsonl"), "{}\n");
    await fsp.symlink(path.join(outside, "stolen.jsonl"), path.join(sessionsDir, "escape.jsonl"));
    const real = path.join(sessionsDir, `rollout-2026-01-01T00-00-00-${SESSION}.jsonl`);
    await fsp.writeFile(real, "{}\n");

    const picked = await pickRolloutPath({ rolloutPath: path.join(sessionsDir, "escape.jsonl") }, SESSION, sessionsDir);
    expect(picked).toBe(real);
  });

  it("keeps working when the sessions dir itself is reached through a link", async () => {
    const sessionsDir = await setup();
    const linked = path.join(tmp, "linked-sessions");
    await fsp.symlink(sessionsDir, linked);
    const real = path.join(linked, `rollout-2026-01-01T00-00-00-${SESSION}.jsonl`);
    await fsp.writeFile(real, "{}\n");
    expect(await pickRolloutPath({ rolloutPath: real }, SESSION, linked)).toBe(real);
  });

  it("refuses a stored path equal to the sessions dir, so the filename scan still runs", async () => {
    // A directory passes the loose lexical form; handing it back would replace
    // the scan that finds the real rollout with a path nothing can read.
    const sessionsDir = await setup();
    const real = path.join(sessionsDir, `rollout-2026-01-01T00-00-00-${SESSION}.jsonl`);
    await fsp.writeFile(real, "{}\n");
    expect(await pickRolloutPath({ rolloutPath: sessionsDir }, SESSION, sessionsDir)).toBe(real);
  });
});

describe("lookupCodexEntry: the query-error that used to look like a miss", () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  const roots: string[] = [];
  const store = async (): Promise<string> => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "at-codex-lookup-"));
    roots.push(dir);
    await fsp.mkdir(path.join(dir, "sessions"), { recursive: true });
    return dir;
  };

  afterEach(async () => {
    for (const dir of roots.splice(0)) {
      await fsp.chmod(path.join(dir, "sessions"), 0o755).catch(() => {});
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("says absent when the thread query ran and indexed nothing", async () => {
    const fn = stubSqlite({ status: "ok", rows: [] });
    expect(await lookupCodexEntry(ID, { codexDir: await store(), readSqliteFn: fn })).toEqual({ status: "absent" });
  });

  it("says unknown for a query error — the case this whole change exists for", async () => {
    const fn = stubSqlite({ status: "query-error", rows: [], error: "database is locked" });
    expect(await lookupCodexEntry(ID, { codexDir: await store(), readSqliteFn: fn })).toEqual({ status: "unknown" });
  });

  it("says unknown for a store it could not reach", async () => {
    const fn = stubSqlite({ status: "db-unreachable", rows: [] });
    expect(await lookupCodexEntry(ID, { codexDir: await store(), readSqliteFn: fn })).toEqual({ status: "unknown" });
  });

  it("says unknown for a row the store holds and the reader cannot map", async () => {
    const fn = stubSqlite({ status: "ok", rows: [{ nothing: "usable" }] });
    expect(await lookupCodexEntry(ID, { codexDir: await store(), readSqliteFn: fn })).toEqual({ status: "unknown" });
  });

  it("says absent when no database sends it to an exhaustive rollout scan that finds nothing", async () => {
    const fn = stubSqlite({ status: "no-db", rows: [] });
    expect(await lookupCodexEntry(ID, { codexDir: await store(), readSqliteFn: fn })).toEqual({ status: "absent" });
  });

  it.skipIf(process.getuid?.() === 0)("says unknown when the rollout walk could not enter a directory", async () => {
    const dir = await store();
    await fsp.mkdir(path.join(dir, "sessions", "2026"), { recursive: true });
    await fsp.chmod(path.join(dir, "sessions", "2026"), 0o000);
    const fn = stubSqlite({ status: "no-db", rows: [] });
    expect(await lookupCodexEntry(ID, { codexDir: dir, readSqliteFn: fn })).toEqual({ status: "unknown" });
  });

  it("keeps readCodexEntry nullable for callers that cannot act on the difference", async () => {
    const fn = stubSqlite({ status: "query-error", rows: [], error: "boom" });
    expect(await readCodexEntry(ID, { codexDir: await store(), readSqliteFn: fn })).toBeNull();
  });
});
