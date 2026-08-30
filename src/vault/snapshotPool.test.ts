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

    const first = await pool.borrow(dbPath, produce);
    await first.release();
    const second = await pool.borrow(dbPath, produce);
    await second.release();

    expect(produced).toHaveLength(1);
    expect(second.file).toBe(first.file);
    await expect(fs.readFile(second.file, "utf8")).resolves.toBe("snapshot-1");
  });

  it("takes a fresh snapshot when the store was written between reads", async () => {
    const pool = new SnapshotPool(deps);

    const first = await pool.borrow(dbPath, produce);
    await first.release();
    await writeToWal();
    const second = await pool.borrow(dbPath, produce);
    await second.release();

    expect(produced).toHaveLength(2);
    expect(second.file).not.toBe(first.file);
  });

  it("takes a fresh snapshot when the store was checkpointed between reads", async () => {
    const pool = new SnapshotPool(deps);

    const first = await pool.borrow(dbPath, produce);
    await first.release();
    await fs.writeFile(dbPath, "base-checkpointed");
    const second = await pool.borrow(dbPath, produce);
    await second.release();

    expect(produced).toHaveLength(2);
  });

  it("does not retain a snapshot taken while the store was being written", async () => {
    const pool = new SnapshotPool(deps);

    const racy = await pool.borrow(dbPath, async (dest) => {
      await produce(dest);
      await writeToWal();
    });
    await racy.release();

    // The store is now quiet, so a retained snapshot would be reused. It must not be:
    // that snapshot spans a write and belongs to neither the before nor the after stamp.
    const next = await pool.borrow(dbPath, produce);
    await next.release();

    expect(produced).toHaveLength(2);
  });

  it("deletes the snapshot it refused to retain", async () => {
    const pool = new SnapshotPool(deps);

    const racy = await pool.borrow(dbPath, async (dest) => {
      await produce(dest);
      await writeToWal();
    });
    const file = racy.file;
    await racy.release();

    await expect(fs.access(file)).rejects.toThrow();
  });

  it("never reuses when the store's generation could not be established", async () => {
    const pool = new SnapshotPool({
      ...deps,
      readGeneration: async () => ({ stamps: {}, usable: false }),
    });

    const first = await pool.borrow(dbPath, produce);
    await first.release();
    const second = await pool.borrow(dbPath, produce);
    await second.release();

    expect(produced).toHaveLength(2);
  });

  it("propagates a production failure and leaves nothing retained", async () => {
    const pool = new SnapshotPool(deps);

    await expect(
      pool.borrow(dbPath, async () => {
        throw new Error("backup refused");
      }),
    ).rejects.toThrow("backup refused");

    const after = await pool.borrow(dbPath, produce);
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
    });
    // Wait for production to actually be in flight — a microtask tick is not enough,
    // since `borrow` stats the store first.
    await started.promise;
    const second = pool.borrow(dbPath, produce);
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
    });
    await started.promise;
    const second = pool.borrow(dbPath, produce);
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
      }),
    ).rejects.toThrow("backup refused");

    const lease = await pool.borrow(dbPath, produce);
    expect(produced).toHaveLength(1);
    await lease.release();
  });
  it("deletes a superseded snapshot once its last reader releases it", async () => {
    const pool = new SnapshotPool(deps);

    const stale = await pool.borrow(dbPath, produce);
    await writeToWal();
    const fresh = await pool.borrow(dbPath, produce);

    // Still borrowed, so it must survive being replaced.
    await expect(fs.access(stale.file)).resolves.toBeUndefined();
    await stale.release();
    await expect(fs.access(stale.file)).rejects.toThrow();
    await expect(fs.access(fresh.file)).resolves.toBeUndefined();
    await fresh.release();
  });

  it("deletes a superseded snapshot immediately when nobody is reading it", async () => {
    const pool = new SnapshotPool(deps);

    const stale = await pool.borrow(dbPath, produce);
    await stale.release();
    await writeToWal();
    const fresh = await pool.borrow(dbPath, produce);
    await fresh.release();

    await expect(fs.access(stale.file)).rejects.toThrow();
  });

  it("releases the disk of a snapshot left unused for the idle interval", async () => {
    let clock = 1_000;
    const pool = new SnapshotPool({ ...deps, idleMs: 5_000, now: () => clock });

    const lease = await pool.borrow(dbPath, produce);
    await lease.release();

    clock += 4_000;
    await pool.evictIdle();
    await expect(fs.access(lease.file)).resolves.toBeUndefined();

    clock += 2_000;
    await pool.evictIdle();
    await expect(fs.access(lease.file)).rejects.toThrow();

    // And the next read takes a fresh snapshot rather than reusing a deleted file.
    const next = await pool.borrow(dbPath, produce);
    expect(produced).toHaveLength(2);
    await next.release();
    await pool.dispose();
  });

  it("never evicts a snapshot that is currently borrowed", async () => {
    let clock = 1_000;
    const pool = new SnapshotPool({ ...deps, idleMs: 5_000, now: () => clock });

    const lease = await pool.borrow(dbPath, produce);
    clock += 60_000;
    await pool.evictIdle();

    await expect(fs.access(lease.file)).resolves.toBeUndefined();
    await lease.release();

    // And it is still the pool's snapshot for this store, not merely a surviving file.
    const again = await pool.borrow(dbPath, produce);
    expect(produced).toHaveLength(1);
    expect(again.file).toBe(lease.file);
    await again.release();
    await pool.dispose();
  });

  it("deletes every retained snapshot on dispose", async () => {
    const other = path.join(root, "second.db");
    await fs.writeFile(other, "base");
    const pool = new SnapshotPool(deps);

    const a = await pool.borrow(dbPath, produce);
    await a.release();
    const b = await pool.borrow(other, produce);
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
    });
    await started.promise;

    // A session commits while that snapshot is in flight, and only now does the
    // second reader arrive — it has observed the write, so it must not join.
    await fs.writeFile(`${dbPath}-wal`, "wal-with-committed-session");
    const second = pool.borrow(dbPath, copyWal);
    gate.resolve();

    const [a, b] = await Promise.all([first, second]);
    expect(b.file).not.toBe(a.file);
    await expect(fs.readFile(b.file, "utf8")).resolves.toBe("wal-with-committed-session");
    expect(produced).toHaveLength(2);
    await a.release();
    await b.release();
  });
});

