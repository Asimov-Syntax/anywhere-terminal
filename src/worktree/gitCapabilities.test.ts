import { describe, expect, it, vi } from "vitest";
import {
  createGitCapabilities,
  GIT_CAPABILITY_RETRY_INTERVAL_MS,
  hasUnsupportedPathFormatEcho,
  isUnsupportedZResult,
} from "./gitCapabilities";
import type { GitCommandResult, GitCommandRunner } from "./gitCommandRunner";

function result(over: Partial<GitCommandResult> = {}): GitCommandResult {
  return {
    code: 0,
    stdout: Buffer.alloc(0),
    stderr: "",
    timedOut: false,
    failedToSpawn: false,
    ...over,
  };
}

function versionRunner(stdout: string, over: Partial<GitCommandResult> = {}) {
  const run = vi.fn(async () => result({ stdout: Buffer.from(stdout), ...over }));
  return { runner: { run } as unknown as GitCommandRunner, run };
}

/** Controllable clock so the 30-minute expiry is tested without waiting. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("isUnsupportedZResult — design.md D7", () => {
  it("treats exit 129 as the rejection signal, whatever the locale", () => {
    expect(isUnsupportedZResult(result({ code: 129, stderr: "オプションが不明です" }))).toBe(true);
  });

  it("falls back to the English message when the code is not 129", () => {
    expect(isUnsupportedZResult(result({ code: 1, stderr: "error: unknown switch `z'" }))).toBe(true);
  });

  it("does not mistake an ordinary git failure for an unsupported option", () => {
    expect(isUnsupportedZResult(result({ code: 128, stderr: "fatal: not a git repository" }))).toBe(false);
  });

  it("does not treat success as a rejection", () => {
    expect(isUnsupportedZResult(result())).toBe(false);
  });
});

describe("hasUnsupportedPathFormatEcho — design.md D7", () => {
  // Old git exits 0 and prints the flag back instead of failing.
  it("detects the flag echoed as an output line", () => {
    expect(hasUnsupportedPathFormatEcho(Buffer.from("--path-format=absolute\n/repo/.git\n"))).toBe(true);
  });

  it("passes a real answer through", () => {
    expect(hasUnsupportedPathFormatEcho(Buffer.from("/repo/.git\n"))).toBe(false);
  });

  it("does not fire on a path that merely contains the flag name", () => {
    expect(hasUnsupportedPathFormatEcho(Buffer.from("/repo/x--path-format/.git\n"))).toBe(false);
  });
});

describe("createGitCapabilities — version probe", () => {
  it("accepts a git at or above the 2.31 floor", async () => {
    const { runner } = versionRunner("git version 2.50.1 (Apple Git-155)\n");
    await expect(createGitCapabilities(runner).probeVersion()).resolves.toMatchObject({
      kind: "supported",
      version: "2.50.1",
    });
  });

  it("accepts exactly 2.31", async () => {
    const { runner } = versionRunner("git version 2.31.0\n");
    await expect(createGitCapabilities(runner).probeVersion()).resolves.toMatchObject({ kind: "supported" });
  });

  it("reports a git below the floor as unsupported, not absent", async () => {
    const { runner } = versionRunner("git version 2.30.2\n");
    const outcome = await createGitCapabilities(runner).probeVersion();
    expect(outcome.kind).toBe("unsupported");
    expect(outcome.kind === "unsupported" && outcome.reason).toMatch(/2\.31/);
  });

  it("reports a missing executable as absent", async () => {
    const { runner } = versionRunner("", { failedToSpawn: true, code: -1 });
    await expect(createGitCapabilities(runner).probeVersion()).resolves.toMatchObject({ kind: "absent" });
  });

  it("reports unparseable version output as absent rather than guessing", async () => {
    const { runner } = versionRunner("something else entirely\n");
    await expect(createGitCapabilities(runner).probeVersion()).resolves.toMatchObject({ kind: "absent" });
  });

  it("memoizes a supported result for the process lifetime", async () => {
    const { runner, run } = versionRunner("git version 2.50.1\n");
    const c = clock();
    const caps = createGitCapabilities(runner, c.now);
    await caps.probeVersion();
    c.advance(GIT_CAPABILITY_RETRY_INTERVAL_MS * 10);
    await caps.probeVersion();
    expect(run).toHaveBeenCalledTimes(1);
  });

  // design.md D2: the realistic move is an upgrade, by the user we just told to upgrade.
  it("re-probes a negative result after the retry interval", async () => {
    const { runner, run } = versionRunner("", { failedToSpawn: true, code: -1 });
    const c = clock();
    const caps = createGitCapabilities(runner, c.now);
    await caps.probeVersion();
    await caps.probeVersion();
    expect(run).toHaveBeenCalledTimes(1);

    c.advance(GIT_CAPABILITY_RETRY_INTERVAL_MS + 1);
    await caps.probeVersion();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight probe across concurrent callers", async () => {
    const { runner, run } = versionRunner("git version 2.50.1\n");
    const caps = createGitCapabilities(runner);
    await Promise.all([caps.probeVersion(), caps.probeVersion(), caps.probeVersion()]);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("createGitCapabilities — runWithFallback", () => {
  const caps = () => createGitCapabilities(versionRunner("git version 2.50.1\n").runner);

  it("uses the preferred path and never calls the fallback when supported", async () => {
    const fallback = vi.fn(async () => "fallback");
    const value = await caps().runWithFallback(
      "worktree-list-z",
      async () => ({ supported: true, value: "preferred" }),
      fallback,
    );
    expect(value).toBe("preferred");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back when the preferred path reports the option unsupported", async () => {
    const value = await caps().runWithFallback(
      "worktree-list-z",
      async () => ({ supported: false }) as const,
      async () => "fallback",
    );
    expect(value).toBe("fallback");
  });

  it("stops retrying a rejected option within the retry interval", async () => {
    const c = clock();
    const instance = createGitCapabilities(versionRunner("git version 2.50.1\n").runner, c.now);
    const preferred = vi.fn(async () => ({ supported: false }) as const);
    const fallback = async () => "fallback";

    await instance.runWithFallback("worktree-list-z", preferred, fallback);
    await instance.runWithFallback("worktree-list-z", preferred, fallback);
    expect(preferred).toHaveBeenCalledTimes(1);

    c.advance(GIT_CAPABILITY_RETRY_INTERVAL_MS + 1);
    await instance.runWithFallback("worktree-list-z", preferred, fallback);
    expect(preferred).toHaveBeenCalledTimes(2);
  });

  it("keeps capabilities independent of one another", async () => {
    const instance = caps();
    const zPreferred = vi.fn(async () => ({ supported: false }) as const);
    const pathPreferred = vi.fn(async () => ({ supported: true, value: "ok" }) as const);

    await instance.runWithFallback("worktree-list-z", zPreferred, async () => "fb");
    await instance.runWithFallback("rev-parse-path-format", pathPreferred, async () => "fb");
    await instance.runWithFallback("rev-parse-path-format", pathPreferred, async () => "fb");

    expect(pathPreferred).toHaveBeenCalledTimes(2);
  });

  it("does not swallow an error thrown by the preferred path", async () => {
    await expect(
      caps().runWithFallback(
        "worktree-list-z",
        async () => {
          throw new Error("boom");
        },
        async () => "fallback",
      ),
    ).rejects.toThrow("boom");
  });
});
