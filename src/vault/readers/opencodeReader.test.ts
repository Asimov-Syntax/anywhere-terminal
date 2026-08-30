// src/vault/readers/opencodeReader.test.ts — Unit tests for the OpenCode reader.

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SqliteResult } from "../sqlite";
import { readOpenCodeEntry, readOpenCodeSessions } from "./opencodeReader";

function stubSqlite(result: SqliteResult) {
  return vi.fn(async (_dbPath: string, _sql: string) => result);
}

const ROWS: Record<string, unknown>[] = [
  {
    id: "s1",
    title: "build a thing",
    directory: "/Users/me/oc",
    time_updated: 5000,
    last_assistant: JSON.stringify({ providerID: "anthropic", modelID: "claude-opus-4-7", agent: "build" }),
  },
  {
    id: "s2",
    title: "another",
    directory: "/Users/me/oc2",
    time_updated: 4000,
    last_assistant: "{ this is not valid json",
  },
];

describe("readOpenCodeSessions", () => {
  it("queries the session table joined to the latest assistant message, recency-ordered", async () => {
    const fn = stubSqlite({ status: "ok", rows: ROWS });
    await readOpenCodeSessions({ dataDir: "/x/oc", readSqliteFn: fn });
    const [dbPath, sql] = fn.mock.calls[0];
    expect(dbPath).toBe("/x/oc/opencode.db");
    expect(sql).toContain("FROM session s");
    expect(sql).toContain('data LIKE \'%"role":"assistant"%\'');
    expect(sql).toContain("ORDER BY s.time_updated DESC");
    // Subagent / workflow children (parent_id set) are folded into their parent's
    // preview, not listed as standalone sessions.
    expect(sql).toContain("parent_id");
  });

  it("maps id/title/cwd/modified and derives provider/model + agent", async () => {
    const fn = stubSqlite({ status: "ok", rows: ROWS });
    const { entries } = await readOpenCodeSessions({ dataDir: "/x/oc", readSqliteFn: fn });
    const s1 = entries[0];
    expect(s1.id).toBe("opencode:s1");
    expect(s1.sessionId).toBe("s1");
    expect(s1.title).toBe("build a thing");
    expect(s1.cwd).toBe("/Users/me/oc");
    expect(s1.modified).toBe(5000);
    expect(s1.flags.model).toBe("anthropic/claude-opus-4-7");
    expect(s1.flags.agent).toBe("build");
  });

  it("still lists a session whose assistant JSON is malformed (model/agent undefined)", async () => {
    const fn = stubSqlite({ status: "ok", rows: ROWS });
    const { entries, unreadable } = await readOpenCodeSessions({ dataDir: "/x/oc", readSqliteFn: fn });
    expect(entries).toHaveLength(2);
    expect(unreadable).toBe(0);
    expect(entries[1].flags.model).toBeUndefined();
    expect(entries[1].flags.agent).toBeUndefined();
  });

  it("falls back to the first user message when the title is OpenCode's 'New session' placeholder (#5)", async () => {
    const rows = [
      {
        id: "s3",
        title: "New session - 2026-05-18T14:16:07.713Z",
        directory: "/x",
        time_updated: 9000,
        last_assistant: null,
        first_user_part: JSON.stringify({ type: "text", text: "help me refactor the parser" }),
      },
    ];
    const fn = stubSqlite({ status: "ok", rows });
    const { entries } = await readOpenCodeSessions({ dataDir: "/x/oc", readSqliteFn: fn });
    expect(entries[0].title).toBe("help me refactor the parser");
  });

  it("keeps a real title even when a first user message is available (#5)", async () => {
    const rows = [
      {
        id: "s4",
        title: "Refactor the JSONL parser",
        directory: "/x",
        time_updated: 9000,
        last_assistant: null,
        first_user_part: JSON.stringify({ type: "text", text: "the raw first prompt" }),
      },
    ];
    const fn = stubSqlite({ status: "ok", rows });
    const { entries } = await readOpenCodeSessions({ dataDir: "/x/oc", readSqliteFn: fn });
    expect(entries[0].title).toBe("Refactor the JSONL parser");
  });

  it("skips and counts rows without an id", async () => {
    const fn = stubSqlite({ status: "ok", rows: [{ title: "no id" }, ROWS[0]] });
    const { entries, unreadable } = await readOpenCodeSessions({ dataDir: "/x/oc", readSqliteFn: fn });
    expect(entries).toHaveLength(1);
    expect(unreadable).toBe(1);
  });

  it("returns zero entries (no fallback) when the DB is absent", async () => {
    const fn = stubSqlite({ status: "no-db", rows: [] });
    const { entries, unreadable } = await readOpenCodeSessions({ dataDir: "/x/oc", readSqliteFn: fn });
    expect(entries).toEqual([]);
    expect(unreadable).toBe(0);
  });

  it("counts a store it could not reach as unreadable, not as an empty store", async () => {
    // `no-db` above is a conclusive empty store; this is the case that used to
    // masquerade as one (D6).
    const fn = stubSqlite({ status: "db-unreachable", rows: [] });
    const { entries, unreadable } = await readOpenCodeSessions({ dataDir: "/x/oc", readSqliteFn: fn });
    expect(entries).toEqual([]);
    expect(unreadable).toBe(1);
  });

  it("counts a query-error as one unreadable", async () => {
    const fn = stubSqlite({ status: "query-error", rows: [], error: "boom" });
    const { entries, unreadable } = await readOpenCodeSessions({ dataDir: "/x/oc", readSqliteFn: fn });
    expect(entries).toEqual([]);
    expect(unreadable).toBe(1);
  });
});

