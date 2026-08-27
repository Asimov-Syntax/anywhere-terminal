// src/utils/keyedSerialQueue.test.ts — The serialization contract two callers
// now depend on: worktree mutations and agent-hook transitions.

import { describe, expect, it } from "vitest";
import { createKeyedSerialQueue } from "./keyedSerialQueue";

const settle = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

describe("createKeyedSerialQueue", () => {
  it("runs one key's work in submission order, never overlapping", async () => {
    const queue = createKeyedSerialQueue();
    const order: string[] = [];
    const body = (name: string, delay: number) => async () => {
      order.push(`start:${name}`);
      await settle(delay);
      order.push(`end:${name}`);
    };

    await Promise.all([queue.run("a", body("first", 10)), queue.run("a", body("second", 1))]);

    expect(order).toEqual(["start:first", "end:first", "start:second", "end:second"]);
  });

  it("runs different keys concurrently", async () => {
    const queue = createKeyedSerialQueue();
    const started: string[] = [];
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    const all = Promise.all([
      queue.run("a", async () => {
        started.push("a");
        await blocked;
      }),
      queue.run("b", async () => {
        started.push("b");
      }),
    ]);
    await settle(5);

    expect(started).toEqual(["a", "b"]);
    release();
    await all;
  });

  it("runs the next body after a rejection rather than inheriting it", async () => {
    const queue = createKeyedSerialQueue();
    let ran = false;

    const failed = queue.run("a", async () => {
      throw new Error("first");
    });
    const next = queue.run("a", async () => {
      ran = true;
      return "second";
    });

    await expect(failed).rejects.toThrow("first");
    await expect(next).resolves.toBe("second");
    expect(ran).toBe(true);
  });

  it("contains a body that throws synchronously", async () => {
    const queue = createKeyedSerialQueue();

    await expect(
      queue.run("a", () => {
        throw new Error("sync");
      }),
    ).rejects.toThrow("sync");
    await expect(queue.run("a", async () => "after")).resolves.toBe("after");
  });

  it("reports a key as owed from enqueue until settlement, including a failure", async () => {
    const owed = new Map<string, number>();
    const queue = createKeyedSerialQueue({
      onEnter: (key) => owed.set(key, (owed.get(key) ?? 0) + 1),
      onLeave: (key) => owed.set(key, (owed.get(key) ?? 0) - 1),
    });

    const queued = queue.run("a", async () => {
      throw new Error("boom");
    });
    // Counted before the body starts — queued work is still owed.
    expect(owed.get("a")).toBe(1);

    await expect(queued).rejects.toThrow("boom");
    expect(owed.get("a")).toBe(0);
  });

  it("does not let a slow predecessor's cleanup free a key a successor still holds", async () => {
    const queue = createKeyedSerialQueue();
    const order: string[] = [];

    const first = queue.run("a", async () => {
      order.push("first");
      await settle(5);
    });
    const second = queue.run("a", async () => {
      order.push("second");
    });
    await Promise.all([first, second]);
    await queue.run("a", async () => {
      order.push("third");
    });

    expect(order).toEqual(["first", "second", "third"]);
  });
});
