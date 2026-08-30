// src/vault/snapshotPool.ts — Reuse a snapshot while its store is provably unchanged.
//
// An engine snapshot copies every live page (~950ms for a 522MB store), and a store
// nobody wrote to yields byte-identical answers. So the file is kept and handed out
// again while the `(mtimeMs,size)` stamp over the `.db` and its `-wal` is unchanged:
// any commit rewrites the `-wal` mtime, any checkpoint rewrites the `.db`, so an
// equal stamp means no write landed (D1). Proven sameness, never elapsed time — that
// is what makes reuse safe for reporting a session ABSENT, which a TTL could not be.

import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { FileStamp } from "./cacheTypes";
import { readStoreGeneration, type StoreGeneration, sameStamps } from "./storeStamp";

type Stamp = Record<string, FileStamp>;

/** A borrowed snapshot. `release` gives it back; the pool owns the file. */
export interface SnapshotLease {
  readonly file: string;
  release(): Promise<void>;
}

export interface SnapshotPoolDeps {
  mkdtemp(): Promise<string>;
  rmrf(dir: string): Promise<void>;
  /** Coherent generation read for a store. Defaults to `readStoreGeneration`. */
  readGeneration?(dbPath: string): Promise<StoreGeneration>;
  /** How long a retained snapshot may go unused before its disk is released.
   *  Correctness never depends on this — reuse is gated on the stamp (D1); this
   *  only stops an idle window holding a gigabyte of temp files (D3). */
  idleMs?: number;
  now?(): number;
  /** Most retained snapshots, and most retained bytes. Both are hard caps: a
   *  snapshot that cannot be made to fit is leased once and never retained (D3). */
  maxEntries?: number;
  maxBytes?: number;
  /** Size of a produced snapshot. Defaults to a real `stat`. */
  sizeOf?(file: string): Promise<number>;
}

/** A production in progress, tagged with the store generation it started from. */
interface Flight {
  stamp: Stamp;
  promise: Promise<Entry>;
}

interface Entry {
  dir: string;
  file: string;
  stamp: Stamp;
  /** Outstanding leases. A snapshot the pool is not retaining is deleted by its last
   *  reader, never by its first — concurrent joiners share one file (D4). */
  leases: number;
  retained: boolean;
  lastUsed: number;
  bytes: number;
  deleteAttempts: number;
}

const SNAPSHOT_FILE = "db.sqlite";
const DEFAULT_IDLE_MS = 60_000;
/** How many times a caller will wait out someone else's snapshot before taking its
 *  own. Bounded so a continuously-written store cannot starve a reader. */
const MAX_JOIN_WAITS = 2;
/** Cursor CLI keeps one `store.db` per chat and a list walks every candidate, so the
 *  pool is capped by capacity, not only by age (D3). Sized to hold the handful of
 *  stores a window actually reads without letting a burst own the temp volume. */
const DEFAULT_MAX_ENTRIES = 8;
const DEFAULT_MAX_BYTES = 1_073_741_824; // 1 GiB of retained snapshots
/** How many times a stubborn directory is retried before the pool stops trying on
 *  every admission. It stays owned and stays counted either way. */
const MAX_DELETE_ATTEMPTS = 5;