describe("SnapshotPool capacity", () => {
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
    await fs.writeFile(dest, "x".repeat(100));
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "at-pool-cap-"));
    produced = [];
    deps = {
      mkdtemp: () => fs.mkdtemp(path.join(root, "snap-")),
      rmrf: (dir) => fs.rm(dir, { recursive: true, force: true }),
    };
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("holds no more snapshots than its entry budget, evicting the least recently used", async () => {
    let clock = 0;
    const pool = new SnapshotPool({ ...deps, maxEntries: 2, now: () => (clock += 10) });
    const a = await store("a");
    const b = await store("b");
    const c = await store("c");

    const first = await pool.borrow(a, produce);
    await first.release();
    const second = await pool.borrow(b, produce);
    await second.release();
    const third = await pool.borrow(c, produce);
    await third.release();

    // `a` was the least recently used, so it is the one that lost its disk.
    await expect(fs.access(first.file)).rejects.toThrow();
    await expect(fs.access(second.file)).resolves.toBeUndefined();
    await expect(fs.access(third.file)).resolves.toBeUndefined();

    const again = await pool.borrow(a, produce);
    expect(produced).toHaveLength(4);
    await again.release();
    await pool.dispose();
  });

  it("holds no more bytes than its byte budget", async () => {
    let clock = 0;
    const pool = new SnapshotPool({ ...deps, maxBytes: 250, now: () => (clock += 10) });
    const a = await store("a");
    const b = await store("b");

    const first = await pool.borrow(a, produce);
    await first.release();
    const second = await pool.borrow(b, produce);
    await second.release();
    const third = await pool.borrow(await store("c"), produce);
    await third.release();

    await expect(fs.access(first.file)).rejects.toThrow();
    await expect(fs.access(third.file)).resolves.toBeUndefined();
    await pool.dispose();
  });

  it("never retains a snapshot larger than the whole budget", async () => {
    const pool = new SnapshotPool({ ...deps, maxBytes: 10 });
    const a = await store("a");

    const first = await pool.borrow(a, produce);
    await first.release();
    // Leased once and dropped, so the next read pays for its own snapshot.
    const second = await pool.borrow(a, produce);

    await expect(fs.access(first.file)).rejects.toThrow();
    expect(produced).toHaveLength(2);
    await second.release();
    await pool.dispose();
  });

  it("does not delete an evicted snapshot while a reader still holds it", async () => {
    let clock = 0;
    const pool = new SnapshotPool({ ...deps, maxEntries: 1, now: () => (clock += 10) });
    const a = await store("a");
    const b = await store("b");

    const held = await pool.borrow(a, produce);
    const evictor = await pool.borrow(b, produce);

    await expect(fs.access(held.file)).resolves.toBeUndefined();
    await held.release();
    await expect(fs.access(held.file)).rejects.toThrow();
    await evictor.release();
    await pool.dispose();
  });

  it("does not orphan a snapshot that replaces one mid-eviction", async () => {
    let clock = 1_000;
    let gate: Promise<void> | undefined;
    const pool = new SnapshotPool({
      ...deps,
      idleMs: 5,
      now: () => clock,
      rmrf: async (dir) => {
        // Deleting one store's snapshot yields, and the OTHER store is re-snapshotted
        // during that window — the interleaving that used to drop the new binding.
        if (gate) {
          const pending = gate;
          gate = undefined;
          await pending;
        }
        await fs.rm(dir, { recursive: true, force: true });
      },
    });
    const a = await store("a");
    const b = await store("b");

    const staleA = await pool.borrow(a, produce);
    await staleA.release();
    const staleB = await pool.borrow(b, produce);
    await staleB.release();

    clock += 100;
    let refreshedB: SnapshotLease | undefined;
    gate = (async () => {
      clock += 1;
      await fs.writeFile(b, "base-b-changed");
      refreshedB = await pool.borrow(b, produce);
    })();
    await pool.evictIdle();

    // The replacement is still the pool's snapshot for `b`, not an unreachable file.
    expect(refreshedB).toBeDefined();
    await expect(fs.access(refreshedB?.file ?? "")).resolves.toBeUndefined();
    const reused = await pool.borrow(b, produce);
    expect(reused.file).toBe(refreshedB?.file);
    await reused.release();
    await refreshedB?.release();
    await pool.dispose();
    await expect(fs.access(refreshedB?.file ?? "")).rejects.toThrow();
  });
  it("does not evict a useful snapshot to make room for one that can never fit", async () => {
    let clock = 0;
    const pool = new SnapshotPool({ ...deps, maxBytes: 250, now: () => (clock += 10) });
    const a = await store("a");
    const b = await store("b");

    const small = await pool.borrow(a, produce);
    await small.release();
    const oversized = await pool.borrow(b, async (dest) => {
      produced.push(dest);
      await fs.writeFile(dest, "y".repeat(300));
    });
    await oversized.release();

    // `b` could never be retained, so paying for it with `a`'s snapshot buys nothing.
    await expect(fs.access(small.file)).resolves.toBeUndefined();
    const reused = await pool.borrow(a, produce);
    expect(reused.file).toBe(small.file);
    await reused.release();
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
    });
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
    const lease = await pool.borrow(dbPath, produce);

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
    const lease = await pool.borrow(dbPath, produce);
    await lease.release();
    await pool.dispose();

    await expect(pool.borrow(dbPath, produce)).rejects.toThrow(/disposed/);
  });
  it("refuses a snapshot to a caller that was waiting out another production", async () => {
    const pool = new SnapshotPool(deps);
    const gate = deferred();
    const started = deferred();

    const first = pool.borrow(dbPath, async (dest) => {
      started.resolve();
      await gate.promise;
      await produce(dest);
    });
    await started.promise;

    // A different generation, so this caller waits for the flight rather than joining.
    await fs.writeFile(dbPath, "base-changed");
    // Handled synchronously: it rejects while the test is awaiting something else,
    // and an unattached rejection would surface as an unhandled error.
    const waiting = pool.borrow(dbPath, produce).then(
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
});
