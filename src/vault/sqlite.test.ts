// src/vault/sqlite.test.ts — Unit tests for the WAL-safe sqlite3 helper.

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetSqliteProbeCache,
  presenceFromAccessError,
  readPrimarySqlite,
  readSqlite,
  type SqliteDeps,
  withPrimarySqliteSnapshot,
  withSqliteSnapshot,
  writeSqlite,
} from "./sqlite";

function makeDeps(overrides: Partial<SqliteDeps> = {}): SqliteDeps {
  return {
    exec: vi.fn(async () => ({ stdout: "[]", stderr: "" })),
    exists: vi.fn(async () => true),
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
  });

  it("returns no-sqlite3 when BOTH the CLI and node:sqlite are absent", async () => {
    const deps = makeDeps({ exec: cliAbsent(), hasNodeSqlite: vi.fn(async () => false) });
    const result = await readSqlite("/x/state.sqlite", "SELECT 1", deps);
    expect(result.status).toBe("no-sqlite3");
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

describe("readSqlite: a store that cannot be opened is not an empty store", () => {
  it("reports db-unreachable when a WAL store's directory denies the open", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "at-vault-ro-"));
    const dir = path.join(root, "store");
    await fsp.mkdir(dir);
    const dbFile = path.join(dir, "live.sqlite");
    const seed = new DatabaseSync(dbFile);
    seed.exec("PRAGMA journal_mode=WAL");
    seed.exec("CREATE TABLE t(id TEXT)");
    seed.exec("INSERT INTO t VALUES ('still-here')");
    const second = new DatabaseSync(dbFile);
    second.exec("INSERT INTO t VALUES ('wal-row')");
    seed.close();
    second.close();
    // A WAL sidecar with no -shm: opening it needs to create the index, which a
    // read-only directory refuses. The file is readable, so this is emphatically
    // not "the store is missing".
    await fsp.rm(`${dbFile}-shm`, { force: true });
    await fsp.chmod(dir, 0o555);

    const deps: SqliteDeps = {
      exec: vi.fn(async () => {
        throw new Error("command not found: sqlite3");
      }),
      exists: async (p) => {
        try {
          await fsp.access(p);
          return true;
        } catch {
          return false;
        }
      },
      mkdtemp: () => fsp.mkdtemp(path.join(os.tmpdir(), "at-vault-")),
      rmrf: (d) => fsp.rm(d, { recursive: true, force: true }),
      hasNodeSqlite: async () => true,
    };
    try {
      const result = await readSqlite(dbFile, "SELECT id FROM t", deps);
      expect(result.status).toBe("db-unreachable");
      expect(result.rows).toEqual([]);
    } finally {
      await fsp.chmod(dir, 0o755);
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("reports query-error when the snapshot fails for any other reason", async () => {
    const deps = makeDeps({
      hasNodeSqlite: vi.fn(async () => true),
      snapshot: vi.fn(async () => {
        throw new Error("no space left on device");
      }),
    });
    const result = await readSqlite("/x/state.sqlite", "SELECT 1", deps);
    expect(result.status).toBe("query-error");
    expect(result.rows).toEqual([]);
  });
});

describe("readSqlite: a destination failure is not the store's fault (round-1 W1)", () => {
  it("says query-error, not db-unreachable, when the source reads fine but the destination cannot be written", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "at-vault-dest-"));
    const dbFile = path.join(dir, "live.sqlite");
    const seed = new DatabaseSync(dbFile);
    seed.exec("CREATE TABLE t(id TEXT)");
    seed.exec("INSERT INTO t VALUES ('readable')");
    seed.close();
    const destDir = path.join(dir, "temp");
    await fsp.mkdir(destDir);
    await fsp.chmod(destDir, 0o555); // the snapshot has nowhere to land

    const deps: SqliteDeps = {
      exec: vi.fn(async () => {
        throw new Error("command not found: sqlite3");
      }),
      exists: async (p) => {
        try {
          await fsp.access(p);
          return true;
        } catch {
          return false;
        }
      },
      mkdtemp: async () => destDir,
      rmrf: async () => {},
      hasNodeSqlite: async () => true,
    };
    try {
      const result = await readSqlite(dbFile, "SELECT id FROM t", deps);
      // The user's store is perfectly readable — blaming it would be a lie, and
      // the kind that makes a live session look unreachable.
      expect(result.status).toBe("query-error");
    } finally {
      await fsp.chmod(destDir, 0o755);
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the SHIPPED snapshot, exercised as shipped (round-2 B1/W3)", () => {
  /** Real deps with NO `snapshot` override — the production implementation runs. */
  function shippedDeps(overrides: Partial<SqliteDeps> = {}): SqliteDeps {
    return {
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
      mkdtemp: () => fsp.mkdtemp(path.join(os.tmpdir(), "at-vault-")),
      rmrf: (d) => fsp.rm(d, { recursive: true, force: true }),
      ...overrides,
    };
  }

  /** A store large enough that a snapshot of it is measurably in flight, with one
   *  row committed to the WAL by a connection left open. */
  async function bigLiveStore(rows: number): Promise<{
    dbFile: string;
    dir: string;
    live: InstanceType<typeof DatabaseSync>;
  }> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "at-vault-race-"));
    const dbFile = path.join(dir, "live.sqlite");
    const seed = new DatabaseSync(dbFile);
    seed.exec("PRAGMA journal_mode=WAL");
    seed.exec("CREATE TABLE t(id INTEGER, pad TEXT)");
    seed.exec("BEGIN");
    const ins = seed.prepare("INSERT INTO t VALUES (?, ?)");
    for (let i = 0; i < rows; i++) {
      ins.run(i, "x".repeat(400));
    }
    seed.exec("COMMIT");
    seed.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    seed.close();
    const live = new DatabaseSync(dbFile);
    live.exec("PRAGMA journal_mode=WAL");
    live.prepare("INSERT INTO t VALUES (?, ?)").run(999999, "wal-resident");
    return { dbFile, dir, live };
  }

  /** Timestamps proving the churn happened WHILE a snapshot was in flight, which
   *  is the claim — a witness that only proves the churn finished would also be
   *  satisfied by a serialized implementation that never overlapped at all. */
  interface Overlap {
    started?: number;
    churned?: number;
    settled?: number;
  }

  function expectOverlap(o: Overlap): void {
    expect(o.started).toBeDefined();
    expect(o.churned).toBeDefined();
    expect(o.settled).toBeDefined();
    expect(o.started as number).toBeLessThanOrEqual(o.churned as number);
    expect(o.churned as number).toBeLessThanOrEqual(o.settled as number);
  }

  /** Churn fired from INSIDE a real backup step: the snapshot has provably begun
   *  and provably not settled. DatabaseSync is synchronous, so this completes
   *  before the backup takes its next step. */
  function churningAt(live: InstanceType<typeof DatabaseSync>, step: number, o: Overlap) {
    return (n: number) => {
      o.started ??= Date.now();
      if (n === step && o.churned === undefined) {
        live.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        live.exec("VACUUM");
        o.churned = Date.now();
      }
    };
  }

  it("keeps every row when a checkpoint and vacuum race the in-process snapshot", async () => {
    const { dbFile, dir, live } = await bigLiveStore(20000);
    const overlap: Overlap = {};
    const deps = shippedDeps({
      hasNodeSqlite: async () => true,
      onSnapshotProgress: churningAt(live, 3, overlap),
    });
    try {
      const result = await readSqlite(dbFile, "SELECT count(*) AS c FROM t", deps);
      overlap.settled = Date.now();
      expectOverlap(overlap);
      if (result.status === "ok") {
        expect(result.rows).toEqual([{ c: 20001 }]);
      } else {
        expect(["query-error", "db-unreachable"]).toContain(result.status);
      }
    } finally {
      live.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("does the same through withSqliteSnapshot", async () => {
    const { dbFile, dir, live } = await bigLiveStore(20000);
    const overlap: Overlap = {};
    const deps = shippedDeps({
      hasNodeSqlite: async () => true,
      onSnapshotProgress: churningAt(live, 3, overlap),
    });
    try {
      const result = await withSqliteSnapshot(dbFile, (s) => s.query("SELECT count(*) AS c FROM t"), deps);
      overlap.settled = Date.now();
      expectOverlap(overlap);
      if (result.status === "ok") {
        expect(result.value.rows).toEqual([{ c: 20001 }]);
      } else {
        expect(["query-error", "db-unreachable"]).toContain(result.status);
      }
    } finally {
      live.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("does the same through the real sqlite3 CLI", async () => {
    const { dbFile, dir, live } = await bigLiveStore(20000);
    const overlap: Overlap = {};
    // The CLI cannot be stepped, so the barrier is the process lifetime: churn
    // after VACUUM INTO has been spawned and before its promise settles.
    const deps = shippedDeps({
      hasNodeSqlite: async () => false,
      exec: async (file, args, options) => {
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const running = promisify(execFile)(file, args, { timeout: options.timeout });
        if (String(args[2] ?? "").startsWith("VACUUM INTO")) {
          overlap.started = Date.now();
          live.exec("PRAGMA wal_checkpoint(TRUNCATE)");
          live.exec("VACUUM");
          overlap.churned = Date.now();
        }
        const { stdout, stderr } = await running;
        return { stdout: String(stdout), stderr: String(stderr) };
      },
    });
    try {
      const result = await readSqlite(dbFile, "SELECT count(*) AS c FROM t", deps);
      overlap.settled = Date.now();
      expectOverlap(overlap);
      if (result.status === "ok") {
        expect(result.rows).toEqual([{ c: 20001 }]);
      } else {
        expect(["query-error", "db-unreachable"]).toContain(result.status);
      }
    } finally {
      live.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("aborts on the production deadline, inside the production progress callback", async () => {
    // Enough pages that the backup takes more than one step, and a budget already
    // spent — so the deadline must be checked by the shipped callback, not by us.
    const { dbFile, dir, live } = await bigLiveStore(20000);
    const deps = shippedDeps({ hasNodeSqlite: async () => true, snapshotTimeoutMs: -1 });
    try {
      const result = await readSqlite(dbFile, "SELECT count(*) AS c FROM t", deps);
      expect(result.status).toBe("query-error");
      expect(result.error).toMatch(/exceeded -1ms/);
      expect(result.rows).toEqual([]);
    } finally {
      live.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the CLI blames the right file too (round-2 W1)", () => {
  it("says query-error when the source reads fine but VACUUM INTO has nowhere to write", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "at-vault-clidest-"));
    const dbFile = path.join(dir, "live.sqlite");
    const seed = new DatabaseSync(dbFile);
    seed.exec("CREATE TABLE t(id TEXT)");
    seed.exec("INSERT INTO t VALUES ('readable')");
    seed.close();
    const destDir = path.join(dir, "temp");
    await fsp.mkdir(destDir);
    await fsp.chmod(destDir, 0o555);

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
      mkdtemp: async () => destDir,
      rmrf: async () => {},
      hasNodeSqlite: async () => false,
    };
    try {
      const result = await readSqlite(dbFile, "SELECT id FROM t", deps);
      expect(result.status).toBe("query-error");
    } finally {
      await fsp.chmod(destDir, 0o755);
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("readSqlite: a snapshot is reused only while the store is unchanged", () => {
  /** `mkdtemp` runs exactly once per snapshot production, so counting it counts
   *  productions without substituting a fake snapshot for the real engine's. */
  function countingDeps(counter: { n: number }, overrides: Partial<SqliteDeps> = {}): SqliteDeps {
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
      mkdtemp: async () => {
        counter.n += 1;
        return fsp.mkdtemp(path.join(os.tmpdir(), "at-vault-"));
      },
      rmrf: (d) => fsp.rm(d, { recursive: true, force: true }),
      hasNodeSqlite: async () => true,
      ...overrides,
    };
  }

  async function walStore(): Promise<{ dbFile: string; dir: string; live: InstanceType<typeof DatabaseSync> }> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "at-vault-reuse-"));
    const dbFile = path.join(dir, "live.sqlite");
    const seed = new DatabaseSync(dbFile);
    seed.exec("PRAGMA journal_mode=WAL");
    seed.exec("CREATE TABLE t(id TEXT)");
    seed.exec("INSERT INTO t VALUES ('base-row')");
    seed.close();
    const live = new DatabaseSync(dbFile);
    live.exec("PRAGMA journal_mode=WAL");
    return { dbFile, dir, live };
  }

  it("does not re-snapshot a store nobody has written to", async () => {
    const { dbFile, dir, live } = await walStore();
    const counter = { n: 0 };
    const deps = countingDeps(counter);
    try {
      const first = await readPrimarySqlite(dbFile, "SELECT id FROM t", deps);
      const second = await readPrimarySqlite(dbFile, "SELECT id FROM t", deps);

      expect(first.status).toBe("ok");
      expect(second.status).toBe("ok");
      expect(second.rows).toEqual([{ id: "base-row" }]);
      expect(counter.n).toBe(1);
    } finally {
      live.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps nothing for a caller that did not ask to retain", async () => {
    // Cursor CLI's per-chat stores go through the plain entry point, and there are as
    // many of them as there are chats. Reuse is what retention buys, so not asking for
    // it costs a second snapshot — and leaves the pool holding no key for that store.
    const { dbFile, dir, live } = await walStore();
    const counter = { n: 0 };
    const deps = countingDeps(counter);
    try {
      const first = await readSqlite(dbFile, "SELECT id FROM t", deps);
      const second = await readSqlite(dbFile, "SELECT id FROM t", deps);

      expect(first.status).toBe("ok");
      expect(second.rows).toEqual([{ id: "base-row" }]);
      expect(counter.n).toBe(2);
    } finally {
      live.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("never answers from the earlier snapshot once a session has been written", async () => {
    const { dbFile, dir, live } = await walStore();
    const counter = { n: 0 };
    const deps = countingDeps(counter);
    try {
      await readPrimarySqlite(dbFile, "SELECT id FROM t", deps);
      live.exec("INSERT INTO t VALUES ('wal-row')"); // committed, WAL-resident
      const second = await readPrimarySqlite(dbFile, "SELECT id FROM t ORDER BY id", deps);

      expect(second.status).toBe("ok");
      expect(second.rows).toEqual([{ id: "base-row" }, { id: "wal-row" }]);
      expect(counter.n).toBe(2);
    } finally {
      live.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("shares one snapshot between the two entry points", async () => {
    const { dbFile, dir, live } = await walStore();
    const counter = { n: 0 };
    const deps = countingDeps(counter);
    try {
      await readPrimarySqlite(dbFile, "SELECT id FROM t", deps);
      const viaSnapshot = await withPrimarySqliteSnapshot(dbFile, async (s) => s.query("SELECT id FROM t"), deps);

      expect(viaSnapshot.status).toBe("ok");
      expect(viaSnapshot.status === "ok" ? viaSnapshot.value.rows : undefined).toEqual([{ id: "base-row" }]);
      expect(counter.n).toBe(1);
    } finally {
      live.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("reports a failure rather than serving the retained snapshot when the store goes unreadable", async () => {
    const { dbFile, dir, live } = await walStore();
    const counter = { n: 0 };
    const deps = countingDeps(counter);
    try {
      const first = await readPrimarySqlite(dbFile, "SELECT id FROM t", deps);
      expect(first.status).toBe("ok");

      await fsp.chmod(dir, 0o000);
      const second = await readPrimarySqlite(dbFile, "SELECT id FROM t", deps);

      expect(second.status).not.toBe("ok");
      expect(second.rows).toEqual([]);
    } finally {
      await fsp.chmod(dir, 0o700).catch(() => {});
      live.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  async function walStorePair() {
    return { a: await walStore(), b: await walStore() };
  }

  it("agrees between a reused snapshot and a genuinely fresh store", async (ctx) => {
    // Two DISTINCT stores. Round-1 W2: re-reading the same path after warming the
    // pool is not a cold read — `snapshotPool` reuses a matching retained entry
    // whether or not this borrower asked to retain, so the variable named `cold`
    // was served from the very cache under test.
    const { a, b } = await walStorePair();
    try {
      const warm = await withPrimarySqliteSnapshot(a.dbFile, async (s) => s.query("SELECT id FROM t"));
      expect(warm.status).toBe("ok");

      // The sidecar alone — the database itself stays readable, which is what makes
      // a stat-based or base-file-only proof pass while SQLite cannot open the store.
      await fsp.chmod(`${a.dbFile}-wal`, 0o000);
      await fsp.chmod(`${b.dbFile}-wal`, 0o000);
      let denied = true;
      try {
        const probe = await fsp.open(`${a.dbFile}-wal`, "r");
        await probe.close();
        denied = false;
      } catch {
        denied = true;
      }
      if (!denied) {
        // Root, or a filesystem that ignores mode bits. A warning plus an early
        // return would be recorded as a PASS, which is the vacuous green this case
        // exists to avoid (round-1 W2).
        ctx.skip();
      }

      const reused = await withPrimarySqliteSnapshot(a.dbFile, async (s) => s.query("SELECT id FROM t"));
      const fresh = await withPrimarySqliteSnapshot(b.dbFile, async (s) => s.query("SELECT id FROM t"));

      // The discriminated status itself, not merely "not ok": both could regress
      // to `query-error` together and stay equal (round-2 W2).
      expect(reused.status).toBe("db-unreachable");
      expect(fresh.status).toBe("db-unreachable");
    } finally {
      for (const store of [a, b]) {
        await fsp.chmod(`${store.dbFile}-wal`, 0o600).catch(() => {});
        store.live.close();
        await fsp.rm(store.dir, { recursive: true, force: true });
      }
    }
  });
});

describe("the write path tells absence from unreadability", () => {
  it("reports a write failure, not absence, for an existing unreadable store", async (ctx) => {
    // `defaultWriteDeps` is `{ exists: defaultDeps.exists }`, so it aliases the
    // read side's presence predicate. Strengthening that predicate to prove
    // readability made an existing but unreadable store answer `no-db` —
    // documented as ABSENT — instead of reaching SQLite (cycle-1 W1). The proof
    // moved to the generation read precisely so this stays true.
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "at-write-perm-"));
    const dbFile = path.join(dir, "store.db");
    try {
      const live = new DatabaseSync(dbFile);
      live.exec("CREATE TABLE t (id TEXT)");
      live.exec("INSERT INTO t (id) VALUES ('base-row')");
      live.close();

      await fsp.chmod(dbFile, 0o000);
      let denied = true;
      try {
        const probe = await fsp.open(dbFile, "r");
        await probe.close();
        denied = false;
      } catch {
        denied = true;
      }
      if (!denied) {
        ctx.skip();
      }

      const result = await writeSqlite(dbFile, "UPDATE t SET id = ? WHERE id = ?", ["next", "base-row"]);

      expect(result.status).not.toBe("no-db");
      expect(result.status).toBe("write-error");
    } finally {
      await fsp.chmod(dbFile, 0o600).catch(() => {});
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("both entry points map a snapshot failure the same way", () => {
  class OpenRefusal extends Error {
    readonly snapshotOpenFailure = true;
  }

  function failingDeps(err: Error): SqliteDeps {
    return makeDeps({
      hasNodeSqlite: vi.fn(async () => true),
      runNodeQuery: vi.fn(async () => ({ rows: [], status: "ok" as const })),
      snapshot: vi.fn(async () => {
        throw err;
      }),
    });
  }

  it("reports an open refusal as db-unreachable at both entry points", async () => {
    const read = await readSqlite("/x/store.db", "SELECT 1", failingDeps(new OpenRefusal("denied")));
    const scoped = await withSqliteSnapshot(
      "/x/store.db",
      async (s) => s.query("SELECT 1"),
      failingDeps(new OpenRefusal("denied")),
    );

    expect(read.status).toBe("db-unreachable");
    expect(read.rows).toEqual([]);
    expect(scoped.status).toBe("db-unreachable");
  });

  it("reports any other snapshot failure as query-error at both entry points", async () => {
    const read = await readSqlite("/x/store.db", "SELECT 1", failingDeps(new Error("disk full")));
    const scoped = await withSqliteSnapshot(
      "/x/store.db",
      async (s) => s.query("SELECT 1"),
      failingDeps(new Error("disk full")),
    );

    expect(read.status).toBe("query-error");
    expect(read.rows).toEqual([]);
    expect(scoped.status).toBe("query-error");
  });
});
