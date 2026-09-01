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
   * first step through (round-1 F002). So it is true the instant the clock says
   * so, with nothing drained first.
   *
   * It is ALSO true once `elapsed` has resolved, which the wall clock alone did
   * not give: the timer and `Date.now()` are two clocks and a timer may fire a
   * millisecond early against the other, so awaiting the wait this deadline
   * handed out and then reading it answered "not yet" (WT-011.11). Reading
   * latches, because `Date.now()` can step backwards and a caller polling a
   * budget must never be told it came back.
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
  // ONE normalized delay, and both clocks derive from it. Node clamps a
  // negative, non-finite or out-of-range delay to 1ms while plain arithmetic on
  // `ms` would put `at` days away or nowhere at all, so handing the two clocks
  // the raw number makes them disagree by more than any scheduling margin.
  const delay = Number.isFinite(ms) ? Math.min(Math.max(Math.trunc(ms), 0), 2_147_483_647) : 0;
  const at = Date.now() + delay;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Set in the callback, in the same job that resolves `elapsed`, so it is
  // already true for every reaction to that promise.
  let fired = false;
  // Latched: `expired` must not retract, and the wall-clock arm can.
  let latched = false;
  const elapsed = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      fired = true;
      resolve();
    }, delay);
    timer.unref?.();
  });
  return {
    elapsed,
    get expired() {
      latched ||= fired || Date.now() >= at;
      return latched;
    },
    cancel: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}