export class SnapshotPool {
  private readonly retained = new Map<string, Entry>();
  /** One production per store. Concurrent readers join it rather than each running
   *  their own backup — vault list, detail and lookup routinely fire together. */
  private readonly inFlight = new Map<string, Flight>();
  private readonly readGeneration: (dbPath: string) => Promise<StoreGeneration>;
  private readonly idleMs: number;
  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly sizeOf: (file: string) => Promise<number>;
  /** Bytes held by RETAINED snapshots. A snapshot still on loan after eviction is
   *  bounded by the number of concurrent readers, not by this budget. */
  private retainedBytes = 0;
  /** Snapshots whose deletion failed: still owned, still on disk, and still counted —
   *  otherwise repeated failures accumulate gigabytes the budget cannot see (W6). */
  private readonly undeleted = new Set<Entry>();
  private undeletedBytes = 0;
  private sweeper: ReturnType<typeof setInterval> | undefined;
  private disposed = false;
  /** Every entry whose directory still exists, retained or merely on loan. Disposal
   *  works from this, not from the retained map, so a snapshot produced during
   *  shutdown cannot slip past the sweep that was meant to remove it (D3a). */
  private readonly liveEntries = new Set<Entry>();
  private outstandingLeases = 0;
  /** Borrows admitted but not yet settled. Counted from BEFORE the first await, so a
   *  borrow parked on its own generation read is work disposal must wait for, even
   *  though it appears in no map yet (D3a). */
  private admitted = 0;
  private readonly quiesced: Array<() => void> = [];

  constructor(private readonly deps: SnapshotPoolDeps) {
    this.readGeneration = deps.readGeneration ?? readStoreGeneration;
    this.idleMs = deps.idleMs ?? DEFAULT_IDLE_MS;
    this.now = deps.now ?? Date.now;
    this.maxEntries = deps.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
    this.sizeOf = deps.sizeOf ?? (async (file) => (await fsp.stat(file)).size);
  }

  /**
   * Hand back a snapshot of `dbPath`, taking a new one via `produce` only when the
   * store has changed since the retained snapshot was taken. `produce` throws on
   * failure and the throw propagates — a snapshot that could not be taken must never
   * be mistaken for a store that is empty.
   */
  async borrow(dbPath: string, produce: (dest: string) => Promise<void>): Promise<SnapshotLease> {
    if (this.disposed) {
      throw new Error("snapshot pool is disposed");
    }
    this.admitted += 1;
    try {
      return await this.borrowAdmitted(dbPath, produce);
    } finally {
      this.admitted -= 1;
      this.wakeIfQuiet();
    }
  }

  private async borrowAdmitted(dbPath: string, produce: (dest: string) => Promise<void>): Promise<SnapshotLease> {
    for (let waits = 0; ; waits++) {
      const before = await this.readGeneration(dbPath);
      const hit = this.retained.get(dbPath);
      if (hit && before.usable && sameStamps(before.stamps, hit.stamp)) {
        return this.lease(hit);
      }

      const joined = this.inFlight.get(dbPath);
      if (joined) {
        // Joining is gated on the same stamp that gates reuse: a caller that has
        // already observed a newer store must not be handed a snapshot taken before
        // that write, which would be a false `absent` by a different door (D4).
        if (before.usable && sameStamps(before.stamps, joined.stamp)) {
          return this.lease(await joined.promise);
        }
        if (waits < MAX_JOIN_WAITS) {
          await joined.promise.catch(() => {});
          // Re-checked after the wait: disposal may have captured the in-flight list
          // while we were parked, and starting a production now would create a file
          // the sweep has already passed.
          if (this.disposed) {
            throw new Error("snapshot pool is disposed");
          }
          continue;
        }
      }

      const flight: Flight = { stamp: before.stamps, promise: this.produce(dbPath, before, produce) };
      this.inFlight.set(dbPath, flight);
      // Cleared when it settles either way: a failed snapshot must not linger as a
      // promise later readers await forever.
      void flight.promise
        .catch(() => {})
        .finally(() => {
          if (this.inFlight.get(dbPath) === flight) {
            this.inFlight.delete(dbPath);
          }
        });
      return this.lease(await flight.promise);
    }
  }

