// src/vault/sqlite.test.ts — Unit tests for the WAL-safe sqlite3 helper.

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetSqliteProbeCache,
  presenceFromAccessError,
  readSqlite,
  type SqliteDeps,
  withSqliteSnapshot,
} from "./sqlite";

function makeDeps(overrides: Partial<SqliteDeps> = {}): SqliteDeps {
  return {
    exec: vi.fn(async () => ({ stdout: "[]", stderr: "" })),
    exists: vi.fn(async () => true),
    copy: vi.fn(async () => {}),
    // The in-process engine snapshots rather than copies; stub deps that never
    // touch a real file need it stubbed too.
    snapshot: vi.fn(async () => {}),
    mkdtemp: vi.fn(async () => "/tmp/at-vault-xyz"),
    rmrf: vi.fn(async () => {}),
    // Default the harness to CLI-only so the existing tests exercise the CLI
    // path in isolation. The node:sqlite-fallback tests opt back in.
    hasNodeSqlite: vi.fn(async () => false),
    ...overrides,
  };
}

/** An exec that answers the capability probe ok, then defers to `query`. */
function execWith(query: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>) {
  return vi.fn(async (file: string, args: string[]) => {
    if (args.includes(":memory:")) {
      return { stdout: "", stderr: "" };
    }
    return query(file, args);
  });
}

beforeEach(() => {
  __resetSqliteProbeCache();
});

describe("readSqlite: capability probe", () => {
  it("returns no-sqlite3 when the probe throws (binary missing / no -json)", async () => {
    const deps = makeDeps({
      exec: vi.fn(async () => {
        throw new Error("command not found: sqlite3");
      }),
    });
    const result = await readSqlite("/x/state.sqlite", "SELECT 1", deps);
    expect(result.status).toBe("no-sqlite3");
    expect(result.rows).toEqual([]);
    // Never reached the db existence check / copy.
    expect(deps.copy).not.toHaveBeenCalled();
  });

  it("memoizes the probe across calls", async () => {
    let probeCount = 0;
    const deps = makeDeps({
      exec: vi.fn(async (_file: string, args: string[]) => {
        if (args.includes(":memory:")) {
          probeCount++;
        }
        return { stdout: "[]", stderr: "" };
      }),
    });
    await readSqlite("/x/a.sqlite", "SELECT 1", deps);
    await readSqlite("/x/b.sqlite", "SELECT 1", deps);
    expect(probeCount).toBe(1);
  });
});

describe("presenceFromAccessError: which failures prove absence", () => {
  const err = (code: string) => Object.assign(new Error(code), { code });

  it.each(["ENOENT", "ENOTDIR"])("%s proves the file is not there", (code) => {
    expect(presenceFromAccessError(err(code))).toBe("absent");
  });

  it.each(["EACCES", "EPERM", "EIO", "ELOOP", "EMFILE"])("%s proves nothing", (code) => {
    expect(presenceFromAccessError(err(code))).toBe("unreachable");
  });

  it("treats an error carrying no code as unreachable", () => {
    expect(presenceFromAccessError(new Error("mystery"))).toBe("unreachable");
    expect(presenceFromAccessError(undefined)).toBe("unreachable");
  });
});

