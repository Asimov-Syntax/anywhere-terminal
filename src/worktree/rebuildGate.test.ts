import { describe, expect, it, vi } from "vitest";
import { createRebuildGate, REBUILD_FLOOR_MS, type RebuildGateClock } from "./rebuildGate";

/**
 * Driver-controlled clock + timer queue. The floor is a wall-clock rule, and a
 * test that waited on real time would take seconds per assertion and flake on a
 * loaded machine — so both are injected, per design.md D4.
 */
function makeClock(): RebuildGateClock & { advance(ms: number): void; pending(): number } {
  let current = 1_000_000;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();

  return {
    now: () => current,
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: current + ms, fn });
      return id;
    },
    clearTimeout: (handle: unknown) => {
      timers.delete(handle as number);
    },
    pending: () => timers.size,
    advance(ms: number) {
      current += ms;
      for (const [id, timer] of [...timers.entries()]) {
        if (timer.at <= current) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
  };
}

/** Settle every already-resolved microtask without advancing the fake clock. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("rebuildGate", () => {
  it("runs the first request for a scope immediately", async () => {
    const clock = makeClock();
    const run = vi.fn(async () => {});
    const gate = createRebuildGate(run, clock);

    await gate.request("repo-a");

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("repo-a");
  });

  it("collapses a sustained signal stream to one rebuild per floor window", async () => {
    const clock = makeClock();
    const run = vi.fn(async () => {});
    const gate = createRebuildGate(run, clock);

    await gate.request("repo-a");
    expect(run).toHaveBeenCalledTimes(1);

    // An agent writing inside the worktree produces signals far faster than the
    // floor; every one of them must land in the same deferred rebuild.
    for (let i = 0; i < 20; i++) {
      void gate.request("repo-a");
      clock.advance(10);
    }
    await flush();
    expect(run).toHaveBeenCalledTimes(1);

    clock.advance(REBUILD_FLOOR_MS);
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not delay a forced request behind the floor", async () => {
    const clock = makeClock();
    const run = vi.fn(async () => {});
    const gate = createRebuildGate(run, clock);

    await gate.request("repo-a");
    clock.advance(10);

    await gate.request("repo-a", { force: true });

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("resets the floor from a forced rebuild", async () => {
    const clock = makeClock();
    const run = vi.fn(async () => {});
    const gate = createRebuildGate(run, clock);

    await gate.request("repo-a", { force: true });
    clock.advance(10);
    void gate.request("repo-a");
    await flush();

    expect(run).toHaveBeenCalledTimes(1);
  });

  /** A blocking run whose completion the test controls. */
  function heldRun() {
    let release: (() => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    return { run, release: () => release?.() };
  }

  it("coalesces plain requests arriving while a rebuild for that scope is in flight", async () => {
    const clock = makeClock();
    const { run, release } = heldRun();
    const gate = createRebuildGate(run, clock);

    const first = gate.request("repo-a");
    const second = gate.request("repo-a");
    await flush();

    expect(run).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    // worktree-tree-protocol: concurrent requests without force produce one rebuild.
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("rebuilds again for a forced request that arrived mid-rebuild", async () => {
    const clock = makeClock();
    const { run, release } = heldRun();
    const gate = createRebuildGate(run, clock);

    const first = gate.request("repo-a");
    await flush();
    const forced = gate.request("repo-a", { force: true });
    await flush();
    // The running rebuild may already have read git, so it cannot answer a force.
    expect(run).toHaveBeenCalledTimes(1);

    release();
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    release();
    await Promise.all([first, forced]);
  });

  it("rebuilds again for a signal that arrived mid-rebuild, once the floor allows", async () => {
    const clock = makeClock();
    const { run, release } = heldRun();
    const gate = createRebuildGate(run, clock);

    const first = gate.request("repo-a", { signal: true });
    await flush();
    void gate.request("repo-a", { signal: true });
    void gate.request("repo-a", { signal: true });
    await flush();
    expect(run).toHaveBeenCalledTimes(1);

    release();
    await flush();
    // Still floored — the follow-up is scheduled, not run.
    expect(run).toHaveBeenCalledTimes(1);

    clock.advance(REBUILD_FLOOR_MS);
    await flush();
    // Two signals during one rebuild collapse into exactly one further rebuild.
    expect(run).toHaveBeenCalledTimes(2);
    release();
    await first;
  });

  it("keeps scopes independent — a signal for one repo does not rebuild another", async () => {
    const clock = makeClock();
    const run = vi.fn(async (_scope: string) => {});
    const gate = createRebuildGate(run, clock);

    await gate.request("repo-a");
    await gate.request("repo-b");

    expect(run.mock.calls.map(([scope]) => scope)).toEqual(["repo-a", "repo-b"]);

    // repo-a is inside its floor; repo-b's floor is its own and untouched.
    clock.advance(10);
    void gate.request("repo-a");
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("surfaces a failing rebuild to its callers and still allows the next one", async () => {
    const clock = makeClock();
    const run = vi
      .fn<(scope: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("git exploded"))
      .mockResolvedValue(undefined);
    const gate = createRebuildGate(run, clock);

    await expect(gate.request("repo-a")).rejects.toThrow("git exploded");

    await gate.request("repo-a", { force: true });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("delivers the deferred result to every request that joined it", async () => {
    const clock = makeClock();
    const run = vi.fn(async () => {});
    const gate = createRebuildGate(run, clock);

    await gate.request("repo-a");
    clock.advance(10);
    const joined = [gate.request("repo-a"), gate.request("repo-a"), gate.request("repo-a")];

    clock.advance(REBUILD_FLOOR_MS);
    await Promise.all(joined);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("drops pending deferred work on dispose", async () => {
    const clock = makeClock();
    const run = vi.fn(async () => {});
    const gate = createRebuildGate(run, clock);

    await gate.request("repo-a");
    clock.advance(10);
    void gate.request("repo-a");
    expect(clock.pending()).toBe(1);

    gate.dispose();
    expect(clock.pending()).toBe(0);

    clock.advance(REBUILD_FLOOR_MS);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
