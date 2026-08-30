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

  it("snapshots the db + its -wal/-shm sidecars before querying (never reads the live store in place; D13)", async () => {
    const deps = makeDeps({
      exec: execWith(async () => ({ stdout: "[]", stderr: "" })),
      exists: vi.fn(async () => true), // db + both sidecars present
    });
    await readSqlite("/x/state.sqlite", "SELECT 1", deps);
    const copyCalls = (deps.copy as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(copyCalls).toContain("/x/state.sqlite");
    expect(copyCalls).toContain("/x/state.sqlite-wal");
    expect(copyCalls).toContain("/x/state.sqlite-shm");
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
    expect(deps.copy).toHaveBeenCalledWith("/x/state.sqlite", "/tmp/at-vault-xyz/db.sqlite");
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

describe("readSqlite: a sidecar that could not be read is not a smaller database (round-3 B1)", () => {
  /** Presence that answers per path, so the db and its WAL can differ. */
  function accessing(bySuffix: Record<string, "present" | "absent" | "unreachable">) {
    return vi.fn(async (p: string) => {
      if (p.endsWith("-wal")) {
        return bySuffix["-wal"] ?? "present";
      }
      if (p.endsWith("-shm")) {
        return bySuffix["-shm"] ?? "present";
      }
      return "present" as const;
    });
  }

  it("reports query-error rather than an empty ok when the WAL is present but unreachable", async () => {
    const deps = makeDeps({
      exec: execWith(async () => ({ stdout: "[]", stderr: "" })),
      access: accessing({ "-wal": "unreachable" }),
    });
    const result = await readSqlite("/x/state.sqlite", "SELECT 1", deps);
    expect(result.status).toBe("query-error");
    expect(result.rows).toEqual([]);
  });

  it("reports query-error when the WAL exists but cannot be copied", async () => {
    const deps = makeDeps({
      exec: execWith(async () => ({ stdout: "[]", stderr: "" })),
      access: accessing({}),
      copy: vi.fn(async (src: string) => {
        if (src.endsWith("-wal")) {
          throw Object.assign(new Error("EIO"), { code: "EIO" });
        }
      }),
    });
    const result = await readSqlite("/x/state.sqlite", "SELECT 1", deps);
    expect(result.status).toBe("query-error");
  });

  it("still answers ok when a sidecar is PROVEN absent — a checkpointed db has no WAL", async () => {
    const deps = makeDeps({
      exec: execWith(async () => ({ stdout: "[]", stderr: "" })),
      access: accessing({ "-wal": "absent", "-shm": "absent" }),
    });
    const result = await readSqlite("/x/state.sqlite", "SELECT 1", deps);
    expect(result.status).toBe("ok");
    const copied = (deps.copy as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(copied).toEqual(["/x/state.sqlite"]);
  });

  it("applies the same rule inside withSqliteSnapshot", async () => {
    const deps = makeDeps({
      exec: execWith(async () => ({ stdout: "[]", stderr: "" })),
      access: accessing({ "-wal": "unreachable" }),
    });
    const result = await withSqliteSnapshot("/x/state.sqlite", async () => "queried", deps);
    expect(result.status).toBe("query-error");
  });

  it("does not run the query at all once a sidecar read has failed", async () => {
    const exec = execWith(async () => ({ stdout: "[]", stderr: "" }));
    const deps = makeDeps({ exec, access: accessing({ "-wal": "unreachable" }) });
    await readSqlite("/x/state.sqlite", "SELECT 1", deps);
    const queried = exec.mock.calls.filter((c) => !c[1].includes(":memory:"));
    expect(queried).toEqual([]);
  });
});
