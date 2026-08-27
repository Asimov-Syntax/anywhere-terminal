// src/utils/keyedSerialQueue.ts — Run work one-at-a-time per key, concurrently
// across keys. Extracted from src/worktree/mutationQueue.ts, which keeps its
// depth/busy accounting on top of this (install-claude-hooks round-4 S4).
//
// Deliberately not a coalescing gate: two enqueued bodies must BOTH run, in
// order. Coalescing them would silently drop one.

export interface KeyedSerialQueue {
  /** Run `body` once this key's earlier work has settled. */
  run<T>(key: string, body: () => Promise<T>): Promise<T>;
}

export interface KeyedSerialQueueHooks {
  /** Called when work is ENQUEUED, not when it starts — queued work is still owed. */
  onEnter?: (key: string) => void;
  /** Called once that work has settled. */
  onLeave?: (key: string) => void;
}

export function createKeyedSerialQueue(hooks: KeyedSerialQueueHooks = {}): KeyedSerialQueue {
  const tails = new Map<string, Promise<unknown>>();

  return {
    run<T>(key: string, body: () => Promise<T>): Promise<T> {
      hooks.onEnter?.(key);
      const previous = tails.get(key);
      // Wait for the predecessor to SETTLE, not to succeed — a failure is the
      // common case, and inheriting it would fail work that has not run yet.
      const after = previous ? previous.then(noop, noop) : Promise.resolve();
      // `body` is passed in UNCALLED so a synchronous throw happens inside the
      // try below; invoking it as an argument would skip the release entirely.
      const started = after.then(() => run(body, () => hooks.onLeave?.(key)));
      const tail = started.then(noop, noop).finally(() => {
        // Only the current tail clears the entry, or a slow predecessor would
        // delete a successor's and let the next caller skip the queue.
        if (tails.get(key) === tail) {
          tails.delete(key);
        }
      });
      tails.set(key, tail);
      return started;
    },
  };
}

/** `Promise.finally` without adding a tick between the callback and the result. */
async function run<T>(body: () => Promise<T>, release: () => void): Promise<T> {
  try {
    return await body();
  } finally {
    release();
  }
}

function noop(): void {}
