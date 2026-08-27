// src/worktree/mutationQueue.ts — Per-repository serialization for MUTATING
// worktree actions (design.md D1).
//
// Deliberately not `rebuildGate`. The gate coalesces concurrent requests, which
// is right for rebuilds — two callers wanting a fresh tree want the same tree —
// and wrong here: two removals must both run, in order, or the second must be
// told the first happened. Coalescing them would silently drop one.

export interface MutationQueue {
  /** Run `body` once this repo's earlier mutations have settled. */
  run<T>(repoId: string, body: () => Promise<T>): Promise<T>;
  /** Whether this repo has a mutation queued or in flight. */
  isBusy(repoId: string): boolean;
}

export function createMutationQueue(): MutationQueue {
  const tails = new Map<string, Promise<unknown>>();
  const depth = new Map<string, number>();

  function bump(repoId: string, by: number): void {
    const next = (depth.get(repoId) ?? 0) + by;
    if (next > 0) {
      depth.set(repoId, next);
    } else {
      depth.delete(repoId);
    }
  }

  return {
    run<T>(repoId: string, body: () => Promise<T>): Promise<T> {
      // Counted here rather than when the body starts: work that is merely
      // queued is still work this repo owes, and a quarantine decision that
      // could not see it would let a caller act as though the repo were idle.
      bump(repoId, 1);
      const previous = tails.get(repoId);
      // Wait for the predecessor to SETTLE, not to succeed — a git refusal is
      // the common case, and inheriting it would fail an action that has not
      // run yet.
      const after = previous ? previous.then(noop, noop) : Promise.resolve();
      // The decrement is attached to the body, so it has already happened by
      // the time the caller's own `await` resolves. `body` is passed in
      // UNCALLED so that a synchronous throw happens inside the try — invoking
      // it as an argument would skip the release entirely and pin the repo busy
      // for the host's lifetime (round-1 W1).
      const started = after.then(() => finallyDecrement(body, () => bump(repoId, -1)));
      const tail = started.then(noop, noop).finally(() => {
        if (tails.get(repoId) === tail) {
          tails.delete(repoId);
        }
      });
      tails.set(repoId, tail);
      return started;
    },

    isBusy(repoId: string): boolean {
      return depth.has(repoId);
    },
  };
}

/** `Promise.finally` without adding a tick between the callback and the result. */
async function finallyDecrement<T>(work: () => Promise<T>, release: () => void): Promise<T> {
  try {
    return await work();
  } finally {
    release();
  }
}

function noop(): void {}
