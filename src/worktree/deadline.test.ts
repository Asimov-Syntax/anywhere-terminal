import { describe, expect, it } from "vitest";
import { afterDelay } from "./deadline";

describe("afterDelay", () => {
  it("resolves once the delay has passed", async () => {
    const d = afterDelay(1);
    await expect(d.elapsed).resolves.toBeUndefined();
    d.cancel();
  });

  it("loses a race against work that finishes first", async () => {
    const d = afterDelay(1000);
    const winner = await Promise.race([Promise.resolve("work"), d.elapsed.then(() => "deadline")]);
    // The point of cancelling: a 1000ms timer nobody cleared would keep this
    // suite — and, in production, a host shutdown — waiting on nothing.
    d.cancel();
    expect(winner).toBe("work");
  });

  it("can be cancelled twice, and after it has already fired", async () => {
    const d = afterDelay(1);
    await d.elapsed;
    d.cancel();
    expect(() => d.cancel()).not.toThrow();
  });
});

describe("[F002] a deadline can be read without awaiting it", () => {
  // A deadline observable only through `elapsed` cannot be consulted by
  // synchronous work: the `.then` watcher has not run at the first step of a
  // loop that starts in the same tick, so an already-spent deadline let that
  // first step through.
  it("is not expired while it is still pending", () => {
    const d = afterDelay(1000);
    expect(d.expired).toBe(false);
    d.cancel();
  });

  it("is expired the instant it is due, with no microtask drained first", () => {
    const d = afterDelay(0);
    expect(d.expired).toBe(true);
    d.cancel();
  });

  it("stays expired after it has fired", async () => {
    const d = afterDelay(1);
    await d.elapsed;
    expect(d.expired).toBe(true);
    d.cancel();
  });
});
