// src/worktree/deadline.ts — one owner for "stop waiting at time T".
//
// Extracted on round-4 W4, which found two copies of this primitive in the same
// subsystem. The finding's real point is the one W2 demonstrated in the same
// round: deadline semantics with two owners drift, and one copy was already
// subtly wrong about what its comparison admitted.

/** A pending deadline, and the means to stop it holding a timer. */
export interface Deadline {
  /** Resolves once the deadline has passed. Never rejects. */
  elapsed: Promise<void>;
  /**
   * Whether the deadline has passed, readable WITHOUT awaiting anything.
   *
   * A deadline observable only through `elapsed` cannot be consulted by
   * synchronous work: a `.then` watcher has not run yet at the first step of a
   * loop that starts in the same tick, so an ALREADY-spent deadline lets that
   * first step through (round-1 F002). Derived from the wall clock rather than
   * set by the timer callback, so it is true the instant it is true.
   */
  readonly expired: boolean;
  /** Idempotent. Safe to call after `elapsed` has already resolved. */
  cancel(): void;
}

/**
 * A deadline that can be raced against work holding no cancellation of its own.
 *
 * `unref`'d, because a deadline still pending must never hold the extension
 * host open — and on the far more common path the work wins and the timer is
 * cancelled unfired.
 */
export function afterDelay(ms: number): Deadline {
  const at = Date.now() + ms;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const elapsed = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
  return {
    elapsed,
    get expired() {
      return Date.now() >= at;
    },
    cancel: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}
