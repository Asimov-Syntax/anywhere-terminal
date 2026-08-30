// src/vault/snapshotPool.ts — Reuse a snapshot while its store is provably unchanged.
//
// An engine snapshot copies every live page (~950ms for a 522MB store), and a store
// nobody wrote to yields byte-identical answers. So the file is kept and handed out
// again while the `(mtimeMs,size)` stamp over the `.db` and its `-wal` is unchanged:
// any commit rewrites the `-wal` mtime, any checkpoint rewrites the `.db`, so an
// equal stamp means no write landed (D1). Proven sameness, never elapsed time — that
// is what makes reuse safe for reporting a session ABSENT, which a TTL could not be.

import * as path from "node:path";
import type { FileStamp } from "./cacheTypes";
import { readStoreGeneration, type StoreGeneration, sameStamps } from "./storeStamp";

type Stamp = Record<string, FileStamp>;

/** A borrowed snapshot. `release` gives it back; the pool owns the file. */
export interface SnapshotLease {
  readonly file: string;
  release(): Promise<void>;
}

export interface BorrowOptions {
  /** Keep the snapshot for the next reader of this store. Opt-in, and only for a
   *  store an agent has exactly one of — that is what bounds the retained set (D3). */
  retain?: boolean;
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
}

/** A production in progress, tagged with the store generation it started from. */
interface Flight {
  stamp: Stamp;
  promise: Promise<Produced>;
}

/** A finished production: the entry, plus the lease its own producer already holds.
 *  Publication and leasing happen together, so an entry is never visible to the pool
 *  in a state where nobody holds it (round-4 B7). */
interface Produced {
  entry: Entry;
  lease: SnapshotLease;
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
  deleteAttempts: number;
}

const SNAPSHOT_FILE = "db.sqlite";
const DEFAULT_IDLE_MS = 60_000;
/** How many times a caller will wait out someone else's snapshot before taking its
 *  own. Bounded so a continuously-written store cannot starve a reader. */
const MAX_JOIN_WAITS = 2;
/** How many times a stubborn directory is retried before the pool stops trying on
 *  every admission. It stays owned either way. */
const MAX_DELETE_ATTEMPTS = 5;

export class SnapshotPool {
  /** Keyed by store path, and only stores whose readers opted into retention are ever
   *  keys. Those are the one-per-agent primary stores — a fixed set computed from
   *  fixed locations — so the map is bounded by what can be a key rather than by an
   *  eviction policy that has to stay correct under concurrency (D3). */
  private readonly retained = new Map<string, Entry>();
  /** One production per store. Concurrent readers join it rather than each running
   *  their own backup — vault list, detail and lookup routinely fire together. */
  private readonly inFlight = new Map<string, Flight>();
  private readonly readGeneration: (dbPath: string) => Promise<StoreGeneration>;
  private readonly idleMs: number;
  private readonly now: () => number;
  /** Snapshots whose deletion failed: still owned and still on disk, so the sweeper
   *  keeps running while any of them is retry-eligible (round-4 W7). */
  private readonly undeleted = new Set<Entry>();
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
  }

  /**
   * Hand back a snapshot of `dbPath`, taking a new one via `produce` only when the
   * store has changed since the retained snapshot was taken. `produce` throws on
   * failure and the throw propagates — a snapshot that could not be taken must never
   * be mistaken for a store that is empty.
   */
  async borrow(
    dbPath: string,
    produce: (dest: string) => Promise<void>,
    options: BorrowOptions = {},
  ): Promise<SnapshotLease> {
    if (this.disposed) {
      throw new Error("snapshot pool is disposed");
    }
    this.admitted += 1;
    try {
      return await this.borrowAdmitted(dbPath, produce, options.retain === true);
    } finally {
      this.admitted -= 1;
      this.wakeIfQuiet();
    }
  }

  private async borrowAdmitted(
    dbPath: string,
    produce: (dest: string) => Promise<void>,
    retain: boolean,
  ): Promise<SnapshotLease> {
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
          return this.lease((await joined.promise).entry);
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

      const flight: Flight = { stamp: before.stamps, promise: this.produce(dbPath, before, produce, retain) };
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
      return (await flight.promise).lease;
    }
  }

  private async produce(
    dbPath: string,
    before: StoreGeneration,
    take: (dest: string) => Promise<void>,
    retain: boolean,
  ): Promise<Produced> {
    const dir = await this.deps.mkdtemp();
    const entry: Entry = {
      dir,
      file: path.join(dir, SNAPSHOT_FILE),
      stamp: before.stamps,
      leases: 0,
      retained: false,
      lastUsed: this.now(),
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
    const stable = retain && !this.disposed && before.usable && after.usable && sameStamps(before.stamps, after.stamps);

    // The producer's own lease is taken BEFORE publication and nothing suspends in
    // between, so no other caller can observe this entry, supersede it, and delete it
    // in the window before its reader holds it (round-4 B7).
    const lease = this.lease(entry);
    let superseded: Entry | undefined;
    if (stable) {
      superseded = this.retained.get(dbPath);
      entry.stamp = after.stamps;
      entry.lastUsed = this.now();
      entry.retained = true;
      this.retained.set(dbPath, entry);
      this.startSweeping();
    }
    if (superseded) {
      await this.discard(superseded);
    }
    // Retried here rather than only on the timer: an admission is when new disk was
    // just claimed, so it is the moment stale disk is most worth reclaiming.
    await this.retryUndeleted();
    return { entry, lease };
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
        await this.discard(entry);
      }
    }
    if (!this.hasSweepableWork()) {
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
      this.undeleted.add(entry);
      this.startSweeping();
      return false;
    }
    this.undeleted.delete(entry);
    this.liveEntries.delete(entry);
    return true;
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

  /** Whether the sweeper still has anything to do: snapshots to age out, or disk it
   *  failed to release and may yet retry. Stopping on an empty retained map alone
   *  would abandon an undeleted directory to the next admission that never comes. */
  private hasSweepableWork(): boolean {
    if (this.retained.size > 0) {
      return true;
    }
    for (const entry of this.undeleted) {
      if (entry.deleteAttempts < MAX_DELETE_ATTEMPTS) {
        return true;
      }
    }
    return false;
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
