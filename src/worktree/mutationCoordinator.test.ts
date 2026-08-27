import { describe, expect, it, vi } from "vitest";
import { createMutationCoordinator } from "./mutationCoordinator";
import { createMutationQueue } from "./mutationQueue";

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A gate stand-in that records its calls and can be held open. */
function fakeGate() {
  const calls: { scope: string; force: boolean | undefined }[] = [];
  let hold: Promise<void> | undefined;
  return {
    calls,
    holdWith(p: Promise<void>) {
      hold = p;
    },
    gate: {
      request: vi.fn(async (scope: string, options?: { force?: boolean }) => {
        calls.push({ scope, force: options?.force });
        if (hold) {
          const waiting = hold;
          hold = undefined;
          await waiting;
        }
      }),
      dispose: () => {},
    },
  };
}

describe("createMutationCoordinator", () => {
  it("resolves the target against the rebuilt tree, not the tree it was queued behind", async () => {
    // worktree-rpc.md:238 — an action arriving during a rebuild waits for it and
    // then resolves against the new tree. A lock alone does not do this; without
    // the barrier the mutation reads the cache the rebuild is busy replacing.
    const g = fakeGate();
    const coordinator = createMutationCoordinator({ queue: createMutationQueue(), gate: g.gate });
    const seen: string[] = [];

    const inFlight = deferred();
    g.holdWith(inFlight.promise);
    const running = coordinator.run("repo", {
      resolve: async () => {
        seen.push("resolved");
        return "target";
      },
      body: async (target) => {
        seen.push(`ran:${target}`);
        return "ok";
      },
    });

    await Promise.resolve();
    expect(seen).toEqual([]);
    inFlight.resolve();
    expect(await running).toBe("ok");
    expect(seen).toEqual(["resolved", "ran:target"]);
  });

  it("forces a rebuild after the attempt, and awaits it before releasing", async () => {
    const g = fakeGate();
    const coordinator = createMutationCoordinator({ queue: createMutationQueue(), gate: g.gate });
    await coordinator.run("repo", { resolve: async () => "t", body: async () => "ok" });

    // Barrier first, then the post-attempt rebuild — both forced.
    expect(g.calls).toEqual([
      { scope: "repo", force: true },
      { scope: "repo", force: true },
    ]);
  });

  it("still rebuilds and releases when the body throws", async () => {
    // A git refusal is the common case; the tree must still be resynced, and the
    // next mutation must not be locked out by the failure.
    const g = fakeGate();
    const queue = createMutationQueue();
    const coordinator = createMutationCoordinator({ queue, gate: g.gate });

    await expect(
      coordinator.run("repo", {
        resolve: async () => "t",
        body: async () => {
          throw new Error("git said no");
        },
      }),
    ).rejects.toThrow("git said no");

    expect(g.calls).toHaveLength(2);
    expect(queue.isBusy("repo")).toBe(false);
  });

  it("releases the queue even when the trailing rebuild itself fails", async () => {
    // The release is in `finally`; a rebuild that throws must not wedge the repo
    // for every later mutation — nor rewrite the outcome the body produced. The
    // mutation ran; only the refresh after it did not (round-4 W10).
    const queue = createMutationQueue();
    const gate = {
      request: vi
        .fn()
        .mockImplementationOnce(async () => {})
        .mockImplementationOnce(async () => {
          throw new Error("listing failed");
        }),
      dispose: () => {},
    };
    const coordinator = createMutationCoordinator({ queue, gate });

    await expect(coordinator.run("repo", { resolve: async () => "t", body: async () => "ok" })).resolves.toBe("ok");
    expect(queue.isBusy("repo")).toBe(false);
  });

  it("refuses a target the re-resolution can no longer find", async () => {
    // The id was issued against a tree that has since moved; running git on a
    // stale target is the mistake re-resolution exists to prevent.
    const g = fakeGate();
    const coordinator = createMutationCoordinator({ queue: createMutationQueue(), gate: g.gate });
    const body = vi.fn();

    await expect(coordinator.run("repo", { resolve: async () => null, body })).rejects.toThrow(/no longer/i);
    expect(body).not.toHaveBeenCalled();
  });

  it("serializes two mutations on one repo through the queue it was given", async () => {
    const g = fakeGate();
    const coordinator = createMutationCoordinator({ queue: createMutationQueue(), gate: g.gate });
    const order: string[] = [];
    const held = deferred();

    const a = coordinator.run("repo", {
      resolve: async () => "a",
      body: async () => {
        order.push("a:start");
        await held.promise;
        order.push("a:end");
      },
    });
    const b = coordinator.run("repo", {
      resolve: async () => "b",
      body: async () => {
        order.push("b:start");
      },
    });

    held.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(["a:start", "a:end", "b:start"]);
  });
});

describe("a rebuild that failed is not a rebuild that happened (round-4 W10)", () => {
  it("retries the trailing rebuild after the body's own attempt rejected", async () => {
    // The old flag was set BEFORE the await, so a rejected rebuild marked
    // itself done and `finally` skipped the retry, leaving the tree unsynced.
    const queue = createMutationQueue();
    const attempts: number[] = [];
    const gate = {
      request: vi.fn(async () => {
        attempts.push(attempts.length);
        if (attempts.length === 2) {
          throw new Error("listing failed");
        }
      }),
      dispose: () => {},
    };
    const coordinator = createMutationCoordinator({ queue, gate });

    const outcome = await coordinator.run("repo", {
      resolve: async () => "t",
      body: async (_t, ctx) => {
        await ctx.settle().catch(() => "settle rejected");
        return "ok";
      },
    });

    expect(outcome).toBe("ok");
    // Three: the opening rebuild, the body's failed settle, and the retry.
    expect(gate.request).toHaveBeenCalledTimes(3);
  });

  it("does not rebuild twice when the body's settle succeeded", async () => {
    const queue = createMutationQueue();
    const gate = { request: vi.fn(async () => {}), dispose: () => {} };
    const coordinator = createMutationCoordinator({ queue, gate });

    await coordinator.run("repo", {
      resolve: async () => "t",
      body: async (_t, ctx) => {
        await ctx.settle();
        return "ok";
      },
    });

    // The opening rebuild and one settle. The `finally` retry is a no-op.
    expect(gate.request).toHaveBeenCalledTimes(2);
  });
});
