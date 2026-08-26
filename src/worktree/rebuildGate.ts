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
      }
    });
    state.inFlight = started;
    return started;
  }

  /** Fire the rebuild the floor deferred, handing its result to every joiner. */
  function flushDeferred(scope: string, state: ScopeState): void {
    state.timer = undefined;
    const waiting = state.waiting;
    state.waiting = undefined;
    if (!waiting || disposed) {
      return;
    }
    // A rebuild that started while we were waiting satisfies these requests:
    // they asked for a fresh listing, and one is being produced right now.
    const work = state.inFlight ?? start(scope, state);
    work.then(waiting.resolve, waiting.reject);
  }

  function request(scope: string, options: RebuildRequestOptions = {}): Promise<void> {
    if (disposed) {
      return Promise.resolve();
    }
    const state = stateFor(scope);

    // One rebuild at a time per scope. A request arriving mid-rebuild — forced
    // or not — is answered by the rebuild already running: it reads the same
    // git state this request wants.
    if (state.inFlight) {
      return state.inFlight;
    }

    const sinceLast = state.lastRunAt === undefined ? Number.POSITIVE_INFINITY : clock.now() - state.lastRunAt;
    if (options.force || sinceLast >= REBUILD_FLOOR_MS) {
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
    }
    scopes.clear();
  }

  return { request, dispose };
}
