// src/vault/storeStamp.ts — Cheap (mtimeMs,size) freshness stamps for SQLite-backed
// stores, shared by the Codex + OpenCode incremental readers (cache-vault-load D3).
//
// Stamping the `.db` (+ `-wal`) lets a refresh skip the expensive snapshot clone +
// query when the store is byte-for-byte unchanged. We deliberately do NOT stamp
// `-shm`: it is volatile wal-index/lock state, not durable content, and would cause
// false invalidations (oracle review). A WAL write changes the `-wal` mtime even
// when it reuses the file at the same size, so `.db`+`-wal` is sufficient.

import * as fs from "node:fs/promises";
import { provesAbsence } from "../utils/fsPresence";
import type { FileStamp } from "./cacheTypes";

/** Stat each path into a `(mtimeMs,size)` stamp; silently omit any that don't exist
 *  (e.g. a checkpointed store with no `-wal`). */
export async function stampStoreFiles(paths: string[]): Promise<Record<string, FileStamp>> {
  const out: Record<string, FileStamp> = {};
  for (const p of paths) {
    try {
      const s = await fs.stat(p);
      out[p] = { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      // Missing file → omit from the stamp set.
    }
  }
  return out;
}

/** True iff two stamp sets cover the same paths with identical `(mtimeMs,size)`. */
export function sameStamps(a: Record<string, FileStamp>, b: Record<string, FileStamp>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) {
    return false;
  }
  for (const k of aKeys) {
    const av = a[k];
    const bv = b[k];
    if (!bv || av.mtimeMs !== bv.mtimeMs || av.size !== bv.size) {
      return false;
    }
  }
  return true;
}

/** The files whose `(mtimeMs,size)` define a store's freshness. One owner, so the
 *  snapshot pool's reuse gate and the persisted list cache cannot answer the same
 *  question from separately-authored path sets. */
export function storeFilePaths(dbPath: string): string[] {
  return [dbPath, `${dbPath}-wal`];
}

/** A store's generation, and whether it was established well enough to act on. */
export interface StoreGeneration {
  stamps: Record<string, FileStamp>;
  usable: boolean;
}

/** One pass: stat each path in order, and refuse to call the result usable when a
 *  path's state could not be determined. Only ENOENT/ENOTDIR read as "not there" —
 *  an EACCES on the `-wal` must never read as a WAL-free store. */
/** Just enough of `fs.stat` to build a stamp. Injectable so a test can act BETWEEN
 *  two real stats — the only way to drive the interleaving this read exists to
 *  survive, rather than arguing that it does. */
export type StatFn = (p: string) => Promise<{ mtimeMs: number; size: number }>;

async function readOnce(paths: string[], stat: StatFn): Promise<StoreGeneration> {
  const stamps: Record<string, FileStamp> = {};
  let usable = true;
  for (const p of paths) {
    try {
      const s = await stat(p);
      stamps[p] = { mtimeMs: s.mtimeMs, size: s.size };
    } catch (err) {
      if (!provesAbsence(err)) {
        usable = false;
      }
    }
  }
  return { stamps, usable };
}

/**
 * Read a store's generation coherently. Two complete passes in the same order, equal
 * or unusable: a single pass stats the `.db` and the `-wal` at two different instants,
 * so a checkpoint that lands between them can leave the two halves describing states
 * that never coexisted — equal to an older generation across a completed write.
 *
 * Two ordered passes cannot be fooled that way: the failing interleaving needs both
 * `.db` reads before the checkpoint and both `-wal` reads after it, but the second
 * `.db` read comes after the first `-wal` read and would observe the checkpoint.
 */
export async function readStoreGeneration(dbPath: string, stat: StatFn = (p) => fs.stat(p)): Promise<StoreGeneration> {
  const paths = storeFilePaths(dbPath);
  const first = await readOnce(paths, stat);
  const second = await readOnce(paths, stat);
  const agreed = first.usable && second.usable && sameStamps(first.stamps, second.stamps);
  // A generation that does not cover the database file proves nothing about it.
  const usable = agreed && second.stamps[dbPath] !== undefined;
  return { stamps: second.stamps, usable };
}
