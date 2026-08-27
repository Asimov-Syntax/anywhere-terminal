// src/worktree/mutationQueue.ts — Per-repository serialization for MUTATING
// worktree actions (design.md D1). The serialization itself lives in
// src/utils/keyedSerialQueue.ts; what is repo-specific is the depth accounting
// `isBusy` reports.

import { createKeyedSerialQueue } from "../utils/keyedSerialQueue";

export interface MutationQueue {
  /** Run `body` once this repo's earlier mutations have settled. */
  run<T>(repoId: string, body: () => Promise<T>): Promise<T>;
  /** Whether this repo has a mutation queued or in flight. */
  isBusy(repoId: string): boolean;
}

export function createMutationQueue(): MutationQueue {
  const depth = new Map<string, number>();

  function bump(repoId: string, by: number): void {
    const next = (depth.get(repoId) ?? 0) + by;
    if (next > 0) {
      depth.set(repoId, next);
    } else {
      depth.delete(repoId);
    }
  }

  // Counted on enqueue rather than on start: work that is merely queued is
  // still work this repo owes, and a quarantine decision that could not see it
  // would let a caller act as though the repo were idle.
  const queue = createKeyedSerialQueue({
    onEnter: (repoId) => bump(repoId, 1),
    onLeave: (repoId) => bump(repoId, -1),
  });

  return {
    run: (repoId, body) => queue.run(repoId, body),
    isBusy: (repoId) => depth.has(repoId),
  };
}