  private async produce(
    dbPath: string,
    before: StoreGeneration,
    take: (dest: string) => Promise<void>,
  ): Promise<Entry> {
    const dir = await this.deps.mkdtemp();
    const entry: Entry = {
      dir,
      file: path.join(dir, SNAPSHOT_FILE),
      stamp: before.stamps,
      leases: 0,
      retained: false,
      lastUsed: this.now(),
      bytes: 0,
      deleteAttempts: 0,
    };
    this.liveEntries.add(entry);
    try {
      await take(entry.file);
    } catch (err) {
      await this.destroy(entry);
      throw err;
    }

    // Retain only a snapshot attributable to one store state (D2). A snapshot taken
    // across a write is still atomic and still correct for THIS caller, but it belongs
    // to neither stamp — retaining it under the earlier one would be a lie the next
    // reader believes.
    const after = await this.readGeneration(dbPath);
    // Nothing is retained once the pool is closed: this snapshot is handed to its
    // caller and deleted at its last release, never left for a sweeper that is gone.
    const stable = !this.disposed && before.usable && after.usable && sameStamps(before.stamps, after.stamps);

    // Sized BEFORE the accounting, so the accounting itself can be synchronous.
    // Sized whether or not it will be retained: an unretained snapshot still occupies
    // disk, and must be budgetable if its deletion later fails.
    const bytes = await this.sizeOf(entry.file).catch(() => undefined);
    entry.bytes = bytes ?? 0;

    // Retried here rather than on a timer: an admission is exactly when the space
    // matters, and it is outside the accounting block, which must stay synchronous.
    await this.retryUndeleted();

    const evicted: Entry[] = [];
    if (stable && bytes !== undefined) {
      entry.stamp = after.stamps;
      entry.lastUsed = this.now();
      this.admitWithinOneTurn(dbPath, entry, evicted);
    }
    // Deleting AFTER the accounting keeps that block free of suspension points; an
    // evicted entry is already out of the pool and is released by its last reader.
    for (const victim of evicted) {
      await this.discard(victim);
    }
    return entry;
  }

  private lease(entry: Entry): SnapshotLease {
    entry.leases += 1;
    entry.lastUsed = this.now();
    this.outstandingLeases += 1;
    let released = false;
    return {
      file: entry.file,
      release: async () => {
        if (released) {
          return;
        }
        released = true;
        entry.leases -= 1;
        entry.lastUsed = this.now();
        this.outstandingLeases -= 1;
        if (entry.leases === 0 && !entry.retained) {
          await this.destroy(entry);
        }
        this.wakeIfQuiet();
      },
    };
  }

  /**
   * The whole admission decision, in one turn: supersede, check both budgets, choose
   * victims, insert. It MUST contain no `await` — that is what makes it atomic, and
   * an await here is exactly how concurrent producers came to pass the same capacity
   * check and leave the pool over its cap (round-3 B6). Victims are collected for the
   * caller to delete afterwards rather than deleted here.
   */
  private admitWithinOneTurn(dbPath: string, entry: Entry, evicted: Entry[]): void {
    const superseded = this.retained.get(dbPath);
    if (superseded) {
      this.retained.delete(dbPath);
      this.retainedBytes -= superseded.bytes;
      evicted.push(superseded);
    }
    if (entry.bytes > this.maxBytes) {
      return; // Can never fit, so it never costs another snapshot its place.
    }
    while (this.retained.size + 1 > this.maxEntries || this.liveBytes() + entry.bytes > this.maxBytes) {
      const victim = this.leastRecentlyUsed();
      if (!victim) {
        return;
      }
      this.retained.delete(victim[0]);
      this.retainedBytes -= victim[1].bytes;
      evicted.push(victim[1]);
    }
    entry.retained = true;
    this.retained.set(dbPath, entry);
    this.retainedBytes += entry.bytes;
    this.startSweeping();
  }

  private leastRecentlyUsed(): [string, Entry] | undefined {
    let oldest: [string, Entry] | undefined;
    for (const candidate of this.retained) {
      if (!oldest || candidate[1].lastUsed < oldest[1].lastUsed) {
        oldest = candidate;
      }
    }
    return oldest;
  }

  /** How many snapshots the pool is currently holding. */
  get retainedCount(): number {
    return this.retained.size;
  }

