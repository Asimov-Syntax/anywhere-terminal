// src/agentHooks/install/activation.test.ts — Ordering, which is the whole of
// the contract: an install that runs before the record is read overwrites the
// only pointer to the file the previous session wrote (round-9 B14).

import { describe, expect, it } from "vitest";
import { startAgentHooks } from "./activation";

function recorder() {
  const order: string[] = [];
  const step = (name: string) => async () => {
    order.push(name);
  };
  return { order, step };
}

describe("the order agent hooks start in", () => {
  it("reads the record before anything installs", async () => {
    const { order, step } = recorder();

    await startAgentHooks({
      loadLedger: step("load"),
      startController: step("install"),
      reconcileAll: step("reconcile"),
    });

    expect(order.slice(0, 2)).toEqual(["load", "install"]);
  });

  it("does not hold activation open for the retry of old obligations", async () => {
    const { order, step } = recorder();
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    await startAgentHooks({
      loadLedger: step("load"),
      startController: step("install"),
      reconcileAll: () => blocked,
    });

    // Returned while the reconcile is still running: cleanup retries can take a
    // cross-process lock per destination, and activation cannot wait for that.
    expect(order).toEqual(["load", "install"]);
    release?.();
  });
});
