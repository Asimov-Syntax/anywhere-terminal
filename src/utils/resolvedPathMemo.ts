// src/utils/resolvedPathMemo.ts — Where a path really is, resolved once per spelling.
//
// Resolving at each comparison would put a `realpath` on paths that run per presence
// push and per git refresh, so resolution happens once per distinct path and the
// comparison stays lexical (D1).
//
// Caching a resolved path is forbidden in `pathBoundary.ts`'s resolved predicate
// (its D8) and admissible here, because that answer authorizes a file READ and this
// one decides which heading a row appears under (D3).

import * as fsp from "node:fs/promises";
import * as path from "node:path";

export interface ResolvedPathMemoDeps {
  realpath?: (p: string) => Promise<string>;
}

export class ResolvedPathMemo {
  /** Keyed by the LEXICALLY normalized spelling, so `/a/./b` and `/a/b` are one
   *  entry — otherwise the bound is "spellings seen", which nothing limits. */
  private readonly memo = new Map<string, Promise<string>>();
  /** The settled half, for `resolvedOr`'s synchronous read. */
  private readonly settled = new Map<string, string>();
  /** Who still needs each path. The memo is shared, so no single consumer knows
   *  whether an answer is still wanted, and one consumer's bookkeeping deleting
   *  another's fact is round-2 B4 (D6). */
  private readonly holders = new Map<string, Set<symbol>>();
  private readonly realpath: (p: string) => Promise<string>;

  constructor(deps: ResolvedPathMemoDeps = {}) {
    this.realpath = deps.realpath ?? ((p) => fsp.realpath(p));
  }

  /**
   * Where `candidate` really is. Concurrent callers for one path join a single
   * syscall rather than racing several.
   *
   * A path that cannot be resolved answers with its lexical form and is NOT
   * remembered: the common reason to fail here is a worktree that does not exist
   * yet, and caching the fallback would leave it lexical for the window's life
   * because of one syscall taken a moment too early. Retrying is bounded by the
   * same thing the memo is — the set of paths the window actually works with.
   */
  resolve(candidate: string): Promise<string> {
    const key = path.resolve(candidate);
    const known = this.memo.get(key);
    if (known) {
      return known;
    }
    // Both continuations check that this flight is STILL the entry for its key
    // before touching shared state. Without it an `invalidate` taken while a
    // realpath is in the air is undone the moment it lands: the success writes
    // the pre-change location into `settled`, and the failure deletes whatever
    // newer flight replaced it — leaving every consumer answering from facts
    // that were already known to be stale (round-1 B3).
    let pending: Promise<string>;
    const mine = () => this.memo.get(key) === pending;
    pending = this.realpath(key).then(
      (real) => {
        if (mine()) {
          this.settled.set(key, real);
        }
        return real;
      },
      () => {
        if (mine()) {
          this.memo.delete(key);
        }
        return key;
      },
    );
    this.memo.set(key, pending);
    return pending;
  }

  /**
   * Where `candidate` resolved, if that is already known, else its lexical form.
   *
   * The fallback is the same one `resolve` gives a path that will not resolve, so
   * a site that never prepared behaves exactly as it did before this memo existed
   * rather than losing its answer. Synchronous on purpose: the comparison it feeds
   * runs per presence push, and awaiting there is the cost D1 refuses.
   */
  resolvedOr(candidate: string): string {
    const key = path.resolve(candidate);
    return this.settled.get(key) ?? key;
  }

  /**
   * Resolve `candidate` and record that `owner` needs it.
   *
   * A claim is not a second cache: it decides only WHEN an entry may go, which
   * D6 separates from D4's question of when an answer is wrong.
   */
  claim(owner: symbol, candidate: string): Promise<string> {
    const key = path.resolve(candidate);
    const held = this.holders.get(key);
    if (held) {
      held.add(owner);
    } else {
      this.holders.set(key, new Set([owner]));
    }
    return this.resolve(candidate);
  }

  /**
   * `owner` no longer needs `candidate`. The entry goes only when the last
   * claimant lets go — a pane closing says one consumer stopped asking, never
   * that the directory moved.
   */
  release(owner: symbol, candidate: string): void {
    const key = path.resolve(candidate);
    const held = this.holders.get(key);
    if (held === undefined) {
      return;
    }
    held.delete(owner);
    if (held.size === 0) {
      this.holders.delete(key);
      this.invalidate(candidate);
    }
  }

  /** Forget one path, because the thing that produced it changed. Claims are
   *  untouched: a stale answer is still an answer someone wants. */
  invalidate(candidate: string): void {
    const key = path.resolve(candidate);
    this.memo.delete(key);
    this.settled.delete(key);
  }

  /** Forget everything, for a structural change that can move any of it — the
   *  worktree set, the workspace folders, the Git API's repositories. */
  invalidateAll(): void {
    this.memo.clear();
    this.settled.clear();
  }

  /** Entries held. The growth axis is distinct paths, never comparisons. */
  get size(): number {
    return this.memo.size;
  }
}

/**
 * A bounded set of paths, resolved together and re-read when the set changes.
 *
 * Two sites need exactly this and would otherwise each grow their own copy:
 * repository discovery over the git API's open repositories, and the decoration
 * provider over the workspace folders. Both are producer-bounded, both compare
 * synchronously afterwards, and both need the SAME structural invalidation —
 * a path leaving the set means a directory was closed, and one opened at that
 * spelling later can resolve somewhere else entirely (D4).
 */
export interface TrackedPathResolver {
  /**
   * Resolve `pinned` and `tracked`, forgetting every tracked path that was in
   * the previous call and is not in this one. `pinned` is never released: it
   * is the caller's own standing set, and pruning it would re-resolve on every
   * pass — the syscall-per-comparison D1 forbids.
   */
  prepare(pinned: readonly string[], tracked: readonly string[]): Promise<void>;
  /** Where `p` resolved, or its lexical form when nothing prepared it. */
  resolvedOr(p: string): string;
}

/** The parts of {@link ResolvedPathMemo} a {@link TrackedPathResolver} needs. */
export type TrackablePathMemo = Pick<ResolvedPathMemo, "claim" | "release" | "resolvedOr">;

/**
 * Each resolver is a claimant. The identity is what lets a shared memo tell
 * "this consumer stopped needing the path" from "the path is stale" — the
 * distinction round-2 B4 turned on (D6).
 */
export function createTrackedPathResolver(memo: TrackablePathMemo): TrackedPathResolver {
  const owner = Symbol("tracked-paths");
  let last: readonly string[] = [];
  return {
    async prepare(pinned, tracked) {
      const held = new Set(tracked);
      for (const gone of last) {
        if (!held.has(gone)) {
          memo.release(owner, gone);
        }
      }
      last = [...tracked];
      await Promise.all([...pinned, ...tracked].map((p) => memo.claim(owner, p)));
    },
    resolvedOr: (p) => memo.resolvedOr(p),
  };
}