  /** Release the disk of every retained snapshot no reader has touched for `idleMs`. */
  async evictIdle(): Promise<void> {
    await this.retryUndeleted();
    const cutoff = this.now() - this.idleMs;
    for (const [dbPath, entry] of [...this.retained]) {
      // Identity-checked: a binding replaced while an earlier deletion awaited must
      // not be dropped in favour of the entry this loop captured (round-1 W1).
      if (entry.leases === 0 && entry.lastUsed <= cutoff && this.retained.get(dbPath) === entry) {
        this.retained.delete(dbPath);
        this.retainedBytes -= entry.bytes;
        await this.discard(entry);
      }
    }
    if (this.retained.size === 0) {
      this.stopSweeping();
    }
  }

  /**
   * Extension shutdown, as a barrier rather than a sweep: no further borrows, every
   * in-flight production awaited so it cannot outlive the sweep, every outstanding
   * lease awaited so nothing is deleted under a reader, and then every remaining
   * snapshot deleted (D3a).
   */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.stopSweeping();

    // Drain ADMITTED work, not the maps it happens to be visible in: a borrow parked
    // before it ever reached the in-flight map, and a producer displaced from the
    // per-store binding, are both live work those maps cannot see.
    while (this.admitted > 0 || this.outstandingLeases > 0) {
      await new Promise<void>((resolve) => this.quiesced.push(resolve));
    }

    this.retained.clear();
    this.retainedBytes = 0;
    const undeleted: string[] = [];
    for (const entry of [...this.liveEntries]) {
      entry.retained = false;
      if (!(await this.destroy(entry))) {
        undeleted.push(entry.dir);
      }
    }
    if (undeleted.length > 0) {
      // Surfaced rather than swallowed: these are session snapshots still on disk
      // after a shutdown that would otherwise report itself clean.
      throw new Error(`snapshot pool could not delete ${undeleted.length} snapshot(s): ${undeleted.join(", ")}`);
    }
  }

  private wakeIfQuiet(): void {
    if (this.admitted === 0 && this.outstandingLeases === 0) {
      for (const wake of this.quiesced.splice(0)) {
        wake();
      }
    }
  }

  /**
   * Delete an entry's directory, and give up ownership of it ONLY once that
   * succeeded. A failed delete keeps its entry, so the file still has an owner and a
   * later disposal retries it rather than reporting success over a snapshot that is
   * still on disk (round-2 W3).
   */
  private async destroy(entry: Entry): Promise<boolean> {
    try {
      await this.deps.rmrf(entry.dir);
    } catch {
      entry.deleteAttempts += 1;
      if (!this.undeleted.has(entry)) {
        this.undeleted.add(entry);
        this.undeletedBytes += entry.bytes;
      }
      return false;
    }
    if (this.undeleted.delete(entry)) {
      this.undeletedBytes -= entry.bytes;
    }
    this.liveEntries.delete(entry);
    return true;
  }

  /** Disk the pool still owns: what it is reusing, plus what it failed to delete. */
  private liveBytes(): number {
    return this.retainedBytes + this.undeletedBytes;
  }

  private async retryUndeleted(): Promise<void> {
    for (const entry of [...this.undeleted]) {
      if (entry.deleteAttempts < MAX_DELETE_ATTEMPTS) {
        await this.destroy(entry);
      }
    }
  }

  /** Give up ownership of an entry's disk — now if nobody holds it, otherwise at its
   *  last release, which `lease` already handles once `retained` is false. */
  private async discard(entry: Entry): Promise<void> {
    entry.retained = false;
    if (entry.leases === 0) {
      await this.destroy(entry);
    }
  }

  private startSweeping(): void {
    if (this.sweeper || this.disposed || this.idleMs <= 0) {
      return;
    }
    this.sweeper = setInterval(() => {
      void this.evictIdle();
    }, this.idleMs);
    // Never a reason for the host to stay alive.
    this.sweeper.unref?.();
  }

  private stopSweeping(): void {
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = undefined;
    }
  }
}
