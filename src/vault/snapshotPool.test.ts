import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type SnapshotLease, SnapshotPool, type SnapshotPoolDeps } from "./snapshotPool";

/** Long enough for a disposal with real `fs.rm` calls in it to have finished if it
 *  were not waiting, so "has not settled yet" is a claim about the barrier rather
 *  than about how few awaits the test happened to use. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

/** Retention is opt-in: only a store an agent has exactly one of asks for it (D3). */
const RETAIN = { retain: true } as const;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("SnapshotPool", () => {
  let root: string;
  let dbPath: string;
  let deps: SnapshotPoolDeps;
  let produced: string[];

  const produce = async (dest: string): Promise<void> => {
    produced.push(dest);
    await fs.writeFile(dest, `snapshot-${produced.length}`);
  };

  /** A commit: rewrites the `-wal` at a new size, as a real WAL append would. */
  const writeToWal = async (): Promise<void> => {
    await fs.writeFile(`${dbPath}-wal`, "w".repeat(produced.length + 8));
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "at-pool-test-"));
    dbPath = path.join(root, "store.db");
    await fs.writeFile(dbPath, "base");
    await fs.writeFile(`${dbPath}-wal`, "wal");
    produced = [];
    deps = {
      mkdtemp: () => fs.mkdtemp(path.join(root, "snap-")),
      rmrf: (dir) => fs.rm(dir, { recursive: true, force: true }),
    };
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("reuses the snapshot while the store is unchanged", async () => {
    const pool = new SnapshotPool(deps);

    const first = await pool.borrow(dbPath, produce, RETAIN);
    await first.release();
    const second = await pool.borrow(dbPath, produce, RETAIN);
    await second.release();

    expect(produced).toHaveLength(1);
    expect(second.file).toBe(first.file);
    await expect(fs.readFile(second.file, "utf8")).resolves.toBe("snapshot-1");
  });

  it("takes a fresh snapshot when the store was written between reads", async () => {
    const pool = new SnapshotPool(deps);

    const first = await pool.borrow(dbPath, produce, RETAIN);
    await first.release();
    await writeToWal();
    const second = await pool.borrow(dbPath, produce, RETAIN);
    await second.release();

    expect(produced).toHaveLength(2);
    expect(second.file).not.toBe(first.file);
  });

  it("takes a fresh snapshot when the store was checkpointed between reads", async () => {
    const pool = new SnapshotPool(deps);

    const first = await pool.borrow(dbPath, produce, RETAIN);
    await first.release();
    await fs.writeFile(dbPath, "base-checkpointed");
    const second = await pool.borrow(dbPath, produce, RETAIN);
    await second.release();

    expect(produced).toHaveLength(2);
  });

  it("does not retain a snapshot taken while the store was being written", async () => {
    const pool = new SnapshotPool(deps);

    const racy = await pool.borrow(dbPath, async (dest) => {
      await produce(dest);
      await writeToWal();
    }, RETAIN);
    await racy.release();

    // The store is now quiet, so a retained snapshot would be reused. It must not be:
    // that snapshot spans a write and belongs to neither the before nor the after stamp.
    const next = await pool.borrow(dbPath, produce, RETAIN);
    await next.release();

    expect(produced).toHaveLength(2);
  });

  it("deletes the snapshot it refused to retain", async () => {
    const pool = new SnapshotPool(deps);

    const racy = await pool.borrow(dbPath, async (dest) => {
      await produce(dest);
      await writeToWal();
    }, RETAIN);
    const file = racy.file;
    await racy.release();

    await expect(fs.access(file)).rejects.toThrow();
  });

  it("never reuses when the store's generation could not be established", async () => {
    const pool = new SnapshotPool({
      ...deps,
      readGeneration: async () => ({ stamps: {}, usable: false }),
    });

    const first = await pool.borrow(dbPath, produce, RETAIN);
    await first.release();
    const second = await pool.borrow(dbPath, produce, RETAIN);
    await second.release();

    expect(produced).toHaveLength(2);
  });

  it("propagates a production failure and leaves nothing retained", async () => {
    const pool = new SnapshotPool(deps);

    await expect(
      pool.borrow(dbPath, async () => {
        throw new Error("backup refused");
      }, RETAIN),
    ).rejects.toThrow("backup refused");

    const after = await pool.borrow(dbPath, produce, RETAIN);
    await after.release();
    expect(produced).toHaveLength(1);
    await expect(fs.access(after.file)).resolves.toBeUndefined();
  });
  it("gives concurrent readers of one store a single snapshot", async () => {
    const pool = new SnapshotPool(deps);
    const gate = deferred();
    const started = deferred();

    const first = pool.borrow(dbPath, async (dest) => {
      started.resolve();
      await gate.promise;
      await produce(dest);
    }, RETAIN);
    // Wait for production to actually be in flight — a microtask tick is not enough,
    // since `borrow` stats the store first.
    await started.promise;
    const second = pool.borrow(dbPath, produce, RETAIN);
    gate.resolve();

    const [a, b] = await Promise.all([first, second]);
    expect(produced).toHaveLength(1);
    expect(b.file).toBe(a.file);
    await a.release();
    await b.release();
  });

  it("keeps a shared unretained snapshot alive until its last reader is done", async () => {
    const pool = new SnapshotPool(deps);
    const gate = deferred();
    const started = deferred();

    // A write lands during production, so this snapshot is used once and never retained.
    const first = pool.borrow(dbPath, async (dest) => {
      started.resolve();
      await gate.promise;
      await produce(dest);
      await writeToWal();
    }, RETAIN);
    await started.promise;
    const second = pool.borrow(dbPath, produce, RETAIN);
    gate.resolve();

    const [a, b] = await Promise.all([first, second]);
    expect(b.file).toBe(a.file);
    expect(produced).toHaveLength(1);
    await a.release();
    await expect(fs.access(b.file)).resolves.toBeUndefined();
    await b.release();
    await expect(fs.access(b.file)).rejects.toThrow();
  });

  it("lets the next reader retry after a failed production instead of awaiting it", async () => {
    const pool = new SnapshotPool(deps);

    await expect(
      pool.borrow(dbPath, async () => {
        throw new Error("backup refused");
      }, RETAIN),
    ).rejects.toThrow("backup refused");

    const lease = await pool.borrow(dbPath, produce, RETAIN);
    expect(produced).toHaveLength(1);
    await lease.release();
  });
  it("deletes a superseded snapshot once its last reader releases it", async () => {
    const pool = new SnapshotPool(deps);

    const stale = await pool.borrow(dbPath, produce, RETAIN);
    await writeToWal();
    const fresh = await pool.borrow(dbPath, produce, RETAIN);

    // Still borrowed, so it must survive being replaced.
    await expect(fs.access(stale.file)).resolves.toBeUndefined();
    await stale.release();
    await expect(fs.access(stale.file)).rejects.toThrow();
    await expect(fs.access(fresh.file)).resolves.toBeUndefined();
    await fresh.release();
  });

  it("deletes a superseded snapshot immediately when nobody is reading it", async () => {
    const pool = new SnapshotPool(deps);

    const stale = await pool.borrow(dbPath, produce, RETAIN);
    await stale.release();
    await writeToWal();
    const fresh = await pool.borrow(dbPath, produce, RETAIN);
    await fresh.release();

    await expect(fs.access(stale.file)).rejects.toThrow();
  });

  it("releases the disk of a snapshot left unused for the idle interval", async () => {
    let clock = 1_000;
    const pool = new SnapshotPool({ ...deps, idleMs: 5_000, now: () => clock });

    const lease = await pool.borrow(dbPath, produce, RETAIN);
    await lease.release();

    clock += 4_000;
    await pool.evictIdle();
    await expect(fs.access(lease.file)).resolves.toBeUndefined();

    clock += 2_000;
    await pool.evictIdle();
    await expect(fs.access(lease.file)).rejects.toThrow();

    // And the next read takes a fresh snapshot rather than reusing a deleted file.
    const next = await pool.borrow(dbPath, produce, RETAIN);
    expect(produced).toHaveLength(2);
    await next.release();
    await pool.dispose();
  });

  it("never evicts a snapshot that is currently borrowed", async () => {
    let clock = 1_000;
    const pool = new SnapshotPool({ ...deps, idleMs: 5_000, now: () => clock });

    const lease = await pool.borrow(dbPath, produce, RETAIN);
    clock += 60_000;
    await pool.evictIdle();

    await expect(fs.access(lease.file)).resolves.toBeUndefined();
    await lease.release();

    // And it is still the pool's snapshot for this store, not merely a surviving file.
    const again = await pool.borrow(dbPath, produce, RETAIN);
    expect(produced).toHaveLength(1);
    expect(again.file).toBe(lease.file);
    await again.release();
    await pool.dispose();
  });

  it("deletes every retained snapshot on dispose", async () => {
    const other = path.join(root, "second.db");
    await fs.writeFile(other, "base");
    const pool = new SnapshotPool(deps);

    const a = await pool.borrow(dbPath, produce, RETAIN);
    await a.release();
    const b = await pool.borrow(other, produce, RETAIN);
    await b.release();

    await pool.dispose();

    await expect(fs.access(a.file)).rejects.toThrow();
    await expect(fs.access(b.file)).rejects.toThrow();
  });
  it("never serves a pre-write snapshot to a reader that has already seen the write", async () => {
    const pool = new SnapshotPool(deps);
    const gate = deferred();
    const started = deferred();
    // The snapshot's content is the store's WAL, so a stale answer is visible rather
    // than merely inferred from a call count.
    const copyWal = async (dest: string): Promise<void> => {
      produced.push(dest);
      await fs.copyFile(`${dbPath}-wal`, dest);
    };

    const first = pool.borrow(dbPath, async (dest) => {
      started.resolve();
      await gate.promise;
      await copyWal(dest);
    }, RETAIN);
    await started.promise;

    // A session commits while that snapshot is in flight, and only now does the
    // second reader arrive — it has observed the write, so it must not join.
    await fs.writeFile(`${dbPath}-wal`, "wal-with-committed-session");
    const second = pool.borrow(dbPath, copyWal, RETAIN);
    gate.resolve();

    const [a, b] = await Promise.all([first, second]);
    expect(b.file).not.toBe(a.file);
    await expect(fs.readFile(b.file, "utf8")).resolves.toBe("wal-with-committed-session");
    expect(produced).toHaveLength(2);
    await a.release();
    await b.release();
  });
});
describe("SnapshotPool retention", () => {
  let root: string;
  let produced: string[];
  let deps: SnapshotPoolDeps;

  const store = async (name: string): Promise<string> => {
    const db = path.join(root, `${name}.db`);
    await fs.writeFile(db, `base-${name}`);
    return db;
  };

  const produce = async (dest: string): Promise<void> => {
    produced.push(dest);
    await fs.writeFile(dest, `snapshot-${produced.length}`);
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "at-pool-keep-"));
    produced = [];
    deps = {
      mkdtemp: () => fs.mkdtemp(path.join(root, "snap-")),
      rmrf: (dir) => fs.rm(dir, { recursive: true, force: true }),
    };
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("leaves nothing behind for a store nobody asked to retain", async () => {
    const pool = new SnapshotPool(deps);
    const a = await store("a");

    const lease = await pool.borrow(a, produce);
    await expect(fs.access(lease.file)).resolves.toBeUndefined();
    await lease.release();

    await expect(fs.access(lease.file)).rejects.toThrow();
    expect(pool.retainedCount).toBe(0);
    await pool.dispose();
  });

  it("takes a fresh snapshot every time for a store nobody asked to retain", async () => {
    const pool = new SnapshotPool(deps);
    const a = await store("a");

    const first = await pool.borrow(a, produce);
    await first.release();
    const second = await pool.borrow(a, produce);
    await second.release();

    // An unchanged store still costs a snapshot here: reuse is what retention buys,
    // and the per-chat path deliberately does not buy it.
    expect(produced).toHaveLength(2);
    expect(second.file).not.toBe(first.file);
    await pool.dispose();
  });

  it("retains only the stores whose readers asked for it", async () => {
    const pool = new SnapshotPool(deps);
    const a = await store("a");
    const b = await store("b");

    await (await pool.borrow(a, produce, RETAIN)).release();
    for (const chat of [b, await store("c"), await store("d")]) {
      await (await pool.borrow(chat, produce)).release();
    }

    // Three unretained stores passed through and left one key behind between them:
    // the retained set is bounded by who opts in, not by how many stores were read.
    expect(pool.retainedCount).toBe(1);
    const again = await pool.borrow(a, produce, RETAIN);
    expect(produced).toHaveLength(4);
    await again.release();
    await pool.dispose();
  });

  it("keeps every concurrent borrow of a distinct store readable until its own release", async () => {
    // The entry is published to the pool only once its own producer holds a lease, so
    // no concurrent admission can take the file out from under the reader it was made
    // for (round-4 B7). Started together, so the productions overlap.
    const pool = new SnapshotPool(deps);
    const stores = await Promise.all(["a", "b", "c", "d"].map(store));

    const leases = await Promise.all(stores.map((db) => pool.borrow(db, produce, RETAIN)));

    for (const lease of leases) {
      expect(await fs.readFile(lease.file, "utf8")).toMatch(/^snapshot-/);
    }
    expect(new Set(leases.map((lease) => lease.file)).size).toBe(4);
    expect(pool.retainedCount).toBe(4);
    for (const lease of leases) {
      await lease.release();
    }
    await pool.dispose();
  });

  it("keeps a snapshot it could not delete, and retries it on a later borrow", async () => {
    let failDeletes = false;
    const pool = new SnapshotPool({
      ...deps,
      rmrf: async (dir) => {
        if (failDeletes) {
          throw new Error("EBUSY");
        }
        await fs.rm(dir, { recursive: true, force: true });
      },
    });
    const a = await store("a");

    const first = await pool.borrow(a, produce, RETAIN);
    await first.release();

    // Superseded while deletion fails: the entry leaves the retained map, but its
    // disk is still the pool's to account for.
    failDeletes = true;
    await fs.writeFile(a, "base-a-changed");
    await (await pool.borrow(a, produce, RETAIN)).release();
    await expect(fs.access(first.file)).resolves.toBeUndefined();

    failDeletes = false;
    await fs.writeFile(a, "base-a-changed-again");
    await (await pool.borrow(a, produce, RETAIN)).release();

    await expect(fs.access(first.file)).rejects.toThrow();
    await pool.dispose();
  });

  it("keeps sweeping while a failed deletion is still worth retrying", async () => {
    let failDeletes = false;
    const pool = new SnapshotPool({
      ...deps,
      idleMs: 30,
      rmrf: async (dir) => {
        if (failDeletes) {
          throw new Error("EBUSY");
        }
        await fs.rm(dir, { recursive: true, force: true });
      },
    });
    const a = await store("a");

    const first = await pool.borrow(a, produce, RETAIN);
    await first.release();
    failDeletes = true;
    await fs.writeFile(a, "base-a-changed");
    await (await pool.borrow(a, produce, RETAIN)).release();

    // The retained entry ages out while the stuck one is still stuck, so the pool
    // holds nothing — the state that used to stop the sweeper. Nothing borrows again.
    await flush();
    expect(pool.retainedCount).toBe(0);
    await expect(fs.access(first.file)).resolves.toBeUndefined();

    // Only a still-running sweeper can clear it now, since no admission will come.
    failDeletes = false;
    await flush();

    await expect(fs.access(first.file)).rejects.toThrow();
    await pool.dispose();
  });
});

