// src/vault/storeStamp.test.ts — Stamp + equality helpers (cache-vault-load 2_2/2_3).

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStoreGeneration, sameStamps, stampStoreFiles, storeFilePaths } from "./storeStamp";

describe("sameStamps", () => {
  it("is true for identical stamp sets", () => {
    const a = { "/db": { mtimeMs: 1, size: 2 }, "/db-wal": { mtimeMs: 3, size: 4 } };
    const b = { "/db": { mtimeMs: 1, size: 2 }, "/db-wal": { mtimeMs: 3, size: 4 } };
    expect(sameStamps(a, b)).toBe(true);
  });

  it("is false when an mtime or size differs", () => {
    expect(sameStamps({ "/db": { mtimeMs: 1, size: 2 } }, { "/db": { mtimeMs: 9, size: 2 } })).toBe(false);
    expect(sameStamps({ "/db": { mtimeMs: 1, size: 2 } }, { "/db": { mtimeMs: 1, size: 9 } })).toBe(false);
  });

  it("is false when the path set differs (e.g. -wal appears/disappears)", () => {
    expect(
      sameStamps(
        { "/db": { mtimeMs: 1, size: 2 } },
        { "/db": { mtimeMs: 1, size: 2 }, "/db-wal": { mtimeMs: 1, size: 1 } },
      ),
    ).toBe(false);
  });

  it("treats two empty sets as equal (no DB present both times)", () => {
    expect(sameStamps({}, {})).toBe(true);
  });
});

describe("stampStoreFiles", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("stamps existing files and omits missing ones", async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "vault-stamp-"));
    const db = path.join(dir, "store.db");
    await fsp.writeFile(db, "hello");
    const stamps = await stampStoreFiles([db, `${db}-wal`]);
    expect(Object.keys(stamps)).toEqual([db]);
    expect(stamps[db].size).toBe(5);
    expect(stamps[db].mtimeMs).toBeGreaterThan(0);
  });

  it("omits a path it could not read at all, not only a missing one", async () => {
    // The list cache treats an unreadable path exactly as it treats an absent one:
    // a stamp mismatch, so the next refresh does the work. That is the opposite of
    // the reuse gate, which must refuse to act on an unproven generation — the two
    // now share one loop, so this pins which verdict this caller keeps.
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "vault-stamp-denied-"));
    const db = path.join(dir, "store.db");
    await fsp.writeFile(db, "hello");
    const locked = path.join(dir, "locked");
    await fsp.mkdir(locked);
    const hidden = path.join(locked, "store.db-wal");
    await fsp.writeFile(hidden, "wal");
    await fsp.chmod(locked, 0o000);

    try {
      const stamps = await stampStoreFiles([db, hidden]);
      expect(Object.keys(stamps)).toEqual([db]);
    } finally {
      await fsp.chmod(locked, 0o700);
    }
  });
});

describe("readStoreGeneration: a generation is proven, not sampled", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "at-gen-"));
    dbPath = path.join(dir, "store.db");
    await fsp.writeFile(dbPath, "base");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it("covers the database and its wal, and nothing else", () => {
    expect(storeFilePaths("/x/store.db")).toEqual(["/x/store.db", "/x/store.db-wal"]);
  });

  it("refuses a generation whose wal alone cannot be read", async () => {
    // The exact shape the round-1 probe used: the database stays readable, the
    // sidecar does not. `fs.stat` needs SEARCH permission on the directory, not
    // read permission on the file, so a stat-only generation stayed usable and the
    // pool went on reusing a retained snapshot while a cold read failed.
    await fsp.writeFile(`${dbPath}-wal`, "wal");
    const denied = `${dbPath}-wal`;

    const generation = await readStoreGeneration(dbPath, undefined, async (p) => {
      if (p === denied) {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      return { close: async () => {} };
    });

    expect(generation.usable).toBe(false);
  });

  it("still stamps a store it can read", async () => {
    await fsp.writeFile(`${dbPath}-wal`, "wal");
    const generation = await readStoreGeneration(dbPath);
    expect(generation.usable).toBe(true);
    expect(Object.keys(generation.stamps).sort()).toEqual([dbPath, `${dbPath}-wal`].sort());
  });

  it("releases every handle it opens, including on refusal", async () => {
    await fsp.writeFile(`${dbPath}-wal`, "wal");
    let open = 0;
    const counting = async (p: string) => {
      if (p === `${dbPath}-wal`) {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      open += 1;
      return {
        close: async () => {
          open -= 1;
        },
      };
    };

    for (let i = 0; i < 5; i++) {
      await readStoreGeneration(dbPath, undefined, counting);
    }

    // A leak here would hold a descriptor against a file a running agent is writing.
    expect(open).toBe(0);
  });

  it("leaves the stamp helper's answer for an unreadable path alone", async () => {
    // `stampStoreFiles` shares the same loop and has always OMITTED a path it could
    // not read rather than refusing the set. Tightening that is a cache-invalidation
    // change this task deliberately does not make (design.md D4).
    await fsp.writeFile(`${dbPath}-wal`, "wal");
    const stamps = await stampStoreFiles(storeFilePaths(dbPath));
    expect(Object.keys(stamps).sort()).toEqual([dbPath, `${dbPath}-wal`].sort());
  });

  it("reads a quiet WAL-free store as usable", async () => {
    const gen = await readStoreGeneration(dbPath);
    expect(gen.usable).toBe(true);
    expect(Object.keys(gen.stamps)).toEqual([dbPath]);
  });

  it("refuses a generation when a write completes between the two halves of the read", async () => {
    // The store starts WAL-free, exactly the shape whose stamp is `{db}` alone.
    let stats = 0;
    const stat = async (target: string) => {
      stats += 1;
      // After the FIRST `.db` stat, a writer commits, checkpoints and closes: the
      // database advances and the `-wal` is gone before we get to stat it. A single
      // pass would come back `{db:S0}` and match the pre-write generation.
      if (stats === 1) {
        const result = await fsp.stat(target);
        await fsp.writeFile(`${dbPath}-wal`, "committed");
        await fsp.writeFile(dbPath, "base-checkpointed-and-larger");
        await fsp.rm(`${dbPath}-wal`, { force: true });
        return result;
      }
      return fsp.stat(target);
    };

    const gen = await readStoreGeneration(dbPath, stat);

    // Either it is refused, or it describes the post-write store — never the stale one.
    if (gen.usable) {
      expect(gen.stamps[dbPath]?.size).toBe("base-checkpointed-and-larger".length);
    } else {
      expect(gen.usable).toBe(false);
    }
    expect(stats).toBeGreaterThanOrEqual(4);
  });

  it("never reads an unreadable wal as a wal-free store", async () => {
    await fsp.writeFile(`${dbPath}-wal`, "committed");
    const stat = async (target: string) => {
      if (target.endsWith("-wal")) {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      return fsp.stat(target);
    };

    const gen = await readStoreGeneration(dbPath, stat);
    expect(gen.usable).toBe(false);
  });

  it("refuses a generation that does not cover the database itself", async () => {
    await fsp.rm(dbPath);
    const gen = await readStoreGeneration(dbPath);
    expect(gen.usable).toBe(false);
  });
});