describe("readOpenCodeEntry: single-entry resolve", () => {
  it("resolves one session by id (point lookup, no parent_id list filter)", async () => {
    const fn = stubSqlite({ status: "ok", rows: [ROWS[0]] });
    const entry = await readOpenCodeEntry("s1", { dataDir: "/x/oc", readSqliteFn: fn });
    const [dbPath, sql] = fn.mock.calls[0];
    expect(dbPath).toBe("/x/oc/opencode.db");
    expect(sql).toContain("WHERE s.id = 's1'");
    expect(sql).not.toContain("parent_id"); // children are resumable too
    expect(entry?.id).toBe("opencode:s1");
    expect(entry?.cwd).toBe("/Users/me/oc");
  });

  it("returns null for an unsafe id without touching the db", async () => {
    const fn = stubSqlite({ status: "ok", rows: [] });
    expect(await readOpenCodeEntry("../etc/passwd", { dataDir: "/x/oc", readSqliteFn: fn })).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns null when no row matches", async () => {
    const fn = stubSqlite({ status: "ok", rows: [] });
    expect(await readOpenCodeEntry("ghost", { dataDir: "/x/oc", readSqliteFn: fn })).toBeNull();
  });
});

describe("readOpenCodeSessions: data-dir resolution", () => {
  const original = process.env.XDG_DATA_HOME;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = original;
    }
  });

  it("defaults to <home>/.local/share/opencode/opencode.db (all OSes, via xdg-basedir)", async () => {
    delete process.env.XDG_DATA_HOME;
    const fn = stubSqlite({ status: "ok", rows: [] });
    await readOpenCodeSessions({ home: "/home/u", readSqliteFn: fn });
    expect(fn.mock.calls[0][0]).toBe(path.join("/home/u", ".local", "share", "opencode", "opencode.db"));
  });

  it("honors $XDG_DATA_HOME", async () => {
    process.env.XDG_DATA_HOME = "/custom/xdg";
    const fn = stubSqlite({ status: "ok", rows: [] });
    await readOpenCodeSessions({ home: "/home/u", readSqliteFn: fn });
    expect(fn.mock.calls[0][0]).toBe(path.join("/custom/xdg", "opencode", "opencode.db"));
  });
});

describe("readOpenCodeSessions: incremental store stamp", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) {
      await fsp.rm(d, { recursive: true, force: true });
    }
  });

  async function makeDb(): Promise<string> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "vault-oc-inc-"));
    dirs.push(dir);
    await fsp.writeFile(path.join(dir, "opencode.db"), "dummy-db-bytes");
    return dir;
  }

  it("reuses cached entries without querying when the store is unchanged", async () => {
    const dir = await makeDb();
    const fn = stubSqlite({ status: "ok", rows: ROWS });
    const first = await readOpenCodeSessions({ dataDir: dir, readSqliteFn: fn }, undefined);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(first.cache.kind).toBe("store");
    const firstCount = first.entries.length;

    const second = await readOpenCodeSessions({ dataDir: dir, readSqliteFn: fn }, first.cache);
    expect(fn).toHaveBeenCalledTimes(1); // unchanged store → no re-query
    expect(second.entries).toHaveLength(firstCount);
  });

  it("re-queries when the db mtime changes", async () => {
    const dir = await makeDb();
    const fn = stubSqlite({ status: "ok", rows: ROWS });
    const first = await readOpenCodeSessions({ dataDir: dir, readSqliteFn: fn }, undefined);
    const future = new Date(Date.now() + 60_000);
    await fsp.utimes(path.join(dir, "opencode.db"), future, future);
    await readOpenCodeSessions({ dataDir: dir, readSqliteFn: fn }, first.cache);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
