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
    const pending = this.realpath(key).catch(() => {
      this.memo.delete(key);
      return key;
    });
    this.memo.set(key, pending);
    return pending;
  }

  /** Forget one path, because the thing that produced it changed. */
  invalidate(candidate: string): void {
    this.memo.delete(path.resolve(candidate));
  }

  /** Forget everything, for a structural change that can move any of it — the
   *  worktree set, the workspace folders, the Git API's repositories. */
  invalidateAll(): void {
    this.memo.clear();
  }

  /** Entries held. The growth axis is distinct paths, never comparisons. */
  get size(): number {
    return this.memo.size;
  }
}
