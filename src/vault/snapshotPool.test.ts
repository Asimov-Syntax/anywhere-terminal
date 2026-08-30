import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SnapshotPool, type SnapshotPoolDeps } from "./snapshotPool";

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

  it("never reuses when the store's stamp cannot be read", async () => {
    const pool = new SnapshotPool({
      ...deps,
      stamp: async () => ({}),
    });

    const first = await pool.borrow(dbPath, produce);
    await first.release();
    const second = await pool.borrow(dbPath, produce);
    await second.release();

    expect(produced).toHaveLength(2);
  });

  it("propagates a production failure and leaves nothing retained", async () => {
    const pool = new SnapshotPool(deps);

    await expect(pool.borrow(dbPath, async () => {
      throw new Error("backup refused");
    })).rejects.toThrow("backup refused");

    const after = await pool.borrow(dbPath, produce);
    await after.release();
    expect(produced).toHaveLength(1);
    await expect(fs.access(after.file)).resolves.toBeUndefined();
  });
});
