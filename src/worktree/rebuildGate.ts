// src/worktree/rebuildGate.ts — When a worktree rebuild is allowed to run.
// See: docs/design/worktree-model.md § 3.5,
//      asimov/changes/cache-and-broadcast-worktree-tree/design.md D4
//
// Two independent limits, neither of which substitutes for the other:
//
//   - The watcher pool's 150 ms debounce collapses a *burst*.
//   - This floor bounds a *sustained* stream, which is the shape an agent
//     working inside a worktree actually produces.
//
// A forced rebuild — the user pressing refresh, or a rebuild that follows a
// mutation we performed — bypasses the floor and resets it.

/** docs/design/worktree-model.md § 3.5 — one rebuild per second per repo. */
export const REBUILD_FLOOR_MS = 1000;

/**
 * Clock and timer seam. Injected so the floor is testable without real waiting,
 * the same shape `createGitCapabilities` uses for `now`.
 */
export interface RebuildGateClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_CLOCK: RebuildGateClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface RebuildRequestOptions {
  /**
   * Run now regardless of the floor. For a refresh the user asked for, and for
   * the rebuild that follows a mutation — both are expected to be immediate.
   */
  force?: boolean;
  /**
   * This came from a filesystem watcher, not from a caller asking for a tree.
   * A signal reports that git state moved, so a rebuild already running cannot
   * answer it — it may have read git before the move (design.md D4).
   */
  signal?: boolean;
}

export interface RebuildGate {
  /**
   * Ask for `scope` to be rebuilt. Resolves when the rebuild that satisfies
   * this request has finished, and rejects with whatever that rebuild threw.
   */
  request(scope: string, options?: RebuildRequestOptions): Promise<void>;
  dispose(): void;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface ScopeState {
  /** The rebuild currently running for this scope, if any. */
  inFlight?: Promise<void>;
  /** When this scope's most recent rebuild started. */
  lastRunAt?: number;
  /** Timer for a rebuild deferred by the floor. */
  timer?: unknown;
  /** Every request waiting on that deferred rebuild. */
  waiting?: Deferred;
  /**
   * Set when a force or a signal arrived while `inFlight` was running. One slot,
   * so any number of them collapse into exactly one further rebuild.
   */
  pending?: Deferred;
  /** Whether that follow-up skips the floor, i.e. at least one force set it. */
  pendingForced?: boolean;
}

/**
 * Serialize and rate-limit rebuilds per scope. A scope is one `repoId`, or the
 * whole-tree scope — the gate never interprets it, so a signal in repo A can
 * never delay or trigger repo B.
 */
export function createRebuildGate(
  run: (scope: string) => Promise<void>,
  clock: RebuildGateClock = REAL_CLOCK,
): RebuildGate {
  const scopes = new Map<string, ScopeState>();
  let disposed = false;

  function stateFor(scope: string): ScopeState {
    let state = scopes.get(scope);
    if (!state) {
      state = {};
      scopes.set(scope, state);
    }
    return state;
  }

  function start(scope: string, state: ScopeState): Promise<void> {
    state.lastRunAt = clock.now();
    const started = (async () => run(scope))().finally(() => {
      if (state.inFlight === started) {
        state.inFlight = undefined;
        drainPending(scope, state);
      }
    });
    state.inFlight = started;
    return started;
  }

  /**
   * Hand whatever arrived mid-rebuild its own rebuild. The follow-up adopts the
   * pending deferred, so a rejection always has a waiter.
   */
  function drainPending(scope: string, state: ScopeState): void {
    const pending = state.pending;
    if (!pending) {
      return;
    }
    state.pending = undefined;
    const forced = state.pendingForced === true;
    state.pendingForced = false;
    if (disposed) {
      // A disposed window is a shutdown, not a rebuild failure — same as dispose().
      pending.resolve();
      return;
    }
    schedule(scope, state, forced).then(pending.resolve, pending.reject);
  }

  /** Fire the rebuild the floor deferred, handing its result to every joiner. */
  function flushDeferred(scope: string, state: ScopeState): void {
    state.timer = undefined;
    const waiting = state.waiting;
    state.waiting = undefined;
    if (!waiting || disposed) {
      return;
    }
    // A rebuild that started while we were waiting satisfies these requests: it
    // began after they arrived, so it reads git after them. That is the whole
    // test — a rebuild already running when a request arrives does not.
    const work = state.inFlight ?? start(scope, state);
    work.then(waiting.resolve, waiting.reject);
  }

  /** Run now, or defer to the remainder of the floor. Never called mid-rebuild. */
  function schedule(scope: string, state: ScopeState, force: boolean): Promise<void> {
    const sinceLast = state.lastRunAt === undefined ? Number.POSITIVE_INFINITY : clock.now() - state.lastRunAt;
    if (force || sinceLast >= REBUILD_FLOOR_MS) {
      if (state.timer !== undefined) {
        // A forced rebuild satisfies whatever the floor was holding back.
        clock.clearTimeout(state.timer);
        state.timer = undefined;
      }
      const waiting = state.waiting;
      state.waiting = undefined;
      const work = start(scope, state);
      if (waiting) {
        work.then(waiting.resolve, waiting.reject);
      }
      return work;
    }

    // Inside the floor: defer to the remainder of the window and collapse every
    // further signal into that one deferred rebuild.
    if (!state.waiting) {
      state.waiting = createDeferred();
      state.timer = clock.setTimeout(() => flushDeferred(scope, state), REBUILD_FLOOR_MS - sinceLast);
    }
    return state.waiting.promise;
  }

  function request(scope: string, options: RebuildRequestOptions = {}): Promise<void> {
    if (disposed) {
      return Promise.resolve();
    }
    const state = stateFor(scope);

    if (state.inFlight) {
      // A plain request is answered by the rebuild already running. A force and a
      // signal are not: the running rebuild may have read git before either
      // arrived, so each earns one further rebuild (design.md D4).
      if (options.force !== true && options.signal !== true) {
        return state.inFlight;
      }
      state.pending ??= createDeferred();
      state.pendingForced = state.pendingForced === true || options.force === true;
      return state.pending.promise;
    }

    return schedule(scope, state, options.force === true);
  }

  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    for (const state of scopes.values()) {
      if (state.timer !== undefined) {
        clock.clearTimeout(state.timer);
        state.timer = undefined;
      }
      // Waiters are resolved, not rejected: a disposed window is a shutdown,
      // not a rebuild failure, and nothing is left to report it to.
      state.waiting?.resolve();
      state.waiting = undefined;
      state.pending?.resolve();
      state.pending = undefined;
    }
    scopes.clear();
  }

  return { request, dispose };
}