describe("readSqlite: store presence", () => {
  it("returns no-db when the store file is absent", async () => {
    const deps = makeDeps({
      exec: execWith(async () => ({ stdout: "[]", stderr: "" })),
      exists: vi.fn(async (p: string) => p.includes(":memory:")), // db absent
    });
    const result = await readSqlite("/x/missing.sqlite", "SELECT 1", deps);
    expect(result.status).toBe("no-db");
    expect(deps.copy).not.toHaveBeenCalled();
  });

  it("says db-unreachable, NOT no-db, when the path could not be checked", async () => {
    // The difference a consumer acts on: `no-db` is proof the store is gone,
    // this is proof of nothing (D6).
    const deps = makeDeps({
      exec: execWith(async () => ({ stdout: "[]", stderr: "" })),
      access: vi.fn(async () => "unreachable" as const),
    });
    const result = await readSqlite("/locked/store.sqlite", "SELECT 1", deps);
    expect(result.status).toBe("db-unreachable");
    expect(deps.copy).not.toHaveBeenCalled();
  });

  it("still says no-db when the presence check confirms the file is gone", async () => {
    const deps = makeDeps({
      exec: execWith(async () => ({ stdout: "[]", stderr: "" })),
      access: vi.fn(async () => "absent" as const),
    });
    expect((await readSqlite("/x/gone.sqlite", "SELECT 1", deps)).status).toBe("no-db");
  });

  it("degrades to the boolean seam for a dep set that supplies no access check", async () => {
    // Every injected dep set in the repo predates `access`; none of them changes.
    const deps = makeDeps({
      exec: execWith(async () => ({ stdout: "[]", stderr: "" })),
      exists: vi.fn(async () => false),
    });
    expect((await readSqlite("/x/missing.sqlite", "SELECT 1", deps)).status).toBe("no-db");
  });

  it("treats a presence check that throws as unreachable rather than absent", async () => {
    const deps = makeDeps({
      exec: execWith(async () => ({ stdout: "[]", stderr: "" })),
      access: vi.fn(async () => {
        throw new Error("EIO");
      }),
    });
    expect((await readSqlite("/x/dead-mount.sqlite", "SELECT 1", deps)).status).toBe("db-unreachable");
  });
});

describe("readSqlite: query execution", () => {
  it("returns ok + parsed rows for a valid JSON array", async () => {
    const rows = [{ id: "a", title: "x" }];
    const deps = makeDeps({
      exec: execWith(async () => ({ stdout: JSON.stringify(rows), stderr: "" })),
    });
    const result = await readSqlite("/x/state.sqlite", "SELECT id,title FROM t", deps);
    expect(result.status).toBe("ok");
    expect(result.rows).toEqual(rows);
  });

  it("treats empty stdout as ok with zero rows", async () => {
    const deps = makeDeps({ exec: execWith(async () => ({ stdout: "", stderr: "" })) });
    const result = await readSqlite("/x/state.sqlite", "SELECT 1 WHERE 0", deps);
    expect(result.status).toBe("ok");
    expect(result.rows).toEqual([]);
  });

  it("snapshots the live store with a read-only VACUUM INTO, never reading it in place (D13)", async () => {
    const deps = makeDeps({ exec: execWith(async () => ({ stdout: "[]", stderr: "" })), snapshot: undefined });
    await readSqlite("/x/state.sqlite", "SELECT 1", deps);
    const calls = (deps.exec as ReturnType<typeof vi.fn>).mock.calls;
    const snapshotCall = calls.find((c) => String(c[1][2] ?? "").startsWith("VACUUM INTO"));
    expect(snapshotCall?.[1]).toEqual(["-readonly", "/x/state.sqlite", "VACUUM INTO '/tmp/at-vault-xyz/db.sqlite'"]);
    // No sidecar assembly: the engine produces the whole snapshot in one operation.
    expect(deps.copy).not.toHaveBeenCalled();
  });

  it("runs the query read-only over the temp snapshot, never the live db", async () => {
    const deps = makeDeps({ exec: execWith(async () => ({ stdout: "[]", stderr: "" })) });
    await readSqlite("/x/state.sqlite", "SELECT 1", deps);
    const queryCall = (deps.exec as ReturnType<typeof vi.fn>).mock.calls.find((c) => !c[1].includes(":memory:"));
    expect(queryCall?.[1]).toEqual(["-readonly", "-json", "/tmp/at-vault-xyz/db.sqlite", "SELECT 1"]);
  });

  it("returns query-error + message when stdout is not valid JSON (after retry)", async () => {
    const deps = makeDeps({ exec: execWith(async () => ({ stdout: "not json", stderr: "" })) });
    const result = await readSqlite("/x/state.sqlite", "SELECT 1", deps);
    expect(result.status).toBe("query-error");
    expect(result.error).toBeTruthy();
    expect(result.rows).toEqual([]);
  });

  it("returns query-error when stdout is a JSON object, not an array", async () => {
    const deps = makeDeps({ exec: execWith(async () => ({ stdout: '{"id":"a"}', stderr: "" })) });
    const result = await readSqlite("/x/state.sqlite", "SELECT 1", deps);
    expect(result.status).toBe("query-error");
  });

  it("retries the query once, succeeding on the second attempt", async () => {
    let calls = 0;
    const deps = makeDeps({
      exec: execWith(async () => {
        calls++;
        if (calls === 1) {
          throw new Error("database is locked");
        }
        return { stdout: '[{"id":"ok"}]', stderr: "" };
      }),
    });
    const result = await readSqlite("/x/state.sqlite", "SELECT 1", deps);
    expect(result.status).toBe("ok");
    expect(result.rows).toEqual([{ id: "ok" }]);
    expect(calls).toBe(2);
  });

  it("always removes the temp dir, even on query failure", async () => {
    const deps = makeDeps({
      exec: execWith(async () => {
        throw new Error("boom");
      }),
    });
    await readSqlite("/x/state.sqlite", "SELECT 1", deps);
    expect(deps.rmrf).toHaveBeenCalledWith("/tmp/at-vault-xyz");
  });
});

