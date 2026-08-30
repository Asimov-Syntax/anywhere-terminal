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
}

interface Entry {
  dir: string;
  file: string;
  stamp: Stamp;
}

const SNAPSHOT_FILE = "db.sqlite";

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
  private readonly stamp: (paths: string[]) => Promise<Stamp>;

  constructor(private readonly deps: SnapshotPoolDeps) {
    this.stamp = deps.stamp ?? stampStoreFiles;
  }

  /**
   * Hand back a snapshot of `dbPath`, taking a new one via `produce` only when the
   * store has changed since the retained snapshot was taken. `produce` throws on
   * failure and the throw propagates — a snapshot that could not be taken must never
   * be mistaken for a store that is empty.
   */
  async borrow(dbPath: string, produce: (dest: string) => Promise<void>): Promise<SnapshotLease> {
    const before = await this.stamp(storePaths(dbPath));
    const hit = this.retained.get(dbPath);
    if (hit && stampable(before, dbPath) && sameStamps(before, hit.stamp)) {
      return this.lease(hit, false);
    }

    const dir = await this.deps.mkdtemp();
    const entry: Entry = { dir, file: path.join(dir, SNAPSHOT_FILE), stamp: before };
    try {
      await produce(entry.file);
    } catch (err) {
      await this.deps.rmrf(dir).catch(() => {});
      throw err;
    }

    // Retain only a snapshot attributable to one store state (D2). A snapshot taken
    // across a write is still atomic and still correct for THIS caller, but it belongs
    // to neither stamp — retaining it under the earlier one would be a lie the next
    // reader believes.
    const after = await this.stamp(storePaths(dbPath));
    const stable = stampable(before, dbPath) && sameStamps(before, after);
    if (stable) {
      const superseded = this.retained.get(dbPath);
      this.retained.set(dbPath, { ...entry, stamp: after });
      if (superseded) {
        await this.deps.rmrf(superseded.dir).catch(() => {});
      }
    }
    return this.lease(entry, !stable);
  }

  private lease(entry: Entry, disposeOnRelease: boolean): SnapshotLease {
    let released = false;
    return {
      file: entry.file,
      release: async () => {
        if (released) {
          return;
        }
        released = true;
        if (disposeOnRelease) {
          await this.deps.rmrf(entry.dir).catch(() => {});
        }
      },
    };
  }
}