describe("SnapshotPool disposal", () => {
  let root: string;
  let dbPath: string;
  let deps: SnapshotPoolDeps;

  const produce = async (dest: string): Promise<void> => {
    await fs.writeFile(dest, "snapshot");
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "at-pool-dispose-"));
    dbPath = path.join(root, "store.db");
    await fs.writeFile(dbPath, "base");
    deps = {
      mkdtemp: () => fs.mkdtemp(path.join(root, "snap-")),
      rmrf: (dir) => fs.rm(dir, { recursive: true, force: true }),
    };
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("deletes a snapshot whose production settles after disposal began", async () => {
    const pool = new SnapshotPool(deps);
    const gate = deferred();
    const started = deferred();

    const borrowing = pool.borrow(dbPath, async (dest) => {
      started.resolve();
      await gate.promise;
      await produce(dest);
    }, RETAIN);
    await started.promise;

    let disposed = false;
    const disposing = pool.dispose().then(() => {
      disposed = true;
    });
    await flush();

    // The barrier: disposal cannot finish while a snapshot is still being produced,
    // or that snapshot lands after the sweep meant to remove it.
    expect(disposed).toBe(false);

    gate.resolve();
    const lease = await borrowing;
    await lease.release();
    await disposing;

    await expect(fs.access(lease.file)).rejects.toThrow();
    expect(pool.retainedCount).toBe(0);
  });

  it("waits for an outstanding reader before deleting what it holds", async () => {
    const pool = new SnapshotPool(deps);
    const lease = await pool.borrow(dbPath, produce, RETAIN);

    let disposed = false;
    const disposing = pool.dispose().then(() => {
      disposed = true;
    });
    await flush();

    // Still readable, and dispose has not claimed to be finished.
    expect(disposed).toBe(false);
    await expect(fs.access(lease.file)).resolves.toBeUndefined();

    await lease.release();
    await disposing;
    expect(disposed).toBe(true);
    await expect(fs.access(lease.file)).rejects.toThrow();
    expect(pool.retainedCount).toBe(0);
  });

  it("refuses to hand out a snapshot once disposed", async () => {
    const pool = new SnapshotPool(deps);
    const lease = await pool.borrow(dbPath, produce, RETAIN);
    await lease.release();
    await pool.dispose();

    await expect(pool.borrow(dbPath, produce, RETAIN)).rejects.toThrow(/disposed/);
  });
  it("refuses a snapshot to a caller that was waiting out another production", async () => {
    const pool = new SnapshotPool(deps);
    const gate = deferred();
    const started = deferred();

    const first = pool.borrow(dbPath, async (dest) => {
      started.resolve();
      await gate.promise;
      await produce(dest);
    }, RETAIN);
    await started.promise;

    // A different generation, so this caller waits for the flight rather than joining.
    await fs.writeFile(dbPath, "base-changed");
    // Handled synchronously: it rejects while the test is awaiting something else,
    // and an unattached rejection would surface as an unhandled error.
    const waiting = pool.borrow(dbPath, produce, RETAIN).then(
      () => "resolved",
      (err: unknown) => (err as Error).message,
    );

    const disposing = pool.dispose();
    gate.resolve();
    const lease = await first;
    await lease.release();

    await expect(waiting).resolves.toMatch(/disposed/);
    await disposing;
    await expect(fs.readdir(root)).resolves.toEqual(["store.db"]);
  });
  it("waits for a borrow parked before it ever reached a map", async () => {
    const stalled = deferred();
    const reached = deferred();
    const pool = new SnapshotPool({
      ...deps,
      readGeneration: async (target) => {
        reached.resolve();
        await stalled.promise;
        return { stamps: { [target]: { mtimeMs: 1, size: 1 } }, usable: true };
      },
    });

    // Admitted, then parked on its own generation read: in no flight map, holding no
    // lease, and invisible to a disposal that drains only what it can see.
    const borrowing = pool.borrow(dbPath, produce, RETAIN);
    await reached.promise;

    let disposed = false;
    const disposing = pool.dispose().then(() => {
      disposed = true;
    });
    await flush();
    expect(disposed).toBe(false);

    stalled.resolve();
    const lease = await borrowing;
    await lease.release();
    await disposing;

    await expect(fs.access(lease.file)).rejects.toThrow();
    await expect(fs.readdir(root)).resolves.toEqual(["store.db"]);
  });

  it("waits for every outstanding borrow, not just the first", async () => {
    const pool = new SnapshotPool(deps);
    const first = await pool.borrow(dbPath, produce, RETAIN);
    const second = await pool.borrow(dbPath, produce, RETAIN);

    let disposed = false;
    const disposing = pool.dispose().then(() => {
      disposed = true;
    });

    await first.release();
    await flush();
    expect(disposed).toBe(false);

    await second.release();
    await disposing;
    expect(disposed).toBe(true);
    await expect(fs.readdir(root)).resolves.toEqual(["store.db"]);
  });
  it("keeps a snapshot it failed to delete, and retries it at disposal", async () => {
    let failDeletes = true;
    const attempts: string[] = [];
    const pool = new SnapshotPool({
      ...deps,
      rmrf: async (dir) => {
        attempts.push(dir);
        if (failDeletes) {
          throw new Error("EBUSY");
        }
        await fs.rm(dir, { recursive: true, force: true });
      },
    });

    // An unretained snapshot whose deletion fails at release: it must not be
    // forgotten, or the file has no owner left to remove it.
    const lease = await pool.borrow(dbPath, async (dest) => {
      await produce(dest);
      await fs.writeFile(`${dbPath}-wal`, "written-during");
    }, RETAIN);
    await lease.release();
    await expect(fs.access(lease.file)).resolves.toBeUndefined();

    failDeletes = false;
    await pool.dispose();

    await expect(fs.access(lease.file)).rejects.toThrow();
    expect(attempts.length).toBeGreaterThanOrEqual(2);
  });

  it("reports what disposal could not delete instead of resolving over it", async () => {
    const pool = new SnapshotPool({
      ...deps,
      rmrf: async () => {
        throw new Error("EBUSY");
      },
    });

    const lease = await pool.borrow(dbPath, produce, RETAIN);
    await lease.release();

    await expect(pool.dispose()).rejects.toThrow(/could not delete/);
    await expect(fs.access(lease.file)).resolves.toBeUndefined();
  });
});
