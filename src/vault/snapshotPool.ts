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
import { sameStamps, stampStoreFiles } from "./storeStamp";

type Stamp = Record<string, FileStamp>;

/** A borrowed snapshot. `release` gives it back; the pool owns the file. */
export interface SnapshotLease {
  readonly file: string;
  release(): Promise<void>;
}

export interface SnapshotPoolDeps {
  mkdtemp(): Promise<string>;
  rmrf(dir: string): Promise<void>;
  /** Freshness stamp for the store's files. Defaults to the shipped `stampStoreFiles`. */
  stamp?(paths: string[]): Promise<Stamp>;
  /** How long a retained snapshot may go unused before its disk is released.
   *  Correctness never depends on this — reuse is gated on the stamp (D1); this
   *  only stops an idle window holding a gigabyte of temp files (D3). */
  idleMs?: number;
  now?(): number;
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
}

const SNAPSHOT_FILE = "db.sqlite";
const DEFAULT_IDLE_MS = 60_000;
/** How many times a caller will wait out someone else's snapshot before taking its
 *  own. Bounded so a continuously-written store cannot starve a reader. */
const MAX_JOIN_WAITS = 2;

/** `-shm` is deliberately absent: volatile wal-index state, see `storeStamp.ts`. */
function storePaths(dbPath: string): string[] {
  return [dbPath, `${dbPath}-wal`];
}

/** A stamp that does not cover the database file itself proves nothing — the `stat`
 *  failed, or the store is gone — so it can neither justify reuse nor be retained. */
function stampable(stamp: Stamp, dbPath: string): boolean {
  return stamp[dbPath] !== undefined;
}

export class SnapshotPool {
  private readonly retained = new Map<string, Entry>();
  /** One production per store. Concurrent readers join it rather than each running
   *  their own backup — vault list, detail and lookup routinely fire together. */
  private readonly inFlight = new Map<string, Flight>();
  private readonly stamp: (paths: string[]) => Promise<Stamp>;
  private readonly idleMs: number;
  private readonly now: () => number;
  private sweeper: ReturnType<typeof setInterval> | undefined;
  private disposed = false;

  constructor(private readonly deps: SnapshotPoolDeps) {
    this.stamp = deps.stamp ?? stampStoreFiles;
    this.idleMs = deps.idleMs ?? DEFAULT_IDLE_MS;
    this.now = deps.now ?? Date.now;
  }

  /**
   * Hand back a snapshot of `dbPath`, taking a new one via `produce` only when the
   * store has changed since the retained snapshot was taken. `produce` throws on
   * failure and the throw propagates — a snapshot that could not be taken must never
   * be mistaken for a store that is empty.
   */
  async borrow(dbPath: string, produce: (dest: string) => Promise<void>): Promise<SnapshotLease> {
    for (let waits = 0; ; waits++) {
      const before = await this.stamp(storePaths(dbPath));
      const hit = this.retained.get(dbPath);
      if (hit && stampable(before, dbPath) && sameStamps(before, hit.stamp)) {
        return this.lease(hit);
      }

      const joined = this.inFlight.get(dbPath);
      if (joined) {
        // Joining is gated on the same stamp that gates reuse: a caller that has
        // already observed a newer store must not be handed a snapshot taken before
        // that write, which would be a false `absent` by a different door (D4).
        if (stampable(before, dbPath) && sameStamps(before, joined.stamp)) {
          return this.lease(await joined.promise);
        }
        if (waits < MAX_JOIN_WAITS) {
          await joined.promise.catch(() => {});
          continue;
        }
      }

      const flight: Flight = { stamp: before, promise: this.produce(dbPath, before, produce) };
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

  private async produce(dbPath: string, before: Stamp, take: (dest: string) => Promise<void>): Promise<Entry> {
    const dir = await this.deps.mkdtemp();
    const entry: Entry = {
      dir,
      file: path.join(dir, SNAPSHOT_FILE),
      stamp: before,
      leases: 0,
      retained: false,
      lastUsed: this.now(),
    };
    try {
      await take(entry.file);
    } catch (err) {
      await this.deps.rmrf(dir).catch(() => {});
      throw err;
    }

    // Retain only a snapshot attributable to one store state (D2). A snapshot taken
    // across a write is still atomic and still correct for THIS caller, but it belongs
    // to neither stamp — retaining it under the earlier one would be a lie the next
    // reader believes.
    const after = await this.stamp(storePaths(dbPath));
    if (stampable(before, dbPath) && sameStamps(before, after)) {
      const superseded = this.retained.get(dbPath);
      entry.stamp = after;
      entry.retained = true;
      entry.lastUsed = this.now();
      this.retained.set(dbPath, entry);
      this.startSweeping();
      if (superseded) {
        // Never deleted underneath a reader: a superseded entry still being read is
        // released by its last lease instead (D3).
        await this.discard(superseded);
      }
    }
    return entry;
  }

  private lease(entry: Entry): SnapshotLease {
    entry.leases += 1;
    entry.lastUsed = this.now();
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
        if (entry.leases === 0 && !entry.retained) {
          await this.deps.rmrf(entry.dir).catch(() => {});
        }
      },
    };
  }

  /** Release the disk of every retained snapshot no reader has touched for `idleMs`. */
  async evictIdle(): Promise<void> {
    const cutoff = this.now() - this.idleMs;
    for (const [dbPath, entry] of [...this.retained]) {
      if (entry.leases === 0 && entry.lastUsed <= cutoff) {
        this.retained.delete(dbPath);
        await this.discard(entry);
      }
    }
    if (this.retained.size === 0) {
      this.stopSweeping();
    }
  }

  /** Extension shutdown: no retained snapshot outlives the process that made it. */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.stopSweeping();
    const entries = [...this.retained.values()];
    this.retained.clear();
    for (const entry of entries) {
      await this.discard(entry);
    }
  }

  /** Give up ownership of an entry's disk — now if nobody holds it, otherwise at its
   *  last release, which `lease` already handles once `retained` is false. */
  private async discard(entry: Entry): Promise<void> {
    entry.retained = false;
    if (entry.leases === 0) {
      await this.deps.rmrf(entry.dir).catch(() => {});
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