describe("readSqlite: engine selection (node:sqlite preferred)", () => {
  const cliAbsent = () =>
    vi.fn(async () => {
      throw new Error("command not found: sqlite3");
    });

  it("uses node:sqlite (querying the temp copy) when it is available", async () => {
    const runNodeQuery = vi.fn(async () => ({ rows: [{ id: "n1" }], status: "ok" as const }));
    const deps = makeDeps({
      exec: cliAbsent(),
      hasNodeSqlite: vi.fn(async () => true),
      runNodeQuery,
    });
    const result = await readSqlite("/x/state.sqlite", "SELECT id FROM t", deps);
    expect(result.status).toBe("ok");
    expect(result.rows).toEqual([{ id: "n1" }]);
    // node reads the temp snapshot, not the live db.
    expect(runNodeQuery).toHaveBeenCalledWith("/tmp/at-vault-xyz/db.sqlite", "SELECT id FROM t");
    // The snapshot is taken by the engine as one operation, not assembled from copies.
    expect(deps.snapshot).toHaveBeenCalledWith("/x/state.sqlite", "/tmp/at-vault-xyz/db.sqlite");
    expect(deps.copy).not.toHaveBeenCalled();
  });

  it("returns no-sqlite3 when BOTH the CLI and node:sqlite are absent", async () => {
    const deps = makeDeps({ exec: cliAbsent(), hasNodeSqlite: vi.fn(async () => false) });
    const result = await readSqlite("/x/state.sqlite", "SELECT 1", deps);
    expect(result.status).toBe("no-sqlite3");
    expect(deps.copy).not.toHaveBeenCalled();
  });

  it("prefers node:sqlite over the CLI when both are available (avoids the sqlite3 -json slowness; D14)", async () => {
    const runNodeQuery = vi.fn(async () => ({ rows: [{ id: "node" }], status: "ok" as const }));
    const cliExec = execWith(async () => ({ stdout: '[{"id":"cli"}]', stderr: "" }));
    const deps = makeDeps({
      exec: cliExec,
      hasNodeSqlite: vi.fn(async () => true),
      runNodeQuery,
    });
    const result = await readSqlite("/x/state.sqlite", "SELECT 1", deps);
    expect(result.rows).toEqual([{ id: "node" }]);
    expect(runNodeQuery).toHaveBeenCalledWith("/tmp/at-vault-xyz/db.sqlite", "SELECT 1");
    // The CLI is not consulted at all (not even its probe) when node:sqlite exists.
    expect(cliExec).not.toHaveBeenCalled();
  });

  it("propagates a node:sqlite query-error", async () => {
    const deps = makeDeps({
      exec: cliAbsent(),
      hasNodeSqlite: vi.fn(async () => true),
      runNodeQuery: vi.fn(async () => ({ rows: [], status: "query-error" as const, error: "boom" })),
    });
    const result = await readSqlite("/x/state.sqlite", "SELECT 1", deps);
    expect(result.status).toBe("query-error");
    expect(result.error).toBe("boom");
  });

  // End-to-end proof the REAL node:sqlite engine reads an on-disk DB when the
  // CLI is missing (the Windows scenario). Uses real fs deps + a real fixture.
  it("reads a real sqlite file via the built-in engine (no CLI, no stub)", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "at-vault-fixture-"));
    const dbFile = path.join(dir, "real.sqlite");
    const db = new DatabaseSync(dbFile);
    db.exec("CREATE TABLE t(id TEXT, n INTEGER)");
    db.exec("INSERT INTO t VALUES ('a', 1), ('b', 2)");
    db.close();

    const realDeps: SqliteDeps = {
      exec: cliAbsent(), // force the node:sqlite path
      exists: async (p) => {
        try {
          await fsp.access(p);
          return true;
        } catch {
          return false;
        }
      },
      copy: (src, dest) => fsp.copyFile(src, dest),
      mkdtemp: () => fsp.mkdtemp(path.join(os.tmpdir(), "at-vault-")),
      rmrf: (d) => fsp.rm(d, { recursive: true, force: true }),
      hasNodeSqlite: async () => true,
      // no runNodeQuery override → exercises the real defaultRunNodeQuery
    };

    try {
      const result = await readSqlite(dbFile, "SELECT id, n FROM t ORDER BY id", realDeps);
      expect(result.status).toBe("ok");
      expect(result.rows).toEqual([
        { id: "a", n: 1 },
        { id: "b", n: 2 },
      ]);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("readSqlite: the snapshot is taken by the engine, atomically", () => {
  /** A real WAL-mode store with a SECOND connection left open holding a committed
   *  row in the WAL — what a running agent's database actually looks like. */
  async function liveWalStore(): Promise<{ dbFile: string; dir: string; live: InstanceType<typeof DatabaseSync> }> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "at-vault-live-"));
    const dbFile = path.join(dir, "live.sqlite");
    const seed = new DatabaseSync(dbFile);
    seed.exec("PRAGMA journal_mode=WAL");
    seed.exec("CREATE TABLE t(id TEXT)");
    seed.exec("INSERT INTO t VALUES ('base-row')");
    seed.close();
    const live = new DatabaseSync(dbFile);
    live.exec("PRAGMA journal_mode=WAL");
    live.exec("INSERT INTO t VALUES ('wal-row')"); // committed, WAL-resident
    return { dbFile, dir, live };
  }

  function realDeps(overrides: Partial<SqliteDeps> = {}): SqliteDeps {
    return {
      exec: vi.fn(async () => {
        throw new Error("command not found: sqlite3"); // force the in-process engine
      }),
      exists: async (p) => {
        try {
          await fsp.access(p);
          return true;
        } catch {
          return false;
        }
      },
      copy: (src, dest) => fsp.copyFile(src, dest),
      mkdtemp: () => fsp.mkdtemp(path.join(os.tmpdir(), "at-vault-")),
      rmrf: (d) => fsp.rm(d, { recursive: true, force: true }),
      hasNodeSqlite: async () => true,
      ...overrides,
    };
  }

  it("includes a row that lives only in the WAL of a store held open by another process", async () => {
    const { dbFile, dir, live } = await liveWalStore();
    try {
      const result = await readSqlite(dbFile, "SELECT id FROM t ORDER BY id", realDeps());
      expect(result.status).toBe("ok");
      expect(result.rows).toEqual([{ id: "base-row" }, { id: "wal-row" }]);
    } finally {
      live.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("survives the checkpoint-and-vacuum interleaving that defeated both copy orders", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "at-vault-live-"));
    const dbFile = path.join(dir, "live.sqlite");
    const seed = new DatabaseSync(dbFile);
    seed.exec("PRAGMA journal_mode=WAL");
    seed.exec("CREATE TABLE t(id INTEGER)");
    for (let i = 0; i < 1000; i++) {
      seed.prepare("INSERT INTO t VALUES (?)").run(i);
    }
    seed.close();
    const live = new DatabaseSync(dbFile);
    live.exec("PRAGMA journal_mode=WAL");
    live.prepare("INSERT INTO t VALUES (?)").run(9999); // WAL-resident

    // The exact window review reproduced: the sidecar has been captured, and the
    // store then checkpoints AND vacuums — rewriting its pages — before the base
    // is captured. No ordering of independent file copies survives this; only a
    // snapshot the engine takes as one operation does.
    let moved = false;
    const deps = realDeps({
      copy: async (src, dest) => {
        await fsp.copyFile(src, dest);
        if (!moved && src.endsWith("-wal")) {
          moved = true;
          live.exec("PRAGMA wal_checkpoint(PASSIVE)");
          live.exec("VACUUM");
        }
      },
    });
    try {
      const result = await readSqlite(dbFile, "SELECT count(*) AS c FROM t", deps);
      // Either the snapshot is whole, or it failed loudly. What it must never be
      // is a successful read that silently lost a pre-existing row.
      if (result.status === "ok") {
        expect(result.rows).toEqual([{ c: 1001 }]);
      } else {
        expect(["query-error", "db-unreachable"]).toContain(result.status);
      }
    } finally {
      live.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("readSqlite: the CLI fallback snapshots atomically too", () => {
  it("reads a WAL-resident row from a live store through the real sqlite3 binary", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "at-vault-cli-"));
    const dbFile = path.join(dir, "live.sqlite");
    const seed = new DatabaseSync(dbFile);
    seed.exec("PRAGMA journal_mode=WAL");
    seed.exec("CREATE TABLE t(id TEXT)");
    seed.exec("INSERT INTO t VALUES ('base-row')");
    seed.close();
    const live = new DatabaseSync(dbFile);
    live.exec("PRAGMA journal_mode=WAL");
    live.exec("INSERT INTO t VALUES ('wal-row')"); // committed, WAL-resident

    // Real fs + real `sqlite3`, with node:sqlite forced off so the CLI path runs.
    const deps: SqliteDeps = {
      exec: async (file, args, options) => {
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const { stdout, stderr } = await promisify(execFile)(file, args, { timeout: options.timeout });
        return { stdout: String(stdout), stderr: String(stderr) };
      },
      exists: async (p) => {
        try {
          await fsp.access(p);
          return true;
        } catch {
          return false;
        }
      },
      copy: (src, dest) => fsp.copyFile(src, dest),
      mkdtemp: () => fsp.mkdtemp(path.join(os.tmpdir(), "at-vault-")),
      rmrf: (d) => fsp.rm(d, { recursive: true, force: true }),
      hasNodeSqlite: async () => false,
    };
    try {
      const result = await readSqlite(dbFile, "SELECT id FROM t ORDER BY id", deps);
      expect(result.status).toBe("ok");
      expect(result.rows).toEqual([{ id: "base-row" }, { id: "wal-row" }]);
    } finally {
      live.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("withSqliteSnapshot: the other entry point snapshots the same way", () => {
  it("takes one engine snapshot and serves every query from it", async () => {
    const runNodeQuery = vi.fn(async (_dbCopy: string, _sql: string) => ({
      rows: [{ id: "n1" }],
      status: "ok" as const,
    }));
    const deps = makeDeps({ hasNodeSqlite: vi.fn(async () => true), runNodeQuery });
    const result = await withSqliteSnapshot(
      "/x/state.sqlite",
      async (s) => {
        await s.query("SELECT 1");
        await s.query("SELECT 2");
        return "done";
      },
      deps,
    );
    expect(result.status).toBe("ok");
    expect(deps.snapshot).toHaveBeenCalledTimes(1); // one snapshot, two queries
    expect(deps.copy).not.toHaveBeenCalled();
    expect(runNodeQuery.mock.calls.map((c) => c[0])).toEqual([
      "/tmp/at-vault-xyz/db.sqlite",
      "/tmp/at-vault-xyz/db.sqlite",
    ]);
  });

  it("reports query-error when the snapshot cannot be taken", async () => {
    const deps = makeDeps({
      hasNodeSqlite: vi.fn(async () => true),
      snapshot: vi.fn(async () => {
        throw new Error("disk went away");
      }),
    });
    const result = await withSqliteSnapshot("/x/state.sqlite", async () => "unreachable", deps);
    expect(result.status).toBe("query-error");
  });
});
