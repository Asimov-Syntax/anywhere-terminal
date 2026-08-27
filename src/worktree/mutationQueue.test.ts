import { describe, expect, it } from "vitest";
import { createMutationQueue } from "./mutationQueue";

/** A promise plus the handle that settles it, so a body can be held open. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createMutationQueue", () => {
  it("runs both entries on one repo, in order, dropping neither", async () => {
    // The whole reason this is not `rebuildGate`: two removals must BOTH run.
    // Coalescing them would silently discard one of the user's actions.
    const queue = createMutationQueue();
    const order: string[] = [];
    const first = deferred<void>();

    const a = queue.run("repo", async () => {
      order.push("a:start");
      await first.promise;
      order.push("a:end");
      return "a";
    });
    const b = queue.run("repo", async () => {
      order.push("b:start");
      return "b";
    });

    // One tick, because the queue starts a body on the microtask queue rather
    // than synchronously — the ordering claim below is what matters, not that.
    await Promise.resolve();
    expect(order).toEqual(["a:start"]);
    first.resolve();
    expect(await a).toBe("a");
    expect(await b).toBe("b");
    expect(order).toEqual(["a:start", "a:end", "b:start"]);
  });

  it("lets a different repo run while one repo is held", async () => {
    // Serialization is per repo; a slow removal in A must not stall B.
    const queue = createMutationQueue();
    const held = deferred<void>();
    const a = queue.run("repoA", async () => {
      await held.promise;
      return "a";
    });

    expect(await queue.run("repoB", async () => "b")).toBe("b");
    held.resolve();
    expect(await a).toBe("a");
  });

  it("releases the lock when a body throws, so the queue does not wedge", async () => {
    // A failed mutation is the common case, not the exotic one — git refuses
    // constantly. If a rejection kept the lock, one refusal would freeze every
    // later action on that repository.
    const queue = createMutationQueue();
    await expect(
      queue.run("repo", async () => {
        throw new Error("git said no");
      }),
    ).rejects.toThrow("git said no");

    expect(await queue.run("repo", async () => "after")).toBe("after");
  });

  it("keeps a body's rejection from settling the entry behind it", async () => {
    // Chaining the queue on the previous promise without isolating rejection
    // makes the follow-up inherit the failure it had nothing to do with.
    const queue = createMutationQueue();
    const failing = queue.run("repo", async () => {
      throw new Error("first");
    });
    const next = queue.run("repo", async () => "second");

    await expect(failing).rejects.toThrow("first");
    expect(await next).toBe("second");
  });

  it("reports whether a repo is mid-mutation", async () => {
    // D11 quarantines a repo whose child could not be confirmed dead; that
    // decision needs to be able to ask.
    const queue = createMutationQueue();
    const held = deferred<void>();
    expect(queue.isBusy("repo")).toBe(false);

    const running = queue.run("repo", async () => {
      await held.promise;
    });
    expect(queue.isBusy("repo")).toBe(true);

    held.resolve();
    await running;
    expect(queue.isBusy("repo")).toBe(false);
  });

  it("releases the repo when the body throws synchronously", () => {
    // A body that throws before returning a promise never reaches the release
    // if it is invoked as an argument — `isBusy` then stays true forever and
    // every later mutation on that repo is offered against a repo the host
    // believes is mid-flight (round-1 W1).
    const queue = createMutationQueue();
    const run = queue.run("a", () => {
      throw new Error("synchronous");
    });
    return run.then(
      () => expect.unreachable("the throw must propagate"),
      () => {
        expect(queue.isBusy("a")).toBe(false);
      },
    );
  });
});
