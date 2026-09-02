import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("[WT-011.11] a deadline has passed once its own wait has completed", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * The defect is a race between two clocks, so a real timer reproduces it
   * about one run in twenty-five. Driving the timer by hand makes the schedule
   * the defect needs the ONLY schedule under test: the callback fires while the
   * wall clock is still one millisecond short of the deadline's instant.
   */
  function atTheEarlyEdge(ms: number) {
    const start = 1_000_000;
    let now = start;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let callback: (() => void) | undefined;
    vi.stubGlobal("setTimeout", (fn: () => void) => {
      callback = fn;
      return { unref: () => {} } as unknown as ReturnType<typeof setTimeout>;
    });
    const d = afterDelay(ms);
    vi.unstubAllGlobals();
    // The timer fires EARLY against Date.now() — exactly what Node may do.
    now = start + ms - 1;
    return { d, fire: () => callback?.(), setNow: (t: number) => (now = start + t) };
  }

  it("is expired after its wait resolves, though the wall clock says otherwise", async () => {
    const { d, fire } = atTheEarlyEdge(1);
    fire();
    await d.elapsed;

    expect(d.expired).toBe(true);
    d.cancel();
  });

  it("would not be, on the wall clock alone", () => {
    // Guards the witness above: if this reads true the schedule is not the one
    // the defect needs, and the test above would pass against the old code.
    const { d } = atTheEarlyEdge(1);

    expect(d.expired).toBe(false);
    d.cancel();
  });

  it("does not come back once it has been read as expired", () => {
    const { d, setNow } = atTheEarlyEdge(10);
    setNow(20);
    expect(d.expired).toBe(true);
    // NTP correction, a user setting the clock, a VM resuming a snapshot.
    setNow(0);

    expect(d.expired).toBe(true);
    d.cancel();
  });

  /** The delay actually handed to the timer, which is the half `expired` cannot show. */
  function delayFor(ms: number): { asked: number | undefined; fire: () => void; expired: boolean } {
    let asked: number | undefined;
    let callback: (() => void) | undefined;
    vi.stubGlobal("setTimeout", (fn: () => void, delay?: number) => {
      callback = fn;
      asked = delay;
      return { unref: () => {} } as unknown as ReturnType<typeof setTimeout>;
    });
    const d = afterDelay(ms);
    vi.unstubAllGlobals();
    return { asked, fire: () => callback?.(), expired: d.expired };
  }

  it("hands the timer the same delay the instant was computed from", () => {
    // Reading `expired` cannot see this: an implementation that normalized only
    // `at` and passed the raw `ms` to the timer would satisfy every assertion
    // about `expired` and recreate the two-clock divergence
    // (.reviews/round-1.md F002).
    expect(delayFor(1_000).asked).toBe(1_000);
    expect(delayFor(2_147_483_647).asked).toBe(2_147_483_647);
    expect(delayFor(2.7).asked).toBe(2);
    expect(delayFor(-1).asked).toBe(0);
    expect(delayFor(Number.NaN).asked).toBe(0);
  });

  it("[round-1 F001] gives an over-range delay the 1ms Node would, not 24.8 days", () => {
    // `ignoredMaterial` computes `left` from `Date.now() - startedAt`, so a
    // backwards clock step alone produces a number past the timer's range.
    // Saturating it to 2**31-1 held removal assessment open for weeks where
    // Node's own clamp had failed it soft.
    for (const ms of [2_147_483_648, Number.POSITIVE_INFINITY]) {
      const over = delayFor(ms);

      expect(over.asked).toBe(ms === Number.POSITIVE_INFINITY ? 0 : 1);
    }
  });

  it("[round-1 F001] expires once that clamped timer fires", async () => {
    const start = Date.now();
    const d = afterDelay(2_147_483_648);
    await d.elapsed;

    expect(d.expired).toBe(true);
    // Not 24.8 days.
    expect(Date.now() - start).toBeLessThan(1_000);
    d.cancel();
  });

  it("settles on a delay no timer would accept, rather than waiting forever", () => {
    for (const ms of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const d = afterDelay(ms);
      expect(d.expired).toBe(true);
      d.cancel();
    }
  });
});
