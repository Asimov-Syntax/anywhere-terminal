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
