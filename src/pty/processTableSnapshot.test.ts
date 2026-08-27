import { describe, expect, it, vi } from "vitest";
import { createProcessTableSnapshot } from "./processTableSnapshot";

/** `pid ppid` rows: 100 → 200 → 300, and an unrelated 900. */
const TABLE = ["100 1", "200 100", "300 200", "900 1"].join("\n");

function harness(over: Partial<{ stdout: string; platform: NodeJS.Platform; ttlMs: number }> = {}) {
  const exec = vi.fn(async () => ({ stdout: over.stdout ?? TABLE, stderr: "" }));
  let clock = 1_000;
  const snapshot = createProcessTableSnapshot({
    ttlMs: over.ttlMs ?? 1_000,
    now: () => clock,
    exec,
    platform: over.platform ?? "darwin",
  });
  return { exec, snapshot, advance: (ms: number) => (clock += ms) };
}

describe("createProcessTableSnapshot", () => {
  it("returns a pid's descendants", async () => {
    const { snapshot } = harness();
    const outcome = await snapshot.descendantsOf(100);
    expect(outcome).toEqual({ kind: "ok", pids: [200, 300] });
  });

  it("serves many lookups from ONE process-table read", async () => {
    const { snapshot, exec } = harness();
    await snapshot.descendantsOf(100);
    await snapshot.descendantsOf(200);
    await snapshot.descendantsOf(900);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("shares one read between concurrent callers", async () => {
    const { snapshot, exec } = harness();
    await Promise.all([snapshot.descendantsOf(100), snapshot.descendantsOf(200), snapshot.descendantsOf(900)]);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("re-reads once the TTL has elapsed", async () => {
    const { snapshot, exec, advance } = harness({ ttlMs: 1_000 });
    await snapshot.descendantsOf(100);
    advance(1_001);
    await snapshot.descendantsOf(100);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("reports an unsupported platform as itself, not as an empty result", async () => {
    // D10: `[]` cannot be told apart from "this pane genuinely has no children",
    // which is what lets a transient failure silently demote a proven agent row.
    const { snapshot, exec } = harness({ platform: "win32" });
    expect(await snapshot.descendantsOf(100)).toEqual({ kind: "unsupported" });
    expect(exec).not.toHaveBeenCalled();
  });

  it("reports a failed read as itself, with a reason", async () => {
    const exec = vi.fn(async () => {
      throw new Error("spawn ps ENOENT");
    });
    const snapshot = createProcessTableSnapshot({ exec, platform: "linux", now: () => 0 });
    const outcome = await snapshot.descendantsOf(100);
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.reason).toContain("ps");
    }
  });

  it("does not cache a failure as a successful empty table", async () => {
    let attempt = 0;
    const exec = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("timed out");
      }
      return { stdout: TABLE, stderr: "" };
    });
    let clock = 0;
    const snapshot = createProcessTableSnapshot({ ttlMs: 10_000, exec, platform: "linux", now: () => clock });
    expect((await snapshot.descendantsOf(100)).kind).toBe("failed");
    clock = 1; // still well inside the TTL
    expect(await snapshot.descendantsOf(100)).toEqual({ kind: "ok", pids: [200, 300] });
  });

  it("treats an invalid root pid as a conclusive absence of descendants", async () => {
    const { snapshot } = harness();
    expect(await snapshot.descendantsOf(0)).toEqual({ kind: "ok", pids: [] });
    expect(await snapshot.descendantsOf(-1)).toEqual({ kind: "ok", pids: [] });
    expect(await snapshot.descendantsOf(1.5)).toEqual({ kind: "ok", pids: [] });
  });

  it("reports a pid with no children as an empty success", async () => {
    const { snapshot } = harness();
    expect(await snapshot.descendantsOf(900)).toEqual({ kind: "ok", pids: [] });
  });

  it("never throws out of descendantsOf", async () => {
    const exec = vi.fn(async () => {
      // biome-ignore lint/style/useThrowOnlyError: a non-Error throw is the case under test — describeExecFailure has to survive one.
      throw { weird: true };
    });
    const snapshot = createProcessTableSnapshot({ exec, platform: "darwin", now: () => 0 });
    await expect(snapshot.descendantsOf(100)).resolves.toMatchObject({ kind: "failed" });
  });
});

describe("a pinned reading", () => {
  it("answers every lookup from the one table it took", async () => {
    const { snapshot, exec, advance } = harness();
    const reading = await snapshot.open();

    advance(60_000);
    expect(reading.descendantsOf(100)).toEqual({ kind: "ok", pids: [200, 300] });
    expect(reading.descendantsOf(200)).toEqual({ kind: "ok", pids: [300] });
    expect(reading.descendantsOf(900)).toEqual({ kind: "ok", pids: [] });

    // The TTL paces repeat reads; it cannot decide what one rebuild is.
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("carries a failed read to every lookup rather than reporting an empty subtree", async () => {
    const exec = vi.fn(async () => {
      throw new Error("timed out");
    });
    const snapshot = createProcessTableSnapshot({ exec, platform: "darwin", now: () => 0 });
    const reading = await snapshot.open();
    expect(reading.descendantsOf(100)).toMatchObject({ kind: "failed" });
  });

  it("reports an unsupported platform without reading anything", async () => {
    const { snapshot, exec } = harness({ platform: "win32" });
    const reading = await snapshot.open();
    expect(reading.descendantsOf(100)).toEqual({ kind: "unsupported" });
    expect(exec).not.toHaveBeenCalled();
  });

  it("still answers an invalid pid conclusively", async () => {
    const { snapshot } = harness();
    const reading = await snapshot.open();
    expect(reading.descendantsOf(0)).toEqual({ kind: "ok", pids: [] });
  });
});
